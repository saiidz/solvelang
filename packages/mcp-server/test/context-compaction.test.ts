import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compactStructuredInput,
  compactStructuredText,
  expandLineRle,
  type LineRleRecord,
} from "../src/context-compaction.js";

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-compaction-"));
  const previous = process.env.SOLVELANG_WORKSPACE_ROOT;
  process.env.SOLVELANG_WORKSPACE_ROOT = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
    else process.env.SOLVELANG_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("JSON compaction removes only insignificant whitespace and preserves numeric lexemes", () => {
  const source = `{\n  "large": 9007199254740993123456789,\n  "ratio": 1.2300e+09,\n  "message": "spaces  inside\\tstrings stay",\n  "nested": [ true, null, { "value": -0.0001200 } ]\n}\n`;
  const result = compactStructuredText("json", source);
  assert.equal(result.codec, "json-whitespace-v0");
  assert.equal(result.fidelity, "json-token-exact");
  assert.equal(result.reversibleToOriginal, false);
  assert.equal(result.applied, true);
  assert.ok(result.reductionBytes > 0);
  assert.ok(result.payload && "content" in result.payload);
  const content = (result.payload as { content: string }).content;
  assert.equal(content, `{"large":9007199254740993123456789,"ratio":1.2300e+09,"message":"spaces  inside\\tstrings stay","nested":[true,null,{"value":-0.0001200}]}`);
  assert.match(content, /9007199254740993123456789/);
  assert.match(content, /1\.2300e\+09/);
  assert.match(content, /-0\.0001200/);
  assert.match(content, /spaces  inside\\tstrings stay/);
});

test("JSON compaction rejects malformed input rather than repairing or reserializing it", () => {
  assert.throws(
    () => compactStructuredText("json", `{ "large": 9007199254740993123456789, trailing: true }`),
    /JSON|Unexpected|property|position/i,
  );
});

test("line RLE compaction round-trips logs byte-for-byte across mixed line endings", () => {
  const source = `${"INFO queue unchanged\r\n".repeat(80)}ERROR payment failed code=E_TIMEOUT\n${"INFO queue unchanged\r\n".repeat(20)}tail-without-newline`;
  const compacted = compactStructuredText("log", source);
  assert.equal(compacted.codec, "line-rle-v0");
  assert.equal(compacted.fidelity, "byte-exact");
  assert.equal(compacted.reversibleToOriginal, true);
  assert.equal(compacted.applied, true);
  assert.ok(compacted.payload && "records" in compacted.payload);
  const records = (compacted.payload as { records: LineRleRecord[] }).records;
  assert.ok(records.some((record) => record.segment === "ERROR payment failed code=E_TIMEOUT\n" && record.count === 1));
  assert.ok(records.some((record) => record.segment === "INFO queue unchanged\r\n" && record.count === 80));

  const expanded = expandLineRle({
    kind: "log",
    sourceSha256: compacted.sourceSha256,
    sourceBytes: compacted.sourceBytes,
    candidateSha256: compacted.candidateSha256,
    candidateBytes: compacted.candidateBytes,
    records,
  });
  assert.equal(expanded.content, source);
  assert.equal(expanded.sourceSha256, compacted.sourceSha256);
  assert.equal(Buffer.byteLength(expanded.content, "utf8"), compacted.sourceBytes);
});

test("line RLE compaction refuses to claim savings when its payload would be larger", () => {
  const result = compactStructuredText("diff", "@@ -1,2 +1,2 @@\n-old\n+new\n");
  assert.equal(result.applied, false);
  assert.equal(result.reason, "no-byte-reduction");
  assert.equal(result.payload, undefined);
  assert.equal(result.reductionBytes, 0);
  assert.equal(result.reductionPercent, 0);
});

test("line RLE expansion fails closed on payload tampering", () => {
  const source = "same line\n".repeat(100);
  const compacted = compactStructuredText("log", source);
  assert.equal(compacted.applied, true);
  const records = structuredClone((compacted.payload as { records: LineRleRecord[] }).records);
  records[0]!.count -= 1;
  assert.throws(
    () => expandLineRle({
      kind: "log",
      sourceSha256: compacted.sourceSha256,
      sourceBytes: compacted.sourceBytes,
      candidateSha256: compacted.candidateSha256,
      candidateBytes: compacted.candidateBytes,
      records,
    }),
    /identity|byte count|hash|bound/,
  );
});

test("workspace compaction is local, path-bounded, and denies likely secret files", { concurrency: false }, async () => {
  await withWorkspace(async (root) => {
    await mkdir(path.join(root, "logs"), { recursive: true });
    await writeFile(path.join(root, "logs", "worker.log"), "polling queue\n".repeat(100), "utf8");
    await writeFile(path.join(root, ".env"), "TOKEN=do-not-read\n", "utf8");

    const result = await compactStructuredInput("log", { path: "logs/worker.log" });
    assert.deepEqual(result.source, { mode: "workspace", path: "logs/worker.log" });
    assert.equal(result.applied, true);
    assert.equal(result.fidelity, "byte-exact");

    await assert.rejects(
      () => compactStructuredInput("log", { path: ".env" }),
      /sensitive path/,
    );
    await assert.rejects(
      () => compactStructuredInput("log", { path: "../outside.log" }),
      /workspace-relative paths/,
    );
  });
});
