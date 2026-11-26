// QA pins for Defect 1's investigated-and-cleared suspects (Nov 26,
// 2026 stranger proof): the installation-token mint must NOT
// downscope (a permissions body on the mint call would narrow the
// token), and the sticky comment must go to the issues comments
// endpoint. First-hand API evidence cleared both: the minted token
// carries the app's full granted set (issues: write included), the
// same token comments on plain issues (201) — GitHub refuses the
// comment only when the target is a pull request, because the app's
// granted set holds pull_requests at read. That fix is the app
// permission grant (owner-side) + the manifest correction; these
// pins keep the two code-side suspects from regressing.
import assert from "node:assert/strict";
import test from "node:test";

import { createAppAuth } from "../src/app-auth.js";
import { COMMENT_MARKER, createGitHubClient } from "../src/github.js";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test("defect 1 pin: installation token mint sends NO body (never downscoped)", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return jsonResponse(201, {
      token: "ghs_test",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      permissions: { checks: "write", issues: "write" },
    });
  };
  const auth = createAppAuth({ appId: 5941010, privateKeyPem: PEM, fetchImpl });
  const token = await auth.getInstallationToken(186232390);
  assert.equal(token, "ghs_test");
  assert.equal(seen.length, 1);
  assert.equal(
    seen[0].url,
    "https://api.github.com/app/installations/186232390/access_tokens"
  );
  assert.equal(seen[0].init.method, "POST");
  // A body here (permissions / repository_ids) would narrow the
  // token below the app's granted set — the prime suspect for the
  // comment 403, cleared by evidence and pinned here.
  assert.equal(seen[0].init.body, undefined);
});

test("defect 1 pin: receipt comment posts to the issues comments endpoint", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (init.method === "GET") return jsonResponse(200, []);
    return jsonResponse(201, { id: 99 });
  };
  const client = createGitHubClient({ token: "ghs_test", fetchImpl });
  await client.upsertReceiptComment("octo", "demo", 7, `${COMMENT_MARKER}\nreceipt`);
  const post = seen.find((call) => call.init.method === "POST");
  assert.ok(post, "expected a POST");
  assert.equal(post.url, "https://api.github.com/repos/octo/demo/issues/7/comments");
  assert.match(JSON.parse(post.init.body).body, /solvelang-verification:report/);
});

test("defect 1 pin: an existing sticky comment is updated in place, not duplicated", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (init.method === "GET") {
      return jsonResponse(200, [{ id: 55, body: `${COMMENT_MARKER}\nold receipt` }]);
    }
    return jsonResponse(200, { id: 55 });
  };
  const client = createGitHubClient({ token: "ghs_test", fetchImpl });
  await client.upsertReceiptComment("octo", "demo", 7, `${COMMENT_MARKER}\nnew receipt`);
  const patch = seen.find((call) => call.init.method === "PATCH");
  assert.ok(patch, "expected a PATCH");
  assert.equal(patch.url, "https://api.github.com/repos/octo/demo/issues/comments/55");
  assert.equal(seen.filter((call) => call.init.method === "POST").length, 0);
});
