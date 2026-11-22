import { stripe } from "@/lib/stripe";

async function loadPrice(priceId: string) {
  try {
    const price = await stripe().prices.retrieve(priceId);
    return {
      amount: new Intl.NumberFormat("en", { style: "currency", currency: price.currency }).format(
        (price.unit_amount ?? 0) / 100,
      ),
      interval: price.recurring?.interval ?? "month",
    };
  } catch {
    return null;
  }
}

/** Shows the Pro price straight from Stripe so it is only set in one place. */
export async function ProPrice() {
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  const price = priceId ? await loadPrice(priceId) : null;
  if (!price) return <span className="text-base font-normal text-slate-400">Price unavailable</span>;
  return (
    <>
      {price.amount} <span className="text-base font-normal text-slate-400">/ {price.interval}</span>
    </>
  );
}
