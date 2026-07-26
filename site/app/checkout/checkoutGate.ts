export const TERMS_VERSION = "2026-07-26-v2";

export type CheckoutConsent = {
  customerEmail: string;
  termsAccepted: boolean;
  immediatePerformanceRequested: boolean;
  withdrawalAcknowledged: boolean;
  termsVersion: string;
};

export type CheckoutGateState =
  | { phase: "awaiting_verification" }
  | { phase: "creating_checkout"; token: string; consent: CheckoutConsent }
  | { phase: "payment_ready"; consent: CheckoutConsent };

export function initialCheckoutGate(): CheckoutGateState {
  return { phase: "awaiting_verification" };
}

export function beginCheckout(state: CheckoutGateState, token: string, consent: CheckoutConsent): CheckoutGateState {
  if (!token || state.phase !== "awaiting_verification") return state;
  return { phase: "creating_checkout", token, consent: { ...consent } };
}

export function checkoutCreated(state: CheckoutGateState): CheckoutGateState {
  return state.phase === "creating_checkout" ? { phase: "payment_ready", consent: state.consent } : state;
}

export function checkoutFailed(): CheckoutGateState {
  return initialCheckoutGate();
}

export function expireTurnstile(state: CheckoutGateState): CheckoutGateState {
  return state.phase === "awaiting_verification" ? initialCheckoutGate() : state;
}

export function checkoutConfigurationError({
  apiBase,
  publishableKey,
  turnstileSiteKey,
  scanId,
}: {
  apiBase: string;
  publishableKey: string;
  turnstileSiteKey: string;
  scanId?: string;
}): string | undefined {
  if (!apiBase) return "Checkout service is not configured.";
  if (!publishableKey) return "Stripe checkout is not configured.";
  if (!turnstileSiteKey) return "Checkout verification is not configured.";
  if (scanId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId)) {
    return "This checkout link is missing a valid scan ID.";
  }
  return undefined;
}

export function checkoutConsentError(consent: CheckoutConsent): string | undefined {
  if (!consent.customerEmail || !/^\S+@\S+\.\S+$/.test(consent.customerEmail)) {
    return "Enter a valid email address for your contract confirmation and Stripe receipt.";
  }
  if (!consent.termsAccepted) return "Accept the Terms of Use and Refund Policy before checkout can start.";
  if (!consent.immediatePerformanceRequested || !consent.withdrawalAcknowledged) {
    return "Confirm the immediate-performance and withdrawal acknowledgement before checkout can start.";
  }
  if (consent.termsVersion !== TERMS_VERSION) return "Checkout terms are out of date. Refresh the page and try again.";
  return undefined;
}
