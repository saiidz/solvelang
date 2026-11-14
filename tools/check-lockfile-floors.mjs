#!/usr/bin/env node
// Lockfile floors: mechanical pins for dependency versions a
// security advisory has already burned once.
//
// cargo audit catches NEW advisories. This guard catches the other
// direction — a future lockfile edit (a careless `cargo update`, a
// bad merge resolution) silently dropping a crate back below the
// version that fixed a known advisory. Each floor names its
// advisory; add a line when a new one lands.
//
// Usage: node tools/check-lockfile-floors.mjs [path/to/Cargo.lock]
// Default lockfile: solvec/Cargo.lock (relative to the repo root
// when run from solvec/, the argument wins).

import { readFileSync } from "node:fs";

const FLOORS = [
  { crate: "quinn-udp", min: "0.5.16", advisory: "RUSTSEC-2026-0538" },
];

function compareVersions(a, b) {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function lockedVersions(lockText, crate) {
  const versions = [];
  const blocks = lockText.split("[[package]]");
  for (const block of blocks) {
    const name = block.match(/^\s*name = "([^"]+)"/m);
    const version = block.match(/^\s*version = "([^"]+)"/m);
    if (name && version && name[1] === crate) versions.push(version[1]);
  }
  return versions;
}

const lockPath = process.argv[2] || "solvec/Cargo.lock";
const lockText = readFileSync(lockPath, "utf8");
let failed = false;
for (const floor of FLOORS) {
  const versions = lockedVersions(lockText, floor.crate);
  if (versions.length === 0) {
    console.log(`floor note: ${floor.crate} is not in ${lockPath} — nothing to pin (${floor.advisory})`);
    continue;
  }
  for (const version of versions) {
    if (compareVersions(version, floor.min) < 0) {
      console.error(
        `floor violation: ${floor.crate} ${version} < ${floor.min} (${floor.advisory}) in ${lockPath}`
      );
      failed = true;
    } else {
      console.log(`floor ok: ${floor.crate} ${version} >= ${floor.min} (${floor.advisory})`);
    }
  }
}
process.exit(failed ? 1 : 0);
