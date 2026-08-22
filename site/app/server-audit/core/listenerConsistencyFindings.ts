import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

export type ServerAuditListenerConsistencyOptions = {
  maxFindings?: number;
};

const MAX_CONFLICT_EVIDENCE = 32;
const STABLE_HASH_OFFSET = 2166136261;

type ListenerEvidenceEntry = {
  index: number;
  ownership: string;
};

type ListenerGroup = {
  entriesObserved: number;
  firstOwnershipObserved: string;
  conflictingOwnershipObserved: boolean;
  identityHash: number;
  evidenceEntries: ListenerEvidenceEntry[];
  firstRetainedOwnership?: string;
  retainedConflictWitness: boolean;
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function updateStableHash(hash: number, input: string): number {
  let next = hash;
  for (let index = 0; index < input.length; index += 1) {
    next ^= input.charCodeAt(index);
    next = Math.imul(next, 16777619) >>> 0;
  }
  return next;
}

function stableHash(parts: readonly string[]): number {
  let hash = STABLE_HASH_OFFSET;
  parts.forEach((part, index) => {
    if (index > 0) hash = updateStableHash(hash, "\u001f");
    hash = updateStableHash(hash, part);
  });
  return hash;
}

function appendStableHashPart(hash: number, part: string): number {
  return updateStableHash(updateStableHash(hash, "\u001f"), part);
}

function stableId(parts: string[]): string {
  return stableIdFromHash(stableHash(parts));
}

function stableIdFromHash(hash: number): string {
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function compareFinding(left: ServerAuditFinding, right: ServerAuditFinding): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function siftWorstFindingUp(heap: ServerAuditFinding[], startIndex: number): void {
  let index = startIndex;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (compareFinding(heap[parentIndex], heap[index]) >= 0) return;
    [heap[parentIndex], heap[index]] = [heap[index], heap[parentIndex]];
    index = parentIndex;
  }
}

function siftWorstFindingDown(heap: ServerAuditFinding[]): void {
  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    if (leftIndex >= heap.length) return;
    const rightIndex = leftIndex + 1;
    let worstChildIndex = leftIndex;
    if (rightIndex < heap.length && compareFinding(heap[rightIndex], heap[leftIndex]) > 0) {
      worstChildIndex = rightIndex;
    }
    if (compareFinding(heap[index], heap[worstChildIndex]) >= 0) return;
    [heap[index], heap[worstChildIndex]] = [heap[worstChildIndex], heap[index]];
    index = worstChildIndex;
  }
}

function endpointKey(entry: NonNullable<ServerAuditSnapshot["listeningSockets"]>[number]): string {
  return `${entry.protocol.trim().toLowerCase()}\u001f${entry.localAddress.trim().toLowerCase()}\u001f${entry.port}`;
}

function ownershipKey(entry: NonNullable<ServerAuditSnapshot["listeningSockets"]>[number]): string {
  return entry.process?.trim() || "<unattributed>";
}

function compareSourceIndex(left: number, right: number): number {
  const leftKey = `${left}]`;
  const rightKey = `${right}]`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function retainEvidence(group: ListenerGroup, entry: ListenerEvidenceEntry): void {
  if (group.firstRetainedOwnership === undefined) group.firstRetainedOwnership = entry.ownership;
  const conflictsWithFirst = entry.ownership !== group.firstRetainedOwnership;

  if (group.evidenceEntries.length < MAX_CONFLICT_EVIDENCE) {
    group.evidenceEntries.push(entry);
    if (conflictsWithFirst) group.retainedConflictWitness = true;
    return;
  }

  if (conflictsWithFirst && !group.retainedConflictWitness) {
    group.evidenceEntries[group.evidenceEntries.length - 1] = entry;
    group.retainedConflictWitness = true;
  }
}

function boundedEvidence(group: ListenerGroup): ServerAuditFinding["evidence"] {
  const evidenceTruncated = group.entriesObserved > MAX_CONFLICT_EVIDENCE;
  const witnessLimit = evidenceTruncated ? MAX_CONFLICT_EVIDENCE - 1 : MAX_CONFLICT_EVIDENCE;
  const retained = group.evidenceEntries.slice(0, witnessLimit);

  if (group.conflictingOwnershipObserved && new Set(retained.map((entry) => entry.ownership)).size < 2) {
    const firstOwnership = retained[0]?.ownership;
    const opposite = group.evidenceEntries.find((entry) => entry.ownership !== firstOwnership);
    if (opposite !== undefined && retained.length > 0) retained[retained.length - 1] = opposite;
  }

  const evidence = retained.map((entry) => ({
    source: `listeningSockets[${entry.index}]`,
    summary: "duplicate endpoint has conflicting process attribution",
  }));
  if (evidenceTruncated) {
    evidence.push({
      source: "listeningSockets",
      summary: `duplicate endpoint evidence bounded to ${witnessLimit} of ${group.entriesObserved} structural witnesses`,
    });
  }
  return evidence;
}

export function createServerAuditListenerConsistencyFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditListenerConsistencyOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit listener-consistency maxFindings");
  const sockets = snapshot.listeningSockets;
  if (sockets === undefined) return [];

  const groups = new Map<string, ListenerGroup>();
  sockets.forEach((entry) => {
    const key = endpointKey(entry);
    const ownership = ownershipKey(entry);
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        entriesObserved: 0,
        firstOwnershipObserved: ownership,
        conflictingOwnershipObserved: false,
        identityHash: stableHash(["listener-consistency", "conflicting-ownership"]),
        evidenceEntries: [],
        retainedConflictWitness: false,
      };
      groups.set(key, group);
    }
    group.entriesObserved += 1;
    if (ownership !== group.firstOwnershipObserved) group.conflictingOwnershipObserved = true;
  });

  const sourceOrderedIndexes = Array.from({ length: sockets.length }, (_, index) => index).sort(compareSourceIndex);
  for (const index of sourceOrderedIndexes) {
    const entry = sockets[index];
    const group = groups.get(endpointKey(entry));
    if (group === undefined) continue;
    group.identityHash = appendStableHashPart(group.identityHash, `listeningSockets[${index}]`);
    retainEvidence(group, { index, ownership: ownershipKey(entry) });
  }

  const retainedFindings: ServerAuditFinding[] = [];
  let findingsObserved = 0;
  const recordFinding = (finding: ServerAuditFinding): void => {
    findingsObserved += 1;
    if (retainedFindings.length < maxFindings) {
      retainedFindings.push(finding);
      siftWorstFindingUp(retainedFindings, retainedFindings.length - 1);
      return;
    }
    if (compareFinding(finding, retainedFindings[0]) >= 0) return;
    retainedFindings[0] = finding;
    siftWorstFindingDown(retainedFindings);
  };

  for (const group of groups.values()) {
    if (group.entriesObserved < 2 || !group.conflictingOwnershipObserved || !group.retainedConflictWitness) continue;
    const evidenceTruncated = group.entriesObserved > MAX_CONFLICT_EVIDENCE;
    recordFinding({
      id: stableIdFromHash(group.identityHash),
      severity: "info",
      category: "evidence-integrity",
      title: "Listener inventory reports conflicting ownership",
      summary: `Multiple rows describe the same listening endpoint but disagree about process attribution. Collection timing, visibility, or duplicate evidence may explain the conflict.${evidenceTruncated ? ` The finding retains ${MAX_CONFLICT_EVIDENCE - 1} of ${group.entriesObserved} structural witness references plus an explicit evidence-bound marker while preserving at least two conflicting ownership states.` : ""}`,
      recommendation: "Re-collect socket and process inventory in one reviewed read-only run before attributing ownership or making an exposure decision.",
      evidence: boundedEvidence(group),
    });
  }

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= maxFindings) return retainedFindings;

  const bounded = retainedFindings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["listener-consistency", "findings-truncated", String(maxFindings), String(findingsObserved)]),
    severity: "info",
    category: "coverage",
    title: "Listener-consistency findings were truncated",
    summary: `The listener-consistency stage produced ${findingsObserved} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from listener ownership evidence.",
    evidence: [{ source: "listeningSockets", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
