const INPUT_TOKENS_PER_CREDIT = 5_000;
const OUTPUT_TOKENS_PER_CREDIT = 1_000;
export const MAX_OUTPUT_TOKENS_PER_CALL = 1_000;

function boundedInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function calculateCreditCharge({
  inputTokens = 0,
  outputTokens = 0,
  minimumCredits = 1,
  priority = "standard",
} = {}) {
  if (priority !== "standard") throw new Error("Paid processing priority is not enabled.");
  const safeInputTokens = boundedInteger(inputTokens, "Input token count", 10_000_000);
  const safeOutputTokens = boundedInteger(outputTokens, "Output token count", MAX_OUTPUT_TOKENS_PER_CALL);
  const safeMinimumCredits = boundedInteger(minimumCredits, "Minimum credits", 100_000);
  if (safeMinimumCredits < 1) throw new Error("Minimum credits is invalid.");

  const inputCredits = Math.ceil(safeInputTokens / INPUT_TOKENS_PER_CREDIT);
  const outputCredits = Math.ceil(safeOutputTokens / OUTPUT_TOKENS_PER_CREDIT);
  const chargedCredits = Math.max(safeMinimumCredits, inputCredits, outputCredits, 1);

  if (!Number.isSafeInteger(chargedCredits) || chargedCredits > 1_000_000) {
    throw new Error("Credit charge is too large.");
  }

  return {
    inputTokens: safeInputTokens,
    outputTokens: safeOutputTokens,
    inputCredits,
    outputCredits,
    chargedCredits,
  };
}

export const CREDIT_POLICY = Object.freeze({
  inputTokensPerCredit: INPUT_TOKENS_PER_CREDIT,
  outputTokensPerCredit: OUTPUT_TOKENS_PER_CREDIT,
  maxOutputTokensPerCall: MAX_OUTPUT_TOKENS_PER_CALL,
  paidPriorityEnabled: false,
});