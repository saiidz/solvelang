import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const FORBIDDEN_SECRET_NAMES = Object.freeze([
  ["STRIPE", "SECRET", "KEY"].join("_"),
  ["STRIPE", "SUBSCRIPTION", "WEBHOOK", "SECRET"].join("_"),
]);

export function findProductionStripeSecretReferences(source) {
  if (typeof source !== "string") throw new Error("Workflow source must be text.");
  const found = [];
  for (const name of FORBIDDEN_SECRET_NAMES) {
    const reference = ["secrets", name].join(".");
    if (source.includes(reference)) found.push(reference);
  }
  return found;
}

export async function assertNoProductionStripeSecretReferences(path) {
  if (typeof path !== "string" || !path) throw new Error("Workflow path is required.");
  const source = await readFile(path, "utf8");
  const found = findProductionStripeSecretReferences(source);
  if (found.length > 0) {
    throw new Error(`Production authenticator workflow must not reference billing secrets: ${found.join(", ")}`);
  }
}

async function main() {
  const path = process.argv[2];
  await assertNoProductionStripeSecretReferences(path);
  console.log(`No production Stripe secret references found in ${path}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
