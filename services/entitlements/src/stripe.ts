import Stripe from "stripe";
import type { StripeGateway } from "./service.js";

type EmbeddedCheckoutSessionParams = Stripe.Checkout.SessionCreateParams & {
  ui_mode: "embedded_page";
  return_url: string;
  wallet_options: { link: { display: "never" } };
};

export function createStripeGateway(client: Stripe, options?: { receivedAt?: () => number }): StripeGateway {
  return {
    checkout: {
      async create(params, idempotencyKey) {
        const sessionParams = {
          mode: params.mode,
          ui_mode: "embedded_page",
          payment_method_types: ["card"],
          wallet_options: { link: { display: "never" } },
          line_items: params.lineItems.map(({ quantity }) => ({
            price_data: {
              currency: "usd",
              unit_amount: 4900,
              product_data: {
                name: "SolveLang Workflow Preflight Report",
                description: "Complete deterministic findings, evidence, and downloadable HTML and JSON reports.",
              },
            },
            quantity,
          })),
          return_url: params.returnUrl,
          metadata: params.metadata,
        } as unknown as EmbeddedCheckoutSessionParams;

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
