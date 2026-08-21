import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditWebServerFindingOptions = {
  maxFindings?: number;
};

type KnownWebServer = "nginx" | "apache2" | "httpd" | "caddy";

const KNOWN_WEB_SERVERS = new Set<KnownWebServer>(["nginx", "apache2", "httpd", "caddy"]);
const PACKAGE_PREFIXES: Record<KnownWebServer, string[]> = {
  nginx: ["nginx"],
  apache2: ["apache2"],
  httpd: ["httpd"],
  caddy: ["caddy"],
};
const SERVICE_PREFIXES: Record<KnownWebServer, string[]> = {
  nginx: ["nginx"],
  apache2: ["apache2"],
  httpd: ["httpd"],
  caddy: ["caddy"],
};
const SEVERITY_ORDER: Record<ServerAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function compareFinding(left: ServerAuditFinding, right: ServerAuditFinding): number {
  return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id);
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

function normalizedServiceName(value: string): string {
  return value.trim().toLowerCase().replace(/\.service$/, "");
}

function serviceMatches(server: KnownWebServer, serviceName: string): boolean {
  const normalized = normalizedServiceName(serviceName);
  return SERVICE_PREFIXES[server].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}@`));
}

function packageMatches(server: KnownWebServer, packageName: string): boolean {
  const normalized = packageName.trim().toLowerCase();
  return PACKAGE_PREFIXES[server].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}-`));
}

export function createServerAuditWebServerRelationshipFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditWebServerFindingOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 50, 1, 500, "Server Audit web-server maxFindings");
  const reportedServers = snapshot.web?.servers;
  if (reportedServers === undefined) return [];

  const services = snapshot.services;
  const packages = snapshot.packages;
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

  for (const [index, rawServer] of reportedServers.entries()) {
    const normalized = rawServer.trim().toLowerCase();
    if (!KNOWN_WEB_SERVERS.has(normalized as KnownWebServer)) continue;
    const server = normalized as KnownWebServer;

    if (services !== undefined) {
      let matchingServiceObserved = false;
      for (const [serviceIndex, service] of services.entries()) {
        if (!serviceMatches(server, service.name)) continue;
        matchingServiceObserved = true;
        if (!/failed|dead|inactive|error/i.test(service.state)) continue;
        recordFinding({
          id: stableId(["web-server", server, "service-state-conflict", String(index), String(serviceIndex)]),
          severity: "medium",
          category: "evidence-integrity",
          title: "Web-server probes disagree on service health",
          summary: `${server} is reported active by the web-server probe while the matching service record reports a non-healthy state. This is contradictory point-in-time evidence, not proof that either source is authoritative.`,
          recommendation: "Re-collect the service and web-server probes together before taking operational action, then inspect bounded status/log evidence if the contradiction persists.",
          evidence: [
            { source: `web.servers[${index}]`, summary: `${server} reported active` },
            { source: `services[${serviceIndex}].state`, summary: "matching service reports non-healthy state" },
          ],
        });
      }
      if (!matchingServiceObserved) {
        recordFinding({
          id: stableId(["web-server", server, "service-not-observed", String(index)]),
          severity: "info",
          category: "evidence-integrity",
          title: "Active web server is not represented in service inventory",
          summary: `${server} is reported active by the web-server probe, but no matching service record is present in the supplied service inventory. Containers, alternate supervisors, or collection timing may explain the gap.`,
          recommendation: "Re-collect web-server and service evidence from the same reviewed snapshot before relying on service-manager ownership or health conclusions.",
          evidence: [{ source: `web.servers[${index}]`, summary: `${server} reported active; matching service not observed` }],
        });
      }
    }

    if (packages !== undefined && !packages.some((entry) => packageMatches(server, entry.name))) {
      recordFinding({
        id: stableId(["web-server", server, "package-not-observed", String(index)]),
        severity: "info",
        category: "evidence-integrity",
        title: "Active web server is not represented in package inventory",
        summary: `${server} is reported active, but no matching package name is present in the supplied package inventory. A container, custom binary, alternate package name, or bounded collection may explain the gap.`,
        recommendation: "Treat package ownership and version posture as unknown until the installation source is established with reviewed read-only evidence.",
        evidence: [{ source: `web.servers[${index}]`, summary: `${server} reported active; matching package not observed` }],
      });
    }
  }

  retainedFindings.sort(compareFinding);
  if (findingsObserved <= maxFindings) return retainedFindings;

  const bounded = retainedFindings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["web-server", "findings-truncated", String(maxFindings), String(findingsObserved)]),
    severity: "info",
    category: "coverage",
    title: "Web-server relationship findings were truncated",
    summary: `The web-server relationship stage produced ${findingsObserved} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from web-server relationship evidence.",
    evidence: [{ source: "web.servers", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
