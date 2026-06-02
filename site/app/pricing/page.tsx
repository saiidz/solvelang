"use client";

import { useState } from "react";

type PlanKey = "pro" | "api_starter" | "api_growth" | "custom_setup";

const plans: Array<{
  key: PlanKey | "free";
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  button: string;
  highlighted?: boolean;
}> = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    cadence: "",
    description: "For local experimentation and trying the hosted preview.",
    features: [
      "Local CLI usage",
      "Basic examples",
      "Early language access",
      "Try hosted runner",
    ],
    button: "Try Hosted Runner",
  },
  {
    key: "pro",
    name: "SolveLang Pro",
    price: "$29",
    cadence: "/mo",
    description: "For solo builders and operators using early hosted workflow tools.",
    features: [
      "Early hosted workflow runner",
      "Hosted preview access",
      "Basic run output",
      "Workflow examples",
    ],
    button: "Subscribe to Pro",
    highlighted: true,
  },
  {
    key: "api_starter",
    name: "API Starter",
    price: "$79",
    cadence: "/mo",
    description: "For small projects that need early API access.",
    features: [
      "2,000 API runs / month",
      "1 project",
      "2 API keys",
      "Basic logs",
    ],
    button: "Start API Starter",
  },
  {
    key: "api_growth",
    name: "API Growth",
    price: "$199",
    cadence: "/mo",
    description: "For teams and agencies building higher-volume workflows.",
    features: [
      "10,000 API runs / month",
      "5 projects",
      "10 API keys",
      "Webhooks and priority support",
    ],
    button: "Start API Growth",
  },
];

function CheckoutButton({
  plan,
  children,
  highlighted,
}: {
  plan: PlanKey | "free";
  children: React.ReactNode;
  highlighted?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function startCheckout() {
    if (plan === "free") {
      window.location.href = "/run";
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan }),
      });

      const data = await response.json();

      if (!response.ok || !data.url) {
        throw new Error(data.error || "Could not start checkout.");
      }

      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={startCheckout}
        disabled={loading}
        className={
          highlighted
            ? "w-full rounded-xl bg-black px-5 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            : "w-full rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-950 hover:bg-slate-50 disabled:opacity-60"
        }
      >
        {loading ? "Opening checkout..." : children}
      </button>

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">
            SolveLang pricing
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">
            Start with a hosted runner, then scale into API workflows.
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-lg text-slate-600">
            Early pricing for builders, teams, and pilot customers using SolveLang
            for AI-native workflow automation.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
            <section
              key={plan.key}
              className={
                plan.highlighted
                  ? "rounded-3xl border-2 border-black bg-white p-6 shadow-sm"
                  : "rounded-3xl border bg-white p-6 shadow-sm"
              }
            >
              {plan.highlighted ? (
                <p className="mb-3 inline-flex rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                  Best start
                </p>
              ) : null}

              <h2 className="text-xl font-bold">{plan.name}</h2>
              <p className="mt-2 min-h-[48px] text-sm text-slate-600">
                {plan.description}
              </p>

              <p className="mt-6 text-4xl font-bold">
                {plan.price}
                {plan.cadence ? (
                  <span className="text-base font-medium text-slate-500">
                    {plan.cadence}
                  </span>
                ) : null}
              </p>

              <ul className="mt-6 space-y-3 text-sm text-slate-700">
                {plan.features.map((feature) => (
                  <li key={feature}>✓ {feature}</li>
                ))}
              </ul>

              <div className="mt-8">
                <CheckoutButton
                  plan={plan.key}
                  highlighted={plan.highlighted}
                >
                  {plan.button}
                </CheckoutButton>
              </div>
            </section>
          ))}
        </div>

        <section className="mt-8 rounded-3xl border bg-white p-6 shadow-sm">
          <div className="grid gap-6 md:grid-cols-[1fr_260px] md:items-center">
            <div>
              <h2 className="text-xl font-bold">Custom Setup</h2>
              <p className="mt-2 text-sm text-slate-600">
                $500+ one-time setup for done-for-you workflow design, custom
                integrations, implementation support, and launch assistance.
              </p>
            </div>

            <CheckoutButton plan="custom_setup">
              Pay Setup Deposit
            </CheckoutButton>
          </div>
        </section>
      </div>
    </main>
  );
}
