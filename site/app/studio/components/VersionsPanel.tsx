"use client";

import { useState } from "react";
import { compareVersions } from "../core/versions";
import type { VersionSnapshot } from "../core/types";
import styles from "../studio.module.css";

export default function VersionsPanel({ versions, onRestore, onDuplicate }: { versions: VersionSnapshot[]; onRestore: (version: VersionSnapshot) => void; onDuplicate: (version: VersionSnapshot) => void }) {
  const [selected, setSelected] = useState(versions[0]?.id ?? "");
  const [compareId, setCompareId] = useState(versions[1]?.id ?? versions[0]?.id ?? "");
  const current = versions.find((item) => item.id === selected) ?? versions[0];
  const compare = versions.find((item) => item.id === compareId);
  const result = current && compare ? compareVersions(compare, current) : null;
  return (
    <section className={styles.viewPanel} aria-labelledby="versions-title">
      <div className={styles.viewHeader}><div><p className={styles.eyebrow}>Local version history</p><h1 id="versions-title">Restore with evidence</h1><p>Meaningful autosaves are deduplicated and retained locally.</p></div></div>
      <div className={styles.versionLayout}><nav className={styles.versionList}>{versions.map((version) => <button key={version.id} className={current?.id === version.id ? styles.versionSelected : ""} onClick={() => setSelected(version.id)}><strong>{version.label}</strong><span>{new Date(version.timestamp).toLocaleString()}</span><small>{version.nodeCount} nodes · score {version.scoreSnapshot}</small></button>)}</nav>{current ? <div className={styles.versionDetail}><div className={styles.versionHero}><div><p className={styles.eyebrow}>Selected snapshot</p><h2>{current.label}</h2><p>{current.summary}</p></div><div className={styles.headerActions}><button className={styles.secondaryButton} onClick={() => onDuplicate(current)}>Duplicate project</button><button className={styles.dangerButton} onClick={() => { if (window.confirm(`Restore ${current.label}? Your current workflow will be preserved as a version first.`)) onRestore(current); }}>Restore</button></div></div><label className={styles.field}><span>Compare with</span><select value={compareId} onChange={(event) => setCompareId(event.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.label} — {new Date(version.timestamp).toLocaleString()}</option>)}</select></label>{result ? <div className={styles.changeGrid}><div><span>Nodes added</span><strong>{result.nodesAdded.length}</strong></div><div><span>Nodes removed</span><strong>{result.nodesRemoved.length}</strong></div><div><span>Nodes modified</span><strong>{result.nodesModified.length}</strong></div><div><span>Edges added</span><strong>{result.edgesAdded.length}</strong></div><div><span>Edges removed</span><strong>{result.edgesRemoved.length}</strong></div><div><span>Score change</span><strong>{result.scoreChange > 0 ? "+" : ""}{result.scoreChange}</strong></div><div><span>Policy changes</span><strong>{result.policiesChanged.length}</strong></div><div><span>Scenarios changed</span><strong>{result.scenariosChanged ? "Yes" : "No"}</strong></div></div> : null}</div> : <div className={styles.emptyState}><strong>No versions yet</strong><p>Edit the workflow to create a local snapshot.</p></div>}</div>
    </section>
  );
}
