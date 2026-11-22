"use client";

import type { Topology as Topo, TopologyDevice, LinkStatus } from "@/engine/types";

const SHORT: [RegExp, string][] = [
  [/^GigabitEthernet/, "Gi"],
  [/^FastEthernet/, "Fa"],
  [/^Ethernet/, "Eth"],
];
const short = (p: string) => SHORT.reduce((s, [re, r]) => s.replace(re, r), p);

function DeviceIcon({ d, active }: { d: TopologyDevice; active: boolean }) {
  const stroke = active ? "#22d3ee" : "#64748b";
  const fill = active ? "rgba(34,211,238,0.12)" : "#0b1220";
  switch (d.kind) {
    case "router":
      return (
        <g>
          <circle r={30} fill={fill} stroke={stroke} strokeWidth={2.5} />
          <path d="M-14 -6 L14 -6 M8 -12 L14 -6 L8 0 M14 6 L-14 6 M-8 0 L-14 6 L-8 12" stroke={stroke} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case "switch":
      return (
        <g>
          <rect x={-36} y={-20} width={72} height={40} rx={6} fill={fill} stroke={stroke} strokeWidth={2.5} />
          <path d="M-22 -6 L22 -6 M16 -11 L22 -6 L16 -1 M22 6 L-22 6 M-16 1 L-22 6 L-16 11" stroke={stroke} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    default:
      return (
        <g>
          <rect x={-24} y={-20} width={48} height={32} rx={3} fill={fill} stroke={stroke} strokeWidth={2.5} />
          <path d="M-10 18 L10 18 M0 12 L0 18" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" />
        </g>
      );
  }
}

const labelPos = (d: TopologyDevice) => d.labelPos ?? (d.kind === "pc" ? "below" : "left");

export function TopologyView({
  topology,
  status,
  active,
  onSelect,
}: {
  topology: Topo;
  status: Record<string, LinkStatus>;
  active: string;
  onSelect: (id: string) => void;
}) {
  const pos = Object.fromEntries(topology.devices.map((d) => [d.id, d]));
  return (
    <svg viewBox="0 0 1000 600" className="h-full w-full" role="img" aria-label="Network topology">
      <defs>
        <filter id="glow" filterUnits="userSpaceOnUse" x="-100" y="-100" width="1200" height="800">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {topology.links.map((l) => {
        const a = pos[l.a.device];
        const b = pos[l.b.device];
        const st = status[l.id] ?? { a: false, b: false };
        const up = st.a && st.b;
        const lerp = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        // Status lights sit a fixed distance from each device.
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const pa = lerp(Math.min(0.45, 55 / dist));
        const pb = lerp(1 - Math.min(0.45, 55 / dist));
        // Port labels sit beside the link, offset perpendicular to it.
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = ((b.y - a.y) / len) * 24;
        const ny = (-(b.x - a.x) / len) * 24;
        const la = { x: lerp(0.3).x + nx, y: lerp(0.3).y + ny + 5 };
        const lb = { x: lerp(0.7).x + nx, y: lerp(0.7).y + ny + 5 };
        return (
          <g key={l.id}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={up ? "#10b981" : "#475569"} strokeWidth={3} strokeDasharray={up ? undefined : "8 6"} filter={up ? "url(#glow)" : undefined}>
              {up && <animate attributeName="stroke-opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite" />}
            </line>
            <circle cx={pa.x} cy={pa.y} r={7} fill={st.a ? "#10b981" : "#f43f5e"} filter="url(#glow)" />
            <circle cx={pb.x} cy={pb.y} r={7} fill={st.b ? "#10b981" : "#f43f5e"} filter="url(#glow)" />
            <text x={la.x} y={la.y} fill="#94a3b8" fontSize={15} fontFamily="monospace" textAnchor="middle">{short(l.a.port)}</text>
            <text x={lb.x} y={lb.y} fill="#94a3b8" fontSize={15} fontFamily="monospace" textAnchor="middle">{short(l.b.port)}</text>
          </g>
        );
      })}
      {topology.devices.map((d) => (
        <g
          key={d.id}
          transform={`translate(${d.x} ${d.y})`}
          onClick={() => onSelect(d.id)}
          className="cursor-pointer"
          role="button"
          tabIndex={0}
          aria-label={`Open console for ${d.label}`}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(d.id)}
        >
          <circle r={48} fill="transparent" />
          <DeviceIcon d={d} active={d.id === active} />
          <text
            x={labelPos(d) === "left" ? (d.kind === "switch" ? -48 : -42) : 0}
            y={labelPos(d) === "below" ? 40 : labelPos(d) === "above" ? -42 : 6}
            fill={d.id === active ? "#67e8f9" : "#e2e8f0"}
            fontSize={18}
            fontWeight={600}
            textAnchor={labelPos(d) === "left" ? "end" : "middle"}
            fontFamily="monospace"
          >
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
