// Recipes runner — orchestration only, every effectful dependency
// injected (config reading at a SHA, recipe execution, audit
// posting), so the whole loop is unit-testable with fakes and the
// production wiring lives in server.js. Mirrors the verification
// runner's shape.
//
// One run, end to end:
//   1. resolve the recipe in the registry (unknown => error record);
//   2. read .github/solvelang-recipes.json at the BASE sha via the
//      injected reader (a PR cannot weaken its own recipes) and
//      parse it — an invalid file means all recipes off PLUS the
//      visible note in the record and receipt;
//   3. if the recipe is not enabled for this repo, record a SKIPPED
//      run with an unverified finding saying so — never a silent
//      no-op, never a success;
//   4. if enabled, run the injected executor; its findings are graded
//      by the receipt layer (verified only with evidence);
//   5. build the run record + graded receipt (metering = duration +
//      executor identity class, cost visibility only) and append the
//      audit entry through MGOV; auditOk rides on the record.
// Executor failures produce an ERROR record with the sanitized error
// class only — no executor detail leaks into records or receipts.

import { randomUUID } from "node:crypto";

import { RECIPES_CONFIG_PATH, parseRecipesConfig, recipeEntry } from "./config.js";
import { buildRunRecord } from "./receipt.js";

export function createRecipesRunner(deps) {
  const {
    registry,
    readConfigTextAtRef,
    executeRecipe,
    postAudit,
    now = () => Date.now(),
    createId = () => randomUUID(),
    log = () => {},
  } = deps;

  async function runRecipe({
    repo,
    recipeId,
    trigger,
    baseSha = null,
    headSha = null,
    prNumber = null,
    installationId = null,
    options = undefined,
  }) {
    const startedAt = now();
    const id = createId();
    const definition = registry.get(recipeId);
    const finish = async ({ conclusion, findings, notes, executor }) => {
      const { record, receipt } = buildRunRecord({
        id,
        repo,
        recipeId,
        trigger,
        conclusion,
        findings,
        notes,
        baseSha,
        headSha,
        prNumber,
        installationId,
        startedAt,
        finishedAt: now(),
        executor,
      });
      const audit = await postAudit(record).catch(() => null);
      record.auditOk = Boolean(audit?.ok);
      return { record, receipt };
    };

    if (!definition) {
      return finish({
        conclusion: "error",
        findings: [{ label: "unverified", text: `Unknown recipe id: ${recipeId}.` }],
        notes: [],
        executor: null,
      });
    }

    let parsed;
    try {
      const configText = baseSha
        ? await readConfigTextAtRef({ repo, path: RECIPES_CONFIG_PATH, ref: baseSha })
        : null;
      parsed = parseRecipesConfig(configText, registry);
    } catch (err) {
      log("recipes_config_read_failed", `${repo} ${err?.name || "Error"}`);
      return finish({
        conclusion: "error",
        findings: [
          { label: "unverified", text: "Recipe config could not be read at the base SHA." },
        ],
        notes: [],
        executor: definition.identityClass,
      });
    }

    const notes = parsed.note ? [parsed.note] : [];
    const entry = recipeEntry(parsed.config, recipeId);
    if (!entry || entry.enabled !== true) {
      return finish({
        conclusion: "skipped",
        findings: [
          {
            label: "unverified",
            text: parsed.invalid
              ? "Recipe not run: the repo's recipe config is invalid, so all recipes are off (safe defaults)."
              : "Recipe not run: it is not enabled in the repo's .github/solvelang-recipes.json at the base SHA.",
          },
        ],
        notes,
        executor: definition.identityClass,
      });
    }

    try {
      const outcome = await executeRecipe({
        definition,
        repo,
        trigger,
        baseSha,
        headSha,
        prNumber,
        installationId,
        options: options ?? entry.options ?? {},
        configEntry: entry,
      });
      return finish({
        conclusion: outcome?.conclusion ?? "success",
        findings: outcome?.findings ?? [],
        notes,
        executor: definition.identityClass,
      });
    } catch (err) {
      log("recipes_run_failed", `${repo} ${recipeId} ${err?.name || "Error"}`);
      return finish({
        conclusion: "error",
        findings: [
          {
            label: "unverified",
            text: `Recipe execution failed (${err?.name || "Error"}). No evidence is claimed for this run.`,
          },
        ],
        notes,
        executor: definition.identityClass,
      });
    }
  }

  return { runRecipe };
}
