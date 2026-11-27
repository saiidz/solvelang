// Recipe catalog registry — Stage 0 (packaging layer).
//
// The 8 program recipes from the Factory recipe map (Nov 26, 2026),
// each with its trigger classes and its execution identity class (the
// least-privilege identity that can do the work, per the Slice 1
// minimal-permissions pledge):
//   - "verification-app":     the Verification App (checks/comments,
//                             read-only evidence on a PR);
//   - "process-solution-app": the Process Solution App (governed
//                             landing — the identity that may open /
//                             land change PRs);
//   - "scan":                 the unauthenticated public-read scan
//                             identity (no installation token).
//
// CLAIMS DISCIPLINE (non-negotiable): every recipe starts with
// proven: false. A recipe may be shown publicly / in the account
// catalog as available ONLY when a later stage's proof flips its
// proven flag. publicCatalog() therefore returns an empty list in
// Stage 0, and that is the honest state — the machinery exists, no
// recipe has run yet.

export const TRIGGER_CLASSES = Object.freeze(["pull_request", "schedule", "manual"]);
export const IDENTITY_CLASSES = Object.freeze([
  "verification-app",
  "process-solution-app",
  "scan",
]);

const RECIPE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "license-headers",
    title: "License headers",
    triggerClasses: Object.freeze(["schedule", "manual"]),
    identityClass: "process-solution-app",
    proven: false,
  }),
  Object.freeze({
    id: "import-organization",
    title: "Import organization",
    triggerClasses: Object.freeze(["schedule", "manual"]),
    identityClass: "process-solution-app",
    proven: false,
  }),
  Object.freeze({
    id: "lint-autofix",
    title: "Lint autofix",
    triggerClasses: Object.freeze(["schedule", "manual"]),
    identityClass: "process-solution-app",
    proven: false,
  }),
  Object.freeze({
    id: "error-message-refactors",
    title: "Error message refactors",
    triggerClasses: Object.freeze(["schedule", "manual"]),
    identityClass: "process-solution-app",
    proven: false,
  }),
  Object.freeze({
    id: "matrix-monorepo-analysis",
    title: "Matrix monorepo analysis",
    triggerClasses: Object.freeze(["pull_request", "manual"]),
    identityClass: "verification-app",
    proven: false,
  }),
  Object.freeze({
    id: "dependency-secret-scanner",
    title: "Dependency + secret scanner",
    triggerClasses: Object.freeze(["schedule", "manual"]),
    identityClass: "scan",
    proven: false,
  }),
  Object.freeze({
    id: "code-review",
    title: "Code review",
    triggerClasses: Object.freeze(["pull_request", "manual"]),
    identityClass: "verification-app",
    proven: false,
  }),
  Object.freeze({
    id: "security-review",
    title: "Security review",
    triggerClasses: Object.freeze(["pull_request", "schedule", "manual"]),
    identityClass: "verification-app",
    proven: false,
  }),
]);

function validateDefinition(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new Error("recipe_definition_invalid");
  }
  if (typeof definition.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(definition.id)) {
    throw new Error("recipe_definition_invalid");
  }
  if (typeof definition.title !== "string" || definition.title === "") {
    throw new Error("recipe_definition_invalid");
  }
  if (
    !Array.isArray(definition.triggerClasses) ||
    definition.triggerClasses.length === 0 ||
    definition.triggerClasses.some((entry) => !TRIGGER_CLASSES.includes(entry))
  ) {
    throw new Error("recipe_definition_invalid");
  }
  if (!IDENTITY_CLASSES.includes(definition.identityClass)) {
    throw new Error("recipe_definition_invalid");
  }
  if (definition.proven !== undefined && typeof definition.proven !== "boolean") {
    throw new Error("recipe_definition_invalid");
  }
  return Object.freeze({
    id: definition.id,
    title: definition.title,
    triggerClasses: Object.freeze([...definition.triggerClasses]),
    identityClass: definition.identityClass,
    proven: definition.proven === true,
    internal: definition.internal === true,
  });
}

// A registry is the catalog definitions plus any extra definitions a
// wiring layer registers (the Stage 0 end-to-end demonstration
// registers ONE internal test-only recipe this way). Internal recipes
// are never part of the catalog listing at all — not even as
// not-yet-available — regardless of their proven flag.
export function createRegistry(extraDefinitions = []) {
  const byId = new Map();
  for (const definition of [...RECIPE_DEFINITIONS, ...extraDefinitions]) {
    const validated = validateDefinition(definition);
    if (byId.has(validated.id)) throw new Error("recipe_definition_duplicate");
    byId.set(validated.id, validated);
  }
  const all = Object.freeze([...byId.values()]);
  return Object.freeze({
    get: (id) => byId.get(id) ?? null,
    has: (id) => byId.has(id),
    list: () => all,
    // The customer-visible catalog: non-internal recipes only, each
    // carrying its proven flag so surfaces can render honestly.
    catalog: () => all.filter((recipe) => !recipe.internal),
    // What may be claimed as available today: proven recipes only.
    publicCatalog: () =>
      all.filter((recipe) => !recipe.internal && recipe.proven === true),
  });
}

export const defaultRegistry = createRegistry();
