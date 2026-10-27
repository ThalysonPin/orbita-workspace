import { readConnectionConfig, type ServerConnectionConfig } from "./provider-sync";
import type { IntegrationFields, IntegrationInput, IntegrationSettings } from "./integration-types";
import type { Provider } from "./workspace-types";

export class IntegrationError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
export type StoredIntegrationConfig = ServerConnectionConfig & { authMode?: IntegrationFields["authMode"] };
export type GoogleOAuthDraft = { id: string; provider: "google"; companyId: string; label: string; calendarId: string; clientId: string; clientSecret: string; authMode: "oauth" };
const LABELS = { google: "Google Calendar", clickup: "ClickUp", slack: "Slack", discord: "Discord" };
const SECRETS = ["token", "accessToken", "refreshToken", "clientSecret"] as const;
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const invalid = () => new IntegrationError("invalid_configuration", "Confira os campos e as credenciais da integração.");
export function integrationSlot(provider: unknown, companyId: unknown): { provider: Provider; companyId: string } {
  if (typeof provider !== "string" || !Object.hasOwn(LABELS, provider) || typeof companyId !== "string" || !/^company-[123]$/.test(companyId)) throw invalid();
  return { provider: provider as Provider, companyId };
}
export function parseIntegrationInput(value: unknown): IntegrationInput {
  const input = obj(value), slot = integrationSlot(input.provider, input.companyId), fields = obj(input.fields);
  if (!input.fields || typeof input.fields !== "object" || Array.isArray(input.fields)) throw invalid();
  const accepted: IntegrationFields = {};
  for (const key of ["label", "calendarId", "workspaceId", "assigneeId", "channelIds", "channelNames", "guildId", "clientId", ...SECRETS] as const) {
    if (fields[key] === undefined) continue;
    if (typeof fields[key] !== "string" || (fields[key] as string).length > (SECRETS.includes(key as typeof SECRETS[number]) ? 8192 : 2048) || /\u0000/.test(fields[key] as string)) throw invalid();
    accepted[key] = (fields[key] as string).trim();
  }
  if (fields.authMode !== undefined) {
    if (typeof fields.authMode !== "string" || !["oauth", "access_token", "refresh_token"].includes(fields.authMode)) throw invalid();
    accepted.authMode = fields.authMode as IntegrationFields["authMode"];
  }
  return { ...slot, fields: accepted };
}
export async function readIntegrationBody(request: Request): Promise<IntegrationInput> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new IntegrationError("invalid_content_type", "Envie os campos da integração como JSON.", 415);
  if (Number(request.headers.get("content-length")) > 16_384) throw new IntegrationError("body_too_large", "A configuração excedeu o tamanho permitido.", 413);
  const reader = request.body?.getReader(); if (!reader) throw invalid();
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 16_384) { await reader.cancel(); throw new IntegrationError("body_too_large", "A configuração excedeu o tamanho permitido.", 413); } parts.push(part.value); }
    const buffer = new Uint8Array(size); let offset = 0;
    for (const part of parts) { buffer.set(part, offset); offset += part.length; }
    let parsed: unknown; try { parsed = JSON.parse(new TextDecoder().decode(buffer)); } catch { throw invalid(); }
    return parseIntegrationInput(parsed);
  } finally { reader.releaseLock(); }
}
export function verifyIntegrationOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new IntegrationError("invalid_origin", "Abra a configuração pelo próprio painel.", 403);
}
export const INTEGRATION_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "Referrer-Policy": "no-referrer" };
export function integrationErrorResponse(error: unknown): Response {
  const safe = error instanceof IntegrationError ? error : new IntegrationError("integration_unavailable", "Não foi possível acessar a integração. Tente novamente mais tarde.", 503);
  return Response.json({ error: safe.code, message: safe.message }, { status: safe.status, headers: INTEGRATION_HEADERS });
}
export function googleAuthMode(config?: StoredIntegrationConfig): IntegrationFields["authMode"] { return config?.provider === "google" ? config.authMode || (config.refreshToken ? "refresh_token" : "access_token") : undefined; }
function preserved(fields: IntegrationFields, field: typeof SECRETS[number], prior?: StoredIntegrationConfig): string | undefined { const value = fields[field] || obj(prior)[field]; return typeof value === "string" && value ? value : undefined; }
function common(input: IntegrationInput) { return { id: `${input.provider}-${input.companyId}`, provider: input.provider, companyId: input.companyId, label: input.fields.label || LABELS[input.provider] }; }
function channelFields(fields: IntegrationFields) {
  const channelIds = (fields.channelIds || "").split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean);
  let channelNames: Record<string, string> | undefined;
  if (fields.channelNames?.trim()) {
    if (fields.channelNames.trim().startsWith("{")) { try { const parsed: unknown = JSON.parse(fields.channelNames); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid(); channelNames = parsed as Record<string, string>; } catch { throw invalid(); } }
    else { const names = fields.channelNames.split(",").map((entry) => entry.trim()); if (names.length > channelIds.length) throw invalid(); channelNames = Object.fromEntries(names.flatMap((name, index) => name ? [[channelIds[index], name]] : [])); }
  }
  return { channelIds, channelNames };
}
export function normalizeIntegrationInput(value: unknown, prior?: StoredIntegrationConfig): StoredIntegrationConfig {
  const input = parseIntegrationInput(value), fields = input.fields, base = common(input);
  if (prior && (prior.provider !== input.provider || prior.companyId !== input.companyId)) throw invalid();
  let raw: Record<string, unknown> = base; let authMode: IntegrationFields["authMode"];
  if (input.provider === "google") {
    authMode = fields.authMode || googleAuthMode(prior) || (fields.refreshToken ? "refresh_token" : "access_token");
    const old = prior?.provider === "google" ? prior : undefined;
    if (authMode === "access_token") raw = { ...base, calendarId: fields.calendarId || "primary", accessToken: preserved(fields, "accessToken", googleAuthMode(prior) === "access_token" ? prior : undefined) };
    else { const clientId = fields.clientId || old?.clientId, sameClient = old && old.clientId === clientId; raw = { ...base, calendarId: fields.calendarId || "primary", clientId, clientSecret: preserved(fields, "clientSecret", sameClient ? prior : undefined), refreshToken: preserved(fields, "refreshToken", sameClient ? prior : undefined) }; }
  } else if (input.provider === "clickup") raw = { ...base, token: preserved(fields, "token", prior), workspaceId: fields.workspaceId, ...(fields.assigneeId ? { assigneeId: fields.assigneeId } : {}) };
  else raw = { ...base, token: preserved(fields, "token", prior), ...channelFields(fields), ...(input.provider === "discord" ? { guildId: fields.guildId } : {}) };
  try { return { ...readConnectionConfig(JSON.stringify([raw]))[0], ...(authMode ? { authMode } : {}) }; } catch { throw invalid(); }
}
export function normalizeGoogleOAuthDraft(value: unknown, prior?: StoredIntegrationConfig): GoogleOAuthDraft {
  const input = parseIntegrationInput(value); if (input.provider !== "google") throw invalid();
  const old = prior?.provider === "google" && prior.companyId === input.companyId ? prior : undefined;
  const clientId = input.fields.clientId || old?.clientId, clientSecret = preserved(input.fields, "clientSecret", old && old.clientId === clientId ? old : undefined);
  const draft = { ...common(input), provider: "google" as const, calendarId: input.fields.calendarId || "primary", clientId, clientSecret, authMode: "oauth" as const };
  try { readConnectionConfig(JSON.stringify([{ ...draft, accessToken: "validation-only-not-a-credential" }])); } catch { throw invalid(); }
  if (!clientId || !clientSecret) throw new IntegrationError("oauth_client_required", "Informe o Client ID e o Client Secret do Google para autorizar a conta.");
  return draft as GoogleOAuthDraft;
}
export function publicIntegrationSettings(provider: Provider, companyId: string, config?: StoredIntegrationConfig, updatedAt?: string): IntegrationSettings {
  const fields: IntegrationFields = { label: LABELS[provider] };
  if (provider === "google") { fields.calendarId = "primary"; fields.authMode = "oauth"; }
  if (config) {
    fields.label = config.label;
    if (config.provider === "google") { fields.authMode = googleAuthMode(config); fields.calendarId = config.calendarId; fields.clientId = config.clientId; }
    else if (config.provider === "clickup") { fields.workspaceId = config.workspaceId; fields.assigneeId = config.assigneeId; }
    else { fields.channelIds = config.channelIds.join(", "); const names = config.channelIds.map((id) => config.channelNames?.[id] || ""); fields.channelNames = names.some((name) => name.includes(",")) ? JSON.stringify(config.channelNames) : names.join(", "); if (config.provider === "discord") fields.guildId = config.guildId; }
  }
  return { provider, companyId, saved: Boolean(config), fields, secrets: Object.fromEntries(SECRETS.map((key) => [key, Boolean(obj(config)[key])])) as IntegrationSettings["secrets"], ...(updatedAt ? { updatedAt } : {}) };
}
