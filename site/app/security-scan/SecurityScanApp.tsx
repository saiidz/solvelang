"use client";

import { useMemo, useState } from "react";
import {
  PR_GATE_NOT_RUN,
  combineFindings,
  parsePrGateResult,
  parseScanResponse,
  renderScanReportMarkdown,
  type PrGateRoute,
  type RepoSecurityScan,
} from "./core/scan-report";

const API_URL = "https://api.solve-lang.com/public/repo-security-scan";

function splitSlug(input: string): { owner: string; repo: string } | null {
  const parts = input.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
}

export function SecurityScanApp() {
  const [slug, setSlug] = useState("");
  const [prGateText, setPrGateText] = useState("");
  const [scan, setScan] = useState<RepoSecurityScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prGateRoute: PrGateRoute = useMemo(() => {
    if (!prGateText.trim()) return PR_GATE_NOT_RUN;
    return parsePrGateResult(prGateText);
  }, [prGateText]);

  const combined = useMemo(() => (scan ? combineFindings(scan, prGateRoute) : null), [scan, prGateRoute]);
  const markdown = useMemo(() => (scan ? renderScanReportMarkdown(scan, prGateRoute) : ""), [scan, prGateRoute]);

  async function runScan() {
    const parsed = splitSlug(slug);
    if (!parsed) {
      setError("Enter a public repository as owner/repo (or paste its GitHub URL).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error?.message ?? `The scan service answered ${response.status}.`;
        setError(message);
        setScan(null);
        return;
      }
      setScan(parseScanResponse(payload?.scan));
    } catch {
      setError("The scan could not be reached or its answer could not be read. Nothing was scanned.");
      setScan(null);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "repo-security-scan.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mx-auto max-w-6xl px-6 pb-20 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="rounded-3xl border border-line bg-panel p-6">
          <h2 className="text-xl font-semibold text-ink">Scan a public repository</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Name any public GitHub repository. The scan reads its public facts from the GitHub API - security policy, dependency automation, license, and its workflow files - and labels every finding verified, failed, or unverified with provenance. Facts the public API does not expose (branch protection, secret-scanning status) are labeled unverified, in plain words. Nothing is executed and nothing is posted anywhere. Scans are cached for 30 minutes.</p>
          <label className="mt-4 block text-sm font-medium text-ink" htmlFor="scan-slug">Repository</label>
          <input
            id="scan-slug"
            className="mt-2 w-full rounded-2xl border border-line bg-canvas p-4 font-mono text-sm text-ink"
            placeholder="owner/repo"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            spellCheck={false}
          />
          <label className="mt-4 block text-sm font-medium text-ink" htmlFor="scan-prgate">PR Gate result (optional)</label>
          <p className="mt-1 text-sm leading-6 text-muted">If you ran the SolveLang PR Gate in report-only mode on a change (GitHub Action or CLI), paste its result.json here and its policy verdicts join the report, labeled from the kit&apos;s own records.</p>
          <textarea
            id="scan-prgate"
            className="mt-2 h-40 w-full rounded-2xl border border-line bg-canvas p-4 font-mono text-xs leading-5 text-ink"
            value={prGateText}
            onChange={(event) => setPrGateText(event.target.value)}
            spellCheck={false}
          />
          {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={runScan} disabled={busy} className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Scanning..." : "Run the free scan"}</button>
            {scan ? <button type="button" onClick={download} className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink">Download report (.md)</button> : null}
          </div>
        </div>
        <div className="rounded-3xl border border-line bg-panel p-6">
          <h2 className="text-xl font-semibold text-ink">Scan report</h2>
          {scan && combined ? (
            <>
              <p className="mt-2 text-sm text-muted">{scan.repo} - read {scan.readAt}{scan.cached ? " (cached read)" : ""}</p>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-2xl border border-line bg-canvas p-3"><p className="text-2xl font-semibold text-ink">{combined.grading.verified}</p><p className="text-muted">verified</p></div>
                <div className="rounded-2xl border border-line bg-canvas p-3"><p className="text-2xl font-semibold text-ink">{combined.grading.failed}</p><p className="text-muted">failed</p></div>
                <div className="rounded-2xl border border-line bg-canvas p-3"><p className="text-2xl font-semibold text-ink">{combined.grading.unverified}</p><p className="text-muted">unverified</p></div>
              </div>
              <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-canvas p-4 text-xs leading-5 text-ink">{markdown}</pre>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">No scan yet. The report states what the records show: a route that could not run is labeled failed, a fact that was not checked is labeled unverified, and no finding is given a risk score.</p>
          )}
        </div>
      </div>
    </section>
  );
}
