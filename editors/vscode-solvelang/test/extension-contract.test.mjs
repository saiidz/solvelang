import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

test("registers SolveLang files, comments, brackets, and a grammar", async () => {
  const [manifest, configuration, grammar] = await Promise.all([
    json("package.json"), json("language-configuration.json"), json("syntaxes/solvelang.tmLanguage.json"),
  ]);
  assert.deepEqual(manifest.contributes.languages[0].extensions, [".solve"]);
  assert.equal(manifest.contributes.languages[0].configuration, "./language-configuration.json");
  assert.equal(configuration.comments.lineComment, "//");
  assert.deepEqual(configuration.brackets, [["{", "}"], ["[", "]"], ["(", ")"]]);
  assert.equal(grammar.scopeName, "source.solvelang");
});

test("keeps local LSP and formatting inert until explicitly enabled", async () => {
  const manifest = await json("package.json");
  const settings = manifest.contributes.configuration.properties;
  assert.equal(settings["solvelang.languageServer.enabled"].default, false);
  assert.equal(settings["solvelang.languageServer.command"].default, "solvelsp");
  assert.equal(settings["solvelang.formatter.enabled"].default, false);
  assert.equal(settings["solvelang.formatter.command"].default, "solvec");
  assert.equal(settings["solvelang.formatter.args"], undefined);

  const extension = await readFile(path.join(root, "extension.js"), "utf8");
  assert.match(extension, /languageServer\.enabled/);
  assert.match(extension, /formatter\.enabled/);
  assert.match(extension, /LanguageClient/);
  assert.match(extension, /execFileAsync\(command, \["fmt", document\.uri\.fsPath\]/);
  assert.doesNotMatch(extension, /formatter\.args/);
  assert.doesNotMatch(extension, /solvec run/);
});
