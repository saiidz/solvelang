import { ApiAccessError } from "./service.js";

const MANAGEABLE_STATUSES = new Set(["trialing", "active", "past_due", "unpaid"]);
const PLAN_NAMES = new Set(["developer", "pro", "business"]);
const PLAN_RANK = Object.freeze({ developer: 1, pro: 2, business: 3 });

function cleanId(value, label, prefix) {
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_subscription_management", `${label} is invalid.`);
  const cleaned = value.trim();
  const pattern = new RegExp(`^${prefix}_[A-Za-z0-9]+$`);
  if (!pattern.test(cleaned) || cleaned.length > 200) {
    throw new ApiAccessError(400, "invalid_subscription_management", `${label} is invalid.`);
  }
  return cleaned;
}

function requiredAccount(account) {
  if (!account?.stripeCustomerId || !account?.stripeSubscriptionId) {
    throw new ApiAccessError(409, "subscription_missing", "No managed subscription is available for this account.");
  }
  return {
    ...account,
    stripeCustomerId: cleanId(account.stripeCustomerId, "Stripe customer ID", "cus"),
    stripeSubscriptionId: cleanId(account.stripeSubscriptionId, "Stripe subscription ID", "sub"),
  };
}

function paymentMethodSummary(paymentMethod, defaultPaymentMethodId) {
  if (!paymentMethod || typeof paymentMethod !== "object") return null;
  const id = typeof paymentMethod.id === "string" ? paymentMethod.id : null;
  if (paymentMethod.type === "link") {
    return {
      id,
      type: "link",
      label: "Link",
      brand: null,
      last4: null,
      expMonth: null,
      expYear: null,
      isDefault: Boolean(id && id === defaultPaymentMethodId),
    };
  }
  const card = paymentMethod.card;
  if (!card || typeof card !== "object") return null;
  const brand = typeof card.brand === "string" ? card.brand : "card";
  const last4 = typeof card.last4 === "string" && /^\d{4}$/.test(card.last4) ? card.last4 : null;
  const expMonth = Number.isSafeInteger(card.exp_month) ? card.exp_month : null;
  const expYear = Number.isSafeInteger(card.exp_year) ? card.exp_year : null;
  if (!last4) return null;
  const displayBrand = brand.charAt(0).toUpperCase() + brand.slice(1);
  return {
    id,
    type: "card",
    label: `${displayBrand} •••• ${last4}`,
    brand,
    last4,
    expMonth,
    expYear,
    isDefault: Boolean(id && id === defaultPaymentMethodId),
  };
}

function invoiceSummary(invoice) {
  return {
    id: typeof invoice?.id === "string" ? invoice.id : "",
    number: typeof invoice?.number === "string" ? invoice.number : null,
    status: typeof invoice?.status === "string" ? invoice.status : "unknown",
    amountPaid: Number.isSafeInteger(invoice?.amount_paid) ? invoice.amount_paid : 0,
    amountDue: Number.isSafeInteger(invoice?.amount_due) ? invoice.amount_due : 0,
    currency: typeof invoice?.currency === "string" ? invoice.currency.toUpperCase() : "USD",
    createdAt: Number.isSafeInteger(invoice?.created) ? invoice.created * 1_000 : null,
  };
}

export function createSubscriptionManagementService({ gateway, apiAccessService, priceIds = {}, enabled = false }) {
  const requiredGatewayMethods = [
    "retrieveSubscriptionManagement",
    "createPaymentMethodSetup",
    "retrievePaymentMethodSetup",
    "setDefaultPaymentMethod",
    "detachPaymentMethod",
    "setCancelAtPeriodEnd",
    "changeSubscriptionPlan",
  ];
  if (!gateway || requiredGatewayMethods.some((method) => typeof gateway[method] !== "function")) {
    throw new Error("Stripe subscription management gateway is required.");
  }
  if (!apiAccessService || typeof apiAccessService.getSubscriptionAccount !== "function") {
    throw new Error("API access service is required.");
  }

  async function accountFor(accountId) {
    if (!enabled) throw new ApiAccessError(503, "subscription_management_disabled", "API subscription management is not enabled.");
    if (typeof accountId !== "string" || !/^acct_[A-Za-z0-9]+$/.test(accountId)) {
      throw new ApiAccessError(400, "invalid_subscription_management", "Account ID is invalid.");
    }
    return requiredAccount(await apiAccessService.getSubscriptionAccount(accountId));
  }

  async function requireManageableAccount(accountId) {
    const account = await accountFor(accountId);
    if (!MANAGEABLE_STATUSES.has(account.subscriptionStatus)) {
      throw new ApiAccessError(409, "subscription_not_manageable", "The subscription cannot be changed in its current state.");
    }
    return account;
  }

  async function getManagement({ accountId }) {
    const account = await accountFor(accountId);
    const state = await gateway.retrieveSubscriptionManagement({
      customerId: account.stripeCustomerId,
      subscriptionId: account.stripeSubscriptionId,
    });
    const invoices = Array.isArray(state?.invoices?.data)
      ? state.invoices.data.map(invoiceSummary).filter((invoice) => invoice.id)
      : [];
    const defaultPaymentMethodId = typeof state?.defaultPaymentMethodId === "string"
      ? state.defaultPaymentMethodId
      : null;
    const attachedPaymentMethods = Array.isArray(state?.attachedPaymentMethods)
      ? state.attachedPaymentMethods
        .map((method) => paymentMethodSummary(method, defaultPaymentMethodId))
        .filter(Boolean)
      : [];
    return {
      subscription: {
        plan: account.plan ?? null,
        status: typeof state?.subscription?.status === "string" ? state.subscription.status : account.subscriptionStatus,
        currentPeriodEnd: account.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: state?.subscription?.cancel_at_period_end === true,
      },
      paymentMethod: paymentMethodSummary(state?.paymentMethod, defaultPaymentMethodId),
      attachedPaymentMethods,
      invoices,
    };
  }

  async function createPaymentSetup({ accountId }) {
    const account = await requireManageableAccount(accountId);
    const setupIntent = await gateway.createPaymentMethodSetup({
      accountId,
      customerId: account.stripeCustomerId,
    });
    if (!setupIntent?.id || typeof setupIntent.client_secret !== "string" || !setupIntent.client_secret) {
      throw new ApiAccessError(502, "stripe_setup_unavailable", "Payment method setup is temporarily unavailable.");
    }
    return { setupIntentId: setupIntent.id, clientSecret: setupIntent.client_secret };
  }

  async function completePaymentSetup({ accountId, setupIntentId }) {
    const account = await requireManageableAccount(accountId);
    const cleanSetupIntentId = cleanId(setupIntentId, "SetupIntent ID", "seti");
    const setupIntent = await gateway.retrievePaymentMethodSetup({ setupIntentId: cleanSetupIntentId });
    const setupCustomerId = typeof setupIntent?.customer === "string" ? setupIntent.customer : setupIntent?.customer?.id;
    const paymentMethodId = typeof setupIntent?.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent?.payment_method?.id;
    if (setupIntent?.status !== "succeeded"
      || setupCustomerId !== account.stripeCustomerId
      || typeof paymentMethodId !== "string") {
      throw new ApiAccessError(409, "payment_setup_incomplete", "The payment method setup has not completed successfully.");
    }
    const result = await gateway.setDefaultPaymentMethod({
      customerId: account.stripeCustomerId,
      subscriptionId: account.stripeSubscriptionId,
      paymentMethodId: cleanId(paymentMethodId, "Payment method ID", "pm"),
    });
    if (result?.applied !== true) {
      throw new ApiAccessError(409, "payment_method_not_owned", "That payment method is not available for this account.");
    }
    return getManagement({ accountId });
  }

  async function setPaymentMethodDefault({ accountId, paymentMethodId }) {
    const account = await requireManageableAccount(accountId);
    const cleanPaymentMethodId = cleanId(paymentMethodId, "Payment method ID", "pm");
    const result = await gateway.setDefaultPaymentMethod({
      customerId: account.stripeCustomerId,
      subscriptionId: account.stripeSubscriptionId,
      paymentMethodId: cleanPaymentMethodId,
    });
    if (result?.applied !== true) {
      throw new ApiAccessError(404, "payment_method_not_found", "That saved card is not available for this account.");
    }
    return getManagement({ accountId });
  }

  async function removePaymentMethod({ accountId, paymentMethodId }) {
    const account = await requireManageableAccount(accountId);
    const cleanPaymentMethodId = cleanId(paymentMethodId, "Payment method ID", "pm");
    const result = await gateway.detachPaymentMethod({
      customerId: account.stripeCustomerId,
      subscriptionId: account.stripeSubscriptionId,
      paymentMethodId: cleanPaymentMethodId,
    });
    if (result?.detached === true) return getManagement({ accountId });
    if (result?.reason === "default") {
      throw new ApiAccessError(409, "payment_method_is_default", "Choose another default payment method before removing this card.");
    }
    throw new ApiAccessError(404, "payment_method_not_found", "That saved card is not available for this account.");
  }

  async function setCancellation({ accountId, cancelAtPeriodEnd }) {
    const account = await requireManageableAccount(accountId);
    if (typeof cancelAtPeriodEnd !== "boolean") {
      throw new ApiAccessError(400, "invalid_subscription_management", "Cancellation choice is invalid.");
    }
    await gateway.setCancelAtPeriodEnd({
      subscriptionId: account.stripeSubscriptionId,
      cancelAtPeriodEnd,
    });
    return getManagement({ accountId });
  }

  async function changePlan({ accountId, plan }) {
    const account = await requireManageableAccount(accountId);
    if (typeof plan !== "string" || !PLAN_NAMES.has(plan)) {
      throw new ApiAccessError(400, "invalid_subscription_plan", "Subscription plan is invalid.");
    }
    if (!PLAN_NAMES.has(account.plan)) {
      throw new ApiAccessError(409, "subscription_plan_unknown", "The current subscription plan cannot be changed.");
    }
    if (plan === account.plan) {
      throw new ApiAccessError(409, "subscription_plan_unchanged", "This subscription is already on that plan.");
    }
    const priceId = priceIds[plan];
    if (typeof priceId !== "string" || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
      throw new ApiAccessError(503, "subscription_plan_unavailable", "That subscription plan is not available.");
    }
    const upgrade = PLAN_RANK[plan] > PLAN_RANK[account.plan];
    const result = await gateway.changeSubscriptionPlan({
      subscriptionId: account.stripeSubscriptionId,
      priceId,
      plan,
      upgrade,
    });
    if (result?.applied !== true) {
      throw new ApiAccessError(
        402,
        "subscription_upgrade_payment_required",
        "The upgrade payment could not be completed. Your current plan remains active. Update your payment method and try again.",
      );
    }
    const state = await getManagement({ accountId });
    return {
      ...state,
      subscription: {
        ...state.subscription,
        plan,
        cancelAtPeriodEnd: false,
      },
    };
  }

  return {
    getManagement,
    createPaymentSetup,
    completePaymentSetup,
    setPaymentMethodDefault,
    removePaymentMethod,
    setCancellation,
    changePlan,
  };
}
