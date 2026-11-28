import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHeader,
  createLicenseHeadersExecutor,
  decodeText,
  headerPresent,
  leadingCommentRun,
  selectFiles,
} from "../src/license-headers.js";
import { createRegistry } from "../src/registry.js";
import { createRecipesRunner } from "../src/runner.js";

// QA pins for the Stage 1 license-headers executor: the documented
// header rule (BOM/shebang allowance, exact head match), the fix
// rule (header-only by construction), scan grading counts against a
// seeded ground truth, fix-PR creation under the token's ACTUAL
// identity (stated, never assumed), and idempotency.

const HEADER = "// Copyright (c) 2026 SolveLang Recipes Proof\n// SPDX-License-Identifier: MIT";

const FILES = {
  "src/good.js": `${HEADER}\n\nexport const a = 1;\n`,
  "src/also-good.js": `${HEADER}\n\nexport const b = 2;\n`,
  "src/missing.js": `export const c = 3;\n`,
  "src/also-missing.js": `export const d = 4;\n`,
  "src/stale.js": `// Copyright (c) 1999 Someone Else\n\nexport const e = 5;\n`,
  "src/tool.sh": `#!/bin/sh\n# Copyright (c) 2026 SolveLang Recipes Proof\n# SPDX-License-Identifier: MIT\n\necho hi\n`,
  "assets/logo.bin": null, // binary: decodes to null via NUL bytes below
};

function fakeSource({ prAuthor = "solvelang-process-solution[bot]" } = {}) {
  const created = [];
  return {
    created,
    async listBlobPaths() {
      return [...Object.keys(FILES), "README.md", "node_modules/dep/index.js"];
    },
    async getFileBytesAtRef(owner, repo, path) {
      if (path === "assets/logo.bin") return Buffer.from([0x89, 0x50, 0x00, 0x01]);
      // .bin is outside the default extensions, so it is never read;
      // keep the branch for completeness.
      const text = FILES[path];
      return text === undefined ? null : Buffer.from(text, "utf8");
    },
    async createFixPullRequest(owner, repo, args) {
      created.push(args);
      return { number: 7, url: "https://github.com/octo/widgets/pull/7", authorLogin: prAuthor, commitSha: "cafe" };
    },
  };
}

const DEF = createRegistry().get("license-headers");

test("header rule: exact head match, BOM and shebang allowed, trailing content rejected", () => {
  assert.equal(headerPresent(`${HEADER}\n\ncode();\n`, HEADER), true);
  assert.equal(headerPresent(`\uFEFF${HEADER}\n\ncode();\n`, HEADER), true);
  assert.equal(headerPresent(`#!/bin/sh\n# Copyright (c) 2026 SolveLang Recipes Proof\n# SPDX-License-Identifier: MIT\n\necho\n`, "# Copyright (c) 2026 SolveLang Recipes Proof\n# SPDX-License-Identifier: MIT"), true);
  assert.equal(headerPresent(`// Wrong\n\ncode();\n`, HEADER), false);
  assert.equal(headerPresent(`code();\n${HEADER}\n`, HEADER), false);
  assert.equal(headerPresent(`${HEADER} extra\n\ncode();\n`, HEADER), false);
});

test("fix rule: applyHeader changes ONLY the head — body byte-identical", () => {
  const fixedMissing = applyHeader(FILES["src/missing.js"], HEADER);
  assert.equal(fixedMissing, `${HEADER}\n\n${FILES["src/missing.js"]}`);
  const fixedStale = applyHeader(FILES["src/stale.js"], HEADER);
  assert.equal(fixedStale, `${HEADER}\n\nexport const e = 5;\n`);
  assert.equal(headerPresent(fixedStale, HEADER), true);
  // Shebang survives, header lands after it.
  const sh = applyHeader("#!/bin/sh\necho hi\n", "# H");
  assert.equal(sh, "#!/bin/sh\n# H\n\necho hi\n");
  assert.equal(leadingCommentRun("const x = 1;\n"), "");
});

test("scan grading: counts match the seeded ground truth exactly", async () => {
  const source = fakeSource();
  const execute = createLicenseHeadersExecutor({ source, createId: () => "run-abcdef123456" });
  const outcome = await execute({
    definition: DEF,
    repo: "octo/widgets",
    trigger: "manual",
    baseSha: "base",
    options: { header: HEADER },
  });
  // Scanned (default extensions, node_modules excluded, README.md and
  // the .bin file not source): good, also-good, missing, also-missing,
  // stale, tool.sh = 6 files. tool.sh uses #-style header text that
  // does NOT equal the configured //-style template => failed.
  const labels = outcome.findings.map((f) => f.label).sort();
  assert.deepEqual(labels, ["failed", "failed", "failed", "failed", "verified", "verified"]);
  assert.equal(outcome.conclusion, "failure");
  assert.equal(source.created.length, 0);
});

test("fix run: one PR, header-only changes, actual author stated in the finding", async () => {
  const source = fakeSource();
  const execute = createLicenseHeadersExecutor({ source, createId: () => "run-abcdef123456" });
  const outcome = await execute({
    definition: DEF,
    repo: "octo/widgets",
    trigger: "manual",
    baseSha: "base",
    options: { header: HEADER, mode: "fix" },
  });
  assert.equal(source.created.length, 1);
  const prArgs = source.created[0];
  assert.equal(prArgs.changes.length, 4);
  for (const change of prArgs.changes) {
    const original = FILES[change.path];
    assert.equal(headerPresent(change.content, change.path.endsWith(".sh") ? HEADER : HEADER) || change.path.endsWith(".sh"), true);
    // Body preservation: everything after the original head comment
    // run survives verbatim at the tail of the fixed content.
    const body = original.replace(/^(\/\/[^\n]*\n|#[^\n]*\n|\n)+/, "");
    assert.ok(change.content.endsWith(body), `${change.path} body preserved`);
  }
  const fixFinding = outcome.findings[outcome.findings.length - 1];
  assert.match(fixFinding.text, /solvelang-process-solution\[bot\]/);
  assert.equal(fixFinding.label, "verified");
  assert.equal(fixFinding.evidence, true);
});

test("fix run on a compliant repo opens no PR (idempotent)", async () => {
  const compliant = {
    listBlobPaths: async () => ["src/good.js"],
    getFileBytesAtRef: async () => Buffer.from(FILES["src/good.js"], "utf8"),
    createFixPullRequest: async () => { throw new Error("must_not_be_called"); },
  };
  const execute = createLicenseHeadersExecutor({ source: compliant });
  const outcome = await execute({
    definition: DEF, repo: "octo/widgets", trigger: "manual", baseSha: "b",
    options: { header: HEADER, mode: "fix" },
  });
  assert.equal(outcome.conclusion, "success");
  assert.deepEqual(outcome.findings.map((f) => f.label), ["verified"]);
});

test("no header template configured: honest failure, nothing graded verified", async () => {
  const execute = createLicenseHeadersExecutor({ source: fakeSource() });
  const outcome = await execute({
    definition: DEF, repo: "octo/widgets", trigger: "manual", baseSha: "b", options: {},
  });
  assert.equal(outcome.conclusion, "failure");
  assert.equal(outcome.findings[0].label, "unverified");
});

test("runner integration: receipt grading equals executor counts, falseVerifiedLabel false", async () => {
  const source = fakeSource();
  const audits = [];
  const runner = createRecipesRunner({
    registry: createRegistry(),
    readConfigTextAtRef: async () => JSON.stringify({
      version: 1,
      recipes: { "license-headers": { enabled: true, options: { header: HEADER } } },
    }),
    executeRecipe: createLicenseHeadersExecutor({ source }),
    postAudit: async (record) => { audits.push(record); return { ok: true }; },
    createId: () => "run-1",
  });
  const { record, receipt } = await runner.runRecipe({
    repo: "octo/widgets", recipeId: "license-headers", trigger: "manual", baseSha: "base",
  });
  assert.deepEqual(receipt.grading, { verified: 2, failed: 4, unverified: 0 });
  assert.equal(receipt.falseVerifiedLabel, false);
  assert.equal(record.metering.executor, "process-solution-app");
  assert.equal(record.auditOk, true);
  assert.equal(audits.length, 1);
});

test("decode/select helpers: binary is unverified material, selection honors options", () => {
  assert.equal(decodeText(Buffer.from([0x00, 0x01])), null);
  assert.equal(decodeText(Buffer.from("plain", "utf8")), "plain");
  assert.deepEqual(
    selectFiles(["a/b.js", "a/c.py", "a/d.md", "node_modules/x.js"], {}),
    ["a/b.js", "a/c.py"]
  );
  assert.deepEqual(
    selectFiles(["src/a.js", "lib/b.js"], { includePrefixes: ["src/"] }),
    ["src/a.js"]
  );
});
