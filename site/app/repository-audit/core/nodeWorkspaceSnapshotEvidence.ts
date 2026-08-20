import type { RepositorySnapshot } from "./inventory";
import { normalizeRepositoryPath } from "./inventory";
import {
  analyzeNodeWorkspaceMetadata,
  type NodeWorkspaceEvidence,
} from "./nodeWorkspaceEvidence";

const DEFAULT_MAX_MANIFEST_TEXT_BYTES = 1024 * 1024;
const HARD_MAX_MANIFEST_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_SKIPPED_EVIDENCE = 100;
const encoder = new TextEncoder();

type NodeWorkspaceSkipReason = "missing-text" | "manifest-too-large";

type NodeWorkspaceSkippedManifest = {
  path: string;
  reason: NodeWorkspaceSkipReason;
};

export type NodeWorkspaceSnapshotEvidence = {
  schema: "solvelang.repository-audit.node-workspace-snapshot.v0";
  mode: "analyze-only";
  source: {
    fingerprint: string;
    revision: string;
  };
  status: "absent" | "complete" | "partial";
  rootPackageJson: "package.json" | null;
  workspace?: NodeWorkspaceEvidence;
  summary: {
    packageManifestsSeen: number;
    manifestTextsAccepted: number;
    packageManifestsSkipped: number;
    skippedEvidenceReturned: number;
    skippedEvidenceHidden: number;
  };
  skipped: NodeWorkspaceSkippedManifest[];
  notices: string[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxManifestTextBytes: number;
    maxSkippedEvidence: number;
  };
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedManifestBytes(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > HARD_MAX_MANIFEST_TEXT_BYTES
  ) {
    throw new Error(
      `Node workspace manifest byte bound must be an integer from 1 through ${HARD_MAX_MANIFEST_TEXT_BYTES}.`,
    );
  }
  return value;
}

function isPackageManifest(path: string): boolean {
  return path === "package.json" || path.endsWith("/package.json");
}

export function analyzeNodeWorkspaceSnapshot(
  snapshot: RepositorySnapshot,
  options: { maxManifestTextBytes?: number } = {},
): NodeWorkspaceSnapshotEvidence {
  const maxManifestTextBytes = boundedManifestBytes(
    options.maxManifestTextBytes ?? DEFAULT_MAX_MANIFEST_TEXT_BYTES,
  );
  const manifests = snapshot.files
    .map((file) => ({ ...file, path: normalizeRepositoryPath(file.path) }))
    .filter((file) => isPackageManifest(file.path))
    .sort((left, right) => compareText(left.path, right.path));
  const root = manifests.find((file) => file.path === "package.json");
  const skippedAll: NodeWorkspaceSkippedManifest[] = [];

  function acceptedText(
    file: (typeof manifests)[number],
  ): string | undefined {
    if (file.text === undefined) {
      skippedAll.push({ path: file.path, reason: "missing-text" });
      return undefined;
    }
    if (
      file.byteSize > maxManifestTextBytes ||
      encoder.encode(file.text).byteLength > maxManifestTextBytes
    ) {
      skippedAll.push({ path: file.path, reason: "manifest-too-large" });
      return undefined;
    }
    return file.text;
  }

  if (!root) {
    return {
      schema: "solvelang.repository-audit.node-workspace-snapshot.v0",
      mode: "analyze-only",
      source: {
        fingerprint: snapshot.source.fingerprint,
        revision: snapshot.source.revision,
      },
      status: "absent",
      rootPackageJson: null,
      summary: {
        packageManifestsSeen: manifests.length,
        manifestTextsAccepted: 0,
        packageManifestsSkipped: 0,
        skippedEvidenceReturned: 0,
        skippedEvidenceHidden: 0,
      },
      skipped: [],
      notices: [
        "No repository-root package.json was present in the supplied snapshot, so Node workspace metadata was not inferred.",
      ],
      execution: {
        networkAccess: false,
        writeAccess: false,
        maxManifestTextBytes,
        maxSkippedEvidence: MAX_SKIPPED_EVIDENCE,
      },
    };
  }

  const rootText = acceptedText(root);
  const discoveredPackages = new Map<string, string>();
  for (const manifest of manifests) {
    if (manifest.path === "package.json") continue;
    const text = acceptedText(manifest);
    if (text !== undefined) discoveredPackages.set(manifest.path, text);
  }

  const skipped = skippedAll.slice(0, MAX_SKIPPED_EVIDENCE);
  const skippedEvidenceHidden = skippedAll.length - skipped.length;
  if (rootText === undefined) {
    return {
      schema: "solvelang.repository-audit.node-workspace-snapshot.v0",
      mode: "analyze-only",
      source: {
        fingerprint: snapshot.source.fingerprint,
        revision: snapshot.source.revision,
      },
      status: "partial",
      rootPackageJson: "package.json",
      summary: {
        packageManifestsSeen: manifests.length,
        manifestTextsAccepted: discoveredPackages.size,
        packageManifestsSkipped: skippedAll.length,
        skippedEvidenceReturned: skipped.length,
        skippedEvidenceHidden,
      },
      skipped,
      notices: [
        "The repository-root package.json was not available within the manifest text bound, so workspace metadata was not inferred.",
        ...(skippedEvidenceHidden > 0
          ? [
              `${skippedEvidenceHidden} additional skipped manifest records are hidden by the evidence bound.`,
            ]
          : []),
      ],
      execution: {
        networkAccess: false,
        writeAccess: false,
        maxManifestTextBytes,
        maxSkippedEvidence: MAX_SKIPPED_EVIDENCE,
      },
    };
  }

  const workspace = analyzeNodeWorkspaceMetadata(rootText, discoveredPackages);
  const status = skippedAll.length > 0 || workspace.truncated ? "partial" : "complete";
  const notices = [
    ...workspace.notices,
    ...(skippedAll.length > 0
      ? [
          `${skippedAll.length} package manifest(s) were omitted because text was unavailable or exceeded the manifest bound.`,
        ]
      : []),
    ...(skippedEvidenceHidden > 0
      ? [
          `${skippedEvidenceHidden} additional skipped manifest records are hidden by the evidence bound.`,
        ]
      : []),
  ];

  return {
    schema: "solvelang.repository-audit.node-workspace-snapshot.v0",
    mode: "analyze-only",
    source: {
      fingerprint: snapshot.source.fingerprint,
      revision: snapshot.source.revision,
    },
    status,
    rootPackageJson: "package.json",
    workspace,
    summary: {
      packageManifestsSeen: manifests.length,
      manifestTextsAccepted: discoveredPackages.size + 1,
      packageManifestsSkipped: skippedAll.length,
      skippedEvidenceReturned: skipped.length,
      skippedEvidenceHidden,
    },
    skipped,
    notices,
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxManifestTextBytes,
      maxSkippedEvidence: MAX_SKIPPED_EVIDENCE,
    },
  };
}
