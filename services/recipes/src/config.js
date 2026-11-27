// Per-repo recipe config — .github/solvelang-recipes.json, read at
// the PR base SHA exactly like the verification config (a PR cannot
// weaken its own recipes), versioned {version: 1, recipes: {...}}.
//
// Failure discipline (mirrors parseVerificationConfig, with one
// strengthening the owner ordered for recipes): an invalid or
// unparseable file yields the safe defaults — ALL recipes off — PLUS
// a visible note that the runner carries into the run record and the
// graded receipt. An enabled recipe is never silently downgraded to
// a no-op: if the file is broken, every run record for that repo
// says so, in words.

import { defaultRegistry } from "./registry.js";

export const RECIPES_CONFIG_PATH = ".github/solvelang-recipes.json";

export const DEFAULT_RECIPES_CONFIG = Object.freeze({ version: 1, recipes: {} });

export const INVALID_CONFIG_NOTE =
  "Note: `.github/solvelang-recipes.json` at the base SHA is invalid — safe defaults were applied (all recipes off). Fix the file to enable recipes; this note appears in every run record until it is fixed.";

const CADENCES = new Set(["hourly", "daily", "nightly", "weekly"]);
// A 5-field cron expression is also accepted as a cadence string;
// the scheduler treats it as an opaque cadence label in Stage 0 and
// the firing interval falls back to daily (see scheduler.js).
const CRON_LIKE = /^[\d*,/-]+( [\d*,/-]+){4}$/;

function invalidResult(present) {
  return {
    config: { version: 1, recipes: {} },
    invalid: true,
    present,
    note: INVALID_CONFIG_NOTE,
  };
}

// Parses the config text. `registry` decides which recipe ids exist;
// an unknown id is a defect (a typo must not silently enable or
// disable anything). Each entry: {enabled: boolean, cadence?,
// trigger?, options?} — enabled is required and must be a boolean,
// cadence must be a known cadence or a 5-field cron string, trigger
// must be one of the recipe's own trigger classes, options must be a
// plain object.
export function parseRecipesConfig(text, registry = defaultRegistry) {
  if (text === null || text === undefined) {
    return {
      config: { version: 1, recipes: {} },
      invalid: false,
      present: false,
      note: null,
    };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalidResult(true);
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    raw.version !== 1 ||
    !raw.recipes ||
    typeof raw.recipes !== "object" ||
    Array.isArray(raw.recipes)
  ) {
    return invalidResult(true);
  }
  const recipes = {};
  for (const [id, entry] of Object.entries(raw.recipes)) {
    const definition = registry.get(id);
    if (!definition) return invalidResult(true);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return invalidResult(true);
    }
    if (typeof entry.enabled !== "boolean") return invalidResult(true);
    const parsed = { enabled: entry.enabled };
    if (entry.cadence !== undefined) {
      if (
        typeof entry.cadence !== "string" ||
        (!CADENCES.has(entry.cadence) && !CRON_LIKE.test(entry.cadence))
      ) {
        return invalidResult(true);
      }
      parsed.cadence = entry.cadence;
    }
    if (entry.trigger !== undefined) {
      if (
        typeof entry.trigger !== "string" ||
        !definition.triggerClasses.includes(entry.trigger)
      ) {
        return invalidResult(true);
      }
      parsed.trigger = entry.trigger;
    }
    if (entry.options !== undefined) {
      if (!entry.options || typeof entry.options !== "object" || Array.isArray(entry.options)) {
        return invalidResult(true);
      }
      parsed.options = { ...entry.options };
    }
    recipes[id] = parsed;
  }
  return { config: { version: 1, recipes }, invalid: false, present: true, note: null };
}

// The enabled entries of a parsed config, in config order, each
// joined with its registry definition.
export function enabledRecipes(config, registry = defaultRegistry) {
  const enabled = [];
  for (const [id, entry] of Object.entries(config?.recipes ?? {})) {
    if (entry?.enabled === true) {
      const definition = registry.get(id);
      if (definition) enabled.push({ definition, entry });
    }
  }
  return enabled;
}

export function recipeEntry(config, id) {
  return config?.recipes?.[id] ?? null;
}
