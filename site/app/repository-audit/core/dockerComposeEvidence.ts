const MAX_COMPOSE_BYTES = 1024 * 1024;
const MAX_SERVICES = 1_000;

export type DockerComposeEvidence = {
  services: Array<{
    name: string;
    image?: string;
    imageState: "declared" | "unresolved";
  }>;
  truncated: boolean;
  notices: string[];
  execution: {
    containerBuild: false;
    imageResolution: false;
    networkAccess: false;
    writeAccess: false;
  };
};

type Service = DockerComposeEvidence["services"][number];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function indentation(line: string): number {
  return line.length - line.trimStart().length;
}

function literalImage(value: string): string | undefined {
  const unquoted = value.trim().replace(/^(?:"([^"]*)"|'([^']*)')$/, "$1$2");
  return unquoted && !unquoted.includes("${") ? unquoted : undefined;
}

export function analyzeDockerCompose(text: string): DockerComposeEvidence {
  if (new TextEncoder().encode(text).byteLength > MAX_COMPOSE_BYTES) {
    throw new Error("Docker Compose text exceeds the 1 MiB text bound.");
  }

  const services: Service[] = [];
  let servicesIndent: number | undefined;
  let current: Service | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = indentation(line);
    if (servicesIndent === undefined) {
      if (/^services\s*:\s*$/.test(trimmed)) servicesIndent = indent;
      continue;
    }
    if (indent <= servicesIndent) break;

    const service = /^([A-Za-z0-9_.-]+)\s*:\s*$/.exec(trimmed);
    if (indent === servicesIndent + 2 && service) {
      current = { name: service[1]!, imageState: "unresolved" };
      services.push(current);
      continue;
    }
    if (!current || indent <= servicesIndent + 2) continue;
    const image = /^image\s*:\s*(.+)$/.exec(trimmed);
    if (image) {
      const value = literalImage(image[1]!);
      if (value) Object.assign(current, { image: value, imageState: "declared" as const });
    }
  }

  const sorted = services.sort((left, right) => compareText(left.name, right.name));
  const visible = sorted.slice(0, MAX_SERVICES);
  const hidden = sorted.length - visible.length;
  return {
    services: visible,
    truncated: hidden > 0,
    notices: [
      "Docker Compose service metadata is parsed locally only; images are not resolved or pulled, containers are not built or started, and YAML substitutions or anchors are not evaluated.",
      ...(hidden > 0 ? [`${hidden} additional Compose services were omitted by deterministic evidence bounds.`] : []),
    ],
    execution: {
      containerBuild: false,
      imageResolution: false,
      networkAccess: false,
      writeAccess: false,
    },
  };
}
