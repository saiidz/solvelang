"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type CustomerDashboard,
  customerApi,
  normalizeApiBase,
} from "@/app/account/core/customer-api";
import {
  CI_DIGEST_DELIVERY_LINE,
  CI_DIGEST_EMPTY_LINE,
  CI_DIGEST_EYEBROW,
  CI_DIGEST_INTRO,
  CI_DIGEST_MIXED_HEADING,
  CI_DIGEST_MIXED_LINE,
  CI_DIGEST_PATH,
  CI_DIGEST_TITLE,
  CI_DIGEST_WASTED_LABEL,
  formatDigestWindow,
  formatMinutes,
  latestDigestPerRepo,
  parseCiDigests,
  type CiDigest,
} from "@/app/account/core/ci-digest";

// The weekly CI health digest page (Service 4): the customer's
// latest digest per repository, read from the Runner Minutes service
// with the same session pattern as every other account surface. The
// figures are the service's stored digests rendered verbatim — the
// page computes nothing. Delivery is this page only; no email is
// sent for the digest.
const ACCOUNT_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const RUNNERS_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL || "https://runners.solve-lang.com");

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl";
const cardEyebrowClass = "text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300";

type Screen = "loading" | "signed-out" | "ready";

function DigestSection({ digest }: { digest: CiDigest }) {
  const { totals } = digest;
  return (
    <section className={cardClass}>
      <p className={cardEyebrowClass}>{digest.repo}</p>
      <h2 className="mt-3 text-2xl font-bold">{formatDigestWindow(digest) || "Latest week"}</h2>

      {digest.insufficientData ? (
        <p className="mt-4 leading-7 text-slate-300">
          {digest.note ?? CI_DIGEST_EMPTY_LINE}
        </p>
      ) : null}

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-sm text-slate-400">Jobs served</dt>
          <dd className="mt-1 text-xl font-bold">{totals.jobsServed}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-400">Minutes billed</dt>
          <dd className="mt-1 text-xl font-bold">{formatMinutes(totals.totalMinutes)}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-400">{CI_DIGEST_WASTED_LABEL}</dt>
          <dd className="mt-1 text-xl font-bold">{formatMinutes(totals.wastedMinutes)}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-400">Jobs passed</dt>
          <dd className="mt-1 text-xl font-bold">
            {totals.successes} of {totals.concludedJobs}
            {totals.successRatePercent !== null ? ` (${totals.successRatePercent}%)` : ""}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-sm text-slate-400">
        Failed jobs: {totals.failures}. Cancelled jobs: {totals.cancellations}. Records counted this
        week: {totals.recordsInWindow}.
      </p>

      {!digest.insufficientData && digest.slowestRuns.length > 0 ? (
        <div className="mt-8">
          <h3 className="text-lg font-bold">Slowest workflow runs</h3>
          <ul className="mt-3 space-y-2 text-slate-300">
            {digest.slowestRuns.map((run) => (
              <li key={String(run.runId)} className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-2">
                <span>Run {String(run.runId)} — {run.jobs} jobs, {run.failures} failed</span>
                <span className="font-semibold text-white">{formatMinutes(run.minutes)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!digest.insufficientData && digest.slowestJobs.length > 0 ? (
        <div className="mt-8">
          <h3 className="text-lg font-bold">Slowest single jobs</h3>
          <ul className="mt-3 space-y-2 text-slate-300">
            {digest.slowestJobs.map((job) => (
              <li key={String(job.jobId)} className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-2">
                <span>Job {String(job.jobId)} — {job.outcome}</span>
                <span className="font-semibold text-white">{formatMinutes(job.minutes)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!digest.insufficientData && digest.mixedOutcomeRuns.length > 0 ? (
        <div className="mt-8">
          <h3 className="text-lg font-bold">{CI_DIGEST_MIXED_HEADING}</h3>
          <p className="mt-2 text-sm text-slate-400">{CI_DIGEST_MIXED_LINE}</p>
          <ul className="mt-3 space-y-2 text-slate-300">
            {digest.mixedOutcomeRuns.map((run) => (
              <li key={String(run.runId)} className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-2">
                <span>Run {String(run.runId)} — {run.successes} passed, {run.failures} failed</span>
                <span className="font-semibold text-white">{formatMinutes(run.minutes)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function CiDigestBoard() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [digests, setDigests] = useState<CiDigest[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await customerApi<CustomerDashboard>(ACCOUNT_API_BASE, "/customer/account", { method: "GET" });
      } catch {
        if (active) setScreen("signed-out");
        return;
      }
      if (!active) return;
      setScreen("ready");
      try {
        const raw = await customerApi<unknown>(RUNNERS_API_BASE, CI_DIGEST_PATH, { method: "GET" });
        if (active) setDigests(latestDigestPerRepo(parseCiDigests(raw)));
      } catch {
        // A service without the digest surface reads as no digests
        // yet — the empty state below — never an error dump.
        if (active) setDigests([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (screen === "loading") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-6xl">
          <p className="text-slate-300">Loading your digest…</p>
        </div>
      </main>
    );
  }

  if (screen === "signed-out") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-5xl">
          <section className={cardClass}>
            <p className={cardEyebrowClass}>{CI_DIGEST_EYEBROW}</p>
            <h1 className="mt-3 text-4xl font-bold">Sign in</h1>
            <p className="mt-4 text-slate-300">Sign in to see your weekly CI health digest.</p>
            <Link
              href="/account/api-keys/"
              className="mt-8 flex w-full items-center justify-center rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-200"
            >
              Sign in
            </Link>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-6xl">
        <header className="border-b border-white/10 pb-8">
          <p className={cardEyebrowClass}>{CI_DIGEST_EYEBROW}</p>
          <h1 className="mt-2 text-4xl font-bold">{CI_DIGEST_TITLE}</h1>
          <p className="mt-4 max-w-3xl leading-7 text-slate-300">{CI_DIGEST_INTRO}</p>
          <p className="mt-2 text-sm text-slate-400">{CI_DIGEST_DELIVERY_LINE}</p>
        </header>

        <div className="mt-10 grid gap-6">
          {digests.length === 0 ? (
            <section className={cardClass}>
              <p className="leading-7 text-slate-300">{CI_DIGEST_EMPTY_LINE}</p>
            </section>
          ) : (
            digests.map((digest) => <DigestSection key={digest.repo} digest={digest} />)
          )}
        </div>
      </div>
    </main>
  );
}
