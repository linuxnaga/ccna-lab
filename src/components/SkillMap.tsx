import Link from "next/link";
import { CheckCircle2, Lock, PlayCircle, Clock, Crown } from "lucide-react";
import type { Course } from "@/lib/courses";
import type { Subscription } from "@/lib/entitlements";
import { canPlay } from "@/lib/entitlements";
import { isUnlocked } from "@/lib/progression";

/** Domain skill tree: one node per exam domain, missions hanging off each. */
export function SkillMap({ course, completed, sub }: { course: Course; completed: Set<string>; sub: Subscription | null }) {
  return (
    <ol className="relative space-y-4 border-l-2 border-slate-800 pl-6">
      {course.domains.map((domain, i) => {
        const labs = course.labs.filter((l) => l.domain === domain);
        const done = labs.length > 0 && labs.every((l) => completed.has(l.id));
        return (
          <li key={domain} className="relative">
            <span
              className={`absolute -left-[37px] top-1 flex h-6 w-6 items-center justify-center rounded-full border-2 font-mono text-[11px] ${
                done ? "border-emerald-400 bg-emerald-500/20 text-emerald-300" : labs.length ? "border-cyan-400 bg-slate-950 text-cyan-300" : "border-slate-700 bg-slate-950 text-slate-500"
              }`}
            >
              {i + 1}
            </span>
            <h3 className={`font-semibold ${labs.length ? "text-white" : "text-slate-500"}`}>{domain}</h3>
            {labs.length === 0 ? (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500"><Clock className="h-3.5 w-3.5" /> Missions coming soon</p>
            ) : (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {labs.map((lab) => {
                  const isDone = completed.has(lab.id);
                  const paid = canPlay(lab, sub);
                  const open = isUnlocked(course, lab.id, completed);
                  const playable = paid && open;
                  const Icon = isDone ? CheckCircle2 : !paid ? Crown : !open ? Lock : PlayCircle;
                  const note = isDone ? "Completed" : !paid ? "Pro mission" : !open ? "Finish the previous mission" : lab.free ? "Free mission" : "Ready";
                  const card = (
                    <div
                      className={`flex h-full items-start gap-3 rounded-lg border p-3 transition ${
                        playable ? "border-slate-700 bg-slate-900/70 hover:border-cyan-400/70 hover:glow-cyan" : "border-slate-800 bg-slate-900/40 opacity-70"
                      }`}
                    >
                      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isDone ? "text-emerald-400" : !paid ? "text-amber-400" : !open ? "text-slate-500" : "text-cyan-300"}`} />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-100">{lab.title}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{note}</p>
                      </div>
                      <span className="font-mono text-xs text-emerald-300">+{lab.xp}</span>
                    </div>
                  );
                  return <li key={lab.id}>{playable ? <Link href={`/labs/${course.id}/${lab.id}`}>{card}</Link> : !paid ? <Link href="/pricing">{card}</Link> : card}</li>;
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
