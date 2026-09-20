import { fingerprint } from "./versions";
import { parseCloudWorkspace, type CloudWorkspace, type WorkspaceProject } from "./workspace-schema";
import type { WorkflowDocument } from "./types";
export { parseCloudWorkspace, MAX_CLOUD_BYTES, type CloudWorkspace, type WorkspaceProject } from "./workspace-schema";

// Explicitly capture validated local work. Reading alone never uploads data.
export function captureWorkspace(storage: Storage): CloudWorkspace {
  const raw = JSON.parse(storage.getItem("solvelang.studio.projects.v1") ?? "[]") as WorkflowDocument[];
  if (!Array.isArray(raw)) throw new Error("Resolve local storage recovery before connecting account saving.");
  return parseCloudWorkspace({ schemaVersion: 1, projects: raw.map((document) => ({document,
    versions: JSON.parse(storage.getItem(`solvelang.studio.versions.v1.${document.id}`) ?? "[]"),
    traces: JSON.parse(storage.getItem(`solvelang.studio.traces.v1.${document.id}`) ?? "[]"),
  })) });
}

// Restore adds cloud projects as new local copies. Existing browser projects and
// histories are never overwritten, even when IDs match.
export function importCloudProject(storage: Storage, project: WorkspaceProject, newId: string): WorkflowDocument {
  const validated = parseCloudWorkspace({schemaVersion:1,projects:[project]}).projects[0];
  const current = captureWorkspace(storage);
  if (current.projects.some(p=>p.document.id===newId)) throw new Error("Local project ID already exists.");
  const document = {...validated.document,id:newId,name:`${validated.document.name} (account copy)`};
  const projectKey="solvelang.studio.projects.v1",versionKey=`solvelang.studio.versions.v1.${newId}`,traceKey=`solvelang.studio.traces.v1.${newId}`;
  try {
    const versions = validated.versions.map((version) => {
      const copy = {...version.document, id:newId};
      return {...version, document:copy, fingerprint:fingerprint(copy)};
    });
    storage.setItem(versionKey,JSON.stringify(versions));
    storage.setItem(traceKey,JSON.stringify(validated.traces));
    storage.setItem(projectKey,JSON.stringify([document,...current.projects.map(p=>p.document)]));
  } catch {
    storage.removeItem(versionKey);storage.removeItem(traceKey);
    throw new Error("Browser storage is full. Export your local projects before restoring.");
  }
  return document;
}
