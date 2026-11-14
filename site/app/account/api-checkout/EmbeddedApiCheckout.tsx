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
import {
  type ApiPlanKey,
  resolveApiCheckoutStart,
  persistApiCheckoutRequestId,
} from "@/app/account/core/api-checkout";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";

const PLAN_DETAILS = {
  developer: { name: "Developer", price: "$49", credits: "1,000 weighted credits", keys: "2 active API keys" },
  pro: { name: "Pro", price: "$199", credits: "10,000 weighted credits", keys: "3 active API keys" },
  business: { name: "Business", price: "$699", credits: "50,000 weighted credits", keys: "5 active API keys" },
} as const;

type ElementsCheckoutResponse = {
  subscriptionId: string;
  customerId: string;
  paymentRequired: boolean;
  clientSecret?: string;
};

type Phase = "preparing" | "code" | "creating" | "pay" | "confirming" | "free-done";

function siteStripeTheme(): "stripe" | "night" {
  // The embedded Stripe form follows the site theme resolved before
  // first paint: a light site gets Stripe's light theme, a dark site
  // gets its "night" theme. Read once, when the form is created.
  return document.documentElement.getAttribute("data-theme") === "light" ? "stripe" : "night";
}

export function EmbeddedApiCheckout() {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripePaymentElement | null>(null);
  const startedRef = useRef(false);
  const accountRef = useRef<CustomerDashboard | null>(null);
  const [plan, setPlan] = useState<ApiPlanKey | null>(null);
  const [email, setEmail] = useState("");
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
        accountRef.current = account;
        setPlan(decision.plan);
        setEmail(account.email);
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

  async function startPayment() {
    const account = accountRef.current;
    if (!account || !plan || phase === "creating") return;
    setPhase("creating");
    setError("");
    setPayError("");
    try {
      const requestId = persistApiCheckoutRequestId(window.location, window.history, newRequestId);
      const result = await customerApi<ElementsCheckoutResponse>(
        API_BASE,
        "/customer/subscriptions/elements-checkout",
        {
          method: "POST",
          csrfToken: account.csrfToken,
          body: JSON.stringify({
            plan,
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
        appearance: { theme: siteStripeTheme(), variables: { borderRadius: "12px" } },
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
      } else if (caught instanceof CustomerApiError && caught.code === "subscription_already_exists") {
        setError("This account already has a subscription. Manage it from your API account instead of starting a new one.");
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
        return_url: `${window.location.origin}/account/api-keys/?checkout=success`,
      },
      redirect: "if_required",
    });
    if (result.error) {
      setPayError(result.error.message ?? "Payment could not be completed. Check your details and try again.");
      setPhase("pay");
      return;
    }
    if (result.paymentIntent && (result.paymentIntent.status === "succeeded" || result.paymentIntent.status === "processing")) {
      window.location.replace("/account/api-keys/?checkout=success");
      return;
    }
    setPayError("Payment is still being processed. If it does not complete, you can try again; you will not be charged twice.");
    setPhase("pay");
  }

  const details = plan ? PLAN_DETAILS[plan] : null;
  const busy = phase === "preparing" || phase === "creating" || phase === "confirming";

  return (
    <main className="min-h-screen bg-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/account/api-keys/" className="text-sm font-semibold text-body hover:text-ink">
          ← Back to API account
        </Link>

        <div className="mt-8 grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <aside className="rounded-[2rem] border border-accent bg-gradient-to-b from-accent-soft to-panel/5 p-7 shadow-2xl sm:p-9">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang API</p>
            <h1 className="mt-3 text-3xl font-bold">{details ? `${details.name} plan` : "Secure subscription"}</h1>
            <p className="mt-3 text-body">Monthly API access for {email || "your SolveLang account"}.</p>
            {details ? (
              <div className="mt-8 border-t border-line pt-7">
                <div className="flex items-end justify-between gap-4">
                  <span className="text-sm text-muted">Billed monthly</span>
                  <span className="text-4xl font-bold">{details.price}<span className="text-base font-medium text-muted">/mo</span></span>
                </div>
                <ul className="mt-7 space-y-3 text-sm text-body">
                  <li>✓ {details.credits}</li>
                  <li>✓ Up to {details.keys}</li>
                  <li>✓ Repository audit API scope</li>
                  <li>✓ Schedule cancellation in your subscription account; renewal stops at the current period end</li>
                </ul>
              </div>
            ) : null}
            <p className="mt-8 text-xs leading-5 text-muted">
              UPCOMINGSOUNDS S.R.L. is the operator and merchant; your statement may show that name. Stripe securely processes payment details, and SolveLang never receives your full card number. The plan renews monthly until canceled. Review the amount and any tax or other charge Stripe actually displays at checkout before confirming payment.
            </p>
            <p className="mt-3 text-xs leading-5 text-muted">Review the <Link className="underline" href="/terms/">Terms</Link>, <Link className="underline" href="/refund-policy/">Refund Policy</Link>, and <Link className="underline" href="/billing/">Billing FAQ</Link> before purchase. Cancellation does not automatically refund a paid period; mandatory consumer rights remain unaffected.</p>
          </aside>

          <section className="min-h-[620px] rounded-[2rem] bg-panel p-4 text-ink shadow-2xl sm:p-7">
            <div className="mb-5 px-2 pt-2">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">Secure payment</p>
              <h2 className="mt-2 text-2xl font-bold">Complete your SolveLang subscription</h2>
              <p className="mt-2 text-sm text-muted">The payment form stays inside SolveLang and is securely provided by Stripe. We accept cards and Link, processed securely by Stripe.</p>
            </div>

            {phase === "preparing" ? <div className="grid min-h-[420px] place-items-center text-sm font-medium text-muted">Loading secure checkout…</div> : null}

            {error && phase === "code" ? (
              <div role="alert" className="mx-2 mb-5 rounded-2xl border border-danger bg-danger-soft p-5 text-sm font-medium text-danger">
                <p>{error}</p>
              </div>
            ) : null}

            {phase === "code" && details ? (
              <div className="mx-2">
                <label htmlFor="promo-code" className="text-sm font-semibold text-body">Promotion code (optional)</label>
                <input
                  id="promo-code"
                  type="text"
                  value={promoCode}
                  onChange={(event) => setPromoCode(event.target.value)}
                  placeholder="Enter code"
                  autoComplete="off"
                  className="mt-2 w-full rounded-xl border border-line-strong px-4 py-3 text-sm text-ink outline-none focus:border-accent"
                />
                <p className="mt-4 text-sm leading-6 text-muted">
                  Total due today: <strong className="text-ink">{details.price}.00</strong>
                  {promoCode.trim() ? " before any promotion discount is applied." : "."} Then {details.price}/month, renewing monthly until you cancel. Cancel anytime in your subscription account; cancellation stops renewal at the current period end.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startPayment()}
                  className="mt-5 w-full rounded-xl bg-canvas px-4 py-3 text-sm font-semibold text-ink hover:bg-panel-alt disabled:opacity-60"
                >
                  Continue to payment
                </button>
              </div>
            ) : null}

            {phase === "creating" ? <div className="grid min-h-[420px] place-items-center text-sm font-medium text-muted">Preparing your secure payment form…</div> : null}

            {phase === "free-done" ? (
              <div className="mx-2 rounded-2xl border border-success bg-success-soft p-5 text-sm font-medium text-success">
                <p>Your {details?.name} subscription is active. No payment was due — your promotion code covered the first period in full.</p>
                <Link href="/account/api-keys/" className="mt-4 inline-block rounded-xl bg-canvas px-4 py-2 text-sm font-semibold text-ink hover:bg-panel-alt">
                  Go to your API account
                </Link>
              </div>
            ) : null}

            {(phase === "pay" || phase === "confirming") && details ? (
              <div className="mx-2">
                <div ref={mountRef} aria-label="Secure Stripe payment form" />
                {payError ? (
                  <div role="alert" className="mt-4 rounded-2xl border border-danger bg-danger-soft p-4 text-sm font-medium text-danger">
                    <p>{payError}</p>
                  </div>
                ) : null}
                <p className="mt-5 text-sm leading-6 text-muted">
                  Total due today: <strong className="text-ink">{details.price}.00</strong>. Then {details.price}/month, renewing monthly until you cancel. Cancel anytime in your subscription account; cancellation stops renewal at the current period end.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmPayment()}
                  className="mt-4 w-full rounded-xl bg-canvas px-4 py-3 text-sm font-semibold text-ink hover:bg-panel-alt disabled:opacity-60"
                >
                  {phase === "confirming" ? "Processing…" : `Subscribe and pay ${details.price}.00`}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
