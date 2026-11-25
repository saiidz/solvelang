// SolveLang PR Gate — QA pins for the forge workflow templates' CLI path.
//
// The live Gitea proof caught the wrappers invoking the built CLI one
// path segment short, so the gate never ran and its exit 1 was mapped
// as a policy failure. These pins lock the corrected invocation and
// the no-result guard in BOTH forge templates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const pkgDir = path.resolve(__dirname, "..", "..", "..", "..");

const CORRECT_CLI = 'node "$PR_GATE_KIT_DIR/packages/pr-gate/dist/packages/pr-gate/src/cli.js"';
const WRONG_CLI = 'node "$PR_GATE_KIT_DIR/dist/packages/pr-gate/src/cli.js"';

for (const name of ["workflow-template.gitea.yml", "workflow-template.forgejo.yml"]) {
  test(`${name} invokes the built CLI at its real path, with the no-result guard`, () => {
    const text = readFileSync(path.join(pkgDir, name), "utf8");
    assert.ok(text.includes(CORRECT_CLI), `${name} must invoke the CLI under packages/pr-gate/dist`);
    assert.ok(!text.includes(WRONG_CLI), `${name} must not invoke the one-segment-short CLI path`);
    assert.ok(
      text.includes("if [ ! -f .pr-gate-out/result.json ]"),
      `${name} must treat a missing result.json as an operational error`,
    );
  });

  test(`${name} maps the commit status on the recorded verdict, not the exit code`, () => {
    const text = readFileSync(path.join(pkgDir, name), "utf8");
    assert.ok(text.includes("node <<'NODE' >>"), `${name} must emit the verdict via a heredoc node script`);
    assert.ok(
      text.includes("readFileSync('.pr-gate-out/result.json', 'utf8')"),
      `${name} verdict script must read result.json (quotes intact)`,
    );
    assert.ok(
      text.includes("GATE_VERDICT: ${{ steps.gate.outputs.verdict }}"),
      `${name} status step must receive the verdict output`,
    );
    assert.ok(text.includes('[ "$GATE_VERDICT" = "fail" ]'), `${name} status mapping must key on the verdict`);
    assert.ok(
      !text.includes('elif [ "$GATE_CODE" = "1" ]'),
      `${name} status mapping must not key policy failure on the exit code`,
    );
  });
}

test("the pinned CLI path is where the kit build actually puts cli.js", () => {
  assert.ok(
    existsSync(path.join(pkgDir, "dist", "packages", "pr-gate", "src", "cli.js")),
    "packages/pr-gate/dist/packages/pr-gate/src/cli.js must exist after the build",
  );
});
