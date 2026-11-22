import { Check } from "lucide-react";
import { StripeButton } from "@/components/StripeButton";
import { createClient } from "@/lib/supabase/server";
import { getSubscription, isPro } from "@/lib/entitlements";
import Link from "next/link";
import { Suspense } from "react";
import { ProPrice } from "@/components/ProPrice";
import { paymentsMode } from "@/lib/billing";

const FREE = ["First lab of every course", "XP, ranks and streaks", "Cheat sheet"];
const PRO = ["Every lab in every course", "New vendor tracks as they launch (F5, Palo Alto)", "Progressive hints", "Cancel anytime"];

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ canceled?: string }> }) {
  const { canceled } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const pro = user ? isPro(await getSubscription(supabase, user.id)) : false;
  const payments = paymentsMode();

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-center text-3xl font-bold text-white">One subscription, every course</h1>
      <p className="mt-2 text-center text-slate-400">Start free. Upgrade when you want the full lab library.</p>
      {canceled && (
        <p className="mx-auto mt-6 max-w-md rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-center text-sm text-amber-200">
          Checkout was canceled. You have not been charged.
        </p>
      )}

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-6">
          <h2 className="font-mono text-sm uppercase tracking-widest text-emerald-400">Free</h2>
          <p className="mt-2 text-3xl font-bold text-white">$0</p>
          <ul className="mt-5 space-y-2">
            {FREE.map((f) => (
              <li key={f} className="flex gap-2 text-sm text-slate-300"><Check className="h-4 w-4 text-emerald-400" />{f}</li>
            ))}
          </ul>
          <Link href={user ? "/dashboard" : "/login?mode=signup"} className="mt-6 block rounded-md border border-slate-600 py-2 text-center text-slate-200 hover:border-slate-400">
            {user ? "Go to dashboard" : "Create free account"}
          </Link>
        </div>

        <div className="rounded-xl border border-cyan-500/50 bg-slate-900/70 p-6 glow-cyan">
          <h2 className="font-mono text-sm uppercase tracking-widest text-cyan-300">Pro</h2>
          <p className="mt-2 text-3xl font-bold text-white">
            {payments === "stripe" ? (
              <Suspense fallback={<span className="text-slate-500">…</span>}>
                <ProPrice />
              </Suspense>
            ) : (
              <>
                $0 <span className="text-base font-normal text-slate-400">free during launch</span>
              </>
            )}
          </p>
          <ul className="mt-5 space-y-2">
            {PRO.map((f) => (
              <li key={f} className="flex gap-2 text-sm text-slate-300"><Check className="h-4 w-4 text-cyan-300" />{f}</li>
            ))}
          </ul>
          <div className="mt-6">
            {pro && payments === "off" ? (
              <Link href="/dashboard" className="block w-full rounded-md border border-cyan-500 py-2 text-center text-cyan-200 hover:bg-cyan-500/10">
                You have Pro. Go to dashboard
              </Link>
            ) : pro ? (
              <StripeButton endpoint="/api/stripe/portal" className="w-full rounded-md border border-cyan-500 py-2 text-cyan-200 hover:bg-cyan-500/10">
                Manage subscription
              </StripeButton>
            ) : payments === "off" ? (
              <StripeButton endpoint="/api/billing/unlock" className="w-full rounded-md bg-cyan-500 py-2 font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60">
                Unlock Pro (free)
              </StripeButton>
            ) : (
              <StripeButton endpoint="/api/stripe/checkout" className="w-full rounded-md bg-cyan-500 py-2 font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60">
                Upgrade to Pro
              </StripeButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
