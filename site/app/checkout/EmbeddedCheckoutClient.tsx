"use client";

import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useRef, useState } from "react";
import { initializeCheckout, type PaymentElementLike } from "./checkoutSdk";

const apiBase = process.env.NEXT_PUBLIC_ENTITLEMENT_API_BASE?.replace(/\/$/, "") ?? "";
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

type ConfirmAction = () => Promise<void>;

export function EmbeddedCheckoutClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let paymentElement: PaymentElementLike | undefined;
    let cancelled = false;

    async function mountCheckout() {
      try {
        const scanId = new URLSearchParams(window.location.search).get("scan_id") ?? "";
        if (!apiBase) throw new Error("Checkout service is not configured.");
        if (!publishableKey) throw new Error("Stripe publishable key is not configured.");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId)) {
          throw new Error("This checkout link is missing a valid scan ID.");
        }

        const stripe = await loadStripe(publishableKey);
        if (!stripe) throw new Error("Stripe could not be loaded.");

        const clientSecret = fetch(`${apiBase}/checkout`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scanId }),
        }).then(async (response) => {
          const body = (await response.json()) as { clientSecret?: string; error?: string };
          if (!response.ok || !body.clientSecret) throw new Error(body.error || "Checkout could not be started.");
          return body.clientSecret;
        });

        const checkout = await initializeCheckout(stripe, {
          clientSecret,
          elementsOptions: {
            appearance: {
              theme: "stripe",
              variables: { borderRadius: "12px" },
            },
          },
        });

        paymentElement = checkout.createPaymentElement();
        if (cancelled || !containerRef.current) return;
        paymentElement.mount(containerRef.current);

        const result = await checkout.loadActions();
        if (result.type !== "success") {
          throw new Error(result.error?.message || "Stripe checkout could not be initialized. Verify that the publishable key and server secret key belong to the same Stripe account and mode.");
        }
        if (cancelled) return;

        setConfirmAction(() => async () => {
          setSubmitting(true);
          setError("");
          const confirmation = await result.actions.confirm();
          if (confirmation.type === "error") {
            setError(confirmation.error.message || "Payment could not be completed.");
            setSubmitting(false);
          }
        });
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Checkout could not be loaded.");
      }
    }

    void mountCheckout();
    return () => {
      cancelled = true;
      paymentElement?.destroy();
    };
  }, []);

  return (
    <div>
      {error ? (
        <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-800">
          {error}
        </div>
      ) : null}
      <div ref={containerRef} className="min-h-[320px]" aria-label="Secure Stripe payment form" />
      <button
        type="button"
        onClick={() => void confirmAction?.()}
        disabled={!confirmAction || submitting}
        className="mt-6 w-full rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Processing…" : "Pay securely"}
      </button>
    </div>
  );
}
