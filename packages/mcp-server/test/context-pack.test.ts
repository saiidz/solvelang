import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildContextPack, CONTEXT_PACK_SCHEMA } from "../src/context-pack.js";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const api = `export async function createInvoice() {\n  const invoice = await loadInvoice();\n  return persistInvoice(invoice);\n}\n\nexport async function cancelInvoice() {\n  return archiveInvoice();\n}`;
const testFile = `import { createInvoice } from \"../src/invoice.js\";\n\ntest(\"create invoice\", async () => {\n  await createInvoice();\n});`;

test("builds a deterministic pack independent of source order", () => {
  const task = "Fix createInvoice and its invoice test";
  const first = buildContextPack(task, [
    { path: "src/invoice.ts", text: api },
    { path: "test/invoice.test.ts", text: testFile },
  ], 16_384);
  const second = buildContextPack(task, [
    { path: "test/invoice.test.ts", text: testFile },
    { path: "src/invoice.ts", text: api },
  ], 16_384);

  assert.deepEqual(first, second);
  assert.equal(first.schema, CONTEXT_PACK_SCHEMA);
  assert.match(first.packId, /^scp_[a-f0-9]{32}$/);
  assert.ok(first.entries.length >= 2);
});

test("keeps exact source provenance and content hashes", () => {
  const pack = buildContextPack("createInvoice", [{ path: "src/invoice.ts", text: api }], 8_192);
  assert.equal(pack.entries.length, 1);
  const [entry] = pack.entries;
  assert.equal(entry.path, "src/invoice.ts");
  assert.equal(entry.sourceSha256, hash(api));
  assert.equal(entry.excerptSha256, hash(entry.content));
  assert.equal(entry.content, api.split("\n").slice(entry.startLine - 1, entry.endLine).join("\n"));
  assert.equal(entry.bytes, Buffer.byteLength(entry.content, "utf8"));
});

test("honors the byte budget and reports omitted candidates", () => {
  const repeated = Array.from({ length: 60 }, (_, index) => `function target${index}() { return \"target\"; }`).join("\n");
  const pack = buildContextPack("target", [{ path: "src/targets.ts", text: repeated }], 1_024);
  assert.ok(pack.selectedBytes <= 1_024);
  assert.equal(pack.truncated, true);
  assert.ok(pack.omittedCandidates > 0);
});

test("omits irrelevant sources instead of inventing summaries", () => {
  const pack = buildContextPack("payment retry", [{ path: "src/cats.ts", text: "export const cats = 2;" }], 4_096);
  assert.deepEqual(pack.entries, []);
  assert.equal(pack.selectedBytes, 0);
  assert.equal(pack.truncated, false);
});

test("changes source identity when source content changes", () => {
  const original = buildContextPack("createInvoice", [{ path: "src/invoice.ts", text: api }], 8_192);
  const changed = buildContextPack("createInvoice", [{ path: "src/invoice.ts", text: `${api}\n// changed` }], 8_192);
  assert.notEqual(original.packId, changed.packId);
  assert.notEqual(original.entries[0]?.sourceSha256, changed.entries[0]?.sourceSha256);
});

test("rejects unsafe workspace-relative paths", () => {
  for (const unsafePath of ["../secrets.txt", "src/../secrets.txt", "C:\\secrets.txt", "src//invoice.ts"]) {
    assert.throws(
      () => buildContextPack("invoice", [{ path: unsafePath, text: "invoice" }], 4_096),
      /workspace-relative paths/,
    );
  }
});
