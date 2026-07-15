"use client";

import { useEffect, useState } from "react";
import { downloadText, serializeTraces } from "../core/exports";
import type { ScenarioRun } from "../core/types";
import styles from "../studio.module.css";

export default function TracePanel({ run, onJumpToNode, compact = false }: { run: ScenarioRun | null; onJumpToNode: (id: string) => void; compact?: boolean }) {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || !run || compact) return;
    const timer = window.setInterval(() => setCursor((current) => {
      if (current >= run.trace.length - 1) { setPlaying(false); return current; }
      return current + 1;
    }), 700);
    return () => window.clearInterval(timer);
  }, [playing, run, compact]);
  if (!run) return <section className={compact ? styles.traceCompact : styles.viewPanel}><div className={styles.emptyState}><strong>No run trace</strong><p>Run a scenario to generate a deterministic trace.</p></div></section>;
  const visible = compact ? run.trace.slice(Math.max(0, run.trace.length - 4)) : run.trace;
  return (
    <section className={compact ? styles.traceCompact : styles.viewPanel} aria-label="Scenario run trace">
      <div className={styles.traceHeader}><div><p className={styles.eyebrow}>Run trace</p><h2>{run.scenarioName}</h2></div><div className={styles.headerActions}>{!compact ? <><button className={styles.secondaryButton} onClick={() => { setCursor(0); setPlaying(true); }}>Replay</button><button className={styles.secondaryButton} disabled={!playing} onClick={() => setPlaying(false)}>Pause</button><button className={styles.iconButton} onClick={() => { setPlaying(false); setCursor((value) => Math.max(0, value - 1)); }} aria-label="Previous trace event" title="Previous">←</button><span className={styles.zoomValue} aria-live="polite">{Math.min(cursor + 1, run.trace.length)}/{run.trace.length}</span><button className={styles.iconButton} onClick={() => { setPlaying(false); setCursor((value) => Math.min(run.trace.length - 1, value + 1)); }} aria-label="Next trace event" title="Next">→</button><button className={styles.secondaryButton} onClick={() => { setPlaying(false); setCursor(Math.max(0, run.trace.length - 1)); }}>End</button></> : null}<button className={styles.secondaryButton} onClick={() => downloadText(`${run.scenarioName.toLowerCase().replaceAll(" ", "-")}-trace.json`, serializeTraces([run]), "application/json")}>Download JSON</button></div></div>
      <div className={styles.traceTimeline}>{visible.map((event, index) => <button key={`${event.sequence}-${event.nodeId}`} className={`${styles.traceEvent} ${!compact && index === cursor ? styles.traceEventActive : ""}`} onClick={() => { setCursor(index); onJumpToNode(event.nodeId); }}><span className={styles.traceSequence}>{String(event.sequence).padStart(2, "0")}</span><div><strong>{event.action}</strong><small>{event.nodeType.replaceAll("_", " ")} · {event.durationEstimate}m{event.decision ? ` · ${event.decision}` : ""}</small>{event.humanReviewState === "paused" ? <em>Human review pause</em> : null}</div></button>)}</div>
      {!compact && run.trace[cursor] ? <div className={styles.traceDetail}><div><span>Inputs</span><strong>{run.trace[cursor].inputSummary}</strong></div><div><span>Outputs</span><strong>{run.trace[cursor].outputSummary}</strong></div><div><span>Policy</span><strong>{run.trace[cursor].policyResult}</strong></div><div><span>Review</span><strong>{run.trace[cursor].humanReviewState}</strong></div></div> : null}
    </section>
  );
}
