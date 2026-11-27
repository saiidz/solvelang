// Scheduler core — Stage 0.
//
// The one genuinely missing platform piece from the packaging map:
// a per-repo schedule registry + firing loop, following the
// runners-service timer / Weekly CI Health Digest precedent (a
// service-internal timer that fires due work and records every
// firing). Design:
//   - createScheduleRegistry() holds one entry per (repo, recipe)
//     that a repo's config enables with a cadence;
//   - createScheduler().tick(now) fires every due entry through the
//     injected dispatch (the recipes runner), records every firing
//     as a run record via the dispatch result, and advances the
//     entry's lastFiredAt — a firing is recorded whether the run
//     succeeds, fails, or errors;
//   - dispatchPullRequest() is the pull_request-triggered entry
//     point: it checks the recipe's trigger classes and the repo's
//     config (read at the PR base SHA by the runner) before firing.
// All effects are injected, so firing decisions are unit-testable
// with a fake clock and a fake dispatch.

const CADENCE_INTERVAL_MS = Object.freeze({
  hourly: 3_600_000,
  daily: 86_400_000,
  nightly: 86_400_000,
  weekly: 604_800_000,
});

// Unknown / cron-string cadences fall back to daily in Stage 0 (the
// config parser accepts 5-field cron strings as labels; exact cron
// evaluation is a later stage and is never silently assumed here).
export function cadenceIntervalMs(cadence) {
  return CADENCE_INTERVAL_MS[cadence] ?? CADENCE_INTERVAL_MS.daily;
}

export function createScheduleRegistry() {
  const entries = new Map();
  const keyOf = (repo, recipeId) => `${repo}::${recipeId}`;
  return {
    // Registers (or replaces) the scheduled entries for one repo from
    // its enabled-with-cadence config entries. Entries for recipes no
    // longer enabled-with-cadence are removed — config is the source
    // of truth, re-read at each registration.
    registerRepo({ repo, installationId = null, baseSha = null, scheduled, registeredAt }) {
      for (const [key, entry] of [...entries.entries()]) {
        if (entry.repo === repo) entries.delete(key);
      }
      for (const { definition, entry } of scheduled ?? []) {
        if (!entry.cadence) continue;
        entries.set(keyOf(repo, definition.id), {
          repo,
          recipeId: definition.id,
          installationId,
          baseSha,
          cadence: entry.cadence,
          options: entry.options ?? {},
          lastFiredAt: null,
          registeredAt: registeredAt ?? null,
        });
      }
    },
    unregisterRepo(repo) {
      for (const [key, entry] of [...entries.entries()]) {
        if (entry.repo === repo) entries.delete(key);
      }
    },
    list: () => [...entries.values()],
    get: (repo, recipeId) => entries.get(keyOf(repo, recipeId)) ?? null,
    markFired(repo, recipeId, at) {
      const entry = entries.get(keyOf(repo, recipeId));
      if (entry) entry.lastFiredAt = at;
    },
  };
}

export function createScheduler({ registry, dispatch, log = () => {} }) {
  // Fires every entry whose cadence interval has elapsed since its
  // last firing (or since registration, for the first firing).
  // Returns the run records the dispatch produced, in firing order.
  async function tick(now) {
    const records = [];
    for (const entry of registry.list()) {
      const interval = cadenceIntervalMs(entry.cadence);
      const since = entry.lastFiredAt ?? entry.registeredAt ?? 0;
      if (now - since < interval) continue;
      registry.markFired(entry.repo, entry.recipeId, now);
      try {
        const record = await dispatch({
          repo: entry.repo,
          recipeId: entry.recipeId,
          trigger: "schedule",
          installationId: entry.installationId,
          baseSha: entry.baseSha,
          options: entry.options,
        });
        if (record) records.push(record);
      } catch (err) {
        log("recipes_schedule_dispatch_failed", `${entry.repo} ${entry.recipeId} ${err?.name || "Error"}`);
      }
    }
    return records;
  }

  // pull_request entry point: the recipe must support the
  // pull_request trigger class; enablement is enforced by the runner
  // (config read at the PR base SHA), which records a skipped run —
  // visibly — when the recipe is not enabled for that repo.
  async function dispatchPullRequest({ registry: catalog, repo, recipeId, ...rest }) {
    const definition = catalog.get(recipeId);
    if (!definition) return { fired: false, reason: "unknown_recipe" };
    if (!definition.triggerClasses.includes("pull_request")) {
      return { fired: false, reason: "trigger_not_supported" };
    }
    const record = await dispatch({ repo, recipeId, trigger: "pull_request", ...rest });
    return { fired: true, record };
  }

  return { tick, dispatchPullRequest };
}
