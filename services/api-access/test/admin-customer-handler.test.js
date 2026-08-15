import assert from "node:assert/strict";
import test from "node:test";
import { createAdminCustomerHandler } from "../src/admin-customer-handler.js";

const ADMIN_SECRET = "z".repeat(64);
const ACCOUNT_ID = `acct_${"b".repeat(32)}`;

function event(method, path, { body, query, headers = {} } = {}) {
  return {
    rawPath: path,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    queryStringParameters: query,
    requestContext: { http: { method } },
  };
}

function fixture() {
  const calls = [];
  const customers = {
    async getCustomer(identity) { calls.push(["get", identity]); return { accountId: ACCOUNT_ID }; },
    async listCustomers(input) { calls.push(["list", input]); return { customers: [], nextCursor: null }; },
    async updateProfile(identity, profile, actor) { calls.push(["profile", identity, profile, actor]); return { accountId: ACCOUNT_ID, ...profile }; },
    async addNote(identity, note, actor) { calls.push(["note", identity, note, actor]); return { noteId: "note-1", ...note }; },
    async createTask(identity, task, actor) { calls.push(["task", identity, task, actor]); return { taskId: "task-1", ...task }; },
    async updateTask(identity, task, actor) { calls.push(["task-update", identity, task, actor]); return task; },
  };
  return {
    calls,
    handler: createAdminCustomerHandler({
      customers,
      adminSecret: ADMIN_SECRET,
      siteOrigin: "https://www.solve-lang.com",
      logger: { error() {} },
    }),
  };
}

const authorized = { "x-solvelang-admin-secret": ADMIN_SECRET };

test("admin customer routes require the constant-time admin secret and no-store responses", async () => {
  const { handler, calls } = fixture();
  const denied = await handler(event("GET", "/internal/admin/customers", { query: { email: "x@example.com" } }));
  assert.equal(denied.statusCode, 403);
  assert.equal(JSON.parse(denied.body).code, "admin_denied");
  assert.equal(calls.length, 0);

  const allowed = await handler(event("GET", "/internal/admin/customers", {
    headers: authorized,
    query: { email: "x@example.com" },
  }));
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers["cache-control"], "no-store");
  assert.equal(allowed.headers["content-security-policy"], "default-src 'none'; frame-ancestors 'none'");
  assert.deepEqual(calls[0], ["get", { accountId: undefined, email: "x@example.com", username: undefined }]);
});

test("GET without identity lists CRM profiles while exact identity GET returns customer detail", async () => {
  const { handler, calls } = fixture();
  await handler(event("GET", "/internal/admin/customers", { headers: authorized, query: { limit: "25" } }));
  assert.deepEqual(calls[0], ["list", { limit: 25, cursor: undefined }]);

  await handler(event("GET", "/internal/admin/customers", { headers: authorized, query: { accountId: ACCOUNT_ID } }));
  assert.equal(calls[1][0], "get");
  assert.equal(calls[1][1].accountId, ACCOUNT_ID);
});

test("POST routes bind customer identity separately from CRM mutation payloads", async () => {
  const { handler, calls } = fixture();
  const identity = { username: "customer" };
  const cases = [
    ["/internal/admin/customers/profile", { identity, profile: { stage: "active" } }, "profile"],
    ["/internal/admin/customers/notes", { identity, note: { text: "hello" } }, "note"],
    ["/internal/admin/customers/tasks", { identity, task: { title: "follow up" } }, "task"],
    ["/internal/admin/customers/tasks/update", { identity, task: { taskId: "task-1", status: "done" } }, "task-update"],
  ];
  for (const [path, body, expected] of cases) {
    const response = await handler(event("POST", path, { headers: authorized, body }));
    assert.ok(response.statusCode === 200 || response.statusCode === 201);
    assert.equal(calls.at(-1)[0], expected);
    assert.equal(calls.at(-1)[1].username, "customer");
    assert.equal(calls.at(-1).at(-1), "admin-console");
  }
});

test("unknown methods and malformed JSON fail closed with sanitized errors", async () => {
  const { handler } = fixture();
  const method = await handler(event("DELETE", "/internal/admin/customers", { headers: authorized }));
  assert.equal(method.statusCode, 405);

  const malformed = event("POST", "/internal/admin/customers/profile", { headers: authorized });
  malformed.body = "{";
  const invalid = await handler(malformed);
  assert.equal(invalid.statusCode, 400);
  assert.equal(JSON.parse(invalid.body).code, "invalid_request");
});
