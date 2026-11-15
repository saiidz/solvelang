"use client";

// The AG-UI pilot page: the Live Center board, delivered as an
// AG-UI protocol event stream and rendered from the stream's state
// — a proof of concept for the protocol, kept deliberately separate
// from the real Live Center page (which it does not change).
//
// How it works: the page first proves the customer session exactly
// like the board page does (GET /customer/account, which also yields
// the CSRF token the run's POST requires), then runs an AG-UI
// HttpAgent against POST /customer/live-center/ag-ui. The agent's
// STATE_SNAPSHOT event carries the board; the view is derived from
// it by the shared normalizer (see core/ag-ui-pilot.ts). The run
// repeats every 30 seconds, mirroring the board's own refresh.
//
// Read-only means read-only: the run is a board read, the page has
// no controls, and nothing on it can change anything. When the
// server-side pilot flag is off, the endpoint answers 503 and this
// page renders its plain not-enabled state — that is the production
// state of this pilot until the flag is deliberately turned on.

import { useEffect, useRef, useState } from "react";
import { HttpAgent } from "@ag-ui/client";
import { customerApi, normalizeApiBase } from "@/app/account/core/customer-api";
import type { CustomerDashboard } from "@/app/account/core/customer-api";
import { agUiPilotViewFromSnapshot, classifyAgUiFailure } from "@/app/account/core/ag-ui-pilot";
import type { AgUiPilotPhase, AgUiPilotView } from "@/app/account/core/ag-ui-pilot";
import { LC_PANEL } from "@/app/account/live-center/LiveCenterPrRows";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const REFRESH_MS = 30_000;
const AG_UI_PATH = "/customer/live-center/ag-ui";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className={LC_PANEL}>
      <p className="text-2xl font-semibold text-body">{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}

export function AgUiPilotBoard() {
  const [phase, setPhase] = useState<AgUiPilotPhase>("connecting");
  const [view, setView] = useState<AgUiPilotView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const csrfRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;

    // One diagnostic read, used only when a run fails at the
    // transport level (a non-stream answer): the endpoint's JSON
    // error code says which phase this is. The happy path never
    // takes it — it is pure AG-UI client.
    async function probeFailure(): Promise<AgUiPilotPhase> {
      try {
        const response = await fetch(`${API_BASE}${AG_UI_PATH}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as { code?: string };
        return classifyAgUiFailure(response.status, payload.code);
      } catch {
        return "failed";
      }
    }

    async function runOnce() {
      const agent = new HttpAgent({
        url: `${API_BASE}${AG_UI_PATH}`,
        headers: { "x-solvelang-csrf": csrfRef.current },
        fetch: (url, init) => fetch(url, { ...init, credentials: "include" }),
      });
      try {
        await agent.runAgent(
          {},
          {
            onStateSnapshotEvent: ({ event }) => {
              if (cancelled) return;
              setView(agUiPilotViewFromSnapshot(event.snapshot));
              setPhase("live");
            },
            onRunErrorEvent: ({ event }) => {
              if (cancelled) return;
              setErrorMessage(event.message ?? "The board stream reported an error.");
              setPhase("stream-error");
            },
          },
        );
      } catch {
        if (cancelled) return;
        // A run that never produced a snapshot and never ended in a
        // stream error failed at the transport level — classify it.
        const classified = await probeFailure();
        if (!cancelled) setPhase((current) => (current === "live" ? current : classified));
      }
    }

    async function start() {
      try {
        const dashboard = await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
        if (cancelled) return;
        csrfRef.current = dashboard.csrfToken;
      } catch (error) {
        if (cancelled) return;
        const status = (error as { status?: number })?.status;
        setPhase(status === 401 ? "unauthenticated" : "failed");
        return;
      }
      await runOnce();
    }

    void start();
    const timer = setInterval(() => {
      if (csrfRef.current) void runOnce();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-body">Live Center — AG-UI pilot</h1>
        <p className="max-w-3xl text-sm text-muted">
          This pilot renders the same merge-queue board as the Live Center, delivered as an{" "}
          <strong className="text-body">AG-UI protocol event stream</strong> instead of the usual board
          response, and drawn from the stream&apos;s state. It is <strong className="text-body">read-only</strong>:
          the stream only ever reads the board, and this page has no controls — nothing here can change
          anything.
        </p>
      </header>

      {phase === "connecting" && (
        <section className={LC_PANEL} aria-label="AG-UI pilot status">
          <p className="text-sm text-muted">Connecting to the board stream — first proving your session, then starting the run…</p>
        </section>
      )}

      {phase === "unauthenticated" && (
        <section className={LC_PANEL} aria-label="AG-UI pilot status">
          <p className="text-sm text-body">You need to sign in to view this pilot.</p>
          <p className="mt-1 text-sm text-muted">The board stream requires the same signed-in session as the rest of your account.</p>
        </section>
      )}

      {phase === "disabled" && (
        <section className={LC_PANEL} aria-label="AG-UI pilot status">
          <p className="text-sm text-body">The AG-UI pilot is not enabled on this server.</p>
          <p className="mt-1 text-sm text-muted">
            The stream sits behind a server-side flag that is off, so the endpoint refuses and there is no
            board to render. The regular Live Center is unaffected.
          </p>
        </section>
      )}

      {(phase === "stream-error" || phase === "failed") && (
        <section className={LC_PANEL} aria-label="AG-UI pilot status">
          <p className="text-sm text-body">The board stream could not be read.</p>
          <p className="mt-1 text-sm text-muted">
            {phase === "stream-error" && errorMessage ? errorMessage : "The run failed before a board arrived. The regular Live Center is unaffected."}
          </p>
        </section>
      )}

      {phase === "live" && view && (
        <>
          <section aria-label="Board counts" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Open pull requests" value={String(view.counts.openPrs)} />
            <Tile label="In the merge queue" value={String(view.counts.inQueue)} />
            <Tile label="Checking" value={String(view.counts.checking)} />
            <Tile label="Failing" value={String(view.counts.failing)} />
            <Tile label="Ready to merge" value={String(view.counts.ready)} />
            <Tile label="Waiting on the owner" value={String(view.counts.waitingOnOwner)} />
            <Tile
              label="Runners online"
              value={view.counts.runnersTotal === null ? String(view.counts.runnersOnline) : `${view.counts.runnersOnline} of ${view.counts.runnersTotal}`}
            />
            <Tile label="Runners busy" value={String(view.counts.runnersBusy)} />
          </section>

          <section className={LC_PANEL} aria-label="Merge queue from the stream">
            <h2 className="text-sm font-semibold text-body">
              Merge queue{view.repoLabel ? ` — ${view.repoLabel}` : ""}
            </h2>
            {view.paused && <p className="mt-1 text-xs text-muted">The queue is paused.</p>}
            {view.frozen && <p className="mt-1 text-xs text-muted">The queue is inside a scheduled freeze window.</p>}
            {view.queue.length === 0 ? (
              <p className="mt-2 text-sm text-muted">The queue is empty.</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {view.queue.map((entry) => (
                  <li key={`${entry.position}-${entry.number ?? "none"}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="text-muted">{entry.position}.</span>
                    {entry.number !== null && <span className="font-medium text-body">#{entry.number}</span>}
                    <span className="text-body">{entry.title}</span>
                    <span className="text-xs text-muted">{entry.stageLabel}</span>
                  </li>
                ))}
              </ol>
            )}
            {view.queueTotal > view.queue.length && (
              <p className="mt-2 text-xs text-muted">
                Showing the first {view.queue.length} of {view.queueTotal} in the queue.
              </p>
            )}
          </section>

          <section className={LC_PANEL} aria-label="Runners from the stream">
            <h2 className="text-sm font-semibold text-body">Runners</h2>
            {view.runners.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No runner fleet is reported on this board.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {view.runners.map((runner) => (
                  <li key={runner.name} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="text-body">{runner.name}</span>
                    <span className="text-xs text-muted">
                      {runner.status === "online" ? "Online" : "Offline"}
                      {runner.busy ? " · Busy" : " · Idle"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {view.generatedAt && (
            <p className="text-xs text-muted">Board generated at {view.generatedAt}, delivered as AG-UI events (RUN_STARTED, STATE_SNAPSHOT, RUN_FINISHED).</p>
          )}
        </>
      )}
    </main>
  );
}
