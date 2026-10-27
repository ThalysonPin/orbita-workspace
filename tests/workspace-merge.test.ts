import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's type-stripping runner uses explicit TypeScript extensions.
import { mergeLiveWorkspace } from "../lib/workspace-merge.ts";
import type { WorkspaceData, CalendarEvent } from "../lib/workspace-types";

const event = (id: string): CalendarEvent => ({ id, title: id, companyId: "company-1", source: "google", start: "2026-10-15T09:00:00-04:00", end: "2026-10-15T10:00:00-04:00" });
const workspace = (): WorkspaceData => ({ mode: "live", companies: [{ id: "company-1", name: "Minha empresa", initials: "01", color: "#f07854" }], tasks: [], events: [], messages: [], connections: [{ id: "google-company-1", companyId: "company-1", provider: "google", label: "Agenda", status: "connected", lastSync: "2026-10-15T12:00:00Z" }] });

test("a provider failure retains known events and merges partial results without duplicates", () => {
  const old = workspace(); old.events = [event("google-company-1:old"), event("google-company-1:same")];
  const incoming = workspace(); incoming.connections[0].status = "error"; incoming.connections[0].lastSync = "2026-10-15T13:00:00Z";
  incoming.events = [{ ...event("google-company-1:same"), title: "Atualizado" }, event("google-company-1:new")];
  const result = mergeLiveWorkspace(old, incoming);
  assert.equal(result.events.length, 3);
  assert.equal(result.events.find((item) => item.id.endsWith(":same"))?.title, "Atualizado");
  assert.match(result.connections[0].detail || "", /desatualizados/);
  assert.equal(result.connections[0].lastSync, old.connections[0].lastSync);
  assert.equal(old.events.length, 2);
});

test("a successful empty source clears old records, while local tasks and company names remain", () => {
  const old = workspace(); old.events = [event("google-company-1:old")];
  old.tasks = [{ id: "local-1", title: "Pessoal", companyId: "company-1", source: "local", status: "todo", priority: "medium", dueDate: "", project: "Pessoal" }];
  const incoming = workspace(); incoming.companies[0].name = "Empresa 01";
  const result = mergeLiveWorkspace(old, incoming);
  assert.equal(result.events.length, 0); assert.equal(result.tasks[0].id, "local-1"); assert.equal(result.companies[0].name, "Minha empresa");
});

test("demo fixtures never cross into live mode, even on source failure", () => {
  const old = workspace(); old.mode = "demo"; old.events = [event("google-company-1:fictional")];
  const incoming = workspace(); incoming.connections[0].status = "error";
  const result = mergeLiveWorkspace(old, incoming);
  assert.equal(result.mode, "live"); assert.deepEqual(result.events, []);
});

test("local read status survives refresh and new live messages start unread", () => {
  const old = workspace();
  old.messages = [{ id: "slack-1:old", companyId: "company-1", source: "slack", channel: "geral", author: "Ana", body: "Olá", timestamp: "2026-10-15T12:00:00Z", unread: false }];
  const incoming = workspace(); incoming.messages = [...old.messages, { ...old.messages[0], id: "slack-1:new", timestamp: "2026-10-15T13:00:00Z", unread: false }];
  const result = mergeLiveWorkspace(old, incoming);
  assert.equal(result.messages.find((message) => message.id === "slack-1:old")?.unread, false);
  assert.equal(result.messages.find((message) => message.id === "slack-1:new")?.unread, true);
});
