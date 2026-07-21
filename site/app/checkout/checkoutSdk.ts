export type ConfirmResult =
  | { type: "success" }
  | { type: "error"; error: { message?: string } };

export type CheckoutActionsResult =
  | { type: "success"; actions: { confirm(): Promise<ConfirmResult> } }
  | { type: "error"; error?: { message?: string } };

export type PaymentElementLike = {
  mount(target: HTMLElement): void;
  destroy(): void;
};

export type CheckoutLike = {
  createPaymentElement(): PaymentElementLike;
  loadActions(): Promise<CheckoutActionsResult>;
};

type CheckoutInitializer = (options: {
  clientSecret: Promise<string> | string;
  elementsOptions?: {
    appearance?: {
      theme?: "stripe";
      variables?: Record<string, string>;
    };
  };
}) => CheckoutLike | Promise<CheckoutLike>;

type StripeCheckoutCompatible = {
  initCheckoutElementsSdk?: CheckoutInitializer;
  initCheckout?: CheckoutInitializer;
};

export async function initializeCheckout(
  stripe: unknown,
  options: Parameters<CheckoutInitializer>[0],
): Promise<CheckoutLike> {
  const compatible = stripe as StripeCheckoutCompatible;
  const initializer = compatible.initCheckoutElementsSdk ?? compatible.initCheckout;

  if (!initializer) {
    throw new Error("This Stripe.js version does not support Checkout Elements.");
  }

  return await initializer.call(compatible, options);
}
