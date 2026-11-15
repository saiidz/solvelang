// AG-UI pilot: the Live Center board, expressed as AG-UI protocol
// events. This module is pure — it turns the board object the pilot
// already computed (the exact payload GET /customer/live-center/board
// passes through) into the event sequence an AG-UI client consumes,
// and encodes that sequence as server-sent events. It owns no state,
// performs no I/O, and never mutates the board it is given.
//
// The event model for a read-only board is deliberately small:
//   RUN_STARTED    — a board read ("run") begins; carries the
//                    thread/run identity the client sent (AG-UI's
//                    RunAgentInput) or server-minted ids.
//   STATE_SNAPSHOT — the whole board, once. The board computation
//                    produces a complete new board per read; there is
//                    no incremental server-side diff to stream, so a
//                    STATE_DELTA would be synthetic. A client that
//                    polls re-runs and receives a fresh snapshot.
//   RUN_FINISHED   — the read completed; the snapshot is final.
//   RUN_ERROR      — the board read failed after the run started
//                    (upstream unavailable). Emitted in-stream so an
//                    AG-UI client surfaces it through the same
//                    channel as every other event, instead of the
//                    JSON error shape the plain board route uses.
//
// SSE framing follows the AG-UI HTTP convention: one `data:` line per
// event carrying the event as JSON (the type travels inside the
// payload), a blank line between events.

import { randomUUID } from "node:crypto";

function cleanId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

// The run identity: the client's ids when it sent usable ones (the
// AG-UI RunAgentInput carries threadId/runId), otherwise fresh
// server-minted ids — a plain GET probe gets a well-formed run too.
export function agUiRunIds(input = {}) {
  return {
    threadId: cleanId(input?.threadId) ?? randomUUID(),
    runId: cleanId(input?.runId) ?? randomUUID(),
  };
}

export function agUiRunStarted({ threadId, runId }) {
  return { type: "RUN_STARTED", threadId, runId };
}

export function agUiStateSnapshot({ threadId, runId }, board) {
  return { type: "STATE_SNAPSHOT", threadId, runId, snapshot: board };
}

export function agUiRunFinished({ threadId, runId }) {
  return { type: "RUN_FINISHED", threadId, runId };
}

export function agUiRunError({ threadId, runId }, error) {
  return {
    type: "RUN_ERROR",
    threadId,
    runId,
    code: typeof error?.code === "string" ? error.code : "upstream_unavailable",
    message: "Live Center is temporarily unavailable.",
  };
}

// The full successful sequence for one board read.
export function agUiBoardEvents(ids, board) {
  return [agUiRunStarted(ids), agUiStateSnapshot(ids, board), agUiRunFinished(ids)];
}

// The failure sequence: the run started, then failed in-stream.
export function agUiBoardErrorEvents(ids, error) {
  return [agUiRunStarted(ids), agUiRunError(ids, error)];
}

export function encodeAgUiSse(events) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}
