"use client";

import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_ENTITLEMENT_API_BASE?.replace(/\/$/, "") ?? "";
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

type EmbeddedCheckoutLike = {
  mount(target: string | HTMLElement): void;
  destroy(): void;
};

type StripeWithEmbeddedCheckoutPage = {
  createEmbeddedCheckoutPage(options: { fetchClientSecret: () => Promise<string> }): Promise<EmbeddedCheckoutLike>;
};

export function EmbeddedCheckoutClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let embeddedCheckout: EmbeddedCheckoutLike | undefined;
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

        const fetchClientSecret = async () => {
          const response = await fetch(`${apiBase}/checkout`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scanId }),
          });
          const body = (await response.json()) as { clientSecret?: string; error?: string };
          if (!response.ok || !body.clientSecret) throw new Error(body.error || "Checkout could not be started.");
          return body.clientSecret;
        };

        embeddedCheckout = await (stripe as unknown as StripeWithEmbeddedCheckoutPage).createEmbeddedCheckoutPage({ fetchClientSecret });
        if (cancelled || !containerRef.current) {
          embeddedCheckout.destroy();
          return;
        }
        embeddedCheckout.mount(containerRef.current);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Checkout could not be loaded.");
      }
    }

    void mountCheckout();
    return () => {
      cancelled = true;
      embeddedCheckout?.destroy();
    };
  }, []);

  return (
    <div>
      {error ? (
        <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-800">
          {error}
        </div>
      ) : null}
      <div ref={containerRef} className="min-h-[520px]" aria-label="Secure Stripe payment form" />
    </div>
  );
}
