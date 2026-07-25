export type CheckoutGateState =
  | { phase: "awaiting_verification" }
  | { phase: "creating_checkout"; token: string }
  | { phase: "payment_ready" };

export function initialCheckoutGate(): CheckoutGateState {
  return { phase: "awaiting_verification" };
}

export function beginCheckout(state: CheckoutGateState, token: string): CheckoutGateState {
  if (!token || state.phase !== "awaiting_verification") return state;
  return { phase: "creating_checkout", token };
}

export function checkoutCreated(state: CheckoutGateState): CheckoutGateState {
  return state.phase === "creating_checkout" ? { phase: "payment_ready" } : state;
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
