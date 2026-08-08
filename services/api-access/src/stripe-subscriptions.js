export function createStripeSubscriptionGateway(stripe, webhookSecret) {
  if (!stripe?.checkout?.sessions
    || !stripe?.subscriptions
    || !stripe?.customers
    || !stripe?.invoices
    || !stripe?.invoicePayments
    || !stripe?.paymentIntents
    || !stripe?.paymentMethods
    || !stripe?.setupIntents
    || !stripe?.webhooks) {
    throw new Error("Stripe client is required.");
  }
  if (typeof webhookSecret !== "string" || !webhookSecret) throw new Error("Stripe webhook secret is required.");

  function objectId(value) {
    return typeof value === "string" ? value : value?.id;
  }

  function belongsToCustomer(resource, customerId) {
    return objectId(resource?.customer) === customerId;
  }

  async function ownedCard(paymentMethodId, customerId) {
    if (typeof paymentMethodId !== "string") return null;
    let paymentMethod;
    try {
      paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    } catch (error) {
      if (error?.code === "resource_missing") return null;
      throw error;
    }
    return paymentMethod?.type === "card" && belongsToCustomer(paymentMethod, customerId)
      ? paymentMethod
      : null;
  }

  async function paidInvoiceCard(invoices, customerId) {
    const invoice = invoices?.data
      ?.filter((candidate) => candidate?.status === "paid" && candidate.amount_paid > 0)
      .sort((left, right) => (right.created ?? 0) - (left.created ?? 0))[0];
    if (!invoice?.id) return null;
    const invoicePayments = await stripe.invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 10 });
    for (const invoicePayment of invoicePayments?.data ?? []) {
      const paymentIntentId = invoicePayment?.status === "paid"
        && invoicePayment?.payment?.type === "payment_intent"
        ? objectId(invoicePayment.payment.payment_intent)
        : undefined;
      if (!paymentIntentId) continue;
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (!belongsToCustomer(paymentIntent, customerId)) continue;
      const paymentMethod = await ownedCard(objectId(paymentIntent.payment_method), customerId);
      if (paymentMethod) return paymentMethod;
    }
    return null;
  }

  async function managementSources({ customerId, subscriptionId }) {
    const [subscription, customer, invoices] = await Promise.all([
      stripe.subscriptions.retrieve(subscriptionId),
      stripe.customers.retrieve(customerId),
      stripe.invoices.list({ customer: customerId, limit: 12 }),
    ]);
    if (!belongsToCustomer(subscription, customerId)
      || customer?.deleted
      || customer?.id !== customerId) {
      throw new Error("Stripe subscription ownership mismatch.");
    }
    return { subscription, customer, invoices };
  }

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
      const { subscription, customer, invoices } = await managementSources({ customerId, subscriptionId });
      const candidates = [
        ["subscription_default", objectId(subscription.default_payment_method)],
        ["customer_default", objectId(customer.invoice_settings?.default_payment_method)],
      ];
      for (const [paymentMethodSource, paymentMethodId] of candidates) {
        const paymentMethod = await ownedCard(paymentMethodId, customerId);
        if (paymentMethod) return { subscription, paymentMethod, paymentMethodSource, attachedPaymentMethods: [], invoices };
      }
      const invoicePaymentMethod = await paidInvoiceCard(invoices, customerId);
      if (invoicePaymentMethod) {
        return { subscription, paymentMethod: invoicePaymentMethod, paymentMethodSource: "paid_invoice", attachedPaymentMethods: [], invoices };
      }
      const attached = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 10 });
      const attachedPaymentMethods = (attached?.data ?? [])
        .filter((paymentMethod) => paymentMethod?.type === "card" && belongsToCustomer(paymentMethod, customerId));
      return {
        subscription,
        paymentMethod: attachedPaymentMethods.length === 1 ? attachedPaymentMethods[0] : null,
        paymentMethodSource: attachedPaymentMethods.length === 1 ? "single_attached" : null,
        attachedPaymentMethods,
        invoices,
      };
    },

    async normalizeSuccessfulSubscriptionPaymentMethod({ customerId, subscriptionId }) {
      const { invoices } = await managementSources({ customerId, subscriptionId });
      const paymentMethod = await paidInvoiceCard(invoices, customerId);
      if (!paymentMethod) return false;
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethod.id },
      });
      await stripe.subscriptions.update(subscriptionId, {
        default_payment_method: paymentMethod.id,
      });
      return true;
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

    async changeSubscriptionPlan({ subscriptionId, priceId, plan }) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const items = subscription?.items?.data ?? [];
      if (items.length !== 1 || typeof items[0]?.id !== "string") {
        throw new Error("Stripe subscription must contain exactly one managed plan item.");
      }
      return stripe.subscriptions.update(subscriptionId, {
        items: [{ id: items[0].id, price: priceId, quantity: 1 }],
        metadata: { ...(subscription.metadata ?? {}), plan },
        cancel_at_period_end: false,
        proration_behavior: "create_prorations",
      });
    },

    constructWebhookEvent(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    },
  };
}
