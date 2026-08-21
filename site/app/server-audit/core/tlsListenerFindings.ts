import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function isConventionalTlsListener(socket: NonNullable<ServerAuditSnapshot["listeningSockets"]>[number]): boolean {
  return socket.protocol.trim().toLowerCase() === "tcp" && socket.port === 443;
}

export function createServerAuditTlsListenerFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const certificates = snapshot.web?.certificates;
  const listeners = snapshot.listeningSockets;
  if (certificates === undefined || listeners === undefined) return [];

  const certificateCount = certificates.length;
  const tlsListenerCount = listeners.filter(isConventionalTlsListener).length;

  if (certificateCount > 0 && tlsListenerCount === 0) {
    return [{
      id: stableId(["tls-listener", "certificate-without-conventional-listener", String(certificateCount)]),
      severity: "info",
      category: "evidence-integrity",
      title: "TLS certificate evidence lacks a conventional local TLS listener",
      summary: "The supplied snapshot contains local TLS certificate evidence but no collected TCP listener on port 443. TLS may terminate off-host, behind a proxy/container boundary, or on a nonstandard port, and collection timing may also explain the gap.",
      recommendation: "Re-collect certificate and listener evidence together before using local snapshot data to infer TLS serving state or endpoint ownership. A separately approved endpoint check is required to identify any actively served certificate.",
      evidence: [
        { source: "web.certificates", summary: `${certificateCount} TLS certificate record observed` },
        { source: "listeningSockets", summary: "no collected TCP listener on port 443" },
      ],
    }];
  }

  if (certificateCount === 0 && tlsListenerCount > 0) {
    return [{
      id: stableId(["tls-listener", "conventional-listener-without-certificate", String(tlsListenerCount)]),
      severity: "info",
      category: "evidence-integrity",
      title: "Conventional local TLS listener lacks certificate inventory evidence",
      summary: "The supplied snapshot contains a collected TCP listener on port 443 but an explicit empty local TLS certificate inventory. TLS may terminate through an uninspected store, proxy/container boundary, or other local mechanism, and collection timing may also explain the gap.",
      recommendation: "Re-collect certificate and listener evidence together before relying on local certificate inventory for TLS conclusions. Do not treat an empty local inventory as proof that the listener serves no certificate.",
      evidence: [
        { source: "listeningSockets", summary: `${tlsListenerCount} collected TCP listener on port 443` },
        { source: "web.certificates", summary: "0 TLS certificate records" },
      ],
    }];
  }

  return [];
}
