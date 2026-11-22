import Link from "next/link";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { LabWorkspace } from "@/components/lab/LabWorkspace";
import { createClient } from "@/lib/supabase/server";
import { getCourse, getLab } from "@/lib/courses";
import { canPlay, getSubscription } from "@/lib/entitlements";
import { isUnlocked } from "@/lib/progression";

export default async function LabPage({ params }: { params: Promise<{ course: string; lab: string }> }) {
  const { course: courseId, lab: labId } = await params;
  const course = getCourse(courseId);
  const lab = getLab(courseId, labId);
  if (!course || !lab) notFound();

  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/labs/${courseId}/${labId}`);

  const [sub, { data: profile }, { data: progress }] = await Promise.all([
    getSubscription(supabase, user.id),
    supabase.from("profiles").select("xp").eq("id", user.id).maybeSingle(),
    supabase.from("lab_progress").select("lab_id").eq("user_id", user.id).eq("course_id", courseId).not("completed_at", "is", null),
  ]);
  const completed = (progress ?? []).map((p) => p.lab_id as string);

  // Paywall is enforced on the server, not just hidden in the UI.
  if (!canPlay(lab, sub)) {
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

  if (!isUnlocked(course, labId, new Set(completed))) {
    const prev = course.labs[course.labs.findIndex((l) => l.id === labId) - 1];
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <Lock className="mx-auto h-8 w-8 text-cyan-300" />
        <h1 className="mt-4 text-2xl font-semibold text-white">Mission locked</h1>
        <p className="mt-2 text-slate-400">Complete &quot;{prev?.title}&quot; to unlock {lab.title}.</p>
        <Link href={`/labs/${courseId}/${prev?.id}`} className="mt-6 inline-block rounded-md bg-cyan-500 px-5 py-2 font-medium text-slate-950 hover:bg-cyan-400">
          Go to {prev?.title}
        </Link>
      </div>
    );
  }

  return <LabWorkspace courseId={courseId} labId={labId} player={{ xp: profile?.xp ?? 0, completed }} />;
}
