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

test("every API handler route has a template HttpApi event", async () => {
  const { handler, template } = await loadSources();
  const wired = templatePaths(template);
  const missing = [...handlerRoutes(handler)].filter((route) => !wired.has(route));
  assert.deepEqual(missing, [], `handler routes missing template events: ${missing.join(", ")}`);
});

test("the embedded checkout routes are wired at the gateway", async () => {
  const { template } = await loadSources();
  const wired = templatePaths(template);
  assert.ok(wired.has("/customer/subscriptions/elements-checkout"));
  assert.ok(wired.has("/internal/subscriptions/elements-checkout"));
});
