export function createStripeSubscriptionGateway(stripe, webhookSecret) {
  if (!stripe?.checkout?.sessions || !stripe?.billingPortal?.sessions || !stripe?.webhooks) {
    throw new Error("Stripe client is required.");
  }
  if (typeof webhookSecret !== "string" || !webhookSecret) throw new Error("Stripe webhook secret is required.");

  return {
    async createCheckoutSession({ accountId, requestId, email, plan, priceId, customerId, returnUrl }) {
      return stripe.checkout.sessions.create({
        mode: "subscription",
        ui_mode: "embedded",
        redirect_on_completion: "if_required",
        client_reference_id: accountId,
        ...(customerId ? { customer: customerId } : { customer_email: email }),
        line_items: [{ price: priceId, quantity: 1 }],
        return_url: returnUrl,
        metadata: { accountId, plan, requestId },
        subscription_data: { metadata: { accountId, email, plan } },
      }, { idempotencyKey: `api-subscription-checkout-${requestId}` });
    },

    async createPortalSession({ customerId, returnUrl }) {
      return stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
    },

    constructWebhookEvent(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    },
  };
}
