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
  TEAM_CONTEXT_CHECKOUT_PATH,
  TEAM_CONTEXT_EMPTY_LINE,
  TEAM_CONTEXT_EYEBROW,
  TEAM_CONTEXT_INTRO,
  TEAM_CONTEXT_SYNC_LINE,
  TEAM_CONTEXT_TEAMS_PATH,
  TEAM_CONTEXT_TITLE,
  TEAM_CONTEXT_UNAVAILABLE_LINE,
  formatMoney,
  formatSeatPrice,
  parseTeamContextTeams,
  seatLabel,
  type TeamContextTeam,
  type TeamContextTeams,
} from "@/app/account/core/team-context";

// Team Context Index billing: the signed-in owner's teams with their
// active-seat counts and the $8-per-seat monthly price, plus the
// embedded Stripe subscribe flow (the payment form stays inside
// SolveLang, exactly like the API plan checkout). The seat count and
// the ownership check happen on the API service from the MCP
// service's own records — this page only names the team. Nothing
// here gates the team itself: teams keep working whether or not
// they subscribe.
const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl";
const cardEyebrowClass = "text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300";

type Screen = "loading" | "signed-out" | "ready";
type CheckoutPhase = "idle" | "creating" | "pay" | "confirming" | "free-done";

type ElementsCheckoutResponse = {
  subscriptionId: string;
  customerId: string;
  paymentRequired: boolean;
  clientSecret?: string;
};

function siteStripeTheme(): "stripe" | "night" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "stripe" : "night";
}

export function TeamContextBilling() {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripePaymentElement | null>(null);
  const accountRef = useRef<CustomerDashboard | null>(null);
  const startedRef = useRef(false);
  const [screen, setScreen] = useState<Screen>("loading");
  const [teams, setTeams] = useState<TeamContextTeams | null>(null);
  const [teamsUnavailable, setTeamsUnavailable] = useState(false);
  const [checkoutTeamId, setCheckoutTeamId] = useState<string | null>(null);
  const [phase, setPhase] = useState<CheckoutPhase>("idle");
  const [promoCode, setPromoCode] = useState("");
  const [error, setError] = useState("");
  const [payError, setPayError] = useState("");
  const [checkoutDone, setCheckoutDone] = useState(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;
    (async () => {
      let account: CustomerDashboard;
      try {
        account = await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
      } catch {
        if (active) setScreen("signed-out");
        return;
      }
      if (!active) return;
      accountRef.current = account;
      setScreen("ready");
      if (new URLSearchParams(window.location.search).get("checkout") === "success") {
        setCheckoutDone(true);
      }
      try {
        const raw = await customerApi<unknown>(API_BASE, TEAM_CONTEXT_TEAMS_PATH, { method: "GET" });
        if (active) setTeams(parseTeamContextTeams(raw));
      } catch {
        // A service without the team billing surface reads as the
        // calm unavailable state — never an error dump.
        if (active) setTeamsUnavailable(true);
      }
    })();
    return () => {
      active = false;
      paymentElementRef.current?.destroy();
      paymentElementRef.current = null;
    };
  }, []);

  async function startPayment(team: TeamContextTeam) {
    const account = accountRef.current;
    if (!account || phase === "creating") return;
    if (!PUBLISHABLE_KEY) {
      setError("Stripe checkout is not configured.");
      return;
    }
    setCheckoutTeamId(team.id);
    setPhase("creating");
    setError("");
    setPayError("");
    try {
      const result = await customerApi<ElementsCheckoutResponse>(API_BASE, TEAM_CONTEXT_CHECKOUT_PATH, {
        method: "POST",
        csrfToken: account.csrfToken,
        body: JSON.stringify({
          teamId: team.id,
          requestId: newRequestId(),
          ...(promoCode.trim() ? { promotionCode: promoCode.trim() } : {}),
        }),
      });
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
      requestAnimationFrame(() => {
        if (mountRef.current) paymentElement.mount(mountRef.current);
      });
    } catch (caught) {
      if (caught instanceof CustomerApiError && caught.code === "promotion_code_invalid") {
        setError("That promotion code is not valid. Check it and try again, or continue without a code.");
      } else if (caught instanceof CustomerApiError && caught.code === "team_context_forbidden") {
        setError("Only the team owner can subscribe for this team.");
      } else {
        setError(caught instanceof Error ? caught.message : "Checkout could not be started.");
      }
      setPhase("idle");
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
        return_url: `${window.location.origin}/account/team-context/?checkout=success`,
      },
      redirect: "if_required",
    });
    if (result.error) {
      setPayError(result.error.message ?? "Payment could not be completed. Check your details and try again.");
      setPhase("pay");
      return;
    }
    if (result.paymentIntent && (result.paymentIntent.status === "succeeded" || result.paymentIntent.status === "processing")) {
      window.location.replace("/account/team-context/?checkout=success");
      return;
    }
    setPayError("Payment is still being processed. If it does not complete, you can try again; you will not be charged twice.");
    setPhase("pay");
  }

  if (screen === "loading") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-6xl">
          <p className="text-slate-300">Loading your teams…</p>
        </div>
      </main>
    );
  }

  if (screen === "signed-out") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-5xl">
          <section className={cardClass}>
            <p className={cardEyebrowClass}>{TEAM_CONTEXT_EYEBROW}</p>
            <h1 className="mt-3 text-4xl font-bold">Sign in</h1>
            <p className="mt-4 text-slate-300">Sign in to see your teams and their seat billing.</p>
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

  const busy = phase === "creating" || phase === "confirming";

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-6xl">
        <header className="border-b border-white/10 pb-8">
          <p className={cardEyebrowClass}>{TEAM_CONTEXT_EYEBROW}</p>
          <h1 className="mt-2 text-4xl font-bold">{TEAM_CONTEXT_TITLE}</h1>
          <p className="mt-4 max-w-3xl leading-7 text-slate-300">{TEAM_CONTEXT_INTRO}</p>
          <p className="mt-2 text-sm text-slate-400">{TEAM_CONTEXT_SYNC_LINE}</p>
        </header>

        {checkoutDone ? (
          <div className="mt-8 rounded-2xl border border-emerald-300/30 bg-emerald-300/10 p-5 text-sm font-medium text-emerald-200">
            <p>Your team subscription is active. Seats are billed monthly and follow your team&apos;s active membership.</p>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="mt-8 rounded-2xl border border-red-300/30 bg-red-300/10 p-5 text-sm font-medium text-red-200">
            <p>{error}</p>
          </div>
        ) : null}

        <div className="mt-10 grid gap-6">
          {teamsUnavailable ? (
            <section className={cardClass}>
              <p className="leading-7 text-slate-300">{TEAM_CONTEXT_UNAVAILABLE_LINE}</p>
            </section>
          ) : null}

          {!teamsUnavailable && teams && teams.teams.length === 0 ? (
            <section className={cardClass}>
              <p className="leading-7 text-slate-300">{TEAM_CONTEXT_EMPTY_LINE}</p>
            </section>
          ) : null}

          {!teamsUnavailable && teams && teams.teams.length > 0 ? (
            <section className={cardClass}>
              <label htmlFor="team-promo-code" className="text-sm font-semibold text-slate-200">Promotion code (optional)</label>
              <input
                id="team-promo-code"
                type="text"
                value={promoCode}
                onChange={(event) => setPromoCode(event.target.value)}
                placeholder="Enter code"
                autoComplete="off"
                className="mt-2 w-full max-w-md rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300"
              />
            </section>
          ) : null}

          {!teamsUnavailable && teams
            ? teams.teams.map((team) => {
                const isActiveCheckout = checkoutTeamId === team.id && phase !== "idle";
                return (
                  <section key={team.id} className={cardClass}>
                    <p className={cardEyebrowClass}>{team.name || "Team"}</p>
                    <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <p className="text-4xl font-bold">
                          {formatSeatPrice(teams.perSeatAmountCents)}
                          <span className="text-base font-medium text-slate-400"> per seat per month</span>
                        </p>
                        <p className="mt-2 text-sm text-slate-300">{seatLabel(team.activeSeats)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-slate-400">Billed monthly</p>
                        <p className="mt-1 text-2xl font-bold">{formatMoney(team.monthlyTotalCents)}</p>
                      </div>
                    </div>

                    {phase === "free-done" && checkoutTeamId === team.id ? (
                      <div className="mt-6 rounded-2xl border border-emerald-300/30 bg-emerald-300/10 p-5 text-sm font-medium text-emerald-200">
                        <p>Your subscription is active. No payment was due — your promotion code covered the first period in full.</p>
                      </div>
                    ) : isActiveCheckout ? (
                      <div className="mt-6">
                        {phase === "creating" ? (
                          <p className="text-sm font-medium text-slate-300">Preparing your secure payment form…</p>
                        ) : (
                          <>
                            <div ref={mountRef} aria-label="Secure Stripe payment form" />
                            {payError ? (
                              <div role="alert" className="mt-4 rounded-2xl border border-red-300/30 bg-red-300/10 p-4 text-sm font-medium text-red-200">
                                <p>{payError}</p>
                              </div>
                            ) : null}
                            <p className="mt-5 text-sm leading-6 text-slate-400">
                              Total due today: <strong className="text-white">{formatMoney(team.monthlyTotalCents)}</strong>. Then {formatMoney(team.monthlyTotalCents)}/month at today&apos;s seat count, renewing monthly until you cancel. When seats change, the difference is prorated on your next invoice.
                            </p>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void confirmPayment()}
                              className="mt-4 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200 disabled:opacity-60"
                            >
                              {phase === "confirming" ? "Processing…" : `Subscribe and pay ${formatMoney(team.monthlyTotalCents)}`}
                            </button>
                          </>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void startPayment(team)}
                        className="mt-6 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200 disabled:opacity-60"
                      >
                        Subscribe for {formatMoney(team.monthlyTotalCents)}/month
                      </button>
                    )}
                  </section>
                );
              })
            : null}
        </div>

        <p className="mt-10 text-xs leading-5 text-slate-400">
          UPCOMINGSOUNDS S.R.L. is the operator and merchant; your statement may show that name. Stripe securely processes payment details, and SolveLang never receives your full card number. The subscription renews monthly until canceled. Review the amount and any tax or other charge Stripe actually displays at checkout before confirming payment.
        </p>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Review the <Link className="underline" href="/terms/">Terms</Link>, <Link className="underline" href="/refund-policy/">Refund Policy</Link>, and <Link className="underline" href="/billing/">Billing FAQ</Link> before purchase. Cancellation does not automatically refund a paid period; mandatory consumer rights remain unaffected.
        </p>
      </div>
    </main>
  );
}
