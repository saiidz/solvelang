// Verification run pipeline — orchestration only, every effectful
// dependency injected (token minting, GitHub client, tree fetch, gate
// spawn, receipt collection/building, audit posting), so the whole
// loop is unit-testable with fakes and the production wiring lives in
// server.js.
//
// One run, end to end:
//   1. open the Check Run (in_progress) on the PR head SHA;
//   2. read the repo's verification config at the BASE sha (a PR
//      cannot weaken its own gate);
//   3. wait for the head's other check runs to settle (bounded) —
//      registered runs finished, and expected runs given a grace
//      window to register at all — so the receipt's CI evidence
//      reflects finished CI, not a snapshot of a still-running (or
//      not-yet-started) pipeline;
//   4. fetch the head tree (tarball — no token ever rides a process
//      argument), run the PR Gate CLI report-only on it with the
//      config's ignorePaths removed from the changed set;
//   5. collect the receipt input (GitHub collector, gate result
//      embedded), build the receipt with the site's own builder;
//   6. compute the verdict + annotations, post/update the sticky
//      receipt comment, THEN complete the Check Run (full receipt
//      markdown in the output text) — comment first, so a comment
//      failure can never overwrite the graded verdict;
//   7. append the audit record through the governance audit route.
// Any operational failure completes the check as "failure" with a
// sanitized error class (mirroring the gate CLI's exit code 2) and
// still writes the audit record with conclusion "error".

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { CHECK_RUN_NAME, COMMENT_MARKER } from "./github.js";
import {
  computeAnnotations,
  computeBlocking,
  composeCheckSummary,
  parseVerificationConfig,
} from "./verdict.js";

const execFileAsync = promisify(execFile);
const CONFIG_PATH = ".github/solvelang-verification.json";
const POLICY_PATH = "pr-gate.policy.json";
const CHECK_TEXT_LIMIT = 65_000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createVerificationRunner(deps) {
  const {
    getToken,
    createClient,
    collectReceiptInput,
    buildReceipt,
    renderReceiptMarkdown,
    runGate,
    fetchTree,
    listChangedFiles,
    matchGlob,
    postAudit,
    workRoot,
    settleTimeoutMs = 180_000,
    settlePollMs = 10_000,
    settleRegistrationMs = 60_000,
    sleep = defaultSleep,
    log = () => {},
  } = deps;

  // Settle means two things, not one: every run that has registered
  // has finished, AND the runs we expect have had the chance to
  // register at all. The old loop read an empty list as "settled", so
  // a run could grade a head whose CI had not even appeared yet (the
  // enforce proof legs completed before the repo's Tests run
  // registered). Expected names (the config's requiredChecks) are
  // awaited until the settle deadline; with none expected, the first
  // registration gets a bounded grace window so a repo with no CI at
  // all does not wait forever.
  async function waitForChecksToSettle(client, owner, repo, headSha, expectedCheckNames = []) {
    const startedAt = Date.now();
    const deadline = startedAt + settleTimeoutMs;
    const registrationDeadline = startedAt + settleRegistrationMs;
    const expected = [
      ...new Set(
        (expectedCheckNames ?? []).filter(
          (name) => typeof name === "string" && name !== "" && name !== CHECK_RUN_NAME
        )
      ),
    ];
    for (;;) {
      const runs = await client.listCheckRuns(owner, repo, headSha);
      const others = runs.filter((run) => run.name !== CHECK_RUN_NAME);
      const pending = others.filter((run) => run.status !== "completed");
      const presentNames = new Set(others.map((run) => run.name));
      const missingExpected = expected.filter((name) => !presentNames.has(name));
      const nowMs = Date.now();
      if (pending.length === 0 && missingExpected.length === 0) {
        if (others.length > 0 || nowMs >= registrationDeadline) return;
      }
      if (nowMs >= deadline) {
        log(
          "checks_settle_timeout",
          `${owner}/${repo}@${headSha.slice(0, 12)} pending=${pending.length} missing=${missingExpected.join(",") || "none"}`
        );
        return;
      }
      await sleep(settlePollMs);
    }
  }

  async function runVerification({ installationId, owner, repo, prNumber, headSha, baseSha }) {
    const startedAt = Date.now();
    const fullName = `${owner}/${repo}`;
    const record = {
      repo: fullName,
      pr: prNumber,
      headSha,
      mode: "report-only",
      conclusion: "error",
      checkRunId: null,
      checkRunUrl: null,
      grading: null,
      blockedReasons: [],
      annotations: 0,
      commentOk: null,
      commentError: null,
      auditOk: false,
      durationMs: 0,
    };

    let client = null;
    let checkRunId = null;
    let verdictCompleted = false;
    try {
      const token = await getToken(installationId);
      client = createClient(token);
      const created = await client.createCheckRun(owner, repo, {
        headSha,
        title: "Verification running",
        summary: "SolveLang Verification is collecting graded evidence for this pull request.",
      });
      checkRunId = created?.id ?? null;
      record.checkRunId = checkRunId;
      record.checkRunUrl = created?.html_url ?? null;

      const configText = await client.getFileTextAtRef(owner, repo, CONFIG_PATH, baseSha);
      const { config, invalid: configInvalid } = parseVerificationConfig(configText);
      record.mode = config.mode;

      await waitForChecksToSettle(client, owner, repo, headSha, config.requiredChecks);

      const workDir = path.join(workRoot, `${owner}-${repo}-${prNumber}-${headSha.slice(0, 12)}`);
      await mkdir(workDir, { recursive: true });
      try {
        const treeDir = path.join(workDir, "tree");
        await fetchTree({ token, owner, repo, sha: headSha, destDir: treeDir });

        const pr = await client.getPullRequest(owner, repo, prNumber);
        const labels = Array.isArray(pr?.labels)
          ? pr.labels.map((label) => label?.name).filter(Boolean)
          : [];

        const allChanged = await listChangedFiles({ token, owner, repo, prNumber });
        const ignored = allChanged.filter((filePath) =>
          config.ignorePaths.some((glob) => matchGlob(glob, filePath))
        );
        const gateChanged = allChanged.filter((filePath) => !ignored.includes(filePath));

        const outDir = path.join(workDir, "gate-out");
        await runGate({
          root: treeDir,
          changedFiles: gateChanged,
          labels,
          repo: fullName,
          revision: headSha,
          outDir,
          policyPath: existsSync(path.join(treeDir, POLICY_PATH)) ? POLICY_PATH : undefined,
        });
        const gateResultPath = path.join(outDir, "result.json");
        const gateResult = existsSync(gateResultPath)
          ? JSON.parse(await readFile(gateResultPath, "utf8"))
          : null;

        const input = await collectReceiptInput({
          baseUrl: "https://api.github.com",
          owner,
          repo,
          pr: prNumber,
          token,
          gateResultPath: gateResult ? gateResultPath : undefined,
        });

        if (input.pr.headSha !== headSha) {
          // A newer push landed mid-run; this check belongs to the
          // old SHA and must not present the new head's evidence as
          // its own. The synchronize event for the new head starts a
          // fresh run.
          await client.completeCheckRun(owner, repo, checkRunId, {
            conclusion: "neutral",
            title: "Superseded by a newer push",
            summary: "A newer commit was pushed while this verification run was in progress. A fresh run covers the new head.",
          });
          record.conclusion = "error";
          record.durationMs = Date.now() - startedAt;
          const audit = await postAudit(auditBody(record, installationId)).catch(() => null);
          record.auditOk = Boolean(audit?.ok);
          return record;
        }

        const receipt = buildReceipt(input);
        record.grading = {
          verified: receipt.grading.verified,
          failed: receipt.grading.failed,
          unverified: receipt.grading.unverified,
        };
        const { blocked, reasons } = computeBlocking({
          gateRoute: input.prGate,
          checkRuns: input.checkRuns,
          requiredChecks: config.requiredChecks,
          ownCheckName: CHECK_RUN_NAME,
        });
        record.blockedReasons = reasons;
        const annotations = computeAnnotations({ receipt, gateResult });
        record.annotations = annotations.length;
        const durationMs = Date.now() - startedAt;
        record.durationMs = durationMs;
        const composed = composeCheckSummary({
          mode: config.mode,
          blocked,
          reasons,
          grading: record.grading,
          configInvalid,
          ignoredCount: ignored.length,
          durationMs,
        });
        const title = composed.title;
        let summary = composed.summary;
        const conclusion =
          config.mode === "enforce" && blocked ? "failure" : "success";
        record.conclusion = conclusion;

        let receiptMd = renderReceiptMarkdown(receipt);
        if (receiptMd.length > CHECK_TEXT_LIMIT) {
          receiptMd =
            receiptMd.slice(0, CHECK_TEXT_LIMIT) +
            "\n\n_Receipt truncated at the check-run output limit; the full receipt is in the PR comment._\n";
        }

        // The receipt comment goes BEFORE the check run is completed,
        // and its failure is non-fatal to the verdict: the old order
        // completed the check with the graded verdict and then let a
        // throwing comment call fall into the run-level error path,
        // which re-completed the check as "Verification run failed"
        // and erased the evidence. A failed comment is recorded on
        // the run record, noted in the check summary and carried
        // into the audit record — visible, never silently swallowed.
        const commentBody = [
          COMMENT_MARKER,
          `## SolveLang Verification — ${title}`,
          "",
          summary,
          "",
          record.checkRunUrl ? `Check run: ${record.checkRunUrl}` : "",
          "",
          "---",
          "",
          renderReceiptMarkdown(receipt),
        ]
          .filter((line) => line !== "")
          .join("\n");
        try {
          await client.upsertReceiptComment(owner, repo, prNumber, commentBody);
          record.commentOk = true;
        } catch (commentErr) {
          record.commentOk = false;
          record.commentError = `${commentErr?.name || "Error"}${
            commentErr?.status ? ` ${commentErr.status}` : ""
          }`;
          log("receipt_comment_failed", `${fullName}#${prNumber} ${record.commentError}`);
          summary += `\n\n**Receipt comment not posted:** GitHub refused the pull request comment (${record.commentError}). The full receipt is in this check run's output; the failure is recorded in the audit log.`;
        }

        await client.completeCheckRun(owner, repo, checkRunId, {
          conclusion,
          title,
          summary,
          text: receiptMd,
          annotations,
        });
        verdictCompleted = true;
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }

      const audit = await postAudit(auditBody(record, installationId)).catch(() => null);
      record.auditOk = Boolean(audit?.ok);
      return record;
    } catch (err) {
      record.conclusion = "error";
      record.durationMs = Date.now() - startedAt;
      const errorName = err?.name || "Error";
      log("verification_run_failed", `${fullName}#${prNumber} ${errorName}`);
      if (client && checkRunId && !verdictCompleted) {
        await client
          .completeCheckRun(owner, repo, checkRunId, {
            conclusion: "failure",
            title: "Verification run failed",
            summary: `The verification run itself failed (${errorName}). No graded evidence is claimed for this run; the failure is recorded in the audit log.`,
          })
          .catch(() => {});
      }
      const audit = await postAudit(auditBody(record, installationId)).catch(() => null);
      record.auditOk = Boolean(audit?.ok);
      return record;
    }
  }

  return { runVerification };
}

function auditBody(record, installationId) {
  return {
    repo: record.repo,
    pr: record.pr,
    mode: record.mode,
    conclusion: record.conclusion,
    grading: record.grading ?? undefined,
    checkRunId: record.checkRunId ?? undefined,
    ...(record.commentOk !== null && record.commentOk !== undefined
      ? { commentOk: record.commentOk }
      : {}),
    ...(record.commentError ? { commentError: record.commentError } : {}),
    headSha: record.headSha,
    installationId: installationId ?? undefined,
    durationMs: record.durationMs,
  };
}

// --- Production dependency factories (wired by server.js) ---

// Downloads the repo tarball for a SHA with the installation token
// and extracts it. The token travels in the first request's header
// only; the redirect target (a signed codeload URL) is fetched
// without it.
export function createTarballTreeFetcher({ fetchImpl = fetch } = {}) {
  return async function fetchTree({ token, owner, repo, sha, destDir }) {
    const first = await fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(sha)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: "Bearer " + token,
          "user-agent": "solvelang-verification",
        },
        redirect: "manual",
      }
    );
    let bytes;
    if (first.status >= 300 && first.status < 400) {
      const location = first.headers.get("location");
      if (!location) throw new Error("tarball_redirect_missing");
      const second = await fetchImpl(location);
      if (!second.ok) throw new Error("tarball_download_failed");
      bytes = Buffer.from(await second.arrayBuffer());
    } else if (first.ok) {
      bytes = Buffer.from(await first.arrayBuffer());
    } else {
      throw new Error("tarball_download_failed");
    }
    await mkdir(destDir, { recursive: true });
    const tarPath = path.join(destDir, "tree.tar.gz");
    await writeFile(tarPath, bytes);
    await execFileAsync("tar", ["-xzf", tarPath, "-C", destDir, "--strip-components=1"]);
    await rm(tarPath, { force: true });
  };
}

// Spawns the PR Gate CLI (report-only — the service's verdict layer
// owns the enforce decision) on an extracted tree.
export function createGateCliRunner({ cliPath }) {
  return async function runGate({ root, changedFiles, labels, repo, revision, outDir, policyPath }) {
    const args = [
      cliPath,
      "--root", root,
      "--changed", changedFiles.join(","),
      "--mode", "report-only",
      "--out", outDir,
      "--repo", repo,
      "--revision", revision,
    ];
    if (labels && labels.length > 0) args.push("--labels", labels.join(","));
    if (policyPath) args.push("--policy", policyPath);
    try {
      await execFileAsync("node", args, { maxBuffer: 32 * 1024 * 1024 });
      return { exitCode: 0 };
    } catch (err) {
      // Exit 1 cannot occur in report-only mode; exit 2 is an
      // operational failure — the missing/garbled result.json makes
      // the collector record the route as failed, which is the
      // honest evidence state.
      return { exitCode: typeof err?.code === "number" ? err.code : 2 };
    }
  };
}

// The PR's changed-file list, read from the API (the same endpoint
// the collector reads; the gate needs the list before the collector
// runs so its result can be embedded in the receipt).
export function createChangedFilesReader({ fetchImpl = fetch } = {}) {
  return async function listChangedFiles({ token, owner, repo, prNumber }) {
    const files = [];
    for (let page = 1; ; page += 1) {
      const response = await fetchImpl(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/files?per_page=100&page=${page}`,
        {
          headers: {
            accept: "application/vnd.github+json",
            authorization: "Bearer " + token,
            "user-agent": "solvelang-verification",
          },
        }
      );
      if (!response.ok) throw new Error("changed_files_read_failed");
      const batch = await response.json();
      if (!Array.isArray(batch)) throw new Error("changed_files_read_failed");
      files.push(...batch.map((entry) => entry?.filename).filter(Boolean));
      if (batch.length < 100) return files;
    }
  };
}
