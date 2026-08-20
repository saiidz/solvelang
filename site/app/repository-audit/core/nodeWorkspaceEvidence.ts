export type NodeWorkspaceEvidence = { workspacePatterns: string[]; packageManager?: string; members: Array<{ path: string; name?: string; state: "resolved" | "outside-scan" | "unresolved" }>; notices: string[]; execution: { networkAccess: false; writeAccess: false } };
export function analyzeNodeWorkspaceMetadata(rootPackageJson: string, discoveredPackages: ReadonlyMap<string, string>): NodeWorkspaceEvidence {
  const root = JSON.parse(rootPackageJson) as { workspaces?: string[] | { packages?: string[] }; packageManager?: string };
  const workspacePatterns = Array.isArray(root.workspaces) ? root.workspaces : root.workspaces?.packages ?? [];
  if (!workspacePatterns.every((item) => typeof item === "string" && item.length > 0) || workspacePatterns.length > 100) throw new Error("Node workspace patterns are invalid or exceed the 100-pattern bound.");
  const members = [...discoveredPackages].slice(0, 1_000).map(([path, text]) => { try { const value = JSON.parse(text) as { name?: unknown }; return { path, ...(typeof value.name === "string" ? { name: value.name } : {}), state: "resolved" as const }; } catch { return { path, state: "unresolved" as const }; } }).sort((a, b) => a.path.localeCompare(b.path));
  return { workspacePatterns: [...workspacePatterns].sort(), ...(typeof root.packageManager === "string" ? { packageManager: root.packageManager } : {}), members, notices: ["Node workspace metadata is parsed locally only; patterns are not expanded from disk and dependencies are not installed or resolved."], execution: { networkAccess: false, writeAccess: false } };
}
