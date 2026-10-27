import { IntegrationError, integrationSlot, normalizeIntegrationInput, parseIntegrationInput, publicIntegrationSettings, type GoogleOAuthDraft, type StoredIntegrationConfig } from "./integration-config";
import type { IntegrationSettings } from "./integration-types";
import type { Provider } from "./workspace-types";

import { credentialsKey, encryptIntegration, decryptIntegration, stateHash, randomOpaque, type Encrypted } from "./integration-crypto";
export { credentialsKey, encryptIntegration, decryptIntegration, stateHash, randomOpaque } from "./integration-crypto";
type CredentialRow = Encrypted & { provider: string; company_id: string; updated_at: string };
type StateRow = Encrypted & { company_id: string; expires_at: number };
export type OAuthStatePayload = { draft: GoogleOAuthDraft; verifier: string; redirectUri: string };
const storeError = () => new IntegrationError("storage_unavailable", "O armazenamento seguro das integrações está indisponível. Tente novamente mais tarde.", 503);
export class IntegrationStore {
  database: D1Database; key: CryptoKey;
  constructor(database: D1Database, key: CryptoKey) { this.database = database; this.key = key; }
  async get(ownerId: string, provider: Provider, companyId: string): Promise<{ config: StoredIntegrationConfig; updatedAt: string } | undefined> {
    integrationSlot(provider, companyId); let row: CredentialRow | null;
    try { row = await this.database.prepare("SELECT provider, company_id, iv, ciphertext, updated_at FROM integration_credentials WHERE owner_id = ? AND provider = ? AND company_id = ?").bind(ownerId, provider, companyId).first<CredentialRow>(); } catch { throw storeError(); }
    if (!row) return undefined;
    const config = await decryptIntegration<StoredIntegrationConfig>(row, this.key, ownerId, provider, companyId);
    if (config.provider !== provider || config.companyId !== companyId || config.id !== `${provider}-${companyId}`) throw storeError();
    return { config, updatedAt: row.updated_at };
  }
  async list(ownerId: string): Promise<StoredIntegrationConfig[]> {
    let rows: CredentialRow[];
    try { rows = (await this.database.prepare("SELECT provider, company_id, iv, ciphertext, updated_at FROM integration_credentials WHERE owner_id = ? ORDER BY provider, company_id").bind(ownerId).all<CredentialRow>()).results; } catch { throw storeError(); }
    return Promise.all(rows.map(async (row) => {
      const slot = integrationSlot(row.provider, row.company_id), config = await decryptIntegration<StoredIntegrationConfig>(row, this.key, ownerId, slot.provider, slot.companyId);
      if (config.id !== `${slot.provider}-${slot.companyId}` || config.provider !== slot.provider || config.companyId !== slot.companyId) throw storeError();
      return config;
    }));
  }
  async save(ownerId: string, config: StoredIntegrationConfig, now = new Date()): Promise<string> {
    integrationSlot(config.provider, config.companyId); if (config.id !== `${config.provider}-${config.companyId}`) throw storeError();
    const encrypted = await encryptIntegration(config, this.key, ownerId, config.provider, config.companyId), updatedAt = now.toISOString();
    try { await this.database.prepare("INSERT INTO integration_credentials (owner_id, provider, company_id, iv, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, provider, company_id) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at").bind(ownerId, config.provider, config.companyId, encrypted.iv, encrypted.ciphertext, updatedAt).run(); } catch { throw storeError(); }
    return updatedAt;
  }
  async disconnect(ownerId: string, provider: Provider, companyId: string): Promise<void> {
    integrationSlot(provider, companyId);
    try { await this.database.batch([
      this.database.prepare("DELETE FROM integration_credentials WHERE owner_id = ? AND provider = ? AND company_id = ?").bind(ownerId, provider, companyId),
      this.database.prepare("DELETE FROM integration_oauth_states WHERE owner_id = ? AND provider = ? AND company_id = ?").bind(ownerId, provider, companyId),
    ]); } catch { throw storeError(); }
  }
  async createOAuthState(ownerId: string, payload: OAuthStatePayload, now = Date.now()): Promise<string> {
    const state = randomOpaque(), hash = await stateHash(state), companyId = payload.draft.companyId; integrationSlot("google", companyId);
    const encrypted = await encryptIntegration(payload, this.key, ownerId, "google", companyId, `oauth:${hash}`);
    try { await this.database.batch([
      this.database.prepare("DELETE FROM integration_oauth_states WHERE expires_at <= ?").bind(now),
      this.database.prepare("DELETE FROM integration_oauth_states WHERE owner_id = ? AND provider = ? AND company_id = ?").bind(ownerId, "google", companyId),
      this.database.prepare("INSERT INTO integration_oauth_states (state_hash, owner_id, provider, company_id, iv, ciphertext, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(hash, ownerId, "google", companyId, encrypted.iv, encrypted.ciphertext, now + 600_000),
    ]); } catch { throw storeError(); }
    return state;
  }
  async consumeOAuthState(ownerId: string, state: string, now = Date.now()): Promise<OAuthStatePayload> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new IntegrationError("invalid_oauth_state", "A autorização expirou ou já foi utilizada. Inicie a conexão novamente.");
    const hash = await stateHash(state); let row: StateRow | null;
    // Atomic claim prevents replay. Retain the claimed row until final commit so disconnect can cancel in-flight OAuth.
    try { row = await this.database.prepare("UPDATE integration_oauth_states SET consumed_at = ? WHERE state_hash = ? AND owner_id = ? AND provider = 'google' AND expires_at > ? AND consumed_at IS NULL RETURNING company_id, iv, ciphertext, expires_at").bind(now, hash, ownerId, now).first<StateRow>(); } catch { throw storeError(); }
    if (!row) throw new IntegrationError("invalid_oauth_state", "A autorização expirou ou já foi utilizada. Inicie a conexão novamente.");
    return decryptIntegration<OAuthStatePayload>(row, this.key, ownerId, "google", row.company_id, `oauth:${hash}`);
  }
  async saveOAuthResult(ownerId: string, state: string, config: StoredIntegrationConfig, now = Date.now()): Promise<void> {
    const hash = await stateHash(state), encrypted = await encryptIntegration(config, this.key, ownerId, config.provider, config.companyId);
    let results: D1Result[];
    try { results = await this.database.batch([
      this.database.prepare("INSERT INTO integration_credentials (owner_id, provider, company_id, iv, ciphertext, updated_at) SELECT ?, ?, ?, ?, ?, ? FROM integration_oauth_states WHERE state_hash = ? AND owner_id = ? AND provider = ? AND company_id = ? AND consumed_at IS NOT NULL AND expires_at > ? ON CONFLICT(owner_id, provider, company_id) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at").bind(ownerId, config.provider, config.companyId, encrypted.iv, encrypted.ciphertext, new Date(now).toISOString(), hash, ownerId, config.provider, config.companyId, now),
      this.database.prepare("DELETE FROM integration_oauth_states WHERE state_hash = ? AND owner_id = ?").bind(hash, ownerId),
    ]); } catch { throw storeError(); }
    if (!results[0]?.meta.changes) throw new IntegrationError("oauth_cancelled", "A autorização foi cancelada ou expirou. Inicie a conexão novamente.");
  }
}
async function runtimeEnvironment(): Promise<Record<string, unknown>> {
  let environment: Record<string, unknown> = typeof process !== "undefined" ? process.env : {};
  try { environment = { ...environment, ...(await import("cloudflare:workers")).env }; } catch { /* Plain Node development. */ }
  return environment;
}
export async function getIntegrationAvailability(): Promise<{ available: boolean; storageReady: boolean; encryptionReady: boolean; message?: string }> {
  const env = await runtimeEnvironment(), storageReady = Boolean(env.DB && typeof (env.DB as D1Database).prepare === "function"); let encryptionReady = true;
  try { await credentialsKey(env.ORBITA_CREDENTIALS_KEY); } catch { encryptionReady = false; }
  return { available: storageReady && encryptionReady, storageReady, encryptionReady, ...(!storageReady || !encryptionReady ? { message: "O armazenamento seguro precisa ser habilitado no servidor." } : {}) };
}
export async function getIntegrationStore(): Promise<IntegrationStore> {
  const env = await runtimeEnvironment(), key = await credentialsKey(env.ORBITA_CREDENTIALS_KEY);
  if (!env.DB || typeof (env.DB as D1Database).prepare !== "function") throw storeError();
  return new IntegrationStore(env.DB as D1Database, key);
}
export async function getUserConnectionConfigs(userId: string): Promise<StoredIntegrationConfig[]> { return (await getIntegrationStore()).list(userId); }
export async function getIntegrationSettings(userId: string, provider: Provider, companyId: string): Promise<IntegrationSettings> { const entry = await (await getIntegrationStore()).get(userId, provider, companyId); return publicIntegrationSettings(provider, companyId, entry?.config, entry?.updatedAt); }
export async function saveIntegration(userId: string, input: unknown): Promise<IntegrationSettings> {
  const body = parseIntegrationInput(input), store = await getIntegrationStore(), prior = await store.get(userId, body.provider, body.companyId);
  const config = normalizeIntegrationInput(body, prior?.config), updatedAt = await store.save(userId, config);
  return publicIntegrationSettings(body.provider, body.companyId, config, updatedAt);
}
