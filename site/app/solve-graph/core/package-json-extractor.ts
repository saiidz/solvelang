import type { RepositoryFileInput, RepositorySnapshot } from "../../repository-audit/core/inventory";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "./canonical";
import type {
  SolveGraphDocument,
  SolveGraphEdge,
  SolveGraphNode,
  SolveGraphScanLimits,
  SolveGraphTruncationReason,
} from "./contracts";
import { extractRepositoryInventoryGraph } from "./inventory-extractor";
import { defaultSolveGraphScanLimits, normalizeSolveGraphPath, validateSolveGraphScanLimits } from "./limits";

export const packageJsonDependencyExtractor = Object.freeze({
  id: "package-json-dependencies",
  version: "1.0.0",
  deterministic: true as const,
});

export type ExtractPackageJsonDependencyGraphOptions = {
  limits?: SolveGraphScanLimits;
  privateSource?: boolean;
};

type DependencySection = "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";
type PackageManifest = {
  name?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
};

const dependencySections: Array<{ key: DependencySection; qualifier: string }> = [
  { key: "dependencies", qualifier: "runtime" },
  { key: "devDependencies", qualifier: "development" },
  { key: "peerDependencies", qualifier: "peer" },
  { key: "optionalDependencies", qualifier: "optional" },
];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifest(file: RepositoryFileInput, path: string): PackageManifest | undefined {
  if (file.text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.text);
  } catch {
    throw new Error(`Solve Graph package manifest is invalid JSON: ${path}`);
  }
  if (!isRecord(parsed)) throw new Error(`Solve Graph package manifest must be a JSON object: ${path}`);
  return parsed;
}

function packageLabel(manifest: PackageManifest, manifestPath: string): string {
  if (typeof manifest.name === "string" && manifest.name.trim()) return manifest.name.trim();
  const slash = manifestPath.lastIndexOf("/");
  return slash < 0 ? "root package" : `${manifestPath.slice(0, slash)} package`;
}

function dependencyEntries(manifest: PackageManifest, path: string): Array<{ name: string; qualifier: string }> {
  const entries: Array<{ name: string; qualifier: string }> = [];
  for (const { key, qualifier } of dependencySections) {
    const section = manifest[key];
    if (section === undefined) continue;
    if (!isRecord(section)) throw new Error(`Solve Graph package manifest ${key} must be an object: ${path}`);
    for (const [name, specifier] of Object.entries(section).sort(([left], [right]) => compareText(left, right))) {
      if (!name.trim() || typeof specifier !== "string" || !specifier.trim()) {
        throw new Error(`Solve Graph package manifest has an invalid ${key} entry: ${path}`);
      }
      entries.push({ name: name.normalize("NFC"), qualifier });
    }
  }
  return entries.sort((left, right) => compareText(left.name, right.name) || compareText(left.qualifier, right.qualifier));
}

export async function extractPackageJsonDependencyGraph(
  snapshot: RepositorySnapshot,
  options: ExtractPackageJsonDependencyGraphOptions = {},
): Promise<SolveGraphDocument> {
  const limits = validateSolveGraphScanLimits(options.limits ?? defaultSolveGraphScanLimits);
  const inventory = await extractRepositoryInventoryGraph(snapshot, { limits, privateSource: options.privateSource });
  const nodes: SolveGraphNode[] = [...inventory.nodes];
  const edges: SolveGraphEdge[] = [...inventory.edges];
  const reasons = new Set<SolveGraphTruncationReason>(inventory.execution.truncationReasons);
  const dependencyIds = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === "dependency" && node.metadata?.ecosystem === "npm") dependencyIds.set(node.label, node.id);
  }
  const fileIds = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === "file" && typeof node.metadata?.path === "string") fileIds.set(node.metadata.path, node.id);
  }

  const manifests = snapshot.files
    .map((file) => ({ file, path: normalizeSolveGraphPath(file.path) }))
    .filter(({ path }) => path === "package.json" || path.endsWith("/package.json"))
    .sort((left, right) => compareText(left.path, right.path));

  for (const { file, path } of manifests) {
    const fileId = fileIds.get(path);
    if (!fileId) continue;
    const manifest = parseManifest(file, path);
    if (!manifest) continue;
    const dependencies = dependencyEntries(manifest, path);
    const newDependencyNames = [...new Set(dependencies.map(({ name }) => name))]
      .filter((name) => !dependencyIds.has(name));
    const requiredNodes = 1 + newDependencyNames.length;
    const requiredEdges = 1 + dependencies.length;
    if (nodes.length + requiredNodes > limits.maxNodes) {
      reasons.add("node-count");
      continue;
    }
    if (edges.length + requiredEdges > limits.maxEdges) {
      reasons.add("edge-count");
      continue;
    }

    const module = await createSolveGraphNode({
      kind: "module",
      identity: `npm-module:${path}`,
      label: packageLabel(manifest, path),
      evidence: [{ kind: "manifest", path }],
      metadata: { ecosystem: "npm", manifestPath: path },
    }, limits);
    const containsModule = await createSolveGraphEdge({
      kind: "contains",
      from: fileId,
      to: module.id,
      evidence: [{ kind: "manifest", path }],
    }, limits);
    nodes.push(module);
    edges.push(containsModule);

    for (const { name, qualifier } of dependencies) {
      let dependencyId = dependencyIds.get(name);
      if (!dependencyId) {
        const dependency = await createSolveGraphNode({
          kind: "dependency",
          identity: `npm-dependency:${name}`,
          label: name,
          evidence: [{ kind: "manifest", path }],
          metadata: { ecosystem: "npm" },
        }, limits);
        nodes.push(dependency);
        dependencyId = dependency.id;
        dependencyIds.set(name, dependencyId);
      }
      edges.push(await createSolveGraphEdge({
        kind: "depends-on",
        from: module.id,
        to: dependencyId,
        qualifier,
        evidence: [{ kind: "manifest", path }],
      }, limits));
    }
  }

  const truncationReasons = [...reasons].sort(compareText);
  return createSolveGraphDocument({
    source: inventory.source,
    engineVersion: inventory.engine.version,
    extractors: [...inventory.extractors, packageJsonDependencyExtractor],
    limits,
    status: truncationReasons.length === 0 ? "complete" : "partial",
    truncationReasons,
    nodes,
    edges,
  });
}
