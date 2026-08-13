import type { RepositoryFileInput, RepositorySnapshot } from "./inventory";

export type RepositorySecretPatternClass =
  | "api-key"
  | "token"
  | "password"
  | "private-key"
  | "connection-string"
  | "credential-file"
  | "unknown-secret";

export type RepositorySecretExposure = "tracked" | "public-path" | "generated-output" | "archive" | "unknown";

export type RepositorySecretWarning = {
  warningId: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  patternClass: RepositorySecretPatternClass;
  exposure: RepositorySecretExposure;
  redacted: true;
  fingerprint: string;
  remediation: string;
};

type SecretPattern = {
  patternClass: RepositorySecretPatternClass;
  expression: RegExp;
  capture?: number;
  remediation: string;
};

const patterns: SecretPattern[] = [
  {
    patternClass: "private-key",
    expression: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    remediation: "Remove the private key from tracked content, rotate it, and replace it with a secret-manager reference.",
  },
  {
    patternClass: "api-key",
    expression: /\b(?:sk_(?:live|test)_[A-Za-z0-9]{16,}|sl_(?:live|test)_[A-Za-z0-9_-]{24,}|AKIA[0-9A-Z]{16})\b/g,
    remediation: "Remove the exposed API credential, rotate it, and load it from a secret store or protected environment variable.",
  },
  {
    patternClass: "token",
    expression: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g,
    remediation: "Revoke or rotate the exposed token and replace the tracked value with a protected secret reference.",
  },
  {
    patternClass: "connection-string",
    expression: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:[^@\s/]+@[^\s"'<>]+/gi,
    remediation: "Rotate the embedded credential and move connection secrets out of repository content.",
  },
  {
    patternClass: "password",
    expression: /\b(?:password|passwd|pwd)\s*[:=]\s*["']?([^\s"',;]{8,})/gi,
    capture: 1,
    remediation: "Remove the password value from tracked content, rotate it, and reference a protected secret instead.",
  },
  {
    patternClass: "token",
    expression: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{16,})/gi,
    capture: 1,
    remediation: "Remove the credential value from tracked content, rotate it, and reference a protected secret instead.",
  },
];

const credentialFileNames = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "credentials",
  "credentials.json",
  "service-account.json",
]);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Secure SHA-256 support is unavailable for Repository Audit redaction.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256(keyBytes: Uint8Array, value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Secure HMAC support is unavailable for Repository Audit redaction.");
  const key = await subtle.importKey("raw", new Uint8Array(keyBytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function ephemeralKey(): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure random support is unavailable for Repository Audit redaction.");
  const key = new Uint8Array(32);
  globalThis.crypto.getRandomValues(key);
  return key;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase();
}

function exposureFor(file: RepositoryFileInput): RepositorySecretExposure {
  const lower = file.path.toLowerCase();
  if (/(?:^|\/)public(?:\/|$)|(?:^|\/)static(?:\/|$)/.test(lower)) return "public-path";
  if (file.generated || /(?:^|\/)(?:dist|out|coverage|\.next|target|generated)(?:\/|$)/.test(lower)) return "generated-output";
  if (/\.(?:zip|tar|tgz|tar\.gz|gz|7z|rar)$/i.test(lower)) return "archive";
  return "tracked";
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (text.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function likelyPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.includes("example")
    || normalized.includes("placeholder")
    || normalized.includes("changeme")
    || normalized.includes("yourkey")
    || normalized.includes("yourtoken")
    || /^x+$/.test(normalized)
    || /^0+$/.test(normalized);
}

async function warningId(path: string, line: number, patternClass: RepositorySecretPatternClass, exposure: RepositorySecretExposure): Promise<string> {
  return `sec_${(await sha256(`${path}\u0000${line}\u0000${patternClass}\u0000${exposure}`)).slice(0, 24)}`;
}

export async function scanRepositorySecrets(
  snapshot: RepositorySnapshot,
  options: { hmacKey?: Uint8Array } = {},
): Promise<RepositorySecretWarning[]> {
  const hmacKey = options.hmacKey ? new Uint8Array(options.hmacKey) : ephemeralKey();
  if (hmacKey.byteLength < 32) throw new Error("Repository Audit redaction HMAC key must contain at least 32 bytes.");

  const warnings: RepositorySecretWarning[] = [];
  const seen = new Set<string>();
  const sortedFiles = [...snapshot.files].sort((left, right) => left.path.localeCompare(right.path));

  for (const file of sortedFiles) {
    if (typeof file.text !== "string" || file.text.length === 0) continue;
    const exposure = exposureFor(file);
    const name = basename(file.path);

    if (credentialFileNames.has(name) && !name.endsWith(".example")) {
      const id = await warningId(file.path, 1, "credential-file", exposure);
      const key = `${id}:credential-file`;
      if (!seen.has(key)) {
        seen.add(key);
        warnings.push({
          warningId: id,
          path: file.path,
          lineStart: 1,
          lineEnd: 1,
          patternClass: "credential-file",
          exposure,
          redacted: true,
          fingerprint: `hmac-sha256:${await hmacSha256(hmacKey, `${file.path}:credential-file`)}`,
          remediation: "Review this credential-bearing file. Remove tracked secrets, rotate exposed credentials, and keep only a safe example template where appropriate.",
        });
      }
    }

    for (const definition of patterns) {
      definition.expression.lastIndex = 0;
      for (let match = definition.expression.exec(file.text); match; match = definition.expression.exec(file.text)) {
        const raw = definition.capture ? match[definition.capture] : match[0];
        if (!raw || likelyPlaceholder(raw)) continue;
        const line = lineNumberAt(file.text, match.index);
        const id = await warningId(file.path, line, definition.patternClass, exposure);
        const dedupeKey = `${id}:${definition.patternClass}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const secretFingerprint = await hmacSha256(hmacKey, raw);
        warnings.push({
          warningId: id,
          path: file.path,
          lineStart: line,
          lineEnd: line,
          patternClass: definition.patternClass,
          exposure,
          redacted: true,
          fingerprint: `hmac-sha256:${secretFingerprint}`,
          remediation: definition.remediation,
        });
      }
    }
  }

  return warnings.sort((left, right) => left.path.localeCompare(right.path)
    || left.lineStart - right.lineStart
    || left.patternClass.localeCompare(right.patternClass)
    || left.warningId.localeCompare(right.warningId));
}
