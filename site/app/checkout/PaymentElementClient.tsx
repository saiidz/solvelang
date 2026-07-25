"use client";

import { loadStripe, type StripeElements, type StripePaymentElement } from "@stripe/stripe-js";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginCheckout,
  checkoutConfigurationError,
  checkoutCreated,
  checkoutFailed,
  expireTurnstile,
  initialCheckoutGate,
  type CheckoutGateState,
} from "./checkoutGate";

const apiBase = process.env.NEXT_PUBLIC_ENTITLEMENT_API_BASE?.replace(/\/$/, "") ?? "";
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

type Turnstile = {
  render(container: HTMLElement, options: {
    sitekey: string;
    action: "checkout";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "timeout-callback": () => void;
    "error-callback": () => void;
  }): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

type CheckoutConfiguration = {
  error?: string;
};

function initialCheckoutConfiguration(): CheckoutConfiguration {
  return {
    error: checkoutConfigurationError({ apiBase, publishableKey, turnstileSiteKey }),
  };
}

export function PaymentElementClient() {
  const [checkoutConfiguration] = useState(initialCheckoutConfiguration);
  const containerRef = useRef<HTMLDivElement>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetRef = useRef<string | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripePaymentElement | null>(null);
  const stripeRef = useRef<Awaited<ReturnType<typeof loadStripe>>>(null);
  const scanIdRef = useRef("");
  const checkoutGateRef = useRef<CheckoutGateState>(initialCheckoutGate());
  const configuredRef = useRef(!checkoutConfiguration.error);
  const mountedRef = useRef(true);
  const [error, setError] = useState(checkoutConfiguration.error ?? "");
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");

  const resetTurnstile = useCallback(() => {
    const widgetId = turnstileWidgetRef.current;
    if (widgetId) window.turnstile?.reset(widgetId);
  }, []);

  const createCheckout = useCallback(async (token: string) => {
    try {
      const scanId = scanIdRef.current;
      const response = await fetch(`${apiBase}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scanId, turnstileToken: token }),
      });
      const body = (await response.json()) as { clientSecret?: string; error?: string };
      if (!response.ok || !body.clientSecret) throw new Error(body.error || "Payment could not be started.");

      const stripe = await loadStripe(publishableKey);
      if (!stripe) throw new Error("Stripe could not be loaded.");
      if (!mountedRef.current || !containerRef.current || paymentElementRef.current) return;

      const elements = stripe.elements({
        clientSecret: body.clientSecret,
        appearance: {
          theme: "stripe",
          variables: { borderRadius: "12px" },
        },
      });
      const paymentElement = elements.create("payment", {
        layout: "tabs",
        wallets: { applePay: "never", googlePay: "never" },
      });

      stripeRef.current = stripe;
      elementsRef.current = elements;
      paymentElementRef.current = paymentElement;
      paymentElement.on("ready", () => {
        if (mountedRef.current) setReady(true);
      });
      paymentElement.on("loaderror", (event) => {
        if (mountedRef.current) setError(event.error.message || "Stripe payment form could not be loaded.");
      });
      paymentElement.mount(containerRef.current);
      checkoutGateRef.current = checkoutCreated(checkoutGateRef.current);
    } catch (caught) {
      checkoutGateRef.current = checkoutFailed();
      paymentElementRef.current?.destroy();
      paymentElementRef.current = null;
      elementsRef.current = null;
      stripeRef.current = null;
      resetTurnstile();
      if (mountedRef.current) {
        setReady(false);
        setError(caught instanceof Error ? caught.message : "Payment could not be loaded.");
      }
    }
  }, [resetTurnstile]);

  const beginVerifiedCheckout = useCallback((token: string) => {
    const scanId = new URLSearchParams(window.location.search).get("scan_id") ?? "";
    const configurationError = checkoutConfigurationError({ apiBase, publishableKey, turnstileSiteKey, scanId });
    if (configurationError) {
      setError(configurationError);
      return;
    }
    scanIdRef.current = scanId;
    const next = beginCheckout(checkoutGateRef.current, token);
    if (next === checkoutGateRef.current) return;
    checkoutGateRef.current = next;
    setError("");
    void createCheckout(token);
  }, [createCheckout]);

  const requireFreshVerification = useCallback((message: string) => {
    if (checkoutGateRef.current.phase !== "awaiting_verification") return;
    checkoutGateRef.current = expireTurnstile(checkoutGateRef.current);
    setReady(false);
    setError(message);
  }, []);

  useEffect(() => {
    if (!turnstileReady || !configuredRef.current || !turnstileContainerRef.current || !window.turnstile) return;

    const widgetId = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: turnstileSiteKey,
      action: "checkout",
      callback: beginVerifiedCheckout,
      "expired-callback": () => requireFreshVerification("Verification expired. Complete it again to load the payment form."),
      "timeout-callback": () => requireFreshVerification("Verification timed out. Complete it again to load the payment form."),
      "error-callback": () => requireFreshVerification("Verification could not be loaded. Refresh the page and try again."),
    });
    turnstileWidgetRef.current = widgetId;

    return () => {
      window.turnstile?.remove(widgetId);
      turnstileWidgetRef.current = null;
    };
  }, [beginVerifiedCheckout, requireFreshVerification, turnstileReady]);

  useEffect(() => () => {
    mountedRef.current = false;
    paymentElementRef.current?.destroy();
    paymentElementRef.current = null;
    elementsRef.current = null;
    stripeRef.current = null;
  }, []);

  async function submitPayment() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    const scanId = scanIdRef.current;
    if (!stripe || !elements || !scanId) return;

    setSubmitting(true);
    setError("");
    setStatus("Processing your payment securely…");
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/check/?scan_id=${encodeURIComponent(scanId)}`,
      },
      redirect: "if_required",
    });

    if (result.error) {
      setError(result.error.message || "Payment could not be completed.");
      setStatus("");
      setSubmitting(false);
      return;
    }

    if (result.paymentIntent?.status === "succeeded") {
      window.location.assign(
        `/check/?scan_id=${encodeURIComponent(scanId)}&payment_intent=${encodeURIComponent(result.paymentIntent.id)}&redirect_status=succeeded`,
      );
      return;
    }

    setStatus("Payment is processing. Keep this page open and try again in a moment.");
    setSubmitting(false);
  }

  return (
    <div>
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setTurnstileReady(true)}
        />
      ) : null}
      {error ? (
        <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-800">
          {error}
        </div>
      ) : null}
      {status && !error ? <div role="status" className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm font-medium text-blue-900">{status}</div> : null}
      {turnstileSiteKey ? (
        <div className="mb-5">
          <div ref={turnstileContainerRef} className="cf-turnstile" data-sitekey={turnstileSiteKey} data-action="checkout" aria-label="Human verification" />
        </div>
      ) : null}
      <div ref={containerRef} className="min-h-[220px]" aria-label="Secure Stripe payment form" />
      <button
        type="button"
        onClick={() => void submitPayment()}
        disabled={!ready || submitting}
        className="mt-6 w-full rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Processing…" : "Pay $49 securely"}
      </button>
    </div>
  );
}
