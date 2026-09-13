import { normalizeContextPath, sha256Text } from "./context-pack.js";
import { retrieveWorkspaceContext, type ContextRetrievalRequest } from "./context-workspace.js";
import { readWorkspaceText } from "./workspace.js";

export const CONTEXT_HANDOFF_SCHEMA = "solvelang.context.handoff.v0" as const;
export const CONTEXT_HANDOFF_VALIDATION_SCHEMA = "solvelang.context.handoff-validation.v0" as const;
export const MAX_HANDOFF_CHANGED_PATHS = 128;
export const MAX_HANDOFF_CONTEXT_REFERENCES = 256;
export const MAX_HANDOFF_DECISIONS = 64;
export const MAX_HANDOFF_QUESTIONS = 64;
export const MAX_HANDOFF_TESTS = 128;
export const MAX_HANDOFF_DOCUMENT_BYTES = 256 * 1024;

const MAX_HANDOFF_GOAL_BYTES = 16 * 1024;
const MAX_HANDOFF_NOTE_BYTES = 4 * 1024;
const MAX_HANDOFF_TEST_LABEL_BYTES = 2 * 1024;
const MAX_HANDOFF_TEST_EVIDENCE_BYTES = 4 * 1024;

const AGENTS = new Set<ContextHandoffAgent>(["claude", "codex", "other"]);
const TARGETS = new Set<ContextHandoffTarget>(["claude", "codex", "any", "other"]);
const TEST_STATUSES = new Set<ContextHandoffTestStatus>(["passed", "failed", "not_run", "unknown"]);
const SENSITIVE_DIRECTORIES = new Set([".aws", ".gnupg", ".kube", ".ssh"]);
const SENSITIVE_FILENAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
]);

export type ContextHandoffAgent = "claude" | "codex" | "other";
export type ContextHandoffTarget = ContextHandoffAgent | "any";
export type ContextHandoffTestStatus = "passed" | "failed" | "not_run" | "unknown";

export interface ContextHandoffTest {
  label: string;
  status: ContextHandoffTestStatus;
  evidence?: string;
}

export interface ContextHandoffSourceIdentity {
  path: string;
  sourceSha256: string;
  bytes: number;
}

export interface ContextHandoffReference extends ContextRetrievalRequest {}

export interface ContextHandoff {
  schema: typeof CONTEXT_HANDOFF_SCHEMA;
  handoffId: string;
  fromAgent: ContextHandoffAgent;
  toAgent: ContextHandoffTarget;
  goal: string;
  decisions: string[];
  unresolvedQuestions: string[];
  changedSources: ContextHandoffSourceIdentity[];
  tests: ContextHandoffTest[];
  context: ContextHandoffReference[];
  freshness: {
    mode: "content-addressed";
    changedSourcesVerifiedAtCreation: true;
    contextReferencesVerifiedAtCreation: true;
  };
}

export interface CreateContextHandoffInput {
  fromAgent: ContextHandoffAgent;
  toAgent?: ContextHandoffTarget;
  goal: string;
  decisions?: string[];
  unresolvedQuestions?: string[];
  changedPaths?: string[];
  tests?: ContextHandoffTest[];
  context?: ContextHandoffReference[];
}

export interface ContextHandoffValidation {
  schema: typeof CONTEXT_HANDOFF_VALIDATION_SCHEMA;
  handoffId: string;
  integrityValid: boolean;
  contentFresh: boolean;
  valid: boolean;
  staleChangedSources: Array<{ path: string; reason: string }>;
  staleContextReferences: Array<{ handle: string; path: string; reason: string }>;
  caveat: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertBoundedText(label: string, value: string, maxBytes: number): void {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes === 0) throw new Error(`${label} must not be empty.`);
  if (bytes > maxBytes) throw new Error(`${label} exceeds the ${maxBytes} byte safety limit.`);
}

function assertBoundedList(label: string, values: string[], maxItems: number): string[] {
  if (values.length > maxItems) throw new Error(`${label} exceeds the ${maxItems} item safety limit.`);
  for (const value of values) assertBoundedText(label, value, MAX_HANDOFF_NOTE_BYTES);
  return [...values];
}

function isSensitivePath(inputPath: string): boolean {
  const normalized = normalizeContextPath(inputPath);
  const segments = normalized.toLowerCase().split("/");
  const basename = segments.at(-1)!;
  if (segments.some((segment) => SENSITIVE_DIRECTORIES.has(segment))) return true;
  if (SENSITIVE_FILENAMES.has(basename)) return true;
  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) return true;
  if ([".key", ".p12", ".pfx", ".pem"].some((extension) => basename.endsWith(extension))) return true;
  return false;
}

function normalizeSafePath(inputPath: string): string {
  const normalized = normalizeContextPath(inputPath);
  if (isSensitivePath(normalized)) throw new Error(`Context handoff access to sensitive path ${normalized} is denied.`);
  return normalized;
}

function validateReferenceShape(reference: ContextHandoffReference): ContextHandoffReference {
  const normalizedPath = normalizeSafePath(reference.path);
  if (!/^ctx_[a-f0-9]{32}$/.test(reference.handle)) throw new Error("Context handoff reference handle is malformed.");
  if (!/^[a-f0-9]{64}$/.test(reference.sourceSha256) || !/^[a-f0-9]{64}$/.test(reference.excerptSha256)) {
    throw new Error("Context handoff reference hashes must be lowercase SHA-256 values.");
  }
  if (!Number.isInteger(reference.startLine) || !Number.isInteger(reference.endLine) || reference.startLine < 1 || reference.endLine < reference.startLine) {
    throw new Error("Context handoff reference line bounds are invalid.");
  }
  return {
    handle: reference.handle,
    path: normalizedPath,
    startLine: reference.startLine,
    endLine: reference.endLine,
    sourceSha256: reference.sourceSha256,
    excerptSha256: reference.excerptSha256,
  };
}

function normalizeTests(tests: ContextHandoffTest[]): ContextHandoffTest[] {
  if (tests.length > MAX_HANDOFF_TESTS) throw new Error(`Context handoff tests exceed the ${MAX_HANDOFF_TESTS} item safety limit.`);
  return tests.map((test) => {
    assertBoundedText("Context handoff test label", test.label, MAX_HANDOFF_TEST_LABEL_BYTES);
    if (!TEST_STATUSES.has(test.status)) throw new Error("Context handoff test status is invalid.");
    if (test.evidence !== undefined) assertBoundedText("Context handoff test evidence", test.evidence, MAX_HANDOFF_TEST_EVIDENCE_BYTES);
    return { label: test.label, status: test.status, ...(test.evidence === undefined ? {} : { evidence: test.evidence }) };
  });
}

async function sourceIdentity(inputPath: string): Promise<ContextHandoffSourceIdentity> {
  const normalizedPath = normalizeSafePath(inputPath);
  const { text } = await readWorkspaceText(normalizedPath);
  return {
    path: normalizedPath,
    sourceSha256: sha256Text(text),
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

function handoffIdentityDocument(handoff: Omit<ContextHandoff, "handoffId">): string {
  return JSON.stringify(handoff);
}

function handoffIdFor(handoff: Omit<ContextHandoff, "handoffId">): string {
  return `sch_${sha256Text(handoffIdentityDocument(handoff)).slice(0, 32)}`;
}

function assertDocumentBounded(handoff: ContextHandoff): void {
  const bytes = Buffer.byteLength(JSON.stringify(handoff), "utf8");
  if (bytes > MAX_HANDOFF_DOCUMENT_BYTES) {
    throw new Error(`Context handoff exceeds the ${MAX_HANDOFF_DOCUMENT_BYTES} byte safety limit.`);
  }
}

export async function createContextHandoff(input: CreateContextHandoffInput): Promise<ContextHandoff> {
  if (!AGENTS.has(input.fromAgent)) throw new Error("Context handoff source agent is invalid.");
  const toAgent = input.toAgent ?? "any";
  if (!TARGETS.has(toAgent)) throw new Error("Context handoff target agent is invalid.");
  assertBoundedText("Context handoff goal", input.goal, MAX_HANDOFF_GOAL_BYTES);

  const decisions = assertBoundedList("Context handoff decisions", input.decisions ?? [], MAX_HANDOFF_DECISIONS);
  const unresolvedQuestions = assertBoundedList("Context handoff unresolved questions", input.unresolvedQuestions ?? [], MAX_HANDOFF_QUESTIONS);
  const changedPaths = input.changedPaths ?? [];
  if (changedPaths.length > MAX_HANDOFF_CHANGED_PATHS) {
    throw new Error(`Context handoff changed paths exceed the ${MAX_HANDOFF_CHANGED_PATHS} path safety limit.`);
  }
  const normalizedChangedPaths = [...new Set(changedPaths.map(normalizeSafePath))].sort(compareText);
  const changedSources: ContextHandoffSourceIdentity[] = [];
  for (const changedPath of normalizedChangedPaths) changedSources.push(await sourceIdentity(changedPath));

  const contextInput = input.context ?? [];
  if (contextInput.length > MAX_HANDOFF_CONTEXT_REFERENCES) {
    throw new Error(`Context handoff references exceed the ${MAX_HANDOFF_CONTEXT_REFERENCES} item safety limit.`);
  }
  const context = contextInput.map(validateReferenceShape).sort((left, right) =>
    compareText(left.path, right.path)
      || left.startLine - right.startLine
      || left.endLine - right.endLine
      || compareText(left.handle, right.handle));
  for (const reference of context) await retrieveWorkspaceContext(reference);

  const withoutId: Omit<ContextHandoff, "handoffId"> = {
    schema: CONTEXT_HANDOFF_SCHEMA,
    fromAgent: input.fromAgent,
    toAgent,
    goal: input.goal,
    decisions,
    unresolvedQuestions,
    changedSources,
    tests: normalizeTests(input.tests ?? []),
    context,
    freshness: {
      mode: "content-addressed",
      changedSourcesVerifiedAtCreation: true,
      contextReferencesVerifiedAtCreation: true,
    },
  };
  const handoff: ContextHandoff = { ...withoutId, handoffId: handoffIdFor(withoutId) };
  assertDocumentBounded(handoff);
  return handoff;
}

function canonicalExistingHandoff(handoff: ContextHandoff): Omit<ContextHandoff, "handoffId"> {
  if (handoff.schema !== CONTEXT_HANDOFF_SCHEMA) throw new Error("Unsupported context handoff schema.");
  if (!AGENTS.has(handoff.fromAgent) || !TARGETS.has(handoff.toAgent)) throw new Error("Context handoff agent identity is invalid.");
  assertBoundedText("Context handoff goal", handoff.goal, MAX_HANDOFF_GOAL_BYTES);
  assertBoundedList("Context handoff decisions", handoff.decisions, MAX_HANDOFF_DECISIONS);
  assertBoundedList("Context handoff unresolved questions", handoff.unresolvedQuestions, MAX_HANDOFF_QUESTIONS);
  if (handoff.changedSources.length > MAX_HANDOFF_CHANGED_PATHS) throw new Error("Context handoff changed-source limit exceeded.");
  if (handoff.context.length > MAX_HANDOFF_CONTEXT_REFERENCES) throw new Error("Context handoff reference limit exceeded.");
  normalizeTests(handoff.tests);
  for (const source of handoff.changedSources) {
    source.path = normalizeSafePath(source.path);
    if (!/^[a-f0-9]{64}$/.test(source.sourceSha256) || !Number.isInteger(source.bytes) || source.bytes < 1) {
      throw new Error("Context handoff changed-source identity is invalid.");
    }
  }
  for (let index = 0; index < handoff.context.length; index += 1) handoff.context[index] = validateReferenceShape(handoff.context[index]!);
  if (handoff.freshness?.mode !== "content-addressed" || handoff.freshness.changedSourcesVerifiedAtCreation !== true || handoff.freshness.contextReferencesVerifiedAtCreation !== true) {
    throw new Error("Context handoff freshness contract is invalid.");
  }
  const { handoffId: _handoffId, ...withoutId } = handoff;
  return withoutId;
}

export async function validateContextHandoff(handoff: ContextHandoff): Promise<ContextHandoffValidation> {
  assertDocumentBounded(handoff);
  const withoutId = canonicalExistingHandoff(structuredClone(handoff));
  const integrityValid = /^sch_[a-f0-9]{32}$/.test(handoff.handoffId) && handoffIdFor(withoutId) === handoff.handoffId;
  const staleChangedSources: Array<{ path: string; reason: string }> = [];
  const staleContextReferences: Array<{ handle: string; path: string; reason: string }> = [];

  for (const source of withoutId.changedSources) {
    try {
      const current = await sourceIdentity(source.path);
      if (current.sourceSha256 !== source.sourceSha256 || current.bytes !== source.bytes) {
        staleChangedSources.push({ path: source.path, reason: "source identity changed" });
      }
    } catch {
      staleChangedSources.push({ path: source.path, reason: "source is missing, inaccessible, or no longer eligible" });
    }
  }

  for (const reference of withoutId.context) {
    try {
      await retrieveWorkspaceContext(reference);
    } catch {
      staleContextReferences.push({ handle: reference.handle, path: reference.path, reason: "context source or excerpt identity changed" });
    }
  }

  const contentFresh = staleChangedSources.length === 0 && staleContextReferences.length === 0;
  return {
    schema: CONTEXT_HANDOFF_VALIDATION_SCHEMA,
    handoffId: handoff.handoffId,
    integrityValid,
    contentFresh,
    valid: integrityValid && contentFresh,
    staleChangedSources,
    staleContextReferences,
    caveat: "The handoff ID is a deterministic integrity checksum, not an authentication signature. Trust still depends on the source of the handoff.",
  };
}
