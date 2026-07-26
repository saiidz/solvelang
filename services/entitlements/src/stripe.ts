import Stripe from "stripe";
import type { StripeGateway } from "./service.js";

export function createStripeGateway(client: Stripe, options?: { receivedAt?: () => number }): StripeGateway {
  function snapshot(paymentIntent: Stripe.PaymentIntent) {
    const charge = typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge : null;
    const amountRefunded = charge?.amount_refunded ?? 0;
    const refundStatus = charge?.refunded || amountRefunded >= paymentIntent.amount
      ? "full" as const
      : amountRefunded > 0
        ? "partial" as const
        : "none" as const;
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      receiptEmail: paymentIntent.receipt_email,
      createdAt: paymentIntent.created,
      paymentStatus: paymentIntent.status === "succeeded" ? "paid" : "unpaid",
      refundStatus,
      metadata: paymentIntent.metadata,
    };
  }

  return {
    payments: {
      async create(params, idempotencyKey) {
        const paymentIntent = await client.paymentIntents.create({
          amount: 4900,
          currency: "usd",
          payment_method_types: ["card"],
          description: "SolveLang Workflow Preflight Report",
          metadata: params.metadata,
          receipt_email: params.receiptEmail,
        }, { idempotencyKey });
        return snapshot(paymentIntent);
      },
      async updateMetadata(paymentIntentId, metadata, idempotencyKey) {
        await client.paymentIntents.update(paymentIntentId, { metadata }, { idempotencyKey });
      },
      async retrieve(paymentIntentId) {
        const paymentIntent = await client.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
        return snapshot(paymentIntent);
      },
    },
    webhooks: {
      constructEvent(rawBody, signature, secret) {
        const event = client.webhooks.constructEvent(rawBody, signature, secret, undefined, undefined, options?.receivedAt?.());
        if (event.type === "charge.refunded") {
          const charge = event.data.object;
          const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
          return paymentIntentId
            ? { id: event.id, type: event.type, refund: { paymentIntentId } }
            : { id: event.id, type: event.type };
        }
        if (event.type !== "payment_intent.succeeded") return { id: event.id, type: event.type };
        const paymentIntent = event.data.object;
        return {
          id: event.id,
          type: event.type,
          paymentIntent: {
            id: paymentIntent.id,
            paymentStatus: "paid",
            refundStatus: "none",
            metadata: paymentIntent.metadata,
          },
        };
      },
    },
  };
}
