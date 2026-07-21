import Stripe from "stripe";
import type { StripeGateway } from "./service.js";

type CustomCheckoutSessionParams = Stripe.Checkout.SessionCreateParams & {
  ui_mode: "custom";
  return_url: string;
};

export function createStripeGateway(client: Stripe, options?: { receivedAt?: () => number }): StripeGateway {
  return {
    checkout: {
      async create(params, idempotencyKey) {
        const sessionParams = {
          mode: params.mode,
          ui_mode: "custom",
          line_items: params.lineItems.map(({ price, quantity }) => ({ price, quantity })),
          return_url: params.returnUrl,
          metadata: params.metadata,
          allow_promotion_codes: true,
          billing_address_collection: "auto",
        } as unknown as CustomCheckoutSessionParams;

        const session = await client.checkout.sessions.create(sessionParams, { idempotencyKey });
        return { id: session.id, clientSecret: session.client_secret };
      },
      async retrieve(sessionId) {
        const session = await client.checkout.sessions.retrieve(sessionId);
        return { id: session.id, paymentStatus: session.payment_status, metadata: session.metadata };
      },
    },
    webhooks: {
      constructEvent(rawBody, signature, secret) {
        const event = client.webhooks.constructEvent(rawBody, signature, secret, undefined, undefined, options?.receivedAt?.());
        if (event.type !== "checkout.session.completed") return { id: event.id, type: event.type };
        const session = event.data.object;
        return {
          id: event.id,
          type: event.type,
          session: { id: session.id, paymentStatus: session.payment_status, metadata: session.metadata },
        };
      },
    },
  };
}
