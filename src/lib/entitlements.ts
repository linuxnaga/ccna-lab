import type { SupabaseClient } from "@supabase/supabase-js";
import type { LabSummary } from "./courses";

/** Stripe subscription states that grant access to paid labs. */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export interface Subscription {
  status: string;
  current_period_end: string | null;
}

export async function getSubscription(
  supabase: SupabaseClient,
  userId: string,
): Promise<Subscription | null> {
  const { data } = await supabase
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export function isPro(sub: Subscription | null): boolean {
  return !!sub && ACTIVE_STATUSES.has(sub.status);
}

export function canPlay(lab: LabSummary, sub: Subscription | null): boolean {
  return lab.free || isPro(sub);
}
