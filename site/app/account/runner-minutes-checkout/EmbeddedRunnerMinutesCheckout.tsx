"use client";

import { loadStripe, type Stripe, type StripeElements, type StripePaymentElement } from "@stripe/stripe-js";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  type CustomerDashboard,
  customerApi,
  newRequestId,
  normalizeApiBase,
} from "@/app/account/core/customer-api";
import { persistApiCheckoutRequestId } from "@/app/account/core/api-checkout";
import {
  type RunnerMinutesPack,
  RUNNER_MINUTES_CACHE_PACKS,
  RUNNER_MINUTES_FLOW_STEPS,
  RUNNER_MINUTES_HIGH_POWER_PACKS,
  RUNNER_MINUTES_LABELS,
  RUNNER_MINUTES_STANDARD_PACKS,
  RUNNER_MINUTES_TERMS,
  resolveRunnerMinutesPack,
} from "@/app/account/core/runner-minutes-checkout";

// The account session is gated against the account API (like every
// account page); the purchase itself is served by the Runner Minutes
// service at its own base URL. Until that base is configured, the page
// renders the full catalogue and terms with checkout in its
// being-switched-on state — the launch flip is configuration, not a
// page change.
const ACCOUNT_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const RUNNERS_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL);
const CHECKOUT_CONFIGURED = RUNNERS_API_BASE !== "";

type ElementsCheckoutResponse = {
  clientSecret?: string;
  publishableKey?: string;
  pack: string;
  amountCents: number;
};

type Phase = "preparing" | "select" | "creating" | "pay" | "confirming" | "success-done";

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function PackButton({ pack, selected, onSelect }: { pack: RunnerMinutesPack; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={selected ? "rounded-xl border-2 border-cyan-600 bg-cyan-50 px-4 py-3 text-left text-sm font-semibold text-slate-950" : "rounded-xl border border-slate-300 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:border-slate-400"}
    >
      {pack.label} · ${pack.totalDollars}
      <span className="block text-xs font-medium text-slate-500">{pack.detail}</span>
    </button>
  );
}

export function EmbeddedRunnerMinutesCheckout() {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripePaymentElement | null>(null);
  const startedRef = useRef(false);
  const accountRef = useRef<CustomerDashboard | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [email, setEmail] = useState("");
  const [pack, setPack] = useState<RunnerMinutesPack>(resolveRunnerMinutesPack(null));
  const [phase, setPhase] = useState<Phase>("preparing");
  const [error, setError] = useState("");
  const [payError, setPayError] = useState("");

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;

    async function prepare() {
      try {
        const params = new URLSearchParams(window.location.search);
        // Session gate first, exactly like the other checkouts: this
        // call fails with 401 unless the buyer is signed in. There is
        // no guest checkout.
        const account = await customerApi<CustomerDashboard>(ACCOUNT_API_BASE, "/customer/account", { method: "GET" });
        if (!active) return;
        accountRef.current = account;
        setEmail(account.email);
        setAccountReady(true);
        setPack(resolveRunnerMinutesPack(params.get("pack")));
        if (params.get("checkout") === "success") {
          setPhase("success-done");
          return;
        }
        setPhase("select");
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Checkout could not be started.");
        setPhase("select");
      }
    }

    void prepare();
    return () => {
      active = false;
      paymentElementRef.current?.destroy();
      paymentElementRef.current = null;
    };
  }, []);

  const busy = phase === "preparing" || phase === "creating" || phase === "confirming";

  async function startPayment() {
    const account = accountRef.current;
    if (!account || phase === "creating" || !CHECKOUT_CONFIGURED) return;
    setPhase("creating");
    setError("");
    setPayError("");
    try {
      const requestId = persistApiCheckoutRequestId(window.location, window.history, newRequestId);
      const result = await customerApi<ElementsCheckoutResponse>(
        RUNNERS_API_BASE,
        "/customer/runner-minutes/elements-checkout",
        {
          method: "POST",
          csrfToken: account.csrfToken,
          body: JSON.stringify({ pack: pack.key, requestId }),
        },
      );
      if (!result.clientSecret || !result.publishableKey) throw new Error("Stripe checkout did not return a secure payment session.");
      const stripe = await loadStripe(result.publishableKey);
      if (!stripe) throw new Error("Stripe checkout could not be loaded.");
      stripeRef.current = stripe;
      const elements = stripe.elements({
        clientSecret: result.clientSecret,
        appearance: { theme: "stripe", variables: { borderRadius: "12px" } },
      });
      elementsRef.current = elements;
      const paymentElement = elements.create("payment", {
        layout: "tabs",
        wallets: { applePay: "never", googlePay: "never" },
      });
      paymentElementRef.current = paymentElement;
      setPhase("pay");
      requestAnimationFrame(() => {
        if (mountRef.current) paymentElement.mount(mountRef.current);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Checkout could not be started.");
      setPhase("select");
    }
  }

  async function confirmPayment() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements || phase !== "pay") return;
    setPhase("confirming");
    setPayError("");
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/account/runner-minutes-checkout/?checkout=success`,
      },
      redirect: "if_required",
    });
    if (result.error) {
      setPayError(result.error.message ?? "Payment could not be completed. Check your details and try again.");
      setPhase("pay");
      return;
    }
    if (result.paymentIntent && (result.paymentIntent.status === "succeeded" || result.paymentIntent.status === "processing")) {
      window.location.replace("/account/runner-minutes-checkout/?checkout=success");
      return;
    }
    setPayError("Payment is still being processed. If it does not complete, you can try again; you will not be charged twice.");
    setPhase("pay");
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/account/api-keys/" className="text-sm font-semibold text-slate-300 hover:text-white">
          ← Back to your account
        </Link>

        <div className="mt-8 grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <aside className="rounded-[2rem] border border-cyan-300/20 bg-gradient-to-b from-cyan-300/10 to-white/5 p-7 shadow-2xl sm:p-9">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">SolveLang Runner Minutes</p>
            <h1 className="mt-3 text-3xl font-bold">Prepaid Linux runner minutes</h1>
            <p className="mt-3 text-slate-300">
              Every GitHub Actions job runs on a fresh Linux machine made for that job alone and destroyed when it ends. Buy minutes once; they meter per second and never auto-renew.
            </p>
            <p className="mt-3 text-slate-300">For {email || "your SolveLang account"}.</p>
            <div className="mt-8 border-t border-white/10 pt-7">
              <div className="flex items-end justify-between gap-4">
                <span className="text-sm text-slate-400">Selected pack</span>
                <span className="text-4xl font-bold">${pack.totalDollars}</span>
              </div>
              <p className="mt-2 text-sm text-slate-300">{pack.label} — {pack.detail}</p>
              <ul className="mt-7 space-y-3 text-sm text-slate-200">
                <li>✓ Fresh machine per job — never shared, never reused</li>
                <li>✓ Metered per second, 10-second minimum per job</li>
                <li>✓ On-demand fallback minutes draw at 2× — always shown as their own line</li>
                <li>✓ Balances expire 12 months after purchase, always visible</li>
                <li>✓ Speed lane: high-power machines, guaranteed start, colocated cache</li>
              </ul>
            </div>
            <p className="mt-8 text-xs leading-5 text-slate-400">
              UPCOMINGSOUNDS S.R.L. is the operator and merchant; your statement may show that name. Stripe securely processes payment details, and SolveLang never receives your full card number. The price shown for a pack is the full amount charged for it today.
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">Review the <Link className="underline" href="/terms/">Terms</Link>, <Link className="underline" href="/refund-policy/">Refund Policy</Link>, and <Link className="underline" href="/billing/">Billing FAQ</Link> before purchase.</p>
          </aside>

          <section className="min-h-[620px] rounded-[2rem] bg-white p-4 text-slate-950 shadow-2xl sm:p-7">
            <div className="mb-5 px-2 pt-2">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700">Secure payment</p>
              <h2 className="mt-2 text-2xl font-bold">Buy runner minutes</h2>
              <p className="mt-2 text-sm text-slate-600">The payment form stays inside SolveLang and is securely provided by Stripe. Minutes are credited as soon as Stripe confirms your payment — usually a few seconds.</p>
            </div>

            {phase === "preparing" ? <div className="grid min-h-[420px] place-items-center text-sm font-medium text-slate-600">Loading secure checkout…</div> : null}

            {error && phase === "select" ? (
              <div role="alert" className="mx-2 mb-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-800">
                <p>{error}</p>
              </div>
            ) : null}

            {phase === "select" && accountReady ? (
              <div className="mx-2">
                <fieldset>
                  <legend className="text-sm font-semibold text-slate-700">Standard minutes — everyday CI</legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    {RUNNER_MINUTES_STANDARD_PACKS.map((candidate) => (
                      <PackButton key={candidate.key} pack={candidate} selected={pack.key === candidate.key} onSelect={() => setPack(candidate)} />
                    ))}
                  </div>
                </fieldset>

                <fieldset className="mt-6">
                  <legend className="text-sm font-semibold text-slate-700">High-power minutes — 16-core machines for heavy suites</legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {RUNNER_MINUTES_HIGH_POWER_PACKS.map((candidate) => (
                      <PackButton key={candidate.key} pack={candidate} selected={pack.key === candidate.key} onSelect={() => setPack(candidate)} />
                    ))}
                  </div>
                </fieldset>

                <fieldset className="mt-6">
                  <legend className="text-sm font-semibold text-slate-700">Speed lane cache — stored next to the machines</legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {RUNNER_MINUTES_CACHE_PACKS.map((candidate) => (
                      <PackButton key={candidate.key} pack={candidate} selected={pack.key === candidate.key} onSelect={() => setPack(candidate)} />
                    ))}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">The Speed lane runs your jobs on high-power machines with a guaranteed start — no waiting for spare capacity — and keeps this cache beside them, so dependency and build caches load at local speed.</p>
                </fieldset>

                {!CHECKOUT_CONFIGURED ? (
                  <div className="mt-6 rounded-2xl border border-cyan-200 bg-cyan-50 p-5 text-sm font-medium text-cyan-900">
                    <p>Runner Minutes checkout is being switched on. The packs and prices above are final — when sales open, payment switches on right here on this page.</p>
                  </div>
                ) : (
                  <>
                    <p className="mt-6 text-sm leading-6 text-slate-600">
                      Due today: <strong className="text-slate-950">${pack.totalDollars}.00</strong> for {pack.label.toLowerCase()}. This is a one-time purchase — nothing renews and nothing is charged again unless you buy more.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void startPayment()}
                      className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      Continue to payment
                    </button>
                  </>
                )}
              </div>
            ) : null}

            {phase === "creating" ? <div className="grid min-h-[420px] place-items-center text-sm font-medium text-slate-600">Preparing your secure payment form…</div> : null}

            {phase === "success-done" ? (
              <div className="mx-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-medium text-emerald-900">
                <p>Payment received. Your {pack.label.toLowerCase()} are credited as soon as Stripe confirms — usually a few seconds — and appear in your account balance, ready for the recommendation step below.</p>
              </div>
            ) : null}

            {(phase === "pay" || phase === "confirming") ? (
              <div className="mx-2">
                <div ref={mountRef} aria-label="Secure Stripe payment form" />
                {payError ? (
                  <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
                    <p>{payError}</p>
                  </div>
                ) : null}
                <p className="mt-5 text-sm leading-6 text-slate-600">
                  Due today: <strong className="text-slate-950">${pack.totalDollars}.00</strong> — one-time, no renewal.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmPayment()}
                  className="mt-4 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {phase === "confirming" ? "Processing…" : `Pay ${dollars(pack.totalDollars * 100)}`}
                </button>
              </div>
            ) : null}
          </section>
        </div>

        <section className="mt-10 rounded-[2rem] border border-white/10 bg-white/5 p-7 sm:p-9">
          <h2 className="text-2xl font-bold">How Runner Minutes works</h2>
          <ol className="mt-5 grid gap-4 text-sm leading-6 text-slate-200 sm:grid-cols-2">
            {RUNNER_MINUTES_FLOW_STEPS.map((step, index) => (
              <li key={step} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <span className="font-bold text-cyan-300">{index + 1}.</span> {step}
              </li>
            ))}
          </ol>
          <h3 className="mt-8 text-lg font-bold">Point your workflows at the runners</h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">After your order is placed, jobs pick their pool by the runs-on label in the workflow file:</p>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="font-semibold text-slate-200">Standard</p>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs text-cyan-200">{RUNNER_MINUTES_LABELS.standard}</pre>
            </div>
            <div>
              <p className="font-semibold text-slate-200">High-power</p>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs text-cyan-200">{RUNNER_MINUTES_LABELS.highPower}</pre>
            </div>
            <div>
              <p className="font-semibold text-slate-200">Speed lane</p>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs text-cyan-200">{RUNNER_MINUTES_LABELS.speedLane}</pre>
            </div>
          </div>
          <h3 className="mt-8 text-lg font-bold">The terms, in plain language</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">
            {RUNNER_MINUTES_TERMS.map((term) => (
              <li key={term}>{term}</li>
            ))}
            <li>GitHub has announced (and postponed) a $0.002 per minute fee for self-hosted runners in private repositories. If it ever takes effect, it is passed through at cost with 30 days&apos; notice; minutes already in your balance keep their price.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
