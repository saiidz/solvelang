// SolveLang PR Gate — run result schema and the markdown report renderer.
// The markdown starts with a stable HTML-comment marker so the GitHub
// Action can find and update exactly one sticky comment per pull request.

import type { PolicyEvaluation } from "./policy";

export const REPORT_MARKER = "<!-- pr-gate:report -->";

export type PrGateResult = {
  schema: "solvelang.pr-gate.result.v1";
  mode: "report-only" | "enforce";
  repo: string;
  revision: string;
  task: string;
  labels: string[];
  changedFiles: { path: string; mappedToGraphNode: boolean }[];
  graph: {
    graphId: string;
    integrityVerified: boolean;
    nodes: number;
    edges: number;
    executionStatus: string;
    truncated: boolean;
    truncationReasons: string[];
    serializedBytes: number;
  };
  impact: {
    rootCount: number;
    impactedNodes: number;
    truncated: boolean;
    headline: string;
    rows: { label: string; kind: string; depth: number; sentence: string }[];
    hiddenNodes: number;
  };
  affectedValidations: {
    graphValidationCandidates: number;
    paths: string[];
    touchedPaths: string[];
    notice: string;
  };
  pack: null | {
    packId: string;
    source: "explicit" | "discovery";
    entries: number;
    selectedBytes: number;
    budgetBytes: number;
    truncated: boolean;
    omittedCandidates: number;
    files: { path: string; sourceSha256: string }[];
    skippedSensitivePaths: string[];
    skippedMissingPaths: string[];
    skippedOversizePaths: string[];
    skippedBinaryPaths: string[];
    graphInput: "provided" | "omitted-oversize";
  };
  policy: {
    source: string;
    evaluation: PolicyEvaluation;
  };
  exitCode: 0 | 1;
};

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function verdictIcon(status: string): string {
  switch (status) {
    case "pass": return "PASS";
    case "fail": return "FAIL";
    case "overridden": return "OVERRIDDEN";
    default: return "SKIPPED";
  }
}

export function renderReportMarkdown(result: PrGateResult): string {
  const lines: string[] = [];
  lines.push(REPORT_MARKER);
  lines.push("## SolveLang PR Gate");
  lines.push("");
  const gateLine = result.policy.evaluation.passed
    ? "**Policy verdict: PASS**"
    : "**Policy verdict: FAIL**";
  lines.push(`${gateLine} · mode: \`${result.mode}\` · revision \`${result.revision.slice(0, 12)}\``);
  if (result.mode === "report-only" && !result.policy.evaluation.passed) {
    lines.push("");
    lines.push("_Report-only mode: this verdict is informational and does not block merging._");
  }
  lines.push("");
  lines.push("### Policy");
  lines.push("");
  lines.push("| Rule | Verdict | Detail |");
  lines.push("| --- | --- | --- |");
  for (const verdict of result.policy.evaluation.verdicts) {
    lines.push(`| ${verdict.rule} | ${verdictIcon(verdict.status)} | ${escapeCell(verdict.detail)} |`);
  }
  lines.push("");
  lines.push(`Policy source: \`${result.policy.source}\``);
  lines.push("");
  lines.push("### Changed files");
  lines.push("");
  if (result.changedFiles.length === 0) {
    lines.push("_No changed files were supplied._");
  } else {
    for (const file of result.changedFiles) {
      lines.push(`- \`${file.path}\`${file.mappedToGraphNode ? "" : " _(not present in the Solve Graph — deleted, generated, or not indexed)_"}`);
    }
  }
  lines.push("");
  lines.push("### Blast radius (Solve Graph impact)");
  lines.push("");
  lines.push(result.impact.headline);
  lines.push("");
  lines.push(`Impacted nodes: **${result.impact.impactedNodes}** from ${result.impact.rootCount} changed root(s).${result.impact.truncated ? " _Traversal was truncated by engine limits; the true blast radius may be larger._" : ""}`);
  if (result.impact.rows.length > 0) {
    lines.push("");
    for (const row of result.impact.rows) {
      lines.push(`- ${escapeCell(row.sentence)}`);
    }
    if (result.impact.hiddenNodes > 0) {
      lines.push(`- _…and ${result.impact.hiddenNodes} more impacted node(s) not shown._`);
    }
  }
  lines.push("");
  lines.push("### Affected validations");
  lines.push("");
  if (result.affectedValidations.paths.length === 0) {
    lines.push("No validations are inside the impact set (no test/workflow/job graph nodes, and no impacted file is classified as a test by the repository inventory).");
  } else {
    lines.push(`${result.affectedValidations.paths.length} validation file(s) inside the impact set (${result.affectedValidations.graphValidationCandidates} graph validation candidate(s) plus test-classified impacted files):`);
    lines.push("");
    for (const candidatePath of result.affectedValidations.paths) {
      const touched = result.affectedValidations.touchedPaths.includes(candidatePath);
      lines.push(`- \`${candidatePath}\`${touched ? " _(touched by this PR)_" : ""}`);
    }
  }
  lines.push("");
  lines.push(`_${escapeCell(result.affectedValidations.notice)}_`);
  lines.push("");
  lines.push("### Context pack (Solve Context)");
  lines.push("");
  if (result.pack === null) {
    lines.push("No context pack was generated for this change.");
  } else {
    lines.push(`Pack \`${result.pack.packId}\` (${result.pack.source} sources): ${result.pack.entries} entr${result.pack.entries === 1 ? "y" : "ies"}, ${result.pack.selectedBytes} of ${result.pack.budgetBytes} budget bytes${result.pack.truncated ? ", truncated to budget" : ""}${result.pack.omittedCandidates > 0 ? `, ${result.pack.omittedCandidates} candidate(s) omitted` : ""}. The full pack JSON is attached to this workflow run as an artifact.`);
    lines.push("");
    for (const file of result.pack.files) {
      lines.push(`- \`${file.path}\` · sha256 \`${file.sourceSha256.slice(0, 12)}…\``);
    }
    if (result.pack.skippedSensitivePaths.length > 0) {
      lines.push("");
      lines.push(`Skipped as sensitive by the context engine's rules: ${result.pack.skippedSensitivePaths.map((p) => `\`${p}\``).join(", ")}`);
    }
    if (result.pack.skippedMissingPaths.length > 0) {
      lines.push("");
      lines.push(`Skipped because the file does not exist at this revision: ${result.pack.skippedMissingPaths.map((p) => `\`${p}\``).join(", ")}`);
    }
    if (result.pack.skippedOversizePaths.length > 0) {
      lines.push("");
      lines.push(`Skipped because the file exceeds the context engine's 2 MB per-file limit: ${result.pack.skippedOversizePaths.map((p) => `\`${p}\``).join(", ")}`);
    }
    if (result.pack.skippedBinaryPaths.length > 0) {
      lines.push("");
      lines.push(`Skipped because the file is not a text file (binary content cannot enter a context pack): ${result.pack.skippedBinaryPaths.map((p) => `\`${p}\``).join(", ")}`);
    }
    if (result.pack.graphInput === "omitted-oversize") {
      lines.push("");
      lines.push(`Graph hints omitted: the serialized Solve Graph is ${result.graph.serializedBytes} bytes, over the context engine's 2 MB graph-input limit; the pack was built from the changed + impacted file list directly.`);
    }
  }
  lines.push("");
  lines.push("### Engine evidence");
  lines.push("");
  lines.push(`- Solve Graph \`${result.graph.graphId}\`: ${result.graph.nodes} nodes, ${result.graph.edges} edges, integrity ${result.graph.integrityVerified ? "verified" : "NOT verified"}, build status \`${result.graph.executionStatus}\`${result.graph.truncated ? `, truncated (${result.graph.truncationReasons.join(", ")})` : ""}.`);
  lines.push("- Graph built by the repository's own Solve Graph extractors (inventory + JavaScript/TypeScript, PHP, Python); impact computed by `analyzeSolveGraphImpact`; pack built by the MCP Solve Context workspace pack builder.");
  lines.push("");
  return lines.join("\n");
}
