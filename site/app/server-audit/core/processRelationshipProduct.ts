import type { ServerAuditProcessRelationshipAnalysis } from "./processRelationships";
import {
  createServerAuditProcessRelationshipDownload,
  type ServerAuditProcessRelationshipDownload,
} from "./processRelationshipArtifact";
import {
  createServerAuditProcessRelationshipPresentation,
  type ServerAuditProcessRelationshipPresentation,
  type ServerAuditProcessRelationshipPresentationOptions,
} from "./processRelationshipPresentation";

export type ServerAuditProcessRelationshipProductBundle = {
  schema: "solvelang.server-audit.process-relationship-product.v0";
  mode: "analyze-only";
  status: "complete" | "partial";
  download: ServerAuditProcessRelationshipDownload;
  presentation: ServerAuditProcessRelationshipPresentation;
  execution: {
    networkAccess: false;
    writeAccess: false;
    sourcePartial: boolean;
    presentationRowsTruncated: boolean;
  };
};

export async function createServerAuditProcessRelationshipProductBundle(
  sourceName: string,
  analysis: ServerAuditProcessRelationshipAnalysis,
  presentationOptions: ServerAuditProcessRelationshipPresentationOptions = {},
): Promise<ServerAuditProcessRelationshipProductBundle> {
  if (analysis.mode !== "analyze-only"
    || analysis.execution.networkAccess !== false
    || analysis.execution.writeAccess !== false) {
    throw new Error("Server Audit process relationship product bundle requires analyze-only input with networkAccess=false and writeAccess=false.");
  }

  const [download, presentation] = await Promise.all([
    createServerAuditProcessRelationshipDownload(sourceName, analysis),
    Promise.resolve(createServerAuditProcessRelationshipPresentation(analysis, presentationOptions)),
  ]);

  if (download.artifact.execution.networkAccess !== false
    || download.artifact.execution.writeAccess !== false
    || presentation.execution.networkAccess !== false
    || presentation.execution.writeAccess !== false) {
    throw new Error("Server Audit process relationship product bundle requires capability-free outputs.");
  }
  if (download.artifact.summary.processesChecked !== analysis.summary.processesChecked
    || download.artifact.summary.listenersChecked !== analysis.summary.listenersChecked
    || download.artifact.relationships.length !== analysis.relationships.length
    || presentation.summary.relationships !== analysis.relationships.length) {
    throw new Error("Server Audit process relationship product bundle source identity changed during composition.");
  }

  const sourcePartial = download.artifact.status === "partial";
  const presentationRowsTruncated = presentation.execution.rowsTruncated;
  return {
    schema: "solvelang.server-audit.process-relationship-product.v0",
    mode: "analyze-only",
    status: sourcePartial || presentationRowsTruncated ? "partial" : "complete",
    download,
    presentation,
    execution: {
      networkAccess: false,
      writeAccess: false,
      sourcePartial,
      presentationRowsTruncated,
    },
  };
}
