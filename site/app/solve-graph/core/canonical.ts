import { sha256Hex } from "../../repository-audit/core/ingestion";
import {
  SOLVE_GRAPH_ENGINE,
  SOLVE_GRAPH_SCHEMA,
  solveGraphEdgeKinds,
  solveGraphEvidenceKinds,
  solveGraphNodeKinds,
  type SolveGraphDocument,
  type SolveGraphEdge,
  type SolveGraphEdgeKind,
  type SolveGraphEvidence,
  type SolveGraphExtractor,
  type SolveGraphMetadata,
  type SolveGraphMetadataValue,
  type SolveGraphNode,
  type SolveGraphNodeKind,
  type SolveGraphScanLimits,
  type SolveGraphSource,
  type SolveGraphTruncationReason,
} from "./contracts";
import { defaultSolveGraphScanLimits, normalizeSolveGraphPath, validateSolveGraphScanLimits } from "./limits";

const encoder = new TextEncoder();
const nodeKindSet = new Set<string>(solveGraphNodeKinds);
const edgeKindSet = new Set<string>(solveGraphEdgeKinds);
const evidenceKindSet = new Set<string>(solveGraphEvidenceKinds);
const sensitiveMetadataKey = /(secret|password|passwd|token|credential|private.?key|api.?key)/i;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function canonicalSolveGraphJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Solve Graph canonical JSON cannot encode undefined values.");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalSolveGraphJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareText(left, right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalSolveGraphJson(item)}`).join(",")}}`;
}

async function digestIdentity(value: unknown): Promise<string> {
  return sha256Hex(encoder.encode(canonicalSolveGraphJson(value)));
}

function normalizeIdentity(identity: string, limits: SolveGraphScanLimits): string {
  if (typeof identity !== "string" || !identity.trim()) throw new Error("Solve Graph identity must be a non-empty string.");
  const normalized = identity.normalize("NFC");
  if (normalized.includes("\0") || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error("Solve Graph identity contains control characters.");
  if (normalized.startsWith("/") || /^[A-Za-z]:[\\/]/.test(normalized) || normalized.includes("\\")) {
    throw new Error("Solve Graph identity must not contain an absolute or platform-specific filesystem path.");
  }
  if (byteLength(normalized) > limits.maxIdentityBytes) throw new Error("Solve Graph identity exceeds maxIdentityBytes.");
  return normalized;
}

function normalizeLabel(label: string): string {
  if (typeof label !== "string" || !label.trim()) throw new Error("Solve Graph label must be a non-empty string.");
  const normalized = label.normalize("NFC").trim();
  if (normalized.includes("\0") || byteLength(normalized) > 1024) throw new Error("Solve Graph label is invalid or too large.");
  return normalized;
}

function normalizeMetadataValue(value: SolveGraphMetadataValue, key: string, limits: SolveGraphScanLimits): SolveGraphMetadataValue {
  if (typeof value === "string") {
    const normalized = value.normalize("NFC");
    if (normalized.includes("\0") || byteLength(normalized) > limits.maxMetadataStringBytes) {
      throw new Error(`Solve Graph metadata value is invalid or too large: ${key}`);
    }
    return normalized;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Solve Graph metadata number must be finite: ${key}`);
    return value;
  }
  if (typeof value === "boolean") return value;
  throw new Error(`Solve Graph metadata value has an unsupported type: ${key}`);
}

export function normalizeSolveGraphMetadata(
  metadata: SolveGraphMetadata | undefined,
  limits: SolveGraphScanLimits = defaultSolveGraphScanLimits,
): SolveGraphMetadata | undefined {
  if (metadata === undefined) return undefined;
  const entries = Object.entries(metadata);
  if (entries.length > limits.maxMetadataEntries) throw new Error("Solve Graph metadata exceeds maxMetadataEntries.");
  const normalized: Record<string, SolveGraphMetadataValue> = {};
  for (const [key, value] of entries.sort(([left], [right]) => compareText(left, right))) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) throw new Error(`Solve Graph metadata key is invalid: ${key}`);
    if (sensitiveMetadataKey.test(key)) throw new Error(`Solve Graph metadata key is sensitive and forbidden: ${key}`);
    normalized[key] = normalizeMetadataValue(value, key, limits);
  }
  return normalized;
}

function positivePosition(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Solve Graph evidence ${label} must be a positive safe integer.`);
  return value;
}

export function normalizeSolveGraphEvidence(
  input: SolveGraphEvidence,
  limits: SolveGraphScanLimits = defaultSolveGraphScanLimits,
): SolveGraphEvidence {
  if (!evidenceKindSet.has(input.kind)) throw new Error(`Solve Graph evidence kind is invalid: ${input.kind}`);
  const line = positivePosition(input.line, "line");
  const column = positivePosition(input.column, "column");
  const endLine = positivePosition(input.endLine, "endLine");
  const endColumn = positivePosition(input.endColumn, "endColumn");
  if (column !== undefined && line === undefined) throw new Error("Solve Graph evidence column requires line.");
  if (endLine !== undefined && line === undefined) throw new Error("Solve Graph evidence endLine requires line.");
  if (endColumn !== undefined && endLine === undefined) throw new Error("Solve Graph evidence endColumn requires endLine.");
  if (line !== undefined && endLine !== undefined && endLine < line) throw new Error("Solve Graph evidence endLine cannot precede line.");
  const note = input.note?.normalize("NFC");
  if (note !== undefined && (note.includes("\0") || byteLength(note) > limits.maxMetadataStringBytes)) {
    throw new Error("Solve Graph evidence note is invalid or too large.");
  }
  return {
    kind: input.kind,
    path: normalizeSolveGraphPath(input.path),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    ...(endLine === undefined ? {} : { endLine }),
    ...(endColumn === undefined ? {} : { endColumn }),
    ...(note === undefined ? {} : { note }),
  };
}

function normalizeEvidenceList(input: readonly SolveGraphEvidence[], limits: SolveGraphScanLimits): SolveGraphEvidence[] {
  if (input.length > limits.maxEvidencePerElement) throw new Error("Solve Graph evidence exceeds maxEvidencePerElement.");
  const byCanonical = new Map<string, SolveGraphEvidence>();
  for (const item of input) {
    const normalized = normalizeSolveGraphEvidence(item, limits);
    byCanonical.set(canonicalSolveGraphJson(normalized), normalized);
  }
  return [...byCanonical.entries()].sort(([left], [right]) => compareText(left, right)).map(([, item]) => item);
}

export async function solveGraphNodeId(kind: SolveGraphNodeKind, identity: string, limits: SolveGraphScanLimits = defaultSolveGraphScanLimits): Promise<string> {
  if (!nodeKindSet.has(kind)) throw new Error(`Solve Graph node kind is invalid: ${kind}`);
  const normalized = normalizeIdentity(identity, limits);
  return `sgn_${(await digestIdentity({ schema: SOLVE_GRAPH_SCHEMA, kind, identity: normalized })).slice(0, 32)}`;
}

export async function solveGraphEdgeId(
  kind: SolveGraphEdgeKind,
  from: string,
  to: string,
  qualifier?: string,
): Promise<string> {
  if (!edgeKindSet.has(kind)) throw new Error(`Solve Graph edge kind is invalid: ${kind}`);
  if (!/^sgn_[a-f0-9]{32}$/.test(from) || !/^sgn_[a-f0-9]{32}$/.test(to)) throw new Error("Solve Graph edge endpoints must be stable node IDs.");
  const normalizedQualifier = qualifier?.normalize("NFC");
  if (normalizedQualifier?.includes("\0") || (normalizedQualifier !== undefined && byteLength(normalizedQualifier) > 1024)) {
    throw new Error("Solve Graph edge qualifier is invalid or too large.");
  }
  return `sge_${(await digestIdentity({ schema: SOLVE_GRAPH_SCHEMA, kind, from, to, qualifier: normalizedQualifier ?? "" })).slice(0, 32)}`;
}

export async function createSolveGraphNode(input: Omit<SolveGraphNode, "id">, inputLimits: SolveGraphScanLimits = defaultSolveGraphScanLimits): Promise<SolveGraphNode> {
  const limits = validateSolveGraphScanLimits(inputLimits);
  const identity = normalizeIdentity(input.identity, limits);
  return {
    id: await solveGraphNodeId(input.kind, identity, limits),
    kind: input.kind,
    identity,
    label: normalizeLabel(input.label),
    evidence: normalizeEvidenceList(input.evidence, limits),
    ...(input.metadata === undefined ? {} : { metadata: normalizeSolveGraphMetadata(input.metadata, limits) }),
  };
}

export async function createSolveGraphEdge(input: Omit<SolveGraphEdge, "id">, inputLimits: SolveGraphScanLimits = defaultSolveGraphScanLimits): Promise<SolveGraphEdge> {
  const limits = validateSolveGraphScanLimits(inputLimits);
  const qualifier = input.qualifier?.normalize("NFC");
  return {
    id: await solveGraphEdgeId(input.kind, input.from, input.to, qualifier),
    kind: input.kind,
    from: input.from,
    to: input.to,
    ...(qualifier === undefined ? {} : { qualifier }),
    evidence: normalizeEvidenceList(input.evidence, limits),
    ...(input.metadata === undefined ? {} : { metadata: normalizeSolveGraphMetadata(input.metadata, limits) }),
  };
}

function normalizeSource(source: SolveGraphSource): SolveGraphSource {
  if (source.kind !== "repository") throw new Error("Solve Graph source kind must be repository.");
  if (!source.displayName.trim() || source.displayName.length > 240) throw new Error("Solve Graph source displayName is invalid.");
  if (!/^sha256:[a-f0-9]{64}$/.test(source.fingerprint)) throw new Error("Solve Graph source fingerprint is invalid.");
  if (!source.revision.trim() || source.revision.length > 256) throw new Error("Solve Graph source revision is invalid.");
  return { ...source, displayName: source.displayName.normalize("NFC").trim(), revision: source.revision.normalize("NFC") };
}

function normalizeExtractors(input: readonly SolveGraphExtractor[]): SolveGraphExtractor[] {
  const byId = new Map<string, SolveGraphExtractor>();
  for (const extractor of input) {
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(extractor.id) || !extractor.version.trim() || extractor.deterministic !== true) {
      throw new Error("Solve Graph extractor identity is invalid.");
    }
    const normalized = { id: extractor.id, version: extractor.version.normalize("NFC"), deterministic: true as const };
    const existing = byId.get(normalized.id);
    if (existing && canonicalSolveGraphJson(existing) !== canonicalSolveGraphJson(normalized)) {
      throw new Error(`Solve Graph extractor ID has conflicting versions: ${normalized.id}`);
    }
    byId.set(normalized.id, normalized);
  }
  return [...byId.values()].sort((left, right) => compareText(left.id, right.id));
}

function dedupeById<T extends { id: string }>(items: readonly T[], label: string): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (existing && canonicalSolveGraphJson(existing) !== canonicalSolveGraphJson(item)) {
      throw new Error(`Solve Graph ${label} ID collision has conflicting content: ${item.id}`);
    }
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => compareText(left.id, right.id));
}

export type CreateSolveGraphDocumentInput = {
  source: SolveGraphSource;
  engineVersion?: string;
  extractors: SolveGraphExtractor[];
  limits?: SolveGraphScanLimits;
  status?: "complete" | "partial";
  truncationReasons?: SolveGraphTruncationReason[];
  nodes: SolveGraphNode[];
  edges: SolveGraphEdge[];
};

export async function createSolveGraphDocument(input: CreateSolveGraphDocumentInput): Promise<SolveGraphDocument> {
  const limits = validateSolveGraphScanLimits(input.limits ?? defaultSolveGraphScanLimits);
  const source = normalizeSource(input.source);
  const engineVersion = input.engineVersion ?? "0.1.0";
  if (!engineVersion.trim()) throw new Error("Solve Graph engine version is required.");
  const extractors = normalizeExtractors(input.extractors);
  if (extractors.length === 0) throw new Error("Solve Graph requires at least one deterministic extractor.");

  const normalizedNodes: SolveGraphNode[] = [];
  for (const node of input.nodes) {
    const expected = await createSolveGraphNode({
      kind: node.kind,
      identity: node.identity,
      label: node.label,
      evidence: node.evidence,
      metadata: node.metadata,
    }, limits);
    if (node.id !== expected.id) throw new Error(`Solve Graph node ID does not match its identity: ${node.id}`);
    normalizedNodes.push(expected);
  }
  const nodes = dedupeById(normalizedNodes, "node");
  if (nodes.length > limits.maxNodes) throw new Error("Solve Graph node count exceeds maxNodes.");
  const nodeIds = new Set(nodes.map((node) => node.id));

  const normalizedEdges: SolveGraphEdge[] = [];
  for (const edge of input.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`Solve Graph edge references a missing node: ${edge.id}`);
    const expected = await createSolveGraphEdge({
      kind: edge.kind,
      from: edge.from,
      to: edge.to,
      qualifier: edge.qualifier,
      evidence: edge.evidence,
      metadata: edge.metadata,
    }, limits);
    if (edge.id !== expected.id) throw new Error(`Solve Graph edge ID does not match its identity: ${edge.id}`);
    normalizedEdges.push(expected);
  }
  const edges = dedupeById(normalizedEdges, "edge");
  if (edges.length > limits.maxEdges) throw new Error("Solve Graph edge count exceeds maxEdges.");

  const truncationReasons = [...new Set(input.truncationReasons ?? [])].sort(compareText) as SolveGraphTruncationReason[];
  const status = input.status ?? (truncationReasons.length === 0 ? "complete" : "partial");
  if ((status === "complete") !== (truncationReasons.length === 0)) {
    throw new Error("Solve Graph execution status and truncation reasons disagree.");
  }

  const graphId = `sg_${(await digestIdentity({
    schema: SOLVE_GRAPH_SCHEMA,
    sourceFingerprint: source.fingerprint,
    engineVersion,
    extractors,
    limits,
  })).slice(0, 32)}`;

  const withoutIntegrity = {
    schema: SOLVE_GRAPH_SCHEMA,
    graphId,
    mode: "analyze-only" as const,
    engine: { name: SOLVE_GRAPH_ENGINE, version: engineVersion, deterministic: true as const },
    source,
    extractors,
    limits,
    execution: {
      status,
      truncated: truncationReasons.length > 0,
      truncationReasons,
      networkAccess: false as const,
      writeAccess: false as const,
    },
    nodes,
    edges,
  };
  const integrityBase = { stableIds: true as const, ordering: "id-ascending" as const };
  const canonicalJsonSha256 = `sha256:${await digestIdentity({ ...withoutIntegrity, integrity: integrityBase })}`;
  return { ...withoutIntegrity, integrity: { canonicalJsonSha256, ...integrityBase } };
}

export function serializeSolveGraphDocument(document: SolveGraphDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function verifySolveGraphIntegrity(document: SolveGraphDocument): Promise<boolean> {
  const { integrity, ...withoutIntegrity } = document;
  if (!/^sha256:[a-f0-9]{64}$/.test(integrity.canonicalJsonSha256)) return false;
  const expected = `sha256:${await digestIdentity({
    ...withoutIntegrity,
    integrity: { stableIds: integrity.stableIds, ordering: integrity.ordering },
  })}`;
  return integrity.canonicalJsonSha256 === expected;
}
