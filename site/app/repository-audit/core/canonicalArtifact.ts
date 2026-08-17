import type { RepositoryAuditAnalysisResult } from "./analysisPipeline";
import { createCanonicalRepositoryAuditReport, serializeCanonicalRepositoryAuditReport } from "./canonicalReport";
import type { RepositoryInventoryAnalysis } from "./inventory";
import { repositoryAuditSafeFilename } from "./report";

export type CanonicalRepositoryAuditArtifact = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  report: Awaited<ReturnType<typeof createCanonicalRepositoryAuditReport>>;
};

export async function createCanonicalRepositoryAuditArtifact(input: {
  archiveName: string;
  analysis: RepositoryInventoryAnalysis;
  intelligence: RepositoryAuditAnalysisResult;
  maxArchiveEntries: number;
  now?: Date;
}): Promise<CanonicalRepositoryAuditArtifact> {
  const now = input.now ?? new Date();
  const report = await createCanonicalRepositoryAuditReport(input.analysis, {
    archiveName: input.archiveName,
    intelligence: input.intelligence,
    maxArchiveEntries: input.maxArchiveEntries,
    generatedAt: now,
    startedAt: now,
    finishedAt: now,
  });
  const base = `${repositoryAuditSafeFilename(input.archiveName)}-solvelang-repository-audit`;
  return {
    filename: `${base}-canonical.json`,
    mediaType: "application/json;charset=utf-8",
    content: serializeCanonicalRepositoryAuditReport(report),
    report,
  };
}
