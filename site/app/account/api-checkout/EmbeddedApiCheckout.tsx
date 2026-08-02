"use client";

import { loadStripe, type Stripe, type StripeEmbeddedCheckout } from "@stripe/stripe-js";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  type CustomerDashboard,
  customerApi,
  newRequestId,
  normalizeApiBase,
} from "@/app/account/core/customer-api";
import {
  type ApiPlanKey,
  resolveApiCheckoutStart,
} from "@/app/account/core/api-checkout";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";

const PLAN_DETAILS = {
  developer: { name: "Developer", price: "$49", credits: "1,000 weighted credits", keys: "2 active API keys" },
  pro: { name: "Pro", price: "$199", credits: "10,000 weighted credits", keys: "3 active API keys" },
  business: { name: "Business", price: "$699", credits: "50,000 weighted credits", keys: "5 active API keys" },
} as const;

type EmbeddedCheckoutStripe = Stripe & {
  initEmbeddedCheckout(options: {
    clientSecret: string;
    onComplete: () => void;
  }): Promise<StripeEmbeddedCheckout>;
};

type CheckoutSessionResponse = {
  sessionId: string;
  clientSecret?: string;
  url?: string;
};

export function EmbeddedApiCheckout() {
  const mountRef = useRef<HTMLDivElement>(null);
  const checkoutRef = useRef<StripeEmbeddedCheckout | null>(null);
  const startedRef = useRef(false);
  const [plan, setPlan] = useState<ApiPlanKey | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;

    async function startCheckout() {
      try {
        const params = new URLSearchParams(window.location.search);
        const requestId = params.get("request_id") || newRequestId();
        const account = await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
        if (!active) return;

        const decision = resolveApiCheckoutStart(account.subscription.plan, params.get("plan"));
        if (decision.kind === "existing-subscription") {
          window.location.replace("/account/api-keys/?checkout=already-subscribed");
          return;
        }
        if (decision.kind === "choose-plan") {
          window.location.replace("/account/api-keys/?checkout=choose-plan");
          return;
        }
        if (!PUBLISHABLE_KEY) throw new Error("Stripe checkout is not configured.");

        const selectedPlan = decision.plan;
        setPlan(selectedPlan);
        setEmail(account.email);

        const session = await customerApi<CheckoutSessionResponse>(
          API_BASE,
          "/customer/subscriptions/checkout",
          {
            method: "POST",
            csrfToken: account.csrfToken,
            body: JSON.stringify({ plan: selectedPlan, requestId }),
          },
        );
        if (!session.clientSecret) {
          if (session.url) {
            window.location.assign(session.url);
            return;
          }
          throw new Error("Stripe checkout did not return a secure session.");
        }

        const stripe = await loadStripe(PUBLISHABLE_KEY);
        if (!stripe) throw new Error("Stripe checkout could not be loaded.");
        if (!active || !mountRef.current) return;

        const embeddedStripe = stripe as EmbeddedCheckoutStripe;
        const checkout = await embeddedStripe.initEmbeddedCheckout({
          clientSecret: session.clientSecret,
          onComplete: () => {
            window.location.assign("/account/api-keys/?checkout=success");
          },
        });
        if (!active || !mountRef.current) {
          checkout.destroy();
          return;
        }
        checkoutRef.current = checkout;
        checkout.mount(mountRef.current);
        setLoading(false);
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Checkout could not be started.");
        setLoading(false);
      }
    }

    void startCheckout();
    return () => {
      active = false;
      checkoutRef.current?.destroy();
      checkoutRef.current = null;
    };
  }, []);

  const details = plan ? PLAN_DETAILS[plan] : null;

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/account/api-keys/" className="text-sm font-semibold text-slate-300 hover:text-white">
          ← Back to API account
        </Link>

        <div className="mt-8 grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <aside className="rounded-[2rem] border border-cyan-300/20 bg-gradient-to-b from-cyan-300/10 to-white/5 p-7 shadow-2xl sm:p-9">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">SolveLang API</p>
            <h1 className="mt-3 text-3xl font-bold">{details ? `${details.name} plan` : "Secure subscription"}</h1>
            <p className="mt-3 text-slate-300">Monthly API access for {email || "your SolveLang account"}.</p>
            {details ? (
              <div className="mt-8 border-t border-white/10 pt-7">
                <div className="flex items-end justify-between gap-4">
                  <span className="text-sm text-slate-400">Billed monthly</span>
                  <span className="text-4xl font-bold">{details.price}<span className="text-base font-medium text-slate-400">/mo</span></span>
                </div>
                <ul className="mt-7 space-y-3 text-sm text-slate-200">
                  <li>✓ {details.credits}</li>
                  <li>✓ Up to {details.keys}</li>
                  <li>✓ Repository audit API scope</li>
                  <li>✓ Cancel through your subscription account</li>
                </ul>
              </div>
            ) : null}
            <p className="mt-8 text-xs leading-5 text-slate-400">
              Stripe securely processes payment details. SolveLang never receives or stores your full card number.
            </p>
          </aside>

          <section className="min-h-[620px] rounded-[2rem] bg-white p-4 text-slate-950 shadow-2xl sm:p-7">
            <div className="mb-5 px-2 pt-2">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700">Secure payment</p>
              <h2 className="mt-2 text-2xl font-bold">Complete your SolveLang subscription</h2>
              <p className="mt-2 text-sm text-slate-600">The payment form stays inside SolveLang and is securely provided by Stripe.</p>
            </div>
            {loading ? <div className="grid min-h-[420px] place-items-center text-sm font-medium text-slate-600">Loading secure checkout…</div> : null}
            {error ? (
              <div role="alert" className="mx-2 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-800">
                {error}
              </div>
            ) : null}
            <div ref={mountRef} className={loading || error ? "hidden" : "block"} aria-label="Secure Stripe subscription checkout" />
          </section>
        </div>
      </div>
    </main>
  );
}
