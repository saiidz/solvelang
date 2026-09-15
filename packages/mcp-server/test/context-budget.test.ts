import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildContextPack,
  contextEntryHandle,
  sha256Text,
  type ContextPack,
  type ContextSource,
} from "../src/context-pack.js";

function assertExactPack(pack: ContextPack, sources: ContextSource[]): void {
  const byPath = new Map(sources.map((source) => [source.path, source.text]));
  let bytes = 0;
  const lastLine = new Map<string, number>();
  for (const entry of pack.entries) {
    const source = byPath.get(entry.path);
    assert.notEqual(source, undefined);
    const lines = source!.replace(/\r\n/g, "\n").split("\n");
    assert.equal(entry.content, lines.slice(entry.startLine - 1, entry.endLine).join("\n"));
    assert.equal(entry.sourceSha256, sha256Text(source!));
    assert.equal(entry.excerptSha256, sha256Text(entry.content));
    assert.equal(entry.bytes, Buffer.byteLength(entry.content, "utf8"));
    assert.equal(entry.handle, contextEntryHandle(entry.path, entry.sourceSha256,
      entry.startLine, entry.endLine, entry.excerptSha256));
    assert.ok(entry.startLine > (lastLine.get(entry.path) ?? 0), "selected line ranges must not overlap");
    lastLine.set(entry.path, entry.endLine);
    bytes += entry.bytes;
  }
  assert.equal(pack.selectedBytes, bytes);
  assert.ok(bytes <= pack.budgetBytes);
}

test("dense matches retain useful exact lines instead of returning an empty pack", () => {
  const sources = [{ path: "src/targets.ts", text: Array.from({ length: 60 }, (_, index) =>
    `function target${index}() { return "target"; }`).join("\n") }];
  const pack = buildContextPack("target", sources, 1_024);
  assert.ok(pack.entries.length > 0);
  assert.ok(pack.selectedBytes > 0);
  assert.equal(pack.truncated, true);
  assert.ok(pack.omittedCandidates > 0);
  assertExactPack(pack, sources);
});

test("a line larger than the budget does not suppress its smaller matching neighbors", () => {
  const sources = [{ path: "src/worker.ts", text: [
    'const targetBefore = "small";',
    `const oversized = "${"x".repeat(2_000)}";`,
    'const targetAfter = "small";',
  ].join("\n") }];
  const pack = buildContextPack("target", sources, 1_024);
  assert.deepEqual(pack.entries.map((entry) => [entry.startLine, entry.endLine]), [[1, 1], [3, 3]]);
  assert.equal(pack.omittedCandidates, 1);
  assert.equal(pack.truncated, true);
  assertExactPack(pack, sources);
});

test("oversized single lines remain omitted, never byte-clipped or summarized", () => {
  const text = `target ${"🌍".repeat(400)}`;
  const pack = buildContextPack("target", [{ path: "src/long.ts", text }], 1_024);
  assert.deepEqual(pack.entries, []);
  assert.equal(pack.selectedBytes, 0);
  assert.equal(pack.omittedCandidates, 1);
  assert.equal(pack.truncated, true);
});

test("partitioning counts UTF-8 bytes and CRLF-normalized line separators exactly", () => {
  const sources = [{ path: "src/unicode.ts", text: Array.from({ length: 90 }, (_, index) =>
    `const target${index} = "🌍 café 日本語";`).join("\r\n") }];
  const pack = buildContextPack("target", sources, 1_024);
  assert.ok(pack.entries.length > 0);
  assert.equal(pack.truncated, true);
  assertExactPack(pack, sources);
  assert.ok(pack.entries.every((entry) => !entry.content.includes("\ufffd")));
});

test("exact-budget lines fit without a phantom separator and count the omitted later line", () => {
  const first = `target${"x".repeat(1_024 - 6)}`;
  const sources = [{ path: "src/exact.ts", text: `${first}\ntarget` }];
  const pack = buildContextPack("target", sources, 1_024);
  assert.equal(pack.entries.length, 1);
  assert.equal(pack.entries[0].content, first);
  assert.equal(pack.selectedBytes, 1_024);
  assert.equal(pack.omittedCandidates, 1);
  assertExactPack(pack, sources);
});

test("partition ranking and reasons use only the exact returned excerpt", () => {
  const sources = [{ path: "src/example.ts", text: [
    `low ${"x".repeat(980)}`,
    `high ${"high ".repeat(60)}`,
  ].join("\n") }];
  const pack = buildContextPack("low high", sources, 1_024);
  assert.equal(pack.entries.length, 1);
  assert.equal(pack.entries[0].startLine, 2);
  assert.deepEqual(pack.entries[0].reasons, ["high"]);
  assert.equal(pack.entries[0].score, 122);
  assertExactPack(pack, sources);
});

test("partitioning preserves changed-source evidence and input-order determinism", () => {
  const sources: ContextSource[] = [
    { path: "z/changed.ts", text: Array(9).fill("x".repeat(200)).join("\n"),
      selection: { score: 128, reasons: ["explicit-changed-path"] } },
    { path: "a/other.ts", text: "target" },
  ];
  const first = buildContextPack("target", sources, 1_024);
  const second = buildContextPack("target", [...sources].reverse(), 1_024);
  assert.deepEqual(first, second);
  assert.ok(first.entries.some((entry) => entry.path === "z/changed.ts"));
  for (const entry of first.entries.filter((entry) => entry.path === "z/changed.ts")) {
    assert.deepEqual(entry.reasons, ["explicit-changed-path"]);
    assert.equal(entry.score, 128);
  }
  assertExactPack(first, sources);
});

// Exact upstream source, not generated filler or an agent-success benchmark.
// Repository: saiidz/solvelang; commit: c36f2b18e3393b8174943e01b79d56c65ce83c58
// Path: packages/mcp-server/src/context-pack.ts
// Git blob: d9dda78dd2d39873bacf3af233eb49660bb9b02b
// Keep this snapshot immutable so the regression cannot drift with the implementation.
test("pinned repository source retains the budget-admission guard under a small budget", async () => {
  const raw = await readFile(new URL("../../benchmarks/source-snapshots/context-pack-c36f2b18.txt", import.meta.url));
  assert.equal(raw.length, 10_206);
  assert.equal(createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex"),
    "d9dda78dd2d39873bacf3af233eb49660bb9b02b");
  assert.equal(createHash("sha256").update(raw).digest("hex"),
    "1d75d64a3c444c0cebcdeef1963cdd6d23c308427ee6197832a8ea5fe3343938");
  const sources = [{ path: "packages/mcp-server/src/context-pack.ts", text: raw.toString("utf8") }];
  const pack = buildContextPack("Fix omittedCandidates selectedBytes budgetBytes", sources, 1_024);
  assert.ok(pack.entries.some((entry) => entry.content.includes("selectedBytes + candidate.bytes > budgetBytes")));
  assert.equal(pack.truncated, true);
  assertExactPack(pack, sources);
});

test("a lower-ranked window can use the budget remaining after a selected source", () => {
  const sources: ContextSource[] = [
    { path: "a/changed.ts", text: "x".repeat(700),
      selection: { score: 128, reasons: ["explicit-changed-path"] } },
    { path: "b/target.ts", text: Array(20).fill("const target = true;").join("\n") },
  ];
  const pack = buildContextPack("target", sources, 1_024);
  assert.deepEqual([...new Set(pack.entries.map((entry) => entry.path))], ["a/changed.ts", "b/target.ts"]);
  assert.equal(pack.truncated, true);
  assertExactPack(pack, sources);
});

test("mixed empty, multibyte and oversized lines preserve budget and provenance across bounded cases", () => {
  for (let sample = 0; sample < 40; sample += 1) {
    const sources = [{ path: `src/target-${sample}.ts`, text: Array.from({ length: 70 }, (_, line) => {
      if (line % 13 === 0) return `target ${"🌍".repeat(300)}`;
      if (line % 7 === 0) return "";
      return `target ${line} ${"é".repeat((line * 17 + sample * 29) % 100)}`;
    }).join(sample % 2 === 0 ? "\r\n" : "\n") }];
    const pack = buildContextPack("target", sources, 1_024 + sample * 17);
    assert.ok(pack.entries.length > 0);
    assert.equal(pack.truncated, true);
    assertExactPack(pack, sources);
    assert.deepEqual(pack, buildContextPack("target", sources, pack.budgetBytes));
  }
});
