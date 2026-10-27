import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";

// Production imports remain conventional extensionless TS; Node's test loader resolves them.
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) { try { return next(`${specifier}.ts`, context); } catch { /* Continue normal resolution. */ } }
  return next(specifier, context);
} });
// @ts-expect-error Node's built-in TypeScript runner requires explicit .ts extensions.
const { IntegrationStore, credentialsKey, encryptIntegration, decryptIntegration, stateHash } = await import("../lib/integration-store.ts");
// @ts-expect-error Node's built-in TypeScript runner requires explicit .ts extensions.
const { IntegrationError, normalizeIntegrationInput, normalizeGoogleOAuthDraft, publicIntegrationSettings, readIntegrationBody, verifyIntegrationOrigin, integrationErrorResponse } = await import("../lib/integration-config.ts");
// @ts-expect-error Node's built-in TypeScript runner requires explicit .ts extensions.
const { startGoogleOAuth, finishGoogleOAuth, googleCallbackUrl, GOOGLE_CALENDAR_SCOPE } = await import("../lib/integration-oauth.ts");

const keyString = Buffer.alloc(32, 7).toString("base64");
const clickupInput = { provider: "clickup", companyId: "company-1", fields: { label: "ClickUp", workspaceId: "123", token: "private-clickup-token" } };
const googleInput = { provider: "google", companyId: "company-2", fields: { authMode: "oauth", label: "Agenda", calendarId: "primary", clientId: "google-client-id", clientSecret: "private-client-secret" } };
const epoch = Date.parse("2026-10-16T12:00:00.000Z");
function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of readdirSync(new URL("../drizzle/", import.meta.url)).filter((file) => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  const db = { prepare(sql: string) {
    let bindings: (string | number | null)[] = [];
    const statement = { bind(...values: (string | number | null)[]) { bindings = values; return statement; },
      async first<T>() { return (sqlite.prepare(sql).get(...bindings) || null) as T | null; },
      async all<T>() { return { results: sqlite.prepare(sql).all(...bindings) as T[] }; },
      async run() { const result = sqlite.prepare(sql).run(...bindings); return { meta: { changes: Number(result.changes) } }; },
    }; return statement;
  }, async batch(statements: { run(): Promise<unknown> }[]) { const results = []; sqlite.exec("BEGIN"); try { for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
  return { sqlite, db: db as unknown as D1Database };
}
async function store() { const data = database(); return { ...data, store: new IntegrationStore(data.db, await credentialsKey(keyString)) }; }

test("AES-GCM has fresh IVs and rejects tampering, wrong owner, company and key", async () => {
  const key = await credentialsKey(keyString), config = normalizeIntegrationInput(clickupInput);
  const first = await encryptIntegration(config, key, "alice", "clickup", "company-1"), second = await encryptIntegration(config, key, "alice", "clickup", "company-1");
  assert.notEqual(first.iv, second.iv); assert.equal(Buffer.from(first.iv, "base64").length, 12);
  assert.doesNotMatch(JSON.stringify(first), /private-clickup-token|workspaceId/);
  assert.deepEqual(await decryptIntegration(first, key, "alice", "clickup", "company-1"), JSON.parse(JSON.stringify(config)));
  await assert.rejects(decryptIntegration(first, key, "bob", "clickup", "company-1"), IntegrationError);
  await assert.rejects(decryptIntegration(first, key, "alice", "clickup", "company-2"), IntegrationError);
  const modified = Buffer.from(first.ciphertext, "base64"); modified[0] ^= 1;
  await assert.rejects(decryptIntegration({ ...first, ciphertext: modified.toString("base64") }, key, "alice", "clickup", "company-1"), IntegrationError);
  await assert.rejects(decryptIntegration(first, await credentialsKey(Buffer.alloc(32, 8).toString("base64")), "alice", "clickup", "company-1"), IntegrationError);
  for (const invalid of [undefined, "short", Buffer.alloc(31).toString("base64")]) await assert.rejects(credentialsKey(invalid), IntegrationError);
});

test("D1 SQL persists encrypted credentials with actual owner isolation and scoped delete", async () => {
  const data = await store(), config = normalizeIntegrationInput(clickupInput); if (config.provider !== "clickup") throw new Error("Expected ClickUp config");
  await data.store.save("alice", config); await data.store.save("bob", { ...config, token: "bobs-private-token" });
  assert.equal((await data.store.get("alice", "clickup", "company-1"))?.config.provider, "clickup");
  assert.equal((await data.store.list("bob")).length, 1); assert.equal((await data.store.list("charlie")).length, 0);
  const rows = data.sqlite.prepare("SELECT * FROM integration_credentials").all();
  assert.doesNotMatch(JSON.stringify(rows), /private-clickup-token|bobs-private-token/);
  await data.store.disconnect("alice", "clickup", "company-1");
  assert.equal(await data.store.get("alice", "clickup", "company-1"), undefined);
  assert.equal((await data.store.list("bob")).length, 1);
});

test("blank edits preserve relevant secrets while unknown fields and old auth modes are cleared", () => {
  assert.throws(() => normalizeGoogleOAuthDraft({ ...googleInput, fields: { ...googleInput.fields, authMode: ["oauth"] } }), IntegrationError);
  const prior = normalizeIntegrationInput(clickupInput);
  const edit = normalizeIntegrationInput({ ...clickupInput, fields: { token: "", workspaceId: "456", label: "Novo", arbitrarySecret: "must-drop" } }, prior);
  assert.equal(edit.provider === "clickup" ? edit.token : "", "private-clickup-token");
  assert.equal("arbitrarySecret" in edit, false); assert.equal(edit.id, "clickup-company-1");
  assert.throws(() => normalizeIntegrationInput({ ...clickupInput, fields: { workspaceId: "123", token: "" } }), IntegrationError);
  const refresh = normalizeIntegrationInput({ ...googleInput, fields: { ...googleInput.fields, authMode: "refresh_token", refreshToken: "private-refresh" } });
  const access = normalizeIntegrationInput({ ...googleInput, fields: { authMode: "access_token", accessToken: "private-access" } }, refresh);
  assert.equal(access.provider === "google" && access.refreshToken, undefined);
  assert.equal(access.provider === "google" && access.clientSecret, undefined);
  assert.equal(access.provider === "google" && access.clientId, undefined);
  assert.throws(() => normalizeIntegrationInput({ ...googleInput, fields: { authMode: "refresh_token", clientId: "different-client", refreshToken: "", clientSecret: "" } }, refresh), IntegrationError);
  const metadata = publicIntegrationSettings("google", "company-2", refresh);
  assert.equal(metadata.secrets.refreshToken, true); assert.equal(metadata.fields.authMode, "refresh_token");
  assert.doesNotMatch(JSON.stringify(metadata), /private-refresh|private-client-secret/);
  const channels = normalizeIntegrationInput({ provider: "discord", companyId: "company-3", fields: { token: "bot-token", guildId: "123456", channelIds: "234567, 345678", channelNames: "geral, projetos" } });
  assert.deepEqual(channels.provider === "discord" && channels.channelNames, { "234567": "geral", "345678": "projetos" });
});

test("bounded request parser enforces origin, JSON type, body size and sanitized errors", async () => {
  const request = (body: string, type = "application/json") => new Request("https://orbita.example/api/integrations", { method: "POST", headers: { "Content-Type": type, Origin: "https://orbita.example" }, body });
  verifyIntegrationOrigin(request("{}"));
  assert.throws(() => verifyIntegrationOrigin(new Request("https://orbita.example/api/integrations", { headers: { Origin: "https://evil.example" } })), IntegrationError);
  assert.deepEqual(await readIntegrationBody(request(JSON.stringify(clickupInput))), clickupInput);
  await assert.rejects(readIntegrationBody(request("x".repeat(17_000))), (error: unknown) => error instanceof IntegrationError && error.status === 413);
  await assert.rejects(readIntegrationBody(request("{}", "text/plain")), IntegrationError);
  const response = integrationErrorResponse(new Error("private-client-secret raw upstream error"));
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private-client-secret|raw upstream/);
});

test("OAuth state is encrypted, owner-bound, expiring and atomically single-use", async () => {
  const data = await store(), draft = normalizeGoogleOAuthDraft(googleInput);
  const state = await data.store.createOAuthState("alice", { draft, verifier: "private-verifier", redirectUri: "https://orbita.example/api/integrations/google/callback" }, epoch);
  assert.equal(state.length, 43);
  const row = data.sqlite.prepare("SELECT * FROM integration_oauth_states WHERE state_hash = ?").get(await stateHash(state));
  assert.ok(row); assert.doesNotMatch(JSON.stringify(row), /private-verifier|private-client-secret|google-client-id/);
  await assert.rejects(data.store.consumeOAuthState("bob", state, epoch + 1), IntegrationError);
  const competing = await Promise.allSettled([data.store.consumeOAuthState("alice", state, epoch + 2), data.store.consumeOAuthState("alice", state, epoch + 2)]);
  assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(competing.filter((result) => result.status === "rejected").length, 1);
  const expired = await data.store.createOAuthState("alice", { draft, verifier: "private-verifier", redirectUri: "https://orbita.example/callback" }, epoch);
  await assert.rejects(data.store.consumeOAuthState("alice", expired, epoch + 600_000), IntegrationError);
});

test("Google OAuth uses PKCE and official endpoints and saves only after a successful mocked exchange", async () => {
  const data = await store();
  const start = await startGoogleOAuth("alice", googleInput, "https://orbita.example/api/integrations/google/start", data.store, undefined, epoch);
  const authorization = new URL(start.authorizationUrl);
  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.searchParams.get("scope"), GOOGLE_CALENDAR_SCOPE);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("access_type"), "offline");
  assert.equal(authorization.searchParams.get("prompt"), "consent");
  assert.doesNotMatch(start.authorizationUrl, /private-client-secret|private-verifier/);
  let calls = 0;
  const fetchMock: typeof fetch = async (url, init) => {
    calls++; assert.equal(String(url), "https://oauth2.googleapis.com/token"); assert.equal(init?.redirect, "error");
    const body = new URLSearchParams(String(init?.body)); assert.equal(body.get("client_secret"), "private-client-secret"); assert.equal(body.get("redirect_uri"), start.callbackUrl);
    const verifier = body.get("code_verifier")!;
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
    assert.equal(challenge, authorization.searchParams.get("code_challenge"));
    return Response.json({ access_token: "private-access", refresh_token: "private-refresh", scope: GOOGLE_CALENDAR_SCOPE, token_type: "Bearer" });
  };
  const state = authorization.searchParams.get("state")!;
  assert.equal(await finishGoogleOAuth("alice", state, "authorization-code", null, data.store, { fetch: fetchMock, now: epoch + 1 }), "company-2");
  assert.equal(calls, 1);
  assert.equal((await data.store.get("alice", "google", "company-2"))?.config.authMode, "oauth");
  await assert.rejects(finishGoogleOAuth("alice", state, "authorization-code", null, data.store, { fetch: fetchMock, now: epoch + 2 }), IntegrationError); assert.equal(calls, 1);
  const failure = await startGoogleOAuth("alice", googleInput, "https://orbita.example", data.store, undefined, epoch + 3);
  await assert.rejects(finishGoogleOAuth("alice", new URL(failure.authorizationUrl).searchParams.get("state")!, "code", null, data.store, { fetch: async () => Response.json({ error: "private-upstream-secret" }, { status: 400 }), now: epoch + 4 }), IntegrationError);
  assert.equal((await data.store.get("alice", "google", "company-2"))?.config.provider, "google");
  assert.throws(() => googleCallbackUrl("http://untrusted.example"), IntegrationError);
});

test("disconnect cancels an outstanding Google authorization and preserves another owner's state", async () => {
  const data = await store(), draft = normalizeGoogleOAuthDraft(googleInput), payload = { draft, verifier: "verifier", redirectUri: "https://orbita.example/callback" };
  const a = await data.store.createOAuthState("alice", payload, epoch), b = await data.store.createOAuthState("bob", payload, epoch);
  await data.store.disconnect("alice", "google", "company-2");
  await assert.rejects(data.store.consumeOAuthState("alice", a, epoch + 1), IntegrationError);
  assert.equal((await data.store.consumeOAuthState("bob", b, epoch + 1)).draft.companyId, "company-2");
});

test("disconnect during Google's token exchange cannot reconnect the removed integration", async () => {
  const data = await store(), start = await startGoogleOAuth("alice", googleInput, "https://orbita.example", data.store, undefined, epoch);
  const state = new URL(start.authorizationUrl).searchParams.get("state")!;
  const fetchMock: typeof fetch = async () => {
    await data.store.disconnect("alice", "google", "company-2");
    return Response.json({ access_token: "private-access", refresh_token: "private-refresh", scope: GOOGLE_CALENDAR_SCOPE });
  };
  await assert.rejects(finishGoogleOAuth("alice", state, "code", null, data.store, { fetch: fetchMock, now: epoch + 1 }), (error: unknown) => error instanceof IntegrationError && error.code === "oauth_cancelled");
  assert.equal(await data.store.get("alice", "google", "company-2"), undefined);
});

test("Google denial and missing Calendar scope never save credentials", async () => {
  const data = await store();
  for (const denied of [true, false]) {
    const start = await startGoogleOAuth("alice", googleInput, "https://orbita.example", data.store, undefined, epoch), state = new URL(start.authorizationUrl).searchParams.get("state")!;
    let called = false;
    await assert.rejects(finishGoogleOAuth("alice", state, "code", denied ? "access_denied" : null, data.store, { now: epoch + 1, fetch: async () => { called = true; return Response.json({ access_token: "access", refresh_token: "refresh", scope: "openid" }); } }), IntegrationError);
    assert.equal(called, !denied); assert.equal(await data.store.get("alice", "google", "company-2"), undefined);
  }
});
