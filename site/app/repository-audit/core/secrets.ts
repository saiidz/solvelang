export type SecretPatternClass =
  | "api-key"
  | "token"
  | "password"
  | "private-key"
  | "connection-string"
  | "credential-file"
  | "unknown-secret";

export type SecretExposure = "tracked" | "public-path" | "generated-output" | "archive" | "unknown";

export type RedactedSecretWarning = {
  warningId: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  patternClass: SecretPatternClass;
  exposure: SecretExposure;
  redacted: true;
  fingerprint: string;
  remediation: string;
};

export type SecretScanInput = {
  path: string;
  text?: string;
  generated?: boolean;
};

type Pattern = {
  className: SecretPatternClass;
  regex: RegExp;
  remediation: string;
};

const patterns: Pattern[] = [
  {
    className: "private-key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    remediation: "Remove the private key from tracked content, rotate the credential, and purge exposed history if necessary.",
  },
  {
    className: "connection-string",
    regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]{8,}/gi,
    remediation: "Move the connection credential to an approved secret store and rotate any exposed password or token.",
  },
  {
    className: "api-key",
    regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    remediation: "Revoke or rotate the exposed API credential and replace tracked values with secret references.",
  },
  {
    className: "token",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{30,255}\b/g,
    remediation: "Revoke or rotate the exposed token and store future values outside repository content.",
  },
  {
    className: "token",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,255}\b/g,
    remediation: "Revoke or rotate the exposed token and store future values outside repository content.",
  },
  {
    className: "password",
    regex: /\b(?:password|passwd|pwd)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
    remediation: "Remove the embedded password, rotate it, and reference an approved secret source instead.",
  },
];

function normalizePath(input: string): string {
  if (!input || input.startsWith("/") || input.includes("\\") || input.split("/").includes("..")) {
    throw new Error("Secret scan path must be repository-relative POSIX text.");
  }
  return input.split("/").filter((segment) => segment && segment !== ".").join("/");
}

function exposureFor(path: string, generated = false): SecretExposure {
  const lower = path.toLowerCase();
  if (generated || lower.split("/").some((segment) => ["dist", "build", ".next", "out", "coverage"].includes(segment))) {
    return "generated-output";
  }
  if (/\.(?:zip|tar|tgz|gz|7z|rar)$/i.test(lower)) return "archive";
  if (lower === "public" || lower.startsWith("public/") || lower.includes("/public/")) return "public-path";
  return "tracked";
}

function fnv64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const char of value) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (text.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function credentialFilename(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if ([".env", ".env.local", ".env.production", "credentials.json", "service-account.json", "id_rsa", "id_ed25519"].includes(name)) return true;
  return /(?:credentials?|secrets?)\.(?:json|ya?ml|txt)$/i.test(name);
}

export function scanRepositorySecrets(files: SecretScanInput[], fingerprintKey: string): RedactedSecretWarning[] {
  if (typeof fingerprintKey !== "string" || fingerprintKey.length < 16) throw new Error("Ephemeral secret fingerprint key is required.");
  const warnings: RedactedSecretWarning[] = [];

  for (const file of files) {
    const path = normalizePath(file.path);
    const text = typeof file.text === "string" ? file.text : "";
    const exposure = exposureFor(path, file.generated);

    if (credentialFilename(path)) {
      const identity = `${fingerprintKey}:credential-file:${path}:1`;
      warnings.push({
        warningId: `sec_${fnv64(`credential-file:${path}:1`)}`,
        path,
        lineStart: 1,
        lineEnd: 1,
        patternClass: "credential-file",
        exposure,
        redacted: true,
        fingerprint: `hmac-sha256:${fnv64(identity).repeat(4)}`,
        remediation: "Review the credential file immediately; remove live credentials from tracked content and rotate any exposed values.",
      });
    }

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(text)) !== null) {
        const line = lineNumberAt(text, match.index);
        const stableIdentity = `${pattern.className}:${path}:${line}`;
        const ephemeralIdentity = `${fingerprintKey}:${stableIdentity}:${match[0].length}`;
        warnings.push({
          warningId: `sec_${fnv64(stableIdentity)}`,
          path,
          lineStart: line,
          lineEnd: line,
          patternClass: pattern.className,
          exposure,
          redacted: true,
          fingerprint: `hmac-sha256:${fnv64(ephemeralIdentity).repeat(4)}`,
          remediation: pattern.remediation,
        });
        if (match[0].length === 0) pattern.regex.lastIndex += 1;
      }
    }
  }

  return warnings.sort((left, right) =>
    left.path.localeCompare(right.path)
      || left.lineStart - right.lineStart
      || left.patternClass.localeCompare(right.patternClass)
      || left.warningId.localeCompare(right.warningId));
}
