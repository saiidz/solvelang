const MAX_POM_BYTES = 1024 * 1024;
const MAX_DEPENDENCIES = 1_000;
const MAX_REACTOR_MODULES = 1_000;

export type MavenEvidence = {
  dependencies: Array<{
    groupId: string;
    artifactId: string;
    version?: string;
    scope?: string;
    state: "declared" | "unresolved";
  }>;
  reactorModules: Array<{ path: string; state: "outside-scan" }>;
  truncated: boolean;
  notices: string[];
  execution: {
    buildEvaluation: false;
    networkAccess: false;
    repositoryResolution: false;
    writeAccess: false;
  };
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tagValue(text: string, name: string): string | undefined {
  const matched = new RegExp(`<${name}\\s*>([^<]+)</${name}>`, "i").exec(text);
  return matched?.[1]?.trim() || undefined;
}

function isLiteralVersion(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("${");
}

export function analyzeMavenPom(text: string): MavenEvidence {
  if (new TextEncoder().encode(text).byteLength > MAX_POM_BYTES) {
    throw new Error("Maven POM text exceeds the 1 MiB text bound.");
  }

  const withoutManagement = text.replace(/<dependencyManagement\b[\s\S]*?<\/dependencyManagement>/gi, "");
  const dependencies: MavenEvidence["dependencies"] = [];
  const reactorModules: MavenEvidence["reactorModules"] = [];

  for (const block of withoutManagement.match(/<dependency\b[\s\S]*?<\/dependency>/gi) ?? []) {
    const groupId = tagValue(block, "groupId");
    const artifactId = tagValue(block, "artifactId");
    if (!groupId || !artifactId) continue;
    const version = tagValue(block, "version");
    const scope = tagValue(block, "scope");
    dependencies.push({
      groupId,
      artifactId,
      ...(isLiteralVersion(version) ? { version } : {}),
      ...(scope ? { scope } : {}),
      state: isLiteralVersion(version) ? "declared" : "unresolved",
    });
  }

  for (const moduleEntry of text.match(/<module\s*>([^<]+)<\/module>/gi) ?? []) {
    const path = tagValue(moduleEntry, "module");
    if (path) reactorModules.push({ path, state: "outside-scan" });
  }

  const sortedDependencies = dependencies.sort((left, right) =>
    compareText(left.groupId, right.groupId) || compareText(left.artifactId, right.artifactId),
  );
  const sortedModules = reactorModules.sort((left, right) => compareText(left.path, right.path));
  const visibleDependencies = sortedDependencies.slice(0, MAX_DEPENDENCIES);
  const visibleModules = sortedModules.slice(0, MAX_REACTOR_MODULES);
  const hidden = sortedDependencies.length - visibleDependencies.length + sortedModules.length - visibleModules.length;

  return {
    dependencies: visibleDependencies,
    reactorModules: visibleModules,
    truncated: hidden > 0,
    notices: [
      "Maven metadata is parsed locally only; build plugins are not evaluated and dependencies are not resolved, downloaded, or executed. Reactor modules are not followed outside the supplied scan.",
      ...(hidden > 0 ? [`${hidden} additional Maven entries were omitted by deterministic evidence bounds.`] : []),
    ],
    execution: {
      buildEvaluation: false,
      networkAccess: false,
      repositoryResolution: false,
      writeAccess: false,
    },
  };
}
