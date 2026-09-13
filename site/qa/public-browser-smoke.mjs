// Dependency-free Chromium smoke test against the actual static export, never production.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../out", import.meta.url));
const output = fileURLToPath(new URL("../.studio-test-dist/browser-smoke", import.meta.url));
const chrome = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => p && existsSync(p));
assert.ok(chrome, "Chromium required: set CHROME_BIN. Do not silently skip browser acceptance tests.");
assert.ok(existsSync(join(root, "index.html")), "Build the static site first.");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
    if (!existsSync(path)) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(path));
  } catch { res.writeHead(400).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), "solvelang-browser-"));
const browser = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, message, ms = 15000) { const until = Date.now() + ms; while (Date.now() < until) { if (await fn()) return; await sleep(100); } throw new Error(message); }
let ws;
try {
  await waitFor(() => existsSync(join(profile, "DevToolsActivePort")), "Chromium did not start");
  const [port, endpoint] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").trim().split("\n");
  ws = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const exceptions = [];
  function call(method, params = {}, sessionId) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  ws.addEventListener("message", async event => {
    const data = JSON.parse(String(event.data));
    if (data.id && pending.has(data.id)) {
      const entry = pending.get(data.id); pending.delete(data.id); clearTimeout(entry.timer);
      if (data.error) entry.reject(new Error(data.error.message)); else entry.resolve(data.result);
    }
    if (data.method === "Runtime.exceptionThrown") exceptions.push(data.params.exceptionDetails.text);
    if (data.method === "Fetch.requestPaused") {
      // No account/API/provider request is allowed by this test, even when a page attempts one.
      const url = data.params.request.url;
      try { await call(url.startsWith(base + "/") ? "Fetch.continueRequest" : "Fetch.failRequest", { requestId: data.params.requestId, ...(url.startsWith(base + "/") ? {} : { errorReason: "BlockedByClient" }) }, data.sessionId); } catch { /* teardown */ }
    }
  });
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  const command = (method, params) => call(method, params, sessionId);
  await command("Page.enable"); await command("Runtime.enable");
  await command("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  const visible = `e => !!e && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)`;
  async function navigate(route) {
    await command("Page.navigate", { url: base + route });
    await waitFor(() => evaluate(`location.pathname === ${JSON.stringify(route)} && document.readyState === 'complete' && !!document.querySelector('[data-site-header]')`), `Page did not load: ${route}`);
    await sleep(250);
  }
  const routes = ["/", "/audit/", "/demo/support-triage/", "/about/", "/resources/", "/status/", "/run/", "/studio/", "/api-pricing/", "/check/", "/repository-audit/"];
  const toolRoutes = ["/about/", "/api-pricing/", "/check/", "/repository-audit/"];
  const destinations = ["/audit/", "/demo/support-triage/", "/run/", "/studio/", "/resources/", "/status/", "/account/api-keys/"];
  mkdirSync(output, { recursive: true });
  for (const width of [1366, 375, 320]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const route of routes) {
      await navigate(route);
      assert.equal(await evaluate(`document.querySelectorAll('[data-site-header]').length`), 1, `one header: ${route}`);
      assert.ok(await evaluate(`document.querySelector('#site-content')?.getAttribute('tabindex') === '-1'`));
      assert.ok(await evaluate(`document.querySelector('[data-site-header]').scrollWidth <= innerWidth`), `header fits ${width}: ${route}`);
      if (width < 1280 || toolRoutes.includes(route)) {
        await evaluate(`document.querySelector('[data-site-menu] summary').click()`);
        assert.ok(await evaluate(`document.querySelector('[data-site-menu]').open`));
      }
      for (const href of destinations) assert.ok(await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(`[data-site-header] a[href="${href}"]`)})).some(${visible})`), `visible ${href}, ${width}, ${route}`);
      if (route !== "/") assert.ok(await evaluate(`Array.from(document.querySelectorAll('[data-site-header] a[aria-current="page"]')).some(${visible})`), `active page ${route}`);
      if (width < 1280 || toolRoutes.includes(route)) {
        await evaluate(`document.querySelector('[data-site-menu] summary').focus()`);
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
        await waitFor(() => evaluate(`!document.querySelector('[data-site-menu]').open`), `Escape did not close menu: ${route}`);
        assert.ok(await evaluate(`document.activeElement === document.querySelector('[data-site-menu] summary')`));
      }
    }
    await navigate("/audit/");
    if (width < 1280) await evaluate(`document.querySelector('[data-site-menu] summary').click()`);
    await evaluate(`Array.from(document.querySelectorAll('[data-site-header] a[href="/status/"]')).find(${visible}).click()`);
    await waitFor(() => evaluate(`location.pathname === '/status/' && !document.querySelector('[data-site-menu]').open`), "Client navigation must close menu");
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(output, `status-${width}.png`), Buffer.from(screenshot.data, "base64"));
    console.log(`PASS public navigation at ${width}px (${routes.length} routes, direct loads and client navigation)`);
  }
  // Exercise the actual preview components and the pinned canonical WASM runtime.
  async function fill(selector, value) {
    await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }
  for (const width of [1366, 375, 320]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate("/audit/");
    await fill("#workflow-description", "");
    await waitFor(() => evaluate(`document.querySelector('[data-preview-status]')?.dataset.previewStatus === 'needs-details'`), "Empty workflow must not be analyzed as safe");
    assert.equal(await evaluate(`document.querySelector('[data-generated-script]')`), null);
    await fill("#workflow-description", "Automatically approve wire transfers.");
    await waitFor(() => evaluate(`document.querySelector('[data-planning-preview]').innerText.includes('Financial or payment action')`), "Financial review missing");
    assert.ok(await evaluate(`!document.querySelector('[data-planning-preview]').innerText.includes('Safe to automate')`));
    await fill("#workflow-description", "When a form submission arrives, create a task in Jira and draft an email reply using Outlook.");
    await waitFor(() => evaluate(`document.querySelector('[data-preview-field="Trigger"] dd')?.textContent === 'New form submission'`), "Form trigger must not become output email");
    assert.ok(await evaluate(`!document.querySelector('[data-planning-preview]').innerText.includes('Gmail')`));
    const generatedScript = await evaluate(`document.querySelector('[data-generated-script]').textContent`);
    const auditScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(output, `audit-${width}.png`), Buffer.from(auditScreenshot.data, "base64"));

    await navigate("/demo/support-triage/");
    await fill("#support-description", "How do I download the guide?");
    await waitFor(() => evaluate(`document.querySelector('[data-preview-field="Urgency signal"] dd')?.textContent === 'Not determined'`), "Download must not become urgent");
    await fill("#support-description", "I forgot my password and get an error signing in.");
    await waitFor(() => evaluate(`document.querySelector('[data-preview-field="Suggested category"] dd')?.textContent === 'Account or security'`), "Compound account-sensitive request lost its review boundary");
    const supportScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(output, `support-${width}.png`), Buffer.from(supportScreenshot.data, "base64"));
    await fill("#support-description", "  ");
    await waitFor(() => evaluate(`document.querySelector('[data-preview-status]')?.dataset.previewStatus === 'needs-details'`), "Empty support message must clear result");
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('[data-planning-preview] button')).filter(b => b.textContent.includes('Copy planning') || b.textContent.includes('Export plan')).every(b => b.disabled)`));

    await navigate("/run/");
    await fill("#solve-preview-source", generatedScript);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Run preview').click()`);
    await waitFor(() => evaluate(`document.querySelector('[aria-labelledby="output-heading"] pre')?.textContent !== 'Run the preview to see output here.'`), "Generated planning script did not produce a runtime result");
    const result = await evaluate(`document.querySelector('[aria-labelledby="output-heading"] pre').textContent`);
    assert.ok(!result.startsWith("Error:"), `Canonical runtime rejected generated planning script: ${result}`);
    assert.ok(result.includes("Review this proposed workflow before connecting production"), "Canonical runtime did not execute the actual generated script");
    console.log(`PASS preview input regressions and generated script in pinned canonical WASM at ${width}px`);
  }
  assert.deepEqual(exceptions, [], "No uncaught browser exceptions");
  console.log("PASS browser smoke; all external requests blocked; no production mutation");
  for (const entry of pending.values()) clearTimeout(entry.timer);
} finally {
  ws?.close(); browser.kill("SIGKILL"); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await sleep(200);
  rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
