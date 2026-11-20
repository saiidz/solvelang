"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { customerApi, normalizeApiBase, type CustomerDashboard } from "../core/customer-api";
import {
  AGENT_TOKEN_SCOPES,
  MANDATE_PACK_OPTIONS,
  auditActionLine,
  auditOutcomeLine,
  digestMandateLine,
  formatCents,
  formatThreshold,
  mandateStatusLine,
  mandateVersionLine,
  minutesCheckoutFromApproval,
  opsPolicySummary,
  purchaseStatusLine,
  type AgentAuditEntryView,
  type AgentMandateView,
  type AgentOpsDigestView,
  type AgentOpsPolicyView,
  type AgentPaymentMethodView,
  type AgentPurchaseIntentView,
  type AgentTokenView,
} from "../core/agent-actions";

const ACCOUNT_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const RUNNERS_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL || "https://runners.solve-lang.com");
const PLAN_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-6";
const eyebrowClass = "text-sm font-semibold uppercase tracking-[0.24em] text-slate-400";
const inputClass = "w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white placeholder:text-slate-500";
const buttonClass = "rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-200 disabled:opacity-50";
const ghostButtonClass = "rounded-xl border border-white/20 px-5 py-3 font-bold text-white hover:bg-white/5 disabled:opacity-50";
const dangerButtonClass = "rounded-xl border border-red-300/40 px-5 py-3 font-bold text-red-200 hover:bg-red-400/10 disabled:opacity-50";

type StripeBoxState = {
  kind: "minutes-approve" | "plan-approve" | "card-setup";
  clientSecret: string;
  publishableKey: string;
  intentId?: string;
} | null;

function StripePaymentBox({ box, onDone, onCancel }: {
  box: NonNullable<StripeBoxState>;
  onDone: (resultId: string) => void;
  onCancel: () => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stripe = await loadStripe(box.publishableKey);
      if (!stripe || cancelled || !mountRef.current) return;
      const elements = stripe.elements({ clientSecret: box.clientSecret });
      const paymentElement = elements.create("payment");
      paymentElement.mount(mountRef.current);
      stripeRef.current = stripe;
      elementsRef.current = elements;
    })();
    return () => { cancelled = true; };
  }, [box]);

  async function confirm() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      const returnUrl = window.location.href;
      if (box.kind === "card-setup") {
        const result = await stripe.confirmSetup({ elements, confirmParams: { return_url: returnUrl }, redirect: "if_required" });
        if (result.error) throw new Error(result.error.message ?? "Payment failed.");
        if (!result.setupIntent) throw new Error("Card setup did not complete.");
        onDone(result.setupIntent.id);
      } else {
        const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl }, redirect: "if_required" });
        if (result.error) throw new Error(result.error.message ?? "Payment failed.");
        if (!result.paymentIntent) throw new Error("Payment did not complete.");
        onDone(result.paymentIntent.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Payment failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-cyan-300/30 bg-slate-900 p-5">
      <div ref={mountRef} />
      {error ? <p className="mt-3 text-sm text-red-200">{error}</p> : null}
      <div className="mt-4 flex gap-3">
        <button type="button" className={buttonClass} onClick={confirm} disabled={busy}>
          {busy ? "Working…" : box.kind === "card-setup" ? "Save card" : "Pay now"}
        </button>
        <button type="button" className={ghostButtonClass} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
      <p className="mt-3 text-xs text-slate-400">Payment happens only here, on SolveLang&apos;s own embedded payment page. Your agent never sees your card.</p>
    </div>
  );
}

export function AgentAccess() {
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<AgentTokenView[]>([]);
  const [mandates, setMandates] = useState<AgentMandateView[]>([]);
  const [intents, setIntents] = useState<AgentPurchaseIntentView[]>([]);
  const [planPurchases, setPlanPurchases] = useState<AgentPurchaseIntentView[]>([]);
  const [audit, setAudit] = useState<AgentAuditEntryView[]>([]);
  const [digest, setDigest] = useState<AgentOpsDigestView | null>(null);
  const [opsOff, setOpsOff] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<AgentPaymentMethodView>({ configured: false });
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [stripeBox, setStripeBox] = useState<StripeBoxState>(null);
  const [busy, setBusy] = useState(false);

  // New token form
  const [tokenLabel, setTokenLabel] = useState("");
  const [tokenScopes, setTokenScopes] = useState<string[]>(["purchase:runner-minutes", "purchases:read"]);
  // Arm mandate form
  const [packKey, setPackKey] = useState("standard-5000");
  const [thresholdMinutes, setThresholdMinutes] = useState("60");
  const [perPurchaseCap, setPerPurchaseCap] = useState("20");
  const [monthlyCap, setMonthlyCap] = useState("100");
  const [coversApiPlans, setCoversApiPlans] = useState(false);
  const [expiryDays, setExpiryDays] = useState("90");
  // Standing operations (Level 4) form — stated by the human here;
  // an agent can never set these, only propose them on a draft.
  const [opsShiftEnabled, setOpsShiftEnabled] = useState(false);
  const [opsShiftPackKey, setOpsShiftPackKey] = useState("high-power-1000");
  const [opsShiftBelowMinutes, setOpsShiftBelowMinutes] = useState("30");
  const [opsPauseEnabled, setOpsPauseEnabled] = useState(false);
  const [opsPausePercent, setOpsPausePercent] = useState("90");
  const [opsDigestCadence, setOpsDigestCadence] = useState<"daily" | "weekly">("daily");

  const load = useCallback(async () => {
    const failures: string[] = [];
    const guard = async <T,>(work: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await work();
      } catch (caught) {
        const code = (caught as { code?: string })?.code;
        if (code === "agent_actions_disabled") setDisabled(true);
        failures.push(caught instanceof Error ? caught.message : "A section failed to load.");
        return fallback;
      }
    };
    const [tokenList, mandateList, intentList, planList, auditList, method] = await Promise.all([
      guard(() => customerApi<{ tokens: AgentTokenView[] }>(ACCOUNT_API_BASE, "/customer/agent-tokens", { method: "GET" }).then((r) => r.tokens), []),
      guard(() => customerApi<{ mandates: AgentMandateView[] }>(RUNNERS_API_BASE, "/customer/runner-minutes/agent/mandates", { method: "GET" }).then((r) => r.mandates), []),
      guard(() => customerApi<{ intents: AgentPurchaseIntentView[] }>(RUNNERS_API_BASE, "/customer/runner-minutes/agent/purchase-intents", { method: "GET" }).then((r) => r.intents), []),
      guard(() => customerApi<{ purchases: AgentPurchaseIntentView[] }>(ACCOUNT_API_BASE, "/customer/agent-plan-purchases", { method: "GET" }).then((r) => r.purchases), []),
      guard(() => customerApi<{ audit: AgentAuditEntryView[] }>(RUNNERS_API_BASE, "/customer/runner-minutes/agent/audit", { method: "GET" }).then((r) => r.audit), []),
      guard(() => customerApi<AgentPaymentMethodView>(RUNNERS_API_BASE, "/customer/runner-minutes/agent/payment-method", { method: "GET" }), { configured: false }),
    ]);
    setTokens(tokenList);
    setMandates(mandateList);
    setIntents(intentList);
    setPlanPurchases(planList);
    setAudit(auditList);
    setPaymentMethod(method);
    if (failures.length > 0 && !disabled) setError(failures[0]);
    // The Level 4 ops digest has its own kill switch: while
    // AGENT_OPS_ENABLED is off the route refuses agent_ops_disabled,
    // which is a quiet "not switched on" state here, never an error.
    try {
      const result = await customerApi<{ digest: AgentOpsDigestView }>(RUNNERS_API_BASE, "/customer/runner-minutes/agent/ops/digest", { method: "GET" });
      setDigest(result.digest);
      setOpsOff(false);
    } catch (caught) {
      const code = (caught as { code?: string })?.code;
      if (code === "agent_ops_disabled") {
        setOpsOff(true);
        setDigest(null);
      }
    }

  }, []);

  useEffect(() => {
    (async () => {
      try {
        const dashboard = await customerApi<CustomerDashboard>(ACCOUNT_API_BASE, "/customer/account", { method: "GET" });
        setCsrfToken(dashboard.csrfToken);
        await load();
      } catch {
        setSignedOut(true);
      }
    })();
  }, [load]);

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (csrfToken) await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createToken() {
    if (!csrfToken) return;
    await act(async () => {
      const created = await customerApi<{ token: string }>(ACCOUNT_API_BASE, "/customer/agent-tokens", {
        method: "POST",
        csrfToken,
        body: JSON.stringify({ label: tokenLabel, scopes: tokenScopes }),
      });
      setCreatedToken(created.token);
      setTokenLabel("");
    });
  }

  async function armMandate(terms: {
    pool: string; packKey: string; thresholdSeconds: number;
    perPurchaseCapCents: number; monthlyCapCents: number;
    coversApiPlans: boolean; expiresAt: string | null;
    ops?: AgentOpsPolicyView | null;
  }) {
    if (!csrfToken) return;
    await act(async () => {
      await customerApi(RUNNERS_API_BASE, "/customer/runner-minutes/agent/mandates", {
        method: "POST",
        csrfToken,
        body: JSON.stringify(terms),
      });
    });
  }

  // The standing-operations policy exactly as the form states it.
  // Null when the human enabled nothing — the mandate is then a
  // plain Level 3 top-up mandate, operated as before.
  function opsFromForm(): AgentOpsPolicyView | null {
    if (!opsShiftEnabled && !opsPauseEnabled && opsDigestCadence === "daily") return null;
    return {
      poolShift: opsShiftEnabled
        ? { packKey: opsShiftPackKey, pool: MANDATE_PACK_OPTIONS.find((entry) => entry.packKey === opsShiftPackKey)?.pool ?? "high-power", shiftBelowSeconds: Math.max(1, Number.parseInt(opsShiftBelowMinutes, 10) || 0) * 60 }
        : null,
      pause: opsPauseEnabled
        ? { capFraction: Math.min(99, Math.max(50, Number.parseInt(opsPausePercent, 10) || 90)) / 100, floorSeconds: null }
        : null,
      digestCadence: opsDigestCadence,
    };
  }

  function formTerms() {
    const option = MANDATE_PACK_OPTIONS.find((entry) => entry.packKey === packKey) ?? MANDATE_PACK_OPTIONS[0];
    const days = Number.parseInt(expiryDays, 10);
    return {
      pool: option.pool,
      packKey: option.packKey,
      thresholdSeconds: Math.max(1, Number.parseInt(thresholdMinutes, 10) || 0) * 60,
      perPurchaseCapCents: Math.round((Number.parseFloat(perPurchaseCap) || 0) * 100),
      monthlyCapCents: Math.round((Number.parseFloat(monthlyCap) || 0) * 100),
      coversApiPlans,
      expiresAt: Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
      ops: opsFromForm(),
    };
  }

  // A mandate change is a new version (Level 4): the current
  // mandate stops, the replacement starts, the old one stays
  // listed for the record.
  async function replaceMandate(mandate: AgentMandateView) {
    if (!csrfToken) return;
    await act(async () => {
      await customerApi(RUNNERS_API_BASE, `/customer/runner-minutes/agent/mandates/${mandate.id}/replace`, {
        method: "POST",
        csrfToken,
        body: JSON.stringify(formTerms()),
      });
    });
  }

  async function mandateAction(mandate: AgentMandateView, action: "pause" | "resume" | "revoke") {
    if (!csrfToken) return;
    await act(async () => {
      await customerApi(RUNNERS_API_BASE, `/customer/runner-minutes/agent/mandates/${mandate.id}/${action}`, {
        method: "POST",
        csrfToken,
        body: JSON.stringify({}),
      });
    });
  }

  async function armDraft(mandate: AgentMandateView, adoptProposal = false) {
    if (!csrfToken) return;
    await act(async () => {
      await customerApi(RUNNERS_API_BASE, `/customer/runner-minutes/agent/mandates/${mandate.id}/arm`, {
        method: "POST",
        csrfToken,
        body: JSON.stringify({
          pool: mandate.pool,
          packKey: mandate.packKey,
          thresholdSeconds: mandate.thresholdSeconds,
          perPurchaseCapCents: mandate.perPurchaseCapCents,
          monthlyCapCents: mandate.monthlyCapCents,
          coversApiPlans: mandate.coversApiPlans,
          expiresAt: mandate.expiresAt,
          // An agent's proposed operations are adopted only when
          // the human explicitly chooses to — never by default.
          ...(adoptProposal && mandate.opsProposal ? { ops: mandate.opsProposal } : {}),
        }),
      });
    });
  }

  async function approveMinutes(intent: AgentPurchaseIntentView) {
    if (!csrfToken) return;
    setBusy(true);
    setError(null);
    try {
      const approved = await customerApi<unknown>(
        RUNNERS_API_BASE,
        `/customer/runner-minutes/agent/purchase-intents/${intent.id}/approve`,
        { method: "POST", csrfToken, body: JSON.stringify({}) },
      );
      // The approve answer is { intent, checkout } - the embedded
      // checkout material is nested (see minutesCheckoutFromApproval).
      const checkout = minutesCheckoutFromApproval(approved);
      if (checkout) {
        setStripeBox({ kind: "minutes-approve", clientSecret: checkout.clientSecret, publishableKey: checkout.publishableKey, intentId: intent.id });
      } else if (csrfToken) {
        await load();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  }

  async function approvePlan(purchase: AgentPurchaseIntentView) {
    if (!csrfToken) return;
    setBusy(true);
    setError(null);
    try {
      const approved = await customerApi<{ clientSecret?: string; paymentRequired?: boolean }>(
        ACCOUNT_API_BASE,
        "/customer/agent-plan-purchases",
        { method: "POST", csrfToken, body: JSON.stringify({ action: "approve", intentId: purchase.id }) },
      );
      if (approved.clientSecret && PLAN_PUBLISHABLE_KEY) {
        setStripeBox({ kind: "plan-approve", clientSecret: approved.clientSecret, publishableKey: PLAN_PUBLISHABLE_KEY, intentId: purchase.id });
      } else if (csrfToken) {
        await load();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  }

  async function setupCard() {
    if (!csrfToken) return;
    setBusy(true);
    setError(null);
    try {
      const setup = await customerApi<{ clientSecret?: string; publishableKey?: string }>(
        RUNNERS_API_BASE,
        "/customer/runner-minutes/agent/payment-method/setup",
        { method: "POST", csrfToken, body: JSON.stringify({}) },
      );
      if (setup.clientSecret && setup.publishableKey) {
        setStripeBox({ kind: "card-setup", clientSecret: setup.clientSecret, publishableKey: setup.publishableKey });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Card setup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onStripeDone(resultId: string) {
    const box = stripeBox;
    setStripeBox(null);
    if (!box || !csrfToken) return;
    if (box.kind === "card-setup") {
      await act(async () => {
        await customerApi(RUNNERS_API_BASE, "/customer/runner-minutes/agent/payment-method/confirm", {
          method: "POST",
          csrfToken,
          body: JSON.stringify({ setupIntentId: resultId }),
        });
      });
    } else if (csrfToken) {
      await load();
    }
  }

  if (signedOut) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-3xl">
          <section className={cardClass}>
            <p className={eyebrowClass}>Agent access</p>
            <h1 className="mt-3 text-3xl font-bold">Sign in to manage agent access</h1>
            <p className="mt-4 text-slate-300">Agent tokens, top-up mandates, and purchase approvals live inside your signed-in account.</p>
            <Link href="/account/" className="mt-8 flex w-full items-center justify-center rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-200">
              Go to your account
            </Link>
          </section>
        </div>
      </main>
    );
  }

  const pendingMinutes = intents.filter((intent) => intent.status === "approval_required");
  const pendingPlans = planPurchases.filter((purchase) => purchase.status === "approval_required");

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-6xl">
        <header className="border-b border-white/10 pb-8">
          <p className={eyebrowClass}>Agent access</p>
          <h1 className="mt-2 text-4xl font-bold">Agents acting for you</h1>
          <p className="mt-2 max-w-3xl text-slate-400">
            Give an AI agent a delegated token and it can prepare purchases for you. Nothing is charged without
            your approval here — unless you arm a top-up mandate, which buys only within the hard caps you set.
            Payment always happens on SolveLang&apos;s own embedded payment pages; your agent never sees your card.
          </p>
        </header>

        {error ? <p className="mt-6 rounded-xl bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}
        {disabled ? (
          <p className="mt-6 rounded-xl bg-amber-400/10 p-4 text-sm text-amber-200">
            Agent actions are not switched on yet. This page is ready; the service is still gated off.
          </p>
        ) : null}
        {stripeBox ? (
          <section className={cardClass}>
            <p className={eyebrowClass}>Secure payment</p>
            <StripePaymentBox box={stripeBox} onDone={onStripeDone} onCancel={() => setStripeBox(null)} />
          </section>
        ) : null}

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section className={cardClass}>
            <p className={eyebrowClass}>Delegated tokens</p>
            <h2 className="mt-3 text-2xl font-bold">Who can act for you</h2>
            {createdToken ? (
              <div className="mt-4 rounded-xl border border-cyan-300/40 bg-slate-900 p-4">
                <p className="text-sm font-bold text-cyan-200">Your new token — copy it now. It is shown only once.</p>
                <p className="mt-2 break-all font-mono text-xs text-slate-200">{createdToken}</p>
                <button type="button" className={`${ghostButtonClass} mt-3`} onClick={() => setCreatedToken(null)}>Done</button>
              </div>
            ) : null}
            <div className="mt-4 space-y-3">
              {tokens.length === 0 ? <p className="text-slate-400">No agent tokens yet.</p> : tokens.map((token) => (
                <div key={token.tokenId} className="rounded-xl border border-white/10 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{token.label}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        {token.revokedAt ? "Revoked" : "Active"} · Created {new Date(token.createdAt).toLocaleDateString("en-US")}
                        {token.lastUsedAt ? ` · Last used ${new Date(token.lastUsedAt).toLocaleDateString("en-US")}` : ""}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">{token.scopes.join(" · ")}</p>
                    </div>
                    {!token.revokedAt ? (
                      <button
                        type="button"
                        className={dangerButtonClass}
                        disabled={busy || !csrfToken}
                        onClick={() => act(async () => {
                          await customerApi(ACCOUNT_API_BASE, "/customer/agent-tokens/revoke", {
                            method: "POST", csrfToken: csrfToken ?? "", body: JSON.stringify({ tokenId: token.tokenId }),
                          });
                        })}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 space-y-3">
              <input className={inputClass} placeholder="Agent label — e.g. My coding assistant" value={tokenLabel} onChange={(e) => setTokenLabel(e.target.value)} maxLength={64} />
              {AGENT_TOKEN_SCOPES.map((entry) => (
                <label key={entry.scope} className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={tokenScopes.includes(entry.scope)}
                    onChange={(e) => setTokenScopes((current) => e.target.checked ? [...current, entry.scope] : current.filter((scope) => scope !== entry.scope))}
                  />
                  <span><span className="font-bold">{entry.label}.</span> <span className="text-slate-400">{entry.description}</span></span>
                </label>
              ))}
              <button type="button" className={buttonClass} disabled={busy || !csrfToken || !tokenLabel.trim() || tokenScopes.length === 0} onClick={createToken}>
                Create token
              </button>
            </div>
          </section>

          <section className={cardClass}>
            <p className={eyebrowClass}>Waiting for you</p>
            <h2 className="mt-3 text-2xl font-bold">Purchases to approve</h2>
            {pendingMinutes.length === 0 && pendingPlans.length === 0 ? (
              <p className="mt-4 text-slate-400">Nothing is waiting for your approval.</p>
            ) : null}
            <div className="mt-4 space-y-3">
              {pendingMinutes.map((intent) => (
                <div key={intent.id} className="rounded-xl border border-white/10 p-4">
                  <p className="font-bold">Runner minutes — {intent.packKey} · {formatCents(intent.amountCents)}</p>
                  <p className="mt-1 text-sm text-slate-400">Prepared by {intent.agentLabel ?? "an agent"} · {purchaseStatusLine(intent.status)}</p>
                  <div className="mt-3 flex gap-3">
                    <button type="button" className={buttonClass} disabled={busy} onClick={() => approveMinutes(intent)}>Approve and pay</button>
                    <button
                      type="button" className={dangerButtonClass} disabled={busy}
                      onClick={() => act(async () => {
                        await customerApi(RUNNERS_API_BASE, `/customer/runner-minutes/agent/purchase-intents/${intent.id}/reject`, {
                          method: "POST", csrfToken: csrfToken ?? "", body: JSON.stringify({}),
                        });
                      })}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
              {pendingPlans.map((purchase) => (
                <div key={purchase.id} className="rounded-xl border border-white/10 p-4">
                  <p className="font-bold">API plan — {purchase.plan} · {formatCents(purchase.amountCents)}</p>
                  <p className="mt-1 text-sm text-slate-400">Prepared by {purchase.agentLabel ?? "an agent"} · {purchaseStatusLine(purchase.status)}</p>
                  <div className="mt-3 flex gap-3">
                    <button type="button" className={buttonClass} disabled={busy} onClick={() => approvePlan(purchase)}>Approve and pay</button>
                    <button
                      type="button" className={dangerButtonClass} disabled={busy}
                      onClick={() => act(async () => {
                        await customerApi(ACCOUNT_API_BASE, "/customer/agent-plan-purchases", {
                          method: "POST", csrfToken: csrfToken ?? "", body: JSON.stringify({ action: "reject", intentId: purchase.id }),
                        });
                      })}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 border-t border-white/10 pt-4">
              <p className={eyebrowClass}>Saved card for mandates</p>
              {paymentMethod.configured ? (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-slate-300">{paymentMethod.brand} ···· {paymentMethod.last4} — used only by armed mandates, within their caps.</p>
                  <button
                    type="button" className={dangerButtonClass} disabled={busy}
                    onClick={() => act(async () => {
                      await customerApi(RUNNERS_API_BASE, "/customer/runner-minutes/agent/payment-method/remove", {
                        method: "POST", csrfToken: csrfToken ?? "", body: JSON.stringify({}),
                      });
                    })}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <p className="mt-3 text-slate-400">No saved card. Armed mandates can only buy when a card is saved.</p>
                  <button type="button" className={`${ghostButtonClass} mt-3`} disabled={busy} onClick={setupCard}>Save a card</button>
                </>
              )}
            </div>
          </section>
        </div>

        <section className={`${cardClass} mt-6`}>
          <p className={eyebrowClass}>Top-up mandates</p>
          <h2 className="mt-3 text-2xl font-bold">Standing permission to buy</h2>
          <p className="mt-2 text-slate-400">
            A mandate buys one pack automatically when your balance falls below its threshold — never more than
            its per-purchase cap, never more than its monthly cap. A purchase that would pass a cap is refused
            whole. Only you can arm a mandate; an agent can only draft one.
          </p>
          <div className="mt-4 space-y-3">
            {mandates.length === 0 ? <p className="text-slate-400">No mandates yet.</p> : mandates.map((mandate) => (
              <div key={mandate.id} className="rounded-xl border border-white/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{mandate.packKey} · {formatCents(mandate.perPurchaseCapCents)} per purchase · {formatCents(mandate.monthlyCapCents)} per month</p>
                    <p className="mt-1 text-sm text-slate-400">
                      Buys when the {mandate.pool} balance falls below {formatThreshold(mandate.thresholdSeconds)}
                      {mandate.coversApiPlans ? " · Also covers API plans" : " · Runner minutes only"}
                      {mandate.expiresAt ? ` · Ends ${new Date(mandate.expiresAt).toLocaleDateString("en-US")}` : ""}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">{mandateStatusLine(mandate)}{mandate.agentLabel ? ` · Drafted by ${mandate.agentLabel}` : ""}</p>
                    {mandateVersionLine(mandate) ? (
                      <p className="mt-1 text-sm text-slate-400">{mandateVersionLine(mandate)}</p>
                    ) : null}
                    {opsPolicySummary(mandate.ops) ? (
                      <p className="mt-1 text-sm text-slate-400">{opsPolicySummary(mandate.ops)}</p>
                    ) : null}
                    {mandate.status === "draft" && opsPolicySummary(mandate.opsProposal) ? (
                      <p className="mt-1 text-sm text-amber-200">
                        An agent proposed standing operations for this draft: {opsPolicySummary(mandate.opsProposal)} A proposal does nothing unless you arm the mandate with it.
                      </p>
                    ) : null}
                    {mandate.status === "pending_second_approval" ? (
                      <p className="mt-1 text-sm text-slate-400">
                        Approved so far by {(mandate.approvals ?? []).map((approval) => approval.actor).join(", ") || "one approver"} — a second, different approver arms it from their own signed-in session.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    {mandate.status === "draft" ? (
                      <button type="button" className={buttonClass} disabled={busy} onClick={() => armDraft(mandate)}>Arm this mandate</button>
                    ) : null}
                    {mandate.status === "draft" && mandate.opsProposal ? (
                      <button type="button" className={ghostButtonClass} disabled={busy} onClick={() => armDraft(mandate, true)}>Arm with the proposed operations</button>
                    ) : null}
                    {mandate.status === "armed" ? (
                      <button type="button" className={ghostButtonClass} disabled={busy} onClick={() => mandateAction(mandate, "pause")}>Pause</button>
                    ) : null}
                    {mandate.status === "paused" || mandate.status === "suspended" ? (
                      <button type="button" className={ghostButtonClass} disabled={busy} onClick={() => mandateAction(mandate, "resume")}>Resume</button>
                    ) : null}
                    {mandate.status === "armed" || mandate.status === "paused" || mandate.status === "suspended" ? (
                      <button type="button" className={ghostButtonClass} disabled={busy} onClick={() => replaceMandate(mandate)}>Replace with the form values</button>
                    ) : null}
                    {mandate.status === "draft" || mandate.status === "armed" || mandate.status === "paused" || mandate.status === "suspended" || mandate.status === "pending_second_approval" ? (
                      <button type="button" className={dangerButtonClass} disabled={busy} onClick={() => mandateAction(mandate, "revoke")}>Revoke</button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Pack to buy</span>
              <select className={inputClass} value={packKey} onChange={(e) => setPackKey(e.target.value)}>
                {MANDATE_PACK_OPTIONS.map((option) => (
                  <option key={option.packKey} value={option.packKey}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Buy when the balance falls below (minutes)</span>
              <input className={inputClass} type="number" min="1" value={thresholdMinutes} onChange={(e) => setThresholdMinutes(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Most it may spend on one purchase ($)</span>
              <input className={inputClass} type="number" min="1" value={perPurchaseCap} onChange={(e) => setPerPurchaseCap(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Most it may spend per month ($)</span>
              <input className={inputClass} type="number" min="1" value={monthlyCap} onChange={(e) => setMonthlyCap(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Mandate ends after (days)</span>
              <input className={inputClass} type="number" min="1" value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
            </label>
            <label className="flex items-end gap-3 text-sm">
              <input type="checkbox" checked={coversApiPlans} onChange={(e) => setCoversApiPlans(e.target.checked)} />
              <span>Also cover API plan purchases (off means runner minutes only)</span>
            </label>
          </div>
          <div className="mt-6 border-t border-white/10 pt-4">
            <p className={eyebrowClass}>Standing operations (Level 4)</p>
            <p className="mt-2 text-sm text-slate-400">
              Optional standing operations you state yourself — an agent can never set these, only propose them
              on a draft for you to accept or ignore. With any of these on, the operations loop runs this mandate:
              it reads your balance fresh before every action, writes every action and every decision not to act
              to the activity log, and stops the mandate for your review if a cap is hit, prices change, or
              anything looks wrong.
            </p>
            {opsOff ? (
              <p className="mt-3 text-sm text-amber-200">Standing operations are not switched on yet — you can arm the mandate now and the operations begin when the service is enabled.</p>
            ) : null}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1" checked={opsShiftEnabled} onChange={(e) => setOpsShiftEnabled(e.target.checked)} />
                <span><span className="font-bold">Shift pools when very low.</span> <span className="text-slate-400">Below a second, lower line, the top-up buys a pack for the other pool instead — at that pool&apos;s own price.</span></span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1" checked={opsPauseEnabled} onChange={(e) => setOpsPauseEnabled(e.target.checked)} />
                <span><span className="font-bold">Pause work near the cap.</span> <span className="text-slate-400">Non-urgent work pauses when the month&apos;s mandate spend reaches the line below, and resumes at the start of the next month.</span></span>
              </label>
              {opsShiftEnabled ? (
                <>
                  <label className="text-sm">
                    <span className="mb-1 block text-slate-400">Shift buys this pack (other pool)</span>
                    <select className={inputClass} value={opsShiftPackKey} onChange={(e) => setOpsShiftPackKey(e.target.value)}>
                      {MANDATE_PACK_OPTIONS.filter((option) => option.pool !== (MANDATE_PACK_OPTIONS.find((entry) => entry.packKey === packKey)?.pool ?? "standard")).map((option) => (
                        <option key={option.packKey} value={option.packKey}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-slate-400">Shift when the balance falls below (minutes)</span>
                    <input className={inputClass} type="number" min="1" value={opsShiftBelowMinutes} onChange={(e) => setOpsShiftBelowMinutes(e.target.value)} />
                  </label>
                </>
              ) : null}
              {opsPauseEnabled ? (
                <label className="text-sm">
                  <span className="mb-1 block text-slate-400">Pause at this share of the monthly cap (%)</span>
                  <input className={inputClass} type="number" min="50" max="99" value={opsPausePercent} onChange={(e) => setOpsPausePercent(e.target.value)} />
                </label>
              ) : null}
              <label className="text-sm">
                <span className="mb-1 block text-slate-400">Operations digest</span>
                <select className={inputClass} value={opsDigestCadence} onChange={(e) => setOpsDigestCadence(e.target.value as "daily" | "weekly")}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
            </div>
          </div>
          <button
            type="button"
            className={`${buttonClass} mt-4`}
            disabled={busy || !csrfToken}
            onClick={() => { void armMandate(formTerms()); }}
          >
            Arm mandate
          </button>
        </section>

        {digest ? (
          <section className={`${cardClass} mt-6`}>
            <p className={eyebrowClass}>Operations digest</p>
            <h2 className="mt-3 text-2xl font-bold">Standing operations, last {digest.periodDays} days</h2>
            <p className="mt-2 text-slate-300">{digest.summaryLine}</p>
            <div className="mt-4 space-y-2">
              {digest.mandates.length === 0 ? <p className="text-slate-400">No mandates yet.</p> : digest.mandates.map((view) => (
                <p key={view.id} className="text-sm text-slate-300">
                  {digestMandateLine(view)} <span className="text-slate-500">· {view.status}</span>
                </p>
              ))}
            </div>
            {digest.escalations.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-bold text-amber-200">Escalations — a mandate stopped and is waiting for you:</p>
                {digest.escalations.map((escalation, index) => (
                  <p key={`${escalation.at}-${index}`} className="text-sm text-slate-300">{escalation.summary}</p>
                ))}
              </div>
            ) : null}
            <p className="mt-4 text-xs text-slate-500">
              This digest is a view over the same mandate ledger your agents act under — agents coordinate
              through that ledger and the activity log below, never through a side channel.
            </p>
          </section>
        ) : null}

        <section className={`${cardClass} mt-6`}>
          <p className={eyebrowClass}>Activity log</p>
          <h2 className="mt-3 text-2xl font-bold">Everything agents did — and everything refused</h2>
          <div className="mt-4 space-y-2">
            {audit.length === 0 ? <p className="text-slate-400">No agent activity yet.</p> : audit.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-white/10 px-4 py-3">
                <p className="text-sm">
                  <span className="font-bold">{auditActionLine(entry.action) ?? auditOutcomeLine(entry.outcome)}</span>
                  <span className="text-slate-400"> — {entry.summary ?? entry.action}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {entry.agentLabel ?? "You"} · {new Date(entry.at).toLocaleString("en-US")}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-slate-500">
            <Link href="/account/" className="underline">Back to your account</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
