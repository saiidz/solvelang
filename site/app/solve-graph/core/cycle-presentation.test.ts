import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphCyclePresentation } from "./cycle-presentation";
test("presents bounded cycles deterministically without defect claims", () => { const result = createSolveGraphCyclePresentation({ components: [{ id: "b", nodes: ["b"] }, { id: "a", nodes: ["a"] }] }, 1); assert.deepEqual(result.components.map((item) => item.id), ["a"]); assert.equal(result.truncated, true); assert.match(result.notices[0] ?? "", /not automatically defects/); });
