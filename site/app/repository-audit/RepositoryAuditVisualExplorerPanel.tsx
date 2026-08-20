"use client";

import { useMemo, useState } from "react";
import type { SolveGraphQueryIndex } from "../solve-graph/core/query-impact";
import { RepositoryAuditImpactExplanationPanel } from "./RepositoryAuditImpactExplanationPanel";
import type {
  RepositoryAuditVisualExplorer,
  RepositoryAuditVisualExplorerNode,
} from "./core/visualExplorer";
import { createRepositoryAuditSelectedNodeImpactProduct } from "./core/selectedNodeImpact";
import { createRepositoryAuditVisualExplorerPresentation } from "./core/visualExplorerPresentation";

type RepositoryAuditVisualExplorerPanelProps = {
  explorer: RepositoryAuditVisualExplorer;
  impactIndex?: SolveGraphQueryIndex;
  className?: string;
};

type ExplorerKindFilter = RepositoryAuditVisualExplorerNode["kind"] | "all";

function visibleNodeLabel(node: RepositoryAuditVisualExplorerNode): string {
  return node.path ?? node.label;
}

export function RepositoryAuditVisualExplorerPanel({
  explorer,
  impactIndex,
  className = "",
}: RepositoryAuditVisualExplorerPanelProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ExplorerKindFilter>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string>();

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

  return (
    <section className={`rounded-[2rem] border border-cyan-200 bg-cyan-50 p-6 shadow-sm sm:p-8 ${className}`.trim()}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-800">Local graph explorer</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Browse bounded repository relationships</h2>
        </div>
        <p className="text-sm text-slate-600">
          {presentation.summary.shownNodes} node(s) · {presentation.summary.shownEdges} edge(s)
        </p>
      </div>

      <p className="mt-3 max-w-4xl leading-7 text-slate-700">
        Filter the already-built analyze-only graph by safe node summary fields, then select a visible node to prioritize its direct visible neighbors. Filtering does not execute repository code or expand the bounded source graph.
      </p>

      <div className="mt-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem_auto]">
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Search visible nodes
          <input
            type="search"
            value={query}
            maxLength={64}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="path, label, or kind"
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal text-slate-950 outline-none ring-cyan-500 focus:ring-2"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Node kind
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as ExplorerKindFilter)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal text-slate-950 outline-none ring-cyan-500 focus:ring-2"
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
          className="self-end rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          Reset explorer
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.matchingNodes} matching</span>
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.hiddenNodesByFilter} hidden by filter</span>
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.hiddenNodesByLimit} hidden by node limit</span>
        <span className="rounded-full bg-white px-3 py-1.5">{presentation.summary.hiddenEdgesByLimit} hidden by edge limit</span>
        {presentation.summary.selectedNodeShown ? <span className="rounded-full bg-cyan-100 px-3 py-1.5 text-cyan-900">{presentation.summary.directNeighborsShown} direct neighbor(s)</span> : null}
      </div>

      {presentation.status === "partial" ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          Explorer evidence is partial because the source graph or a presentation bound was reached. Filtered-out nodes are tracked separately and do not by themselves make the source evidence partial.
        </p>
      ) : null}
      {selectedNodeId && !presentation.summary.selectedNodeFound ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
          The previous selection is not present in this explorer source. Reset or select another visible node.
        </p>
      ) : null}
      {presentation.summary.selectedNodeFound && !presentation.summary.selectedNodeShown ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
          The selected node is currently hidden by the active filter or node limit.
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
        <div>
          <div className="flex items-end justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-950">Nodes</h3>
            <p className="text-xs text-slate-500">Select a row to prioritize visible relationships.</p>
          </div>
          <div className="mt-3 grid max-h-[34rem] gap-2 overflow-y-auto pr-1">
            {presentation.nodes.length ? presentation.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => setSelectedNodeId(node.selected ? undefined : node.id)}
                aria-pressed={node.selected}
                className={`rounded-2xl border p-4 text-left transition ${node.selected ? "border-cyan-500 bg-cyan-100" : node.directNeighbor ? "border-cyan-200 bg-white" : "border-slate-200 bg-white hover:border-slate-400"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold uppercase text-slate-700">{node.kind}</span>
                  <span className="text-xs font-semibold text-slate-500">{node.incoming} in · {node.outgoing} out</span>
                </div>
                <code className="mt-3 block break-all text-sm font-semibold text-slate-950">{visibleNodeLabel(node)}</code>
                {node.directNeighbor ? <p className="mt-2 text-xs font-semibold text-cyan-800">Direct visible neighbor</p> : null}
              </button>
            )) : (
              <div className="rounded-2xl border border-dashed border-cyan-200 bg-white p-8 text-center text-sm text-slate-500">
                No visible nodes match the current filters.
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-end justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-950">Visible relationships</h3>
            <p className="text-xs text-slate-500">Selected-node edges are listed first.</p>
          </div>
          <div className="mt-3 grid max-h-[34rem] gap-2 overflow-y-auto pr-1">
            {presentation.edges.length ? presentation.edges.map((edge) => {
              const from = visibleNodes.get(edge.from);
              const to = visibleNodes.get(edge.to);
              return (
                <article key={edge.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-bold uppercase text-cyan-900">{edge.kind}</span>
                  <code className="mt-3 block break-all text-xs font-semibold text-slate-800">{from ? visibleNodeLabel(from) : edge.from}</code>
                  <p className="my-1 text-xs text-slate-400">→</p>
                  <code className="block break-all text-xs font-semibold text-slate-800">{to ? visibleNodeLabel(to) : edge.to}</code>
                </article>
              );
            }) : (
              <div className="rounded-2xl border border-dashed border-cyan-200 bg-white p-8 text-center text-sm text-slate-500">
                No relationships are visible for the current bounded node set.
              </div>
            )}
          </div>
        </div>
      </div>

      {impactProduct && impactIndex ? (
        <div className="mt-8">
          <p className="mb-3 text-xs font-semibold text-slate-600">
            Selected-node impact uses the canonical bounded graph, not the currently filtered explorer rows. Query cap: {impactProduct.request.maxResults ?? 200} result(s), depth {impactProduct.request.maxDepth ?? 6}; explanation cap: {impactProduct.request.presentationMaxRows ?? 40} row(s).
          </p>
          <RepositoryAuditImpactExplanationPanel
            index={impactIndex}
            result={impactProduct.query}
            options={{ maxRows: impactProduct.request.presentationMaxRows ?? 40 }}
          />
        </div>
      ) : impactIndex ? (
        <p className="mt-8 rounded-2xl border border-dashed border-violet-200 bg-white p-5 text-sm text-slate-600">
          Select a visible node to explain its bounded dependent impact across the canonical analyzed graph.
        </p>
      ) : null}

      <p className="mt-5 text-xs leading-5 text-slate-500">
        Graph {presentation.graphId} · schema {presentation.schema} · network access disabled · write access disabled
      </p>
    </section>
  );
}
