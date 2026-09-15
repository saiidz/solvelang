import assert from "node:assert/strict";
import test from "node:test";
import { buildContextPack, contextEntryHandle, contextTaskTokens, sha256Text, type ContextPack, type ContextSource } from "../src/context-pack.js";

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

test("graph declaration fallback retains its reason through remaining-budget fragmentation", () => {
  const sources: ContextSource[] = [
    { path: "a/changed.ts", text: "x".repeat(700),
      selection: { score: 128, reasons: ["explicit-changed-path"] } },
    { path: "b/dependency.ts", text: [
      "// header only",
      "export function validateInput() {",
      ...Array(40).fill('  const text = "' + "x".repeat(70) + '";'),
      "}",
    ].join("\n"), selection: { score: 64, reasons: ["graph:dependency"] } },
  ];
  const pack = buildContextPack("opaquequery", sources, 1_024);
  const dependency = pack.entries.filter((entry) => entry.path === "b/dependency.ts");
  assert.ok(dependency.length > 0);
  for (const entry of dependency) {
    assert.ok(dependency[0].startLine >= 2 && entry.endLine <= 25);
    assert.deepEqual(entry.reasons, ["graph:dependency", "selection:declaration-text-window"]);
    assert.equal(entry.score, 64);
  }
  assert.equal(pack.truncated, true);
  assertExactPack(pack, sources);
});

test("rescored fragments yield to a higher-ranked candidate from another source", () => {
  const sources: ContextSource[] = [
    { path: "first.ts", text: "x".repeat(700),
      selection: { score: 128, reasons: ["explicit-changed-path"] } },
    { path: "a/noise.ts", text: Array.from({ length: 6 }, () =>
      `alpha ${"x".repeat(110)}`).join("\n") },
    { path: "b/evidence.ts", text: "alpha alpha alpha alpha" },
  ];
  const pack = buildContextPack("alpha", sources, 1_024);
  assert.ok(pack.entries.some((entry) => entry.path === "b/evidence.ts"));
  assert.equal(pack.truncated, true);
  assertExactPack(pack, sources);
});

test("equal scores prefer distinct task evidence over repetition before stable path ties", () => {
  const sources = [
    { path: "a/repeated.ts", text: `alpha alpha alpha alpha ${"x".repeat(600)}` },
    { path: "b/diverse.ts", text: `alpha beta alpha beta ${"x".repeat(600)}` },
  ];
  const pack = buildContextPack("alpha beta", sources, 1_024);
  assert.deepEqual(pack.entries.map((entry) => entry.path), ["b/diverse.ts"]);
  assert.equal(pack.entries[0].score, 8);
  assert.equal(pack.omittedCandidates, 1);
  assertExactPack(pack, sources);
});

test("bounded lexical repetition cannot outrank one-hop graph evidence", () => {
  const sources: ContextSource[] = [
    {
      path: "a/noise.ts",
      text: `alpha `.repeat(120) + "noise",
    },
    {
      path: "z/dependency.ts",
      text: [
        "export function targetDependency() {",
        `  return "${"x".repeat(520)}";`,
        "}",
      ].join("\n"),
      selection: { score: 64, reasons: ["graph:dependency:imports:edge"] },
    },
  ];
  const pack = buildContextPack("alpha", sources, 1_024);
  assert.ok(pack.entries.some((entry) => entry.path === "z/dependency.ts"));
  assert.ok(pack.entries.find((entry) => entry.path === "z/dependency.ts")!.score >= 64);
  assertExactPack(pack, sources);
});

test("task inflection aliases expose a later graph-selected declaration", () => {
  const tokens = contextTaskTokens("Trace context provider subscriber rerenders");
  assert.ok(tokens.includes("rerenders"));
  assert.ok(tokens.includes("rerender"));

  const source: ContextSource = {
    path: "src/component.ts",
    selection: { score: 64, reasons: ["graph:dependency:imports:edge"] },
    text: [
      "export function BaseComponent() {",
      "  const context = 'provider subscriber';",
      "  return context;",
      "}",
      ...Array(20).fill("// spacing"),
      "/** Enqueue a rerender of a component. */",
      "export function enqueueRender(component) {",
      "  return component;",
      "}",
    ].join("\n"),
  };
  const pack = buildContextPack("Trace context provider subscriber rerenders", [source], 2_048);
  assert.ok(pack.entries.some((entry) => entry.content.includes("export function enqueueRender(component)")));
  assert.ok(pack.entries.some((entry) => entry.reasons.includes("selection:declaration-text-window")));
  assertExactPack(pack, [source]);
});
