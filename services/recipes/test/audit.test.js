import assert from "node:assert/strict";
import test from "node:test";

import { buildRecipeAuditBody, createRecipesAuditClient } from "../src/audit.js";

// QA pins for the MGOV recipes audit client: the exact body shape the
// /recipes/audit route validates, fail-closed behavior with no token,
// and ok/decision propagation on a 201.

const RECORD = {
  id: "run-1",
  repo: "octo/widgets",
  recipeId: "lint-autofix",
  trigger: "schedule",
  conclusion: "success",
  grading: { verified: 1, failed: 0, unverified: 0 },
  baseSha: "a".repeat(40),
  installationId: 123,
  metering: { durationMs: 2500, executor: "process-solution-app" },
};

test("audit body carries exactly the validated fields", () => {
  assert.deepEqual(buildRecipeAuditBody(RECORD), {
    repo: "octo/widgets",
    recipeId: "lint-autofix",
    trigger: "schedule",
    conclusion: "success",
    grading: { verified: 1, failed: 0, unverified: 0 },
    runId: "run-1",
    baseSha: "a".repeat(40),
    installationId: 123,
    durationMs: 2500,
  });
});

test("no token or no base reports unconfigured and never calls fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("must not be called");
  };
  const noToken = createRecipesAuditClient({ mgovBase: "https://mgov.example", adminToken: "", fetchImpl });
  assert.deepEqual(await noToken(RECORD), { ok: false, unconfigured: true });
  const noBase = createRecipesAuditClient({ mgovBase: "", adminToken: "t", fetchImpl });
  assert.deepEqual(await noBase(RECORD), { ok: false, unconfigured: true });
  assert.equal(calls, 0);
});

test("a 201 propagates ok + decision; a non-ok or a throw reports ok:false", async () => {
  const seen = [];
  const okClient = createRecipesAuditClient({
    mgovBase: "https://mgov.example/",
    adminToken: "secret",
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ decision: { action: "recipe_run" } }) };
    },
  });
  const result = await okClient(RECORD);
  assert.equal(result.ok, true);
  assert.equal(result.decision.action, "recipe_run");
  assert.equal(seen[0].url, "https://mgov.example/recipes/audit");
  assert.equal(seen[0].init.headers["x-admin-token"], "secret");
  assert.equal(JSON.parse(seen[0].init.body).recipeId, "lint-autofix");

  const failClient = createRecipesAuditClient({
    mgovBase: "https://mgov.example",
    adminToken: "secret",
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }),
  });
  assert.deepEqual(await failClient(RECORD), { ok: false });

  const throwClient = createRecipesAuditClient({
    mgovBase: "https://mgov.example",
    adminToken: "secret",
    fetchImpl: async () => {
      throw new Error("network");
    },
  });
  assert.deepEqual(await throwClient(RECORD), { ok: false });
});
