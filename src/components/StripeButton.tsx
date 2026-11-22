"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Posts to a Stripe route and follows the returned URL (Checkout or Billing Portal). */
export function StripeButton({
  endpoint,
  children,
  className,
}: {
  endpoint: "/api/stripe/checkout" | "/api/stripe/portal";
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      if (res.status === 401) {
        router.push("/login?mode=signup&next=/pricing");
        return;
      }
      const body = await res.json();
      if (!res.ok || !body.url) throw new Error(body.error ?? "Something went wrong");
      // External Stripe-hosted page.
      window.location.assign(body.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={go} disabled={busy} className={className}>
        {busy ? "Connecting…" : children}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-rose-300">{error}</p>}
    </div>
  );
}
