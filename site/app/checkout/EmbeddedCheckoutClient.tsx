"use client";

import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_ENTITLEMENT_API_BASE?.replace(/\/$/, "") ?? "";
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

export function EmbeddedCheckoutClient({ scanId }: { scanId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let checkout: Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof loadStripe>>>["initEmbeddedCheckout"]>> | undefined;
    let cancelled = false;

    async function mountCheckout() {
      try {
        if (!apiBase) throw new Error("Checkout service is not configured.");
        if (!publishableKey) throw new Error("Stripe publishable key is not configured.");
        if (!scanId) throw new Error("This checkout link is missing a valid scan ID.");

        const stripe = await loadStripe(publishableKey);
        if (!stripe) throw new Error("Stripe could not be loaded.");

        checkout = await stripe.initEmbeddedCheckout({
          fetchClientSecret: async () => {
            const response = await fetch(`${apiBase}/checkout`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ scanId }),
            });
            const body = (await response.json()) as { clientSecret?: string; error?: string };
            if (!response.ok || !body.clientSecret) throw new Error(body.error || "Checkout could not be started.");
            return body.clientSecret;
          },
        });

        if (cancelled || !containerRef.current) return;
        checkout.mount(containerRef.current);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Checkout could not be loaded.");
      }
    }

    void mountCheckout();
    return () => {
      cancelled = true;
      checkout?.destroy();
    };
  }, [scanId]);

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-800">
        {error}
      </div>
    );
  }

  return <div ref={containerRef} className="min-h-[560px]" aria-label="Secure Stripe payment form" />;
}
