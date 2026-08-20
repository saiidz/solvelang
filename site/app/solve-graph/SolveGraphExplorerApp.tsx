"use client";

import { useMemo, useRef, useState } from "react";
import type { SolveGraphDocument, SolveGraphEdge, SolveGraphNode } from "./core/contracts";
import { loadSolveGraphDocumentText, MAX_LOCAL_SOLVE_GRAPH_BYTES } from "./core/document-io";
import { findLocalUnreachedCandidates } from "./core/unreachable-candidates";
import { createAffectedValidationCandidates } from "./core/affected-validations";
import {
  analyzeSolveGraphImpact,
  findSolveGraphNodes,
  traverseSolveGraph,
  type SolveGraphQueryIndex,
  type SolveGraphTraversalResult,
} from "./core/query-impact";

type LoadedState = { document: SolveGraphDocument; index: SolveGraphQueryIndex };

type GraphPoint = {
  node: SolveGraphNode;
  x: number;
  y: number;
};

function relationLabel(edge: SolveGraphEdge | undefined): string {
  return edge?.kind ?? "relationship";
}

function emptyTraversal(): SolveGraphTraversalResult {
  return { direction: "dependencies", roots: [], entries: [], truncated: false };
}

function neighborhoodPoints(selected: SolveGraphNode, neighbors: SolveGraphNode[]): GraphPoint[] {
  const points: GraphPoint[] = [{ node: selected, x: 50, y: 50 }];
  const bounded = neighbors.slice(0, 18);
  bounded.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(bounded.length, 1) - Math.PI / 2;
    points.push({ node, x: 50 + Math.cos(angle) * 37, y: 50 + Math.sin(angle) * 37 });
  });
  return points;
}

export default function SolveGraphExplorerApp() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("Choose a canonical Solve Graph JSON file. Nothing is uploaded or executed.");
  const [loading, setLoading] = useState(false);

  const matches = useMemo(() => {
    if (!loaded) return [];
    try {
      return findSolveGraphNodes(loaded.index, {
        ...(search.trim() ? { text: search.trim() } : {}),
        limit: 150,
      });
    } catch {
      return [];
    }
  }, [loaded, search]);

  const selected = selectedId && loaded ? loaded.index.nodesById.get(selectedId) ?? null : null;

  const dependencies = useMemo(() => {
    if (!loaded || !selected) return emptyTraversal();
    return traverseSolveGraph(loaded.index, [selected.id], "dependencies", { maxDepth: 1, maxResults: 80 });
  }, [loaded, selected]);

  const dependents = useMemo(() => {
    if (!loaded || !selected) return { ...emptyTraversal(), direction: "dependents" as const };
    return traverseSolveGraph(loaded.index, [selected.id], "dependents", { maxDepth: 1, maxResults: 80 });
  }, [loaded, selected]);

  const impact = useMemo(() => {
    if (!loaded || !selected) return { ...emptyTraversal(), direction: "dependents" as const };
    return analyzeSolveGraphImpact(loaded.index, [selected.id], { maxDepth: 4, maxResults: 200 });
  }, [loaded, selected]);
  const unreached = useMemo(() => !loaded || !selected ? null : findLocalUnreachedCandidates(loaded.index, [selected.id]), [loaded, selected]);

  const affectedValidations = useMemo(() => {
    if (!loaded || !selected) return null;
    return createAffectedValidationCandidates(loaded.index, impact);
  }, [loaded, selected, impact]);

  const neighborNodes = useMemo(() => {
    if (!loaded || !selected) return [];
    const ids = new Set<string>();
    for (const entry of [...dependencies.entries, ...dependents.entries]) {
      if (entry.id !== selected.id) ids.add(entry.id);
    }
    return [...ids].map((id) => loaded.index.nodesById.get(id)).filter((node): node is SolveGraphNode => Boolean(node));
  }, [loaded, selected, dependencies, dependents]);

  const points = useMemo(() => selected ? neighborhoodPoints(selected, neighborNodes) : [], [selected, neighborNodes]);
  const pointsById = useMemo(() => new Map(points.map((point) => [point.node.id, point])), [points]);
  const neighborhoodEdges = useMemo(() => {
    if (!loaded) return [];
    const ids = new Set(points.map((point) => point.node.id));
    return loaded.document.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  }, [loaded, points]);

  async function openFile(file: File) {
    setLoading(true);
    try {
      if (file.size > MAX_LOCAL_SOLVE_GRAPH_BYTES) throw new Error("Solve Graph JSON exceeds the 8 MB local explorer limit.");
      const next = await loadSolveGraphDocumentText(await file.text());
      setLoaded(next);
      setSearch("");
      setSelectedId(next.document.nodes[0]?.id ?? null);
      setMessage(`Loaded ${next.document.source.displayName}: ${next.document.nodes.length.toLocaleString()} nodes and ${next.document.edges.length.toLocaleString()} edges. Integrity verified locally.`);
    } catch (error) {
      setLoaded(null);
      setSelectedId(null);
      setMessage(error instanceof Error ? error.message : "Solve Graph could not be loaded.");
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-5 py-8 lg:px-8">
        <header className="flex flex-col gap-5 rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl shadow-black/20 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Solve Graph · local explorer</p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">See repository relationships without running the repository.</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">Load an integrity-valid <code className="rounded bg-slate-800 px-1.5 py-0.5">solvelang.graph.v0</code> document, search stable nodes, inspect direct relationships, and estimate bounded transitive impact. Processing stays in this browser tab.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void openFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={loading}
              className="rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
            >
              {loading ? "Verifying…" : loaded ? "Open another graph" : "Open graph JSON"}
            </button>
            {loaded ? (
              <button
                type="button"
                onClick={() => { setLoaded(null); setSelectedId(null); setSearch(""); setMessage("Graph cleared from this tab."); }}
                className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 hover:border-slate-500"
              >
                Clear
              </button>
            ) : null}
          </div>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 px-5 py-4 text-sm text-slate-300">
          <span className="font-medium text-slate-100">Local safety boundary:</span> {message}
        </section>

        {!loaded ? (
          <section className="grid gap-4 md:grid-cols-3">
            {[
              ["Integrity first", "The explorer rebuilds and verifies canonical graph identity, stable IDs, edge endpoints, and the SHA-256 integrity record before showing results."],
              ["Read-only", "Only analyze-only graphs with networkAccess=false and writeAccess=false are accepted. No repository code or workflow is executed."],
              ["Bounded queries", "Direct relationship views are depth 1. Impact analysis is capped at depth 4 and 200 results. Input is capped at 8 MB."],
            ].map(([title, detail]) => (
              <article key={title} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                <h2 className="font-semibold text-slate-100">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
              </article>
            ))}
          </section>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                ["Repository", loaded.document.source.displayName],
                ["Revision", loaded.document.source.revision],
                ["Nodes", loaded.document.nodes.length.toLocaleString()],
                ["Edges", loaded.document.edges.length.toLocaleString()],
                ["Scan", loaded.document.execution.truncated ? "Partial" : "Complete"],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-100" title={value}>{value}</p>
                </div>
              ))}
            </section>

            <section className="grid min-h-[650px] gap-5 xl:grid-cols-[330px_minmax(0,1fr)_360px]">
              <aside className="flex min-h-0 flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400" htmlFor="graph-search">Find nodes</label>
                <input
                  id="graph-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="file, symbol, route, test…"
                  className="mt-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none placeholder:text-slate-600 focus:border-sky-400"
                />
                <p className="mt-2 text-xs text-slate-500">Showing {matches.length} of {loaded.document.nodes.length.toLocaleString()} nodes.</p>
                <div className="mt-3 max-h-[560px] space-y-2 overflow-y-auto pr-1">
                  {matches.map((node) => (
                    <button
                      type="button"
                      key={node.id}
                      onClick={() => setSelectedId(node.id)}
                      className={`w-full rounded-xl border p-3 text-left transition ${selectedId === node.id ? "border-sky-400 bg-sky-400/10" : "border-slate-800 bg-slate-950/60 hover:border-slate-600"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="break-all text-sm font-medium text-slate-100">{node.label}</span>
                        <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{node.kind}</span>
                      </div>
                      <p className="mt-1 truncate font-mono text-[10px] text-slate-600">{node.id}</p>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Direct neighborhood</p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-100">{selected?.label ?? "Select a node"}</h2>
                  </div>
                  {selected ? <span className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300">{selected.kind}</span> : null}
                </div>

                {selected ? (
                  <div className="relative mt-5 aspect-[16/10] min-h-[420px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
                    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" role="img" aria-label="Selected node and direct Solve Graph relationships">
                      <defs>
                        <marker id="graph-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="currentColor" /></marker>
                      </defs>
                      {neighborhoodEdges.map((edge) => {
                        const from = pointsById.get(edge.from);
                        const to = pointsById.get(edge.to);
                        if (!from || !to) return null;
                        return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" className="text-slate-600" strokeWidth="0.45" markerEnd="url(#graph-arrow)" />;
                      })}
                    </svg>
                    {points.map((point) => (
                      <button
                        key={point.node.id}
                        type="button"
                        title={`${point.node.kind}: ${point.node.label}`}
                        onClick={() => setSelectedId(point.node.id)}
                        style={{ left: `${point.x}%`, top: `${point.y}%`, transform: "translate(-50%, -50%)" }}
                        className={`absolute max-w-[155px] rounded-xl border px-3 py-2 text-left shadow-xl transition ${point.node.id === selected.id ? "z-20 border-sky-300 bg-sky-300 text-slate-950" : "z-10 border-slate-600 bg-slate-900 text-slate-100 hover:border-slate-400"}`}
                      >
                        <span className="block truncate text-xs font-semibold">{point.node.label}</span>
                        <span className={`mt-0.5 block text-[9px] uppercase ${point.node.id === selected.id ? "text-slate-700" : "text-slate-500"}`}>{point.node.kind}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 grid min-h-[420px] place-items-center rounded-2xl border border-dashed border-slate-800 text-sm text-slate-500">Select a node from the search list.</div>
                )}
                <p className="mt-3 text-xs text-slate-500">The canvas shows at most 18 direct neighbors. Arrow direction follows the canonical edge direction.</p>
              </div>

              <aside className="space-y-4">
                {selected ? (
                  <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Selected node</p>
                    <p className="mt-2 break-words text-sm font-semibold text-slate-100">{selected.label}</p>
                    <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{selected.id}</p>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-slate-950 p-3"><span className="block text-slate-500">Dependencies</span><strong className="mt-1 block text-lg text-slate-100">{Math.max(0, dependencies.entries.length - 1)}</strong></div>
                      <div className="rounded-lg bg-slate-950 p-3"><span className="block text-slate-500">Dependents</span><strong className="mt-1 block text-lg text-slate-100">{Math.max(0, dependents.entries.length - 1)}</strong></div>
                    </div>
                  </section>
                ) : null}

                {selected ? (
                  <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Bounded impact</p>
                      {impact.truncated ? <span className="text-[10px] font-semibold uppercase text-amber-300">Truncated</span> : null}
                    </div>
                    <p className="mt-2 text-3xl font-semibold text-slate-100">{Math.max(0, impact.entries.length - 1)}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Transitive dependents up to depth 4 / 200 results using dependency-impact edge kinds.</p>
                    <div className="mt-3 max-h-60 space-y-2 overflow-y-auto">
                      {impact.entries.slice(1, 31).map((entry) => {
                        const node = loaded.index.nodesById.get(entry.id);
                        const edge = entry.viaEdgeId ? loaded.document.edges.find((item) => item.id === entry.viaEdgeId) : undefined;
                        return node ? (
                          <button key={entry.id} type="button" onClick={() => setSelectedId(entry.id)} className="w-full rounded-lg bg-slate-950 p-2.5 text-left hover:bg-slate-800">
                            <span className="block truncate text-xs text-slate-200">{node.label}</span>
                            <span className="mt-1 block text-[10px] text-slate-500">depth {entry.depth} · {relationLabel(edge)}</span>
                          </button>
                        ) : null;
                      })}
                    </div>
                  </section>
                ) : null}

                {selected && affectedValidations ? (
                  <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Affected validation candidates</p>
                      {affectedValidations.queryTruncated || affectedValidations.presentationTruncated ? <span className="text-[10px] font-semibold uppercase text-amber-300">Partial</span> : null}
                    </div>
                    <p className="mt-2 text-3xl font-semibold text-slate-100">{affectedValidations.summary.returnedCandidates}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Tests, workflows, and jobs found within the impact view (depth 4 / 200 results; panel limit 30).</p>
                    {affectedValidations.candidates.length > 0 ? (
                      <div className="mt-3 max-h-60 space-y-2 overflow-y-auto">
                        {affectedValidations.candidates.map((candidate) => {
                          const edge = candidate.viaEdgeId ? loaded.document.edges.find((item) => item.id === candidate.viaEdgeId) : undefined;
                          return (
                            <button key={candidate.node.id} type="button" onClick={() => setSelectedId(candidate.node.id)} className="w-full rounded-lg bg-slate-950 p-2.5 text-left hover:bg-slate-800">
                              <span className="flex items-center justify-between gap-2"><span className="truncate text-xs text-slate-200">{candidate.node.label}</span><span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase text-slate-400">{candidate.node.kind}</span></span>
                              <span className="mt-1 block text-[10px] text-slate-500">depth {candidate.depth} · {relationLabel(edge)}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : <p className="mt-3 text-xs leading-5 text-slate-500">No validation candidates were found within this complete or bounded local impact view.</p>}
                    <p className="mt-3 text-xs leading-5 text-slate-500">{affectedValidations.notice}</p>
                  </section>
                ) : null}
                {selected && unreached ? <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Structurally unreached candidates</p><p className="mt-2 text-3xl font-semibold text-slate-100">{unreached.candidates.length}</p><p className="mt-1 text-xs leading-5 text-slate-500">From selected local entrypoint · depth 8 / 200 results · panel limit 30.</p><div className="mt-3 max-h-60 space-y-2 overflow-y-auto">{unreached.candidates.map((node) => <button key={node.id} type="button" onClick={() => setSelectedId(node.id)} className="w-full rounded-lg bg-slate-950 p-2.5 text-left hover:bg-slate-800"><span className="block truncate text-xs text-slate-200">{node.label}</span><span className="text-[10px] text-slate-500">{node.kind}</span></button>)}</div><p className="mt-3 text-xs leading-5 text-slate-500">{unreached.notice}</p></section> : null}

                <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Graph identity</p>
                  <p className="mt-2 break-all font-mono text-[10px] leading-5 text-slate-500">{loaded.document.graphId}</p>
                  <p className="mt-3 text-xs leading-5 text-slate-500">Static evidence can show likely relationships and blast radius; it does not prove runtime behavior or authorize production changes.</p>
                </section>
              </aside>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
