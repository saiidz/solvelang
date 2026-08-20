import assert from "node:assert/strict";
import test from "node:test";
import { analyzeNodeWorkspaceMetadata } from "./nodeWorkspaceEvidence";

test("parses bounded Node workspace metadata without execution", () => {
  const result = analyzeNodeWorkspaceMetadata(
    '{"workspaces":["packages/*"],"packageManager":"pnpm@9"}',
    new Map([
      ["packages/a/package.json", '{"name":"@x/a"}'],
      ["packages/b/package.json", "bad"],
    ]),
  );

  assert.deepEqual(result.workspacePatterns, ["packages/*"]);
  assert.equal(result.members[0]?.state, "resolved");
  assert.equal(result.members[1]?.state, "unresolved");
  assert.deepEqual(result.summary, {
    discoveredPackages: 2,
    returnedMembers: 2,
    hiddenMembers: 0,
  });
  assert.equal(result.truncated, false);
  assert.deepEqual(result.execution, { networkAccess: false, writeAccess: false });
});

test("selects the deterministic first 1000 package manifests before truncating", () => {
  const discovered = new Map<string, string>();
  for (let index = 1_001; index >= 0; index -= 1) {
    const path = `packages/${String(index).padStart(4, "0")}/package.json`;
    discovered.set(path, JSON.stringify({ name: `@x/${index}` }));
  }

  const result = analyzeNodeWorkspaceMetadata('{"workspaces":{"packages":["packages/*"]}}', discovered);

  assert.equal(result.members.length, 1_000);
  assert.equal(result.members[0]?.path, "packages/0000/package.json");
  assert.equal(result.members.at(-1)?.path, "packages/0999/package.json");
  assert.deepEqual(result.summary, {
    discoveredPackages: 1_002,
    returnedMembers: 1_000,
    hiddenMembers: 2,
  });
  assert.equal(result.truncated, true);
  assert.match(result.notices.join(" "), /2 additional manifests were not presented/);
});

test("rejects invalid or over-bounded workspace patterns", () => {
  assert.throws(
    () => analyzeNodeWorkspaceMetadata('{"workspaces":[""]}', new Map()),
    /workspace patterns/,
  );
  assert.throws(
    () =>
      analyzeNodeWorkspaceMetadata(
        JSON.stringify({ workspaces: Array.from({ length: 101 }, (_, index) => `packages/${index}`) }),
        new Map(),
      ),
    /100-pattern bound/,
  );
});
