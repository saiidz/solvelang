export const NODE_TYPES = [
  "trigger", "action", "decision", "human_review", "approval", "system",
  "data_input", "data_output", "policy", "notification", "timer", "exception", "terminal",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Severity = "error" | "warning" | "recommendation";

export interface EvidenceItem {
  label: string;
  value: string;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  title: string;
  description: string;
  owner: string;
  system: string;
  inputs: string[];
  outputs: string[];
  policyRefs: string[];
  slaMinutes: number | null;
  riskLevel: RiskLevel;
  humanRequired: boolean;
  evidence: EvidenceItem[];
  position: { x: number; y: number };
  metadata: Record<string, string>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition: string;
  priority: number;
  label: string;
  fallback: boolean;
  metadata: Record<string, string>;
}

export interface WorkflowPolicy {
  id: string;
  title: string;
  description: string;
  owner: string;
  scope: string;
  evidence: EvidenceItem[];
  metadata: Record<string, string>;
}

export interface WorkflowScenario {
  id: string;
  name: string;
  description: string;
  startingTrigger: string;
  inputVariables: Record<string, string>;
  decisionOutcomes: Record<string, string>;
  expectedTerminalState: string;
  expectedHumanReviewPoints: string[];
  expectedOutputs: string[];
}

export interface WorkflowAnalyticsMetadata {
  tags: string[];
  lastAnalyzedAt: string | null;
  analysisRuns: number;
}

export interface WorkflowDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  scenarios: WorkflowScenario[];
  policies: WorkflowPolicy[];
  analytics: WorkflowAnalyticsMetadata;
  suppressedRuleIds: string[];
}

export interface AnalysisFinding {
  id: string;
  ruleId: string;
  severity: Severity;
  status: "open" | "suppressed";
  affectedType: "workflow" | "node" | "edge" | "policy";
  affectedId: string | null;
  title: string;
  explanation: string;
  remediation: string;
  evidence: string[];
  suppressible: boolean;
  suppressed: boolean;
}

export interface ScoreFactor {
  label: string;
  value: number;
  weight: number;
  deduction: number;
  explanation: string;
}

export interface ExplainableScore {
  value: number;
  formula: string;
  factors: ScoreFactor[];
}

export interface WorkflowAnalysis {
  findings: AnalysisFinding[];
  passedChecks: Array<{ ruleId: string; title: string }>;
  score: ExplainableScore;
  coverage: { owner: number; sla: number; fallback: number; policy: number; terminal: number };
}

export interface PolicyCheck {
  nodeId: string;
  policyId: string;
  result: "passed" | "missing";
}

export interface TraceEvent {
  sequence: number;
  nodeId: string;
  nodeType: NodeType;
  action: string;
  inputSummary: string;
  outputSummary: string;
  decision: string;
  policyResult: string;
  humanReviewState: "not-required" | "paused";
  warnings: string[];
  durationEstimate: number;
}

export interface ScenarioRun {
  id: string;
  scenarioId: string;
  scenarioName: string;
  passed: boolean;
  path: string[];
  branchesTaken: string[];
  branchesSkipped: string[];
  unresolvedDecisions: string[];
  humanReviewPauses: string[];
  policyChecks: PolicyCheck[];
  terminalResult: string | null;
  elapsedSlaMinutes: number;
  outputs: string[];
  warnings: string[];
  failures: string[];
  trace: TraceEvent[];
}

export interface QualityScore extends ExplainableScore {}

export interface WorkflowAnalytics {
  structural: Record<string, number> & {
    nodeCount: number; edgeCount: number; decisionCount: number; exceptionPathCount: number;
    humanReviewCount: number; approvalCount: number; systemCount: number; handoffCount: number;
    averagePathDepth: number; maximumPathDepth: number; branchCount: number; policyCoverage: number;
    ownerCoverage: number; slaCoverage: number; fallbackCoverage: number; exceptionCoverage: number;
  };
  scenario: {
    scenarioPassRate: number; expectedTerminalMatchRate: number; unresolvedDecisionRate: number;
    humanReviewCoverage: number; averageModeledCycleTime: number; maximumModeledCycleTime: number;
    pathCoverage: number; nodeCoverage: number; edgeCoverage: number;
    failureDistribution: Record<string, number>; mostFrequentlyTraversedNodes: string[]; neverTraversedNodes: string[];
  };
  quality: {
    automationReadiness: QualityScore; explainability: QualityScore; resilience: QualityScore;
    governance: QualityScore; observability: QualityScore;
  };
}

export interface VersionSnapshot {
  id: string;
  label: string;
  timestamp: string;
  summary: string;
  nodeCount: number;
  edgeCount: number;
  scoreSnapshot: number;
  fingerprint: string;
  document: WorkflowDocument;
}

export type ProductEventName =
  | "studio_opened" | "project_created" | "template_selected" | "workflow_imported"
  | "node_created" | "node_updated" | "edge_created" | "analysis_run" | "finding_opened"
  | "finding_resolved" | "scenario_created" | "scenario_run" | "comparison_opened" | "export_created";
