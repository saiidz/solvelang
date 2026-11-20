import { validateContextAgentEvalRecord } from "../dist/src/context-agent-eval.js";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;

async function readBoundedStdin() {
  if (process.stdin.isTTY) {
    throw new Error("Provide a JSON array of agent-eval records on stdin.");
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_INPUT_BYTES) throw new Error(`Agent eval input exceeds ${MAX_INPUT_BYTES} bytes.`);
    chunks.push(buffer);
  }
  if (bytes === 0) throw new Error("Agent eval input is empty.");
  return Buffer.concat(chunks).toString("utf8");
}

export function validateAgentEvalRecords(values) {
  if (!Array.isArray(values)) throw new Error("Agent eval input must be a JSON array.");
  const records = [];
  const seenHashes = new Map();
  const pairGroups = new Map();

  values.forEach((value, index) => {
    let identity;
    try {
      identity = validateContextAgentEvalRecord(value);
    } catch (error) {
      records.push({ index, valid: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (seenHashes.has(identity.recordSha256)) {
      records.push({
        index,
        valid: false,
        error: `Duplicate agent eval record ${identity.recordSha256} (first seen at index ${seenHashes.get(identity.recordSha256)}).`,
        recordSha256: identity.recordSha256,
      });
      return;
    }
    seenHashes.set(identity.recordSha256, index);
    records.push({
      index,
      valid: true,
      recordSha256: identity.recordSha256,
      suiteId: identity.suiteId,
      pairId: identity.pairId,
      agent: identity.agent,
      variant: identity.variant,
      recordClass: identity.recordClass,
    });
    const key = `${identity.suiteId}:${identity.pairId}`;
    const group = pairGroups.get(key) ?? { baseline: false, solveContext: false };
    if (identity.variant === "baseline") group.baseline = true;
    else group.solveContext = true;
    pairGroups.set(key, group);
  });

  const completePairs = [];
  const incompletePairs = [];
  for (const [key, group] of [...pairGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (group.baseline && group.solveContext) completePairs.push(key);
    else incompletePairs.push({ pair: key, hasBaseline: group.baseline, hasSolveContext: group.solveContext });
  }

  const validCount = records.filter((record) => record.valid).length;
  return {
    schema: "solvelang.context.agent-eval-validation.v1",
    truth: {
      providerRequestsPerformedByHarness: 0,
      credentialsUsedByHarness: false,
      recordsMutatedByValidator: false,
    },
    recordCount: records.length,
    validCount,
    invalidCount: records.length - validCount,
    allValid: validCount === records.length,
    records,
    pairs: { complete: completePairs, incomplete: incompletePairs },
  };
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error("Agent eval record validator accepts no file, URL, or credential arguments.");
  }
  const input = JSON.parse(await readBoundedStdin());
  const result = validateAgentEvalRecords(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.allValid) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("validate-context-agent-evals.mjs")) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`context-agent-eval-validate: ${message}\n`);
    process.exitCode = 1;
  });
}
