import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configSource = await readFile(new URL("../src/config.js", import.meta.url), "utf8");
const handlerSource = await readFile(new URL("../src/handler.js", import.meta.url), "utf8");
const apiHandlerSource = await readFile(new URL("../src/api-handler.js", import.meta.url), "utf8");
const moduleSource = await readFile(new URL("../src/ci-bill-check.js", import.meta.url), "utf8");

test("CI_BILL_CHECK_ENABLED is parsed fail-closed and spread into the environment", () => {
  assert.ok(configSource.includes('ciBillCheckEnabled: environment.CI_BILL_CHECK_ENABLED === "true"'), "flag parsed with the exact-true comparison");
  assert.ok(configSource.includes("...ciBillCheck(environment)"), "section spread into the environment");
});

test("the handler constructs the bill check from the flag and hands it over", () => {
  assert.ok(handlerSource.includes('import { createCiBillCheck } from "./ci-bill-check.js";'));
  assert.ok(handlerSource.includes("const ciBillCheck = createCiBillCheck({ enabled: environment.ciBillCheckEnabled });"));
  assert.ok(handlerSource.includes("ciBillCheck,"));
});

test("the API handler routes /public/ci-bill-check with the disabled refusal", () => {
  assert.ok(apiHandlerSource.includes("ciBillCheck = null,"));
  assert.ok(apiHandlerSource.includes('path.endsWith("/public/ci-bill-check")'));
  assert.ok(apiHandlerSource.includes("if (!ciBillCheck)"));
  assert.ok(apiHandlerSource.includes('"ci_bill_check_disabled"'));
  const handleCall = apiHandlerSource.slice(apiHandlerSource.indexOf("ciBillCheck.handle({"));
  assert.ok(handleCall.includes("method,"), "handle receives the method");
  assert.ok(handleCall.includes("bodyText: bodyText(event),"), "handle receives the raw body");
  assert.ok(handleCall.includes('source: event?.requestContext?.http?.sourceIp ?? "unknown",'), "handle receives the source address");
});

test("the bill check module stays self-contained and carries the honest-pricing pins", () => {
  assert.ok(!moduleSource.includes('from "./'), "no sibling imports");
  assert.ok(!moduleSource.includes('from "node:'), "no node: imports");
  assert.ok(moduleSource.includes("solvelang.ci-bill-check.v1"));
  assert.ok(moduleSource.includes("linux: 0.008"));
  assert.ok(moduleSource.includes("windows: 0.016"));
  assert.ok(moduleSource.includes("macos: 0.08"));
  assert.ok(moduleSource.includes("limit: 60, windowMs: 60_000"));
  assert.ok(moduleSource.includes("Data unavailable:"));
  assert.ok(!moduleSource.includes("riskScore"));
});
