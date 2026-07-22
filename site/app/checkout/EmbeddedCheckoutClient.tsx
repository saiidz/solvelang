"use client";

import { loadStripe, type StripeElements, type StripePaymentElement } from "@stripe/stripe-js";
import { useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_ENTITLEMENT_API_BASE?.replace(/\/$/, "") ?? "";
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

export function EmbeddedCheckoutClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripePaymentElement | null>(null);
  const stripeRef = useRef<Awaited<ReturnType<typeof loadStripe>>>(null);
  const scanIdRef = useRef("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
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
          body: JSON.stringify({ scanId }),
        });
        const body = (await response.json()) as { clientSecret?: string; error?: string };
        if (!response.ok || !body.clientSecret) throw new Error(body.error || "Payment could not be started.");

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
  }, []);

  async function submitPayment() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    const scanId = scanIdRef.current;
    if (!stripe || !elements || !scanId) return;

    setSubmitting(true);
    setError("");
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/check/?scan_id=${encodeURIComponent(scanId)}`,
      },
      redirect: "if_required",
    });

    if (result.error) {
      setError(result.error.message || "Payment could not be completed.");
      setSubmitting(false);
      return;
    }

    if (result.paymentIntent?.status === "succeeded") {
      window.location.assign(
        `/check/?scan_id=${encodeURIComponent(scanId)}&payment_intent=${encodeURIComponent(result.paymentIntent.id)}&redirect_status=succeeded`,
      );
      return;
    }

    setError("Payment is still processing. Please try again in a moment.");
    setSubmitting(false);
  }

  return (
    <div>
      {error ? (
        <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-800">
          {error}
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
