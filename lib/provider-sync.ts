import type { CalendarEvent, Company, Connection, Message, Provider, Task, WorkspaceData } from "./workspace-types";

// Server-only module: never import this file from a client component.
type BaseConfig = { id: string; provider: Provider; companyId: string; label: string };
export type ServerConnectionConfig = BaseConfig & (
  | { provider: "google"; calendarId: string; accessToken?: string; refreshToken?: string; clientId?: string; clientSecret?: string }
  | { provider: "clickup"; token: string; workspaceId: string; assigneeId?: string }
  | { provider: "slack"; token: string; channelIds: string[]; channelNames?: Record<string, string> }
  | { provider: "discord"; token: string; channelIds: string[]; guildId: string; channelNames?: Record<string, string> }
);
type Json = Record<string, unknown>;
type Bucket = { tasks: Task[]; events: CalendarEvent[]; messages: Message[]; warnings: string[] };
export type SyncOptions = { fetch?: typeof fetch; now?: Date; timeoutMs?: number };
type Context = { fetch: typeof fetch; now: Date; timeoutMs: number; deadline: number };
const DAY = 86_400_000;
const MAX_PAGES = 5;
const MAX_CHANNELS = 5;
const PROVIDERS: Provider[] = ["google", "clickup", "slack", "discord"];
const COMPANY_IDS = ["company-1", "company-2", "company-3"];
const DEFAULT_SLOTS = COMPANY_IDS.flatMap((companyId, index) => [
  { id: `google-${companyId}`, provider: "google", companyId, label: "Google Calendar" },
  { id: `clickup-${companyId}`, provider: "clickup", companyId, label: "ClickUp" },
  { id: `${index === 0 ? "slack" : "discord"}-${companyId}`, provider: index === 0 ? "slack" : "discord", companyId, label: index === 0 ? "Slack" : "Discord" },
]);
const API_ORIGINS = new Set(["https://www.googleapis.com", "https://oauth2.googleapis.com", "https://api.clickup.com", "https://slack.com", "https://discord.com"]);

export class ConfigurationError extends Error {
  constructor() { super("A configuração das integrações é inválida. Confira ORBITA_CONNECTIONS_JSON no servidor."); }
}
class ProviderError extends Error {}
const object = (value: unknown): Json => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const str = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const clean = (value: unknown, max = 200): string => str(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
const messageText = (value: unknown): string => str(value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\t/g, " ").slice(0, 6000);
const identifier = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const secret = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 8192 && !/[\r\n\u0000]/.test(value);
const optionalSecret = (value: unknown): boolean => value === undefined || secret(value);

/** Validate only server configuration. A request body can never supply credentials or URLs. */
export function readConnectionConfig(raw?: string, googleDefaults: { clientId?: string; clientSecret?: string } = {}): ServerConnectionConfig[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ConfigurationError(); }
  if (!Array.isArray(parsed) || parsed.length > 18) throw new ConfigurationError();
  const used = new Set<string>();
  return parsed.map((entry) => {
    const item = object(entry);
    if (!identifier(item.id, /^[a-zA-Z0-9_-]{1,64}$/) || used.has(item.id) || !PROVIDERS.includes(item.provider as Provider) || !COMPANY_IDS.includes(str(item.companyId)) || typeof item.label !== "string" || item.label.length < 1 || item.label.length > 80 || /[\u0000-\u001f]/.test(item.label)) throw new ConfigurationError();
    const reservedSlot = DEFAULT_SLOTS.find((slot) => slot.id === item.id);
    if (reservedSlot && (reservedSlot.provider !== item.provider || reservedSlot.companyId !== item.companyId)) throw new ConfigurationError();
    used.add(item.id);
    const base = { id: item.id, provider: item.provider as Provider, companyId: str(item.companyId), label: item.label };
    if (item.provider === "google") {
      const clientId = item.clientId ?? googleDefaults.clientId;
      const clientSecret = item.clientSecret ?? googleDefaults.clientSecret;
      if (!identifier(item.calendarId, /^[^\u0000-\u0020\u007f]{1,254}$/) || !optionalSecret(item.accessToken) || !optionalSecret(item.refreshToken) || !optionalSecret(clientId) || !optionalSecret(clientSecret) || (item.refreshToken !== undefined && !(secret(clientId) && secret(clientSecret))) || !(secret(item.accessToken) || (secret(item.refreshToken) && secret(clientId) && secret(clientSecret)))) throw new ConfigurationError();
      return { ...base, provider: "google", calendarId: item.calendarId, accessToken: item.accessToken as string | undefined, refreshToken: item.refreshToken as string | undefined, clientId: clientId as string | undefined, clientSecret: clientSecret as string | undefined };
    }
    if (!secret(item.token)) throw new ConfigurationError();
    if (item.provider === "clickup") {
      if (!identifier(item.workspaceId, /^\d{1,24}$/) || (item.assigneeId !== undefined && !identifier(item.assigneeId, /^\d{1,24}$/))) throw new ConfigurationError();
      return { ...base, provider: "clickup", token: item.token, workspaceId: item.workspaceId, assigneeId: item.assigneeId as string | undefined };
    }
    const channelPattern = item.provider === "slack" ? /^[CG][A-Z0-9]{2,32}$/ : /^\d{5,24}$/;
    if (!Array.isArray(item.channelIds) || item.channelIds.length < 1 || item.channelIds.length > MAX_CHANNELS || !item.channelIds.every((id) => identifier(id, channelPattern)) || new Set(item.channelIds).size !== item.channelIds.length) throw new ConfigurationError();
    let channelNames: Record<string, string> | undefined;
    if (item.channelNames !== undefined) {
      if (item.channelNames === null || typeof item.channelNames !== "object" || Array.isArray(item.channelNames)) throw new ConfigurationError();
      const names = Object.entries(item.channelNames);
      if (!names.every(([key, name]) => (item.channelIds as string[]).includes(key) && typeof name === "string" && name.length > 0 && name.length <= 80 && !/[\u0000-\u001f]/.test(name))) throw new ConfigurationError();
      channelNames = Object.fromEntries(names) as Record<string, string>;
    }
    if (item.provider === "slack") {
      if (!item.token.startsWith("xoxb-")) throw new ConfigurationError();
      return { ...base, provider: "slack", token: item.token, channelIds: item.channelIds as string[], channelNames };
    }
    // Official bot tokens only. No user token, self-bot, or browser session support.
    if (!identifier(item.guildId, /^\d{5,24}$/) || item.token.startsWith("Bot ") || item.token.startsWith("mfa.")) throw new ConfigurationError();
    return { ...base, provider: "discord", token: item.token, channelIds: item.channelIds as string[], guildId: item.guildId, channelNames };
  });
}

/** Workers secrets in deployment; ignored environment files during local development. */
export async function readRuntimeConnections(): Promise<ServerConnectionConfig[]> {
  let environment: Record<string, unknown> = typeof process !== "undefined" ? process.env : {};
  try {
    const worker = await import("cloudflare:workers");
    environment = { ...environment, ...worker.env };
  } catch { /* A plain Node test/server has no Workers module. */ }
  return readConnectionConfig(typeof environment.ORBITA_CONNECTIONS_JSON === "string" ? environment.ORBITA_CONNECTIONS_JSON : undefined, {
    clientId: typeof environment.ORBITA_GOOGLE_CLIENT_ID === "string" ? environment.ORBITA_GOOGLE_CLIENT_ID : undefined,
    clientSecret: typeof environment.ORBITA_GOOGLE_CLIENT_SECRET === "string" ? environment.ORBITA_GOOGLE_CLIENT_SECRET : undefined,
  });
}

export function getWorkspaceStatus(configs: ServerConnectionConfig[], companies: Company[]) {
  const defaults: Connection[] = DEFAULT_SLOTS.filter((slot) => companies.some((company) => company.id === slot.companyId)).map((slot) => ({ ...slot, provider: slot.provider as Provider, status: "unconfigured" }));
  const connections = defaults.filter((entry) => !configs.some((config) => config.provider === entry.provider && config.companyId === entry.companyId));
  for (const config of configs) connections.push({ id: config.id, provider: config.provider, companyId: config.companyId, label: config.label, status: "unconfigured", detail: "Credencial cadastrada no servidor; sincronize para validar." });
  return { configured: configs.length > 0, mode: configs.length ? "live" as const : "demo" as const, connections };
}

function safeError(error: unknown): string {
  // Never serialize provider response bodies, request URLs, or arbitrary exception messages.
  if (error instanceof ProviderError) return error.message;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "O serviço demorou a responder. Tente sincronizar novamente.";
  return "Não foi possível ler este serviço. Verifique a conexão e tente novamente.";
}
async function requestJson(url: URL, headers: HeadersInit, context: Context, body?: URLSearchParams): Promise<unknown> {
  if (!API_ORIGINS.has(url.origin)) throw new ProviderError("Destino de integração inválido.");
  const remaining = context.deadline - Date.now();
  if (remaining <= 0) throw new ProviderError("A sincronização excedeu o tempo disponível. Os dados parciais foram mantidos; tente novamente.");
  const response = await context.fetch(url, { method: body ? "POST" : "GET", headers, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(context.timeoutMs, remaining))) });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new ProviderError("Acesso recusado. Revise a credencial e as permissões desta integração.");
    if (response.status === 429) throw new ProviderError("Limite de consultas atingido. Aguarde antes de sincronizar novamente.");
    throw new ProviderError("O serviço retornou um erro. Tente novamente mais tarde.");
  }
  try { return await response.json(); } catch { throw new ProviderError("O serviço retornou uma resposta inválida."); }
}
function allowedUrl(value: unknown, domains: string[]): string | undefined {
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : undefined; } catch { return undefined; }
}
function iso(value: unknown): string {
  const date = new Date(typeof value === "number" ? value : str(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
function requireArray(value: unknown): Json[] {
  if (!Array.isArray(value)) throw new ProviderError("O serviço retornou dados em um formato inesperado.");
  return list(value);
}

async function concurrent<T>(items: T[], limit: number, action: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (next < items.length) { const item = items[next++]; await action(item); }
  }));
}

async function syncGoogle(config: Extract<ServerConnectionConfig, { provider: "google" }>, output: Bucket, context: Context) {
  let token = config.accessToken;
  if (config.refreshToken) {
    const refreshed = object(await requestJson(new URL("https://oauth2.googleapis.com/token"), { "Content-Type": "application/x-www-form-urlencoded" }, context, new URLSearchParams({ grant_type: "refresh_token", refresh_token: config.refreshToken, client_id: config.clientId!, client_secret: config.clientSecret! })));
    token = str(refreshed.access_token);
  }
  if (!token) throw new ProviderError("A credencial do Google expirou. Reautorize a integração.");
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events`);
    url.search = new URLSearchParams({ timeMin: new Date(context.now.getTime() - 7 * DAY).toISOString(), timeMax: new Date(context.now.getTime() + 21 * DAY).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", ...(pageToken ? { pageToken } : {}) }).toString();
    const result = object(await requestJson(url, { Authorization: `Bearer ${token}` }, context));
    // Empty Calendar event collections may omit `items`, but still identify as a collection.
    const items = result.items === undefined && (result.kind === "calendar#events" || typeof result.etag === "string") ? [] : requireArray(result.items);
    for (const event of items) {
      const start = object(event.start), end = object(event.end);
      if (!event.id || event.status === "cancelled" || !(start.dateTime || start.date) || !(end.dateTime || end.date)) continue;
      const startValue = str(start.dateTime || start.date), endValue = str(end.dateTime || end.date);
      if (!Number.isFinite(Date.parse(startValue)) || !Number.isFinite(Date.parse(endValue))) continue;
      output.events.push({ id: `${config.id}:${clean(event.id)}`, companyId: config.companyId, source: "google", title: clean(event.summary || "Evento sem título", 400), start: startValue, end: endValue, sourceUrl: allowedUrl(event.htmlLink, ["google.com"]), meetingUrl: allowedUrl(event.hangoutLink || object(list(object(event.conferenceData).entryPoints).find((point) => point.entryPointType === "video")).uri, ["google.com", "zoom.us", "microsoft.com", "teams.live.com"]), location: clean(event.location, 300) || undefined, attendees: list(event.attendees).slice(0, 20).map((person) => clean(person.displayName || person.email, 120)).filter(Boolean) });
    }
    pageToken = str(result.nextPageToken);
    if (!pageToken) return;
  }
  output.warnings.push("Agenda parcial: limite de 1.250 eventos por sincronização atingido.");
}

async function syncClickUp(config: Extract<ServerConnectionConfig, { provider: "clickup" }>, output: Bucket, context: Context) {
  const headers = { Authorization: config.token };
  const userId = config.assigneeId || str(object(object(await requestJson(new URL("https://api.clickup.com/api/v2/user"), headers, context)).user).id);
  if (!/^\d+$/.test(userId)) throw new ProviderError("Não foi possível identificar o responsável pelas tarefas no ClickUp.");
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`https://api.clickup.com/api/v2/team/${encodeURIComponent(config.workspaceId)}/task`);
    url.search = new URLSearchParams({ page: String(page), "assignees[]": userId, include_closed: "false", subtasks: "true", order_by: "due_date" }).toString();
    const result = object(await requestJson(url, headers, context));
    const tasks = requireArray(result.tasks);
    for (const task of tasks) {
      if (!task.id) continue;
      const status = object(task.status), priority = str(object(task.priority).priority || object(task.priority).id).toLowerCase();
      const due = task.due_date ? iso(Number(task.due_date)) : "";
      const estimate = Number(task.time_estimate);
      output.tasks.push({ id: `${config.id}:${clean(task.id)}`, title: clean(task.name || "Tarefa sem título", 400), companyId: config.companyId, source: "clickup", status: /done|closed/.test(str(status.type)) ? "done" : /progress|andamento|doing|active|em curso/i.test(str(status.status)) ? "in_progress" : "todo", priority: /^(1|2|urgent|high)$/.test(priority) ? "high" : /^(4|low)$/.test(priority) ? "low" : "medium", dueDate: due ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Campo_Grande", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(due)) : "", project: clean(object(task.list).name || object(task.project).name || "ClickUp", 150), sourceUrl: allowedUrl(task.url, ["clickup.com"]), estimatedMinutes: Number.isFinite(estimate) && estimate > 0 ? Math.ceil(estimate / 60_000) : undefined });
    }
    if (tasks.length === 0 || result.last_page === true || (result.last_page === undefined && tasks.length < 100)) return;
  }
  output.warnings.push("ClickUp parcial: limite de 500 tarefas por conexão atingido.");
}

async function slackRequest(method: string, params: Record<string, string>, token: string, context: Context): Promise<Json> {
  const url = new URL(`https://slack.com/api/${method}`);
  url.search = new URLSearchParams(params).toString();
  const result = object(await requestJson(url, { Authorization: `Bearer ${token}` }, context));
  if (result.ok !== true) {
    const code = str(result.error);
    if (["invalid_auth", "token_revoked", "token_expired", "missing_scope", "not_in_channel", "channel_not_found", "not_allowed_token_type"].includes(code)) throw new ProviderError("O Slack recusou a leitura. Confira o token do bot, os escopos e a participação no canal.");
    if (code === "ratelimited") throw new ProviderError("Limite de consultas do Slack atingido. Aguarde antes de sincronizar novamente.");
    throw new ProviderError("Não foi possível ler esta informação do Slack.");
  }
  return result;
}

function slackBody(message: Json): string {
  if (typeof message.text === "string" && message.text) return message.text;
  const fragments: string[] = [];
  // A bounded walk extracts common Block Kit text; it never renders HTML.
  function visit(value: unknown, depth = 0) {
    if (depth > 6 || fragments.length >= 60) return;
    if (Array.isArray(value)) { for (const entry of value.slice(0, 30)) visit(entry, depth + 1); return; }
    const entry = object(value);
    if (typeof entry.text === "string") fragments.push(entry.text);
    else if (entry.text) visit(entry.text, depth + 1);
    if (entry.elements) visit(entry.elements, depth + 1);
    if (entry.fields) visit(entry.fields, depth + 1);
    if (entry.type === "user" && entry.user_id) fragments.push(`<@${str(entry.user_id)}>`);
    if (entry.type === "channel" && entry.channel_id) fragments.push(`<#${str(entry.channel_id)}>`);
    if (entry.type === "link" && !entry.text && entry.url) fragments.push(str(entry.url));
  }
  visit(message.blocks);
  for (const attachment of list(message.attachments).slice(0, 10)) {
    fragments.push(str(attachment.pretext), str(attachment.title), str(attachment.text || attachment.fallback));
    visit(attachment.blocks);
  }
  for (const file of list(message.files).slice(0, 10)) fragments.push(str(file.title || file.name));
  return fragments.filter(Boolean).join("\n") || "Mensagem sem texto disponível";
}

function readableSlackText(value: string, users: Map<string, string>, channelNames?: Record<string, string>): string {
  const text = value.replace(/<([^>]+)>/g, (_match, body: string) => {
    const [target, ...labels] = body.split("|");
    const label = labels.join("|");
    if (target.startsWith("@")) return `@${users.get(target.slice(1)) || label || target.slice(1)}`;
    if (target.startsWith("#")) return `#${label || channelNames?.[target.slice(1)] || target.slice(1)}`;
    if (target.startsWith("!date^")) return label || "Data";
    if (/^!(here|channel|everyone)$/.test(target)) return `@${target.slice(1)}`;
    if (target.startsWith("!subteam^")) return `@${label || target.slice(9)}`;
    if (/^(https?:\/\/|mailto:)/.test(target)) return label || target.replace(/^mailto:/, "");
    return label || target;
  });
  return messageText(text.replace(/&(amp|lt|gt);/g, (_match, entity: string) => ({ amp: "&", lt: "<", gt: ">" })[entity]!));
}

async function syncSlack(config: Extract<ServerConnectionConfig, { provider: "slack" }>, output: Bucket, context: Context) {
  const users = new Map<string, string>();
  const pending: { channelId: string; message: Json }[] = [];
  for (const channelId of config.channelIds) {
    if (pending.length >= 30) { output.warnings.push("Histórico do Slack parcial: limite total de 30 mensagens por conexão atingido."); break; }
    try {
      let cursor = "";
      for (let page = 0; page < 2; page++) {
        const result = await slackRequest("conversations.history", { channel: channelId, oldest: String((context.now.getTime() - 7 * DAY) / 1000), limit: "15", ...(cursor ? { cursor } : {}) }, config.token, context);
        for (const message of requireArray(result.messages)) {
          const ts = str(message.ts);
          if (!/^\d+\.\d+$/.test(ts) || (!message.text && !message.files && !message.blocks && !message.attachments)) continue;
          if (pending.length < 30) pending.push({ channelId, message });
        }
        cursor = str(object(result.response_metadata).next_cursor);
        if (!cursor && result.has_more !== true) break;
        if (!cursor || page === 1 || pending.length >= 30) output.warnings.push("Histórico do Slack parcial: no máximo 30 mensagens recentes por conexão em cada sincronização.");
        if (pending.length >= 30) break;
        if (!cursor) break;
      }
    } catch (error) { output.warnings.push(safeError(error)); }
  }
  const authorIds = [...new Set(pending.flatMap(({ message }) => [str(message.user), ...Array.from(slackBody(message).matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g), (match) => match[1])]).filter(Boolean))];
  if (authorIds.length > 20) output.warnings.push("Alguns autores do Slack são exibidos pelo identificador; limite de 20 consultas de perfis.");
  await concurrent(authorIds.slice(0, 20), 4, async (authorId) => {
    try {
      const profile = object((await slackRequest("users.info", { user: authorId }, config.token, context)).user);
      users.set(authorId, clean(object(profile.profile).display_name || profile.real_name || profile.name || authorId, 120));
    } catch { users.set(authorId, authorId); output.warnings.push("Alguns nomes do Slack não puderam ser resolvidos; os identificadores foram mantidos."); }
  });
  await concurrent(pending, 4, async ({ channelId, message }) => {
    const ts = str(message.ts), authorId = str(message.user);
    let sourceUrl: string | undefined;
    try {
      sourceUrl = allowedUrl((await slackRequest("chat.getPermalink", { channel: channelId, message_ts: ts }, config.token, context)).permalink, ["slack.com"]);
      if (!sourceUrl) output.warnings.push("Alguns links de mensagens do Slack são inválidos e foram omitidos.");
    } catch { output.warnings.push("Alguns links de mensagens do Slack não puderam ser consultados."); }
    const timestamp = iso(Number(ts) * 1000);
    if (!timestamp) return;
    output.messages.push({ id: `${config.id}:${channelId}:${ts}`, companyId: config.companyId, source: "slack", channel: config.channelNames?.[channelId] || channelId, author: users.get(authorId) || clean(message.username || authorId || "Bot", 120), body: readableSlackText(slackBody(message), users, config.channelNames), timestamp, unread: false, sourceUrl });
  });
}

async function syncDiscord(config: Extract<ServerConnectionConfig, { provider: "discord" }>, output: Bucket, context: Context) {
  for (const channelId of config.channelIds) {
    try {
      let before = "";
      for (let page = 0; page < 2; page++) {
        const url = new URL(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`);
        url.search = new URLSearchParams({ limit: "50", ...(before ? { before } : {}) }).toString();
        const messages = requireArray(await requestJson(url, { Authorization: `Bot ${config.token}` }, context));
        let reachedWindow = false;
        for (const message of messages) {
          if (!/^\d+$/.test(str(message.id))) continue;
          const timestamp = iso(message.timestamp);
          if (!timestamp) continue;
          if (Date.parse(timestamp) < context.now.getTime() - 7 * DAY) { reachedWindow = true; continue; }
          const author = object(message.author);
          const attachments = list(message.attachments).map((file) => clean(file.filename, 200)).join(", ");
          const body = messageText(message.content || attachments || "Conteúdo indisponível nesta mensagem");
          if (!message.content && !attachments) output.warnings.push("Há conteúdo indisponível no Discord. Confira Message Content Intent e os tipos das mensagens.");
          output.messages.push({ id: `${config.id}:${channelId}:${str(message.id)}`, companyId: config.companyId, source: "discord", channel: config.channelNames?.[channelId] || channelId, author: clean(object(message.member).nick || author.global_name || author.username || "Participante", 120), body, timestamp, unread: false, sourceUrl: `https://discord.com/channels/${config.guildId}/${channelId}/${encodeURIComponent(str(message.id))}` });
        }
        if (messages.length < 50 || reachedWindow) break;
        before = str(messages.at(-1)?.id);
        if (page === 1) output.warnings.push("Histórico do Discord parcial: no máximo 100 mensagens recentes por canal em cada sincronização.");
      }
    } catch (error) { output.warnings.push(safeError(error)); }
  }
}

/** Read-only provider sync. Failures retain successfully mapped pages and other sources. */
export async function syncWorkspace(configs: ServerConnectionConfig[], companies: Company[], options: SyncOptions = {}): Promise<WorkspaceData> {
  const context: Context = { fetch: options.fetch || fetch, now: options.now || new Date(), timeoutMs: options.timeoutMs || 10_000, deadline: Date.now() + 25_000 };
  const result: WorkspaceData = { companies, tasks: [], events: [], messages: [], connections: getWorkspaceStatus(configs, companies).connections, mode: "live", syncedAt: context.now.toISOString() };
  // Independent sources run in a bounded pool; no waiting/retry loops on rate limits.
  await concurrent(configs, 3, async (config) => {
    const output: Bucket = { tasks: [], events: [], messages: [], warnings: [] };
    try {
      if (config.provider === "google") await syncGoogle(config, output, context);
      else if (config.provider === "clickup") await syncClickUp(config, output, context);
      else if (config.provider === "slack") await syncSlack(config, output, context);
      else await syncDiscord(config, output, context);
    } catch (error) { output.warnings.push(safeError(error)); }
    result.tasks.push(...output.tasks); result.events.push(...output.events); result.messages.push(...output.messages);
    const connection = result.connections.find((entry) => entry.id === config.id)!;
    connection.status = output.warnings.length ? "error" : "connected";
    connection.detail = output.warnings.length ? [...new Set(output.warnings)].join(" ") : "Leitura concluída. Alterações no painel não são enviadas ao serviço.";
    if (!output.warnings.length || output.tasks.length || output.events.length || output.messages.length) connection.lastSync = context.now.toISOString();
  });
  result.tasks = [...new Map(result.tasks.map((task) => [task.id, task])).values()];
  result.events = [...new Map(result.events.map((event) => [event.id, event])).values()].sort((a, b) => a.start.localeCompare(b.start));
  result.messages = [...new Map(result.messages.map((message) => [message.id, message])).values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return result;
}
