// Recipe catalog (Stage 0, packaging layer) — the account page's
// pure shaping layer, in the same style as the other account core
// modules: no fetch, no window, so the QA suite can pin the shapes
// directly.
//
// CLAIMS DISCIPLINE (standing rule: a release behind in claims,
// never a claim ahead of evidence): a recipe renders as available
// ONLY when its proven flag is true. Every program recipe starts
// unproven — its executor is a later stage — so in Stage 0 every
// recipe renders as not yet available, whatever any payload says
// about enabled/configured state. Enabled/configured describe the
// repo's .github/solvelang-recipes.json; they never upgrade
// availability.

export const RECIPES_EYEBROW = "Recipes";
export const RECIPES_TITLE = "Recipe catalog";
export const RECIPES_INTRO =
  "Recipes are named, scheduled jobs you switch on per repository in .github/solvelang-recipes.json. A recipe is listed as available only after it has been proven by a real run with a graded receipt — until then it is shown as not yet available, even if your config already enables it.";
export const RECIPES_EMPTY_LINE =
  "No recipe configuration was found for your repositories yet. Add .github/solvelang-recipes.json to a repository to configure recipes; they become available only after they are proven.";
export const RECIPES_NOT_AVAILABLE_LABEL = "Not yet available";
export const RECIPES_AVAILABLE_LABEL = "Available";
export const RECIPES_ENABLED_LABEL = "Enabled in repo config";
export const RECIPES_DISABLED_LABEL = "Not enabled in repo config";
export const RECIPES_CONFIGURED_LABEL = "Configured in repo config";
export const RECIPES_UNCONFIGURED_LABEL = "Not configured";

export type RecipeTriggerClass = "pull_request" | "schedule" | "manual";
export type RecipeIdentityClass = "verification-app" | "process-solution-app" | "scan";

export type RecipeCatalogEntry = {
  id: string;
  title: string;
  triggerClasses: RecipeTriggerClass[];
  identityClass: RecipeIdentityClass;
  proven: boolean;
  internal?: boolean;
};

// Mirrors services/recipes/src/registry.js — the QA pins keep the
// two in step on ids, classes, and the proven flags.
export const RECIPE_CATALOG: RecipeCatalogEntry[] = [
  { id: "license-headers", title: "License headers", triggerClasses: ["schedule", "manual"], identityClass: "process-solution-app", proven: false },
  { id: "import-organization", title: "Import organization", triggerClasses: ["schedule", "manual"], identityClass: "process-solution-app", proven: false },
  { id: "lint-autofix", title: "Lint autofix", triggerClasses: ["schedule", "manual"], identityClass: "process-solution-app", proven: false },
  { id: "error-message-refactors", title: "Error message refactors", triggerClasses: ["schedule", "manual"], identityClass: "process-solution-app", proven: false },
  { id: "matrix-monorepo-analysis", title: "Matrix monorepo analysis", triggerClasses: ["pull_request", "manual"], identityClass: "verification-app", proven: false },
  { id: "dependency-secret-scanner", title: "Dependency + secret scanner", triggerClasses: ["schedule", "manual"], identityClass: "scan", proven: false },
  { id: "code-review", title: "Code review", triggerClasses: ["pull_request", "manual"], identityClass: "verification-app", proven: false },
  { id: "security-review", title: "Security review", triggerClasses: ["pull_request", "schedule", "manual"], identityClass: "verification-app", proven: false },
];

export type RecipeRepoState = {
  recipeId: string;
  configured: boolean;
  enabled: boolean;
};

export type RecipeDisplayState = {
  entry: RecipeCatalogEntry;
  available: boolean;
  availabilityLabel: string;
  configured: boolean;
  enabled: boolean;
  configLabel: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Normalizes a per-repo recipe-state payload of the shape
//   { recipes: [ { id, configured, enabled } ] }
// (unknown ids and malformed entries are dropped, never invented).
export function parseRecipeRepoStates(value: unknown): RecipeRepoState[] {
  if (!isRecord(value) || !Array.isArray(value.recipes)) return [];
  const known = new Set(RECIPE_CATALOG.map((entry) => entry.id));
  const states: RecipeRepoState[] = [];
  for (const raw of value.recipes) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !known.has(raw.id)) continue;
    states.push({
      recipeId: raw.id,
      configured: raw.configured === true,
      enabled: raw.enabled === true,
    });
  }
  return states;
}

// The display state for every catalog recipe against one repo's
// states. THE claims rule lives here: available === proven, full
// stop — enabled/configured can never make an unproven recipe
// available. Internal entries never display at all.
export function recipeDisplayStates(states: RecipeRepoState[]): RecipeDisplayState[] {
  const byId = new Map(states.map((state) => [state.recipeId, state]));
  return RECIPE_CATALOG.filter((entry) => !entry.internal).map((entry) => {
    const state = byId.get(entry.id);
    const configured = state?.configured === true;
    const enabled = state?.enabled === true;
    const available = entry.proven === true;
    return {
      entry,
      available,
      availabilityLabel: available ? RECIPES_AVAILABLE_LABEL : RECIPES_NOT_AVAILABLE_LABEL,
      configured,
      enabled,
      configLabel: enabled
        ? RECIPES_ENABLED_LABEL
        : configured
          ? RECIPES_DISABLED_LABEL
          : RECIPES_UNCONFIGURED_LABEL,
    };
  });
}
