import { parseWorkflowDocument } from "./schema";
import type { VersionSnapshot, WorkflowDocument } from "./types";

const PROJECT_KEY = "solvelang.studio.projects.v1";
const QUARANTINE_KEY = "solvelang.studio.quarantine.v1";

export function migrateStoredProjects(input: unknown): unknown {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object" && "schemaVersion" in input && (input as { schemaVersion: number }).schemaVersion === 1 && "projects" in input) return (input as { projects: unknown }).projects;
  return input;
}

export function createProjectRepository(storage: Storage) {
  const loadAll = (): { status: "ok"; documents: WorkflowDocument[] } | { status: "corrupt"; documents: []; error: string } => {
    const raw = storage.getItem(PROJECT_KEY);
    if (!raw) return { status: "ok", documents: [] };
    try {
      const parsed = migrateStoredProjects(JSON.parse(raw));
      if (!Array.isArray(parsed)) throw new Error("Stored project collection is incompatible.");
      const documents: WorkflowDocument[] = [];
      for (const item of parsed) {
        const result = parseWorkflowDocument(item);
        if (!result.ok) throw new Error(result.error);
        documents.push(result.document);
      }
      return { status: "ok", documents };
    } catch (error) {
      storage.setItem(QUARANTINE_KEY, JSON.stringify({ capturedAt: new Date().toISOString(), raw }));
      return { status: "corrupt", documents: [], error: error instanceof Error ? error.message : "Stored data is corrupt." };
    }
  };
  const saveAll = (documents: WorkflowDocument[]) => storage.setItem(PROJECT_KEY, JSON.stringify(documents));
  return {
    loadAll,
    list() { const result = loadAll(); return result.status === "ok" ? result.documents : []; },
    load(id: string) { const result = loadAll(); return { status: result.status, document: result.status === "ok" ? result.documents.find((item) => item.id === id) ?? null : null, ...("error" in result ? { error: result.error } : {}) }; },
    save(document: WorkflowDocument) { const result = loadAll(); if (result.status === "corrupt") return result; const documents = [structuredClone(document), ...result.documents.filter((item) => item.id !== document.id)]; saveAll(documents); return { status: "ok" as const, document }; },
    delete(id: string) { const result = loadAll(); if (result.status === "ok") saveAll(result.documents.filter((item) => item.id !== id)); },
  };
}

export function createArtifactRepository(storage: Storage) {
  const read = <T>(key: string): T[] => {
    const raw = storage.getItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Artifact collection is incompatible.");
      return parsed as T[];
    } catch {
      storage.setItem(`${QUARANTINE_KEY}.${key}`, JSON.stringify({ capturedAt: new Date().toISOString(), raw }));
      return [];
    }
  };
  return {
    loadVersions(projectId: string) { return read<VersionSnapshot>(`solvelang.studio.versions.v1.${projectId}`); },
    saveVersions(projectId: string, versions: VersionSnapshot[]) { storage.setItem(`solvelang.studio.versions.v1.${projectId}`, JSON.stringify(versions)); },
    loadTraces<T = unknown>(projectId: string) { return read<T>(`solvelang.studio.traces.v1.${projectId}`); },
    saveTraces<T>(projectId: string, traces: T[]) { storage.setItem(`solvelang.studio.traces.v1.${projectId}`, JSON.stringify(traces)); },
    deleteProjectArtifacts(projectId: string) {
      storage.removeItem(`solvelang.studio.versions.v1.${projectId}`);
      storage.removeItem(`solvelang.studio.traces.v1.${projectId}`);
    },
  };
}
