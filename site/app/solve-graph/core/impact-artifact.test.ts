import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphImpactDownload } from "./impact-artifact";
import { verifySolveGraphImpactArtifact } from "./impact-artifact-verify";

test("creates and verifies a canonical bounded analyze-only impact download", async () => {
  const download = await createSolveGraphImpactDownload("fixture repo", "sg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { direction: "dependents", roots: ["sgn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], entries: [{ id: "sgn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", depth: 0, rootId: "sgn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }], truncated: false });
  assert.equal(download.filename, "fixture-repo-impact.json");
  assert.equal((await verifySolveGraphImpactArtifact(JSON.parse(download.content))).integrity.canonicalJsonSha256, download.artifact.integrity.canonicalJsonSha256);
  const tampered = JSON.parse(download.content); tampered.query.roots[0] = "sgn_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await assert.rejects(verifySolveGraphImpactArtifact(tampered), /integrity/);
});
