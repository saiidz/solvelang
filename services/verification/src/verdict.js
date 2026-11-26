// Verdict layer for the verification service — pure functions only.
//
// Inputs are the run's graded artifacts: the Change Impact Receipt
// (built by the site's own builder), the PR Gate result document
// (solvelang.pr-gate.result.v1), the head's check runs as collected
// for the receipt, and the repo's verification config. Outputs: the
// blocking determination, the check-run annotations, and the check
// title/summary text.
//
// Enforce semantics (non-negotiable, teardown U2): when the repo's
// mode is "enforce" and blocking evidence exists, the check concludes
// "failure" — never "neutral", never success-with-warnings — so
// branch protection can require it. In "report-only" mode a completed
// run concludes "success" with the same evidence stated in the
// summary (mirroring the PR Gate Action's report-only semantics).
//
// What blocks (each is a *failed* evidence state, never a mere
// unverified one — unverified means "not established", and blocking
// on it would block every PR, since a read-only receipt always
// carries unverified findings):
//   1. the PR Gate policy evaluation failed (a rule verdict of
//      "fail" — overridden and skipped rules do not block);
//   2. the PR Gate route failed or did not run (blast-radius evidence
//      unusable — the receipt records the route as a failed finding);
//   3. the head's own CI has failing or timed-out check runs
//      (excluding this service's check) as read for the receipt;
//   4. a config-named required check is absent, unfinished, or not
//      successful on the head.

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  mode: "report-only",
  requiredChecks: [],
  ignorePaths: [],
});

const MODES = new Set(["report-only", "enforce"]);

// Parses .github/solvelang-verification.json (read at the PR's base
// SHA by the runner — a PR cannot weaken its own gate). Any defect —
// unparseable, wrong version, wrong shapes — yields the defaults
// plus invalid: true so the run can say so in its summary instead of
// silently enforcing or silently ignoring a broken file.
export function parseVerificationConfig(text) {
  if (text === null || text === undefined) {
    return { config: { ...DEFAULT_CONFIG }, invalid: false, present: false };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { config: { ...DEFAULT_CONFIG }, invalid: true, present: true };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.version !== 1) {
    return { config: { ...DEFAULT_CONFIG }, invalid: true, present: true };
  }
  const config = { ...DEFAULT_CONFIG };
  if (raw.mode !== undefined) {
    if (!MODES.has(raw.mode)) {
      return { config: { ...DEFAULT_CONFIG }, invalid: true, present: true };
    }
    config.mode = raw.mode;
  }
  for (const key of ["requiredChecks", "ignorePaths"]) {
    if (raw[key] !== undefined) {
      if (
        !Array.isArray(raw[key]) ||
        raw[key].some((entry) => typeof entry !== "string" || entry === "")
      ) {
        return { config: { ...DEFAULT_CONFIG }, invalid: true, present: true };
      }
      config[key] = [...raw[key]];
    }
  }
  return { config, invalid: false, present: true };
}

// Mirrors TEST_PATH in site/app/change-impact-receipt/core/receipt.ts
// (the receipt builder's own test-file classifier). The QA pins keep
// the two in step on sample paths.
export const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec|specs)(\/|$)|\.(test|spec)\.[a-z]+$/i;

export function isTestPath(filePath) {
  return TEST_PATH.test(filePath);
}

// The blocking determination. checkRuns are the receipt's collected
// runs (the settle wait has already run); ownCheckName is excluded —
// our own in-progress check is not evidence about the PR.
export function computeBlocking({ gateRoute, checkRuns, requiredChecks, ownCheckName }) {
  const reasons = [];

  if (gateRoute?.status === "failed") {
    reasons.push(
      "PR Gate route failed — blast-radius and policy evidence is unusable (the receipt records this as a failed finding)."
    );
  } else if (gateRoute?.status === "not-run") {
    reasons.push("PR Gate route was not run — blast-radius evidence was not produced.");
  } else if (gateRoute?.status === "ran") {
    const summary = gateRoute.summary;
    const failedRules = (summary?.policyVerdicts ?? [])
      .filter((verdict) => verdict.status === "fail")
      .map((verdict) => verdict.rule);
    if (summary && summary.policyPassed === false && failedRules.length > 0) {
      reasons.push(`PR Gate policy failed: ${failedRules.join(", ")}.`);
    }
    if (summary && summary.integrityVerified === false) {
      reasons.push("Solve Graph integrity did not verify — the blast-radius output is not relied on.");
    }
  }

  const others = (checkRuns ?? []).filter((run) => run.name !== ownCheckName);
  const failing = others.filter(
    (run) => run.conclusion === "failure" || run.conclusion === "timed_out"
  );
  if (failing.length > 0) {
    reasons.push(
      `Head CI has failing check run(s): ${failing.map((run) => `${run.name} (${run.conclusion})`).join(", ")}.`
    );
  }

  for (const name of requiredChecks ?? []) {
    const run = others.find((candidate) => candidate.name === name);
    if (!run) {
      reasons.push(`Required check not present on the head: ${name}.`);
    } else if (run.status !== "completed") {
      reasons.push(`Required check not completed: ${name} (${run.status}).`);
    } else if (run.conclusion !== "success") {
      reasons.push(`Required check not successful: ${name} (${run.conclusion ?? "no conclusion"}).`);
    }
  }

  return { blocked: reasons.length > 0, reasons };
}

// Check-run annotations: only findings with exact file attribution
// are annotated (teardown U1) —
//   - protected-path failures: the policy verdict's own detail names
//     the violating files ("Changed protected path(s): a, b."), and
//     each becomes a failure annotation on that file;
//   - the receipt's "No tests in the diff" verified finding: a
//     warning annotation on each changed non-test file.
// Everything else (blast-radius ceiling, affected validations, CI
// state) has no honest single-file attribution and stays in the
// summary + receipt comment. Failures sort before warnings; the
// total is capped at GitHub's 50-per-request limit.
export function computeAnnotations({ receipt, gateResult }) {
  const failures = [];
  const warnings = [];

  const verdicts = gateResult?.policy?.evaluation?.verdicts ?? [];
  const protectedVerdict = verdicts.find(
    (verdict) => verdict.rule === "protected-paths" && verdict.status === "fail"
  );
  if (protectedVerdict && typeof protectedVerdict.detail === "string") {
    const match = protectedVerdict.detail.match(/^Changed protected path\(s\): (.+)\.$/);
    if (match) {
      for (const filePath of match[1].split(", ").map((entry) => entry.trim()).filter(Boolean)) {
        failures.push({
          path: filePath,
          start_line: 1,
          end_line: 1,
          annotation_level: "failure",
          title: "SolveLang Verification — protected path",
          message:
            "This file is matched by the repository's pr-gate.policy.json protected paths, and the PR Gate policy verdict failed. See the SolveLang Verification check and receipt comment for the full graded evidence.",
        });
      }
    }
  }

  const noTests = (receipt?.findings ?? []).find(
    (finding) =>
      finding.label === "verified" && finding.text.startsWith("No tests in the diff:")
  );
  if (noTests) {
    const files = (gateResult?.changedFiles ?? []).map((entry) => entry.path);
    for (const filePath of files) {
      if (!isTestPath(filePath)) {
        warnings.push({
          path: filePath,
          start_line: 1,
          end_line: 1,
          annotation_level: "warning",
          title: "SolveLang Verification — no tests in this diff",
          message: noTests.text,
        });
      }
    }
  }

  return [...failures, ...warnings].slice(0, 50);
}

// The check's title + summary. The full receipt markdown rides in
// the check output text and in the PR comment; the summary is the
// at-a-glance graded state.
export function composeCheckSummary({
  mode,
  blocked,
  reasons,
  grading,
  configInvalid,
  ignoredCount,
  durationMs,
}) {
  const title =
    mode === "enforce"
      ? blocked
        ? "Verification failed — blocking evidence"
        : "Verification passed"
      : blocked
        ? "Verification (report-only) — blocking evidence found"
        : "Verification (report-only) — no blocking evidence";
  const lines = [];
  lines.push(
    `Graded findings: **${grading.verified} verified · ${grading.failed} failed · ${grading.unverified} unverified** (falseVerifiedLabel: false). Mode: \`${mode}\`.`
  );
  if (blocked) {
    lines.push("");
    lines.push("Blocking evidence:");
    for (const reason of reasons) lines.push(`- ${reason}`);
    if (mode === "report-only") {
      lines.push("");
      lines.push("Report-only mode: this check does not block merging. Switch `.github/solvelang-verification.json` to enforce to make it blocking.");
    }
  } else {
    lines.push("");
    lines.push("No blocking evidence in this run.");
  }
  if (configInvalid) {
    lines.push("");
    lines.push("Note: `.github/solvelang-verification.json` at the base SHA is invalid — defaults were applied (report-only, no required checks, no ignored paths).");
  }
  if (ignoredCount > 0) {
    lines.push("");
    lines.push(`${ignoredCount} changed file(s) were excluded from the PR Gate run by the config's ignorePaths. The receipt's file evidence remains complete.`);
  }
  if (typeof durationMs === "number") {
    lines.push("");
    lines.push(`Run duration: ${(durationMs / 1000).toFixed(1)}s.`);
  }
  return { title, summary: lines.join("\n") };
}
