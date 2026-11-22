import type { Topology } from "../types";

export type Mode = "user" | "priv" | "config" | "if" | "router" | "vlan" | "pc";

export interface Iface {
  /** Full name, e.g. "GigabitEthernet0/0", "FastEthernet0/1", "Vlan1". */
  name: string;
  ip?: number;
  mask?: number;
  shutdown: boolean;
  description?: string;
  /** Present on switch physical ports only. */
  switchport?: { mode: "access" | "trunk" | "dynamic"; accessVlan: number };
}

export interface StaticRoute {
  net: number;
  mask: number;
  nextHop: number;
}

export interface OspfNetwork {
  net: number;
  wildcard: number;
  area: number;
}

export interface OspfProcess {
  pid: number;
  routerId?: number;
  networks: OspfNetwork[];
}

export interface Device {
  id: string;
  kind: "router" | "switch" | "pc";
  hostname: string;
  mode: Mode;
  /** Context for sub-modes. */
  ctx: { iface?: string; ospfPid?: number; vlan?: number };
  interfaces: Record<string, Iface>;
  /** Switch VLAN database (id -> name). */
  vlans: Record<number, string>;
  staticRoutes: StaticRoute[];
  ospf: OspfProcess | null;
  /** Switches and PCs: default gateway. */
  defaultGateway?: number;
  /** Has "copy run start" been run since the last change? */
  saved: boolean;
}

export interface CiscoState {
  devices: Record<string, Device>;
  topology: Topology;
  /** Monotonic counter, handy for React keys / effects. */
  rev: number;
}

export const IFACE_TYPES = [
  { full: "GigabitEthernet", short: "Gi" },
  { full: "FastEthernet", short: "Fa" },
  { full: "Vlan", short: "Vlan" },
] as const;

export function shortName(full: string): string {
  for (const t of IFACE_TYPES) {
    if (full.startsWith(t.full)) return t.short + full.slice(t.full.length);
  }
  return full;
}

interface DeviceSpec {
  id: string;
  hostname?: string;
  kind: "router" | "switch" | "pc";
  /** Router: Gig port count (GigabitEthernet0/0..n-1). Switch: Fa port count (FastEthernet0/1..n). */
  ports?: number;
}

export function makeDevice(spec: DeviceSpec): Device {
  const interfaces: Record<string, Iface> = {};
  if (spec.kind === "router") {
    for (let i = 0; i < (spec.ports ?? 3); i++) {
      const name = `GigabitEthernet0/${i}`;
      interfaces[name] = { name, shutdown: true };
    }
  } else if (spec.kind === "switch") {
    for (let i = 1; i <= (spec.ports ?? 24); i++) {
      const name = `FastEthernet0/${i}`;
      interfaces[name] = { name, shutdown: false, switchport: { mode: "dynamic", accessVlan: 1 } };
    }
    for (let i = 1; i <= 2; i++) {
      const name = `GigabitEthernet0/${i}`;
      interfaces[name] = { name, shutdown: false, switchport: { mode: "dynamic", accessVlan: 1 } };
    }
    interfaces["Vlan1"] = { name: "Vlan1", shutdown: true };
  } else {
    interfaces["Ethernet0"] = { name: "Ethernet0", shutdown: false };
  }
  return {
    id: spec.id,
    kind: spec.kind,
    hostname: spec.hostname ?? (spec.kind === "router" ? "Router" : spec.kind === "switch" ? "Switch" : spec.id),
    mode: spec.kind === "pc" ? "pc" : "user",
    ctx: {},
    interfaces,
    vlans: spec.kind === "switch" ? { 1: "default" } : {},
    staticRoutes: [],
    ospf: null,
    saved: true,
  };
}

export function updateDevice(state: CiscoState, id: string, fn: (d: Device) => Device): CiscoState {
  return { ...state, devices: { ...state.devices, [id]: fn(state.devices[id]) }, rev: state.rev + 1 };
}

/** Deep-ish clone of a device so command handlers can mutate freely. */
export function cloneDevice(d: Device): Device {
  return structuredClone(d);
}
