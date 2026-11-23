"use client";

import Link from "next/link";
import { useEffect, useMemo, useReducer, useState } from "react";
import { CheckSquare, Square, LifeBuoy, RotateCcw, Trophy, X, BookOpen } from "lucide-react";
import { getLabDefinition } from "@/labs";
import type { LabDefinition } from "@/engine/types";
import { HINT_COST, getCourse } from "@/lib/courses";
import { domainBadges } from "@/lib/progression";
import { Hud } from "@/components/Hud";
import { CheatSheet } from "./CheatSheet";
import { TopologyView } from "./Topology";
import { Terminal, type TermLine } from "./Terminal";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Lab = LabDefinition<any>;

interface WsState {
  net: any;
  consoles: Record<string, TermLine[]>;
  history: Record<string, string[]>;
  active: string;
  hints: number;
  streak: number;
  bestStreak: number;
  commands: string[];
  /** Set once, on the command that completes every objective. */
  completed: boolean;
  showVictory: boolean;
}

type Action =
  | { type: "exec"; line: string }
  | { type: "select"; device: string }
  | { type: "interrupt" }
  | { type: "hint" }
  | { type: "reset" }
  | { type: "closeVictory" };

function init(lab: Lab): WsState {
  const net = lab.initialState();
  const consoles: Record<string, TermLine[]> = {};
  for (const d of lab.topology.devices) {
    consoles[d.id] = lab.engine.banner(net, d.id).map((text) => ({ text, kind: "out" as const }));
  }
  return { net, consoles, history: {}, active: lab.startDevice, hints: 0, streak: 0, bestStreak: 0, commands: [], completed: false, showVictory: false };
}

function reducer(lab: Lab) {
  return (s: WsState, a: Action): WsState => {
    switch (a.type) {
      case "select":
        return { ...s, active: a.device };
      case "reset":
        return init(lab);
      case "closeVictory":
        return { ...s, showVictory: false };
      case "hint":
        return { ...s, hints: Math.min(lab.hints.length, s.hints + 1) };
      case "interrupt":
        return reducer(lab)(s, { type: "exec", line: "end" });
      case "exec": {
        const dev = s.active;
        const prompt = lab.engine.prompt(s.net, dev);
        const echo: TermLine = { text: prompt + a.line, kind: "cmd" };
        const r = lab.engine.exec(s.net, dev, a.line);
        const out: TermLine[] = r.output.map((text) => ({
          text,
          kind: text.startsWith("%") && /^%(LINK|LINEPROTO|OSPF|SYS)-/.test(text) ? "log" : r.ok ? "out" : "err",
        }));
        const typed = a.line.trim() !== "" && !a.line.trim().endsWith("?");
        const history = typed ? { ...s.history, [dev]: [...(s.history[dev] ?? []), a.line].slice(-100) } : s.history;
        const streak = !typed ? s.streak : r.ok ? s.streak + 1 : 0;
        const commands = r.ok && r.canonical && !s.commands.includes(r.canonical) ? [...s.commands, r.canonical] : s.commands;
        const justCompleted = !s.completed && lab.objectives.every((o) => o.check(r.state));
        return {
          ...s,
          completed: s.completed || justCompleted,
          showVictory: s.showVictory || justCompleted,
          net: r.state,
          consoles: { ...s.consoles, [dev]: [...s.consoles[dev], echo, ...out].slice(-500) },
          history,
          streak,
          bestStreak: Math.max(s.bestStreak, streak),
          commands,
        };
      }
    }
  };
}

interface Player {
  xp: number;
  completed: string[];
}

export function LabWorkspace({ courseId, labId, player }: { courseId: string; labId: string; player: Player }) {
  const lab = getLabDefinition(courseId, labId);
  if (!lab) return <p className="p-10 text-center text-slate-400">This lab is not available yet.</p>;
  return <Workspace lab={lab} courseId={courseId} player={player} />;
}

function Workspace({ lab, courseId, player }: { lab: Lab; courseId: string; player: Player }) {
  const r = useMemo(() => reducer(lab), [lab]);
  const [s, dispatch] = useReducer(r, lab, init);
  const [award, setAward] = useState<{ awarded: number } | { error: string } | null>(null);
  const [briefingOpen, setBriefingOpen] = useState(true);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [focusTick, setFocusTick] = useState(0);

  const status = useMemo(
    () => Object.fromEntries(lab.topology.links.map((l) => [l.id, lab.engine.linkStatus(s.net, lab.topology, l)])),
    [lab, s.net],
  );
  const checks = useMemo(() => lab.objectives.map((o) => ({ ...o, done: o.check(s.net) })), [lab, s.net]);
  const { completed, hints, commands } = s;

  useEffect(() => {
    if (!completed) return;
    fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: lab.courseId, labId: lab.labId, hintsUsed: hints, commands }),
    })
      .then(async (res) => setAward(res.ok ? await res.json() : { error: (await res.json().catch(() => ({}))).error ?? "Could not save progress" }))
      .catch(() => setAward({ error: "Could not save progress" }));
    // Only fire once, when the lab flips to completed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);

  const course = getCourse(courseId);
  const labs = course?.labs ?? [];
  const idx = labs.findIndex((l) => l.id === lab.labId);
  const nextLab = labs[idx + 1];
  const baseXp = labs[idx]?.xp ?? 0;
  const xp = player.xp + (award && "awarded" in award ? award.awarded : 0);
  const completedSet = new Set(player.completed);
  if (award && "awarded" in award) completedSet.add(lab.labId);
  const badges = course ? domainBadges(course, completedSet) : [];
  const activeLabel = lab.topology.devices.find((d) => d.id === s.active)?.label ?? s.active;

  function reset() {
    dispatch({ type: "reset" });
    setAward(null);
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4">
      <Hud xp={xp} streak={s.streak} badges={badges} compact />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-slate-400">{course?.vendor} · {labs[idx]?.domain}</p>
          <h1 className="text-xl font-semibold text-white">{lab.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCheatOpen(true)} className="flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-cyan-400 hover:text-cyan-200">
            <BookOpen className="h-4 w-4" /> Cheat Sheet
          </button>
          <button onClick={reset} className="flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-rose-400 hover:text-rose-200">
            <RotateCcw className="h-4 w-4" /> Reset Lab
          </button>
        </div>
      </div>

      {briefingOpen && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-amber-300">Incident briefing</p>
              {lab.briefing.map((p, i) => <p key={i} className="mt-1.5 text-sm text-slate-300">{p}</p>)}
            </div>
            <button onClick={() => setBriefingOpen(false)} aria-label="Dismiss briefing" className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col gap-4">
          <div className="aspect-[5/3] rounded-lg border border-slate-700 bg-slate-950/70">
            <TopologyView topology={lab.topology} status={status} active={s.active} onSelect={(d) => {
              dispatch({ type: "select", device: d });
              setFocusTick((t) => t + 1);
            }} />
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
            <h2 className="font-mono text-xs uppercase tracking-widest text-cyan-300">Objectives</h2>
            <ul className="mt-2 space-y-1.5">
              {checks.map((c) => (
                <li key={c.id} className={`flex items-start gap-2 text-sm ${c.done ? "text-emerald-300" : "text-slate-300"}`}>
                  {c.done ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0" /> : <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />}
                  <span className={c.done ? "line-through decoration-emerald-500/50" : ""}>{c.text}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-slate-800 pt-3">
              <button
                onClick={() => dispatch({ type: "hint" })}
                disabled={s.hints >= lab.hints.length}
                className="flex items-center gap-1.5 rounded-md border border-amber-500/50 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
              >
                <LifeBuoy className="h-4 w-4" /> Request Tier-2 Support (−{HINT_COST} XP)
              </button>
              {lab.hints.slice(0, s.hints).map((h, i) => (
                <p key={i} className="mt-2 rounded-md bg-slate-950/70 p-2 font-mono text-xs text-amber-100"><span className="text-amber-400">Hint {i + 1}:</span> {h}</p>
              ))}
            </div>
          </div>
        </div>
        <div className="h-[70vh] min-h-[420px]">
          <Terminal
            title={`${activeLabel} console`}
            lines={s.consoles[s.active]}
            prompt={lab.engine.prompt(s.net, s.active)}
            history={s.history[s.active] ?? []}
            onSubmit={(line) => dispatch({ type: "exec", line })}
            onComplete={(line) => lab.engine.complete(s.net, s.active, line)}
            onInterrupt={() => dispatch({ type: "interrupt" })}
            focusKey={focusTick}
          />
        </div>
      </div>

      {cheatOpen && <CheatSheet onClose={() => setCheatOpen(false)} />}

      {s.showVictory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <Confetti />
          <div className="relative w-full max-w-md rounded-xl border border-emerald-400/60 bg-slate-900 p-6 text-center shadow-[0_0_60px_rgba(16,185,129,0.25)]">
            <Trophy className="mx-auto h-10 w-10 text-amber-300" />
            <h2 className="mt-3 text-2xl font-bold text-white">Mission complete</h2>
            <p className="mt-1 text-slate-400">{lab.title}</p>
            <p className="mt-4 font-mono text-3xl font-bold text-emerald-300">
              +{award && "awarded" in award ? award.awarded : Math.max(0, baseXp - s.hints * HINT_COST)} XP
            </p>
            {award && "awarded" in award && award.awarded === 0 && <p className="mt-1 text-xs text-slate-400">Already completed before, so no new XP this time.</p>}
            {award && "error" in award && <p className="mt-1 text-xs text-rose-300">{award.error}</p>}
            <p className="mt-2 text-xs text-slate-400">Hints used: {s.hints} · Best streak: {s.bestStreak}</p>
            <div className="mt-4 text-left">
              <p className="font-mono text-xs uppercase tracking-widest text-cyan-300">Commands mastered</p>
              <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {s.commands.map((c) => <span key={c} className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{c}</span>)}
              </div>
            </div>
            <div className="mt-6 flex justify-center gap-2">
              <button onClick={() => dispatch({ type: "closeVictory" })} className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:border-slate-400">Stay here</button>
              {nextLab ? (
                <Link href={`/labs/${courseId}/${nextLab.id}`} className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400">Next mission: {nextLab.title}</Link>
              ) : (
                <Link href="/dashboard" className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400">Back to dashboard</Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CONFETTI_COLORS = ["#22d3ee", "#10b981", "#f59e0b", "#f43f5e", "#a78bfa"];

function Confetti() {
  // Deterministic pseudo-random layout so render stays pure.
  const pieces = Array.from({ length: 80 }, (_, i) => {
    const r = (n: number) => ((Math.sin(i * 9301 + n * 49297) + 1) / 2);
    return { left: r(1) * 100, delay: r(2) * 0.8, dur: 2.2 + r(3) * 1.6, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], rot: r(4) * 360 };
  });
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, transform: `rotate(${p.rot}deg)` }}
        />
      ))}
    </div>
  );
}
