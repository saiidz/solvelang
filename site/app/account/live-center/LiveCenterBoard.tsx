"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  normalizeApiBase,
} from "@/app/account/core/customer-api";
import {
  type LiveCenterBoardView,
  normalizeLiveCenterBoard,
} from "@/app/account/core/live-center";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);

type Phase = "loading" | "ready" | "not-configured" | "signed-out" | "error";

function prHeading(number: number | null, title: string): string {
  const label = number !== null ? `#${number}` : "PR";
  return title ? `${label} ${title}` : label;
}

export function LiveCenterBoard() {
  const startedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [board, setBoard] = useState<LiveCenterBoardView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;

    async function load() {
      try {
        // The session gate comes first, exactly like the other account
        // pages: this call fails with 401 invalid_session unless the
        // customer is signed in, and the board is never requested
        // without a proven session. There is no guest view.
        await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
        const raw = await customerApi<unknown>(API_BASE, "/customer/live-center/board", { method: "GET" });
        if (!active) return;
        setBoard(normalizeLiveCenterBoard(raw));
        setPhase("ready");
      } catch (caught) {
        if (!active) return;
        if (caught instanceof CustomerApiError && caught.status === 503 && caught.code === "mgov_not_configured") {
          setPhase("not-configured");
          return;
        }
        if (caught instanceof CustomerApiError && caught.status === 401) {
          setPhase("signed-out");
          return;
        }
        setError(caught instanceof Error ? caught.message : "The Live Center could not be loaded.");
        setPhase("error");
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/account/api-keys/" className="text-sm font-semibold text-slate-300 hover:text-white">
          Back to your account
        </Link>

        <header className="mt-8">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">SolveLang Process Solution</p>
          <h1 className="mt-3 text-3xl font-bold">Live Center</h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            Your merge queue, pull request checks, runners, and everything waiting on you
            {board?.repoLabel ? <> for <strong className="text-white">{board.repoLabel}</strong></> : null} — in one place.
          </p>
        </header>

        {phase === "loading" ? (
          <div className="mt-10 grid min-h-[240px] place-items-center rounded-[2rem] border border-white/10 bg-white/5 text-sm font-medium text-slate-300">
            Loading your Live Center…
          </div>
        ) : null}

        {phase === "not-configured" ? (
          <div className="mt-10 rounded-[2rem] border border-white/10 bg-white/5 p-7 text-slate-200">
            <h2 className="text-xl font-bold text-white">Live Center is not switched on yet</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              The Live Center is not switched on for this account yet. When your repository is connected and
              governance is running, your queue, checks, runners, and open actions will appear here.
            </p>
          </div>
        ) : null}

        {phase === "signed-out" ? (
          <div className="mt-10 rounded-[2rem] border border-white/10 bg-white/5 p-7 text-slate-200">
            <h2 className="text-xl font-bold text-white">Sign in to see your Live Center</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Your session has ended. <Link className="underline" href="/account/api-keys/">Sign in from your account page</Link> and
              this board will load with your queue.
            </p>
          </div>
        ) : null}

        {phase === "error" ? (
          <div role="alert" className="mt-10 rounded-[2rem] border border-red-300/30 bg-red-500/10 p-7 text-sm font-medium text-red-100">
            <p>{error || "The Live Center could not be loaded. Try again in a moment."}</p>
          </div>
        ) : null}

        {phase === "ready" && board ? (
          <div className="mt-10 grid gap-8">
            <section aria-labelledby="live-center-queue" className="rounded-[2rem] border border-white/10 bg-white/5 p-7">
              <h2 id="live-center-queue" className="text-xl font-bold">Merge queue</h2>
              {board.queue.length === 0 ? (
                <p className="mt-4 text-sm text-slate-300">The merge queue is empty. Nothing is waiting to land.</p>
              ) : (
                <ol className="mt-5 space-y-3">
                  {board.queue.map((entry, index) => (
                    <li key={`${entry.number ?? "pr"}-${index}`} className="flex flex-wrap items-baseline justify-between gap-3 rounded-2xl bg-slate-900/60 px-5 py-4">
                      <span className="text-sm font-semibold text-white">
                        <span className="mr-3 text-cyan-300">{entry.position}.</span>
                        {prHeading(entry.number, entry.title)}
                      </span>
                      {entry.state ? <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">{entry.state}</span> : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-labelledby="live-center-prs" className="rounded-[2rem] border border-white/10 bg-white/5 p-7">
              <h2 id="live-center-prs" className="text-xl font-bold">Pull requests</h2>
              {board.pullRequests.length === 0 ? (
                <p className="mt-4 text-sm text-slate-300">No open pull requests are being governed right now.</p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {board.pullRequests.map((pr, index) => (
                    <li key={`${pr.number ?? "pr"}-${index}`} className="rounded-2xl bg-slate-900/60 px-5 py-4">
                      <p className="text-sm font-semibold text-white">{prHeading(pr.number, pr.title)}</p>
                      <p className="mt-2 text-sm text-slate-300">
                        Checks: {pr.passed} passed, {pr.failed} failed, {pr.pending} pending.
                      </p>
                      {pr.failing.length > 0 ? (
                        <p className="mt-1 text-sm text-red-200">Failing: {pr.failing.join(", ")}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="live-center-runners" className="rounded-[2rem] border border-white/10 bg-white/5 p-7">
              <h2 id="live-center-runners" className="text-xl font-bold">Runners at work</h2>
              {board.jobs.length === 0 ? (
                <p className="mt-4 text-sm text-slate-300">No jobs are running right now.</p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {board.jobs.map((job, index) => (
                    <li key={`${job.name}-${index}`} className="flex flex-wrap items-baseline justify-between gap-3 rounded-2xl bg-slate-900/60 px-5 py-4">
                      <span className="text-sm font-semibold text-white">{job.name}</span>
                      <span className="text-sm text-slate-300">
                        {job.runnerName ? <>on {job.runnerName}</> : "waiting for a runner"}
                        {job.status ? <> — {job.status}</> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="live-center-actions" className="rounded-[2rem] border border-cyan-300/20 bg-gradient-to-b from-cyan-300/10 to-white/5 p-7">
              <h2 id="live-center-actions" className="text-xl font-bold">Needed from you</h2>
              {board.ownerActions.length === 0 ? (
                <p className="mt-4 text-sm text-slate-300">Nothing is waiting on you. The queue can move without you.</p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {board.ownerActions.map((action, index) => (
                    <li key={`${action.label}-${index}`} className="rounded-2xl bg-slate-900/60 px-5 py-4">
                      {action.label ? <p className="text-sm font-semibold text-white">{action.label}</p> : null}
                      <p className="mt-1 text-sm text-slate-200">{action.waitingOn || "Waiting on your decision."}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
