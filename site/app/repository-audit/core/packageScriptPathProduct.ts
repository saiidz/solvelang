import type { RepositoryPackageScriptPathEvidenceAnalysis } from "./packageScriptPathEvidence";
import {
  createRepositoryPackageScriptPathEvidenceDownload,
  type RepositoryPackageScriptPathEvidenceDownload,
} from "./packageScriptPathArtifact";
import {
  createRepositoryPackageScriptPathPresentation,
  type RepositoryPackageScriptPathPresentation,
  type RepositoryPackageScriptPathPresentationOptions,
} from "./packageScriptPathPresentation";

export type RepositoryPackageScriptPathProductBundle = {
  schema: "solvelang.repository-audit.package-script-path-product.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  download: RepositoryPackageScriptPathEvidenceDownload;
  presentation: RepositoryPackageScriptPathPresentation;
  execution: {
    networkAccess: false;
    writeAccess: false;
    sourcePartial: boolean;
    presentationRowsTruncated: boolean;
  };
};

export async function createRepositoryPackageScriptPathProductBundle(
  archiveName: string,
  analysis: RepositoryPackageScriptPathEvidenceAnalysis,
  presentationOptions: RepositoryPackageScriptPathPresentationOptions = {},
): Promise<RepositoryPackageScriptPathProductBundle> {
  if (analysis.mode !== "analyze-only"
    || analysis.execution.networkAccess !== false
    || analysis.execution.writeAccess !== false) {
    throw new Error("Repository package-script product bundle requires analyze-only input with networkAccess=false and writeAccess=false.");
  }

  const [download, presentation] = await Promise.all([
    createRepositoryPackageScriptPathEvidenceDownload(archiveName, analysis),
    Promise.resolve(createRepositoryPackageScriptPathPresentation(analysis, presentationOptions)),
  ]);

  if (download.artifact.graphId !== analysis.graphId || presentation.graphId !== analysis.graphId) {
    throw new Error("Repository package-script product bundle graph identity changed during composition.");
  }
  if (download.artifact.execution.networkAccess !== false
    || download.artifact.execution.writeAccess !== false
    || presentation.execution.networkAccess !== false
    || presentation.execution.writeAccess !== false) {
    throw new Error("Repository package-script product bundle requires capability-free artifact and presentation outputs.");
  }

  const sourcePartial = analysis.status === "partial";
  const presentationRowsTruncated = presentation.execution.rowsTruncated;
  return {
    schema: "solvelang.repository-audit.package-script-path-product.v0",
    mode: "analyze-only",
    graphId: analysis.graphId,
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
