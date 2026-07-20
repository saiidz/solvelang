import Stripe from "stripe";
import type { StripeGateway } from "./service.js";

export function createStripeGateway(client: Stripe, options?: { receivedAt?: () => number }): StripeGateway {
  return {
    checkout: {
      async create(params, idempotencyKey) {
        const session = await client.checkout.sessions.create({
          mode: params.mode,
          line_items: params.lineItems.map(({ price, quantity }) => ({ price, quantity })),
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
          metadata: params.metadata,
          allow_promotion_codes: true,
          billing_address_collection: "auto",
        }, { idempotencyKey });
        return { id: session.id, url: session.url };
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
