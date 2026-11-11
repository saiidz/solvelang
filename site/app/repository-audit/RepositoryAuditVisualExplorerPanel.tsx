"use client";

import { useEffect, useMemo, useState } from "react";
import type { SolveGraphQueryIndex } from "../solve-graph/core/query-impact";
import { RepositoryAuditAffectedValidationPanel } from "./RepositoryAuditAffectedValidationPanel";
import { RepositoryAuditImpactExplanationPanel } from "./RepositoryAuditImpactExplanationPanel";
import { createRepositorySelectedNodeIntelligence } from "./core/selectedNodeIntelligence";
import {
  createRepositorySelectedNodeIntelligenceRequestKey,
  resolveRepositorySelectedNodeIntelligenceViewState,
  type RepositorySelectedNodeIntelligenceRequestState,
} from "./core/selectedNodeIntelligenceController";
import type {
  RepositoryAuditVisualExplorer,
  RepositoryAuditVisualExplorerNode,
} from "./core/visualExplorer";
import { createRepositoryAuditSelectedNodeImpactProduct } from "./core/selectedNodeImpact";
import { createRepositoryAuditVisualExplorerPresentation } from "./core/visualExplorerPresentation";
import type { RepositoryWorkflowPathEvidenceAnalysis } from "./core/workflowPathEvidence";

type RepositoryAuditVisualExplorerPanelProps = {
  explorer: RepositoryAuditVisualExplorer;
  impactIndex?: SolveGraphQueryIndex;
  workflowEvidence?: RepositoryWorkflowPathEvidenceAnalysis;
  className?: string;
};

type ExplorerKindFilter = RepositoryAuditVisualExplorerNode["kind"] | "all";

function visibleNodeLabel(node: RepositoryAuditVisualExplorerNode): string {
  return node.path ?? node.label;
}

export function RepositoryAuditVisualExplorerPanel({
  explorer,
  impactIndex,
  workflowEvidence,
  className = "",
}: RepositoryAuditVisualExplorerPanelProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ExplorerKindFilter>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [intelligenceState, setIntelligenceState] = useState<RepositorySelectedNodeIntelligenceRequestState>();

  const kinds = useMemo(
    () => [...new Set(explorer.nodes.map((node) => node.kind))].sort(),
    [explorer],
  );
  const presentation = useMemo(
    () => createRepositoryAuditVisualExplorerPresentation(explorer, {
      query,
      kinds: kind === "all" ? [] : [kind],
      selectedNodeId,
      maxNodes: 120,
      maxEdges: 240,
    }),
    [explorer, kind, query, selectedNodeId],
  );
  const visibleNodes = useMemo(
    () => new Map(presentation.nodes.map((node) => [node.id, node] as const)),
    [presentation.nodes],
  );
  const impactProduct = useMemo(() => {
    if (!impactIndex) return undefined;
    return createRepositoryAuditSelectedNodeImpactProduct(explorer, impactIndex, selectedNodeId, {
      maxDepth: 6,
      maxResults: 200,
      maxRows: 40,
    });
  }, [explorer, impactIndex, selectedNodeId]);
  const intelligenceRequestKey = useMemo(
    () => impactIndex
      ? createRepositorySelectedNodeIntelligenceRequestKey(
        explorer.graphId,
        workflowEvidence,
        selectedNodeId,
      )
      : undefined,
    [explorer.graphId, impactIndex, selectedNodeId, workflowEvidence],
  );

  useEffect(() => {
    if (!impactIndex || !workflowEvidence || !selectedNodeId || !intelligenceRequestKey) return;
    let cancelled = false;

    void createRepositorySelectedNodeIntelligence(
      explorer,
      impactIndex,
      workflowEvidence,
      selectedNodeId,
      {
        impact: { maxDepth: 6, maxResults: 200, maxRows: 40 },
        validation: {
          maxDepth: 6,
          maxTraversalResults: 200,
          maxTestsPerPath: 40,
          maxWorkflowsPerPath: 40,
        },
      },
    ).then((product) => {
      if (cancelled) return;
      setIntelligenceState({ requestKey: intelligenceRequestKey, product });
    }).catch((caught: unknown) => {
      if (cancelled) return;
      setIntelligenceState({
        requestKey: intelligenceRequestKey,
        error: caught instanceof Error ? caught.message : "Selected-node intelligence could not be composed.",
      });
    });

    return () => { cancelled = true; };
  }, [explorer, impactIndex, intelligenceRequestKey, selectedNodeId, workflowEvidence]);

  const intelligenceView = resolveRepositorySelectedNodeIntelligenceViewState(
    explorer.graphId,
    selectedNodeId,
    intelligenceRequestKey,
    intelligenceState,
  );
  const activeIntelligence = intelligenceView.product;
  const selectedImpactProduct = activeIntelligence?.impact ?? impactProduct;
  const intelligencePending = intelligenceView.pending;
  const intelligenceError = intelligenceView.error;

  return (
    <section className={`rounded-[2rem] border border-accent bg-accent-soft p-6 shadow-sm sm:p-8 ${className}`.trim()}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Local graph explorer</p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Browse bounded repository relationships</h2>
        </div>
        <p className="text-sm text-muted">
          {presentation.summary.shownNodes} node(s) · {presentation.summary.shownEdges} edge(s)
        </p>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-body">
        Filter the already-built analyze-only graph by safe node summary fields, then select a visible node to prioritize its direct visible neighbors. Filtering does not execute repository code or expand the bounded source graph.
      </p>

      <div className="mt-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem_auto]">
        <label className="grid gap-2 text-sm font-semibold text-body">
          Search visible nodes
          <input
            type="search"
            value={query}
            maxLength={64}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="path, label, or kind"
            className="rounded-xl border border-line-strong bg-panel px-4 py-3 font-normal text-ink outline-none ring-accent focus:ring-2"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-body">
          Node kind
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as ExplorerKindFilter)}
            className="rounded-xl border border-line-strong bg-panel px-4 py-3 font-normal text-ink outline-none ring-accent focus:ring-2"
          >
            <option value="all">All kinds</option>
            {kinds.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setKind("all");
            setSelectedNodeId(undefined);
          }}
          className="self-end rounded-xl border border-line-strong bg-panel px-4 py-3 text-sm font-semibold text-body hover:bg-panel-alt"
        >
          Reset explorer
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-body">
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.matchingNodes} matching</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.hiddenNodesByFilter} hidden by filter</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.hiddenNodesByLimit} hidden by node limit</span>
        <span className="rounded-full bg-panel px-3 py-1.5">{presentation.summary.hiddenEdgesByLimit} hidden by edge limit</span>
        {presentation.summary.selectedNodeShown ? <span className="rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent">{presentation.summary.directNeighborsShown} direct neighbor(s)</span> : null}
      </div>

      {presentation.status === "partial" ? (
        <p className="mt-4 rounded-xl border border-warning bg-warning-soft p-3 text-sm font-semibold text-warning">
          Explorer evidence is partial because the source graph or a presentation bound was reached. Filtered-out nodes are tracked separately and do not by themselves make the source evidence partial.
        </p>
      ) : null}
      {selectedNodeId && !presentation.summary.selectedNodeFound ? (
        <p className="mt-4 rounded-xl border border-line bg-panel p-3 text-sm text-body">
          The previous selection is not present in this explorer source. Reset or select another visible node.
        </p>
      ) : null}
      {presentation.summary.selectedNodeFound && !presentation.summary.selectedNodeShown ? (
        <p className="mt-4 rounded-xl border border-line bg-panel p-3 text-sm text-body">
          The selected node is currently hidden by the active filter or node limit.
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
        <div>
          <div className="flex items-end justify-between gap-3">
            <h3 className="text-lg font-semibold text-ink">Nodes</h3>
            <p className="text-xs text-muted">Select a row to prioritize visible relationships.</p>
          </div>
          <div className="mt-3 grid max-h-[34rem] gap-2 overflow-y-auto pr-1">
            {presentation.nodes.length ? presentation.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => setSelectedNodeId(node.selected ? undefined : node.id)}
                aria-pressed={node.selected}
                className={`rounded-2xl border p-4 text-left transition ${node.selected ? "border-accent bg-accent-soft" : node.directNeighbor ? "border-accent bg-panel" : "border-line bg-panel hover:border-line-strong"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-panel-alt px-2.5 py-1 text-xs font-bold uppercase text-body">{node.kind}</span>
                  <span className="text-xs font-semibold text-muted">{node.incoming} in · {node.outgoing} out</span>
                </div>
                <code className="mt-3 block break-all text-sm font-semibold text-ink">{visibleNodeLabel(node)}</code>
                {node.directNeighbor ? <p className="mt-2 text-xs font-semibold text-accent">Direct visible neighbor</p> : null}
              </button>
            )) : (
              <div className="rounded-2xl border border-dashed border-accent bg-panel p-8 text-center text-sm text-muted">
                No visible nodes match the current filters.
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-end justify-between gap-3">
            <h3 className="text-lg font-semibold text-ink">Visible relationships</h3>
            <p className="text-xs text-muted">Selected-node edges are listed first.</p>
          </div>
          <div className="mt-3 grid max-h-[34rem] gap-2 overflow-y-auto pr-1">
            {presentation.edges.length ? presentation.edges.map((edge) => {
              const from = visibleNodes.get(edge.from);
              const to = visibleNodes.get(edge.to);
              return (
                <article key={edge.id} className="rounded-2xl border border-line bg-panel p-4">
                  <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold uppercase text-accent">{edge.kind}</span>
                  <code className="mt-3 block break-all text-xs font-semibold text-body">{from ? visibleNodeLabel(from) : edge.from}</code>
                  <p className="my-1 text-xs text-muted">→</p>
                  <code className="block break-all text-xs font-semibold text-body">{to ? visibleNodeLabel(to) : edge.to}</code>
                </article>
              );
            }) : (
              <div className="rounded-2xl border border-dashed border-accent bg-panel p-8 text-center text-sm text-muted">
                No relationships are visible for the current bounded node set.
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedImpactProduct && impactIndex ? (
        <div className="mt-8">
          <p className="mb-3 text-xs font-semibold text-muted">
            Selected-node impact uses the canonical bounded graph, not the currently filtered explorer rows. Query cap: {selectedImpactProduct.request.maxResults ?? 200} result(s), depth {selectedImpactProduct.request.maxDepth ?? 6}; explanation cap: {selectedImpactProduct.request.presentationMaxRows ?? 40} row(s).
          </p>
          <RepositoryAuditImpactExplanationPanel
            index={impactIndex}
            result={selectedImpactProduct.query}
            options={{ maxRows: selectedImpactProduct.request.presentationMaxRows ?? 40 }}
          />
        </div>
      ) : impactIndex ? (
        <p className="mt-8 rounded-2xl border border-dashed border-violet-200 bg-panel p-5 text-sm text-muted">
          Select a visible node to explain its bounded dependent impact across the canonical analyzed graph.
        </p>
      ) : null}

      {intelligencePending ? (
        <p className="mt-4 rounded-xl border border-success bg-panel p-3 text-sm text-body">
          Mapping bounded affected tests and explicit workflow references for the selected node…
        </p>
      ) : null}
      {intelligenceError ? (
        <p role="alert" className="mt-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm font-semibold text-danger">
          Selected-node validation evidence was not shown: {intelligenceError}
        </p>
      ) : null}
      {activeIntelligence?.validation ? (
        <RepositoryAuditAffectedValidationPanel analysis={activeIntelligence.validation} className="mt-8" />
      ) : null}

      <p className="mt-5 text-xs leading-5 text-muted">
        Graph {presentation.graphId} · schema {presentation.schema} · network access disabled · write access disabled
      </p>
    </section>
  );
}
