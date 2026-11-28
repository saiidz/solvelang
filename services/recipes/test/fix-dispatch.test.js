import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFixDispatchBody,
  createFixDispatchClient,
  fixViaMgovEnabled,
} from "../src/fix-dispatch.js";

// QA pins for the MGOV fix-dispatch client: the exact contract body
// (contentBase64 changes, tenantId only when present), fail-closed
// behavior with no token/base, the 201 success mapping, and error
// codes propagated from MGOV's { error } body — never the raw body.

const REQUEST = {
  recipeId: "license-headers",
  runId: "run-abcdef123456",
  repo: "octo/widgets",
  baseBranch: "main",
  baseSha: "b".repeat(40),
  branchName: "solvelang-recipes/license-headers/run-abcd",
  title: "recipes(license-headers): add/correct license headers",
  body: "Header-only changes.",
  changes: [{ path: "src/x.js", contentBase64: Buffer.from("code();\n", "utf8").toString("base64") }],
};

test("dispatch body carries exactly the contract fields; tenantId omitted when absent", () => {
  assert.deepEqual(buildFixDispatchBody(REQUEST), REQUEST);
  const withTenant = buildFixDispatchBody({ ...REQUEST, tenantId: "tenant-1" });
  assert.equal(withTenant.tenantId, "tenant-1");
  assert.equal("tenantId" in buildFixDispatchBody({ ...REQUEST, tenantId: "" }), false);
});

test("mode selection: dispatch only when RECIPES_FIX_VIA_MGOV is exactly '1'", () => {
  assert.equal(fixViaMgovEnabled({ RECIPES_FIX_VIA_MGOV: "1" }), true);
  assert.equal(fixViaMgovEnabled({ RECIPES_FIX_VIA_MGOV: "0" }), false);
  assert.equal(fixViaMgovEnabled({ RECIPES_FIX_VIA_MGOV: "true" }), false);
  assert.equal(fixViaMgovEnabled({}), false);
});

test("no token or no base reports unconfigured and never calls fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("must not be called");
  };
  const noToken = createFixDispatchClient({ mgovBase: "https://mgov.example", adminToken: "", fetchImpl });
  const r1 = await noToken(REQUEST);
  assert.equal(r1.ok, false);
  assert.equal(r1.unconfigured, true);
  assert.equal(r1.error, "fix_dispatch_unconfigured");
  const noBase = createFixDispatchClient({ mgovBase: "", adminToken: "t", fetchImpl });
  assert.equal((await noBase(REQUEST)).unconfigured, true);
  assert.equal(calls, 0);
});

test("a 201 maps the contract success fields and posts to the contract route with admin auth", async () => {
  const seen = [];
  const client = createFixDispatchClient({
    mgovBase: "https://mgov.example/",
    adminToken: "secret",
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          prNumber: 42,
          prUrl: "https://github.com/octo/widgets/pull/42",
          authorLogin: "solvelang-process-solution[bot]",
          headBranch: REQUEST.branchName,
          plan: { batchId: "batch-1", status: "opened" },
        }),
      };
    },
  });
  const result = await client(REQUEST);
  assert.equal(result.ok, true);
  assert.equal(result.prNumber, 42);
  assert.equal(result.prUrl, "https://github.com/octo/widgets/pull/42");
  assert.equal(result.authorLogin, "solvelang-process-solution[bot]");
  assert.equal(result.headBranch, REQUEST.branchName);
  assert.deepEqual(result.plan, { batchId: "batch-1", status: "opened" });
  assert.equal(seen[0].url, "https://mgov.example/recipes/fix-dispatch");
  assert.equal(seen[0].init.headers["x-admin-token"], "secret");
  assert.deepEqual(JSON.parse(seen[0].init.body), REQUEST);
});

test("a non-2xx propagates only the error code; a throw reports fix_dispatch_request_failed", async () => {
  const errClient = createFixDispatchClient({
    mgovBase: "https://mgov.example",
    adminToken: "secret",
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "branch_exists", detail: "raw body must not leak" }),
    }),
  });
  const r = await errClient(REQUEST);
  assert.equal(r.ok, false);
  assert.equal(r.error, "branch_exists");
  assert.equal(r.status, 409);
  assert.equal(JSON.stringify(r).includes("raw body"), false);

  const throwClient = createFixDispatchClient({
    mgovBase: "https://mgov.example",
    adminToken: "secret",
    fetchImpl: async () => {
      throw new Error("network");
    },
  });
  const r2 = await throwClient(REQUEST);
  assert.equal(r2.ok, false);
  assert.equal(r2.error, "fix_dispatch_request_failed");
});
