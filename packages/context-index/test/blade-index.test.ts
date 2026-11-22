// Blade directive edges through the context-index query path (QA child for
// the Solve Graph Blade augmentation). The dogfood failure this pins: a
// Blade partial's impact pack contained none of the blades that include
// it, because the graph carried no Blade edges. With the edges present,
// building an index over a Laravel-shaped tree and querying for the
// partial must deliver its includers in the pack's selected set.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { queryContextIndex } from "../../mcp-server/src/context-index";
import { buildContextIndex } from "../src/index-build";
import {
  CONTEXT_INDEX_FILE,
  CONTEXT_INDEX_GRAPH_FILE,
  type ContextIndex,
} from "../src/index-format";
import type { SolveGraphDocument } from "../../../site/app/solve-graph/core/contracts";

const PARTIAL = "resources/views/partials/site-header.blade.php";

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

async function write(root: string, relative: string, content: string): Promise<void> {
  const destination = path.join(root, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

async function seedLaravel(root: string): Promise<void> {
  await write(root, "resources/views/layouts/app.blade.php", "<html><body>@yield('content')</body></html>\n");
  await write(root, PARTIAL, "<header class=\"site-header\">Site header</header>\n");
  await write(root, "resources/views/components/alert.blade.php", "<div class=\"alert\">{{ $slot }}</div>\n");
  await write(root, "resources/views/pages/home.blade.php", "@extends('layouts.app')\n@include('partials.site-header')\n<h1>Home</h1>\n");
  await write(root, "resources/views/pages/about.blade.php", "@include('partials.site-header')\n<h1>About</h1>\n");
  await write(root, "resources/views/pages/pricing.blade.php", "@includeIf('partials.site-header')\n<h1>Pricing</h1>\n");
  await write(root, "resources/views/pages/contact.blade.php", "@includeWhen($showHeader, 'partials.site-header')\n<h1>Contact</h1>\n");
  await write(root, "resources/views/pages/profile.blade.php", "@includeUnless($hideHeader, 'partials.site-header')\n<h1>Profile</h1>\n");
  await write(root, "resources/views/pages/settings.blade.php", "@includeFirst(['partials.missing-header', 'partials.site-header'])\n<h1>Settings</h1>\n");
  await write(root, "resources/views/blog/index.blade.php", "@include('partials.site-header')\n@component('components.alert')\n@endcomponent\n");
  await write(root, "resources/views/blog/show.blade.php", "@include('partials.site-header')\n<x-alert />\n");
  await write(root, "resources/views/dashboard.blade.php", "@include('partials.site-header')\n@include('partials.does-not-exist')\n<h1>Dashboard</h1>\n");
}

test("index over a Laravel tree carries Blade edges and the partial query delivers its includers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-blade-index-"));
  const previous = process.env.SOLVELANG_WORKSPACE_ROOT;
  process.env.SOLVELANG_WORKSPACE_ROOT = root;
  try {
    await seedLaravel(root);
    await buildContextIndex(root);

    const index = JSON.parse(
      await readFile(path.join(root, ".solve", CONTEXT_INDEX_FILE), "utf8"),
    ) as ContextIndex;
    const partialRecord = index.records.find((record) => record.path === PARTIAL);
    assert.ok(partialRecord, "the partial must be an index record");
    for (const includerPath of INCLUDERS) {
      const record = index.records.find((entry) => entry.path === includerPath);
      assert.ok(record, `${includerPath} must be an index record`);
      assert.ok(
        record.imports.includes(PARTIAL),
        `${includerPath} record must project the Blade edge to the partial`,
      );
    }

    const graph = JSON.parse(
      await readFile(path.join(root, ".solve", CONTEXT_INDEX_GRAPH_FILE), "utf8"),
    ) as SolveGraphDocument;
    const pathById = new Map(
      graph.nodes
        .filter((node) => node.kind === "file" && typeof node.metadata?.path === "string")
        .map((node) => [node.id, node.metadata!.path as string]),
    );
    const bladeTargetsOf = (fromPath: string) => graph.edges
      .filter((edge) => edge.kind === "imports" && edge.qualifier?.startsWith("blade:"))
      .filter((edge) => pathById.get(edge.from) === fromPath)
      .map((edge) => pathById.get(edge.to));
    for (const includerPath of INCLUDERS) {
      assert.ok(
        bladeTargetsOf(includerPath).includes(PARTIAL),
        `${includerPath} must carry a Blade edge to the partial in the index graph`,
      );
    }
    assert.deepEqual(bladeTargetsOf("resources/views/dashboard.blade.php"), [PARTIAL]);

    const result = await queryContextIndex("site header partial", { budgetBytes: 65_536 });
    assert.equal(result.selection.graphHintsUsed, true);
    assert.ok(result.pack, "expected a pack");
    const entryPaths = result.pack.entries.map((entry) => entry.path);
    assert.ok(entryPaths.includes(PARTIAL), "the partial itself must be in the pack");
    for (const includerPath of INCLUDERS) {
      assert.ok(
        entryPaths.includes(includerPath),
        `${includerPath} must be delivered in the pack for the partial query`,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
    else process.env.SOLVELANG_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
