import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRepositoryReferences } from "./references";

test("resolves common relative imports and reports missing snapshot paths", () => {
  const analysis = analyzeRepositoryReferences([
    { path: "src/main.ts", text: 'import { helper } from "./helper";\nimport { thing } from "./missing";\nconsole.log(helper, thing);' },
    { path: "src/helper.ts", text: "export const helper = 1;" },
  ]);

  assert.deepEqual(
    analysis.references.filter((reference) => reference.kind === "relative"),
    [
      { from: "src/main.ts", specifier: "./helper", kind: "relative", resolvedPath: "src/helper.ts" },
      { from: "src/main.ts", specifier: "./missing", kind: "relative" },
    ],
  );
  const missing = analysis.candidates.filter((candidate) => candidate.category === "missing-relative-import");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].confidence, "high");
  assert.deepEqual(missing[0].evidence, ["src/main.ts", "./missing"]);
});

test("resolves directory index imports without executing repository code", () => {
  const analysis = analyzeRepositoryReferences([
    { path: "src/app.ts", text: 'const feature = require("./feature");\nvoid feature;' },
    { path: "src/feature/index.js", text: "module.exports = 1;" },
  ]);
  assert.equal(analysis.references[0].resolvedPath, "src/feature/index.js");
  assert.equal(analysis.candidates.some((candidate) => candidate.category === "missing-relative-import"), false);
});

test("classifies package and builtin references and finds dependency candidates", () => {
  const analysis = analyzeRepositoryReferences([
    {
      path: "package.json",
      text: JSON.stringify({
        dependencies: { react: "19.2.4", lodash: "4.17.21" },
        devDependencies: { vitest: "4.0.0" },
      }),
    },
    {
      path: "src/page.tsx",
      text: 'import React from "react";\nimport thing from "left-pad";\nimport { readFile } from "node:fs";\nvoid React; void thing; void readFile;',
    },
  ]);

  assert.deepEqual(
    analysis.references.map(({ specifier, kind, packageName }) => ({ specifier, kind, packageName })),
    [
      { specifier: "left-pad", kind: "package", packageName: "left-pad" },
      { specifier: "node:fs", kind: "builtin", packageName: undefined },
      { specifier: "react", kind: "package", packageName: "react" },
    ],
  );
  assert.deepEqual(
    analysis.candidates.filter((candidate) => candidate.category === "unused-dependency").map((candidate) => candidate.evidence[1]),
    ["lodash", "vitest"],
  );
  assert.deepEqual(
    analysis.candidates.filter((candidate) => candidate.category === "undeclared-package").map((candidate) => candidate.evidence[0]),
    ["left-pad"],
  );
});

test("flags conflicting root lockfiles deterministically", () => {
  const files = [
    { path: "package.json", text: JSON.stringify({ dependencies: {} }) },
    { path: "yarn.lock" },
    { path: "package-lock.json" },
    { path: "pnpm-lock.yaml" },
  ];
  const first = analyzeRepositoryReferences(files);
  const second = analyzeRepositoryReferences([...files].reverse());
  assert.deepEqual(first, second);

  const conflict = first.candidates.find((candidate) => candidate.category === "lockfile-conflict");
  assert.ok(conflict);
  assert.equal(conflict.confidence, "high");
  assert.deepEqual(conflict.evidence, ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
});

test("rejects repository path traversal before analysis", () => {
  assert.throws(
    () => analyzeRepositoryReferences([{ path: "../outside.ts", text: "export const x = 1;" }]),
    /traverse/,
  );
});
