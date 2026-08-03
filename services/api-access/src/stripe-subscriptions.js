export function createStripeSubscriptionGateway(stripe, webhookSecret) {
  if (!stripe?.checkout?.sessions
    || !stripe?.subscriptions
    || !stripe?.customers
    || !stripe?.invoices
    || !stripe?.paymentMethods
    || !stripe?.setupIntents
    || !stripe?.webhooks) {
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

    async retrieveSubscriptionManagement({ customerId, subscriptionId }) {
      const [subscription, customer, invoices] = await Promise.all([
        stripe.subscriptions.retrieve(subscriptionId),
        stripe.customers.retrieve(customerId),
        stripe.invoices.list({ customer: customerId, limit: 12 }),
      ]);
      const subscriptionPaymentMethod = typeof subscription?.default_payment_method === "string"
        ? subscription.default_payment_method
        : subscription?.default_payment_method?.id;
      const customerPaymentMethod = customer && !customer.deleted
        ? (typeof customer.invoice_settings?.default_payment_method === "string"
          ? customer.invoice_settings.default_payment_method
          : customer.invoice_settings?.default_payment_method?.id)
        : undefined;
      const paymentMethodId = subscriptionPaymentMethod || customerPaymentMethod;
      const paymentMethod = paymentMethodId ? await stripe.paymentMethods.retrieve(paymentMethodId) : null;
      return { subscription, paymentMethod, invoices };
    },

    async createPaymentMethodSetup({ accountId, customerId }) {
      return stripe.setupIntents.create({
        customer: customerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: { accountId, purpose: "api_subscription_payment_method" },
      });
    },

    async retrievePaymentMethodSetup({ setupIntentId }) {
      return stripe.setupIntents.retrieve(setupIntentId);
    },

    async setDefaultPaymentMethod({ customerId, subscriptionId, paymentMethodId }) {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
      return stripe.subscriptions.update(subscriptionId, {
        default_payment_method: paymentMethodId,
      });
    },

    async setCancelAtPeriodEnd({ subscriptionId, cancelAtPeriodEnd }) {
      return stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: cancelAtPeriodEnd,
      });
    },

    constructWebhookEvent(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    },
  };
}
