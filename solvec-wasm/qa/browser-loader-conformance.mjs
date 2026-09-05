import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { stopBrowser } from "./browser-process.mjs";
const require = createRequire(import.meta.url);
const { verifyPackage } = require("./package-artifact.cjs");
const directory = path.resolve(process.argv[2]);
const sourceCommit = process.argv[3];
verifyPackage(directory, sourceCommit);
const manifest = fs.readFileSync(path.join(directory, "manifest.json"));
const manifestSha256 = crypto.createHash("sha256").update(manifest).digest("hex");
const fixtures = JSON.parse(fs.readFileSync(new URL("../../conformance/browser-preview-v1.json", import.meta.url)));
const resources = new Map([
  ["/loader.mjs", fs.readFileSync(new URL("../browser/loader.mjs", import.meta.url))],
  ...fs.readdirSync(directory).map(name => [`/package/${name}`, fs.readFileSync(path.join(directory, name))]),
]);
const harness = `<!doctype html><html><body><p id="status" role="status" data-result="running">Qualifying browser runtime</p><script type="module">
import { loadAuditedWasm, WASM_LOAD_FAILURE } from '/loader.mjs';
const status = document.getElementById('status');
const pin = ${JSON.stringify({ sourceCommit, manifestSha256 })};
const fixtures = ${JSON.stringify(fixtures.cases).replaceAll("<", "\\u003c")};
const check = (condition, message) => { if (!condition) throw new Error(message); };
let phase = 'load';
try {
  const runtime = await loadAuditedWasm({ ...pin, baseUrl: '/package/' });
  for (const fixture of fixtures) {
    phase = fixture.id;
    const first = runtime.runPure(fixture.source);
    check(first === runtime.runPure(fixture.source), 'non-deterministic execution');
    const result = JSON.parse(first);
    check(result.contract === 'solvelang.run_pure' && result.version === 1, 'contract');
    check(result.ok === (fixture.expect.outcome === 'success'), fixture.id);
    if (result.ok) check(JSON.stringify(result.outputs) === JSON.stringify(fixture.expect.outputs), fixture.id);
    else check(result.error.kind === fixture.expect.canonical_error, fixture.id);
  }
  for (const call of ['http_get("https://invalid.example")', 'http_post("https://invalid.example", "x")', 'read_file("secret")', 'write_file("secret", "x")', 'env("SECRET")', 'missing()', 'fetch("x")', 'eval("x")', 'spawn("x")', 'localStorage("x")']) {
    phase = 'capability denial';
    for (const source of [call, 'if false { ' + call + ' }', 'fn unused() { ' + call + ' }']) {
      const result = JSON.parse(runtime.runPure('print("MUST NOT PRINT")\\n' + source));
      check(!result.ok && result.error.kind === 'capability_denied' && result.outputs.length === 0, 'deny-before-output');
    }
  }
  for (const source of ['x'.repeat(1048577), 'print(' + '('.repeat(5000) + '1' + ')'.repeat(5000) + ')', 'let x = 1\\n'.repeat(1000), 'fn recurse() { return recurse() }\\nprint(recurse())', 'let n = 0\\nwhile true { n = n + 1 }']) {
    phase = 'bound ' + source.length;
    const result = JSON.parse(runtime.runPure(source));
    check(!result.ok && result.error.kind === 'limit_exceeded' && result.outputs.length === 0, 'bounded source');
  }
  const largeInput = JSON.parse(runtime.runPure('print(1)', 'x'.repeat(1048577)));
  check(!largeInput.ok && largeInput.error.kind === 'limit_exceeded', 'bounded input');
  for (const baseUrl of ['/missing/', '/corrupt/', '/oversized/', '/mismatch/']) {
    let rejected = false;
    try { await loadAuditedWasm({ ...pin, baseUrl }); } catch (error) {
      check(error.message === WASM_LOAD_FAILURE, 'private load diagnostic');
      status.setAttribute('role', 'alert'); status.textContent = error.message;
      check(status.textContent.includes('No script was executed'), 'visible failure');
      rejected = true;
    }
    check(rejected, 'missing fail-closed boundary');
  }
  status.dataset.result = 'passed'; status.textContent = 'PASS: packaged browser conformance and visible fail-closed loading';
} catch (error) { status.dataset.result = 'failed'; status.textContent = 'FAIL at ' + phase + ': ' + error.message; }
</script></body></html>`;
resources.set("/", Buffer.from(harness));
const requests = [];
const server = http.createServer((request, response) => {
  const route = request.url;
  requests.push(route);
  let bytes = resources.get(route);
  if (/^\/(corrupt|oversized|mismatch)\//.test(route)) {
    bytes = resources.get(route.replace(/^\/[^/]+\//, "/package/"));
    if (route === "/corrupt/solvec_wasm_bg.wasm") bytes = Buffer.from([0, 1, 2]);
    if (route === "/oversized/solvec_wasm_bg.wasm") bytes = Buffer.alloc(600001);
    if (route === "/mismatch/manifest.json") bytes = Buffer.from("{}");
  }
  response.writeHead(bytes ? 200 : 404, { "content-type": route.endsWith(".mjs") ? "text/javascript" : route === "/" ? "text/html" : "application/octet-stream", "cache-control": "no-store" });
  response.end(bytes ?? "missing");
});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "solvelang-browser-qa-"));
let browser;
let socket;
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const chrome = process.env.CHROME_BIN || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
  browser = spawn(chrome, [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--disable-extensions", "--disable-sync", "--no-first-run", "--no-default-browser-check",
    "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1", `--user-data-dir=${profile}`,
    "--remote-debugging-port=0", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], timeout: 90000 });
  const endpoint = await new Promise((resolve, reject) => {
    let buffer = "";
    const diagnostic = () => ["crashpad", "database is required", "error while loading shared libraries", "Permission denied", "No usable sandbox", "DevTools listening", "Cannot fork", "Trace/breakpoint trap"].filter(value => buffer.includes(value)).join(", ") || "no recognized startup diagnostic";
    const timer = setTimeout(() => reject(new Error(`Chrome debugging startup timed out (${diagnostic()}; exit=${browser.exitCode}; signal=${browser.signalCode})`)), 10000);
    browser.once("error", error => { clearTimeout(timer); reject(error); });
    browser.once("exit", (code, signal) => { clearTimeout(timer); reject(new Error(`Chrome exited before qualification (${diagnostic()}; exit=${code}; signal=${signal})`)); });
    browser.stderr.on("data", bytes => {
      buffer = (buffer + bytes).slice(-4096);
      const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-zA-Z0-9-]+)/.exec(buffer);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const result = JSON.parse(event.data);
    const callback = pending.get(result.id);
    if (callback) { pending.delete(result.id); callback(result); }
  });
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome command timed out: ${method}`)); }, 45000);
    pending.set(id, response => { clearTimeout(timer); response.error ? reject(new Error(`Chrome command failed: ${method}`)) : resolve(response.result); });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await command("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  await command("Page.enable", {}, sessionId);
  await command("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` }, sessionId);
  // Use real time: virtual-time dump-dom can finish while WebAssembly compilation is pending.
  let result;
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 200));
    result = await command("Runtime.evaluate", { expression: "document.getElementById('status')?.outerHTML ?? ''", returnByValue: true }, sessionId);
    if (/data-result="(?:passed|failed)"/.test(result.result?.value ?? "")) break;
  }
  const status = result.result?.value ?? "missing status";
  assert.ok(/data-result="passed"/.test(status), `browser qualification failed: ${status}; local requests: ${requests.length}`);
  assert.ok(requests.every(route => route === "/" || route === "/favicon.ico" || route === "/loader.mjs" || /^\/(package|missing|corrupt|oversized|mismatch)\/(manifest.json|solvec_wasm.js|solvec_wasm_bg.js|solvec_wasm_bg.wasm)$/.test(route)), "unexpected local request");
  console.log(`Packaged browser adapter PASS: ${fixtures.cases.length} shared cases, 30 denied cases, 6 bounds, 4 visible load failures`);
} finally {
  socket?.close();
  await stopBrowser(browser);
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}
