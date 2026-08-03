"use client";

import {
  loadStripe,
  type Stripe,
  type StripeElements,
  type StripePaymentElement,
} from "@stripe/stripe-js";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CustomerDashboard,
  customerApi,
  normalizeApiBase,
} from "@/app/account/core/customer-api";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
const MANAGEMENT_PATH = "/customer/subscriptions/portal";

type PaymentMethodSummary = {
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
};

type InvoiceSummary = {
  id: string;
  number: string | null;
  status: string;
  amountPaid: number;
  amountDue: number;
  currency: string;
  createdAt: number | null;
};

type ManagementState = {
  subscription: {
    plan: string | null;
    status: string;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
  };
  paymentMethod: PaymentMethodSummary | null;
  invoices: InvoiceSummary[];
  csrfToken: string;
};

function readableDate(value: number | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
  }).format(amount / 100);
}

export function SubscriptionManager() {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripePaymentElement | null>(null);
  const [management, setManagement] = useState<ManagementState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [paymentReady, setPaymentReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const destroyPaymentForm = useCallback(() => {
    paymentElementRef.current?.destroy();
    paymentElementRef.current = null;
    elementsRef.current = null;
    stripeRef.current = null;
    setPaymentReady(false);
    setPaymentFormOpen(false);
  }, []);

  const postAction = useCallback(async <T,>(csrfToken: string, body: Record<string, unknown>) => customerApi<T>(
    API_BASE,
    MANAGEMENT_PATH,
    { method: "POST", csrfToken, body: JSON.stringify(body) },
  ), []);

  const loadManagement = useCallback(async () => {
    const account = await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
    if (!account.subscription.plan) {
      window.location.replace("/account/api-keys/");
      return null;
    }
    const state = await postAction<ManagementState>(account.csrfToken, { action: "get_management" });
    setManagement(state);
    return state;
  }, [postAction]);

  const completePaymentSetup = useCallback(async (state: ManagementState, setupIntentId: string) => {
    const updated = await postAction<ManagementState>(state.csrfToken, {
      action: "complete_payment_setup",
      setupIntentId,
    });
    setManagement(updated);
    setNotice("Payment method updated.");
    window.history.replaceState({}, "", "/account/api-subscription/");
  }, [postAction]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const state = await loadManagement();
        if (!active || !state) return;
        const params = new URLSearchParams(window.location.search);
        const setupIntentId = params.get("setup_intent");
        if (setupIntentId && params.get("redirect_status") === "succeeded") {
          await completePaymentSetup(state, setupIntentId);
        }
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Subscription details could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      paymentElementRef.current?.destroy();
    };
  }, [completePaymentSetup, loadManagement]);

  async function openPaymentForm() {
    if (!management || !PUBLISHABLE_KEY || !mountRef.current) {
      setError("Payment method updates are not configured.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    destroyPaymentForm();
    setPaymentFormOpen(true);
    try {
      const setup = await postAction<{ clientSecret: string }>(management.csrfToken, {
        action: "create_payment_setup",
      });
      const stripe = await loadStripe(PUBLISHABLE_KEY);
      if (!stripe || !mountRef.current) throw new Error("Stripe payment fields could not be loaded.");
      const elements = stripe.elements({
        clientSecret: setup.clientSecret,
        appearance: { theme: "stripe", variables: { borderRadius: "12px" } },
      });
      const paymentElement = elements.create("payment", {
        layout: "tabs",
        wallets: { applePay: "never", googlePay: "never" },
      });
      paymentElement.on("ready", () => setPaymentReady(true));
      paymentElement.on("loaderror", (event) => setError(event.error.message || "Payment fields could not be loaded."));
      stripeRef.current = stripe;
      elementsRef.current = elements;
      paymentElementRef.current = paymentElement;
      paymentElement.mount(mountRef.current);
    } catch (caught) {
      destroyPaymentForm();
      setError(caught instanceof Error ? caught.message : "Payment method update could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPaymentMethod() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    const state = management;
    if (!stripe || !elements || !state) return;
    setBusy(true);
    setError("");
    setNotice("");
    const result = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/account/api-subscription/?payment=return` },
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message || "Payment method could not be saved.");
      setBusy(false);
      return;
    }
    if (result.setupIntent?.status === "succeeded") {
      try {
        await completePaymentSetup(state, result.setupIntent.id);
        destroyPaymentForm();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Payment method could not be applied.");
      }
    }
    setBusy(false);
  }

  async function changeCancellation(cancelAtPeriodEnd: boolean) {
    if (!management) return;
    const question = cancelAtPeriodEnd
      ? "Cancel this subscription at the end of the current billing period?"
      : "Keep this subscription active and resume renewal?";
    if (!window.confirm(question)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await postAction<ManagementState>(management.csrfToken, {
        action: cancelAtPeriodEnd ? "cancel_at_period_end" : "resume_subscription",
      });
      setManagement(updated);
      setNotice(cancelAtPeriodEnd
        ? "Cancellation scheduled for the end of the billing period."
        : "Subscription renewal resumed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Subscription could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-950 text-white">Loading subscription…</main>;

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/account/api-keys/" className="text-sm font-semibold text-slate-300 hover:text-white">← Back to API account</Link>
        <header className="mt-7 border-b border-white/10 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">SolveLang API</p>
          <h1 className="mt-3 text-4xl font-bold">Manage subscription</h1>
          <p className="mt-3 text-slate-400">Update billing, review invoices, or schedule cancellation without leaving SolveLang.</p>
        </header>

        {notice ? <p className="mt-6 rounded-xl bg-emerald-400/10 p-4 text-emerald-200">{notice}</p> : null}
        {error ? <p className="mt-6 rounded-xl bg-red-400/10 p-4 text-red-200">{error}</p> : null}

        {management ? (
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-8">
              <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm text-slate-400">Current plan</p>
                    <h2 className="mt-2 text-3xl font-bold capitalize">{management.subscription.plan}</h2>
                    <p className="mt-2 capitalize text-slate-300">{management.subscription.status}</p>
                    <p className="mt-3 text-sm text-slate-400">
                      {management.subscription.cancelAtPeriodEnd ? "Access ends" : "Renews"} {readableDate(management.subscription.currentPeriodEnd)}
                    </p>
                  </div>
                  {management.subscription.cancelAtPeriodEnd ? (
                    <button disabled={busy} onClick={() => changeCancellation(false)} className="rounded-xl bg-cyan-300 px-4 py-2 font-bold text-slate-950 disabled:opacity-60">Resume renewal</button>
                  ) : (
                    <button disabled={busy} onClick={() => changeCancellation(true)} className="rounded-xl border border-red-300/30 px-4 py-2 font-semibold text-red-200 hover:bg-red-300/10 disabled:opacity-60">Cancel at period end</button>
                  )}
                </div>
              </section>

              <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <p className="text-sm text-slate-400">Payment method</p>
                {management.paymentMethod ? (
                  <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xl font-bold capitalize">{management.paymentMethod.brand} •••• {management.paymentMethod.last4}</p>
                      <p className="mt-1 text-sm text-slate-400">Expires {management.paymentMethod.expMonth ?? "—"}/{management.paymentMethod.expYear ?? "—"}</p>
                    </div>
                    <button disabled={busy} onClick={openPaymentForm} className="rounded-xl border border-cyan-300/30 px-4 py-2 font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-60">Update card</button>
                  </div>
                ) : (
                  <button disabled={busy} onClick={openPaymentForm} className="mt-4 rounded-xl bg-cyan-300 px-4 py-2 font-bold text-slate-950 disabled:opacity-60">Add payment method</button>
                )}

                {paymentFormOpen ? (
                  <div className="mt-6 rounded-2xl bg-white p-5 text-slate-950">
                    <div ref={mountRef} className="min-h-[180px]" aria-label="Secure Stripe payment method form" />
                    <div className="mt-5 flex flex-wrap gap-3">
                      <button type="button" disabled={busy || !paymentReady} onClick={submitPaymentMethod} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-50">Save payment method</button>
                      <button type="button" disabled={busy} onClick={destroyPaymentForm} className="rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
                    </div>
                    <p className="mt-4 text-xs text-slate-500">Card fields are securely provided by Stripe. SolveLang never receives your full card number.</p>
                  </div>
                ) : null}
              </section>
            </div>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-2xl font-bold">Invoice history</h2>
              <div className="mt-5 space-y-3">
                {management.invoices.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/15 p-6 text-slate-400">No invoices yet.</p>
                ) : management.invoices.map((invoice) => (
                  <article key={invoice.id} className="rounded-2xl border border-white/10 bg-black/15 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-bold">{invoice.number || "Invoice"}</h3>
                        <p className="mt-1 text-sm text-slate-400">{readableDate(invoice.createdAt)}</p>
                      </div>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold capitalize text-slate-200">{invoice.status}</span>
                    </div>
                    <p className="mt-4 text-xl font-bold">{money(invoice.amountPaid || invoice.amountDue, invoice.currency)}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
