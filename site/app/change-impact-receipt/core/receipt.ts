// SolveLang Change Impact Receipts — pure receipt builder.
//
// Turns read-only facts about a public pull request (as returned by the
// GitHub REST API) plus, when available, the SolveLang PR Gate result
// (schema solvelang.pr-gate.result.v1, report-only mode) into the Change
// Impact Receipt format used by the Nov 22, 2026 cash-sprint receipts.
//
// Provenance discipline (absolute):
//   - every finding is labeled verified / failed / unverified;
//   - a route that could not run is labeled failed, never silently dropped;
//   - no risk scores are produced anywhere;
//   - nothing is fabricated: a fact that was not supplied is recorded as
//     unverified, never guessed.
// The builder is pure and read-only: it performs no network access and
// executes no repository code.

export type FindingLabel = "verified" | "failed" | "unverified";

export type ReceiptFinding = {
  label: FindingLabel;
  text: string;
  provenance: string;
};

export type ReceiptPullRequest = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  draft: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  baseSha: string;
  mergeable: boolean | null;
  mergeableState: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  commits: number;
};

export type ReceiptChangedFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
};

export type ReceiptCheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
};

export type ReceiptReview = {
  author: string;
  state: string;
};

export type ReceiptCompare = {
  status: string;
  aheadBy: number;
  behindBy: number;
};

export type PrGateImpactSummary = {
  integrityVerified: boolean;
  nodes: number;
  edges: number;
  impactedNodes: number;
  rootCount: number;
  headline: string;
  policyPassed: boolean;
  policyVerdicts: { rule: string; status: string }[];
};

export type PrGateRoute =
  | { status: "ran"; summary: PrGateImpactSummary; provenance: string }
  | { status: "failed"; error: string; provenance: string }
  | { status: "not-run"; reason: string; provenance: string };

export type ChangeImpactReceiptInput = {
  pr: ReceiptPullRequest;
  files: ReceiptChangedFile[];
  checkRuns: ReceiptCheckRun[];
  reviews: ReceiptReview[];
  compare: ReceiptCompare | null;
  prGate: PrGateRoute;
  readAt: string;
  source: string;
};

export type ChangeImpactReceipt = {
  schema: "solvelang.change-impact-receipt.v1";
  title: string;
  identity: { label: FindingLabel; lines: string[]; provenance: string };
  toolRoute: string[];
  affectedAreas: { area: string; files: string[] }[];
  findings: ReceiptFinding[];
  grading: {
    verified: number;
    failed: number;
    unverified: number;
    falseVerifiedLabel: false;
    plainStatement: string;
  };
};

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs)(\/|$)|\.(test|spec)\.[a-z]+$/i;

export function affectedAreasFor(files: ReceiptChangedFile[]): { area: string; files: string[] }[] {
  const byArea = new Map<string, string[]>();
  for (const file of files) {
    const segments = file.filename.split("/");
    const area = segments.length > 1 ? segments.slice(0, Math.min(2, segments.length - 1)).join("/") : "(repository root)";
    const list = byArea.get(area) ?? [];
    list.push(file.filename);
    byArea.set(area, list);
  }
  return [...byArea.entries()]
    .map(([area, list]) => ({ area, files: list.sort() }))
    .sort((a, b) => (a.area < b.area ? -1 : 1));
}

export function buildChangeImpactReceipt(input: ChangeImpactReceiptInput): ChangeImpactReceipt {
  const { pr } = input;
  const findings: ReceiptFinding[] = [];
  const api = input.source;

  // --- State / staleness -------------------------------------------------
  if (input.compare) {
    const c = input.compare;
    findings.push({
      label: "verified",
      text: `Base comparison: status ${c.status}, ahead ${c.aheadBy} / behind ${c.behindBy} against the current base branch (${pr.baseRef}).`,
      provenance: `${api} compare endpoint, read ${input.readAt}.`,
    });
  } else {
    findings.push({
      label: "unverified",
      text: "Base drift was not checked: no compare result was supplied for this receipt.",
      provenance: "No compare endpoint result in the input; not guessed.",
    });
  }

  // --- Mergeability ------------------------------------------------------
  if (pr.mergeable === false) {
    findings.push({
      label: "verified",
      text: `The PR is reported not mergeable (mergeable_state: ${pr.mergeableState}); it cannot be merged as-is.`,
      provenance: `${api} PR endpoint, read ${input.readAt}.`,
    });
  } else if (pr.mergeable === null) {
    findings.push({
      label: "unverified",
      text: `Mergeable / conflict status is not established: the API returned mergeable: null, mergeable_state: ${pr.mergeableState}, and no merge was attempted (read-only receipt).`,
      provenance: `${api} PR endpoint, read ${input.readAt}.`,
    });
  } else {
    findings.push({
      label: "verified",
      text: `The PR is reported mergeable against its recorded base (${pr.baseRef}) with mergeable_state: ${pr.mergeableState}. Mergeable against the recorded base is not, by itself, evidence about any other branch.`,
      provenance: `${api} PR endpoint, read ${input.readAt}.`,
    });
  }

  // --- CI evidence ---------------------------------------------------------
  if (input.checkRuns.length === 0) {
    findings.push({
      label: "verified",
      text: "No CI evidence exists for the head: the check-runs endpoint returned 0 check runs for the head SHA.",
      provenance: `${api} check-runs endpoint for head ${pr.headSha}, read ${input.readAt}.`,
    });
  } else {
    const conclusions = input.checkRuns.map((run) => run.conclusion ?? run.status);
    const allCancelled = conclusions.every((value) => value === "cancelled");
    const anyFailure = conclusions.some((value) => value === "failure" || value === "timed_out");
    const allSuccess = conclusions.every((value) => value === "success");
    const names = input.checkRuns.map((run) => `${run.name} (${run.conclusion ?? run.status})`).join(", ");
    if (allSuccess) {
      findings.push({
        label: "verified",
        text: `CI is green on the head as read: ${input.checkRuns.length} check run(s), all success — ${names}.`,
        provenance: `${api} check-runs endpoint for head ${pr.headSha}, read ${input.readAt}.`,
      });
    } else if (allCancelled) {
      findings.push({
        label: "verified",
        text: `CI is not green on the head: all ${input.checkRuns.length} check run(s) were cancelled — ${names}. Nothing on the head proves the change builds or passes.`,
        provenance: `${api} check-runs endpoint for head ${pr.headSha}, read ${input.readAt}.`,
      });
    } else if (anyFailure) {
      findings.push({
        label: "verified",
        text: `CI has failing check run(s) on the head: ${names}.`,
        provenance: `${api} check-runs endpoint for head ${pr.headSha}, read ${input.readAt}.`,
      });
    } else {
      findings.push({
        label: "verified",
        text: `CI state on the head as read: ${names}. No all-success state is claimed.`,
        provenance: `${api} check-runs endpoint for head ${pr.headSha}, read ${input.readAt}.`,
      });
    }
  }

  // --- Review evidence -----------------------------------------------------
  if (input.reviews.length === 0) {
    findings.push({
      label: "verified",
      text: "No review exists: the reviews endpoint returned 0 submitted reviews for this PR.",
      provenance: `${api} reviews endpoint, read ${input.readAt}.`,
    });
  } else {
    const states = input.reviews.map((review) => `${review.author}: ${review.state}`).join("; ");
    const last = input.reviews[input.reviews.length - 1];
    const requestedChanges = input.reviews.some((review) => review.state === "CHANGES_REQUESTED");
    const approvedAfter = last.state === "APPROVED";
    if (requestedChanges && !approvedAfter) {
      findings.push({
        label: "verified",
        text: `Changes were requested and no later approval is recorded in the reviews read: ${states}.`,
        provenance: `${api} reviews endpoint, read ${input.readAt}.`,
      });
    } else {
      findings.push({
        label: "verified",
        text: `Review record as read: ${states}.`,
        provenance: `${api} reviews endpoint, read ${input.readAt}.`,
      });
    }
  }

  // --- Test coverage of the diff itself ------------------------------------
  const testFiles = input.files.filter((file) => TEST_PATH.test(file.filename));
  if (input.files.length > 0 && testFiles.length === 0) {
    findings.push({
      label: "verified",
      text: `No tests in the diff: none of the ${input.files.length} changed file(s) is a test file, and no test is added or updated.`,
      provenance: `${api} files endpoint (complete list as supplied), read ${input.readAt}.`,
    });
  } else if (testFiles.length > 0) {
    findings.push({
      label: "verified",
      text: `The diff touches ${testFiles.length} test file(s): ${testFiles.map((file) => file.filename).join(", ")}. Whether those tests pass is a separate question (see the CI finding).`,
      provenance: `${api} files endpoint, read ${input.readAt}.`,
    });
  }

  // --- Blast radius via the PR Gate engine ---------------------------------
  if (input.prGate.status === "ran") {
    const summary = input.prGate.summary;
    if (!summary.integrityVerified) {
      findings.push({
        label: "failed",
        text: "PR Gate blast radius is not usable evidence: the run completed but the Solve Graph integrity check did not verify, so its impact output is not relied on.",
        provenance: input.prGate.provenance,
      });
    } else if (summary.impactedNodes === 0 && summary.rootCount > 0) {
      findings.push({
        label: "failed",
        text: `PR Gate blast radius is not usable as clearance evidence: the engine reported 0 impacted nodes from ${summary.rootCount} changed root(s). A zero result can be an engine-coverage artifact (the graph extractors cover JS/TS, PHP and Python imports), not a property of the PR.`,
        provenance: input.prGate.provenance,
      });
    } else {
      findings.push({
        label: "verified",
        text: `Blast radius (Solve Graph impact, graph integrity verified, ${summary.nodes} nodes / ${summary.edges} edges): ${summary.headline} Impacted nodes: ${summary.impactedNodes} from ${summary.rootCount} changed root(s).`,
        provenance: input.prGate.provenance,
      });
    }
    const allSkipped = summary.policyVerdicts.length > 0 && summary.policyVerdicts.every((verdict) => verdict.status === "skipped");
    if (allSkipped) {
      findings.push({
        label: "failed",
        text: "PR Gate policy verdict is not usable as clearance evidence: every policy rule was SKIPPED (for example because no policy file was found), whatever the headline verdict printed.",
        provenance: input.prGate.provenance,
      });
    } else if (summary.policyVerdicts.length > 0) {
      findings.push({
        label: "verified",
        text: `PR Gate policy evaluation as printed by the tool (report-only mode, informational): verdict ${summary.policyPassed ? "PASS" : "FAIL"} across ${summary.policyVerdicts.length} rule(s).`,
        provenance: input.prGate.provenance,
      });
    }
  } else if (input.prGate.status === "failed") {
    findings.push({
      label: "failed",
      text: `SolveLang PR Gate / context-index route failed: ${input.prGate.error} No tool report, pack, or blast-radius output is claimed for this PR.`,
      provenance: input.prGate.provenance,
    });
    findings.push({
      label: "unverified",
      text: "Blast radius from the Solve Graph engine: not produced, because the PR Gate route failed (see the failed finding above). Affected areas in this receipt are grouped from the changed-file list only.",
      provenance: input.prGate.provenance,
    });
  } else {
    findings.push({
      label: "failed",
      text: `SolveLang PR Gate / context-index route was not run: ${input.prGate.reason} The route is recorded as failed rather than silently dropped.`,
      provenance: input.prGate.provenance,
    });
    findings.push({
      label: "unverified",
      text: "Blast radius from the Solve Graph engine: not produced, because the PR Gate route was not run. Affected areas in this receipt are grouped from the changed-file list only.",
      provenance: input.prGate.provenance,
    });
  }

  // --- Runtime behaviour is never assessed by a read-only receipt ----------
  findings.push({
    label: "unverified",
    text: "Runtime behaviour of the changed code was not executed for this receipt (read-only service). No claim is made that the change works, only what the records above show.",
    provenance: "No execution was performed; recorded as unverified, not guessed.",
  });

  const verified = findings.filter((finding) => finding.label === "verified").length;
  const failed = findings.filter((finding) => finding.label === "failed").length;
  const unverified = findings.filter((finding) => finding.label === "unverified").length;

  return {
    schema: "solvelang.change-impact-receipt.v1",
    title: `${pr.owner}/${pr.repo} — PR #${pr.number} "${pr.title}"`,
    identity: {
      label: "verified",
      provenance: `${api} PR endpoint, read ${input.readAt}.`,
      lines: [
        `URL: ${pr.url}`,
        `State: ${pr.state}${pr.draft ? ", draft" : ", not draft"}; author ${pr.author}; created ${pr.createdAt}; last updated ${pr.updatedAt}.`,
        `Head: ${pr.headSha} (branch ${pr.headRef}); base: ${pr.baseRef} at ${pr.baseSha}.`,
        `Size: ${pr.changedFiles} changed file(s), +${pr.additions} / -${pr.deletions}, ${pr.commits} commit(s).`,
      ],
    },
    toolRoute: [
      `Primary: ${api} for PR metadata, files, reviews, check-runs and compare — read ${input.readAt}.`,
      input.prGate.status === "ran"
        ? `SolveLang PR Gate (report-only): ran. ${input.prGate.provenance}`
        : input.prGate.status === "failed"
          ? `SolveLang PR Gate (report-only): failed — ${input.prGate.error} ${input.prGate.provenance}`
          : `SolveLang PR Gate (report-only): not run — ${input.prGate.reason} ${input.prGate.provenance}`,
      "Nothing was posted, commented, reviewed, or forked. Read-only throughout.",
    ],
    affectedAreas: affectedAreasFor(input.files),
    findings,
    grading: {
      verified,
      failed,
      unverified,
      falseVerifiedLabel: false,
      plainStatement:
        verified > 0
          ? "Real findings did turn up — this is not an empty receipt. Every verified finding traces to the named source read for this receipt; anything that could not be checked is labeled unverified, and any route that could not run is labeled failed."
          : "No verified finding could be produced from the supplied records; the gaps are labeled above rather than filled in.",
    },
  };
}

export function renderChangeImpactReceiptMarkdown(receipt: ChangeImpactReceipt): string {
  const lines: string[] = [];
  lines.push(`# Change Impact Receipt — ${receipt.title}`);
  lines.push("");
  lines.push("## PR identity + state as read — verified");
  lines.push("");
  for (const line of receipt.identity.lines) lines.push(`- ${line}`);
  lines.push(`- Provenance: ${receipt.identity.provenance}`);
  lines.push("");
  lines.push("## Tool route + provenance");
  lines.push("");
  for (const line of receipt.toolRoute) lines.push(`- ${line}`);
  lines.push("");
  lines.push("## What it touches — affected areas (grouped from the changed-file list)");
  lines.push("");
  if (receipt.affectedAreas.length === 0) {
    lines.push("_No changed files were supplied._");
  } else {
    for (const area of receipt.affectedAreas) {
      lines.push(`- **${area.area}** — ${area.files.length} file(s): ${area.files.map((file) => `\`${file}\``).join(", ")}`);
    }
  }
  lines.push("");
  lines.push("## Receipt findings (each labeled verified / failed / unverified, with provenance)");
  lines.push("");
  receipt.findings.forEach((finding, index) => {
    lines.push(`${index + 1}. **${finding.label}** — ${finding.text} Provenance: ${finding.provenance}`);
  });
  lines.push("");
  lines.push("## Grading block");
  lines.push("");
  lines.push(`- Confirmed (verified) findings: **${receipt.grading.verified}**`);
  lines.push(`- Failed routes / unusable evidence: **${receipt.grading.failed}**`);
  lines.push(`- Recorded as unverified (not guessed): **${receipt.grading.unverified}**`);
  lines.push(`- False "verified" label? **NO** — every verified item names its source.`);
  lines.push(`- Plain statement: ${receipt.grading.plainStatement}`);
  lines.push("");
  return lines.join("\n");
}
