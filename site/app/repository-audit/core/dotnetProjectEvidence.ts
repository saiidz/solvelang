const MAX_PROJECT_BYTES = 1024 * 1024;
const MAX_PACKAGE_REFERENCES = 1_000;
const MAX_PROJECT_REFERENCES = 1_000;

export type DotnetProjectEvidence = {
  packageReferences: Array<{
    name: string;
    version?: string;
    state: "declared" | "unresolved";
  }>;
  projectReferences: Array<{ path: string; state: "outside-scan" }>;
  truncated: boolean;
  notices: string[];
  execution: {
    msbuildEvaluation: false;
    networkAccess: false;
    nugetResolution: false;
    writeAccess: false;
  };
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function attribute(tag: string, name: string): string | undefined {
  const matched = new RegExp(`\\b${name}\\s*=\\s*[\"']([^\"']+)[\"']`, "i").exec(tag);
  return matched?.[1];
}

export function analyzeDotnetProject(text: string): DotnetProjectEvidence {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) {
    throw new Error(".NET project text exceeds the 1 MiB text bound.");
  }

  const packageReferences: DotnetProjectEvidence["packageReferences"] = [];
  const projectReferences: DotnetProjectEvidence["projectReferences"] = [];

  for (const tag of text.match(/<PackageReference\b[^>]*>/gi) ?? []) {
    const name = attribute(tag, "Include");
    if (!name) continue;
    const version = attribute(tag, "Version");
    packageReferences.push({ name, ...(version ? { version, state: "declared" } : { state: "unresolved" }) });
  }

  for (const tag of text.match(/<ProjectReference\b[^>]*>/gi) ?? []) {
    const path = attribute(tag, "Include");
    if (path) projectReferences.push({ path, state: "outside-scan" });
  }

  const sortedPackages = packageReferences.sort((left, right) => compareText(left.name, right.name));
  const sortedProjects = projectReferences.sort((left, right) => compareText(left.path, right.path));
  const visiblePackages = sortedPackages.slice(0, MAX_PACKAGE_REFERENCES);
  const visibleProjects = sortedProjects.slice(0, MAX_PROJECT_REFERENCES);
  const hidden = sortedPackages.length - visiblePackages.length + sortedProjects.length - visibleProjects.length;

  return {
    packageReferences: visiblePackages,
    projectReferences: visibleProjects,
    truncated: hidden > 0,
    notices: [
      ".NET project metadata is parsed locally only; MSBuild is not evaluated and NuGet packages are not resolved, downloaded, or executed. Project references are not followed outside the supplied scan.",
      ...(hidden > 0 ? [`${hidden} additional .NET reference entries were omitted by deterministic evidence bounds.`] : []),
    ],
    execution: {
      msbuildEvaluation: false,
      networkAccess: false,
      nugetResolution: false,
      writeAccess: false,
    },
  };
}
