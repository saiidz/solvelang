import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(packageRoot, relativePath), "utf8")) as Record<string, any>;
}

test("server.json stays in lockstep with package.json for the MCP Registry", () => {
  const pkg = readJson("package.json");
  const server = readJson("server.json");

  // The registry name is the identity every surface must agree on.
  assert.equal(server.name, "io.github.saiidz/solvelang");
  assert.match(String(server.name), /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.equal(pkg.mcpName, server.name, "package.json mcpName must match the registry server name");
  assert.equal(server.version, pkg.version, "registry version tracks the package version");
  assert.equal(server.title, "SolveLang");

  // The registry rejects descriptions over 100 characters.
  assert.equal(typeof server.description, "string");
  assert.ok(server.description.length >= 1 && server.description.length <= 100);

  assert.equal(server.repository.url, "https://github.com/saiidz/solvelang");
  assert.equal(server.repository.source, "github");
  assert.equal(server.repository.subfolder, "packages/mcp-server");

  // npm stdio package entry.
  const packages = server.packages as Array<Record<string, any>>;
  assert.equal(packages.length, 1);
  assert.equal(packages[0].registryType, "npm");
  assert.equal(packages[0].registryBaseUrl, "https://registry.npmjs.org");
  assert.equal(packages[0].identifier, pkg.name);
  assert.equal(packages[0].version, pkg.version);
  assert.equal(packages[0].transport.type, "stdio");

  // Remote entry: the bearer is a secret variable, never a literal value.
  const remotes = server.remotes as Array<Record<string, any>>;
  assert.equal(remotes.length, 1);
  assert.equal(remotes[0].type, "streamable-http");
  assert.equal(remotes[0].url, "https://mcp.solve-lang.com/mcp");
  const headers = remotes[0].headers as Array<Record<string, any>>;
  const auth = headers.find((header) => header.name === "Authorization");
  assert.ok(auth, "the remote entry must declare the Authorization header");
  assert.equal(auth.isRequired, true);
  assert.equal(auth.isSecret, true);
  assert.equal(auth.value, "Bearer {access_token}");
  assert.equal(auth.variables.access_token.isSecret, true);
  assert.equal(auth.variables.access_token.isRequired, true);
});
