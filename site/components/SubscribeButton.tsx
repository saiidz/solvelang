"use client";

import { useState } from "react";

export default function SubscribeButton() {
  const [message, setMessage] = useState("");

  const handleSubscribe = () => {
    setMessage(
      "Checkout is disabled in the static Amplify preview. Stripe checkout is preserved for a future server deployment."
    );
  };

  return (
    <div>
      <button
        onClick={handleSubscribe}
        className="rounded-xl bg-black px-6 py-3 text-white"
      >
        Subscribe
      </button>
      {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
    </div>
  );
}
