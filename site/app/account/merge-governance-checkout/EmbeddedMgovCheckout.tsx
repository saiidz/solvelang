"use client";

import { loadStripe, type Stripe, type StripeElements, type StripePaymentElement } from "@stripe/stripe-js";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  newRequestId,
  normalizeApiBase,
} from "@/app/account/core/customer-api";
import { persistApiCheckoutRequestId } from "@/app/account/core/api-checkout";
import {
  type MgovInterval,
  type MgovPackKey,
  mgovPlanFor,
  mgovTotalDollars,
  parseMgovSeats,
  resolveMgovSelection,
} from "@/app/account/core/merge-governance-checkout";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";

const PACK_DETAILS = {
  regular: { name: "Regular", monthly: 20, annual: 240, blurb: "Merge governance for a team: combined-tree batching, the full-green gate, and the decision audit log." },
  plus: { name: "Plus", monthly: 50, annual: 600, blurb: "Everything in Regular, with priority governance capacity for larger queues." },
} as const;

type ElementsCheckoutResponse = {
  subscriptionId: string;
  customerId: string;
  paymentRequired: boolean;
  clientSecret?: string;
};

type Phase = "preparing" | "code" | "creating" | "pay" | "confirming" | "free-done" | "success-done";

export function EmbeddedMgovCheckout() {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripePaymentElement | null>(null);
  const startedRef = useRef(false);
  const accountRef = useRef<CustomerDashboard | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [email, setEmail] = useState("");
  const [pack, setPack] = useState<MgovPackKey>("regular");
  const [interval, setInterval] = useState<MgovInterval>("monthly");
  const [seatsRaw, setSeatsRaw] = useState("1");
  const [promoCode, setPromoCode] = useState("");
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
        // The session gate comes first, exactly like the API-plan checkout:
        // this call fails with 401 invalid_session unless the buyer is
        // signed in, and no checkout can start without the account + CSRF
        // token it returns. There is no guest checkout.
        const account = await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
        if (!active) return;
        accountRef.current = account;
        setEmail(account.email);
        setAccountReady(true);
        if (params.get("checkout") === "success") {
          setPhase("success-done");
          return;
        }
        if (!PUBLISHABLE_KEY) throw new Error("Stripe checkout is not configured.");
        const selection = resolveMgovSelection(params.get("pack"), params.get("interval"));
        setPack(selection.pack);
        setInterval(selection.interval);
        setPhase("code");
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Checkout could not be started.");
        setPhase("code");
      }
    }

    void prepare();
    return () => {
      active = false;
      paymentElementRef.current?.destroy();
      paymentElementRef.current = null;
    };
  }, []);

  const seats = parseMgovSeats(seatsRaw);
  const details = PACK_DETAILS[pack];
  const perSeat = interval === "monthly" ? details.monthly : details.annual;
  const total = seats === null ? null : mgovTotalDollars(perSeat, seats);
  const periodWord = interval === "monthly" ? "month" : "year";
  const busy = phase === "preparing" || phase === "creating" || phase === "confirming";

  async function startPayment() {
    const account = accountRef.current;
    if (!account || seats === null || phase === "creating") return;
    setPhase("creating");
    setError("");
    setPayError("");
    try {
      const requestId = persistApiCheckoutRequestId(window.location, window.history, newRequestId);
      const result = await customerApi<ElementsCheckoutResponse>(
        API_BASE,
        "/customer/subscriptions/merge-governance/elements-checkout",
        {
          method: "POST",
          csrfToken: account.csrfToken,
          body: JSON.stringify({
            plan: mgovPlanFor(pack, interval),
            quantity: seats,
            requestId,
            ...(promoCode.trim() ? { promotionCode: promoCode.trim() } : {}),
          }),
        },
      );
      if (!result.paymentRequired) {
        setPhase("free-done");
        return;
      }
      if (!result.clientSecret) throw new Error("Stripe checkout did not return a secure payment session.");
      const stripe = await loadStripe(PUBLISHABLE_KEY);
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
      // Mount after React renders the pay phase container.
      requestAnimationFrame(() => {
        if (mountRef.current) paymentElement.mount(mountRef.current);
      });
    } catch (caught) {
      if (caught instanceof CustomerApiError && caught.code === "promotion_code_invalid") {
        setError("That promotion code is not valid. Check it and try again, or continue without a code.");
      } else {
        setError(caught instanceof Error ? caught.message : "Checkout could not be started.");
      }
      setPhase("code");
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
        return_url: `${window.location.origin}/account/merge-governance-checkout/?checkout=success`,
      },
      redirect: "if_required",
    });
    if (result.error) {
      setPayError(result.error.message ?? "Payment could not be completed. Check your details and try again.");
      setPhase("pay");
      return;
    }
    if (result.paymentIntent && (result.paymentIntent.status === "succeeded" || result.paymentIntent.status === "processing")) {
      window.location.replace("/account/merge-governance-checkout/?checkout=success");
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
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">SolveLang Merge Governance</p>
            <h1 className="mt-3 text-3xl font-bold">{details.name} pack</h1>
            <p className="mt-3 text-slate-300">{details.blurb}</p>
            <p className="mt-3 text-slate-300">For {email || "your SolveLang account"}.</p>
            <div className="mt-8 border-t border-white/10 pt-7">
              <div className="flex items-end justify-between gap-4">
                <span className="text-sm text-slate-400">Per developer</span>
                <span className="text-4xl font-bold">${perSeat}<span className="text-base font-medium text-slate-400">/{periodWord}</span></span>
              </div>
              <ul className="mt-7 space-y-3 text-sm text-slate-200">
                <li>✓ Priced per developer seat — adjust the seat count before you pay</li>
                <li>✓ Combined-tree batching: test the tree that will land, once</li>
                <li>✓ Merge only on FULL GREEN, with a written decision audit log</li>
                <li>✓ Your code never leaves your infrastructure</li>
              </ul>
            </div>
            <p className="mt-8 text-xs leading-5 text-slate-400">
              UPCOMINGSOUNDS S.R.L. is the operator and merchant; your statement may show that name. Stripe securely processes payment details, and SolveLang never receives your full card number. The subscription renews until canceled. Review the amount and any tax or other charge Stripe actually displays at checkout before confirming payment.
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">Review the <Link className="underline" href="/terms/">Terms</Link>, <Link className="underline" href="/refund-policy/">Refund Policy</Link>, and <Link className="underline" href="/billing/">Billing FAQ</Link> before purchase. Cancellation does not automatically refund a paid period; mandatory consumer rights remain unaffected.</p>
          </aside>

          <section className="min-h-[620px] rounded-[2rem] bg-white p-4 text-slate-950 shadow-2xl sm:p-7">
            <div className="mb-5 px-2 pt-2">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700">Secure payment</p>
              <h2 className="mt-2 text-2xl font-bold">Complete your Merge Governance subscription</h2>
              <p className="mt-2 text-sm text-slate-600">The payment form stays inside SolveLang and is securely provided by Stripe. We accept cards and Link, processed securely by Stripe.</p>
            </div>

            {phase === "preparing" ? <div className="grid min-h-[420px] place-items-center text-sm font-medium text-slate-600">Loading secure checkout…</div> : null}

            {error && phase === "code" ? (
              <div role="alert" className="mx-2 mb-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-800">
                <p>{error}</p>
              </div>
            ) : null}

            {phase === "code" && accountReady ? (
              <div className="mx-2">
                <fieldset>
                  <legend className="text-sm font-semibold text-slate-700">Pack</legend>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {(Object.keys(PACK_DETAILS) as MgovPackKey[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={pack === key}
                        onClick={() => setPack(key)}
                        className={pack === key ? "rounded-xl border-2 border-cyan-600 bg-cyan-50 px-4 py-3 text-left text-sm font-semibold text-slate-950" : "rounded-xl border border-slate-300 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:border-slate-400"}
                      >
                        {PACK_DETAILS[key].name}
                        <span className="block text-xs font-medium text-slate-500">${PACK_DETAILS[key].monthly}/dev/mo · ${PACK_DETAILS[key].annual}/dev/yr</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="mt-5">
                  <legend className="text-sm font-semibold text-slate-700">Billing period</legend>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {(["monthly", "annual"] as MgovInterval[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={interval === key}
                        onClick={() => setInterval(key)}
                        className={interval === key ? "rounded-xl border-2 border-cyan-600 bg-cyan-50 px-4 py-3 text-left text-sm font-semibold text-slate-950" : "rounded-xl border border-slate-300 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:border-slate-400"}
                      >
                        {key === "monthly" ? "Monthly" : "Annual"}
                        <span className="block text-xs font-medium text-slate-500">${key === "monthly" ? details.monthly : details.annual} per developer</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label htmlFor="mgov-seats" className="mt-5 block text-sm font-semibold text-slate-700">Developers (seats)</label>
                <input
                  id="mgov-seats"
                  type="text"
                  inputMode="numeric"
                  value={seatsRaw}
                  onChange={(event) => setSeatsRaw(event.target.value)}
                  autoComplete="off"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-950 outline-none focus:border-cyan-600"
                />
                {seats === null ? (
                  <p className="mt-2 text-sm font-medium text-red-700">Enter a whole number of developers between 1 and 999.</p>
                ) : null}

                <label htmlFor="promo-code" className="mt-5 block text-sm font-semibold text-slate-700">Promotion code (optional)</label>
                <input
                  id="promo-code"
                  type="text"
                  value={promoCode}
                  onChange={(event) => setPromoCode(event.target.value)}
                  placeholder="Enter code"
                  autoComplete="off"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-950 outline-none focus:border-cyan-600"
                />
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  {total !== null ? (
                    <>
                      Total due today: <strong className="text-slate-950">${total}.00</strong>
                      {promoCode.trim() ? " before any promotion discount is applied." : "."} Then ${total}/{periodWord} for {seats} developer{seats === 1 ? "" : "s"}, renewing {interval === "monthly" ? "monthly" : "annually"} until you cancel.
                    </>
                  ) : (
                    "Enter the number of developers to see the total."
                  )}
                </p>
                <button
                  type="button"
                  disabled={busy || seats === null}
                  onClick={() => void startPayment()}
                  className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  Continue to payment
                </button>
              </div>
            ) : null}

            {phase === "creating" ? <div className="grid min-h-[420px] place-items-center text-sm font-medium text-slate-600">Preparing your secure payment form…</div> : null}

            {phase === "free-done" ? (
              <div className="mx-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-medium text-emerald-900">
                <p>Your Merge Governance {details.name} subscription is active. No payment was due — your promotion code covered the first period in full.</p>
              </div>
            ) : null}

            {phase === "success-done" ? (
              <div className="mx-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-medium text-emerald-900">
                <p>Your Merge Governance {details.name} subscription is active. A receipt and subscription details are on their way to {email || "your account email"}.</p>
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
                  Total due today: <strong className="text-slate-950">${total}.00</strong>. Then ${total}/{periodWord}, renewing until you cancel.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmPayment()}
                  className="mt-4 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {phase === "confirming" ? "Processing…" : `Subscribe and pay $${total}.00`}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
