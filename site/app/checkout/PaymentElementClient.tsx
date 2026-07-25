"use client";

import { loadStripe, type StripeElements, type StripePaymentElement } from "@stripe/stripe-js";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_ENTITLEMENT_API_BASE?.replace(/\/$/, "") ?? "";
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const turnstileSiteKey = "0x4AAAAAAD9obneMXYQ49uyU";

type Turnstile = {
  render(container: HTMLElement, options: {
    sitekey: string;
    action: string;
    callback: (token: string) => void;
    "expired-callback": () => void;
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

export function PaymentElementClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetRef = useRef<string | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripePaymentElement | null>(null);
  const stripeRef = useRef<Awaited<ReturnType<typeof loadStripe>>>(null);
  const scanIdRef = useRef("");
  const [error, setError] = useState("");
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!turnstileReady || !turnstileContainerRef.current || !window.turnstile) return;

    const widgetId = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: turnstileSiteKey,
      action: "turnstile-spin-v2",
      callback: (token) => {
        setError("");
        setTurnstileToken(token);
      },
      "expired-callback": () => {
        setReady(false);
        setTurnstileToken("");
        setError("Verification expired. Complete it again to load the payment form.");
      },
      "error-callback": () => {
        setReady(false);
        setTurnstileToken("");
        setError("Verification could not be loaded. Refresh the page and try again.");
      },
    });
    turnstileWidgetRef.current = widgetId;

    return () => {
      window.turnstile?.remove(widgetId);
      turnstileWidgetRef.current = null;
    };
  }, [turnstileReady]);

  useEffect(() => {
    if (!turnstileToken) return;
    let cancelled = false;

    async function mountPaymentElement() {
      try {
        const scanId = new URLSearchParams(window.location.search).get("scan_id") ?? "";
        scanIdRef.current = scanId;
        if (!apiBase) throw new Error("Checkout service is not configured.");
        if (!publishableKey) throw new Error("Stripe publishable key is not configured.");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId)) {
          throw new Error("This checkout link is missing a valid scan ID.");
        }

        const response = await fetch(`${apiBase}/checkout`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scanId, turnstileToken }),
        });
        const body = (await response.json()) as { clientSecret?: string; error?: string };
        if (!response.ok || !body.clientSecret) {
          const widgetId = turnstileWidgetRef.current;
          if (widgetId) window.turnstile?.reset(widgetId);
          setTurnstileToken("");
          throw new Error(body.error || "Payment could not be started.");
        }

        const stripe = await loadStripe(publishableKey);
        if (!stripe) throw new Error("Stripe could not be loaded.");
        if (cancelled || !containerRef.current) return;

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
          if (!cancelled) setReady(true);
        });
        paymentElement.on("loaderror", (event) => {
          if (!cancelled) setError(event.error.message || "Stripe payment form could not be loaded.");
        });
        paymentElement.mount(containerRef.current);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Payment could not be loaded.");
      }
    }

    void mountPaymentElement();
    return () => {
      cancelled = true;
      paymentElementRef.current?.destroy();
      paymentElementRef.current = null;
      elementsRef.current = null;
      stripeRef.current = null;
    };
  }, [turnstileToken]);

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
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setTurnstileReady(true)}
      />
      {error ? (
        <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-800">
          {error}
        </div>
      ) : null}
      {status && !error ? <div role="status" className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm font-medium text-blue-900">{status}</div> : null}
      <div className="mb-5">
        <div
          ref={turnstileContainerRef}
          className="cf-turnstile"
          data-sitekey={turnstileSiteKey}
          data-action="turnstile-spin-v2"
          aria-label="Human verification"
        />
      </div>
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
