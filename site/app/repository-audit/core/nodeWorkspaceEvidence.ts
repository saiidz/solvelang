const MAX_WORKSPACE_PATTERNS = 100;
const MAX_MEMBERS = 1_000;

export type NodeWorkspaceEvidence = {
  workspacePatterns: string[];
  packageManager?: string;
  members: Array<{
    path: string;
    name?: string;
    state: "resolved" | "outside-scan" | "unresolved";
  }>;
  summary: {
    discoveredPackages: number;
    returnedMembers: number;
    hiddenMembers: number;
  };
  truncated: boolean;
  notices: string[];
  execution: { networkAccess: false; writeAccess: false };
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function analyzeNodeWorkspaceMetadata(
  rootPackageJson: string,
  discoveredPackages: ReadonlyMap<string, string>,
): NodeWorkspaceEvidence {
  const root = JSON.parse(rootPackageJson) as {
    workspaces?: string[] | { packages?: string[] };
    packageManager?: string;
  };
  const workspacePatterns = Array.isArray(root.workspaces)
    ? root.workspaces
    : (root.workspaces?.packages ?? []);
  if (
    !workspacePatterns.every((item) => typeof item === "string" && item.length > 0) ||
    workspacePatterns.length > MAX_WORKSPACE_PATTERNS
  ) {
    throw new Error(
      `Node workspace patterns are invalid or exceed the ${MAX_WORKSPACE_PATTERNS}-pattern bound.`,
    );
  }

  const discoveredEntries = [...discoveredPackages].sort(([left], [right]) => compareText(left, right));
  const visibleEntries = discoveredEntries.slice(0, MAX_MEMBERS);
  const members = visibleEntries.map(([path, text]) => {
    try {
      const value = JSON.parse(text) as { name?: unknown };
      return {
        path,
        ...(typeof value.name === "string" ? { name: value.name } : {}),
        state: "resolved" as const,
      };
    } catch {
      return { path, state: "unresolved" as const };
    }
  });
  const hiddenMembers = discoveredEntries.length - visibleEntries.length;
  const notices = [
    "Node workspace metadata is parsed locally only; patterns are not expanded from disk and dependencies are not installed or resolved.",
    ...(hiddenMembers > 0
      ? [
          `Workspace member evidence is bounded to ${MAX_MEMBERS} lexicographically ordered discovered package manifests; ${hiddenMembers} additional manifests were not presented.`,
        ]
      : []),
  ];

  return {
    workspacePatterns: [...workspacePatterns].sort(compareText),
    ...(typeof root.packageManager === "string" ? { packageManager: root.packageManager } : {}),
    members,
    summary: {
      discoveredPackages: discoveredEntries.length,
      returnedMembers: members.length,
      hiddenMembers,
    },
    truncated: hiddenMembers > 0,
    notices,
    execution: { networkAccess: false, writeAccess: false },
  };
}
