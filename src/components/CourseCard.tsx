import Link from "next/link";
import { Lock, Terminal, Clock } from "lucide-react";
import type { Course } from "@/lib/courses";

const ACCENTS: Record<Course["accent"], string> = {
  cyan: "text-cyan-300 border-cyan-500/40",
  emerald: "text-emerald-300 border-emerald-500/40",
  amber: "text-amber-300 border-amber-500/40",
  rose: "text-rose-300 border-rose-500/40",
};

export function CourseCard({ course, href, pro }: { course: Course; href?: string; pro?: boolean }) {
  const soon = course.status === "coming-soon";
  const body = (
    <div
      className={`h-full rounded-xl border bg-slate-900/70 p-5 transition ${
        soon ? "border-slate-800 opacity-70" : "border-slate-700 hover:border-cyan-400/60 hover:glow-cyan"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`rounded border px-2 py-0.5 font-mono text-xs ${ACCENTS[course.accent]}`}>
          {course.vendor} · {course.exam}
        </span>
        {soon ? (
          <span className="flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3.5 w-3.5" /> Coming soon</span>
        ) : (
          <Terminal className="h-4 w-4 text-cyan-300" aria-hidden />
        )}
      </div>
      <h3 className="mt-3 text-lg font-semibold text-white">{course.title}</h3>
      <p className="mt-1 text-sm text-slate-400">{course.description}</p>
      {!soon && (
        <ul className="mt-4 space-y-1.5">
          {course.labs.map((lab) => (
            <li key={lab.id} className="flex items-center justify-between text-sm">
              <span className="text-slate-300">{lab.title}</span>
              {lab.free ? (
                <span className="font-mono text-xs text-emerald-400">FREE</span>
              ) : pro ? (
                <span className="font-mono text-xs text-cyan-400">PRO</span>
              ) : (
                <Lock className="h-3.5 w-3.5 text-amber-400" aria-label="Requires Pro" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return href && !soon ? <Link href={href}>{body}</Link> : body;
}
