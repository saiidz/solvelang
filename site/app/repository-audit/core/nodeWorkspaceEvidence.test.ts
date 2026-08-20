import assert from "node:assert/strict";
import test from "node:test";
import { analyzeNodeWorkspaceMetadata } from "./nodeWorkspaceEvidence";
test("parses bounded Node workspace metadata without execution", () => { const result = analyzeNodeWorkspaceMetadata('{"workspaces":["packages/*"],"packageManager":"pnpm@9"}', new Map([["packages/a/package.json", '{"name":"@x/a"}'], ["packages/b/package.json", "bad"]])); assert.deepEqual(result.workspacePatterns, ["packages/*"]); assert.equal(result.members[0]?.state, "resolved"); assert.equal(result.members[1]?.state, "unresolved"); assert.deepEqual(result.execution, { networkAccess: false, writeAccess: false }); });
