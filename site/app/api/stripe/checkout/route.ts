import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

type PlanKey = "pro" | "api_starter" | "api_growth" | "custom_setup";

const priceEnvByPlan: Record<PlanKey, string> = {
  pro: "STRIPE_PRICE_PRO_MONTHLY",
  api_starter: "STRIPE_PRICE_API_STARTER_MONTHLY",
  api_growth: "STRIPE_PRICE_API_GROWTH_MONTHLY",
  custom_setup: "STRIPE_PRICE_CUSTOM_SETUP",
};

const modeByPlan: Record<PlanKey, "subscription" | "payment"> = {
  pro: "subscription",
  api_starter: "subscription",
  api_growth: "subscription",
  custom_setup: "payment",
};

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  return new Stripe(secretKey, {
    apiVersion: "2026-04-22.dahlia",
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const plan = String(body.plan || "pro") as PlanKey;

    if (!Object.prototype.hasOwnProperty.call(priceEnvByPlan, plan)) {
      return NextResponse.json({ error: "Invalid plan selected." }, { status: 400 });
    }

    const priceEnvName = priceEnvByPlan[plan];
    const priceId = process.env[priceEnvName];

    if (!priceId) {
      return NextResponse.json(
        { error: `Missing Stripe price env var: ${priceEnvName}` },
        { status: 500 }
      );
    }

    if (!priceId.startsWith("price_")) {
      return NextResponse.json(
        { error: `${priceEnvName} must be a Stripe Price ID that starts with price_` },
        { status: 500 }
      );
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://main.d2g6xr80xgj85l.amplifyapp.com";

    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: modeByPlan[plan],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      success_url: `${siteUrl}/success?checkout=success&plan=${plan}`,
      cancel_url: `${siteUrl}/pricing?checkout=cancelled`,
      metadata: {
        plan,
        source: "solvelang-site",
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create checkout session.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
