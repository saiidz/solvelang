import { ScenarioRunSchema, VersionSnapshotSchema, parseWorkflowDocument } from "./schema";
import type { ScenarioRun, VersionSnapshot, WorkflowDocument } from "./types";
import type { z } from "zod";

const PROJECT_KEY = "solvelang.studio.projects.v1";
const QUARANTINE_KEY = "solvelang.studio.quarantine.v1";

export function migrateStoredProjects(input: unknown): unknown {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object" && "schemaVersion" in input && (input as { schemaVersion: number }).schemaVersion === 1 && "projects" in input) return (input as { projects: unknown }).projects;
  return input;
}

export function createProjectRepository(storage: Storage) {
  type LoadResult = { status: "ok"; documents: WorkflowDocument[] } | { status: "corrupt" | "unavailable"; documents: []; error: string };
  const quarantine = (raw: string) => { try { storage.setItem(QUARANTINE_KEY, JSON.stringify({ capturedAt: new Date().toISOString(), raw })); } catch { /* Storage is unavailable; preserve the original key by doing nothing. */ } };
  const loadAll = (): LoadResult => {
    try {
      const raw = storage.getItem(PROJECT_KEY);
      if (!raw) return { status: "ok", documents: [] };
      const parsed = migrateStoredProjects(JSON.parse(raw));
      if (!Array.isArray(parsed)) throw new Error("Stored project collection is incompatible.");
      const documents: WorkflowDocument[] = [];
      for (const item of parsed) {
        const result = parseWorkflowDocument(item);
        if (!result.ok) throw new Error(result.error);
        documents.push(result.document);
      }
      if (new Set(documents.map((document) => document.id)).size !== documents.length) throw new Error("Stored project collection contains duplicate project IDs.");
      return { status: "ok", documents };
    } catch (error) {
      let raw = "";
      try { raw = storage.getItem(PROJECT_KEY) ?? ""; } catch { return { status: "unavailable", documents: [], error: "Browser storage is unavailable." }; }
      quarantine(raw);
      return { status: "corrupt", documents: [], error: error instanceof Error ? error.message : "Stored data is corrupt." };
    }
  };
  const saveAll = (documents: WorkflowDocument[]) => { try { storage.setItem(PROJECT_KEY, JSON.stringify(documents)); return true; } catch { return false; } };
  return {
    loadAll,
    recovery() {
      try {
        const raw = storage.getItem(QUARANTINE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { capturedAt?: unknown; raw?: unknown };
        return typeof parsed.raw === "string" ? { capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : "", raw: parsed.raw } : null;
      } catch { return null; }
    },
    resetCorrupt() { try { storage.removeItem(PROJECT_KEY); storage.removeItem(QUARANTINE_KEY); return true; } catch { return false; } },
    list() { const result = loadAll(); return result.status === "ok" ? result.documents : []; },
    load(id: string) { const result = loadAll(); return { status: result.status, document: result.status === "ok" ? result.documents.find((item) => item.id === id) ?? null : null, ...("error" in result ? { error: result.error } : {}) }; },
    save(document: WorkflowDocument) {
      const parsed = parseWorkflowDocument(document);
      if (!parsed.ok) return { status: "invalid" as const, documents: [] as [], error: `Invalid workflow was not saved: ${parsed.error}` };
      const result = loadAll();
      if (result.status !== "ok") return result;
      const documents = [structuredClone(parsed.document), ...result.documents.filter((item) => item.id !== parsed.document.id)];
      return saveAll(documents) ? { status: "ok" as const, document: parsed.document } : { status: "unavailable" as const, documents: [] as [], error: "Browser storage is full or unavailable." };
    },
    delete(id: string) { const result = loadAll(); if (result.status === "ok") saveAll(result.documents.filter((item) => item.id !== id)); },
  };
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>;

export function persistWorkflowForActivation(
  repository: ProjectRepository | null,
  document: WorkflowDocument,
) {
  if (!repository) {
    return {
      status: "unavailable" as const,
      documents: [] as [],
      error: "Browser storage is unavailable.",
    };
  }
  return repository.save(document);
}

export function createArtifactRepository(storage: Storage) {
  const read = <T>(key: string, schema: z.ZodType<T>): T[] => {
    try {
      const raw = storage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Artifact collection is incompatible.");
      return parsed.map((item) => schema.parse(item));
    } catch {
      let raw = "";
      try { raw = storage.getItem(key) ?? ""; storage.setItem(`${QUARANTINE_KEY}.${key}`, JSON.stringify({ capturedAt: new Date().toISOString(), raw })); } catch { /* Storage is unavailable. */ }
      return [];
    }
  };
  const write = (key: string, value: unknown) => { try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  return {
    loadVersions(projectId: string) { return read<VersionSnapshot>(`solvelang.studio.versions.v1.${projectId}`, VersionSnapshotSchema); },
    saveVersions(projectId: string, versions: VersionSnapshot[]) { return write(`solvelang.studio.versions.v1.${projectId}`, versions); },
    loadTraces(projectId: string) { return read<ScenarioRun>(`solvelang.studio.traces.v1.${projectId}`, ScenarioRunSchema); },
    saveTraces(projectId: string, traces: ScenarioRun[]) { return write(`solvelang.studio.traces.v1.${projectId}`, traces); },
    deleteProjectArtifacts(projectId: string) {
      try { storage.removeItem(`solvelang.studio.versions.v1.${projectId}`); storage.removeItem(`solvelang.studio.traces.v1.${projectId}`); } catch { /* Storage is unavailable. */ }
    },
  };
}
