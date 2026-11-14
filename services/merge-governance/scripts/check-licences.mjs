#!/usr/bin/env node
// Shield licence gate for the merge-governance service.
//
// Clean-room rule: this service may only depend on permissively licensed
// packages. For every DIRECT dependency in package.json this script
// resolves the licence — from a small built-in map, or with
// --from-node-modules from the installed package.json licence fields —
// and fails (exit 1, offender named) on any copyleft licence
// (GPL / AGPL / LGPL family) or any licence it cannot identify.
//
// Usage:
//   node scripts/check-licences.mjs [--from-node-modules]

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serviceDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const fromNodeModules = process.argv.includes("--from-node-modules");

export const ALLOWLIST = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
]);

const COPYLEFT_PATTERN = /\b(A?GPL|LGPL|AGPL)(-[0-9.]+)?\b/i;

// Known licences for the direct dependencies this service is built on
// (AWS SDK v3 packages are Apache-2.0). Anything not in this map must be
// resolved from node_modules or the gate fails closed.
export const KNOWN_LICENCES = new Map([
  ["@aws-sdk/client-dynamodb", "Apache-2.0"],
  ["@aws-sdk/lib-dynamodb", "Apache-2.0"],
  ["@aws-sdk/client-sqs", "Apache-2.0"],
]);

export function licenceAllowed(raw) {
  if (!raw || typeof raw !== "string") return false;
  if (COPYLEFT_PATTERN.test(raw)) return false;
  // SPDX expressions: every listed licence must be allowlisted.
  const tokens = raw
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND)\s+|\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => ALLOWLIST.has(t));
}

function licenceFromNodeModules(name) {
  const pkgPath = join(serviceDir, "node_modules", name, "package.json");
  if (!existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses.map((l) => l.type).filter(Boolean).join(" OR ");
  }
  return null;
}

function main() {
  const pkg = JSON.parse(readFileSync(join(serviceDir, "package.json"), "utf8"));
  const deps = Object.keys(pkg.dependencies || {});
  const offenders = [];
  for (const name of deps) {
    let licence = KNOWN_LICENCES.get(name) || null;
    if (!licence && fromNodeModules) licence = licenceFromNodeModules(name);
    if (!licence) {
      offenders.push(`${name}: licence unknown (not in built-in map${fromNodeModules ? " or node_modules" : ""})`);
      continue;
    }
    if (!licenceAllowed(licence)) {
      offenders.push(`${name}: licence "${licence}" is not allowlisted`);
    } else {
      console.log(`ok ${name} (${licence})`);
    }
  }
  if (offenders.length > 0) {
    console.error("LICENCE GATE FAILED:");
    for (const offender of offenders) console.error(`  - ${offender}`);
    process.exit(1);
  }
  console.log(`licence gate passed for ${deps.length} direct dependencies`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
