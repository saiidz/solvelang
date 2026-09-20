import { VersionSnapshotSchema, ScenarioRunSchema, parseWorkflowDocument } from "./schema";
import type { WorkflowDocument, VersionSnapshot, ScenarioRun } from "./types";
export type WorkspaceProject = { document: WorkflowDocument; versions: VersionSnapshot[]; traces: ScenarioRun[] };
export type CloudWorkspace = { schemaVersion: 1; projects: WorkspaceProject[] };
export const MAX_CLOUD_BYTES = 256 * 1024;
export function parseCloudWorkspace(input: unknown): CloudWorkspace {
  if (!input || typeof input !== "object") throw new Error("Invalid account workspace.");
  const candidate = input as CloudWorkspace;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.projects) || candidate.projects.length > 50) throw new Error("Invalid account workspace.");
  if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_CLOUD_BYTES) throw new Error("Account workspace exceeds 256 KiB. Export older projects and history before saving.");
  const ids = new Set<string>();
  const projects = candidate.projects.map((project) => {
    const parsed = parseWorkflowDocument(project.document);
    if (!parsed.ok || ids.has(parsed.document.id)) throw new Error("Account workspace contains an invalid or duplicate project.");
    ids.add(parsed.document.id);
    const versions = VersionSnapshotSchema.array().parse(project.versions);
    const traces = ScenarioRunSchema.array().parse(project.traces);
    return { document: parsed.document, versions, traces };
  });
  return { schemaVersion: 1, projects };
}

