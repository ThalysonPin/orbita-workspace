import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createOrbitaHandler, readEdgeConfig, resolveEdgeConfig } from "../functions/orbita-api/bundle.mjs";

const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_public" }), SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_server" }), ORBITA_OWNER_ID: owner, ORBITA_ALLOWED_ORIGIN: "https://owner.github.io", ORBITA_APP_URL: "https://owner.github.io/orbita/", ORBITA_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64") };
const clickup = { provider: "clickup", companyId: "company-1", fields: { label: "Trabalho", workspaceId: "123", token: "private-provider-token" } };
const google = { provider: "google", companyId: "company-2", fields: { authMode: "oauth", clientId: "client-id", clientSecret: "private-client-secret", calendarId: "primary" } };
function request(path, method = "GET", body, options = {}) {
  return new Request(`${env.SUPABASE_URL}/functions/v1/orbita-api${path}`, { method, headers: { Origin: env.ORBITA_ALLOWED_ORIGIN, apikey: "sb_publishable_public", Authorization: "Bearer owner-session", ...(body ? { "Content-Type": "application/json" } : {}), ...options }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
function harness() {
  const credentials = new Map(), states = new Map(), calls = [];
  let authOwner = owner, authStatus = 200, providerStatus = 401, onGoogle;
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input)), headers = new Headers(init.headers); calls.push({ url, headers, method: init.method || "GET", body: init.body });
    if (url.pathname === "/auth/v1/user") return Response.json({ id: authOwner }, { status: authStatus });
    if (url.hostname === "oauth2.googleapis.com") return onGoogle ? onGoogle(input, init) : Response.json({ access_token: "private-access", refresh_token: "private-refresh", scope: "https://www.googleapis.com/auth/calendar.events.readonly" });
    if (url.hostname === "api.clickup.com") return Response.json({ error: "private-provider-token" }, { status: providerStatus });
    assert.equal(url.origin, env.SUPABASE_URL); assert.equal(headers.get("apikey"), "sb_secret_server"); assert.equal(headers.get("authorization"), null);
    if (url.pathname.endsWith("/orbita_integration_credentials")) {
      if (init.method === "POST") { const value = JSON.parse(String(init.body)); credentials.set(`${value.owner_id}:${value.provider}:${value.company_id}`, value); return new Response(null, { status: 204 }); }
      const filter = (name) => url.searchParams.get(name)?.slice(3);
      return Response.json([...credentials.values()].filter((value) => value.owner_id === filter("owner_id") && (!filter("provider") || value.provider === filter("provider")) && (!filter("company_id") || value.company_id === filter("company_id"))));
    }
    assert.equal(headers.get("Prefer"), null, "RPC results must not be suppressed by return=minimal");
    const params = JSON.parse(String(init.body)), name = url.pathname.split("/").at(-1);
    if (name === "orbita_create_oauth_state") { for (const [hash, value] of states) if (value.owner_id === params.p_owner_id && value.company_id === params.p_company_id) states.delete(hash); states.set(params.p_state_hash, { owner_id: params.p_owner_id, company_id: params.p_company_id, iv: params.p_iv, ciphertext: params.p_ciphertext, expires_at: params.p_now + 600000, consumed_at: null }); return Response.json(null); }
    if (name === "orbita_claim_oauth_state") { const value = states.get(params.p_state_hash); if (!value || value.owner_id !== params.p_owner_id || value.consumed_at !== null || value.expires_at <= params.p_now) return Response.json([]); value.consumed_at = params.p_now; return Response.json([value]); }
    if (name === "orbita_commit_oauth") { const value = states.get(params.p_state_hash); if (!value || value.owner_id !== params.p_owner_id || value.company_id !== params.p_company_id || !value.consumed_at || value.expires_at <= params.p_now) return Response.json(false); credentials.set(`${params.p_owner_id}:google:${params.p_company_id}`, { owner_id: params.p_owner_id, provider: "google", company_id: params.p_company_id, iv: params.p_iv, ciphertext: params.p_ciphertext, updated_at: new Date(params.p_now).toISOString() }); states.delete(params.p_state_hash); return Response.json(true); }
    if (name === "orbita_disconnect") { for (const [hash, value] of states) if (value.owner_id === params.p_owner_id && value.company_id === params.p_company_id && params.p_provider === "google") states.delete(hash); credentials.delete(`${params.p_owner_id}:${params.p_provider}:${params.p_company_id}`); return Response.json(null); }
    throw new Error(`Unexpected mocked RPC ${name}`);
  };
  const handler = createOrbitaHandler(env, fetcher);
  return { handler, credentials, states, calls, setAuth(id, status = 200) { authOwner = id; authStatus = status; }, setGoogle(callback) { onGoogle = callback; } };
}

test("new named key maps and legacy keys resolve, invalid owner or return URL fail closed", () => {
  assert.equal(readEdgeConfig(env).secretKey, "sb_secret_server");
  assert.equal(readEdgeConfig({ ...env, SUPABASE_SECRET_KEYS: undefined, SUPABASE_PUBLISHABLE_KEYS: undefined, SUPABASE_SERVICE_ROLE_KEY: "legacy-service-jwt", SUPABASE_ANON_KEY: "legacy-anon-jwt" }).publishableKey, "legacy-anon-jwt");
  for (const change of [{ ORBITA_OWNER_ID: "email@example.com" }, { ORBITA_ALLOWED_ORIGIN: "*" }, { ORBITA_APP_URL: "https://evil.example" }, { ORBITA_ALLOWED_ORIGIN: "https://owner.github.io/path" }, { SUPABASE_SECRET_KEYS: undefined }]) assert.throws(() => readEdgeConfig({ ...env, ...change }));
});
test("CORS permits only the exact configured origin; preflight never requires login", async () => {
  const h = harness(), allowed = await h.handler(request("/workspace", "OPTIONS"));
  assert.equal(allowed.status, 204); assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), env.ORBITA_ALLOWED_ORIGIN); assert.equal(h.calls.length, 0);
  for (const origin of ["https://owner.github.io.evil.example", "https://evil.example", "null"]) { const response = await h.handler(request("/workspace", "GET", undefined, { Origin: origin })); assert.equal(response.status, 403); assert.equal(response.headers.get("Access-Control-Allow-Origin"), null); }
});
test("hosted gateway function-slug paths preserve authenticated workspace and configuration routes", async () => {
  const h = harness();
  for (const prefix of ["/functions/v1/orbita-api", "/orbita-api"]) {
    let response = await h.handler(new Request(`${env.SUPABASE_URL}${prefix}/workspace`, request("/workspace")));
    assert.equal(response.status, 200); assert.equal((await response.json()).connections.length, 9);
    response = await h.handler(new Request(`${env.SUPABASE_URL}${prefix}/integrations?provider=google&companyId=company-1`, request("/integrations")));
    assert.equal(response.status, 200); assert.equal((await response.json()).settings.saved, false);
  }
  const unknown = await h.handler(new Request(`${env.SUPABASE_URL}/orbita-api-other/workspace`, request("/workspace")));
  assert.equal(unknown.status, 404);
});
test("hosted gateway callback path stays public and returns only to the fixed app URL", async () => {
  const h = harness();
  const response = await h.handler(new Request(`${env.SUPABASE_URL}/orbita-api/integrations/google/callback?state=invalid`));
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get("Location")).origin, env.ORBITA_ALLOWED_ORIGIN);
  assert.equal(new URL(response.headers.get("Location")).pathname, "/orbita/");
  assert.ok(h.calls.every((call) => call.url.pathname !== "/auth/v1/user"));
});
test("Auth getUser validates the bearer remotely and rejects non-owner or forged sessions before DB reads", async () => {
  const h = harness(); h.setAuth(other);
  assert.equal((await h.handler(request("/workspace"))).status, 403); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url.pathname, "/auth/v1/user"); assert.equal(h.calls[0].headers.get("Authorization"), "Bearer owner-session");
  h.setAuth(owner, 401); assert.equal((await h.handler(request("/workspace"))).status, 401);
  assert.equal((await h.handler(request("/workspace", "GET", undefined, { Authorization: "" }))).status, 401);
  assert.equal((await h.handler(request("/workspace", "GET", undefined, { apikey: "sb_secret_server" }))).status, 401);
  assert.ok(h.calls.every((call) => call.url.pathname === "/auth/v1/user"));
});
test("CRUD encrypts credentials, masks metadata, preserves blank secrets and isolates owner filters", async () => {
  const h = harness();
  let response = await h.handler(request("/integrations", "POST", clickup)); assert.equal(response.status, 200); let body = await response.json(); assert.equal(body.settings.secrets.token, true); assert.equal(body.settings.saved, true);
  assert.doesNotMatch(JSON.stringify(body), /private-provider-token|sb_secret/); assert.doesNotMatch(JSON.stringify([...h.credentials.values()]), /private-provider-token/);
  response = await h.handler(request("/integrations", "POST", { ...clickup, fields: { ...clickup.fields, token: "" } })); assert.equal(response.status, 200);
  response = await h.handler(request("/integrations?provider=clickup&companyId=company-1")); body = await response.json(); assert.equal(body.settings.secrets.token, true); assert.doesNotMatch(JSON.stringify(body), /private-provider-token/);
  assert.ok(h.calls.filter((call) => call.url.pathname.endsWith("orbita_integration_credentials") && call.method === "GET").every((call) => call.url.searchParams.get("owner_id") === `eq.${owner}`));
  response = await h.handler(request("/integrations", "DELETE", { provider: "clickup", companyId: "company-1", fields: {} })); assert.equal(response.status, 200); assert.equal(h.credentials.size, 0);
});
test("test failures don't modify saved configuration and expose no provider response", async () => {
  const h = harness(); await h.handler(request("/integrations", "POST", clickup)); const previous = JSON.stringify([...h.credentials.values()]);
  const response = await h.handler(request("/integrations/test", "POST", { ...clickup, fields: { ...clickup.fields, token: "" } })), body = await response.json();
  assert.equal(body.verified, false); assert.equal(JSON.stringify([...h.credentials.values()]), previous); assert.doesNotMatch(JSON.stringify(body), /private-provider-token/);
});
test("public Google callback uses owner-bound one-time state and returns only to the configured app path", async () => {
  const h = harness(), start = await (await h.handler(request("/integrations/google/start", "POST", google))).json(), auth = new URL(start.authorizationUrl), state = auth.searchParams.get("state");
  assert.equal(start.callbackUrl, `${env.SUPABASE_URL}/functions/v1/orbita-api/integrations/google/callback`); assert.doesNotMatch(start.authorizationUrl, /private-client-secret/);
  const callback = () => new Request(`${start.callbackUrl}?state=${state}&code=code&return_to=https://evil.example`);
  const before = h.calls.filter((call) => call.url.pathname === "/auth/v1/user").length;
  const response = await h.handler(callback()), location = new URL(response.headers.get("Location"));
  assert.equal(response.status, 303); assert.equal(location.origin, env.ORBITA_ALLOWED_ORIGIN); assert.equal(location.pathname, "/orbita/"); assert.equal(location.searchParams.get("integration"), "connected"); assert.doesNotMatch(location.href, /private-|code=|state=/);
  assert.equal(h.calls.filter((call) => call.url.pathname === "/auth/v1/user").length, before);
  const replay = new URL((await h.handler(callback())).headers.get("Location")); assert.equal(replay.searchParams.get("integration"), "error");
  assert.equal(h.calls.filter((call) => call.url.hostname === "oauth2.googleapis.com").length, 1);
});
test("expired state and disconnect during Google exchange cannot save or reconnect", async () => {
  const h = harness();
  let start = await (await h.handler(request("/integrations/google/start", "POST", google))).json(), state = new URL(start.authorizationUrl).searchParams.get("state");
  for (const row of h.states.values()) row.expires_at = 0;
  let response = await h.handler(new Request(`${start.callbackUrl}?state=${state}&code=code`)); assert.equal(new URL(response.headers.get("Location")).searchParams.get("integration"), "error"); assert.equal(h.credentials.size, 0);
  start = await (await h.handler(request("/integrations/google/start", "POST", google))).json(); state = new URL(start.authorizationUrl).searchParams.get("state");
  h.setGoogle(async () => { await h.handler(request("/integrations?provider=google&companyId=company-2", "DELETE")); return Response.json({ access_token: "private-access", refresh_token: "private-refresh" }); });
  response = await h.handler(new Request(`${start.callbackUrl}?state=${state}&code=code`)); assert.equal(new URL(response.headers.get("Location")).searchParams.get("integration"), "error"); assert.equal(h.credentials.size, 0);
});
test("migration denies browser access and makes OAuth claims and commits transactional", () => {
  const sql = readFileSync(new URL("../migrations/20261027201119_orbita_integrations.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/enable row level security/g) || []).length, 2); assert.equal((sql.match(/force row level security/g) || []).length, 2);
  assert.match(sql, /revoke all on public\.orbita_integration_credentials, public\.orbita_oauth_states from public, anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/i); assert.match(sql, /consumed_at is null returning/); assert.match(sql, /for update/); assert.match(sql, /grant execute on function .* to service_role/);
});

const runtimeRow = { owner_id: owner, allowed_origin: env.ORBITA_ALLOWED_ORIGIN, app_url: env.ORBITA_APP_URL, credentials_key: env.ORBITA_CREDENTIALS_KEY };
const automaticEnv = { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS: env.SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS: env.SUPABASE_SECRET_KEYS };
test("Vault runtime fallback is server-only, parameterless and bypassed when environment is complete", async () => {
  let calls = 0;
  const fetcher = async (url, init) => {
    calls++; assert.equal(String(url), `${env.SUPABASE_URL}/rest/v1/rpc/orbita_runtime_configuration`);
    const headers = new Headers(init.headers); assert.equal(headers.get("apikey"), "sb_secret_server"); assert.equal(headers.get("authorization"), null);
    assert.equal(init.body, "{}"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    return Response.json([runtimeRow]);
  };
  const fallback = await resolveEdgeConfig(automaticEnv, fetcher);
  assert.equal(fallback.ownerId, owner); assert.equal(fallback.appUrl, env.ORBITA_APP_URL); assert.equal(fallback.encryptionKey, env.ORBITA_CREDENTIALS_KEY); assert.equal(calls, 1);
  const preferred = await resolveEdgeConfig(env, fetcher); assert.equal(preferred.ownerId, owner); assert.equal(calls, 1);
  const overridden = await resolveEdgeConfig({ ...automaticEnv, ORBITA_OWNER_ID: other }, fetcher); assert.equal(overridden.ownerId, other); assert.equal(calls, 2);
  await assert.rejects(resolveEdgeConfig({ ...automaticEnv, ORBITA_ALLOWED_ORIGIN: "*" }, fetcher));
});
test("runtime fallback never caches Vault values between requests or exposes them in API responses", async () => {
  let bootstrapCalls = 0;
  const fetcher = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("orbita_runtime_configuration")) { bootstrapCalls++; return Response.json([runtimeRow]); }
    if (url.pathname === "/auth/v1/user") return Response.json({ id: owner });
    if (url.pathname.endsWith("orbita_integration_credentials")) return Response.json([]);
    throw new Error("Unexpected fallback test request");
  };
  const handler = createOrbitaHandler(automaticEnv, fetcher);
  for (let i = 0; i < 2; i++) { const response = await handler(request("/workspace")); assert.equal(response.status, 200); const body = await response.text(); assert.doesNotMatch(body, /credentials_key|encryptionKey|sb_secret_server/); assert.equal(body.includes(env.ORBITA_CREDENTIALS_KEY), false); }
  assert.equal(bootstrapCalls, 2);
});
test("runtime RPC 401/403/missing configuration fail 503 without echoing upstream secrets", async () => {
  for (const status of [401, 403, 500]) {
    const handler = createOrbitaHandler(automaticEnv, async () => Response.json({ error: `upstream-${env.ORBITA_CREDENTIALS_KEY}-sb_secret_server` }, { status }));
    const response = await handler(request("/workspace")); assert.equal(response.status, 503); const body = await response.text(); assert.equal(body.includes(env.ORBITA_CREDENTIALS_KEY), false); assert.doesNotMatch(body, /sb_secret_server|upstream/);
  }
  for (const body of [[], null, [{}], [{ ...runtimeRow, credentials_key: "invalid" }]]) { const response = await createOrbitaHandler(automaticEnv, async () => Response.json(body))(request("/workspace")); assert.equal(response.status, 503); }
});
test("fallback still enforces 401 sessions and 403 owner/origin restrictions", async () => {
  let authenticatedId = owner;
  const handler = createOrbitaHandler(automaticEnv, async (input) => {
    const url = new URL(String(input)); if (url.pathname.endsWith("orbita_runtime_configuration")) return Response.json([runtimeRow]);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: authenticatedId });
    throw new Error("Unauthorized requests must not reach credentials");
  });
  assert.equal((await handler(request("/workspace", "GET", undefined, { Authorization: "" }))).status, 401);
  authenticatedId = other; assert.equal((await handler(request("/workspace"))).status, 403);
  const origin = await handler(request("/workspace", "GET", undefined, { Origin: "https://evil.example" })); assert.equal(origin.status, 403); assert.equal(origin.headers.get("Access-Control-Allow-Origin"), null);
});
test("fallback OAuth callbacks retain fixed return origin and cannot exchange unverified state", async () => {
  let exchanges = 0;
  const handler = createOrbitaHandler(automaticEnv, async (input) => {
    const url = new URL(String(input)); if (url.pathname.endsWith("orbita_runtime_configuration")) return Response.json([runtimeRow]);
    if (url.pathname.endsWith("orbita_claim_oauth_state")) return Response.json([]);
    exchanges++; throw new Error("Invalid callback must not exchange a token");
  });
  const response = await handler(new Request(`${env.SUPABASE_URL}/functions/v1/orbita-api/integrations/google/callback?state=${"a".repeat(43)}&code=invalid&return_to=https://evil.example`));
  assert.equal(response.status, 303); const target = new URL(response.headers.get("Location")); assert.equal(target.origin, env.ORBITA_ALLOWED_ORIGIN); assert.equal(target.pathname, "/orbita/"); assert.equal(target.searchParams.get("integration"), "error"); assert.equal(exchanges, 0);
});
test("runtime SQL grants only service_role, uses invoker access and never returns provisioning key", () => {
  const sql = readFileSync(new URL("../migrations/20261027201424_orbita_runtime_configuration.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/); assert.match(sql, /force row level security/); assert.doesNotMatch(sql, /create policy|security definer/i);
  assert.match(sql, /revoke all on function public\.orbita_runtime_configuration\(\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.orbita_runtime_configuration\(\) to service_role/);
  assert.match(sql, /orbita_provision_runtime_configuration\([^]*?returns void/);
  assert.match(sql, /vault\.create_secret\(pg_catalog\.encode\(extensions\.gen_random_bytes\(32\), 'base64'\)/);
  assert.doesNotMatch(sql, /vault\.update_secret|raise (?:notice|warning)/i);
});
