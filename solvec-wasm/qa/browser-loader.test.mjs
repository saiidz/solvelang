import assert from "node:assert/strict";
import test from "node:test";
import { loadAuditedWasm, WASM_LOAD_FAILURE } from "../browser/loader.mjs";
import { stopBrowser } from "./browser-process.mjs";

test("cleanup never waits for an exit event that already fired after a signal", async () => {
  for (const state of [{ exitCode: null, signalCode: "SIGTERM" }, { exitCode: 0, signalCode: null }]) {
    await stopBrowser({ ...state, kill() { assert.fail("already stopped"); }, once() { assert.fail("exit already fired"); } });
  }
  await stopBrowser(undefined);
});

test("loader refuses server-side execution without fetching or falling back", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must not fetch"); };
  try {
    await assert.rejects(loadAuditedWasm({}), { message: WASM_LOAD_FAILURE });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("invalid pins and external package URLs fail before any asset request", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalSecure = globalThis.isSecureContext;
  let calls = 0;
  globalThis.window = { location: { href: "https://local.test/run/", origin: "https://local.test" } };
  globalThis.isSecureContext = true;
  globalThis.fetch = async () => { calls++; throw new Error("private-marker"); };
  const pin = { sourceCommit: "a".repeat(40), manifestSha256: "b".repeat(64) };
  try {
    for (const options of [{ ...pin, baseUrl: "https://external.test/" }, { ...pin, baseUrl: "/package/?token=secret" }, { ...pin, baseUrl: "/package/", sourceCommit: "short" }]) {
      await assert.rejects(loadAuditedWasm(options), { message: WASM_LOAD_FAILURE });
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; globalThis.isSecureContext = originalSecure; }
});

test("transport, missing, oversized and mismatched manifest failures expose only fixed diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalSecure = globalThis.isSecureContext;
  globalThis.window = { location: { href: "https://local.test/run/", origin: "https://local.test" } };
  globalThis.isSecureContext = true;
  try {
    for (const response of [new Error("private-marker"), new Response("private-marker", { status: 404 }), new Response("x".repeat(16385)), new Response("{}")]) {
      globalThis.fetch = async (_url, options) => {
        assert.equal(options.credentials, "omit");
        assert.equal(options.redirect, "error");
        assert.ok(options.signal instanceof AbortSignal);
        if (response instanceof Error) throw response;
        return response;
      };
      await assert.rejects(loadAuditedWasm({ baseUrl: "/package/", sourceCommit: "a".repeat(40), manifestSha256: "b".repeat(64) }), { message: WASM_LOAD_FAILURE });
    }
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; globalThis.isSecureContext = originalSecure; }
});
