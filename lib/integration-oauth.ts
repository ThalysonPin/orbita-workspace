import { IntegrationError, normalizeGoogleOAuthDraft, normalizeIntegrationInput, type StoredIntegrationConfig } from "./integration-config";
import { randomOpaque } from "./integration-crypto";
import type { OAuthStatePayload } from "./integration-store";

export type IntegrationOAuthStore = {
  createOAuthState(ownerId: string, payload: OAuthStatePayload, now?: number): Promise<string>;
  consumeOAuthState(ownerId: string, state: string, now?: number): Promise<OAuthStatePayload>;
  saveOAuthResult(ownerId: string, state: string, config: StoredIntegrationConfig, now?: number): Promise<void>;
};

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
export function googleCallbackUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new IntegrationError("invalid_callback_origin", "A autorização do Google exige um endereço HTTPS do painel.");
  return new URL("/api/integrations/google/callback", url.origin).href;
}
export async function startGoogleOAuth(ownerId: string, input: unknown, requestUrl: string, store: IntegrationOAuthStore, prior?: StoredIntegrationConfig, now = Date.now()): Promise<{ authorizationUrl: string; callbackUrl: string }> {
  return startGoogleOAuthWithRedirect(ownerId, input, googleCallbackUrl(requestUrl), store, prior, now);
}
export async function startGoogleOAuthWithRedirect(ownerId: string, input: unknown, callbackUrl: string, store: IntegrationOAuthStore, prior?: StoredIntegrationConfig, now = Date.now()): Promise<{ authorizationUrl: string; callbackUrl: string }> {
  const draft = normalizeGoogleOAuthDraft(input, prior), verifier = randomOpaque(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const state = await store.createOAuthState(ownerId, { draft, verifier, redirectUri: callbackUrl }, now);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: draft.clientId, redirect_uri: callbackUrl, response_type: "code", scope: GOOGLE_CALENDAR_SCOPE, access_type: "offline", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  return { authorizationUrl: url.href, callbackUrl };
}
export async function finishGoogleOAuth(ownerId: string, state: string, code: string | null, providerError: string | null, store: IntegrationOAuthStore, options: { fetch?: typeof fetch; now?: number } = {}): Promise<string> {
  const payload: OAuthStatePayload = await store.consumeOAuthState(ownerId, state, options.now);
  if (providerError) throw new IntegrationError("oauth_denied", "A autorização do Google não foi concluída.");
  if (!code || code.length > 4096 || /[\u0000-\u001f]/.test(code)) throw new IntegrationError("invalid_oauth_code", "O Google não retornou uma autorização válida. Inicie novamente.");
  let result: Record<string, unknown>;
  try {
    const response = await (options.fetch || fetch)("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: payload.draft.clientId, client_secret: payload.draft.clientSecret, redirect_uri: payload.redirectUri, grant_type: "authorization_code", code_verifier: payload.verifier }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("OAuth exchange failed");
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid token response");
    result = parsed as Record<string, unknown>;
  } catch { throw new IntegrationError("oauth_exchange_failed", "Não foi possível concluir a autorização com o Google. Inicie novamente."); }
  if (typeof result.refresh_token !== "string" || !result.refresh_token || typeof result.access_token !== "string" || !result.access_token) throw new IntegrationError("offline_access_required", "O Google não concedeu acesso offline. Autorize novamente com consentimento.");
  if (typeof result.scope === "string" && !result.scope.split(" ").some((scope) => [GOOGLE_CALENDAR_SCOPE, "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar"].includes(scope))) throw new IntegrationError("calendar_scope_required", "A permissão para ler a agenda não foi concedida.");
  const config = normalizeIntegrationInput({ provider: "google", companyId: payload.draft.companyId, fields: { authMode: "oauth", label: payload.draft.label, calendarId: payload.draft.calendarId, clientId: payload.draft.clientId, clientSecret: payload.draft.clientSecret, refreshToken: result.refresh_token } });
  await store.saveOAuthResult(ownerId, state, config, options.now ?? Date.now());
  return config.companyId;
}
