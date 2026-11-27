"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type CustomerDashboard,
  customerApi,
  normalizeApiBase,
} from "@/app/account/core/customer-api";
import {
  RECIPES_EMPTY_LINE,
  RECIPES_EYEBROW,
  RECIPES_INTRO,
  RECIPES_TITLE,
  recipeDisplayStates,
  type RecipeDisplayState,
} from "@/app/account/core/recipes";

// The authenticated recipe catalog (Stage 0, packaging layer). The
// catalog itself is code (services/recipes registry, mirrored in the
// account core); per-repo configured/enabled state arrives with the
// recipes service's customer surface in a later stage — until then
// every recipe honestly renders as not configured for your repos and,
// because no recipe is proven yet, not yet available. Nothing on
// this page claims a recipe works.
const ACCOUNT_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl";
const cardEyebrowClass = "text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300";

type Screen = "loading" | "signed-out" | "ready";

function RecipeSection({ state }: { state: RecipeDisplayState }) {
  const { entry } = state;
  return (
    <section className={cardClass}>
      <p className={cardEyebrowClass}>{entry.id}</p>
      <h2 className="mt-3 text-2xl font-bold">{entry.title}</h2>
      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-sm text-slate-400">Availability</dt>
          <dd className="mt-1 text-xl font-bold">{state.availabilityLabel}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-400">Your repo config</dt>
          <dd className="mt-1 text-xl font-bold">{state.configLabel}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-400">Runs on</dt>
          <dd className="mt-1 text-xl font-bold">{entry.triggerClasses.join(", ")}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-400">Execution identity</dt>
          <dd className="mt-1 text-xl font-bold">{entry.identityClass}</dd>
        </div>
      </dl>
      {!state.available ? (
        <p className="mt-4 text-sm text-slate-400">
          This recipe is not available yet. It will be listed as available only after it has been
          proven by a real run with a graded receipt.
        </p>
      ) : null}
    </section>
  );
}

export function RecipesBoard() {
  const [screen, setScreen] = useState<Screen>("loading");
  // No customer-facing recipes endpoint exists in Stage 0, so the
  // per-repo states are empty: every recipe renders not configured.
  const states = recipeDisplayStates([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await customerApi<CustomerDashboard>(ACCOUNT_API_BASE, "/customer/account", { method: "GET" });
      } catch {
        if (active) setScreen("signed-out");
        return;
      }
      if (active) setScreen("ready");
    })();
    return () => {
      active = false;
    };
  }, []);

  if (screen === "loading") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-6xl">
          <p className="text-slate-300">Loading the recipe catalog…</p>
        </div>
      </main>
    );
  }

  if (screen === "signed-out") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-5xl">
          <section className={cardClass}>
            <p className={cardEyebrowClass}>{RECIPES_EYEBROW}</p>
            <h1 className="mt-3 text-4xl font-bold">Sign in</h1>
            <p className="mt-4 text-slate-300">Sign in to see the recipe catalog for your repositories.</p>
            <Link
              href="/account/api-keys/"
              className="mt-8 flex w-full items-center justify-center rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-200"
            >
              Sign in
            </Link>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-6xl">
        <header className="border-b border-white/10 pb-8">
          <p className={cardEyebrowClass}>{RECIPES_EYEBROW}</p>
          <h1 className="mt-2 text-4xl font-bold">{RECIPES_TITLE}</h1>
          <p className="mt-4 max-w-3xl leading-7 text-slate-300">{RECIPES_INTRO}</p>
        </header>

        <div className="mt-10 grid gap-6">
          <section className={cardClass}>
            <p className="leading-7 text-slate-300">{RECIPES_EMPTY_LINE}</p>
          </section>
          {states.map((state) => (
            <RecipeSection key={state.entry.id} state={state} />
          ))}
        </div>
      </div>
    </main>
  );
}
