"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { Topology } from "@/engine/types";
import { DEVICE_KINDS, MODE_INFO, PORT_TYPES, UI_PARTS, type LabGuide as Guide } from "@/labs/guides";

const TABS = ["Walkthrough", "Devices", "Workspace"] as const;
type Tab = (typeof TABS)[number];

const short = (p: string) => p.replace(/^GigabitEthernet/, "Gi").replace(/^FastEthernet/, "Fa").replace(/^Ethernet/, "Eth");

/** Lab Guide modal: how to run this lab, what each device does, and how the workspace works. */
export function LabGuide({
  guide,
  topology,
  startDevice,
  onClose,
  onOpenDevice,
}: {
  guide: Guide | undefined;
  topology: Topology;
  startDevice: string;
  onClose: () => void;
  onOpenDevice: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("Walkthrough");
  const label = (id: string) => topology.devices.find((d) => d.id === id)?.label ?? id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Lab guide" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-cyan-500/40 bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-800 px-6 pt-5">
          <div className="flex gap-1" role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-t-md px-3 py-2 text-sm ${tab === t ? "border-b-2 border-cyan-400 text-cyan-200" : "text-slate-400 hover:text-slate-200"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <button onClick={onClose} aria-label="Close" className="mb-2 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-y-auto p-6">
          {tab === "Walkthrough" && (
            <div>
              <p className="text-sm text-slate-300">
                Every lab follows the same loop: read the briefing, click a device, move to the right mode, configure, then verify with a show command or ping. Objectives tick themselves off as soon as the network is right. The console for <span className="font-mono text-cyan-300">{label(startDevice)}</span> opens first.
              </p>
              {guide ? (
                <ol className="mt-4 space-y-3">
                  {guide.steps.map((st, i) => {
                    const mode = MODE_INFO[st.mode];
                    return (
                      <li key={i} className="flex gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-500/60 font-mono text-xs text-cyan-300">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <button onClick={() => onOpenDevice(st.device)} className="rounded border border-cyan-500/50 px-1.5 py-0.5 font-mono text-cyan-200 hover:bg-cyan-500/10" title="Open this device's console">
                              {label(st.device)}
                            </button>
                            <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-slate-300" title={mode.reach}>
                              {st.mode === "pc" ? mode.prompt : `${label(st.device)}${mode.prompt}`}
                            </span>
                            {st.at && <span className="font-mono text-emerald-300">{st.at}</span>}
                          </div>
                          <p className="mt-1.5 text-sm text-slate-200">{st.task}</p>
                          {st.verify && <p className="mt-1 text-xs text-slate-400">Verify: <span className="font-mono text-amber-200">{st.verify}</span></p>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="mt-4 text-sm text-slate-400">No walkthrough for this lab yet. Use the objectives and hints.</p>
              )}
              <h3 className="mt-6 font-mono text-xs uppercase tracking-widest text-cyan-300">IOS modes</h3>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {Object.entries(MODE_INFO).map(([k, m]) => (
                  <div key={k}>
                    <dt className="text-sm text-slate-200"><span className="font-mono text-emerald-300">{m.prompt}</span> {m.name}</dt>
                    <dd className="text-xs text-slate-400">{m.reach}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-slate-400">exit goes up one level, end (or Ctrl+Z) jumps back to #, and do &lt;command&gt; runs a show or ping from any config mode. Stuck? Request Tier-2 Support for the exact commands.</p>
            </div>
          )}

          {tab === "Devices" && (
            <div className="space-y-3">
              {topology.devices.map((d) => {
                const ports = topology.links.flatMap((l) =>
                  l.a.device === d.id ? [[l.a.port, l.b]] as const : l.b.device === d.id ? [[l.b.port, l.a]] as const : [],
                );
                return (
                  <div key={d.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-sm text-white">{d.label} <span className="text-xs text-slate-400">· {DEVICE_KINDS[d.kind]?.name ?? d.kind}</span></p>
                      <button onClick={() => onOpenDevice(d.id)} className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-cyan-400 hover:text-cyan-200">Open console</button>
                    </div>
                    {guide?.roles[d.id] && <p className="mt-1 text-sm text-slate-300">{guide.roles[d.id]}</p>}
                    {ports.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {ports.map(([port, peer]) => (
                          <li key={port} className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">
                            {short(port)} → {label(peer.device)} {short(peer.port)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              <h3 className="pt-3 font-mono text-xs uppercase tracking-widest text-cyan-300">Device types</h3>
              <dl className="space-y-1.5">
                {Object.entries(DEVICE_KINDS).filter(([k]) => topology.devices.some((d) => d.kind === k)).map(([k, v]) => (
                  <div key={k}><dt className="text-sm text-slate-200">{v.name}</dt><dd className="text-xs text-slate-400">{v.what}</dd></div>
                ))}
              </dl>
              <h3 className="pt-3 font-mono text-xs uppercase tracking-widest text-cyan-300">Ports</h3>
              <dl className="space-y-1.5">
                {PORT_TYPES.map(([n, w]) => <div key={n}><dt className="font-mono text-[13px] text-emerald-300">{n}</dt><dd className="text-xs text-slate-400">{w}</dd></div>)}
              </dl>
            </div>
          )}

          {tab === "Workspace" && (
            <dl className="space-y-2.5">
              {UI_PARTS.map(([n, w]) => (
                <div key={n}><dt className="text-sm font-medium text-slate-100">{n}</dt><dd className="text-sm text-slate-400">{w}</dd></div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
