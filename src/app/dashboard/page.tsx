import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Circle, Lock, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { COURSES } from "@/lib/courses";
import { canPlay, getSubscription, isPro } from "@/lib/entitlements";
import { rankFor } from "@/lib/ranks";
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
  const xp = profile?.xp ?? 0;
  const rank = rankFor(xp);
  const done = new Set((progress ?? []).filter((p) => p.completed_at).map((p) => `${p.course_id}/${p.lab_id}`));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {checkout === "success" && (
        <p className="mb-6 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          Payment received. Pro access turns on as soon as Stripe confirms it, usually within a few seconds. Refresh if labs still show as locked.
        </p>
      )}

      <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-emerald-400">operator@{profile?.display_name ?? user.email}</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">
              Lvl {rank.level}: <span className="text-cyan-300">{rank.title}</span>
            </h1>
          </div>
          <div className="text-right">
            <span className={`rounded border px-2 py-1 font-mono text-xs ${pro ? "border-cyan-400/50 text-cyan-300" : "border-slate-600 text-slate-400"}`}>
              {pro ? "PRO" : "FREE"}
            </span>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between font-mono text-xs text-slate-400">
            <span>{xp} XP</span>
            <span>{rank.next ? `${rank.next.xp} XP to Lvl ${rank.next.level}` : "Max rank"}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400" style={{ width: `${rank.progress * 100}%` }} />
          </div>
        </div>
        <div className="mt-4">
          {pro ? (
            <StripeButton endpoint="/api/stripe/portal" className="text-sm text-cyan-300 hover:underline">Manage subscription</StripeButton>
          ) : (
            <StripeButton endpoint="/api/stripe/checkout" className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400">
              Upgrade to Pro to unlock every lab
            </StripeButton>
          )}
        </div>
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-3">
        {COURSES.map((course) => (
          <div key={course.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-5">
            <p className="font-mono text-xs text-slate-400">{course.vendor} · {course.exam}</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{course.title}</h2>
            {course.status === "coming-soon" ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-400"><Clock className="h-4 w-4" /> Coming soon</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {course.labs.map((lab) => {
                  const completed = done.has(`${course.id}/${lab.id}`);
                  const playable = canPlay(lab, sub);
                  const Icon = completed ? CheckCircle2 : playable ? Circle : Lock;
                  const row = (
                    <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${playable ? "border-slate-700 hover:border-cyan-400/60" : "border-slate-800 opacity-60"}`}>
                      <Icon className={`h-4 w-4 ${completed ? "text-emerald-400" : playable ? "text-cyan-300" : "text-amber-400"}`} />
                      <span className="flex-1 text-slate-200">{lab.title}</span>
                      <span className="font-mono text-xs text-slate-400">+{lab.xp} XP</span>
                    </div>
                  );
                  return (
                    <li key={lab.id}>
                      {playable ? <Link href={`/labs/${course.id}/${lab.id}`}>{row}</Link> : row}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
