import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

const CONVENTIONAL_WEB_PORTS = new Set([80, 443]);

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function isConventionalWebListener(socket: NonNullable<ServerAuditSnapshot["listeningSockets"]>[number]): boolean {
  return socket.protocol.trim().toLowerCase() === "tcp" && CONVENTIONAL_WEB_PORTS.has(socket.port);
}

export function createServerAuditWebListenerFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const servers = snapshot.web?.servers;
  const listeners = snapshot.listeningSockets;
  if (servers === undefined || listeners === undefined) return [];

  const activeWebServerCount = servers.filter((server) => server.trim().length > 0).length;
  const conventionalListenerCount = listeners.filter(isConventionalWebListener).length;
  if (activeWebServerCount > 0 && conventionalListenerCount === 0) {
    return [{
      id: stableId(["web-listener", "web-server-without-conventional-listener", String(activeWebServerCount)]),
      severity: "info",
      category: "evidence-integrity",
      title: "Active web-server evidence lacks a conventional HTTP(S) listener",
      summary: "The supplied snapshot reports active web-server evidence but no collected TCP listener on conventional HTTP(S) ports. A reverse proxy, container boundary, nonstandard port, or collection timing may explain this local evidence gap.",
      recommendation: "Re-collect the web-server and listener sections together before using local listener metadata to reason about web ownership or exposure.",
      evidence: [
        { source: "web.servers", summary: `${activeWebServerCount} active web-server record observed` },
        { source: "listeningSockets", summary: "no collected TCP listener on conventional HTTP(S) ports" },
      ],
    }];
  }

  if (activeWebServerCount === 0 && conventionalListenerCount > 0) {
    return [{
      id: stableId(["web-listener", "conventional-listener-without-web-server", String(conventionalListenerCount)]),
      severity: "info",
      category: "evidence-integrity",
      title: "Conventional HTTP(S) listener lacks web-server probe evidence",
      summary: "The supplied snapshot contains a collected TCP listener on a conventional HTTP(S) port but no active web-server probe record. A custom server, proxy, container boundary, or collection timing may explain this local evidence gap.",
      recommendation: "Re-collect the listener and web-server sections together before inferring application ownership or public reachability from this local listener evidence.",
      evidence: [
        { source: "listeningSockets", summary: `${conventionalListenerCount} collected TCP listener on conventional HTTP(S) ports` },
        { source: "web.servers", summary: "no active web-server record observed" },
      ],
    }];
  }

  return [];
}
