"use client";

import { useMemo, useState } from "react";
import { buildChangeImpactReceipt, renderChangeImpactReceiptMarkdown, type ChangeImpactReceiptInput } from "./core/receipt";
import { sampleReceiptInput } from "./core/sample";

function parseInput(text: string): ChangeImpactReceiptInput {
  const parsed = JSON.parse(text) as ChangeImpactReceiptInput;
  if (!parsed.pr || typeof parsed.pr.number !== "number" || !Array.isArray(parsed.files)) {
    throw new Error("Expected a receipt input object with pr, files, checkRuns, and reviews.");
  }
  return {
    ...parsed,
    checkRuns: parsed.checkRuns ?? [],
    reviews: parsed.reviews ?? [],
    compare: parsed.compare ?? null,
    prGate: parsed.prGate ?? { status: "not-run", reason: "No PR Gate result was supplied with this input.", provenance: "Receipt input as pasted." },
    readAt: parsed.readAt ?? "not recorded in the pasted input",
    source: parsed.source ?? "Receipt input as pasted (source not recorded)",
  };
}

export function ChangeImpactReceiptApp() {
  const [text, setText] = useState(() => JSON.stringify(sampleReceiptInput, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<ChangeImpactReceiptInput>(sampleReceiptInput);

  const markdown = useMemo(() => {
    try {
      return renderChangeImpactReceiptMarkdown(buildChangeImpactReceipt(submitted));
    } catch {
      return "";
    }
  }, [submitted]);

  const receipt = useMemo(() => {
    try {
      return buildChangeImpactReceipt(submitted);
    } catch {
      return null;
    }
  }, [submitted]);

  function generate() {
    try {
      setSubmitted(parseInput(text));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The pasted input could not be parsed as JSON.");
    }
  }

  function download() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "change-impact-receipt.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mx-auto max-w-6xl px-6 pb-20 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="rounded-3xl border border-line bg-panel p-6">
          <h2 className="text-xl font-semibold text-ink">Receipt input</h2>
          <p className="mt-2 text-sm leading-6 text-muted">JSON with the pull request facts read from the GitHub API (PR object fields, files, check runs, reviews, compare) and, when available, the PR Gate report-only summary. The sample below is a real public PR (espanso/espanso #2511) read on 2026-11-24; its PR Gate route is recorded as failed, exactly as it happened. Editing the input never contacts a server.</p>
          <textarea
            className="mt-4 h-96 w-full rounded-2xl border border-line bg-canvas p-4 font-mono text-xs leading-5 text-ink"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Receipt input JSON"
            spellCheck={false}
          />
          {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={generate} className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white">Generate receipt</button>
            <button type="button" onClick={() => { setText(JSON.stringify(sampleReceiptInput, null, 2)); setSubmitted(sampleReceiptInput); setError(null); }} className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink">Restore sample</button>
            <button type="button" onClick={download} className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink">Download receipt (.md)</button>
          </div>
        </div>
        <div className="rounded-3xl border border-line bg-panel p-6">
          <h2 className="text-xl font-semibold text-ink">Receipt</h2>
          {receipt ? (
            <>
              <p className="mt-2 text-sm text-muted">{receipt.title}</p>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-2xl border border-line bg-canvas p-3"><p className="text-2xl font-semibold text-ink">{receipt.grading.verified}</p><p className="text-muted">verified</p></div>
                <div className="rounded-2xl border border-line bg-canvas p-3"><p className="text-2xl font-semibold text-ink">{receipt.grading.failed}</p><p className="text-muted">failed</p></div>
                <div className="rounded-2xl border border-line bg-canvas p-3"><p className="text-2xl font-semibold text-ink">{receipt.grading.unverified}</p><p className="text-muted">unverified</p></div>
              </div>
              <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-canvas p-4 text-xs leading-5 text-ink">{markdown}</pre>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">No receipt yet.</p>
          )}
        </div>
      </div>
      <p className="mx-auto mt-10 max-w-3xl text-center text-sm leading-6 text-muted">A receipt states what the records show. A route that could not run is labeled failed, a fact that was not checked is labeled unverified, and no finding is given a risk score. Receipts are read-only: generating one posts nothing to the pull request.</p>
    </section>
  );
}
