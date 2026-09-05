export const WASM_LOAD_FAILURE = "Solve runtime unavailable. No script was executed. Native solvec remains canonical; managed execution is unavailable.";
const names = ["solvec_wasm.js", "solvec_wasm_bg.js", "solvec_wasm_bg.wasm"];
const maximumFileBytes = 600000;
const maximumBundleBytes = 620000;

const fail = () => { throw new Error(WASM_LOAD_FAILURE); };
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");

async function read(url, limit, signal) {
  const response = await fetch(url, { credentials: "omit", redirect: "error", cache: "no-store", signal });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) fail();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) fail();
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Pins must come from reviewed qualification evidence, never from user input or the fetched manifest. */
export async function loadAuditedWasm({ baseUrl, sourceCommit, manifestSha256 } = {}) {
  let objectUrl;
  try {
    if (typeof window === "undefined" || !globalThis.isSecureContext || !/^[a-f0-9]{40}$/.test(sourceCommit ?? "") || !/^[a-f0-9]{64}$/.test(manifestSha256 ?? "")) fail();
    const base = new URL(baseUrl, window.location.href);
    if (base.origin !== window.location.origin || base.username || base.password || base.search || base.hash || !base.pathname.endsWith("/")) fail();
    const signal = AbortSignal.timeout(10000);
    const bytes = await read(new URL("manifest.json", base), 16384, signal);
    if (await digest(bytes) !== manifestSha256) fail();
    const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (manifest.schema !== "solvelang.wasm-artifact-audit" || manifest.version !== 1 || manifest.sourceCommit !== sourceCommit || manifest.publishable !== false || manifest.browserPreviewReplaced !== false || !Array.isArray(manifest.files) || !equal(manifest.files.map(file => file.name), names)) fail();
    const files = new Map();
    let total = 0;
    for (const entry of manifest.files) {
      if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > maximumFileBytes || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail();
      total += entry.bytes;
      if (total > maximumBundleBytes) fail();
      const file = await read(new URL(entry.name, base), entry.bytes, signal);
      if (file.byteLength !== entry.bytes || await digest(file) !== entry.sha256) fail();
      files.set(entry.name, file);
    }
    if (total !== manifest.totalBytes) fail();
    const module = await WebAssembly.compile(files.get("solvec_wasm_bg.wasm"));
    if (!equal(WebAssembly.Module.imports(module), manifest.imports) || !equal(WebAssembly.Module.exports(module), manifest.exports)) fail();
    // Import only verified bytes. A CSP that forbids blob modules fails visibly, never to a native/server fallback.
    objectUrl = URL.createObjectURL(new Blob([files.get("solvec_wasm_bg.js")], { type: "text/javascript" }));
    const binding = await import(/* webpackIgnore: true */ objectUrl);
    const instance = await WebAssembly.instantiate(module, {
      "./solvec_wasm_bg.js": { __wbindgen_init_externref_table: binding.__wbindgen_init_externref_table },
    });
    binding.__wbg_set_wasm(instance.exports);
    instance.exports.__wbindgen_start();
    return Object.freeze({
      runPure(source, input = "") {
        if (typeof source !== "string" || typeof input !== "string") throw new TypeError("Solve source and input must be text.");
        // Preserve canonical oversized-input diagnostics without copying arbitrarily large strings into WASM.
        const bound = value => value.length > 1048576 ? "x".repeat(1048577) : value;
        return binding.run_pure_v1(bound(source), bound(input));
      },
    });
  } catch {
    fail();
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
