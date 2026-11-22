import { Binary, Flame, Network, Route, Server, ShieldCheck, type LucideIcon } from "lucide-react";
import { rankFor } from "@/lib/ranks";
import type { Badge } from "@/lib/progression";

const DOMAIN_ICONS: LucideIcon[] = [Binary, Network, Route, Server, ShieldCheck];

/** Player progression bar: rank, XP, streak and domain badges. */
export function Hud({ xp, streak, badges, compact }: { xp: number; streak?: number; badges: Badge[]; compact?: boolean }) {
  const rank = rankFor(xp);
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-slate-700 bg-slate-900/80 ${compact ? "px-4 py-2.5" : "p-5"}`}>
      <div className="min-w-[180px]">
        <p className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Lvl {rank.level}</p>
        <p className={`${compact ? "text-base" : "text-xl"} font-semibold text-cyan-300`}>{rank.title}</p>
      </div>
      <div className="min-w-[220px] flex-1">
        <div className="flex justify-between font-mono text-[11px] text-slate-400">
          <span>{xp} XP</span>
          <span>{rank.next ? `${rank.next.xp - xp} XP to ${rank.next.title}` : "Max rank"}</span>
        </div>
        <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={Math.round(rank.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="XP to next rank">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-[width] duration-700" style={{ width: `${rank.progress * 100}%` }} />
        </div>
      </div>
      {streak !== undefined && (
        <div className={`flex items-center gap-1.5 font-mono text-sm ${streak >= 5 ? "text-amber-300" : "text-slate-400"}`} title="Consecutive valid commands">
          <Flame className={`h-4 w-4 ${streak >= 5 ? "animate-pulse" : ""}`} /> {streak}
        </div>
      )}
      <div className="flex items-center gap-1.5" aria-label="Domain badges">
        {badges.map((b, i) => {
          const Icon = DOMAIN_ICONS[i] ?? ShieldCheck;
          return (
            <span
              key={b.domain}
              title={`${b.domain}: ${b.earned ? "badge earned" : b.available ? "complete every lab in this domain" : "missions coming soon"}`}
              className={`flex h-8 w-8 items-center justify-center rounded-md border ${
                b.earned ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]" : "border-slate-700 text-slate-600"
              }`}
            >
              <Icon className="h-4 w-4" />
            </span>
          );
        })}
      </div>
    </div>
  );
}
