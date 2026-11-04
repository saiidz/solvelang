"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

type Turnstile = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: "signin";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

function turnstileApi(): Turnstile | undefined {
  return (window as unknown as { turnstile?: Turnstile }).turnstile;
}

// Cloudflare Turnstile widget for the sign-in forms, following the same
// explicit-render pattern as the checkout and withdrawal clients. It
// renders only when a site key is configured. The token is advisory on
// the client: the API enforces verification server-side once its secret
// is set, so a missing or failed widget never hard-blocks a human here.
// Bump resetSignal after a submission — tokens are single-use, so the
// next attempt needs a fresh challenge.
export function SignInTurnstile({
  onToken,
  resetSignal = 0,
}: {
  onToken: (token: string) => void;
  resetSignal?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const tokenRef = useRef(onToken);
  tokenRef.current = onToken;

  useEffect(() => {
    if (!ready || !turnstileSiteKey || !containerRef.current) return;
    const turnstile = turnstileApi();
    if (!turnstile) return;
    const widgetId = turnstile.render(containerRef.current, {
      sitekey: turnstileSiteKey,
      action: "signin",
      callback: (token) => tokenRef.current(token),
      "expired-callback": () => tokenRef.current(""),
      "error-callback": () => tokenRef.current(""),
    });
    widgetRef.current = widgetId;
    return () => {
      turnstile.remove(widgetId);
      widgetRef.current = null;
    };
  }, [ready]);

  useEffect(() => {
    if (resetSignal === 0) return;
    const turnstile = turnstileApi();
    if (turnstile && widgetRef.current) turnstile.reset(widgetRef.current);
  }, [resetSignal]);

  if (!turnstileSiteKey) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
      />
      <div
        ref={containerRef}
        className="cf-turnstile"
        data-sitekey={turnstileSiteKey}
        data-action="signin"
        aria-label="Human verification"
      />
    </>
  );
}

// Honeypot field: invisible to people, filled by form-scraping bots. The
// API silently drops any sign-in request where it is non-empty.
export function SignInHoneypot({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      aria-hidden="true"
      style={{ position: "absolute", left: "-9999px", top: "auto", width: "1px", height: "1px", overflow: "hidden" }}
    >
      <label>
        Website
        <input
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}
