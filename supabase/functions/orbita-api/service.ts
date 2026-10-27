import { IntegrationError, INTEGRATION_HEADERS, integrationSlot, normalizeIntegrationInput, publicIntegrationSettings, readIntegrationBody, type StoredIntegrationConfig } from "../../../lib/integration-config";
import { credentialsKey, decryptIntegration, encryptIntegration, randomOpaque, stateHash, type Encrypted } from "../../../lib/integration-crypto";
import { finishGoogleOAuth, startGoogleOAuthWithRedirect } from "../../../lib/integration-oauth";
import type { OAuthStatePayload } from "../../../lib/integration-store";
import type { Provider } from "../../../lib/workspace-types";
import { DEFAULT_COMPANIES } from "../../../lib/workspace-types";
import { getWorkspaceStatus, syncWorkspace } from "../../../lib/provider-sync";

export type Environment = Record<string, string | undefined>;
export type EdgeConfig = { supabaseUrl: string; publishableKey: string; secretKey: string; ownerId: string; allowedOrigin: string; appUrl: string; encryptionKey: string; callbackUrl: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unavailable = () => new IntegrationError("backend_unavailable", "O backend seguro precisa ser configurado. Confira as variáveis do Supabase.", 503);
function mapKey(raw?: string): string | undefined { if (!raw) return undefined; try { const parsed: unknown = JSON.parse(raw); if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).default === "string") return (parsed as Record<string, string>).default; } catch { /* Invalid server configuration fails closed below. */ } }
function bootstrapConfig(env: Environment) {
  const project = new URL(env.SUPABASE_URL || "");
  const local = project.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(project.hostname);
  if ((project.protocol !== "https:" && !local) || project.username || project.password || project.pathname !== "/" || project.search || project.hash) throw unavailable();
  const publishableKey = env.ORBITA_SUPABASE_PUBLISHABLE_KEY || mapKey(env.SUPABASE_PUBLISHABLE_KEYS) || env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  const secretKey = env.ORBITA_SUPABASE_SECRET_KEY || mapKey(env.SUPABASE_SECRET_KEYS) || env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!publishableKey || !secretKey || publishableKey === secretKey) throw unavailable();
  return { supabaseUrl: project.origin, publishableKey, secretKey, callbackUrl: `${project.origin}/functions/v1/orbita-api/integrations/google/callback` };
}
export function readEdgeConfig(env: Environment): EdgeConfig {
  try {
    const bootstrap = bootstrapConfig(env), origin = new URL(env.ORBITA_ALLOWED_ORIGIN || "");
    const local = (url: URL) => url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((origin.protocol !== "https:" && !local(origin)) || origin.href !== `${origin.origin}/` || env.ORBITA_ALLOWED_ORIGIN !== origin.origin) throw unavailable();
    const app = new URL(env.ORBITA_APP_URL || `${origin.origin}/`);
    if (app.origin !== origin.origin || app.username || app.password || app.search || app.hash || !UUID.test(env.ORBITA_OWNER_ID || "")) throw unavailable();
    if (!env.ORBITA_CREDENTIALS_KEY || !/^[A-Za-z0-9+/]{43}=$/.test(env.ORBITA_CREDENTIALS_KEY)) throw unavailable();
    return { ...bootstrap, ownerId: env.ORBITA_OWNER_ID!.toLowerCase(), allowedOrigin: origin.origin, appUrl: app.href, encryptionKey: env.ORBITA_CREDENTIALS_KEY };
  } catch { throw unavailable(); }
}
/** A server-only fallback. Resolve once per request, never retain decrypted Vault values globally. */
export async function resolveEdgeConfig(env: Environment, fetcher: typeof fetch): Promise<EdgeConfig> {
  if (["ORBITA_OWNER_ID", "ORBITA_ALLOWED_ORIGIN", "ORBITA_APP_URL", "ORBITA_CREDENTIALS_KEY"].every((name) => Boolean(env[name]))) return readEdgeConfig(env);
  try {
    const bootstrap = bootstrapConfig(env), headers: Record<string, string> = { apikey: bootstrap.secretKey, "Content-Type": "application/json" };
    if (!bootstrap.secretKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${bootstrap.secretKey}`;
    const response = await fetcher(`${bootstrap.supabaseUrl}/rest/v1/rpc/orbita_runtime_configuration`, { method: "POST", headers, body: "{}", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw unavailable();
    const value: unknown = await response.json();
    if (!Array.isArray(value) || value.length !== 1 || value[0] === null || typeof value[0] !== "object" || Array.isArray(value[0])) throw unavailable();
    const settings = value[0] as Record<string, unknown>, completed: Environment = { ...env };
    for (const [name, field] of [["ORBITA_OWNER_ID", "owner_id"], ["ORBITA_ALLOWED_ORIGIN", "allowed_origin"], ["ORBITA_APP_URL", "app_url"], ["ORBITA_CREDENTIALS_KEY", "credentials_key"]]) {
      if (!completed[name]) { if (typeof settings[field] !== "string" || !(settings[field] as string)) throw unavailable(); completed[name] = settings[field] as string; }
    }
    // Environment always wins, including invalid values: never silently replace a wrong owner or key.
    return readEdgeConfig(completed);
  } catch { throw unavailable(); }
}
type CredentialRow = Encrypted & { provider: string; company_id: string; updated_at: string };
type StateRow = Encrypted & { company_id: string };
export class SupabaseStore {
  config: EdgeConfig; key: CryptoKey; fetcher: typeof fetch;
  constructor(config: EdgeConfig, key: CryptoKey, fetcher: typeof fetch) { this.config = config; this.key = key; this.fetcher = fetcher; }
  owner(ownerId: string) { if (ownerId !== this.config.ownerId) throw new IntegrationError("forbidden", "Esta conta não tem acesso ao painel.", 403); }
  async rest(path: string, method = "GET", body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { apikey: this.config.secretKey, "Content-Type": "application/json" };
    if (method === "POST" && path.startsWith("orbita_integration_credentials?")) headers.Prefer = "resolution=merge-duplicates,return=minimal";
    // New sb_secret keys belong only in apikey. Legacy service_role is a JWT.
    if (!this.config.secretKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${this.config.secretKey}`;
    try {
      const response = await this.fetcher(`${this.config.supabaseUrl}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw unavailable();
      const text = await response.text(); return text ? JSON.parse(text) : null;
    } catch { throw new IntegrationError("storage_unavailable", "Não foi possível acessar o armazenamento seguro.", 503); }
  }
  async rpc(name: string, body: Record<string, unknown>): Promise<unknown> { return this.rest(`rpc/${name}`, "POST", body); }
  async get(ownerId: string, provider: Provider, companyId: string) {
    this.owner(ownerId); integrationSlot(provider, companyId);
    const query = new URLSearchParams({ owner_id: `eq.${ownerId}`, provider: `eq.${provider}`, company_id: `eq.${companyId}`, select: "provider,company_id,iv,ciphertext,updated_at", limit: "1" });
    const rows = await this.rest(`orbita_integration_credentials?${query}`);
    if (!Array.isArray(rows)) throw unavailable(); if (!rows[0]) return undefined;
    const row = rows[0] as CredentialRow, config = await decryptIntegration<StoredIntegrationConfig>(row, this.key, ownerId, provider, companyId);
    if (config.id !== `${provider}-${companyId}` || config.provider !== provider || config.companyId !== companyId) throw unavailable();
    return { config, updatedAt: row.updated_at };
  }
  async list(ownerId: string): Promise<StoredIntegrationConfig[]> {
    this.owner(ownerId);
    const rows = await this.rest(`orbita_integration_credentials?${new URLSearchParams({ owner_id: `eq.${ownerId}`, select: "provider,company_id,iv,ciphertext,updated_at", limit: "12" })}`);
    if (!Array.isArray(rows)) throw unavailable();
    return Promise.all(rows.map(async (raw) => { const row = raw as CredentialRow, slot = integrationSlot(row.provider, row.company_id), config = await decryptIntegration<StoredIntegrationConfig>(row, this.key, ownerId, slot.provider, slot.companyId); if (config.id !== `${slot.provider}-${slot.companyId}` || config.provider !== slot.provider || config.companyId !== slot.companyId) throw unavailable(); return config; }));
  }
  async save(ownerId: string, config: StoredIntegrationConfig): Promise<string> {
    this.owner(ownerId); const encrypted = await encryptIntegration(config, this.key, ownerId, config.provider, config.companyId), updatedAt = new Date().toISOString();
    await this.rest("orbita_integration_credentials?on_conflict=owner_id,provider,company_id", "POST", { owner_id: ownerId, provider: config.provider, company_id: config.companyId, ...encrypted, updated_at: updatedAt }); return updatedAt;
  }
  async disconnect(ownerId: string, provider: Provider, companyId: string) { this.owner(ownerId); integrationSlot(provider, companyId); await this.rpc("orbita_disconnect", { p_owner_id: ownerId, p_provider: provider, p_company_id: companyId }); }
  async createOAuthState(ownerId: string, payload: OAuthStatePayload, now = Date.now()): Promise<string> {
    this.owner(ownerId); const state = randomOpaque(), hash = await stateHash(state), encrypted = await encryptIntegration(payload, this.key, ownerId, "google", payload.draft.companyId, `oauth:${hash}`);
    await this.rpc("orbita_create_oauth_state", { p_state_hash: hash, p_owner_id: ownerId, p_company_id: payload.draft.companyId, p_iv: encrypted.iv, p_ciphertext: encrypted.ciphertext, p_now: now }); return state;
  }
  async consumeOAuthState(ownerId: string, state: string, now = Date.now()): Promise<OAuthStatePayload> {
    this.owner(ownerId); if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new IntegrationError("invalid_oauth_state", "A autorização expirou ou já foi utilizada.");
    const hash = await stateHash(state), rows = await this.rpc("orbita_claim_oauth_state", { p_state_hash: hash, p_owner_id: ownerId, p_now: now });
    if (!Array.isArray(rows) || !rows[0]) throw new IntegrationError("invalid_oauth_state", "A autorização expirou ou já foi utilizada.");
    const row = rows[0] as StateRow; return decryptIntegration<OAuthStatePayload>(row, this.key, ownerId, "google", row.company_id, `oauth:${hash}`);
  }
  async saveOAuthResult(ownerId: string, state: string, config: StoredIntegrationConfig, now = Date.now()): Promise<void> {
    this.owner(ownerId); const encrypted = await encryptIntegration(config, this.key, ownerId, config.provider, config.companyId);
    const saved = await this.rpc("orbita_commit_oauth", { p_state_hash: await stateHash(state), p_owner_id: ownerId, p_company_id: config.companyId, p_iv: encrypted.iv, p_ciphertext: encrypted.ciphertext, p_now: now });
    if (saved !== true) throw new IntegrationError("oauth_cancelled", "A autorização foi cancelada ou expirou.");
  }
}
/** Equivalent to auth.getUser(accessToken): validate with Auth server, never trust decoded JWT claims. */
export async function getUser(request: Request, config: EdgeConfig, fetcher: typeof fetch): Promise<{ id: string }> {
  if (request.headers.get("apikey") !== config.publishableKey) throw new IntegrationError("unauthorized", "A configuração pública do aplicativo é inválida.", 401);
  const match = /^Bearer ([^\s]{1,8192})$/.exec(request.headers.get("authorization") || "");
  if (!match) throw new IntegrationError("unauthorized", "Entre para acessar o painel.", 401);
  let user: unknown;
  try { const response = await fetcher(`${config.supabaseUrl}/auth/v1/user`, { headers: { apikey: config.publishableKey, Authorization: `Bearer ${match[1]}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) }); if (!response.ok) throw new Error("Invalid session"); user = await response.json(); }
  catch { throw new IntegrationError("unauthorized", "Sua sessão expirou. Entre novamente.", 401); }
  const id = user && typeof user === "object" ? (user as Record<string, unknown>).id : undefined;
  if (typeof id !== "string" || id !== config.ownerId) throw new IntegrationError("forbidden", "Esta conta não tem acesso ao painel.", 403);
  return { id };
}
export function createOrbitaHandler(env: Environment, fetcher: typeof fetch = fetch): (request: Request) => Promise<Response> {
  return async (request) => {
    let config: EdgeConfig | undefined;
    const headers: Record<string, string> = { ...INTEGRATION_HEADERS, Vary: "Origin", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info" };
    try {
      config = await resolveEdgeConfig(env, fetcher);
      const url = new URL(request.url);
      // The hosted gateway strips /functions/v1 and retains the function slug.
      const prefix = ["/functions/v1/orbita-api", "/orbita-api"].find((value) => url.pathname.startsWith(`${value}/`));
      const path = prefix ? url.pathname.slice(prefix.length) : url.pathname;
      const callback = path === "/integrations/google/callback" && request.method === "GET";
      if (!callback) {
        if (request.headers.get("origin") !== config.allowedOrigin) throw new IntegrationError("invalid_origin", "Origem do aplicativo não autorizada.", 403);
        headers["Access-Control-Allow-Origin"] = config.allowedOrigin;
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      }
      const key = await credentialsKey(config.encryptionKey), store = new SupabaseStore(config, key, fetcher);
      if (callback) {
        const destination = new URL(config.appUrl); destination.searchParams.set("provider", "google");
        try { const company = await finishGoogleOAuth(config.ownerId, url.searchParams.get("state") || "", url.searchParams.get("code"), url.searchParams.get("error"), store, { fetch: fetcher }); destination.searchParams.set("integration", "connected"); destination.searchParams.set("company", company); }
        catch { destination.searchParams.set("integration", "error"); destination.searchParams.set("reason", "oauth_failed"); }
        return new Response(null, { status: 303, headers: { ...headers, Location: destination.href } });
      }
      const user = await getUser(request, config, fetcher);
      const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
      if (path === "/workspace" && request.method === "GET") return json({ ...getWorkspaceStatus(await store.list(user.id), DEFAULT_COMPANIES), integrations: { available: true } });
      if (path === "/sync" && request.method === "POST") { const configs = await store.list(user.id); if (!configs.length) throw new IntegrationError("not_configured", "Configure uma integração antes de sincronizar.", 409); return json({ configured: true, data: await syncWorkspace(configs, DEFAULT_COMPANIES, { fetch: fetcher }) }); }
      if (path === "/integrations" && request.method === "GET") { const slot = integrationSlot(url.searchParams.get("provider"), url.searchParams.get("companyId")), saved = await store.get(user.id, slot.provider, slot.companyId); return json({ settings: publicIntegrationSettings(slot.provider, slot.companyId, saved?.config, saved?.updatedAt), callbackUrl: config.callbackUrl }); }
      if (path === "/integrations" && request.method === "DELETE") { const slot = url.searchParams.has("provider") ? integrationSlot(url.searchParams.get("provider"), url.searchParams.get("companyId")) : await readIntegrationBody(request); await store.disconnect(user.id, slot.provider, slot.companyId); return json({ settings: publicIntegrationSettings(slot.provider, slot.companyId), message: "Integração desconectada." }); }
      if (["/integrations", "/integrations/test", "/integrations/google/start"].includes(path) && request.method === "POST") {
        const input = await readIntegrationBody(request), saved = await store.get(user.id, input.provider, input.companyId);
        if (path.endsWith("/google/start")) return json(await startGoogleOAuthWithRedirect(user.id, input, config.callbackUrl, store, saved?.config));
        const normalized = normalizeIntegrationInput(input, saved?.config);
        if (path.endsWith("/test")) { const result = await syncWorkspace([normalized], DEFAULT_COMPANIES, { fetch: fetcher }), verified = result.connections.find((connection) => connection.id === normalized.id)?.status === "connected"; return json({ verified, message: verified ? "Acesso validado para leitura." : "Não foi possível validar toda a leitura. Confira credenciais e permissões." }); }
        const updatedAt = await store.save(user.id, normalized); return json({ settings: publicIntegrationSettings(input.provider, input.companyId, normalized, updatedAt), message: "Configuração protegida salva. Teste ou sincronize para validar." });
      }
      return json({ error: "not_found", message: "Rota não encontrada." }, 404);
    } catch (error) { const safe = error instanceof IntegrationError ? error : unavailable(); return Response.json({ error: safe.code, message: safe.message }, { status: safe.status, headers }); }
  };
}
