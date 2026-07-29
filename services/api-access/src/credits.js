const INPUT_TOKENS_PER_CREDIT = 5_000;
const OUTPUT_TOKENS_PER_CREDIT = 1_000;
export const MAX_OUTPUT_TOKENS_PER_CALL = 1_000;

export const PROCESSING_PRIORITIES = Object.freeze({
  standard: Object.freeze({ name: "standard", creditMultiplier: 1, queueWeight: 1, label: "Standard" }),
  express: Object.freeze({ name: "express", creditMultiplier: 2, queueWeight: 2, label: "Express" }),
  priority: Object.freeze({ name: "priority", creditMultiplier: 5, queueWeight: 5, label: "Priority" }),
  critical: Object.freeze({ name: "critical", creditMultiplier: 10, queueWeight: 10, label: "Critical" }),
});

function boundedInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function getProcessingPriority(name = "standard") {
  const priority = PROCESSING_PRIORITIES[name];
  if (!priority) throw new Error("Processing priority is invalid.");
  return priority;
}

export function calculateCreditCharge({
  inputTokens = 0,
  outputTokens = 0,
  priority = "standard",
  minimumCredits = 1,
} = {}) {
  const safeInputTokens = boundedInteger(inputTokens, "Input token count", 10_000_000);
  const safeOutputTokens = boundedInteger(outputTokens, "Output token count", 1_000_000);
  const safeMinimumCredits = boundedInteger(minimumCredits, "Minimum credits", 100_000);
  if (safeMinimumCredits < 1) throw new Error("Minimum credits is invalid.");

  const selectedPriority = getProcessingPriority(priority);
  const inputCredits = Math.ceil(safeInputTokens / INPUT_TOKENS_PER_CREDIT);
  const outputCredits = Math.ceil(safeOutputTokens / OUTPUT_TOKENS_PER_CREDIT);
  const baseCredits = Math.max(safeMinimumCredits, inputCredits, outputCredits, 1);
  const chargedCredits = baseCredits * selectedPriority.creditMultiplier;

  if (!Number.isSafeInteger(chargedCredits) || chargedCredits > 1_000_000) {
    throw new Error("Credit charge is too large.");
  }

  return {
    inputTokens: safeInputTokens,
    outputTokens: safeOutputTokens,
    inputCredits,
    outputCredits,
    baseCredits,
    priority: selectedPriority.name,
    priorityLabel: selectedPriority.label,
    priorityMultiplier: selectedPriority.creditMultiplier,
    queueWeight: selectedPriority.queueWeight,
    chargedCredits,
  };
}

export const CREDIT_POLICY = Object.freeze({
  inputTokensPerCredit: INPUT_TOKENS_PER_CREDIT,
  outputTokensPerCredit: OUTPUT_TOKENS_PER_CREDIT,
  maxOutputTokensPerCall: MAX_OUTPUT_TOKENS_PER_CALL,
});
