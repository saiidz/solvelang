// Shared fixtures for the Phase 6 bus validation tests: the
// spike's five-file repository, its expected final state, and the
// per-agent key material in the Phase 4 artifact formats.
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const execFileAsync = promisify(execFile);
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const busCliPath = path.join(packageRoot, "dist", "src", "bus-cli.js");
export const agentScriptPath = path.join(packageRoot, "scripts", "bus-validation-agent.mjs");

export const INITIAL: Record<string, string[]> = {
  "auth.txt": ["auth: password-login"],
  "api.txt": ["api: v1 endpoints"],
  "ui.txt": ["ui: light-mode"],
  "shared-config.txt": ["config: retries=3"],
  "changelog.txt": ["change: init"],
};
export const EXPECTED: Record<string, string[]> = {
  "auth.txt": ["auth: password-login", "auth: token-refresh", "review: approved"],
  "api.txt": ["api: v1 endpoints", "api: rate-limit", "review: api approved", "api: released"],
  "ui.txt": ["ui: light-mode", "ui: dark-mode"],
  "shared-config.txt": ["config: retries=3", "config: timeout=30", "config: theme=dark"],
  "changelog.txt": ["change: init", "change: api rate-limit", "change: ui dark-mode"],
};

export interface AgentResult {
  agent: string;
  wallMs?: number;
  fallbackUsed?: boolean;
  error?: string;
  metrics: { lateConflicts: number; claimTimeConflicts: number };
}

function keyMaterial(): { seed: Buffer; publicKey: Buffer } {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string };
  return {
    seed: Buffer.from(jwk.d, "base64url"),
    publicKey: Buffer.from(jwk.x, "base64url"),
  };
}

export function setupWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "solvelang-bus-validation-"));
  mkdirSync(path.join(workspace, "repo"), { recursive: true });
  for (const [file, lines] of Object.entries(INITIAL)) {
    writeFileSync(path.join(workspace, "repo", file), `${lines.join("\n")}\n`);
  }
  const keysDir = path.join(workspace, "keys");
  mkdirSync(keysDir, { recursive: true });
  const keyEntries: Array<Record<string, string>> = [];
  for (const agent of ["producer", "reviewer"]) {
    const material = keyMaterial();
    keyEntries.push({
      id: agent,
      algorithm: "ed25519",
      public_key: material.publicKey.toString("base64"),
      status: "active",
    });
    writeFileSync(
      path.join(keysDir, `${agent}.key.json`),
      JSON.stringify(
        {
          format: "solvelang.private-key",
          version: 1,
          id: agent,
          algorithm: "ed25519",
          private_key: material.seed.toString("base64"),
        },
        null,
        2,
      ),
    );
  }
  writeFileSync(
    path.join(keysDir, "registry.json"),
    JSON.stringify({ format: "solvelang.key-registry", version: 1, keys: keyEntries }, null, 2),
  );
  return workspace;
}

export async function runAgent(workspace: string, agent: string): Promise<void> {
  await execFileAsync(
    process.execPath,
    [agentScriptPath, "--agent", agent, "--workspace", workspace, "--keys", path.join(workspace, "keys")],
    { timeout: 100_000 },
  );
}

export function readResult(workspace: string, agent: string): AgentResult {
  return JSON.parse(readFileSync(path.join(workspace, `result-${agent}.json`), "utf8")) as AgentResult;
}

export function assertFinalState(workspace: string): void {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    const lines = readFileSync(path.join(workspace, "repo", file), "utf8").trim().split("\n");
    assert.deepEqual([...lines].sort(), [...expected].sort(), `${file} final line set`);
    assert.equal(lines.length, new Set(lines).size, `${file} has no duplicate lines`);
  }
}

export { execFileAsync };
