import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Security contract for .github/workflows/native-cli-qualification.yml
// (fix C2): the workflow executes code from the PR tree (cargo test /
// clippy and a Python packaging script), so a pull_request-triggered
// job must never land on a self-hosted runner. The owner's fleet is
// reachable only from workflow_dispatch, which only a maintainer can
// trigger. The workflow decides the mapping in exactly one place —
// the plan job, keyed on github.event_name — and the qualify job
// consumes that matrix unchanged. These assertions fail CI if any of
// that regresses.

const workflowsDirectory = new URL("../../../.github/workflows/", import.meta.url);

async function nativeCliWorkflow() {
  return await readFile(new URL("native-cli-qualification.yml", workflowsDirectory), "utf8");
}

// The plan step's run block: from the event_name branch to its `fi`.
// Returns { dispatch, pullRequest } — the two matrix-emitting segments.
function planSegments(workflow) {
  const branchStart = workflow.indexOf('if [ "$EVENT_NAME" = "workflow_dispatch" ]; then');
  assert.notEqual(branchStart, -1, "plan step must branch on workflow_dispatch");
  const elseStart = workflow.indexOf("\n          else\n", branchStart);
  assert.notEqual(elseStart, -1, "plan step must have an else (pull_request) branch");
  const fiStart = workflow.indexOf("\n          fi\n", elseStart);
  assert.notEqual(fiStart, -1, "plan step branch must close with fi");
  return {
    dispatch: workflow.slice(branchStart, elseStart),
    pullRequest: workflow.slice(elseStart, fiStart),
  };
}

test("native-cli qualification: both triggers survive", async () => {
  const workflow = await nativeCliWorkflow();
  assert.match(workflow, /^ {2}pull_request:$/m);
  assert.match(workflow, /^ {2}workflow_dispatch:$/m);
});

test("native-cli qualification: token stays read-only and checkout stays hardened", async () => {
  const workflow = await nativeCliWorkflow();
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.ok(
    workflow.includes("actions/checkout@11d5960a326750d5838078e36cf38b85af677262"),
    "checkout must stay pinned to its full SHA",
  );
  assert.ok(workflow.includes("persist-credentials: false"), "checkout must not persist credentials");
});

test("native-cli qualification: qualify consumes the planned matrix and nothing else", async () => {
  const workflow = await nativeCliWorkflow();
  assert.ok(workflow.includes("needs: plan"), "qualify must need the plan job (fail closed)");
  assert.ok(
    workflow.includes("matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}"),
    "qualify matrix must come from the plan job output",
  );
  // Every literal runs-on in the file: the plan job on a hosted runner,
  // and qualify via the matrix. A new direct runs-on — self-hosted or
  // otherwise — bypasses the plan boundary and fails here.
  const runsOnLines = [...workflow.matchAll(/^ *runs-on: (.+)$/gm)].map((match) => match[1].trim());
  assert.deepEqual(runsOnLines.sort(), ["${{ matrix.runner }}", "ubuntu-latest"]);
});

test("native-cli qualification: pull_request legs are GitHub-hosted only", async () => {
  const workflow = await nativeCliWorkflow();
  const { pullRequest } = planSegments(workflow);
  assert.ok(pullRequest.includes('"runner":"macos-14"'), "macOS ARM64 PR leg must use macos-14");
  assert.ok(pullRequest.includes('"runner":"windows-2022"'), "Windows X64 PR leg must use windows-2022");
  assert.ok(!pullRequest.includes("self-hosted"), "pull_request matrix must never name self-hosted");
});

test("native-cli qualification: self-hosted legs exist only on the workflow_dispatch branch", async () => {
  const workflow = await nativeCliWorkflow();
  const { dispatch } = planSegments(workflow);
  assert.ok(dispatch.includes('"runner":["self-hosted","macOS","ARM64"]'));
  assert.ok(dispatch.includes('"runner":["self-hosted","Windows","X64"]'));
  // The quoted label form appears exactly twice in the whole file —
  // both inside the dispatch segment extracted above. (Prose comments
  // may mention self-hosted; a runner label may not appear elsewhere.)
  const labelOccurrences = workflow.split('"self-hosted"').length - 1;
  assert.equal(labelOccurrences, 2, 'exactly two "self-hosted" runner labels, both on the dispatch branch');
});

test("native-cli qualification: OS/arch coverage is identical on both branches", async () => {
  const workflow = await nativeCliWorkflow();
  const { dispatch, pullRequest } = planSegments(workflow);
  for (const segment of [dispatch, pullRequest]) {
    assert.ok(segment.includes('"target":"aarch64-apple-darwin"'), "macOS ARM64 target must be covered");
    assert.ok(segment.includes('"target":"x86_64-pc-windows-msvc"'), "Windows X64 target must be covered");
    assert.ok(segment.includes('"python":"python3"'), "macOS leg keeps python3");
    assert.ok(segment.includes('"python":"python"'), "Windows leg keeps python");
  }
});
