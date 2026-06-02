"use client";

import { useState } from "react";

type PlanKey = "pro" | "api_starter" | "api_growth" | "custom_setup";

type CheckoutButtonProps = {
  plan: PlanKey;
  children: React.ReactNode;
  className?: string;
};

export default function CheckoutButton({
  plan,
  children,
  className,
}: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function startCheckout() {
    setLoading(true);
    setError(
      `Checkout for ${plan} is disabled in the static Amplify preview. Stripe checkout is preserved for a future server deployment.`
    );
    setLoading(false);
  }

  return (
    <div>
      <button
        type="button"
        onClick={startCheckout}
        disabled={loading}
        className={className}
      >
        {loading ? "Preparing checkout..." : children}
      </button>

      {error ? (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      ) : null}
    </div>
  );
}
