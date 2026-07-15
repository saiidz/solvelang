"use client";

import { useMemo, useRef, useState } from "react";
import type { WorkflowDocument, WorkflowNode } from "../core/types";
import styles from "../studio.module.css";

const nodeLabels: Record<string, string> = { trigger: "Trigger", action: "Action", decision: "Decision", human_review: "Human review", approval: "Approval", system: "System", data_input: "Data input", data_output: "Data output", policy: "Policy", notification: "Notification", timer: "Timer", exception: "Exception", terminal: "Terminal" };

export default function WorkflowCanvas({ workflow, selectedNodeId, onSelectNode, onMoveNode, onAddNode, onDuplicateNode, onDeleteNode, onConnect }: {
  workflow: WorkflowDocument; selectedNodeId: string | null; onSelectNode: (id: string) => void;
  onMoveNode: (id: string, x: number, y: number) => void; onAddNode: () => void; onDuplicateNode: (id: string) => void;
  onDeleteNode: (id: string) => void; onConnect: (source: string, target: string) => void;
}) {
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 30, y: 30 });
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const nodeMap = useMemo(() => new Map(workflow.nodes.map((node) => [node.id, node])), [workflow.nodes]);

  const fit = () => {
    if (!workflow.nodes.length) return;
    const minX = Math.min(...workflow.nodes.map((node) => node.position.x));
    const minY = Math.min(...workflow.nodes.map((node) => node.position.y));
    setZoom(0.7); setPan({ x: 45 - minX * 0.7, y: 45 - minY * 0.7 });
  };

  const select = (node: WorkflowNode) => {
    if (connectingFrom && connectingFrom !== node.id) { onConnect(connectingFrom, node.id); setConnectingFrom(null); }
    onSelectNode(node.id);
  };

  const keyMove = (event: React.KeyboardEvent, node: WorkflowNode) => {
    const delta = event.shiftKey ? 40 : 12;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      onMoveNode(node.id, node.position.x + (event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0), node.position.y + (event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0));
    }
  };

  return (
    <section className={styles.canvasPanel} aria-label="Workflow canvas">
      <div className={styles.canvasToolbar}>
        <div className={styles.toolbarGroup}>
          <button onClick={onAddNode} className={styles.toolbarButton}>+ Add node</button>
          <button disabled={!selectedNodeId} onClick={() => selectedNodeId && onDuplicateNode(selectedNodeId)} className={styles.toolbarButton}>Duplicate</button>
          <button disabled={!selectedNodeId} onClick={() => selectedNodeId && setConnectingFrom(selectedNodeId)} className={connectingFrom ? styles.toolbarActive : styles.toolbarButton}>Connect</button>
          <button disabled={!selectedNodeId} onClick={() => selectedNodeId && onDeleteNode(selectedNodeId)} className={styles.toolbarButton}>Delete</button>
        </div>
        <div className={styles.toolbarGroup}>
          <button onClick={() => setZoom((value) => Math.max(0.4, value - 0.1))} className={styles.iconButton} aria-label="Zoom out" title="Zoom out">−</button>
          <span className={styles.zoomValue}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))} className={styles.iconButton} aria-label="Zoom in" title="Zoom in">+</button>
          <button onClick={fit} className={styles.toolbarButton}>Fit</button>
        </div>
      </div>
      {connectingFrom ? <div className={styles.canvasNotice}>Select a destination node. Escape cancels.</div> : null}
      <div
        className={styles.canvasViewport}
        onPointerDown={(event) => { if (event.target === event.currentTarget) { drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; event.currentTarget.setPointerCapture(event.pointerId); } }}
        onPointerMove={(event) => { if (drag.current) setPan({ x: drag.current.panX + event.clientX - drag.current.x, y: drag.current.panY + event.clientY - drag.current.y }); }}
        onPointerUp={() => { drag.current = null; }}
        onKeyDown={(event) => { if (event.key === "Escape") setConnectingFrom(null); }}
      >
        <div className={styles.canvasWorld} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <svg className={styles.edgeLayer} aria-hidden="true">
            <defs><marker id="studio-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#6f89aa" /></marker></defs>
            {workflow.edges.map((edge) => {
              const source = nodeMap.get(edge.source); const target = nodeMap.get(edge.target);
              if (!source || !target) return null;
              const x1 = source.position.x + 188; const y1 = source.position.y + 38; const x2 = target.position.x; const y2 = target.position.y + 38;
              const bend = Math.max(60, Math.abs(x2 - x1) * 0.45);
              return <g key={edge.id}><path d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`} className={edge.fallback ? styles.fallbackEdge : styles.edge} markerEnd="url(#studio-arrow)" /><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 7} className={styles.edgeLabel}>{edge.label || edge.condition}</text></g>;
            })}
          </svg>
          {workflow.nodes.map((node) => (
            <button key={`${node.id}-${workflow.nodes.indexOf(node)}`} className={`${styles.workflowNode} ${styles[`node_${node.type}`]} ${selectedNodeId === node.id ? styles.selectedNode : ""}`} style={{ left: node.position.x, top: node.position.y }} onClick={() => select(node)} onKeyDown={(event) => keyMove(event, node)} aria-pressed={selectedNodeId === node.id}>
              <span className={styles.nodeType}>{nodeLabels[node.type]}</span><strong>{node.title}</strong>
              <span className={styles.nodeMeta}>{node.owner || "Owner missing"}{node.humanRequired ? " · Human" : ""}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.mobileNodeList}>
        {workflow.nodes.map((node) => <button key={node.id} className={selectedNodeId === node.id ? styles.mobileNodeSelected : styles.mobileNode} onClick={() => select(node)}><span>{nodeLabels[node.type]}</span><strong>{node.title}</strong><small>{node.owner || "Owner missing"}</small></button>)}
      </div>
    </section>
  );
}
