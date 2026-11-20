// SolveLang PR Gate — policy loading and evaluation.
//
// The policy file is versioned JSON (see the package README for the full
// format). Every rule is grounded in output the existing engines compute:
//   - protectedPaths:          evaluated against the PR's changed-file list.
//   - maxImpactNodes:          the blast-radius size produced by
//                              analyzeSolveGraphImpact (site solve-graph core).
//   - requireAffectedValidations: the affected validations inside the impact
//                              set — validation-kind graph nodes from
//                              createAffectedValidationCandidates plus
//                              impacted files the repository inventory
//                              classifier (classifyRepositoryFile) marks as
//                              tests.
// An override label named by a rule (or the policy-wide overrideLabel) turns
// a failing rule into "overridden": still reported loudly, never failing.

import { readFile } from "node:fs/promises";

export type PrGatePolicy = {
  version: 1;
  overrideLabel?: string;
  protectedPaths?: { glob: string; overrideLabel?: string }[];
  maxImpactNodes?: number;
  requireAffectedValidations?: boolean;
};

export type PolicyRuleId = "protected-paths" | "blast-radius-ceiling" | "affected-validations";

export type PolicyVerdict = {
  rule: PolicyRuleId;
  status: "pass" | "fail" | "overridden" | "skipped";
  detail: string;
  overrideLabel?: string;
};

export type PolicyEvaluation = {
  verdicts: PolicyVerdict[];
  passed: boolean;
};

export type PolicyEvaluationInput = {
  changedPaths: readonly string[];
  impactNodeCount: number;
  affectedValidationPaths: readonly string[];
  labels: readonly string[];
};

const POLICY_KEYS = new Set(["version", "overrideLabel", "protectedPaths", "maxImpactNodes", "requireAffectedValidations"]);

function fail(message: string): never {
  throw new Error(`pr-gate policy: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalLabel(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") fail(`${field} must be a non-empty string when present.`);
  return value;
}

export function parsePolicy(text: string): PrGatePolicy {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("file is not valid JSON.");
  }
  if (!isPlainObject(raw)) fail("top level must be a JSON object.");
  for (const key of Object.keys(raw)) {
    if (!POLICY_KEYS.has(key)) fail(`unknown key "${key}". Allowed keys: ${[...POLICY_KEYS].join(", ")}.`);
  }
  if (raw.version !== 1) fail(`version must be 1 (got ${JSON.stringify(raw.version)}).`);
  const policy: PrGatePolicy = { version: 1 };
  const policyOverrideLabel = optionalLabel(raw.overrideLabel, "overrideLabel");
  if (policyOverrideLabel !== undefined) policy.overrideLabel = policyOverrideLabel;
  if (raw.protectedPaths !== undefined) {
    if (!Array.isArray(raw.protectedPaths)) fail("protectedPaths must be an array.");
    policy.protectedPaths = raw.protectedPaths.map((entry, index) => {
      if (!isPlainObject(entry)) fail(`protectedPaths[${index}] must be an object.`);
      for (const key of Object.keys(entry)) {
        if (key !== "glob" && key !== "overrideLabel") fail(`protectedPaths[${index}] has unknown key "${key}".`);
      }
      if (typeof entry.glob !== "string" || entry.glob.trim() === "") fail(`protectedPaths[${index}].glob must be a non-empty string.`);
      const entryLabel = optionalLabel(entry.overrideLabel, `protectedPaths[${index}].overrideLabel`);
      return entryLabel !== undefined ? { glob: entry.glob, overrideLabel: entryLabel } : { glob: entry.glob };
    });
  }
  if (raw.maxImpactNodes !== undefined) {
    if (!Number.isSafeInteger(raw.maxImpactNodes) || (raw.maxImpactNodes as number) < 0) {
      fail("maxImpactNodes must be a non-negative integer.");
    }
    policy.maxImpactNodes = raw.maxImpactNodes as number;
  }
  if (raw.requireAffectedValidations !== undefined) {
    if (typeof raw.requireAffectedValidations !== "boolean") fail("requireAffectedValidations must be a boolean.");
    policy.requireAffectedValidations = raw.requireAffectedValidations;
  }
  return policy;
}

export async function loadPolicyFile(path: string): Promise<PrGatePolicy> {
  return parsePolicy(await readFile(path, "utf8"));
}

// --- Glob matching ---------------------------------------------------------
// Supported syntax (deliberately small, documented in the README):
//   **  matches zero or more whole path segments
//   *   matches any run of characters within one segment
//   ?   matches one character within one segment
// Everything else is literal. Paths are matched in POSIX form.

function segmentToRegExp(segment: string): RegExp {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

export function matchGlob(glob: string, path: string): boolean {
  const globSegments = glob.split("/").filter((segment) => segment !== "");
  const pathSegments = path.split("/").filter((segment) => segment !== "");
  const matchers = globSegments.map((segment) => (segment === "**" ? null : segmentToRegExp(segment)));
  const walk = (gi: number, pi: number): boolean => {
    if (gi === matchers.length) return pi === pathSegments.length;
    const matcher = matchers[gi];
    if (matcher === null) {
      for (let next = pi; next <= pathSegments.length; next += 1) {
        if (walk(gi + 1, next)) return true;
      }
      return false;
    }
    if (pi >= pathSegments.length) return false;
    return matcher.test(pathSegments[pi]) && walk(gi + 1, pi + 1);
  };
  return walk(0, 0);
}

// --- Evaluation ------------------------------------------------------------

export function evaluatePolicy(policy: PrGatePolicy, input: PolicyEvaluationInput): PolicyEvaluation {
  const labels = new Set(input.labels);
  const verdicts: PolicyVerdict[] = [];

  // Rule 1: protected paths.
  if (!policy.protectedPaths || policy.protectedPaths.length === 0) {
    verdicts.push({ rule: "protected-paths", status: "skipped", detail: "No protected paths configured." });
  } else {
    const violations: string[] = [];
    const overriddenPaths: string[] = [];
    let appliedOverride: string | undefined;
    for (const entry of policy.protectedPaths) {
      const hits = input.changedPaths.filter((changed) => matchGlob(entry.glob, changed));
      if (hits.length === 0) continue;
      const label = entry.overrideLabel ?? policy.overrideLabel;
      if (label && labels.has(label)) {
        overriddenPaths.push(...hits);
        appliedOverride = label;
      } else {
        violations.push(...hits);
      }
    }
    if (violations.length > 0) {
      verdicts.push({
        rule: "protected-paths",
        status: "fail",
        detail: `Changed protected path(s): ${[...new Set(violations)].sort().join(", ")}.`,
      });
    } else if (overriddenPaths.length > 0) {
      verdicts.push({
        rule: "protected-paths",
        status: "overridden",
        detail: `Protected path(s) changed under override label "${appliedOverride}": ${[...new Set(overriddenPaths)].sort().join(", ")}.`,
        overrideLabel: appliedOverride,
      });
    } else {
      verdicts.push({ rule: "protected-paths", status: "pass", detail: "No protected paths changed." });
    }
  }

  // Rule 2: blast-radius ceiling.
  if (policy.maxImpactNodes === undefined) {
    verdicts.push({ rule: "blast-radius-ceiling", status: "skipped", detail: "No blast-radius ceiling configured." });
  } else if (input.impactNodeCount <= policy.maxImpactNodes) {
    verdicts.push({
      rule: "blast-radius-ceiling",
      status: "pass",
      detail: `Blast radius is ${input.impactNodeCount} impacted node(s), within the ceiling of ${policy.maxImpactNodes}.`,
    });
  } else if (policy.overrideLabel && labels.has(policy.overrideLabel)) {
    verdicts.push({
      rule: "blast-radius-ceiling",
      status: "overridden",
      detail: `Blast radius is ${input.impactNodeCount} impacted node(s), above the ceiling of ${policy.maxImpactNodes}, allowed by override label "${policy.overrideLabel}".`,
      overrideLabel: policy.overrideLabel,
    });
  } else {
    verdicts.push({
      rule: "blast-radius-ceiling",
      status: "fail",
      detail: `Blast radius is ${input.impactNodeCount} impacted node(s), above the ceiling of ${policy.maxImpactNodes}.`,
    });
  }

  // Rule 3: affected validations must be touched when the impact set has any.
  if (policy.requireAffectedValidations !== true) {
    verdicts.push({ rule: "affected-validations", status: "skipped", detail: "Affected-validations rule not enabled." });
  } else if (input.affectedValidationPaths.length === 0) {
    verdicts.push({ rule: "affected-validations", status: "pass", detail: "The impact set contains no validation nodes." });
  } else {
    const changed = new Set(input.changedPaths);
    const touched = input.affectedValidationPaths.filter((candidate) => changed.has(candidate));
    if (touched.length > 0) {
      verdicts.push({
        rule: "affected-validations",
        status: "pass",
        detail: `Impact set includes validation(s) and the PR touches at least one: ${touched.sort().join(", ")}.`,
      });
    } else if (policy.overrideLabel && labels.has(policy.overrideLabel)) {
      verdicts.push({
        rule: "affected-validations",
        status: "overridden",
        detail: `Impact set includes validation(s) the PR does not touch (${[...input.affectedValidationPaths].sort().join(", ")}), allowed by override label "${policy.overrideLabel}".`,
        overrideLabel: policy.overrideLabel,
      });
    } else {
      verdicts.push({
        rule: "affected-validations",
        status: "fail",
        detail: `Impact set includes validation(s) the PR does not touch: ${[...input.affectedValidationPaths].sort().join(", ")}. Touch at least one, or apply the override label.`,
      });
    }
  }

  return { verdicts, passed: verdicts.every((verdict) => verdict.status !== "fail") };
}
