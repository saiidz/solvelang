"use client";

import { useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_ENTITLEMENT_API_BASE?.replace(/\/$/, "") ?? "";

export function EmbeddedCheckoutClient() {
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function startCheckout() {
      try {
        const scanId = new URLSearchParams(window.location.search).get("scan_id") ?? "";
        if (!apiBase) throw new Error("Checkout service is not configured.");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId)) {
          throw new Error("This checkout link is missing a valid scan ID.");
        }

        const response = await fetch(`${apiBase}/checkout`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scanId }),
        });
        const body = (await response.json()) as { checkoutUrl?: string; error?: string };
        if (!response.ok || !body.checkoutUrl) throw new Error(body.error || "Checkout could not be started.");
        if (!cancelled) window.location.assign(body.checkoutUrl);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Checkout could not be loaded.");
      }
    }

    void startCheckout();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-800">
          {error}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
          Opening secure Stripe checkout…
        </div>
      )}
    </div>
  );
}
