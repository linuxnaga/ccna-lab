import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { COURSES } from "@/lib/courses";
import { getSubscription, isPro } from "@/lib/entitlements";
import { domainBadges } from "@/lib/progression";
import { Hud } from "@/components/Hud";
import { SkillMap } from "@/components/SkillMap";
import { StripeButton } from "@/components/StripeButton";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");

  const [{ data: profile }, sub, { data: progress }] = await Promise.all([
    supabase.from("profiles").select("display_name, xp").eq("id", user.id).maybeSingle(),
    getSubscription(supabase, user.id),
    supabase.from("lab_progress").select("course_id, lab_id, completed_at").eq("user_id", user.id),
  ]);

  const pro = isPro(sub);
  const completedIn = (courseId: string) =>
    new Set((progress ?? []).filter((p) => p.completed_at && p.course_id === courseId).map((p) => p.lab_id as string));
  const ccna = COURSES[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {checkout === "success" && (
        <p className="mb-6 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          Payment received. Pro access turns on as soon as Stripe confirms it, usually within a few seconds. Refresh if missions still show as Pro.
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-emerald-400">operator@{profile?.display_name ?? user.email}</p>
          <h1 className="text-2xl font-semibold text-white">Network Operations Center</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded border px-2 py-1 font-mono text-xs ${pro ? "border-cyan-400/50 text-cyan-300" : "border-slate-600 text-slate-400"}`}>{pro ? "PRO" : "FREE"}</span>
          {pro ? (
            <StripeButton endpoint="/api/stripe/portal" className="text-sm text-cyan-300 hover:underline">Manage subscription</StripeButton>
          ) : (
            <StripeButton endpoint="/api/stripe/checkout" className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400">Upgrade to Pro</StripeButton>
          )}
        </div>
      </div>

      <div className="mt-5">
        <Hud xp={profile?.xp ?? 0} badges={domainBadges(ccna, completedIn(ccna.id))} />
      </div>

      <section className="mt-8 rounded-xl border border-slate-700 bg-slate-900/50 p-6">
        <p className="font-mono text-xs text-slate-400">{ccna.vendor} · {ccna.exam}</p>
        <h2 className="text-xl font-semibold text-white">{ccna.title}: mission map</h2>
        <div className="mt-6">
          <SkillMap course={ccna} completed={completedIn(ccna.id)} sub={sub} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-sm uppercase tracking-widest text-slate-400">More tracks</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {COURSES.slice(1).map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 opacity-80">
              <p className="font-mono text-xs text-slate-400">{c.vendor} · {c.exam}</p>
              <h3 className="mt-1 font-semibold text-white">{c.title}</h3>
              <p className="mt-1 text-sm text-slate-400">{c.description}</p>
              <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-500"><Clock className="h-4 w-4" /> Coming soon. Included with Pro.</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
