import { HelpCircle } from "lucide-react";
import { UI_PARTS } from "@/labs/guides";

const LOOP = [
  "Pick the next open mission on the map below. Missions unlock in order.",
  "Read the incident briefing, then open the Lab Guide for a step-by-step walkthrough.",
  "Click a device on the topology to open its console, then type IOS commands (en, conf t, int g0/0, ...).",
  "Verify with show commands and ping. Objectives tick themselves off as the network gets fixed.",
  "Tick every objective to finish the mission, earn XP and unlock the next one.",
];

/** Collapsible "how to play" panel for the dashboard. */
export function HowItWorks() {
  return (
    <details className="group mt-6 rounded-xl border border-slate-700 bg-slate-900/50 p-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-white">
        <HelpCircle className="h-5 w-5 text-cyan-300" /> How to run a lab
        <span className="ml-auto font-mono text-xs text-slate-400 group-open:hidden">show</span>
        <span className="ml-auto hidden font-mono text-xs text-slate-400 group-open:inline">hide</span>
      </summary>
      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
        {LOOP.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <h3 className="mt-5 font-mono text-xs uppercase tracking-widest text-cyan-300">What each part does</h3>
      <dl className="mt-2 grid gap-3 md:grid-cols-2">
        {UI_PARTS.map(([n, w]) => (
          <div key={n}><dt className="text-sm font-medium text-slate-100">{n}</dt><dd className="text-xs text-slate-400">{w}</dd></div>
        ))}
      </dl>
    </details>
  );
}
