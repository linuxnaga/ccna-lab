import Link from "next/link";
import { Trophy, Zap, Network, ShieldCheck } from "lucide-react";
import { COURSES } from "@/lib/courses";
import { CourseCard } from "@/components/CourseCard";
import { BRAND } from "@/lib/site";

const FEATURES = [
  { icon: Network, title: "Live topology", text: "Click a device to open its console. Links turn green as you configure them." },
  { icon: Zap, title: "Realistic CLI", text: "Mode changes, abbreviations, show commands, ping and authentic IOS errors." },
  { icon: Trophy, title: "XP and ranks", text: "Climb from Cable Crimper to CCNA Architect. Keep your command streak alive." },
  { icon: ShieldCheck, title: "Multi-vendor", text: "Cisco first. F5 and Palo Alto tracks are on the way, on the same account." },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <section className="text-center">
        <p className="font-mono text-sm text-emerald-400">&gt; show certification-readiness</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Learn networking by <span className="text-cyan-300">breaking and fixing</span> it.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-slate-400">
          {BRAND} is a gamified lab simulator for network certifications. Configure routers and
          switches in your browser, earn XP, and unlock harder missions.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login?mode=signup" className="rounded-md bg-cyan-500 px-5 py-2.5 font-medium text-slate-950 hover:bg-cyan-400">
            Start free lab
          </Link>
          <Link href="/pricing" className="rounded-md border border-slate-700 px-5 py-2.5 text-slate-200 hover:border-slate-500">
            See pricing
          </Link>
        </div>
      </section>

      <section className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <Icon className="h-5 w-5 text-cyan-300" aria-hidden />
            <h2 className="mt-3 font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-slate-400">{text}</p>
          </div>
        ))}
      </section>

      <section className="mt-16">
        <h2 className="font-mono text-sm uppercase tracking-widest text-slate-400">Courses</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {COURSES.map((c) => (
            <CourseCard key={c.id} course={c} href="/dashboard" />
          ))}
        </div>
      </section>
    </div>
  );
}
