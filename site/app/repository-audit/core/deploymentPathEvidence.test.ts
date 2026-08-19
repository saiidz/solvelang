import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphDocument, createSolveGraphNode } from "../../solve-graph/core/canonical";
import type { SolveGraphNode } from "../../solve-graph/core/contracts";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import type { RepositorySnapshot } from "./inventory";
import { createRepositoryDeploymentPathEvidenceAnalysis } from "./deploymentPathEvidence";

async function fileNode(path: string): Promise<SolveGraphNode> {
  return createSolveGraphNode({
    kind: "file",
    identity: `file:${path}`,
    label: path.slice(path.lastIndexOf("/") + 1),
    evidence: [{ kind: "deterministic-analysis", path }],
    metadata: { path },
  });
}

function snapshot(files: Array<{ path: string; text?: string }>): RepositorySnapshot {
  return {
    source: {
      kind: "github",
      displayName: solveGraphFixtureSource.displayName,
      revision: solveGraphFixtureSource.revision,
      fingerprint: solveGraphFixtureSource.fingerprint,
    },
    files: files.map((file) => ({
      path: file.path,
      byteSize: file.text === undefined ? 0 : new TextEncoder().encode(file.text).byteLength,
      ...(file.text === undefined ? {} : { text: file.text }),
    })),
  };
}

async function graph(paths: string[], partial = false) {
  return createSolveGraphDocument({
    source: solveGraphFixtureSource,
    extractors: [{ id: "inventory", version: "1.0.0", deterministic: true }],
    ...(partial ? { status: "partial" as const, truncationReasons: ["file-count" as const] } : {}),
    nodes: await Promise.all(paths.map(fileNode)),
    edges: [],
  });
}

test("maps explicit Docker and SAM repository-local deployment paths without executing configuration", async () => {
  const input = snapshot([
    {
      path: "Dockerfile",
      text: [
        "FROM node:24",
        "COPY package.json /app/package.json",
        "COPY src/ /app/src/",
        "COPY missing.txt /app/missing.txt",
        "COPY --from=builder /out/app /app",
        "ADD https://example.com/archive.tar.gz /tmp/archive.tar.gz",
      ].join("\n"),
    },
    {
      path: "template.yaml",
      text: [
        "Resources:",
        "  Worker:",
        "    Type: AWS::Serverless::Function",
        "    Properties:",
        "      CodeUri: services/worker/",
        "  Site:",
        "    Type: AWS::Serverless::LayerVersion",
        "    Properties:",
        "      ContentUri: layers/shared/",
      ].join("\n"),
    },
    { path: "package.json", text: "{}" },
    { path: "src/index.ts", text: "export {};" },
    { path: "services/worker/index.js", text: "export {};" },
    { path: "layers/shared/readme.txt", text: "shared" },
  ]);
  const analysis = await createRepositoryDeploymentPathEvidenceAnalysis(
    input,
    await graph(["Dockerfile", "template.yaml", "package.json", "src/index.ts", "services/worker/index.js"]),
  );

  assert.deepEqual(
    analysis.relationships.map((relationship) => [relationship.kind, relationship.targetPath, relationship.targetType, relationship.targetState]),
    [
      ["docker-copy-source", "missing.txt", "file", "missing"],
      ["docker-copy-source", "package.json", "file", "present"],
      ["docker-copy-source", "src", "directory", "present"],
      ["sam-code-uri", "services/worker", "directory", "present"],
      ["sam-content-uri", "layers/shared", "directory", "outside-bounded-scan"],
    ],
  );
  assert.equal(analysis.skipped.dynamicReference, 2);
  assert.equal(analysis.status, "partial");
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);
});

test("maps explicit Cloudflare, Vercel, and Netlify paths with bounded file/directory truth", async () => {
  const input = snapshot([
    {
      path: "wrangler.toml",
      text: [
        'name = "edge-app"',
        'main = "src/worker.ts"',
        "[assets]",
        'directory = "public"',
      ].join("\n"),
    },
    { path: "vercel.json", text: JSON.stringify({ outputDirectory: "dist" }) },
    {
      path: "netlify.toml",
      text: [
        "[build]",
        'publish = "site"',
        "[functions]",
        'directory = "functions"',
      ].join("\n"),
    },
    { path: "src/worker.ts", text: "export default {};" },
    { path: "public/index.html", text: "<main></main>" },
    { path: "dist/index.html", text: "<main></main>" },
    { path: "site/index.html", text: "<main></main>" },
    { path: "functions/hello.js", text: "export {};" },
  ]);
  const analysis = await createRepositoryDeploymentPathEvidenceAnalysis(
    input,
    await graph(["wrangler.toml", "vercel.json", "netlify.toml", "src/worker.ts", "public/index.html", "dist/index.html", "functions/hello.js"]),
  );

  assert.deepEqual(
    analysis.relationships.map((relationship) => [relationship.kind, relationship.targetPath, relationship.targetState]),
    [
      ["cloudflare-assets-directory", "public", "present"],
      ["cloudflare-main", "src/worker.ts", "present"],
      ["netlify-functions-directory", "functions", "present"],
      ["netlify-publish-directory", "site", "outside-bounded-scan"],
      ["vercel-output-directory", "dist", "present"],
    ],
  );
  assert.equal(analysis.status, "complete");
  assert.equal(analysis.execution.deploymentFilesExamined, 3);
});

test("keeps deterministic bounds and fails closed on source or graph-integrity mismatch", async () => {
  const input = snapshot([
    { path: "Dockerfile", text: "COPY one.txt /one\nCOPY two.txt /two\n" },
    { path: "one.txt", text: "1" },
    { path: "two.txt", text: "2" },
  ]);
  const document = await graph(["Dockerfile", "one.txt", "two.txt"]);
  const bounded = await createRepositoryDeploymentPathEvidenceAnalysis(input, document, { maxRelationships: 1 });
  assert.equal(bounded.relationships.length, 1);
  assert.equal(bounded.execution.relationshipsTruncated, true);
  assert.equal(bounded.status, "partial");

  const partial = await createRepositoryDeploymentPathEvidenceAnalysis(input, await graph(["Dockerfile"], true));
  assert.equal(partial.execution.graphTruncated, true);
  assert.equal(partial.status, "partial");

  const mismatched = structuredClone(input);
  mismatched.source.revision = "different";
  await assert.rejects(createRepositoryDeploymentPathEvidenceAnalysis(mismatched, document), /source does not match/);

  const tampered = structuredClone(document);
  tampered.nodes[0].label = "tampered";
  await assert.rejects(createRepositoryDeploymentPathEvidenceAnalysis(input, tampered), /integrity-valid/);
});
