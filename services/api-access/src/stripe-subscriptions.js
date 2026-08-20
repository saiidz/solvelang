import { createHash } from "node:crypto";

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

  function webhookNormalizationIdempotencyKey(eventId, operation, paymentMethodId) {
    const identity = `${eventId}\u0000${operation}\u0000${paymentMethodId}`;
    return `api-subscription-webhook-${createHash("sha256").update(identity).digest("hex")}`;
  }

  async function supportedPaymentMethodById(paymentMethodId) {
    if (typeof paymentMethodId !== "string") return null;
    let paymentMethod;
    try {
      paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    } catch (error) {
      if (error?.code === "resource_missing") return null;
      throw error;
    }
    return paymentMethod?.type === "card" || paymentMethod?.type === "link" ? paymentMethod : null;
  }

  async function ownedPaymentMethod(paymentMethodId, customerId) {
    const paymentMethod = await supportedPaymentMethodById(paymentMethodId);
    return paymentMethod && belongsToCustomer(paymentMethod, customerId) ? paymentMethod : null;
  }

  async function paidInvoicePaymentMethod(invoices, customerId) {
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
      const paymentMethod = await supportedPaymentMethodById(objectId(paymentIntent.payment_method));
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

  async function listAttachedCards(customerId) {
    const attached = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 10 });
    return (attached?.data ?? [])
      .filter((paymentMethod) => paymentMethod?.type === "card" && belongsToCustomer(paymentMethod, customerId));
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
      const attachedPaymentMethods = await listAttachedCards(customerId);
      const subscriptionDefaultId = objectId(subscription.default_payment_method);
      const customerDefaultId = objectId(customer.invoice_settings?.default_payment_method);
      const candidates = [
        ["subscription_default", subscriptionDefaultId],
        ["customer_default", customerDefaultId],
      ];
      let paymentMethod = null;
      let paymentMethodSource = null;
      for (const [source, paymentMethodId] of candidates) {
        const candidate = await ownedPaymentMethod(paymentMethodId, customerId);
        if (candidate) {
          paymentMethod = candidate;
          paymentMethodSource = source;
          break;
        }
      }
      if (!paymentMethod) {
        paymentMethod = await paidInvoicePaymentMethod(invoices, customerId);
        if (paymentMethod) paymentMethodSource = "paid_invoice";
      }
      if (!paymentMethod && attachedPaymentMethods.length === 1) {
        [paymentMethod] = attachedPaymentMethods;
        paymentMethodSource = "single_attached";
      }
      return {
        subscription,
        paymentMethod,
        paymentMethodSource,
        defaultPaymentMethodId: subscriptionDefaultId ?? customerDefaultId ?? objectId(paymentMethod),
        attachedPaymentMethods,
        invoices,
      };
    },

    async normalizeSuccessfulSubscriptionPaymentMethod({ customerId, subscriptionId, eventId }) {
      if (eventId !== undefined && (typeof eventId !== "string" || !/^[A-Za-z0-9_.:-]+$/.test(eventId) || eventId.length > 200)) {
        throw new Error("Stripe event ID is invalid for payment-method normalization.");
      }
      const { invoices } = await managementSources({ customerId, subscriptionId });
      const paymentMethod = await paidInvoicePaymentMethod(invoices, customerId);
      if (!paymentMethod) return false;
      const customerArgs = [customerId, { invoice_settings: { default_payment_method: paymentMethod.id } }];
      const subscriptionArgs = [subscriptionId, { default_payment_method: paymentMethod.id }];
      if (eventId) {
        customerArgs.push({
          idempotencyKey: webhookNormalizationIdempotencyKey(eventId, "customer-default", paymentMethod.id),
        });
        subscriptionArgs.push({
          idempotencyKey: webhookNormalizationIdempotencyKey(eventId, "subscription-default", paymentMethod.id),
        });
      }
      await stripe.customers.update(...customerArgs);
      await stripe.subscriptions.update(...subscriptionArgs);
      return true;
    },

    async createPaymentMethodSetup({ accountId, customerId }) {
      return stripe.setupIntents.create({
        customer: customerId,
        usage: "off_session",
        metadata: { accountId, purpose: "api_subscription_payment_method" },
      });
    },

    async retrievePaymentMethodSetup({ setupIntentId }) {
      return stripe.setupIntents.retrieve(setupIntentId);
    },

    async setDefaultPaymentMethod({ customerId, subscriptionId, paymentMethodId }) {
      const paymentMethod = await ownedPaymentMethod(paymentMethodId, customerId);
      if (!paymentMethod || paymentMethod.type !== "card") {
        return { applied: false, reason: "not_owned" };
      }
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
      await stripe.subscriptions.update(subscriptionId, {
        default_payment_method: paymentMethodId,
      });
      return { applied: true, paymentMethod };
    },

    async detachPaymentMethod({ customerId, subscriptionId, paymentMethodId }) {
      const [subscription, customer, paymentMethod] = await Promise.all([
        stripe.subscriptions.retrieve(subscriptionId),
        stripe.customers.retrieve(customerId),
        ownedPaymentMethod(paymentMethodId, customerId),
      ]);
      if (!paymentMethod || paymentMethod.type !== "card") {
        return { detached: false, reason: "not_owned" };
      }
      if (!belongsToCustomer(subscription, customerId) || customer?.deleted || customer?.id !== customerId) {
        throw new Error("Stripe subscription ownership mismatch.");
      }
      const subscriptionDefaultId = objectId(subscription.default_payment_method);
      const customerDefaultId = objectId(customer.invoice_settings?.default_payment_method);
      if (paymentMethodId === subscriptionDefaultId || paymentMethodId === customerDefaultId) {
        return { detached: false, reason: "default" };
      }
      await stripe.paymentMethods.detach(paymentMethodId);
      return { detached: true };
    },

    async setCancelAtPeriodEnd({ subscriptionId, cancelAtPeriodEnd }) {
      return stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: cancelAtPeriodEnd,
      });
    },

    async changeSubscriptionPlan({ subscriptionId, priceId, plan, upgrade = false }) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const items = subscription?.items?.data ?? [];
      if (items.length !== 1 || typeof items[0]?.id !== "string") {
        throw new Error("Stripe subscription must contain exactly one managed plan item.");
      }

      const changed = await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: items[0].id, price: priceId, quantity: 1 }],
        proration_behavior: upgrade ? "always_invoice" : "create_prorations",
        ...(upgrade ? { payment_behavior: "pending_if_incomplete" } : {}),
      });

      if (upgrade && changed?.pending_update) {
        return { applied: false, pending: true, subscription: changed };
      }

      const finalized = await stripe.subscriptions.update(subscriptionId, {
        metadata: { ...(subscription.metadata ?? {}), plan },
        cancel_at_period_end: false,
      });
      return { applied: true, pending: false, subscription: finalized };
    },

    constructWebhookEvent(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    },
  };
}
