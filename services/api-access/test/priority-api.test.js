import assert from "node:assert/strict";
import test from "node:test";
import { createPriorityAdminHandler } from "../src/priority-api.js";

const adminSecret = "a".repeat(64);
function event(method, rawPath, body, headers = {}) {
  return { rawPath, headers, body: body === undefined ? undefined : JSON.stringify(body), requestContext: { http: { method } } };
}

test("priority admin API is healthy, browser-isolated, and protects all job routes", async () => {
  const handler = createPriorityAdminHandler({
    enabled: true,
    adminSecret,
    service: {
      submitCanary: async (body) => ({ jobId: "job_" + "a".repeat(32), ...body }),
      getJob: async (jobId) => ({ jobId, status: "complete" }),
    },
    logger: { error() {} },
  });
  const health = await handler(event("GET", "/health"));
  assert.deepEqual(JSON.parse(health.body), { status: "ok", service: "solvelang-priority-queue", enabled: true });
  assert.equal(health.headers["access-control-allow-origin"], undefined);
  const denied = await handler(event("POST", "/internal/jobs/canary", {}));
  assert.equal(denied.statusCode, 403);
  const accepted = await handler(event("POST", "/internal/jobs/canary", { requestId: "canary_12345678" }, { "x-solvelang-admin-secret": adminSecret }));
  assert.equal(accepted.statusCode, 202);
});
