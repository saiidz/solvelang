import Stripe from "stripe";
import type { StripeGateway } from "./service.js";

export function createStripeGateway(client: Stripe, options?: { receivedAt?: () => number }): StripeGateway {
  return {
    payments: {
      async create(params, idempotencyKey) {
        const paymentIntent = await client.paymentIntents.create({
          amount: 4900,
          currency: "usd",
          payment_method_types: ["card"],
          description: "SolveLang Workflow Preflight Report",
          metadata: params.metadata,
        }, { idempotencyKey });
        return {
          id: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          paymentStatus: paymentIntent.status === "succeeded" ? "paid" : "unpaid",
          metadata: paymentIntent.metadata,
        };
      },
      async retrieve(paymentIntentId) {
        const paymentIntent = await client.paymentIntents.retrieve(paymentIntentId);
        return {
          id: paymentIntent.id,
          paymentStatus: paymentIntent.status === "succeeded" ? "paid" : "unpaid",
          metadata: paymentIntent.metadata,
        };
      },
    },
    webhooks: {
      constructEvent(rawBody, signature, secret) {
        const event = client.webhooks.constructEvent(rawBody, signature, secret, undefined, undefined, options?.receivedAt?.());
        if (event.type !== "payment_intent.succeeded") return { id: event.id, type: event.type };
        const paymentIntent = event.data.object;
        return {
          id: event.id,
          type: event.type,
          paymentIntent: {
            id: paymentIntent.id,
            paymentStatus: "paid",
            metadata: paymentIntent.metadata,
          },
        };
      },
    },
  };
}
