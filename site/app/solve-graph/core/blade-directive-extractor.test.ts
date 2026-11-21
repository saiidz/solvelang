import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "../../repository-audit/core/inventory";
import { serializeSolveGraphDocument } from "./canonical";
import type { SolveGraphEdge, SolveGraphNode } from "./contracts";
import { extractRepositoryMultiLanguageDependencyGraph } from "./dependency-extractor";
import { scanBladeViewReferences } from "./blade-directive-extractor";
import { analyzeSolveGraphImpact, createSolveGraphQueryIndex } from "./query-impact";

function snapshot(files: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "blade-fixture",
      revision: "fixture-v1",
      fingerprint: `sha256:${"e".repeat(64)}`,
    },
    files,
  };
}

function file(path: string, text: string): RepositorySnapshot["files"][number] {
  return { path, text, byteSize: new TextEncoder().encode(text).byteLength };
}

type Graph = Awaited<ReturnType<typeof extractRepositoryMultiLanguageDependencyGraph>>;

function nodeByPath(graph: Graph, path: string): SolveGraphNode | undefined {
  return graph.nodes.find((node) => node.kind === "file" && node.metadata?.path === path);
}

function bladeEdgesFrom(graph: Graph, fromId: string): SolveGraphEdge[] {
  return graph.edges.filter(
    (edge) => edge.kind === "imports" && edge.from === fromId && edge.qualifier?.startsWith("blade:"),
  );
}

const PARTIAL = "resources/views/partials/site-header.blade.php";
const LAYOUT = "resources/views/layouts/app.blade.php";
const COMPONENT = "resources/views/components/alert.blade.php";

const INCLUDERS = [
  "resources/views/pages/home.blade.php",
  "resources/views/pages/about.blade.php",
  "resources/views/pages/pricing.blade.php",
  "resources/views/pages/contact.blade.php",
  "resources/views/pages/profile.blade.php",
  "resources/views/pages/settings.blade.php",
  "resources/views/blog/index.blade.php",
  "resources/views/blog/show.blade.php",
  "resources/views/dashboard.blade.php",
] as const;

function laravelFixture(): RepositorySnapshot["files"] {
  return [
    file(LAYOUT, [
      "<!DOCTYPE html>",
      "<html><body>",
      "@yield('content')",
      "</body></html>",
      "",
    ].join("\n")),
    file(PARTIAL, "<header class=\"site-header\">Site header</header>\n"),
    file(COMPONENT, "<div class=\"alert\">{{ $slot }}</div>\n"),
    file("resources/views/pages/home.blade.php", [
      "@extends('layouts.app')",
      "@section('content')",
      "@include('partials.site-header')",
      "<h1>Home</h1>",
      "@endsection",
      "",
    ].join("\n")),
    file("resources/views/pages/about.blade.php", "@include('partials.site-header')\n<h1>About</h1>\n"),
    file("resources/views/pages/pricing.blade.php", "@includeIf('partials.site-header')\n<h1>Pricing</h1>\n"),
    file("resources/views/pages/contact.blade.php", "@includeWhen($showHeader, 'partials.site-header')\n<h1>Contact</h1>\n"),
    file("resources/views/pages/profile.blade.php", "@includeUnless($hideHeader, 'partials.site-header')\n<h1>Profile</h1>\n"),
    file("resources/views/pages/settings.blade.php", "@includeFirst(['partials.missing-header', 'partials.site-header'])\n<h1>Settings</h1>\n"),
    file("resources/views/blog/index.blade.php", [
      "@include('partials.site-header')",
      "@component('components.alert')",
      "Heads up",
      "@endcomponent",
      "",
    ].join("\n")),
    file("resources/views/blog/show.blade.php", "@include('partials.site-header')\n<x-alert />\n"),
    file("resources/views/dashboard.blade.php", [
      "@include('partials.site-header')",
      "@include('partials.does-not-exist')",
      "<h1>Dashboard</h1>",
      "",
    ].join("\n")),
    file("resources/views/pages/plain.blade.php", [
      "{{-- @include('partials.site-header') --}}",
      "@@include('partials.site-header')",
      "<p>Nothing to include.</p>",
      "",
    ].join("\n")),
    file("app/mail.php", "<?php return ['from' => 'noreply@example.com'];\n"),
    file("app/helpers.php", "<?php\nrequire './mail.php';\n"),
    file("web/util.ts", "export function util(): number { return 1; }\n"),
    file("web/app.ts", "import { util } from \"./util\";\nutil();\n"),
  ];
}

test("Blade scan reads composition directives and skips comments, escapes, and mechanics", () => {
  const source = [
    "@extends('layouts.app')",
    "@section('content')",
    "@include('partials.site-header')",
    "@includeIf('partials.maybe')",
    "@includeWhen($flag, 'partials.when')",
    "@includeUnless($flag, 'partials.unless')",
    "@includeFirst(['partials.first-a', 'partials.first-b'])",
    "@component('components.alert')",
    "<x-user-card />",
    "{{-- @include('partials.commented') --}}",
    "@@include('partials.escaped')",
    "@yield('sidebar')",
    "@parent",
  ].join("\n");

  const references = scanBladeViewReferences(source);
  assert.deepEqual(
    references.map((reference) => [reference.form, reference.names.join("|")]),
    [
      ["extends", "layouts.app"],
      ["include", "partials.site-header"],
      ["includeIf", "partials.maybe"],
      ["includeWhen", "partials.when"],
      ["includeUnless", "partials.unless"],
      ["includeFirst", "partials.first-a|partials.first-b"],
      ["component", "components.alert"],
      ["component-tag", "components.user-card|components.UserCard"],
    ],
  );
});

test("Blade directives become imports edges from every includer to the partial", async () => {
  const graph = await extractRepositoryMultiLanguageDependencyGraph(snapshot(laravelFixture()));
  assert.ok(graph.extractors.some((extractor) => extractor.id === "blade-view-directives"));

  const partial = nodeByPath(graph, PARTIAL);
  assert.ok(partial);

  for (const includerPath of INCLUDERS) {
    const includer = nodeByPath(graph, includerPath);
    assert.ok(includer, includerPath);
    const edges: SolveGraphEdge[] = bladeEdgesFrom(graph, includer.id).filter((edge) => edge.to === partial.id);
    assert.equal(edges.length, 1, `${includerPath} should carry exactly one blade edge to the partial`);
  }

  const home = nodeByPath(graph, "resources/views/pages/home.blade.php")!;
  const layout = nodeByPath(graph, LAYOUT)!;
  assert.ok(bladeEdgesFrom(graph, home.id).some(
    (edge) => edge.to === layout.id && edge.qualifier === "blade:extends:layouts.app",
  ));

  const settings = nodeByPath(graph, "resources/views/pages/settings.blade.php")!;
  assert.ok(bladeEdgesFrom(graph, settings.id).some(
    (edge) => edge.to === partial.id && edge.qualifier === "blade:includeFirst:partials.site-header",
  ));

  const component = nodeByPath(graph, COMPONENT)!;
  const blogIndex = nodeByPath(graph, "resources/views/blog/index.blade.php")!;
  assert.ok(bladeEdgesFrom(graph, blogIndex.id).some(
    (edge) => edge.to === component.id && edge.qualifier === "blade:component:components.alert",
  ));
  const blogShow = nodeByPath(graph, "resources/views/blog/show.blade.php")!;
  assert.ok(bladeEdgesFrom(graph, blogShow.id).some(
    (edge) => edge.to === component.id && edge.qualifier === "blade:component-tag:components.alert",
  ));
});

test("impact of the partial lists all nine includers as dependents", async () => {
  const graph = await extractRepositoryMultiLanguageDependencyGraph(snapshot(laravelFixture()));
  const partial = nodeByPath(graph, PARTIAL);
  assert.ok(partial);

  const index = await createSolveGraphQueryIndex(graph);
  const impact = analyzeSolveGraphImpact(index, [partial.id]);
  const pathById = new Map(graph.nodes.map((node) => [node.id, node.metadata?.path]));
  const impactedPaths = new Set(
    impact.entries.map((entry) => pathById.get(entry.id)).filter((path) => typeof path === "string"),
  );
  for (const includerPath of INCLUDERS) {
    assert.ok(impactedPaths.has(includerPath), `${includerPath} should be impacted by the partial`);
  }
});

test("unresolvable Blade includes produce no phantom node or edge", async () => {
  const graph = await extractRepositoryMultiLanguageDependencyGraph(snapshot(laravelFixture()));
  assert.equal(
    graph.nodes.some((node) => typeof node.metadata?.path === "string"
      && (node.metadata.path.includes("does-not-exist") || node.metadata.path.includes("missing-header"))),
    false,
  );
  const dashboard = nodeByPath(graph, "resources/views/dashboard.blade.php")!;
  assert.equal(bladeEdgesFrom(graph, dashboard.id).length, 1);

  const plain = nodeByPath(graph, "resources/views/pages/plain.blade.php")!;
  assert.equal(bladeEdgesFrom(graph, plain.id).length, 0);

  const layout = nodeByPath(graph, LAYOUT)!;
  assert.equal(bladeEdgesFrom(graph, layout.id).length, 0);
});

test("Blade augmentation leaves PHP and JS dependency behavior unchanged", async () => {
  const graph = await extractRepositoryMultiLanguageDependencyGraph(snapshot(laravelFixture()));
  const helpers = nodeByPath(graph, "app/helpers.php")!;
  const mail = nodeByPath(graph, "app/mail.php")!;
  assert.ok(graph.edges.some(
    (edge) => edge.kind === "imports" && edge.from === helpers.id && edge.to === mail.id
      && edge.qualifier === "php:require:./mail.php",
  ));
  const app = nodeByPath(graph, "web/app.ts")!;
  const util = nodeByPath(graph, "web/util.ts")!;
  assert.ok(graph.edges.some(
    (edge) => edge.kind === "imports" && edge.from === app.id && edge.to === util.id,
  ));
});

test("equivalent reordered Blade snapshots produce identical canonical graphs", async () => {
  const files = laravelFixture();
  const left = await extractRepositoryMultiLanguageDependencyGraph(snapshot(files));
  const right = await extractRepositoryMultiLanguageDependencyGraph(snapshot([...files].reverse()));
  assert.equal(serializeSolveGraphDocument(left), serializeSolveGraphDocument(right));
  assert.equal(left.graphId, right.graphId);
});
