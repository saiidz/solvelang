// License-headers executor — Recipes Stage 1 (the first real recipe
// executor; Stage 0 shipped the packaging machinery only).
//
// Deterministic only: no model calls. Two modes, selected by the
// per-repo config entry's options.mode ("check" default, "fix"):
//   - check: scan the repo's source files at the base SHA and grade
//     each one — verified (expected header present), failed (header
//     missing or materially different), unverified (file could not
//     be read or decoded). One finding per file, so the receipt's
//     grading counts ARE the file counts.
//   - fix: the same scan, then ONE governed fix PR carrying header-
//     only changes for the failed files. Two delivery modes, chosen
//     by the wiring (see fixViaMgov in createLicenseHeadersExecutor):
//       * direct (default): opened under whatever identity the
//         injected token actually belongs to, via source.createFixPullRequest.
//       * dispatch (RECIPES_FIX_VIA_MGOV=1): the computed changes are
//         submitted to MGOV's governed fix-dispatch route
//         (src/fix-dispatch.js) and MGOV opens the PR as
//         solvelang-process-solution[bot]. NO silent fallback: a
//         failed dispatch grades the fix outcome honestly (an
//         unverified finding carrying the dispatch error code) and
//         no PR is opened under any other identity.
//     Either way the PR's real author login (read back from the
//     response that created it) is stated in the finding text — the
//     receipt never claims an identity the PR does not carry.
//     Idempotent: a fix run on a compliant repo opens no PR and
//     says so.
//
// Header rule (documented, deterministic): the configured template
// (options.header — the exact header block as it appears in files,
// comment markers included) must appear at the very head of the
// file, allowing only a UTF-8 BOM and/or one shebang line (#!...)
// before it, and must be followed by a blank line or end of file.
// Anything else at the head is "materially different" => failed.
//
// Fix rule: if the file head is a run of comment lines (the stale /
// wrong header), that run is replaced by the template; otherwise the
// template is inserted at the head (after BOM/shebang). Nothing
// after the head comment run is ever touched — the diff is header-
// only by construction, and the QA pins assert it.
//
// Options (config entry options, all optional except header):
//   header            exact header block text (string, required)
//   mode              "check" | "fix" (default "check")
//   extensions        file extensions to scan (default below)
//   includePrefixes   only paths under these prefixes (default: all)
//   excludePrefixes   skip paths under these prefixes
//                     (default: ["node_modules/", ".git/"])

export const DEFAULT_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".rb"]);
export const DEFAULT_EXCLUDE_PREFIXES = Object.freeze(["node_modules/", ".git/"]);

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function normalizeHeader(header) {
  return String(header ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

// Splits a file into { bom, shebang, rest } per the header rule.
export function splitHead(text) {
  let rest = text;
  let bom = "";
  if (rest.startsWith("\uFEFF")) {
    bom = "\uFEFF";
    rest = rest.slice(1);
  }
  let shebang = "";
  if (rest.startsWith("#!")) {
    const nl = rest.indexOf("\n");
    if (nl === -1) return { bom, shebang: rest, rest: "" };
    shebang = rest.slice(0, nl + 1);
    rest = rest.slice(nl + 1);
  }
  return { bom, shebang, rest };
}

// verified when the template sits exactly at the head (after the
// allowed BOM/shebang) and is followed by a blank line or EOF.
export function headerPresent(text, header) {
  const { rest } = splitHead(text.replace(/\r\n/g, "\n"));
  if (!rest.startsWith(header)) return false;
  const after = rest.slice(header.length);
  return after === "" || after.startsWith("\n\n") || after === "\n";
}

// The leading run of comment lines (//, #, /* */ handled as #-style
// single-line runs for the supported line-comment families) — the
// stale header a fix replaces. Returns "" when the head is not a
// comment run.
export function leadingCommentRun(rest) {
  const lines = rest.split("\n");
  const run = [];
  for (const line of lines) {
    if (/^\s*(\/\/|#|--)/.test(line) || line.trim() === "") {
      // Blank lines inside the run belong to it only once a comment
      // line has been seen; a leading blank line is not a header.
      if (run.length === 0 && line.trim() === "") break;
      run.push(line);
      continue;
    }
    break;
  }
  // Trailing blank lines are separators, not header content.
  while (run.length > 0 && run[run.length - 1].trim() === "") run.pop();
  return run.join("\n");
}

// Computes the corrected file content for a failed file. Pure.
export function applyHeader(text, header) {
  const normalized = text.replace(/\r\n/g, "\n");
  const { bom, shebang, rest } = splitHead(normalized);
  const stale = leadingCommentRun(rest);
  const body = stale ? rest.slice(stale.length).replace(/^\n+/, "") : rest;
  return `${bom}${shebang}${header}\n\n${body}`;
}

export function selectFiles(paths, options = {}) {
  const extensions = Array.isArray(options.extensions) && options.extensions.length > 0
    ? options.extensions
    : DEFAULT_EXTENSIONS;
  const include = Array.isArray(options.includePrefixes) ? options.includePrefixes : [];
  const exclude = Array.isArray(options.excludePrefixes) && options.excludePrefixes.length > 0
    ? options.excludePrefixes
    : DEFAULT_EXCLUDE_PREFIXES;
  return paths
    .filter((p) => extensions.some((ext) => p.endsWith(ext)))
    .filter((p) => include.length === 0 || include.some((pre) => p.startsWith(pre)))
    .filter((p) => !exclude.some((pre) => p.startsWith(pre)))
    .sort();
}

// Decodes bytes to text, or returns null when the file is binary /
// undecodable (the unverified grade).
export function decodeText(bytes) {
  if (!bytes) return null;
  if (bytes.includes(0)) return null;
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

// createLicenseHeadersExecutor({ source, createId }) — `source` is
// the injected repo surface (listBlobPaths / getFileBytesAtRef /
// createFixPullRequest, see github.js), so the executor is fully
// unit-testable with a fake and the production token/identity lives
// only in the wiring (server.js).
export function createLicenseHeadersExecutor({
  source,
  createId = () => "run",
  dispatchFix = null,
  fixViaMgov = false,
} = {}) {
  return async function executeLicenseHeaders({
    definition,
    repo,
    trigger,
    baseSha,
    options = {},
    runId = null,
    tenantId = null,
    baseBranch = "main",
  }) {
    const header = normalizeHeader(options.header);
    if (!header) {
      return {
        conclusion: "failure",
        findings: [
          {
            label: "unverified",
            text: "license-headers: no header template configured (options.header is empty), so no file could be graded.",
          },
        ],
      };
    }
    const mode = options.mode === "fix" ? "fix" : "check";
    const [owner, name] = String(repo).split("/");
    const paths = selectFiles(await source.listBlobPaths(owner, name, baseSha), options);

    const findings = [];
    const failed = [];
    let verified = 0;
    for (const path of paths) {
      const bytes = await source.getFileBytesAtRef(owner, name, path, baseSha);
      const text = bytes === null ? null : decodeText(bytes);
      if (text === null) {
        findings.push({
          label: "unverified",
          text: `license-headers: ${path} could not be read or decoded at the base SHA.`,
        });
        continue;
      }
      if (headerPresent(text, header)) {
        verified += 1;
        findings.push({
          label: "verified",
          evidence: true,
          text: `license-headers: ${path} carries the expected header.`,
        });
      } else {
        failed.push({ path, text });
        findings.push({
          label: "failed",
          evidence: true,
          text: `license-headers: ${path} is missing the expected header or carries a materially different one.`,
        });
      }
    }

    if (mode === "check" || failed.length === 0) {
      // Idempotency, stated plainly: a fix run with no failed files
      // opens NO PR. The receipt shows it as success with zero failed
      // findings and no fix-PR finding — the absence of a fix finding
      // in a fix-mode receipt is the "no PR opened" statement, and
      // the finding count stays exactly the scanned-file count.
      return { conclusion: failed.length > 0 ? "failure" : "success", findings };
    }

    // Fix mode with failures: one PR, header-only changes. The
    // changes are computed identically in both delivery modes.
    const changes = failed.map(({ path, text }) => ({ path, content: applyHeader(text, header) }));
    const title = "recipes(license-headers): add/correct license headers";
    const body =
      "Opened by the SolveLang Recipes license-headers recipe (Stage 1). " +
      "Header-only changes: each file's head was set to the header template " +
      "configured in `.github/solvelang-recipes.json`; no other lines were touched.";

    if (fixViaMgov) {
      // Dispatch mode: MGOV opens the PR as the Process Solution
      // bot through its governed batch path. No fallback — a failed
      // or unconfigured dispatch is graded honestly and no PR is
      // opened under another identity.
      const effectiveRunId = runId ?? createId();
      const branchName = `solvelang-recipes/${definition.id}/${String(effectiveRunId).slice(0, 8)}`;
      let result;
      try {
        result =
          typeof dispatchFix === "function"
            ? await dispatchFix({
                recipeId: definition.id,
                runId: effectiveRunId,
                tenantId: tenantId ?? undefined,
                repo,
                baseBranch,
                baseSha,
                branchName,
                title,
                body,
                changes: changes.map((change) => ({
                  path: change.path,
                  contentBase64: Buffer.from(change.content, "utf8").toString("base64"),
                })),
              })
            : { ok: false, error: "fix_dispatch_unconfigured" };
      } catch {
        result = { ok: false, error: "fix_dispatch_request_failed" };
      }
      if (!result?.ok) {
        const code = typeof result?.error === "string" && result.error ? result.error : "fix_dispatch_failed";
        findings.push({
          label: "unverified",
          text:
            `license-headers: fix dispatch via MGOV failed (${code}) — no fix PR was opened ` +
            `for ${changes.length} file(s), and no fallback identity was used.`,
        });
        return { conclusion: "failure", findings };
      }
      const pr = {
        number: result.prNumber ?? null,
        url: result.prUrl ?? null,
        authorLogin: result.authorLogin ?? null,
        headBranch: result.headBranch ?? branchName,
        plan: result.plan ?? null,
      };
      findings.push({
        label: "verified",
        evidence: true,
        text:
          `license-headers: fix PR #${pr.number} opened (${pr.url}) by ${pr.authorLogin ?? "unknown"} ` +
          `covering ${changes.length} file(s), header-only changes, via MGOV fix dispatch.`,
      });
      return { conclusion: "success", findings, fixPullRequest: pr };
    }

    const branch = `recipes/license-headers-${String(createId()).slice(0, 8)}`;
    const pr = await source.createFixPullRequest(owner, name, {
      baseSha,
      branch,
      changes,
      title,
      body,
    });
    findings.push({
      label: "verified",
      evidence: true,
      text:
        `license-headers: fix PR #${pr.number} opened (${pr.url}) by ${pr.authorLogin ?? "unknown"} ` +
        `covering ${changes.length} file(s), header-only changes.`,
    });
    return { conclusion: "success", findings, fixPullRequest: pr };
  };
}
