import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error Node's type-stripping runner uses explicit TypeScript extensions.
import { isPublicSupabaseKey } from "../pages/public-config.ts";
// @ts-expect-error Node's type-stripping runner uses explicit TypeScript extensions.
import { createSupabaseWorkspaceFetch, sameOriginWorkspaceFetch } from "../lib/workspace-api.ts";

const functionUrl = "https://project.example/functions/v1/orbita-api/";
const publishableKey = "sb_publishable_unit_test_only";
const legacyKey = (payload: Record<string, unknown>) => [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify(payload)).toString("base64url"),
  Buffer.from("not-a-real-signature").toString("base64url"),
].join(".");

test("the public build accepts publishable/legacy anon keys and rejects privileged or malformed credentials", () => {
  assert.equal(isPublicSupabaseKey(publishableKey), true);
  assert.equal(isPublicSupabaseKey(legacyKey({ role: "anon", iss: "supabase" })), true);
  for (const key of ["", "sb_publishable_", "sb_secret_not_a_real_key", "unknown-key", "sb_publishable_invalid key", legacyKey({ role: "service_role" }), legacyKey({ role: "authenticated" }), legacyKey({ iss: "supabase" }), "eyJ.invalid.signature", "a.bnVsbA.c", "a.W10.c"]) {
    assert.equal(isPublicSupabaseKey(key), false, "Privileged, absent or malformed keys must not enter a public build.");
  }
});

test("Vite rejects secret and legacy service-role keys before writing any static assets", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const output = mkdtempSync(join(tmpdir(), "orbita-public-key-guard-"));
  try {
    for (const privilegedKey of ["sb_secret_unit_test_only", legacyKey({ role: "service_role", iss: "supabase" })]) {
    const result = spawnSync(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build", "--config", "pages/vite.config.ts", "--outDir", output], {
      cwd: root,
      env: { ...process.env, VITE_SUPABASE_URL: "https://project.example", VITE_SUPABASE_PUBLISHABLE_KEY: privilegedKey, VITE_BASE_PATH: "/unit-test/" },
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.equal(result.error, undefined, "The build guard must run rather than fail from a timeout or missing executable.");
    assert.notEqual(result.status, 0);
    const diagnostic = `${result.stdout}${result.stderr}`;
    assert.match(diagnostic, /aceita somente chave pública publishable\/anon/);
    assert.equal(diagnostic.includes(privilegedKey), false, "The rejected credential must not be echoed in diagnostics.");
    assert.deepEqual(readdirSync(output), [], "No browser bundle may be written with an administrative key.");
    }
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test("Pages maps API paths to the function and authenticates with Bearer plus apikey without cookies", async (context) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return Response.json({ ok: true }); });
  const originalHeaders = new Headers({ "Content-Type": "application/json", Authorization: "Bearer caller-stale-token", apikey: "caller-stale-key" });
  const controller = new AbortController();
  const body = JSON.stringify({ provider: "clickup", companyId: "company-1", fields: { label: "Unit test" } });
  const api = createSupabaseWorkspaceFetch({ functionUrl, publishableKey, getAccessToken: async () => "current-session-token" });
  await api("/api/integrations?provider=clickup&companyId=company-1", { method: "POST", headers: originalHeaders, body, credentials: "include", signal: controller.signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://project.example/functions/v1/orbita-api/integrations?provider=clickup&companyId=company-1");
  const sent = calls[0].init!;
  const headers = new Headers(sent.headers);
  assert.equal(headers.get("Authorization"), "Bearer current-session-token");
  assert.equal(headers.get("apikey"), publishableKey);
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(sent.credentials, "omit");
  assert.equal(sent.method, "POST"); assert.equal(sent.body, body); assert.equal(sent.signal, controller.signal);
  assert.equal(originalHeaders.get("Authorization"), "Bearer caller-stale-token", "Caller options must not be mutated.");
  assert.equal(originalHeaders.get("apikey"), "caller-stale-key");
});

test("Pages refuses requests without a session or outside the workspace API before any network call", async (context) => {
  let calls = 0, tokenReads = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({}); });
  const anonymous = createSupabaseWorkspaceFetch({ functionUrl, publishableKey, getAccessToken: async () => null });
  await assert.rejects(anonymous("/api/workspace"), /sessão expirou/);
  const authenticated = createSupabaseWorkspaceFetch({ functionUrl, publishableKey, getAccessToken: async () => { tokenReads++; return "session-token"; } });
  for (const path of ["https://other.example/api/workspace", "//other.example/api/workspace", "workspace", "/api/../other"]) await assert.rejects(authenticated(path), /Endereço de integração inválido/);
  assert.equal(calls, 0); assert.equal(tokenReads, 0);
});

test("Pages reads the current session for every request and preserves upstream failure responses", async (context) => {
  const tokens: (string | null)[] = ["first-session", "refreshed-session", null];
  const sentTokens: (string | null)[] = [];
  context.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => { sentTokens.push(new Headers(init?.headers).get("Authorization")); return Response.json({ message: "Acesso negado." }, { status: 401 }); });
  const api = createSupabaseWorkspaceFetch({ functionUrl, publishableKey, getAccessToken: async () => tokens.shift() ?? null });
  const first = await api("/api/workspace");
  const second = await api("/api/sync", { method: "POST" });
  assert.equal(first.status, 401); assert.deepEqual(await second.json(), { message: "Acesso negado." });
  assert.deepEqual(sentTokens, ["Bearer first-session", "Bearer refreshed-session"]);
  await assert.rejects(api("/api/workspace"), /sessão expirou/);
  assert.equal(sentTokens.length, 2, "A signed-out session must not reuse a previous bearer token.");
});

test("the Sites transport keeps the original same-origin request contract", async (context) => {
  const options: RequestInit = { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" };
  let receivedUrl: unknown, receivedOptions: unknown;
  const response = Response.json({ configured: false });
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => { receivedUrl = input; receivedOptions = init; return response; });
  assert.equal(await sameOriginWorkspaceFetch("/api/sync", options), response);
  assert.equal(receivedUrl, "/api/sync"); assert.equal(receivedOptions, options);
});
