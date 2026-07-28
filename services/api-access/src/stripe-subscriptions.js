export function createStripeSubscriptionGateway(stripe, webhookSecret) {
  if (!stripe?.checkout?.sessions || !stripe?.webhooks) throw new Error("Stripe client is required.");
  if (typeof webhookSecret !== "string" || !webhookSecret) throw new Error("Stripe webhook secret is required.");

  return {
    async createCheckoutSession({ accountId, requestId, email, plan, priceId, customerId, successUrl, cancelUrl }) {
      return stripe.checkout.sessions.create({
        mode: "subscription",
        client_reference_id: accountId,
        ...(customerId ? { customer: customerId } : { customer_email: email }),
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { accountId, plan, requestId },
        subscription_data: { metadata: { accountId, email, plan } },
      }, { idempotencyKey: `api-subscription-checkout-${requestId}` });
    },

    constructWebhookEvent(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    },
  };
}
