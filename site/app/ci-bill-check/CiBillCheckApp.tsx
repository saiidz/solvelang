"use client";

import { useMemo, useState } from "react";
import { readFirstTouchCampaign } from "../attribution/first-touch";
import {
  buildBillSummary,
  parseBillCheckResponse,
  renderBillCheckMarkdown,
  type CiBillCheck,
} from "./core/bill-check";

const API_URL = "https://api.solve-lang.com/public/ci-bill-check";

function splitSlug(input: string): { owner: string; repo: string } | null {
  const parts = input.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
}

export function CiBillCheckApp() {
  const [slug, setSlug] = useState("");
  const [check, setCheck] = useState<CiBillCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => (check ? buildBillSummary(check) : []), [check]);
  const markdown = useMemo(() => (check ? renderBillCheckMarkdown(check) : ""), [check]);

  async function runCheck() {
    const parsed = splitSlug(slug);
    if (!parsed) {
      setError("Enter a public repository as owner/repo (or paste its GitHub URL).");
      return;
    }
    const campaign = readFirstTouchCampaign();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The landing campaign rides along when this visit carries
        // a persisted first touch, so the completion is logged with
        // the page that sent the visitor (SEO -> Sales map, section
        // 3, item 3). With no first touch the body is exactly the
        // owner/repo pair it has always been.
        body: JSON.stringify({ ...parsed, ...(campaign ? { campaign } : {}) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error?.message ?? `The check service answered ${response.status}.`;
        setError(message);
        setCheck(null);
        return;
      }
      setCheck(parseBillCheckResponse(payload?.check));
    } catch {
      setError("The check could not be reached or its answer could not be read. No figures were produced.");
      setCheck(null);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ci-bill-check.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mx-auto max-w-6xl px-6 pb-20 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="rounded-3xl border border-line bg-panel p-6">
          <h2 className="text-xl font-semibold text-ink">Check a public repository</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Name any public GitHub repository. The check reads its 10 most recent completed workflow runs from the GitHub API - real job seconds, per operating system - and prices that exact work two ways: GitHub&apos;s billing model, which rounds every job up to a whole minute, and SolveLang Standard, which meters per second with a 10-second minimum. The figures are totals over that sample only. Nothing is projected or estimated, and if the API returns nothing usable, the page says data unavailable and produces no figures. Checks are cached for 30 minutes.</p>
          <label className="mt-4 block text-sm font-medium text-ink" htmlFor="bill-slug">Repository</label>
          <input
            id="bill-slug"
            className="mt-2 w-full rounded-2xl border border-line bg-canvas p-4 font-mono text-sm text-ink"
            placeholder="owner/repo"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            spellCheck={false}
          />
          {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={runCheck} disabled={busy} className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Checking..." : "Run the free check"}</button>
            {check ? <button type="button" onClick={download} className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink">Download report (.md)</button> : null}
          </div>
        </div>
        <div className="rounded-3xl border border-line bg-panel p-6">
          <h2 className="text-xl font-semibold text-ink">Bill check</h2>
          {check ? (
            <>
              <div className="mt-3 space-y-3 text-sm leading-6 text-ink">
                {summary.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
              <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-canvas p-4 text-xs leading-5 text-ink">{markdown}</pre>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">No check yet. One honesty note up front: GitHub does not charge for standard runners on public repositories, so this is a comparison of the two billing models over real measured work - it is what the same work would cost under each model, and on private repositories the per-minute model is the one that bills.</p>
          )}
        </div>
      </div>
    </section>
  );
}
