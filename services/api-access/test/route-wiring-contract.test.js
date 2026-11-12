import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Route-wiring contract: every route the API handler implements must have a
// matching HttpApi event in template.yaml. A handler route without a gateway
// event is unreachable in production — API Gateway answers 404 with no CORS
// headers, which surfaces in the browser only as "Failed to fetch" (the
// embedded checkout broke exactly this way: the handler and the site agreed
// on /customer/subscriptions/elements-checkout, but no event existed).
// This test fails closed if either side drifts again.
//
// A template Path ending in /{proxy+} is a greedy gateway route: it wires
// every handler route under its prefix (the handler dispatches on the full
// path itself). Greedy families exist because each exact-route event adds
// one statement to the Lambda resource policy, which has a hard 20,480-byte
// ceiling — the per-route permission for /customer/live-center/minutes
// pushed the policy to 20,875 bytes and rolled back the Nov 11, 2026
// api-access deploy. Consolidating a read-only family into one greedy
// event keeps the policy under the ceiling without unwiring any route.

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadSources() {
  const [handler, template] = await Promise.all([
    readFile(path.join(serviceRoot, "src/api-handler.js"), "utf8"),
    readFile(path.join(serviceRoot, "template.yaml"), "utf8"),
  ]);
  return { handler, template };
}

function handlerRoutes(handler) {
  const routes = new Set();
  for (const match of handler.matchAll(/path\.endsWith\("([^"]+)"\)/g)) routes.add(match[1]);
  for (const match of handler.matchAll(/path === "([^"]+)"/g)) routes.add(match[1]);
  return routes;
}

function templatePaths(template) {
  const paths = new Set();
  for (const match of template.matchAll(/^\s+Path: (\/\S+)\s*$/gm)) paths.add(match[1]);
  return paths;
}

function greedyPrefixes(paths) {
  const suffix = "/{proxy+}";
  return [...paths]
    .filter((entry) => entry.endsWith(suffix))
    .map((entry) => entry.slice(0, entry.length - suffix.length + 1));
}

function isWired(route, wired) {
  if (wired.has(route)) return true;
  return greedyPrefixes(wired).some((prefix) => route.startsWith(prefix));
}

// TRANSITIONAL (Nov 11, 2026): the three greedy events are removed for
// exactly one deploy so CloudFormation deletes their Lambda permissions
// before the replacements are created — creating first overflows the
// 20,480-byte resource-policy ceiling mid-update and rolls the stack
// back. The child PR restores the greedy events and this exemption
// together; while this exemption exists, the routes below answer 404
// at the gateway.
const TRANSITIONAL_UNWIRED_PREFIXES = [
  "/public/status/",
  "/customer/live-center/",
  "/customer/connect/",
];

test("every API handler route has a template HttpApi event", async () => {
  const { handler, template } = await loadSources();
  const wired = templatePaths(template);
  const missing = [...handlerRoutes(handler)].filter(
    (route) =>
      !isWired(route, wired) &&
      !TRANSITIONAL_UNWIRED_PREFIXES.some((prefix) => route.startsWith(prefix)),
  );
  assert.deepEqual(missing, [], `handler routes missing template events: ${missing.join(", ")}`);
});

test("the embedded checkout routes are wired at the gateway", async () => {
  const { template } = await loadSources();
  const wired = templatePaths(template);
  assert.ok(wired.has("/customer/subscriptions/elements-checkout"));
  assert.ok(wired.has("/internal/subscriptions/elements-checkout"));
});
