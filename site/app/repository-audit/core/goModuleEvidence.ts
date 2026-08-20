const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_REQUIREMENTS = 1_000;
const MAX_LOCAL_REPLACEMENTS = 1_000;

export type GoModuleEvidence = {
  modulePath?: string;
  requirements: Array<{ modulePath: string; version: string; indirect: boolean }>;
  localReplacements: Array<{ modulePath: string; target: string; state: "outside-scan" }>;
  truncated: boolean;
  notices: string[];
  execution: { networkAccess: false; writeAccess: false; moduleResolution: false };
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isLocalPath(value: string): boolean {
  return value === "." || value === ".." || value.startsWith("./") || value.startsWith("../") || value.startsWith("/");
}

export function analyzeGoModuleManifest(text: string): GoModuleEvidence {
  if (new TextEncoder().encode(text).byteLength > MAX_MANIFEST_BYTES) {
    throw new Error("Go module manifest exceeds the 1 MiB text bound.");
  }

  let modulePath: string | undefined;
  let inRequireBlock = false;
  const requirements: GoModuleEvidence["requirements"] = [];
  const localReplacements: GoModuleEvidence["localReplacements"] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "require (") {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ")") {
      inRequireBlock = false;
      continue;
    }
    if (line.startsWith("module ")) {
      const candidate = line.slice("module ".length).trim();
      if (/^\S+$/.test(candidate)) modulePath = candidate;
      continue;
    }

    const requireLine = inRequireBlock ? line : line.startsWith("require ") ? line.slice("require ".length).trim() : "";
    const requirement = /^(\S+)\s+(\S+)(?:\s+\/\/\s*indirect)?$/.exec(requireLine);
    if (requirement) {
      requirements.push({
        modulePath: requirement[1]!,
        version: requirement[2]!,
        indirect: /\/\/\s*indirect$/.test(requireLine),
      });
      continue;
    }

    const replacement = /^replace\s+(\S+)(?:\s+\S+)?\s+=>\s+(\S+)(?:\s+\S+)?$/.exec(line);
    if (replacement && isLocalPath(replacement[2]!)) {
      localReplacements.push({ modulePath: replacement[1]!, target: replacement[2]!, state: "outside-scan" });
    }
  }

  const boundedRequirements = requirements
    .sort((left, right) => compareText(left.modulePath, right.modulePath) || compareText(left.version, right.version))
    .slice(0, MAX_REQUIREMENTS);
  const boundedReplacements = localReplacements
    .sort((left, right) => compareText(left.modulePath, right.modulePath) || compareText(left.target, right.target))
    .slice(0, MAX_LOCAL_REPLACEMENTS);
  const hidden = requirements.length - boundedRequirements.length + localReplacements.length - boundedReplacements.length;

  return {
    ...(modulePath ? { modulePath } : {}),
    requirements: boundedRequirements,
    localReplacements: boundedReplacements,
    truncated: hidden > 0,
    notices: [
      "Go module metadata is parsed locally only; modules are not downloaded, resolved, or executed. Local replacement targets are not followed.",
      ...(hidden > 0 ? [`${hidden} additional Go module entries were omitted by deterministic evidence bounds.`] : []),
    ],
    execution: { networkAccess: false, writeAccess: false, moduleResolution: false },
  };
}
