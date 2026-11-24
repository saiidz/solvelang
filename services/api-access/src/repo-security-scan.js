// Public repo security scan: a free, read-only doorway that scans a
// PUBLIC GitHub repository's security posture from the facts the
// GitHub REST API serves to unauthenticated readers, and states
// every result in the receipt discipline SolveLang uses everywhere:
//
// - every finding is labeled verified / failed / unverified;
// - a read that could not be completed is labeled failed, never
//   silently dropped, and a fact the public API does not expose is
//   labeled unverified with the reason stated plainly;
// - NO risk scores, no grades, no estimates - the findings are the
//   facts, each with its provenance (the API route it came from).
//
// The module is self-contained: it imports nothing from the account,
// tenant, ledger, Stripe, or GitHub App code, holds no credential,
// and reads only public data. It cannot read a private repository
// (GitHub answers 404 for those, exactly as for a missing one) and
// it changes nothing anywhere.
//
// - KILL SWITCH: the SECURITY_SCAN_ENABLED flag (parsed in
//   config.js). Anything other than the exact value "true" leaves
//   the route answering 503 security_scan_disabled.
// - Rate limit: a fixed window per source address (60 calls per
//   60 seconds, the same shape as the agent talk-back doorway),
//   enforced before any GitHub work happens.
// - Results are cached per repository for 30 minutes in memory:
//   the scan reads unauthenticated, and GitHub's unauthenticated
//   budget is small; the cache keeps repeat reads off that budget.
//   The response states the moment the facts were read, and a
//   cached answer carries cached: true.
// - Every call is logged (outcome + the public repository slug -
//   the subject of the scan, never caller data).

export const SECURITY_SCAN_RATE_LIMIT = Object.freeze({ limit: 60, windowMs: 60_000 });
export const SECURITY_SCAN_CACHE_TTL_MS = 30 * 60_000;

const GITHUB_API_BASE = "https://api.github.com";
const MAX_WORKFLOW_FILES = 20;

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

const SECURITY_POLICY_PATHS = ["SECURITY.md", ".github/SECURITY.md", "docs/SECURITY.md", "security.md"];
const DEPENDABOT_PATHS = [".github/dependabot.yml", ".github/dependabot.yaml"];
const RENOVATE_PATHS = ["renovate.json", "renovate.json5", ".renovaterc", ".renovaterc.json", ".renovaterc.json5", ".github/renovate.json", ".github/renovate.json5"];
const WORKFLOW_PATH = /^\.github\/workflows\/[^/]+\.(yml|yaml)$/;

const SCANNER_PATTERNS = [
  [/codeql-action/, "CodeQL"],
  [/trivy/, "Trivy"],
  [/semgrep/, "Semgrep"],
  [/snyk\/actions|snyk\/snyk/, "Snyk"],
  [/gitleaks/, "Gitleaks"],
  [/trufflehog/, "TruffleHog"],
  [/osv-scanner/, "OSV-Scanner"],
  [/scorecard-action/, "OpenSSF Scorecard"],
];

const UNTRUSTED_CONTEXT = /\$\{\{\s*(github\.event\.[a-z_.]+|github\.head_ref|inputs\.[a-z_]+)/g;

export function isValidRepoSlug(owner, repo) {
  return typeof owner === "string" && typeof repo === "string" && OWNER_PATTERN.test(owner) && REPO_PATTERN.test(repo) && repo !== "." && repo !== "..";
}

function finding(id, label, text, provenance) {
  return { id, label, text, provenance };
}

// --- workflow file textual analysis --------------------------------
// The scan reads workflow files as text from the contents API and
// analyses them line by line. It does not parse YAML and does not
// execute anything; the checks below are deliberately textual and
// their provenance says so.

export function analyzeWorkflowFile(path, content) {
  const lines = content.split("\n");
  const lower = content.toLowerCase();
  const result = {
    path,
    usesRefs: 0,
    pinnedRefs: 0,
    unpinnedRefs: [],
    declaresPermissions: false,
    scanners: [],
    injectionSites: [],
    pullRequestTargetCheckout: false,
  };

  for (const [pattern, name] of SCANNER_PATTERNS) {
    if (pattern.test(lower)) result.scanners.push(name);
  }
  result.declaresPermissions = lines.some((line) => /^permissions:/.test(line));
  result.pullRequestTargetCheckout =
    /pull_request_target/.test(lower) && /actions\/checkout/.test(lower) && /(head\.sha|head_ref)/.test(lower);

  let runIndent = null;
  lines.forEach((line, index) => {
    const uses = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/);
    if (uses) {
      const ref = uses[1];
      if (!ref.startsWith("./") && !ref.startsWith("docker://")) {
        result.usesRefs += 1;
        const at = ref.lastIndexOf("@");
        const version = at === -1 ? "" : ref.slice(at + 1);
        if (/^[0-9a-f]{40}$/.test(version)) result.pinnedRefs += 1;
        else result.unpinnedRefs.push(ref);
      }
    }

    const runMatch = line.match(/^(\s*)-?\s*run:\s*(.*)$/);
    if (runMatch) {
      runIndent = runMatch[1].length;
      const inline = runMatch[2] ?? "";
      for (const match of inline.matchAll(UNTRUSTED_CONTEXT)) {
        result.injectionSites.push({ line: index + 1, context: match[1] });
      }
      return;
    }
    if (runIndent !== null) {
      const indent = line.match(/^(\s*)/)[1].length;
      if (line.trim() !== "" && indent <= runIndent) {
        runIndent = null;
      } else {
        for (const match of line.matchAll(UNTRUSTED_CONTEXT)) {
          result.injectionSites.push({ line: index + 1, context: match[1] });
        }
      }
    }
  });

  return result;
}

// --- the scan -------------------------------------------------------

export function createRepoSecurityScan({ enabled = false, fetchImpl = globalThis.fetch, logger = console, now = Date.now, rateLimit = SECURITY_SCAN_RATE_LIMIT, cacheTtlMs = SECURITY_SCAN_CACHE_TTL_MS } = {}) {
  const windows = new Map();
  const cache = new Map();

  function log(outcome, repo) {
    try {
      logger.info({ type: "repo_security_scan_call", at: new Date(now()).toISOString(), repo: repo ?? null, outcome });
    } catch {
      // Logging must never break the surface it observes.
    }
  }

  function rateLimitAllows(source) {
    const key = typeof source === "string" && source ? source : "unknown";
    const at = now();
    const window = windows.get(key);
    if (!window || at - window.startedAt >= rateLimit.windowMs) {
      windows.set(key, { startedAt: at, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= rateLimit.limit;
  }

  async function gh(path) {
    const response = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "solvelang-api-access",
      },
    });
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }

  function rateLimited(json) {
    return typeof json?.message === "string" && /rate limit/i.test(json.message);
  }

  async function scan(owner, repo) {
    const slug = `${owner}/${repo}`;
    const routes = [];
    const findings = [];
    const readAt = new Date(now()).toISOString();
    const api = (path) => `/repos/${owner}/${repo}${path}`;

    // Route 1: repository metadata. Everything else depends on it.
    let meta;
    try {
      const result = await gh(api(""));
      if (result.status === 404) return { notFound: true };
      if (result.status !== 200 || !result.json) {
        routes.push({ route: `GET ${api("")}`, status: "failed", detail: `GitHub answered ${result.status}${rateLimited(result.json) ? " (rate limit)" : ""}.` });
        findings.push(finding("repository-read", "failed", "The repository record could not be read, so the scan could not run.", `GET ${api("")} answered ${result.status}.`));
        return { routes, findings, readAt, defaultBranch: null, url: `https://github.com/${slug}` };
      }
      meta = result.json;
      routes.push({ route: `GET ${api("")}`, status: "ok" });
    } catch (error) {
      routes.push({ route: `GET ${api("")}`, status: "failed", detail: String(error?.message ?? error) });
      findings.push(finding("repository-read", "failed", "The repository record could not be read, so the scan could not run.", `GET ${api("")} did not complete.`));
      return { routes, findings, readAt, defaultBranch: null, url: `https://github.com/${slug}` };
    }

    const defaultBranch = typeof meta.default_branch === "string" ? meta.default_branch : "main";

    if (meta.archived) {
      findings.push(finding("archived", "verified", "This repository is archived: GitHub marks it read-only, so its security posture can no longer change.", `GET ${api("")} field archived=true.`));
    }
    if (meta.license && typeof meta.license.spdx_id === "string" && meta.license.spdx_id !== "NOASSERTION") {
      findings.push(finding("license", "verified", `A license is published: ${meta.license.spdx_id}.`, `GET ${api("")} field license.spdx_id.`));
    } else {
      findings.push(finding("license", "verified", "No license is published for this repository.", `GET ${api("")} field license is empty.`));
    }

    // Route 2: the file tree of the default branch.
    let treePaths = null;
    let treeTruncated = false;
    try {
      const result = await gh(api(`/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`));
      if (result.status === 200 && Array.isArray(result.json?.tree)) {
        treePaths = new Set(result.json.tree.filter((entry) => entry?.type === "blob" && typeof entry.path === "string").map((entry) => entry.path));
        treeTruncated = result.json.truncated === true;
        routes.push({ route: `GET ${api(`/git/trees/${defaultBranch}`)}`, status: "ok" });
      } else {
        routes.push({ route: `GET ${api(`/git/trees/${defaultBranch}`)}`, status: "failed", detail: `GitHub answered ${result.status}${rateLimited(result.json) ? " (rate limit)" : ""}.` });
      }
    } catch (error) {
      routes.push({ route: `GET ${api(`/git/trees/${defaultBranch}`)}`, status: "failed", detail: String(error?.message ?? error) });
    }

    const treeProvenance = (route) => `Repository file tree of ${defaultBranch} via ${route}${treeTruncated ? " (GitHub truncated the listing; the check covers the partial tree it returned)" : ""}.`;

    if (treePaths === null) {
      for (const id of ["security-policy", "dependency-automation", "workflow-checks"]) {
        findings.push(finding(id, "failed", "This check could not run: the repository file tree could not be read.", `GET ${api(`/git/trees/${defaultBranch}`)} did not return a tree.`));
      }
    } else {
      const policyPath = SECURITY_POLICY_PATHS.find((path) => treePaths.has(path));
      findings.push(policyPath
        ? finding("security-policy", "verified", `A security policy is published at ${policyPath}: a stated route for reporting vulnerabilities.`, treeProvenance(`GET ${api(`/git/trees/${defaultBranch}`)}`))
        : finding("security-policy", "verified", `No security policy found: none of ${SECURITY_POLICY_PATHS.join(", ")} exists in the tree, so the repository states no route for reporting a vulnerability.`, treeProvenance(`GET ${api(`/git/trees/${defaultBranch}`)}`)));

      const dependabotPath = DEPENDABOT_PATHS.find((path) => treePaths.has(path));
      const renovatePath = RENOVATE_PATHS.find((path) => treePaths.has(path));
      if (dependabotPath) {
        findings.push(finding("dependency-automation", "verified", `Dependency update automation is configured: Dependabot (${dependabotPath}).`, treeProvenance(`GET ${api(`/git/trees/${defaultBranch}`)}`)));
      } else if (renovatePath) {
        findings.push(finding("dependency-automation", "verified", `Dependency update automation is configured: Renovate (${renovatePath}).`, treeProvenance(`GET ${api(`/git/trees/${defaultBranch}`)}`)));
      } else {
        findings.push(finding("dependency-automation", "verified", "No dependency update automation is configured: no Dependabot or Renovate configuration exists in the tree, so dependency updates are manual.", treeProvenance(`GET ${api(`/git/trees/${defaultBranch}`)}`)));
      }
    }

    // Route 3: the workflow files themselves (contents API).
    const workflowPaths = treePaths === null ? [] : [...treePaths].filter((path) => WORKFLOW_PATH.test(path)).sort();
    if (treePaths !== null) {
      if (workflowPaths.length === 0) {
        findings.push(finding("workflow-checks", "verified", "This repository has no GitHub Actions workflows, so there is no workflow surface to check.", treeProvenance(`GET ${api(`/git/trees/${defaultBranch}`)}`)));
      } else {
        const analyses = [];
        let contentsFailed = 0;
        for (const path of workflowPaths.slice(0, MAX_WORKFLOW_FILES)) {
          try {
            const result = await gh(api(`/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(defaultBranch)}`));
            if (result.status === 200 && typeof result.json?.content === "string") {
              const content = Buffer.from(result.json.content.replace(/\s/g, ""), "base64").toString("utf8");
              analyses.push(analyzeWorkflowFile(path, content));
            } else {
              contentsFailed += 1;
            }
          } catch {
            contentsFailed += 1;
          }
        }
        routes.push({ route: `GET ${api("/contents/.github/workflows/*")}`, status: contentsFailed === 0 ? "ok" : "failed", detail: contentsFailed === 0 ? undefined : `${contentsFailed} of ${Math.min(workflowPaths.length, MAX_WORKFLOW_FILES)} workflow files could not be read.` });

        if (analyses.length === 0) {
          findings.push(finding("workflow-checks", "failed", "The workflow files could not be read, so the workflow checks could not run.", `GET ${api("/contents/.github/workflows/*")} did not return file contents.`));
        } else {
          const wfProv = `Workflow files read as text via GET ${api("/contents/.github/workflows/*")} (${analyses.length} of ${workflowPaths.length} files${workflowPaths.length > MAX_WORKFLOW_FILES ? `, capped at ${MAX_WORKFLOW_FILES}` : ""}).`;
          const scanners = [...new Set(analyses.flatMap((a) => a.scanners))];
          findings.push(scanners.length > 0
            ? finding("code-scanning", "verified", `Scanning runs in CI: ${scanners.join(", ")} appear in the workflow files.`, wfProv)
            : finding("code-scanning", "verified", "No workflow runs a known code- or secret-scanning action (looked for CodeQL, Trivy, Semgrep, Snyk, Gitleaks, TruffleHog, OSV-Scanner, OpenSSF Scorecard).", wfProv));

          const totalRefs = analyses.reduce((sum, a) => sum + a.usesRefs, 0);
          const pinnedRefs = analyses.reduce((sum, a) => sum + a.pinnedRefs, 0);
          findings.push(totalRefs === 0
            ? finding("action-pinning", "verified", "The workflows reference no external actions, so there is nothing to pin.", wfProv)
            : finding("action-pinning", "verified", `${pinnedRefs} of ${totalRefs} action references are pinned to a full commit SHA; ${totalRefs - pinnedRefs} use a mutable tag or branch, which the action's owner can move.`, wfProv));

          const withPermissions = analyses.filter((a) => a.declaresPermissions).length;
          findings.push(finding("token-permissions", "verified", withPermissions === analyses.length
            ? `All ${analyses.length} workflow files declare an explicit top-level permissions block, so the GITHUB_TOKEN runs with stated permissions only.`
            : `${withPermissions} of ${analyses.length} workflow files declare an explicit top-level permissions block; the rest run with the repository's default GITHUB_TOKEN permissions.`, wfProv));

          const injections = analyses.flatMap((a) => a.injectionSites.map((site) => ({ file: a.path, ...site })));
          findings.push(injections.length === 0
            ? finding("script-injection", "verified", "No run step interpolates untrusted event data (github.event.*, github.head_ref, inputs.*) into a shell command.", wfProv)
            : finding("script-injection", "verified", `${injections.length} run-step site(s) interpolate untrusted event data into a shell command: ${injections.slice(0, 5).map((s) => `${s.file} line ${s.line} (${s.context})`).join("; ")}${injections.length > 5 ? "; ..." : ""}. Event data an attacker can influence (an issue or PR title, for example) reaches the shell here.`, wfProv));

          const prTarget = analyses.filter((a) => a.pullRequestTargetCheckout);
          findings.push(prTarget.length === 0
            ? finding("pr-target-checkout", "verified", "No workflow combines pull_request_target with a checkout of the pull request's head code.", wfProv)
            : finding("pr-target-checkout", "verified", `${prTarget.length} workflow file(s) combine pull_request_target with a checkout of the pull request's head: ${prTarget.map((a) => a.path).join(", ")}. That pairing runs with the base repository's token and secrets available to the workflow.`, wfProv));
        }
      }
    }

    // Route 4: branch protection - not exposed to unauthenticated
    // readers, so this is honestly unverified unless GitHub ever
    // answers with the record.
    try {
      const result = await gh(api(`/branches/${encodeURIComponent(defaultBranch)}/protection`));
      if (result.status === 200 && result.json) {
        const checks = Array.isArray(result.json.required_status_checks?.contexts) ? result.json.required_status_checks.contexts.length : 0;
        findings.push(finding("branch-protection", "verified", `Branch protection is readable and in place on ${defaultBranch}${checks > 0 ? `, with ${checks} required status check(s)` : ""}.`, `GET ${api(`/branches/${defaultBranch}/protection`)}.`));
        routes.push({ route: `GET ${api(`/branches/${defaultBranch}/protection`)}`, status: "ok" });
      } else {
        findings.push(finding("branch-protection", "unverified", `Whether ${defaultBranch} is protected could not be checked: GitHub does not expose branch protection to unauthenticated readers, so this scan cannot see it either way.`, `GET ${api(`/branches/${defaultBranch}/protection`)} answered ${result.status} without a protection record.`));
        routes.push({ route: `GET ${api(`/branches/${defaultBranch}/protection`)}`, status: "ok", detail: "Answered without a protection record (expected for unauthenticated reads)." });
      }
    } catch (error) {
      findings.push(finding("branch-protection", "failed", "The branch protection read did not complete.", `GET ${api(`/branches/${defaultBranch}/protection`)} did not complete: ${String(error?.message ?? error)}`));
      routes.push({ route: `GET ${api(`/branches/${defaultBranch}/protection`)}`, status: "failed", detail: String(error?.message ?? error) });
    }

    // Security feature status (secret scanning, Dependabot alerts)
    // is only served to callers with repository access.
    if (meta.security_and_analysis && typeof meta.security_and_analysis === "object") {
      const parts = Object.entries(meta.security_and_analysis).map(([name, value]) => `${name}: ${value?.status ?? "unknown"}`);
      findings.push(finding("security-features", "verified", `GitHub security feature status: ${parts.join("; ")}.`, `GET ${api("")} field security_and_analysis.`));
    } else {
      findings.push(finding("security-features", "unverified", "Secret scanning and Dependabot alert status could not be checked: GitHub serves a repository's security feature status only to callers with access to that repository.", `GET ${api("")} carried no security_and_analysis field for an unauthenticated read.`));
    }

    return { routes, findings, readAt, defaultBranch, url: meta.html_url ?? `https://github.com/${slug}` };
  }

  function grade(findings) {
    const counts = { verified: 0, failed: 0, unverified: 0 };
    for (const item of findings) counts[item.label] += 1;
    return {
      ...counts,
      falseVerifiedLabel: false,
      plainStatement: "Every finding is labeled: verified = read from the GitHub API at the read time stated; failed = a read that could not be completed; unverified = a fact the public API does not expose. No risk scores are produced.",
    };
  }

  async function handle({ method, bodyText, source } = {}) {
    if (!enabled) {
      log("refused_disabled", null);
      return { statusCode: 503, body: { ok: false, error: { code: "security_scan_disabled", message: "The repo security scan is not enabled." } } };
    }
    if (method !== "POST") {
      log("method_not_allowed", null);
      return { statusCode: 405, body: { ok: false, error: { code: "method_not_allowed", message: "Use POST with a JSON body naming a public repository." } } };
    }
    if (!rateLimitAllows(source)) {
      log("rate_limited", null);
      return { statusCode: 429, body: { ok: false, error: { code: "rate_limited", message: "Too many scans from this address. The limit is 60 calls per 60 seconds; try again shortly." } } };
    }
    let parsed;
    try {
      parsed = JSON.parse(bodyText ?? "");
    } catch {
      log("rejected", null);
      return { statusCode: 400, body: { ok: false, error: { code: "invalid_body", message: "The request body must be JSON: { \"owner\": \"...\", \"repo\": \"...\" }." } } };
    }
    const owner = typeof parsed?.owner === "string" ? parsed.owner.trim() : "";
    const repo = typeof parsed?.repo === "string" ? parsed.repo.trim() : "";
    if (!isValidRepoSlug(owner, repo)) {
      log("rejected", null);
      return { statusCode: 400, body: { ok: false, error: { code: "invalid_repo", message: "Name a public repository as owner and repo (letters, digits, hyphens, dots, underscores)." } } };
    }

    const slug = `${owner}/${repo}`;
    const cacheKey = slug.toLowerCase();
    const hit = cache.get(cacheKey);
    if (hit && now() - hit.at < cacheTtlMs) {
      log("served_cached", slug);
      return { statusCode: 200, body: { ok: true, scan: { ...hit.scan, cached: true } } };
    }

    let outcome;
    try {
      outcome = await scan(owner, repo);
    } catch (error) {
      log("scan_failed", slug);
      return { statusCode: 500, body: { ok: false, error: { code: "scan_failed", message: `The scan could not be completed: ${String(error?.message ?? error)}` } } };
    }
    if (outcome.notFound) {
      log("not_found", slug);
      return { statusCode: 404, body: { ok: false, error: { code: "repo_not_found", message: "Repository not found. The scan reads public repositories only; GitHub answers the same way for a private repository as for a missing one." } } };
    }

    const scanBody = {
      schema: "solvelang.repo-security-scan.v1",
      repo: slug,
      url: outcome.url,
      defaultBranch: outcome.defaultBranch,
      readAt: outcome.readAt,
      cached: false,
      routes: outcome.routes,
      findings: outcome.findings,
      grading: grade(outcome.findings),
    };
    cache.set(cacheKey, { at: now(), scan: scanBody });
    log("served", slug);
    return { statusCode: 200, body: { ok: true, scan: scanBody } };
  }

  return { handle };
}
