import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe -> Supabase sync. Point a Stripe webhook endpoint at /api/stripe/webhook
 * with these events: checkout.session.completed, customer.subscription.created,
 * customer.subscription.updated, customer.subscription.deleted.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode === "subscription" && typeof session.subscription === "string") {
        const sub = await stripe().subscriptions.retrieve(session.subscription);
        await syncSubscription(sub, session.client_reference_id);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      break;
  }

  return NextResponse.json({ received: true });
}

async function syncSubscription(sub: Stripe.Subscription, fallbackUserId?: string | null) {
  const admin = createAdminClient();
  let userId = sub.metadata?.user_id || fallbackUserId || null;

  if (!userId) {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const { data } = await admin.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
    userId = data?.id ?? null;
  }
  if (!userId) {
    console.error("Stripe webhook: no user for subscription", sub.id);
    return;
  }

  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end;
  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: item?.price.id ?? null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error; // non-2xx makes Stripe retry
}
