"use client";

import { NODE_TYPES, type WorkflowDocument, type WorkflowEdge, type WorkflowNode } from "../core/types";
import styles from "../studio.module.css";

export default function Inspector({ workflow, selectedNodeId, onUpdateNode, onUpdateEdge, onDeleteEdge, onSelectNode }: {
  workflow: WorkflowDocument; selectedNodeId: string | null; onUpdateNode: (node: WorkflowNode) => void;
  onUpdateEdge: (edge: WorkflowEdge) => void; onDeleteEdge: (id: string) => void; onSelectNode: (id: string) => void;
}) {
  const node = workflow.nodes.find((item) => item.id === selectedNodeId) ?? null;
  const outgoing = workflow.edges.filter((edge) => edge.source === selectedNodeId);
  const update = (patch: Partial<WorkflowNode>) => node && onUpdateNode({ ...node, ...patch });

  return (
    <aside className={styles.inspector} aria-label="Contextual workflow inspector">
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Inspector</p><h2>{node ? node.title : "Select a node"}</h2></div></div>
      {!node ? <div className={styles.emptyState}><strong>Nothing selected</strong><p>Select a node on the canvas or in the mobile list to inspect its operational details.</p></div> : (
        <div className={styles.inspectorBody}>
          <label className={styles.field}><span>Title</span><input value={node.title} onChange={(event) => update({ title: event.target.value })} /></label>
          <label className={styles.field}><span>Node type</span><select value={node.type} onChange={(event) => update({ type: event.target.value as WorkflowNode["type"] })}>{NODE_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
          <label className={styles.field}><span>Description</span><textarea value={node.description} rows={3} onChange={(event) => update({ description: event.target.value })} /></label>
          <div className={styles.twoFields}>
            <label className={styles.field}><span>Owner</span><input value={node.owner} onChange={(event) => update({ owner: event.target.value })} /></label>
            <label className={styles.field}><span>System</span><input value={node.system} onChange={(event) => update({ system: event.target.value })} /></label>
          </div>
          <div className={styles.twoFields}>
            <label className={styles.field}><span>SLA minutes</span><input type="number" min="0" value={node.slaMinutes ?? ""} onChange={(event) => update({ slaMinutes: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            <label className={styles.field}><span>Risk</span><select value={node.riskLevel} onChange={(event) => update({ riskLevel: event.target.value as WorkflowNode["riskLevel"] })}><option>low</option><option>medium</option><option>high</option><option>critical</option></select></label>
          </div>
          <label className={styles.checkbox}><input type="checkbox" checked={node.humanRequired} onChange={(event) => update({ humanRequired: event.target.checked })} /><span>Human review required</span></label>
          <label className={styles.field}><span>Inputs (comma separated)</span><input value={node.inputs.join(", ")} onChange={(event) => update({ inputs: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label>
          <label className={styles.field}><span>Outputs (comma separated)</span><input value={node.outputs.join(", ")} onChange={(event) => update({ outputs: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label>
          <label className={styles.field}><span>Policy references</span><input value={node.policyRefs.join(", ")} onChange={(event) => update({ policyRefs: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label>
          {node.type === "approval" ? <label className={styles.field}><span>Approver</span><input value={node.metadata.approver ?? ""} onChange={(event) => update({ metadata: { ...node.metadata, approver: event.target.value } })} /></label> : null}
          {node.type === "notification" ? <label className={styles.field}><span>Recipient</span><input value={node.metadata.recipient ?? ""} onChange={(event) => update({ metadata: { ...node.metadata, recipient: event.target.value } })} /></label> : null}

          <div className={styles.subsection}><h3>Outgoing branches</h3>{outgoing.length ? outgoing.map((edge) => (
            <div key={edge.id} className={styles.edgeEditor}>
              <button className={styles.edgeTarget} onClick={() => onSelectNode(edge.target)}>→ {workflow.nodes.find((item) => item.id === edge.target)?.title ?? edge.target}</button>
              <label className={styles.field}><span>Label</span><input value={edge.label} onChange={(event) => onUpdateEdge({ ...edge, label: event.target.value })} /></label>
              <label className={styles.field}><span>Condition / outcome</span><input value={edge.condition} onChange={(event) => onUpdateEdge({ ...edge, condition: event.target.value })} /></label>
              <label className={styles.field}><span>Priority</span><input type="number" value={edge.priority} onChange={(event) => onUpdateEdge({ ...edge, priority: Number(event.target.value) })} /></label>
              <label className={styles.checkbox}><input type="checkbox" checked={edge.fallback} onChange={(event) => onUpdateEdge({ ...edge, fallback: event.target.checked })} /><span>Fallback branch</span></label>
              <button className={styles.dangerButton} onClick={() => { if (window.confirm(`Delete branch ${edge.label || edge.id}?`)) onDeleteEdge(edge.id); }}>Delete branch</button>
            </div>
          )) : <p className={styles.muted}>No outgoing branches.</p>}</div>
        </div>
      )}
    </aside>
  );
}
