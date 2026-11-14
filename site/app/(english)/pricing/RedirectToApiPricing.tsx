"use client";

import { useEffect } from "react";

// The static export cannot issue an HTTP redirect, so this page sends
// visitors to the canonical pricing page client-side on mount. The meta
// refresh in the page and the visible link remain as fallbacks.
export default function RedirectToApiPricing() {
  useEffect(() => {
    window.location.replace("/api-pricing/");
  }, []);
  return null;
}
