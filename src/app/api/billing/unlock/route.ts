import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FREE_UNLOCK_PREFIX, paymentsMode } from "@/lib/billing";

/** Payments-off mode: grant Pro to the signed-in user with no checkout. */
export async function POST() {
  if (paymentsMode() !== "off") {
    return NextResponse.json({ error: "Payments are enabled; use checkout" }, { status: 404 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { error } = await createAdminClient().from("subscriptions").upsert(
    {
      user_id: user.id,
      stripe_subscription_id: `${FREE_UNLOCK_PREFIX}${user.id}`,
      status: "active",
      price_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return NextResponse.json({ error: "Could not unlock Pro" }, { status: 500 });

  return NextResponse.json({ url: "/dashboard?unlocked=1" });
}
