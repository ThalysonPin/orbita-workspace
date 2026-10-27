import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Explicit .ts extensions are required by Node's built-in TypeScript runner.
import { ConfigurationError, getWorkspaceStatus, readConnectionConfig, syncWorkspace } from "../lib/provider-sync.ts";
import type { Company } from "../lib/workspace-types";

const companies: Company[] = [1, 2, 3].map((number) => ({ id: `company-${number}`, name: `Empresa ${number}`, initials: String(number), color: "#ffffff" }));
const now = new Date("2026-10-15T16:00:00.000Z");
const json = (body: unknown, status = 200) => Response.json(body, { status });
const configs = (value: unknown) => readConnectionConfig(JSON.stringify(value));
const base = { id: "test", companyId: "company-1", label: "Teste" };
const google = { ...base, provider: "google", accessToken: "google-test-secret", calendarId: "primary" };
const clickup = { ...base, provider: "clickup", token: "clickup-test-secret", workspaceId: "123" };
const slack = { ...base, provider: "slack", token: "xoxb-test-secret", channelIds: ["C123"] };
const discord = { ...base, provider: "discord", token: "discord-test-secret", channelIds: ["123456"], guildId: "654321" };

test("no configuration returns nine unconfigured sources and no credentials", () => {
  const status = getWorkspaceStatus(readConnectionConfig(), companies);
  assert.equal(status.configured, false);
  assert.equal(status.connections.length, 9);
  assert.ok(status.connections.every((connection) => connection.status === "unconfigured"));
  assert.equal(status.mode, "demo");
});

test("configuration validates IDs, duplicates, company boundaries and bot-only Slack tokens", () => {
  for (const value of ["invalid json", "{}", JSON.stringify([google, google]), JSON.stringify([{ ...clickup, workspaceId: "https://evil.example" }]), JSON.stringify([{ ...slack, token: "xoxp-user-token" }]), JSON.stringify([{ ...discord, guildId: "../other" }]), JSON.stringify([{ ...google, companyId: "unknown" }]), JSON.stringify([{ ...google, refreshToken: "refresh-without-client-id" }])]) {
    assert.throws(() => readConnectionConfig(value), ConfigurationError);
  }
  const status = getWorkspaceStatus(configs([google]), companies);
  assert.equal(status.configured, true);
  assert.equal(status.connections.length, 9);
  assert.doesNotMatch(JSON.stringify(status), /google-test-secret|accessToken/);
});

test("Google refreshes credentials, encodes calendar ID, bounds dates, follows pages and maps events", async () => {
  const calls: URL[] = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(init?.redirect, "error");
    if (url.hostname === "oauth2.googleapis.com") {
      assert.equal(init?.method, "POST");
      assert.equal(new URLSearchParams(String(init.body)).get("refresh_token"), "refresh-test-secret");
      return json({ access_token: "fresh-test-secret" });
    }
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fresh-test-secret");
    assert.equal(url.pathname, "/calendar/v3/calendars/a%40example.com/events");
    assert.equal(url.searchParams.get("timeMin"), "2026-10-08T16:00:00.000Z");
    assert.equal(url.searchParams.get("timeMax"), "2026-11-05T16:00:00.000Z");
    if (!url.searchParams.has("pageToken")) return json({ items: [{ id: "event-1", summary: "Reunião", start: { dateTime: "2026-10-15T09:00:00-04:00" }, end: { dateTime: "2026-10-15T09:30:00-04:00" }, htmlLink: "https://calendar.google.com/calendar/event?eid=123", hangoutLink: "https://meet.google.com/abc-defg-hij" }, { id: "cancelled", status: "cancelled" }], nextPageToken: "next" });
    assert.equal(url.searchParams.get("pageToken"), "next");
    return json({ items: [{ id: "day", summary: "Dia inteiro", start: { date: "2026-10-16" }, end: { date: "2026-10-17" }, htmlLink: "javascript:alert(1)" }] });
  };
  const result = await syncWorkspace(configs([{ ...google, calendarId: "a@example.com", accessToken: undefined, refreshToken: "refresh-test-secret", clientId: "client-test", clientSecret: "client-secret-test" }]), companies, { fetch: fetchMock, now });
  assert.equal(calls.length, 3);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].id, "test:event-1");
  assert.equal(result.events[1].start, "2026-10-16");
  assert.equal(result.events[1].sourceUrl, undefined);
  assert.equal(result.connections.find((connection) => connection.id === "test")?.status, "connected");
  assert.doesNotMatch(JSON.stringify(result), /refresh-test-secret|fresh-test-secret|client-secret-test/);
});

test("ClickUp reads current user's assigned tasks, paginates and preserves no due date", async () => {
  const pages: string[] = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get("Authorization"), "clickup-test-secret");
    if (url.pathname.endsWith("/user")) return json({ user: { id: 42 } });
    assert.equal(url.searchParams.get("assignees[]"), "42");
    assert.equal(url.searchParams.get("include_closed"), "false");
    const page = url.searchParams.get("page")!; pages.push(page);
    return json({ tasks: page === "0" ? Array.from({ length: 100 }, (_, i) => ({ id: `task-${i}`, name: "Entrega", status: { status: "em andamento", type: "custom" }, priority: { id: "2" }, due_date: String(Date.parse("2026-10-16T12:00:00Z")), time_estimate: 3_600_000, list: { name: "Projeto" }, url: "https://app.clickup.com/t/123" })) : [{ id: "without-date", name: "Sem prazo", status: { type: "open" }, due_date: null }] });
  };
  const result = await syncWorkspace(configs([clickup]), companies, { fetch: fetchMock, now });
  assert.deepEqual(pages, ["0", "1"]);
  assert.equal(result.tasks.length, 101);
  assert.equal(result.tasks[0].priority, "high");
  assert.equal(result.tasks[0].status, "in_progress");
  assert.equal(result.tasks[0].estimatedMinutes, 60);
  assert.equal(result.tasks[100].dueDate, "");
});

test("provider failures are redacted and retain completed pages and other sources", async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "www.googleapis.com") {
      if (url.searchParams.get("pageToken")) throw new Error("Token google-test-secret leaked by an upstream exception");
      return json({ items: [{ id: "event", start: { date: "2026-10-15" }, end: { date: "2026-10-16" } }], nextPageToken: "next" });
    }
    if (url.pathname.endsWith("/user")) return json({ user: { id: 42 } });
    return json({ tasks: [] });
  };
  const result = await syncWorkspace(configs([google, { ...clickup, id: "clickup-other", companyId: "company-2" }]), companies, { fetch: fetchMock, now });
  assert.equal(result.events.length, 1);
  assert.equal(result.connections.find((connection) => connection.id === "test")?.status, "error");
  assert.equal(result.connections.find((connection) => connection.id === "clickup-other")?.status, "connected");
  assert.doesNotMatch(JSON.stringify(result), /google-test-secret|upstream exception/);
});

test("Slack paginates history, resolves authors and obtains official message permalinks", async () => {
  let historyCalls = 0;
  let usersCalls = 0;
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://slack.com");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer xoxb-test-secret");
    if (url.pathname.endsWith("conversations.history")) {
      historyCalls++;
      assert.equal(url.searchParams.get("limit"), "15");
      return json({ ok: true, messages: [{ user: "U123", text: historyCalls === 1 ? "Mensagem 1" : "Mensagem 2", ts: historyCalls === 1 ? "1792080000.000001" : "1792080001.000001" }], response_metadata: { next_cursor: historyCalls === 1 ? "next" : "" } });
    }
    if (url.pathname.endsWith("users.info")) { usersCalls++; return json({ ok: true, user: { profile: { display_name: "Marina" } } }); }
    assert.ok(url.pathname.endsWith("chat.getPermalink"));
    return json({ ok: true, permalink: "https://example.slack.com/archives/C123/p1792080000000001" });
  };
  const result = await syncWorkspace(configs([slack]), companies, { fetch: fetchMock, now });
  assert.equal(historyCalls, 2);
  assert.equal(usersCalls, 1);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].author, "Marina");
  assert.equal(result.messages[0].unread, false);
  assert.ok(result.messages[0].sourceUrl?.startsWith("https://example.slack.com/archives/"));
});

test("Discord uses official Bot auth, excludes old messages and preserves accessible channels", async () => {
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://discord.com");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bot discord-test-secret");
    if (url.pathname.includes("999999")) return json({ message: "discord-test-secret forbidden" }, 403);
    return json([{ id: "100001", author: { username: "Lucas", global_name: "Lucas Almeida" }, content: "Olá", timestamp: "2026-10-15T14:00:00Z" }, { id: "100002", content: "Antiga", timestamp: "2026-09-01T14:00:00Z" }]);
  };
  const result = await syncWorkspace(configs([{ ...discord, channelIds: ["123456", "999999"] }]), companies, { fetch: fetchMock, now });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].author, "Lucas Almeida");
  assert.equal(result.messages[0].sourceUrl, "https://discord.com/channels/654321/123456/100001");
  assert.equal(result.connections.find((connection) => connection.id === "test")?.status, "error");
  assert.doesNotMatch(JSON.stringify(result), /discord-test-secret|forbidden/);
});

test("rate limits and malformed provider payloads are explicit safe failures", async () => {
  for (const response of [json({ error: "secret" }, 429), json({ unexpected: "secret" })]) {
    const result = await syncWorkspace(configs([google]), companies, { fetch: async () => response, now });
    assert.equal(result.connections.find((connection) => connection.id === "test")?.status, "error");
    assert.equal(result.events.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  }
});

test("a valid empty Google collection without items is connected and has no fixture events", async () => {
  const result = await syncWorkspace(configs([google]), companies, { fetch: async () => json({ kind: "calendar#events", etag: "collection-etag" }), now });
  assert.deepEqual(result.events, []);
  assert.equal(result.mode, "live");
  assert.equal(result.connections.find((connection) => connection.id === "test")?.status, "connected");
});

test("configured channel names are displayed and unconfigured channel names are rejected", async () => {
  assert.throws(() => configs([{ ...discord, channelNames: { "999999": "Outro canal" } }]), ConfigurationError);
  const result = await syncWorkspace(configs([{ ...discord, channelNames: { "123456": "design" } }]), companies, { fetch: async () => json([{ id: "100001", author: { username: "Lucas" }, content: "Olá", timestamp: now.toISOString() }]), now });
  assert.equal(result.messages[0].channel, "design");
});

test("independent sources run concurrently with at most three active requests", async () => {
  let active = 0;
  let peak = 0;
  const fetchMock: typeof fetch = async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return json({ items: [] });
  };
  const result = await syncWorkspace(configs(Array.from({ length: 6 }, (_, i) => ({ ...google, id: `google-${i}` }))), companies, { fetch: fetchMock, now });
  assert.equal(peak, 3);
  assert.equal(result.connections.filter((connection) => connection.status === "connected").length, 6);
});

test("a configured source cannot reuse another company's reserved connection ID", () => {
  assert.throws(() => configs([{ ...google, id: "google-company-2" }]), ConfigurationError);
  assert.throws(() => configs([{ ...google, id: "slack-company-1" }]), ConfigurationError);
  const status = getWorkspaceStatus(configs([{ ...google, id: "google-company-1" }]), companies);
  assert.equal(new Set(status.connections.map((connection) => connection.id)).size, status.connections.length);
});

test("Slack messages preserve line breaks, decode entities and flatten links, mentions and blocks", async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("conversations.history")) return json({ ok: true, messages: [
      { user: "U123", ts: "1792080000.000001", text: "Oi <@U123> &amp; equipe\nVeja <https://example.com|o projeto> em <#C123|projetos> até <!date^1^{date}|amanhã>. &lt;literal&gt;" },
      { ts: "1792080001.000001", blocks: [{ type: "section", text: { type: "mrkdwn", text: "Conteúdo do bot" } }], attachments: [{ title: "Relatório" }] },
    ] });
    if (url.pathname.endsWith("users.info")) return json({ ok: true, user: { profile: { display_name: "Marina" } } });
    return json({ ok: true, permalink: "https://example.slack.com/archives/C123/p1792080000000001" });
  };
  const result = await syncWorkspace(configs([slack]), companies, { fetch: fetchMock, now });
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages.find((message) => message.author === "Marina")?.body, "Oi @Marina & equipe\nVeja o projeto em #projetos até amanhã. <literal>");
  assert.equal(result.messages.find((message) => message.author === "Bot")?.body, "Conteúdo do bot\nRelatório");
});
