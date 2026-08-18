import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

export type ServerAuditListenerConsistencyOptions = {
  maxFindings?: number;
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function compareFinding(left: ServerAuditFinding, right: ServerAuditFinding): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function endpointKey(entry: NonNullable<ServerAuditSnapshot["listeningSockets"]>[number]): string {
  return `${entry.protocol.trim().toLowerCase()}\u001f${entry.localAddress.trim().toLowerCase()}\u001f${entry.port}`;
}

export function createServerAuditListenerConsistencyFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditListenerConsistencyOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit listener-consistency maxFindings");
  const sockets = snapshot.listeningSockets;
  if (sockets === undefined) return [];

  const groups = new Map<string, number[]>();
  sockets.forEach((entry, index) => {
    const key = endpointKey(entry);
    const indexes = groups.get(key) ?? [];
    indexes.push(index);
    groups.set(key, indexes);
  });

  const candidates: ServerAuditFinding[] = [];
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const ownership = new Set(indexes.map((index) => sockets[index].process?.trim() || "<unattributed>"));
    if (ownership.size < 2) continue;

    const sources = indexes.map((index) => `listeningSockets[${index}]`).sort();
    candidates.push({
      id: stableId(["listener-consistency", "conflicting-ownership", ...sources]),
      severity: "info",
      category: "evidence-integrity",
      title: "Listener inventory reports conflicting ownership",
      summary: "Multiple rows describe the same listening endpoint but disagree about process attribution. Collection timing, visibility, or duplicate evidence may explain the conflict.",
      recommendation: "Re-collect socket and process inventory in one reviewed read-only run before attributing ownership or making an exposure decision.",
      evidence: sources.map((source) => ({
        source,
        summary: "duplicate endpoint has conflicting process attribution",
      })),
    });
  }

  candidates.sort(compareFinding);
  if (candidates.length <= maxFindings) return candidates;

  const bounded = candidates.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["listener-consistency", "findings-truncated", String(maxFindings), String(candidates.length)]),
    severity: "info",
    category: "coverage",
    title: "Listener-consistency findings were truncated",
    summary: `The listener-consistency stage produced ${candidates.length} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from listener ownership evidence.",
    evidence: [{ source: "listeningSockets", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
