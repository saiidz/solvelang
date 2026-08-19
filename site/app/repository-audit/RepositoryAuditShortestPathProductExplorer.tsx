"use client";

import { RepositoryAuditShortestPathPanel } from "./RepositoryAuditShortestPathPanel";
import { RepositoryAuditShortestPathProductPanel } from "./RepositoryAuditShortestPathProductPanel";
import type { SolveGraphShortestPathProductBundle } from "../solve-graph/core/shortest-path-product";

type RepositoryAuditShortestPathProductExplorerProps = {
  bundle: SolveGraphShortestPathProductBundle;
  onDownload?: (download: SolveGraphShortestPathProductBundle["download"]) => void;
  className?: string;
};

export function RepositoryAuditShortestPathProductExplorer({
  bundle,
  onDownload,
  className = "",
}: RepositoryAuditShortestPathProductExplorerProps) {
  return (
    <div className={`grid gap-5 ${className}`.trim()}>
      <RepositoryAuditShortestPathPanel presentation={bundle.presentation} />
      <RepositoryAuditShortestPathProductPanel bundle={bundle} onDownload={onDownload} />
    </div>
  );
}
