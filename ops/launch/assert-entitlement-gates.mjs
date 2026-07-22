#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectRepositoryState } from "./launch-control.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repository = await collectRepositoryState(root);

assert.deepEqual(repository.entitlement, {
  healthRoute: true,
  privacySafe: true,
  testModeE2eHarness: true,
  refundAware: true,
});

console.log("Entitlement launch code gates: PASS");
