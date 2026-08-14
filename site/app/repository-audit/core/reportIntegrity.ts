import { sha256Hex } from "./ingestion";

const encoder = new TextEncoder();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalRepositoryAuditJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Repository Audit canonical JSON cannot encode undefined values.");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalRepositoryAuditJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareText(left, right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalRepositoryAuditJson(item)}`).join(",")}}`;
}

export async function repositoryAuditReportId(input: {
  sourceFingerprint: string;
  engineVersion: string;
  rulesetVersion: string;
  limits: unknown;
}): Promise<string> {
  if (!/^sha256:[a-f0-9]{64}$/.test(input.sourceFingerprint)) throw new Error("Repository Audit source fingerprint is invalid.");
  if (!input.engineVersion.trim() || !input.rulesetVersion.trim()) throw new Error("Repository Audit engine identity is incomplete.");
  const identity = canonicalRepositoryAuditJson({
    sourceFingerprint: input.sourceFingerprint,
    engineVersion: input.engineVersion,
    rulesetVersion: input.rulesetVersion,
    limits: input.limits,
  });
  return `ra_${(await sha256Hex(encoder.encode(identity))).slice(0, 32)}`;
}

export async function repositoryAuditIntegrityDigest(reportWithoutDigest: unknown): Promise<string> {
  const canonical = canonicalRepositoryAuditJson(reportWithoutDigest);
  return `sha256:${await sha256Hex(encoder.encode(canonical))}`;
}

export async function verifyRepositoryAuditIntegrity(
  report: Record<string, unknown> & {
    integrity?: { canonicalJsonSha256?: unknown; [key: string]: unknown };
  },
): Promise<boolean> {
  const integrity = report.integrity;
  if (!integrity || typeof integrity.canonicalJsonSha256 !== "string") return false;
  const { canonicalJsonSha256, ...integrityWithoutDigest } = integrity;
  const reportWithoutIntegrity: Record<string, unknown> = { ...report };
  delete reportWithoutIntegrity.integrity;
  const digestInput = Object.keys(integrityWithoutDigest).length === 0
    ? reportWithoutIntegrity
    : { ...reportWithoutIntegrity, integrity: integrityWithoutDigest };
  const expected = await repositoryAuditIntegrityDigest(digestInput);
  return canonicalJsonSha256 === expected;
}
