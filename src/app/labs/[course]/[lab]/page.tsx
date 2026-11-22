import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Lock, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCourse, getLab } from "@/lib/courses";
import { canPlay, getSubscription } from "@/lib/entitlements";

export default async function LabPage({ params }: { params: Promise<{ course: string; lab: string }> }) {
  const { course: courseId, lab: labId } = await params;
  const course = getCourse(courseId);
  const lab = getLab(courseId, labId);
  if (!course || !lab) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/labs/${courseId}/${labId}`);

  // Paywall is enforced on the server, not just hidden in the UI.
  if (!canPlay(lab, await getSubscription(supabase, user.id))) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <Lock className="mx-auto h-8 w-8 text-amber-400" />
        <h1 className="mt-4 text-2xl font-semibold text-white">{lab.title} is a Pro lab</h1>
        <p className="mt-2 text-slate-400">Upgrade to Pro to unlock every lab in every course.</p>
        <Link href="/pricing" className="mt-6 inline-block rounded-md bg-cyan-500 px-5 py-2 font-medium text-slate-950 hover:bg-cyan-400">
          See pricing
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center">
      <p className="font-mono text-xs text-slate-400">{course.vendor} · {lab.domain}</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">{lab.title}</h1>
      <div className="mx-auto mt-8 max-w-md rounded-xl border border-slate-700 bg-slate-900/70 p-6">
        <Wrench className="mx-auto h-6 w-6 text-cyan-300" />
        <p className="mt-3 text-slate-300">The lab workspace (topology and CLI) is being built in the next step.</p>
      </div>
    </div>
  );
}
