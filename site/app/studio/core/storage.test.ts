import test from "node:test";
import assert from "node:assert/strict";
import { createLocalAnalytics } from "./productAnalytics";
import { createProjectRepository } from "./storage";
import { compareVersions, createVersionSnapshot } from "./versions";
import { validSupportTriageFixture } from "./fixtures";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("repository saves, loads, lists, and deletes schema-versioned projects", () => {
  const storage = new MemoryStorage();
  const repository = createProjectRepository(storage);
  const document = validSupportTriageFixture();
  repository.save(document);
  assert.equal(repository.list()[0].id, document.id);
  assert.deepEqual(repository.load(document.id).document, document);
  repository.delete(document.id);
  assert.equal(repository.list().length, 0);
});

test("repository quarantines corrupt data without overwriting it", () => {
  const storage = new MemoryStorage();
  storage.setItem("solvelang.studio.projects.v1", "{broken");
  const repository = createProjectRepository(storage);
  const result = repository.loadAll();
  assert.equal(result.status, "corrupt");
  assert.equal(storage.getItem("solvelang.studio.projects.v1"), "{broken");
  assert.ok(storage.getItem("solvelang.studio.quarantine.v1"));
});

test("version snapshots deduplicate and compare graph changes", () => {
  const before = validSupportTriageFixture();
  const first = createVersionSnapshot(before, "Baseline", "Initial model", []);
  const duplicate = createVersionSnapshot(before, "Autosave", "No changes", first);
  assert.equal(duplicate.length, 1);
  const after = structuredClone(before);
  after.nodes[0].title = "Ticket received";
  const versions = createVersionSnapshot(after, "Edited", "Rename trigger", duplicate);
  const comparison = compareVersions(versions[0], versions[1]);
  assert.deepEqual(comparison.nodesModified, [after.nodes[0].id]);
});

test("product analytics stores only aggregate counters", () => {
  const storage = new MemoryStorage();
  const analytics = createLocalAnalytics(storage);
  analytics.track("studio_opened");
  analytics.track("studio_opened");
  const snapshot = analytics.snapshot();
  assert.equal(snapshot.studio_opened!.count, 2);
  assert.deepEqual(Object.keys(snapshot.studio_opened!).sort(), ["count", "lastOccurredAt"]);
});
