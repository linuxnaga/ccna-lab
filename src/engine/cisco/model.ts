import type { Topology } from "../types";

export type Mode = "user" | "priv" | "config" | "if" | "router" | "vlan" | "dhcp" | "line" | "nacl" | "pc";

export interface Iface {
  /** Full name, e.g. "GigabitEthernet0/0", "FastEthernet0/1", "Vlan1". */
  name: string;
  ip?: number;
  mask?: number;
  shutdown: boolean;
  description?: string;
  /** Present on switch physical ports only. */
  switchport?: {
    /** "dynamic" is DTP dynamic auto (the 2960 default); "desirable" is dynamic desirable. */
    mode: "access" | "trunk" | "dynamic" | "desirable";
    accessVlan: number;
    /** 802.1Q native VLAN on trunks (default 1). */
    nativeVlan?: number;
    /** VLANs allowed on the trunk; undefined means all (1-4094). */
    allowedVlans?: number[];
    /** "switchport nonegotiate": DTP frames are not sent. */
    nonegotiate?: boolean;
    portfast?: boolean;
    bpduguard?: boolean;
    portSecurity?: PortSecurity;
  };
  /** Router subinterfaces ("GigabitEthernet0/0.10"): the 802.1Q VLAN they carry. */
  dot1q?: number;
  /** EtherChannel membership ("channel-group 1 mode active"). */
  channelGroup?: { id: number; mode: ChannelMode };
  /** HSRP groups on this interface. */
  hsrp?: Record<number, HsrpGroup>;
  /** IPv6 global unicast addresses. A link-local address exists whenever ipv6Enabled or any address is set. */
  ipv6?: Ipv6Addr[];
  ipv6Enabled?: boolean;
  /** "ip nat inside|outside". */
  nat?: "inside" | "outside";
  /** "ip access-group <acl> in|out". */
  acl?: { in?: string; out?: string };
  /** "ip helper-address": DHCP relay target. */
  helper?: number;
  /** "ip ospf priority" (default 1; 0 = never DR/BDR). */
  ospfPriority?: number;
  /** CDP / LLDP per-interface switches (CDP defaults on, LLDP tx/rx default on once "lldp run"). */
  cdp?: boolean;
  lldpTx?: boolean;
  lldpRx?: boolean;
}

export type ChannelMode = "active" | "passive" | "on" | "desirable" | "auto";

export interface PortSecurity {
  enabled: boolean;
  max: number;
  sticky: boolean;
  /** Statically configured secure MACs. */
  macs: string[];
  violation: "shutdown" | "restrict" | "protect";
}

export interface HsrpGroup {
  ip?: number;
  priority: number;
  preempt: boolean;
}

export interface Ipv6Addr {
  addr: bigint;
  prefix: number;
  eui64?: boolean;
}

export interface StaticRoute6 {
  net: bigint;
  prefix: number;
  nextHop: bigint;
}

export interface StaticRoute {
  net: number;
  mask: number;
  nextHop: number;
  /** Administrative distance; omitted means 1. Higher values make a floating static. */
  ad?: number;
}

/** Address match used by ACLs: "any" is { ip: 0, wildcard: 255.255.255.255 }. */
export interface AddrMatch {
  ip: number;
  wildcard: number;
}

export interface AclEntry {
  action: "permit" | "deny";
  /** Standard ACLs only match the source; extended ACLs also match protocol and destination. */
  proto?: "ip" | "icmp" | "tcp" | "udp";
  src: AddrMatch;
  dst?: AddrMatch;
  port?: number;
  /** Sequence number; named ACLs always carry one, numbered lists are implicitly 10, 20, ... */
  seq?: number;
}

export type NatRule =
  | { kind: "overload"; acl: string; iface: string }
  | { kind: "static"; local: number; global: number };

export interface NatTranslation {
  proto: "icmp";
  insideGlobal: number;
  insideLocal: number;
  outside: number;
}

export interface DhcpPool {
  name: string;
  net?: number;
  mask?: number;
  defaultRouter?: number;
  dns?: number;
  domain?: string;
}

export interface LineConfig {
  password?: string;
  login?: "line" | "local";
  transport?: "ssh" | "telnet" | "all" | "none";
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
  /** Interfaces set with "passive-interface": advertised, but no hellos / neighbors. */
  passive?: string[];
  /** "default-information originate": advertise this router's static default route. */
  defaultOriginate?: boolean;
}

export type SnmpCommunity = { name: string; access: "ro" | "rw" };

export interface Management {
  ntpServers: number[];
  /** "ntp master <stratum>": this router serves time. */
  ntpMaster?: number;
  timezone?: { name: string; offset: number };
  logHosts: number[];
  /** Syslog trap severity 0-7 (default 6, informational). */
  logTrap?: number;
  timestamps: boolean;
  snmp: SnmpCommunity[];
  snmpLocation?: string;
  snmpContact?: string;
  cdp: boolean;
  lldp: boolean;
}

export interface Device {
  id: string;
  kind: "router" | "switch" | "pc";
  hostname: string;
  mode: Mode;
  /** Context for sub-modes. */
  ctx: { iface?: string; ospfPid?: number; vlan?: number; pool?: string; line?: "con" | "vty"; range?: string[]; acl?: string };
  interfaces: Record<string, Iface>;
  /** Switch VLAN database (id -> name). */
  vlans: Record<number, string>;
  staticRoutes: StaticRoute[];
  ospf: OspfProcess | null;
  /** Switches and PCs: default gateway. */
  defaultGateway?: number;
  /** Has "copy run start" been run since the last change? */
  saved: boolean;
  /** Burned-in MAC, used for STP bridge IDs and DHCP bindings ("0001.4A11.0001"). */
  mac: string;
  /** Access lists, keyed by number or name as typed. */
  acls: Record<string, AclEntry[]>;
  /** Named ACLs ("ip access-list extended NAME") and their type. Numbered lists are not listed here. */
  namedAcls: Record<string, "standard" | "extended">;
  mgmt: Management;
  /** Hosts: TCP ports a server listens on, and whether it serves NTP. */
  services?: { tcp: number[]; ntp?: boolean };
  nat: { rules: NatRule[]; translations: NatTranslation[] };
  dhcp: { excluded: [number, number][]; pools: Record<string, DhcpPool> };
  /** Switches: spanning-tree mode and per-VLAN bridge priority (without the sys-id-ext). */
  stp: { mode: "pvst" | "rapid-pvst"; priority: Record<number, number> };
  security: {
    enableSecret?: string;
    enablePassword?: string;
    passwordEncryption: boolean;
    domainName?: string;
    rsaBits?: number;
    sshVersion?: 2;
    users: Record<string, string>;
    banner?: string;
    lines: { con: LineConfig; vty: LineConfig };
  };
  ipv6Routing: boolean;
  staticRoutes6: StaticRoute6[];
  /** PCs: IPv6 default gateway (global or link-local). */
  gateway6?: bigint;
  /** PCs: the router that leased the current address, when set by DHCP. */
  dhcpServer?: string;
  dns?: number;
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
  { full: "Loopback", short: "Lo" },
  { full: "Port-channel", short: "Po" },
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

/** Deterministic Cisco-style MAC from a device id. */
export function macFor(id: string): string {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hex = h.toString(16).toUpperCase().padStart(8, "0");
  return `00E0.${hex.slice(0, 4)}.${hex.slice(4, 8)}`;
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
    mac: macFor(spec.id),
    ipv6Routing: false,
    staticRoutes6: [],
    acls: {},
    namedAcls: {},
    mgmt: { ntpServers: [], logHosts: [], timestamps: false, snmp: [], cdp: spec.kind !== "pc", lldp: false },
    nat: { rules: [], translations: [] },
    dhcp: { excluded: [], pools: {} },
    stp: { mode: "pvst", priority: {} },
    security: { passwordEncryption: false, users: {}, lines: { con: {}, vty: {} } },
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
