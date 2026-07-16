import test from "node:test";
import assert from "node:assert/strict";
import { createLocalAnalytics } from "./productAnalytics";
import { createArtifactRepository, createProjectRepository } from "./storage";
import { compareVersions, createVersionSnapshot } from "./versions";
import { validSupportTriageFixture } from "./fixtures";
import { simulateScenario } from "./simulation";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class QuarantineDeniedStorage extends MemoryStorage {
  denyQuarantine = false;
  override setItem(key: string, value: string) {
    if (this.denyQuarantine && key === "solvelang.studio.quarantine.v1") {
      throw new DOMException("quota", "QuotaExceededError");
    }
    super.setItem(key, value);
  }
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
  assert.equal(repository.recovery()?.raw, "{broken");
  assert.equal(repository.resetCorrupt(), true);
  assert.equal(repository.loadAll().status, "ok");
});

test("failed quarantine still permits verified reset and valid replacement persistence", () => {
  const storage = new QuarantineDeniedStorage();
  storage.setItem("solvelang.studio.projects.v1", "{broken");
  storage.denyQuarantine = true;
  const repository = createProjectRepository(storage);
  assert.equal(repository.loadAll().status, "corrupt");
  assert.equal(repository.recovery(), null);
  assert.equal(repository.resetCorrupt(), true);
  assert.equal(storage.getItem("solvelang.studio.projects.v1"), null);
  assert.equal(storage.getItem("solvelang.studio.quarantine.v1"), null);

  const replacement = validSupportTriageFixture();
  assert.equal(repository.save(replacement).status, "ok");
  assert.deepEqual(repository.load(replacement.id).document, replacement);
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

test("version history is capped at 30 and project artifacts remain isolated", () => {
  const storage = new MemoryStorage();
  const artifacts = createArtifactRepository(storage);
  const first = validSupportTriageFixture();
  const second = structuredClone(first);
  second.id = "second-project";
  let versions = createVersionSnapshot(first, "Initial", "Initial", []);
  for (let index = 0; index < 35; index += 1) {
    first.nodes[0].title = `Edit ${index}`;
    versions = createVersionSnapshot(first, `Edit ${index}`, "Changed", versions);
  }
  assert.equal(versions.length, 30);
  artifacts.saveVersions(first.id, versions);
  artifacts.saveVersions(second.id, createVersionSnapshot(second, "Second", "Second", []));
  assert.equal(artifacts.loadVersions(first.id).length, 30);
  assert.equal(artifacts.loadVersions(second.id).length, 1);
  artifacts.deleteProjectArtifacts(first.id);
  assert.equal(artifacts.loadVersions(first.id).length, 0);
  assert.equal(artifacts.loadVersions(second.id).length, 1);
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

test("corrupt local analytics never break Studio actions", () => {
  const storage = new MemoryStorage();
  storage.setItem("solvelang.studio.analytics.v1", "1");
  const analytics = createLocalAnalytics(storage);
  assert.doesNotThrow(() => analytics.track("studio_opened"));
  assert.equal(analytics.snapshot().studio_opened?.count, 1);
});

test("artifact repository stores versions and traces by project", () => {
  const storage = new MemoryStorage();
  const repository = createArtifactRepository(storage);
  const workflow = validSupportTriageFixture();
  const versions = createVersionSnapshot(workflow, "Baseline", "Initial", []);
  repository.saveVersions(workflow.id, versions);
  const traces = [simulateScenario(workflow, workflow.scenarios[0])];
  repository.saveTraces(workflow.id, traces);
  assert.deepEqual(repository.loadVersions(workflow.id), versions);
  assert.deepEqual(repository.loadTraces(workflow.id), traces);
});
