import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalPreviewSession } from "./canonicalRunner";

const success = (outputs: unknown[]) => JSON.stringify({ contract: "solvelang.run_pure", version: 1, ok: true, outputs, error: null });

test("canonical preview retains typed output and reuses the qualified runtime", async () => {
  let loads = 0;
  const session = createCanonicalPreviewSession(async () => { loads++; return { runPure: () => success(["ok", 7, true, [1], { safe: true }, null]) }; });
  const result = await session.run("print(7)");
  assert.deepEqual(result, { ok: true, output: 'ok\n7\ntrue\n[1]\n{"safe":true}\nnull' });
  assert.deepEqual(await session.run("print(7)"), result);
  assert.equal(loads, 1);
});

test("failed loading is visible and retryable with no execution or fallback", async () => {
  let attempts = 0;
  let runs = 0;
  const session = createCanonicalPreviewSession(async () => {
    if (++attempts === 1) throw new Error("private loader detail");
    return { runPure: () => { runs++; return success(["recovered"]); } };
  });
  const failed = await session.run("print(1)");
  assert.equal(failed.ok, false);
  assert.match(failed.error!, /No script was executed/);
  assert.equal(JSON.stringify(failed).includes("private loader detail"), false);
  assert.equal(runs, 0);
  assert.equal((await session.run("print(1)")).output, "recovered");
  assert.equal(attempts, 2);
});

test("overlapping runs do not duplicate loading or execute twice", async () => {
  let ready!: (runtime: { runPure: (source: string) => string }) => void;
  let loads = 0;
  let runs = 0;
  const session = createCanonicalPreviewSession(() => { loads++; return new Promise(resolve => { ready = resolve; }); });
  const first = session.run("first");
  assert.equal((await session.run("second")).kind, "busy");
  ready({ runPure: source => { runs++; return success([source]); } });
  assert.equal((await first).output, "first");
  assert.equal(loads, 1);
  assert.equal(runs, 1);
});

test("canonical errors retain source locations and safe textual output", async () => {
  const session = createCanonicalPreviewSession(async () => ({ runPure: () => JSON.stringify({ contract: "solvelang.run_pure", version: 1, ok: false, outputs: [], error: { kind: "evaluation", message: "Division by zero", line: 2, column: 9, source_line: "print(1 / 0)", hint: "Use a nonzero divisor" } }) }));
  const result = await session.run("print(1 / 0)");
  assert.equal(result.ok, false);
  assert.match(result.error!, /preview.solve:2:9/);
  assert.match(result.error!, /print\(1 \/ 0\)/);
  assert.match(result.error!, /\^/);
  assert.match(result.error!, /Use a nonzero divisor/);
});

test("runtime traps and malformed responses fail without claiming nothing ran or leaking details", async () => {
  for (const runPure of [() => { throw new Error("private trap detail"); }, () => "{}", () => "not json"]) {
    const session = createCanonicalPreviewSession(async () => ({ runPure }));
    const result = await session.run("print(1)");
    assert.equal(result.ok, false);
    assert.match(result.error!, /No server fallback/);
    assert.equal(JSON.stringify(result).includes("private trap"), false);
    assert.equal(JSON.stringify(result).includes("No script was executed"), false);
  }
});
