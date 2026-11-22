import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCourse, getLab, HINT_COST } from "@/lib/courses";
import { isUnlocked } from "@/lib/progression";
import { canPlay, getSubscription } from "@/lib/entitlements";

/**
 * Records a completed lab. XP is computed on the server from the course
 * catalog so the browser cannot award itself arbitrary XP.
 * Body: { courseId, labId, hintsUsed, commands }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const courseId = typeof body?.courseId === "string" ? body.courseId : "";
  const labId = typeof body?.labId === "string" ? body.labId : "";
  const hintsUsed = Math.max(0, Math.min(10, Number(body?.hintsUsed) || 0));
  const commands = Array.isArray(body?.commands)
    ? body.commands.filter((c: unknown): c is string => typeof c === "string").slice(0, 50).map((c: string) => c.slice(0, 80))
    : [];

  const lab = getLab(courseId, labId);
  if (!lab) return NextResponse.json({ error: "Unknown lab" }, { status: 404 });
  if (!canPlay(lab, await getSubscription(supabase, user.id))) {
    return NextResponse.json({ error: "Pro required" }, { status: 403 });
  }

  const { data: done } = await supabase
    .from("lab_progress")
    .select("lab_id")
    .eq("user_id", user.id)
    .eq("course_id", courseId)
    .not("completed_at", "is", null);
  if (!isUnlocked(getCourse(courseId)!, labId, new Set((done ?? []).map((d) => d.lab_id as string)))) {
    return NextResponse.json({ error: "Complete the previous mission first" }, { status: 403 });
  }

  const xp = Math.max(0, lab.xp - hintsUsed * HINT_COST);
  const { data: awarded, error } = await createAdminClient().rpc("complete_lab", {
    p_user: user.id,
    p_course: courseId,
    p_lab: labId,
    p_xp: xp,
    p_hints: hintsUsed,
    p_commands: commands,
  });
  if (error) return NextResponse.json({ error: "Could not save progress" }, { status: 500 });

  return NextResponse.json({ awarded });
}
