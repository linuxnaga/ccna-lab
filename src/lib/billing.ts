import "server-only";

/**
 * Payments mode, from the PAYMENTS_MODE env var:
 * - "stripe": Pro is a paid Stripe subscription (Checkout, Billing Portal, webhook).
 * - "off":    no Stripe needed. "Upgrade" unlocks Pro for that user at no charge.
 * If PAYMENTS_MODE is not set, it is "stripe" when STRIPE_SECRET_KEY is present, else "off".
 */
export type PaymentsMode = "stripe" | "off";

export function paymentsMode(): PaymentsMode {
  const v = process.env.PAYMENTS_MODE?.trim().toLowerCase();
  if (v === "stripe" || v === "off") return v;
  return process.env.STRIPE_SECRET_KEY ? "stripe" : "off";
}

/** Marker used for subscriptions granted in "off" mode (no Stripe object behind them). */
export const FREE_UNLOCK_PREFIX = "free-unlock-";
