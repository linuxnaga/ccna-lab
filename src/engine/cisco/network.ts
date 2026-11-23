import type { TopologyLink } from "../types";
import type { ChannelMode, CiscoState, Device, Iface, NatTranslation } from "./model";
import { maskToPrefix, network, prefixToMask, sameSubnet, wildcardMatch } from "./ip";
import { aclPermits, aclPermitsSource } from "./acl";
import { isLinkLocal, linkLocal, network6, sameSubnet6 } from "./ip6";

/* ------------------------------------------------------------------ */
/* Interface and link state                                            */
/* ------------------------------------------------------------------ */

export function findLink(state: CiscoState, dev: string, port: string): { link: TopologyLink; peer: { device: string; port: string } } | null {
  for (const link of state.topology.links) {
    if (link.a.device === dev && link.a.port === port) return { link, peer: link.b };
    if (link.b.device === dev && link.b.port === port) return { link, peer: link.a };
  }
  return null;
}

export type IfStatus = "up" | "down" | "administratively down";

export interface IfState {
  status: IfStatus;
  protocol: "up" | "down";
}

export function ifaceState(state: CiscoState, devId: string, ifName: string): IfState {
  const dev = state.devices[devId];
  const iface = dev?.interfaces[ifName];
  if (!iface) return { status: "down", protocol: "down" };
  if (iface.shutdown) return { status: "administratively down", protocol: "down" };

  if (ifName.startsWith("Loopback")) return { status: "up", protocol: "up" };

  // Subinterfaces follow their physical parent.
  if (iface.dot1q !== undefined || /\.\d+$/.test(ifName)) {
    const parent = ifName.replace(/\.\d+$/, "");
    const p = ifaceState(state, devId, parent);
    return p.protocol === "up" ? { status: "up", protocol: "up" } : { status: p.status, protocol: "down" };
  }

  if (ifName.startsWith("Vlan")) {
    const vlan = Number(ifName.slice(4));
    const active =
      vlan in dev.vlans &&
      Object.values(dev.interfaces).some((p) => {
        if (!p.switchport || p.shutdown) return false;
        const carries = p.switchport.mode === "trunk" || p.switchport.accessVlan === vlan;
        return carries && physicalUp(state, devId, p.name);
      });
    return { status: active ? "up" : "down", protocol: active ? "up" : "down" };
  }

  const up = physicalUp(state, devId, ifName);
  return { status: up ? "up" : "down", protocol: up ? "up" : "down" };
}

/**
 * A physical port is up when it is not shut, cabled, the far end is not shut,
 * and port security has not err-disabled either end. A port-channel is up
 * when at least one member is bundled.
 */
export function physicalUp(state: CiscoState, devId: string, ifName: string): boolean {
  const dev = state.devices[devId];
  const iface = dev?.interfaces[ifName];
  if (!iface || iface.shutdown) return false;
  if (ifName.startsWith("Port-channel")) {
    const id = Number(ifName.slice("Port-channel".length));
    return Object.values(dev.interfaces).some((m) => m.channelGroup?.id === id && memberStatus(state, devId, m.name) === "P");
  }
  const l = findLink(state, devId, ifName);
  if (!l) return false;
  const peer = state.devices[l.peer.device]?.interfaces[l.peer.port];
  if (!peer || peer.shutdown) return false;
  return !errDisabled(state, devId, ifName) && !errDisabled(state, l.peer.device, l.peer.port);
}

/* ------------------------------------------------------------------ */
/* Port security                                                       */
/* ------------------------------------------------------------------ */

/** MAC of the end host cabled to a switch port, if any. */
export function attachedMac(state: CiscoState, devId: string, ifName: string): string | undefined {
  const l = findLink(state, devId, ifName);
  const peer = l && state.devices[l.peer.device];
  return peer && peer.kind !== "switch" ? peer.mac : undefined;
}

export interface SecureState {
  /** MACs allowed on the port: static ones plus the learned host, when it fits. */
  secure: string[];
  /** The learned address is sticky (written to the running config). */
  stickyMac?: string;
  violation: boolean;
  violator?: string;
}

export function portSecurityState(state: CiscoState, devId: string, ifName: string): SecureState | null {
  const iface = state.devices[devId]?.interfaces[ifName];
  const ps = iface?.switchport?.portSecurity;
  if (!ps?.enabled || iface!.switchport!.mode !== "access") return null;
  const mac = attachedMac(state, devId, ifName);
  const secure = [...ps.macs];
  if (!mac || secure.includes(mac)) return { secure, violation: false };
  if (secure.length < ps.max) return { secure: [...secure, mac], stickyMac: ps.sticky ? mac : undefined, violation: false };
  return { secure, violation: true, violator: mac };
}

/** Port security violation in shutdown mode: the port is err-disabled. */
export function errDisabled(state: CiscoState, devId: string, ifName: string): boolean {
  const ps = state.devices[devId]?.interfaces[ifName]?.switchport?.portSecurity;
  if (!ps || ps.violation !== "shutdown") return false;
  return !!portSecurityState(state, devId, ifName)?.violation;
}

/* ------------------------------------------------------------------ */
/* EtherChannel                                                        */
/* ------------------------------------------------------------------ */

const COMPATIBLE: Record<ChannelMode, ChannelMode[]> = {
  active: ["active", "passive"],
  passive: ["active"],
  on: ["on"],
  desirable: ["desirable", "auto"],
  auto: ["desirable"],
};

export type MemberStatus = "P" | "I" | "s" | "D";

/** Bundled (P), stand-alone (I), suspended by a mode mismatch (s), or down (D). */
export function memberStatus(state: CiscoState, devId: string, ifName: string): MemberStatus {
  const iface = state.devices[devId]?.interfaces[ifName];
  if (!iface?.channelGroup || !physicalUp(state, devId, ifName)) return "D";
  const l = findLink(state, devId, ifName)!;
  const peer = state.devices[l.peer.device].interfaces[l.peer.port];
  const mine = iface.channelGroup.mode;
  if (!peer.channelGroup) return mine === "on" ? "s" : "I";
  const theirs = peer.channelGroup.mode;
  if (COMPATIBLE[mine].includes(theirs)) return "P";
  const lacp = (m: ChannelMode) => m === "active" || m === "passive";
  const pagp = (m: ChannelMode) => m === "desirable" || m === "auto";
  // Both negotiating but neither side starts (passive/passive, auto/auto): stays stand-alone.
  if ((lacp(mine) && lacp(theirs)) || (pagp(mine) && pagp(theirs))) return "I";
  return "s";
}

/** The logical STP/forwarding port: the port-channel for bundled members, otherwise the port itself. */
export function logicalPort(state: CiscoState, devId: string, ifName: string): string {
  const cg = state.devices[devId]?.interfaces[ifName]?.channelGroup;
  return cg && memberStatus(state, devId, ifName) === "P" ? `Port-channel${cg.id}` : ifName;
}

/* ------------------------------------------------------------------ */
/* Layer 2 broadcast domains (union-find over ports and VLANs)        */
/* ------------------------------------------------------------------ */

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const l3Key = (dev: string, iface: string) => `${dev}|${iface}`;
const vlanKey = (dev: string, vlan: number) => `${dev}#${vlan}`;

interface Attachment {
  untagged: string | null;
  /** 802.1Q VLAN -> L2 node, for trunks and routers with subinterfaces. */
  tagged: Map<number, string>;
  trunk: boolean;
}

/** What a port contributes to the L2 graph: an untagged segment and, on trunks, tagged VLANs. */
function attachment(state: CiscoState, dev: Device, iface: Iface): Attachment {
  if (!iface.switchport) {
    const tagged = new Map<number, string>();
    if (dev.kind === "router") {
      for (const sub of Object.values(dev.interfaces)) {
        if (sub.dot1q !== undefined && !sub.shutdown && sub.name.startsWith(iface.name + ".")) tagged.set(sub.dot1q, l3Key(dev.id, sub.name));
      }
    }
    return { untagged: l3Key(dev.id, iface.name), tagged, trunk: tagged.size > 0 };
  }
  // Bundled members forward with the port-channel's configuration.
  const sp = iface.channelGroup && dev.interfaces[`Port-channel${iface.channelGroup.id}`]?.switchport && memberStatus(state, dev.id, iface.name) === "P"
    ? dev.interfaces[`Port-channel${iface.channelGroup.id}`].switchport!
    : iface.switchport;
  if (sp.mode === "trunk") {
    const tagged = new Map(Object.keys(dev.vlans).map((v) => [Number(v), vlanKey(dev.id, Number(v))] as const));
    return { untagged: 1 in dev.vlans ? vlanKey(dev.id, 1) : null, tagged, trunk: true };
  }
  const v = sp.accessVlan;
  return { untagged: v in dev.vlans ? vlanKey(dev.id, v) : null, tagged: new Map(), trunk: false };
}

export function l2Domains(state: CiscoState): UnionFind {
  const uf = new UnionFind();
  for (const link of state.topology.links) {
    if (!physicalUp(state, link.a.device, link.a.port)) continue;
    const da = state.devices[link.a.device];
    const db = state.devices[link.b.device];
    // Port security in restrict/protect mode drops the violating host's frames.
    if (portSecurityState(state, da.id, link.a.port)?.violation || portSecurityState(state, db.id, link.b.port)?.violation) continue;
    const aa = attachment(state, da, da.interfaces[link.a.port]);
    const ab = attachment(state, db, db.interfaces[link.b.port]);
    if (aa.trunk && ab.trunk) {
      for (const [v, key] of aa.tagged) {
        const other = ab.tagged.get(v);
        if (other) uf.union(key, other);
      }
    }
    if (aa.untagged && ab.untagged) uf.union(aa.untagged, ab.untagged);
  }
  // Switch SVIs join their VLAN.
  for (const dev of Object.values(state.devices)) {
    if (dev.kind !== "switch") continue;
    for (const iface of Object.values(dev.interfaces)) {
      if (iface.name.startsWith("Vlan") && ifaceState(state, dev.id, iface.name).protocol === "up") {
        uf.union(l3Key(dev.id, iface.name), vlanKey(dev.id, Number(iface.name.slice(4))));
      }
    }
  }
  return uf;
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

export type RouteSource = "C" | "L" | "S" | "O";

export interface Route {
  source: RouteSource;
  net: number;
  mask: number;
  ad: number;
  metric: number;
  nextHop?: number;
  iface?: string;
}

interface L3If {
  dev: string;
  iface: string;
  ip: number;
  mask: number;
}

function upL3Ifaces(state: CiscoState, dev: Device): L3If[] {
  const out: L3If[] = [];
  for (const iface of Object.values(dev.interfaces)) {
    if (iface.ip === undefined || iface.mask === undefined) continue;
    if (ifaceState(state, dev.id, iface.name).protocol !== "up") continue;
    out.push({ dev: dev.id, iface: iface.name, ip: iface.ip, mask: iface.mask });
  }
  return out;
}

function connectedRoutes(state: CiscoState, dev: Device): Route[] {
  const routes: Route[] = [];
  for (const i of upL3Ifaces(state, dev)) {
    routes.push({ source: "C", net: network(i.ip, i.mask), mask: i.mask, ad: 0, metric: 0, iface: i.iface });
    if (dev.kind === "router") routes.push({ source: "L", net: i.ip, mask: 0xffffffff, ad: 0, metric: 0, iface: i.iface });
  }
  return routes;
}

export function ospfRouterId(state: CiscoState, dev: Device): number | undefined {
  if (dev.ospf?.routerId !== undefined) return dev.ospf.routerId;
  const ips = upL3Ifaces(state, dev).map((i) => i.ip);
  return ips.length ? Math.max(...ips) : undefined;
}

/** OSPF-enabled interfaces: up, addressed, and matched by a network statement. */
export function ospfIfaces(state: CiscoState, dev: Device): (L3If & { area: number })[] {
  if (!dev.ospf) return [];
  const out: (L3If & { area: number })[] = [];
  for (const i of upL3Ifaces(state, dev)) {
    const n = dev.ospf.networks.find((n) => wildcardMatch(i.ip, n.net, n.wildcard));
    if (n) out.push({ ...i, area: n.area });
  }
  return out;
}

export interface OspfNeighbor {
  router: string;
  routerId: number;
  ip: number;
  localIface: string;
}

export function ospfNeighbors(state: CiscoState, devId: string, uf = l2Domains(state)): OspfNeighbor[] {
  const dev = state.devices[devId];
  const mine = ospfIfaces(state, dev);
  if (!mine.length) return [];
  const result: OspfNeighbor[] = [];
  for (const other of Object.values(state.devices)) {
    if (other.id === devId || other.kind !== "router") continue;
    const theirs = ospfIfaces(state, other);
    const rid = ospfRouterId(state, other);
    if (rid === undefined) continue;
    for (const a of mine) {
      for (const b of theirs) {
        if (
          a.area === b.area &&
          a.mask === b.mask &&
          sameSubnet(a.ip, b.ip, a.mask) &&
          uf.find(l3Key(devId, a.iface)) === uf.find(l3Key(other.id, b.iface))
        ) {
          result.push({ router: other.id, routerId: rid, ip: b.ip, localIface: a.iface });
        }
      }
    }
  }
  return result;
}

function ospfRoutes(state: CiscoState, dev: Device, uf: UnionFind): Route[] {
  if (!ospfIfaces(state, dev).length) return [];
  // Dijkstra with cost 1 per adjacency (Gig/Fast Ethernet cost with ref bw 100 Mbps).
  const dist = new Map<string, { cost: number; firstHop?: OspfNeighbor }>([[dev.id, { cost: 0 }]]);
  const queue: string[] = [dev.id];
  while (queue.length) {
    queue.sort((a, b) => dist.get(a)!.cost - dist.get(b)!.cost);
    const cur = queue.shift()!;
    const { cost, firstHop } = dist.get(cur)!;
    for (const n of ospfNeighbors(state, cur, uf)) {
      if (dist.has(n.router)) continue;
      dist.set(n.router, { cost: cost + 1, firstHop: firstHop ?? n });
      queue.push(n.router);
    }
  }
  const connected = new Set(connectedRoutes(state, dev).map((r) => `${r.net}/${r.mask}`));
  const best = new Map<string, Route>();
  for (const [rid, { cost, firstHop }] of dist) {
    if (rid === dev.id || !firstHop) continue;
    for (const i of ospfIfaces(state, state.devices[rid])) {
      const net = network(i.ip, i.mask);
      const key = `${net}/${i.mask}`;
      if (connected.has(key)) continue;
      const metric = cost + 1;
      const existing = best.get(key);
      if (!existing || metric < existing.metric) {
        best.set(key, { source: "O", net, mask: i.mask, ad: 110, metric, nextHop: firstHop.ip, iface: firstHop.localIface });
      }
    }
  }
  return [...best.values()];
}

/** Full routing table (the RIB) for a device. */
export function routingTable(state: CiscoState, devId: string, uf = l2Domains(state)): Route[] {
  const dev = state.devices[devId];
  const connected = connectedRoutes(state, dev);
  const routes: Route[] = [...connected];
  const resolvable = (nh: number) => connected.some((r) => r.source === "C" && sameSubnet(nh, r.net, r.mask));

  if (dev.kind === "router") {
    const candidates: Route[] = [
      ...dev.staticRoutes
        .filter((s) => resolvable(s.nextHop))
        .map((s): Route => ({ source: "S", net: s.net, mask: s.mask, ad: s.ad ?? 1, metric: 0, nextHop: s.nextHop })),
      ...ospfRoutes(state, dev, uf),
    ];
    // For each prefix keep only the lowest administrative distance.
    const byPrefix = new Map<string, Route[]>();
    for (const r of candidates) {
      const key = `${r.net}/${r.mask}`;
      if (connected.some((c) => c.net === r.net && c.mask === r.mask)) continue;
      byPrefix.set(key, [...(byPrefix.get(key) ?? []), r]);
    }
    for (const rs of byPrefix.values()) {
      const minAd = Math.min(...rs.map((r) => r.ad));
      routes.push(...rs.filter((r) => r.ad === minAd));
    }
  } else if (dev.defaultGateway !== undefined && resolvable(dev.defaultGateway)) {
    routes.push({ source: "S", net: 0, mask: 0, ad: 1, metric: 0, nextHop: dev.defaultGateway });
  }
  return routes;
}

function lookup(routes: Route[], dst: number): Route | undefined {
  let best: Route | undefined;
  for (const r of routes) {
    if (!sameSubnet(dst, r.net, r.mask)) continue;
    if (!best || (maskToPrefix(r.mask) ?? 0) > (maskToPrefix(best.mask) ?? 0)) best = r;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Packet delivery (ping), with ACLs and NAT                           */
/* ------------------------------------------------------------------ */

export type DeliveryResult =
  | { ok: true; hops: string[]; src: number; dst: number }
  | { ok: false; reason: "no-route" | "timeout" | "filtered"; at: string };

/** NAT flows created while a ping is in flight: "router|insideGlobal" -> insideLocal. */
export type Flows = Map<string, number>;

/** Who answers for an IP on a segment: a real interface, or a router publishing a static NAT global. */
function ownerOf(state: CiscoState, ip: number, uf: UnionFind): { dev: string; iface: string } | undefined {
  for (const dev of Object.values(state.devices)) {
    for (const i of upL3Ifaces(state, dev)) if (i.ip === ip) return { dev: dev.id, iface: i.iface };
  }
  for (const dev of Object.values(state.devices)) {
    const v = activeVip(state, dev, ip, uf);
    if (v) return { dev: dev.id, iface: v };
  }
  for (const dev of Object.values(state.devices)) {
    if (dev.kind !== "router" || !dev.nat.rules.some((r) => r.kind === "static" && r.global === ip)) continue;
    const out = upL3Ifaces(state, dev).find((i) => dev.interfaces[i.iface].nat === "outside" && sameSubnet(i.ip, ip, i.mask));
    if (out) return { dev: dev.id, iface: out.iface };
  }
  return undefined;
}

/** Inside-to-outside source translation, or undefined when no rule applies. */
function natOutbound(state: CiscoState, dev: Device, src: number): number | undefined {
  for (const r of dev.nat.rules) if (r.kind === "static" && r.local === src) return r.global;
  for (const r of dev.nat.rules) {
    if (r.kind !== "overload" || !aclPermitsSource(dev, r.acl, src)) continue;
    const i = dev.interfaces[r.iface];
    if (i?.ip !== undefined && ifaceState(state, dev.id, r.iface).protocol === "up") return i.ip;
  }
  return undefined;
}

/**
 * One-way delivery from a device to an IP, following each hop's routing
 * table. At each router: inbound ACL, outside->inside NAT, routing,
 * inside->outside NAT, outbound ACL (the IOS order of operations).
 */
export function deliver(
  state: CiscoState,
  fromId: string,
  dstIn: number,
  uf = l2Domains(state),
  opts: { src?: number; flows?: Flows } = {},
): DeliveryResult {
  const flows = opts.flows ?? new Map();
  let cur = fromId;
  let src = opts.src;
  let dst = dstIn;
  let ingress: string | undefined;
  const hops = [cur];
  for (let ttl = 0; ttl < 16; ttl++) {
    const dev = state.devices[cur];
    const isRouter = dev.kind === "router";
    if (ingress && isRouter) {
      const inIf = dev.interfaces[ingress];
      if (!aclPermits(dev, inIf.acl?.in, { src: src!, dst, proto: "icmp" })) return { ok: false, reason: "filtered", at: cur };
      if (inIf.nat === "outside") {
        const flow = flows.get(`${cur}|${dst}`);
        const stat = dev.nat.rules.find((r) => r.kind === "static" && r.global === dst);
        if (flow !== undefined) dst = flow;
        else if (stat?.kind === "static") dst = stat.local;
      }
    }
    if (upL3Ifaces(state, dev).some((i) => i.ip === dst) || activeVip(state, dev, dst, uf)) return { ok: true, hops, src: src ?? dst, dst };
    if (cur !== fromId && !isRouter) return { ok: false, reason: "timeout", at: cur };

    const routes = routingTable(state, cur, uf);
    const route = lookup(routes, dst);
    if (!route) return { ok: false, reason: "no-route", at: cur };

    let nextHop = route.nextHop ?? dst;
    let egress = route.iface;
    if (route.source === "S" || !egress) {
      const conn = lookup(routes.filter((r) => r.source === "C"), nextHop);
      if (!conn) return { ok: false, reason: "no-route", at: cur };
      egress = conn.iface!;
    }
    if (route.source === "C") nextHop = dst;
    if (src === undefined) src = dev.interfaces[egress!].ip!;

    if (isRouter && ingress && dev.interfaces[ingress].nat === "inside" && dev.interfaces[egress!].nat === "outside") {
      const global = natOutbound(state, dev, src);
      if (global !== undefined) {
        flows.set(`${cur}|${global}`, src);
        flows.set(`xlate|${cur}|${src}|${global}|${dst}`, 1);
        src = global;
      }
    }
    if (isRouter && ingress && !aclPermits(dev, dev.interfaces[egress!].acl?.out, { src, dst, proto: "icmp" })) {
      return { ok: false, reason: "filtered", at: cur };
    }

    const owner = ownerOf(state, nextHop, uf);
    if (!owner) return { ok: false, reason: "timeout", at: cur };
    if (uf.find(l3Key(cur, egress!)) !== uf.find(l3Key(owner.dev, owner.iface))) {
      return { ok: false, reason: "timeout", at: cur };
    }
    ingress = owner.iface;
    cur = owner.dev;
    hops.push(cur);
  }
  return { ok: false, reason: "timeout", at: cur };
}

export interface PingResult {
  ok: boolean;
  /** "U" in IOS output: no route, or administratively prohibited by an ACL. */
  unreachable: boolean;
  /** NAT translations the echo created, per router. */
  translations: { router: string; t: NatTranslation }[];
}

/** Round-trip reachability, as ping sees it. */
export function ping(state: CiscoState, fromId: string, dst: number): PingResult {
  const uf = l2Domains(state);
  const flows: Flows = new Map();
  const there = deliver(state, fromId, dst, uf, { flows });
  const translations = () =>
    [...flows.keys()]
      .filter((k) => k.startsWith("xlate|"))
      .map((k) => {
        const [, router, local, global, outside] = k.split("|");
        return { router, t: { proto: "icmp" as const, insideLocal: +local, insideGlobal: +global, outside: +outside } };
      });
  if (!there.ok) return { ok: false, unreachable: there.reason !== "timeout", translations: [] };
  const owner = there.hops[there.hops.length - 1];
  if (owner === fromId) return { ok: true, unreachable: false, translations: [] };
  const back = deliver(state, owner, there.src, uf, { src: there.dst, flows });
  return { ok: back.ok, unreachable: !back.ok && back.reason !== "timeout", translations: back.ok ? translations() : [] };
}

/* ------------------------------------------------------------------ */
/* HSRP                                                                */
/* ------------------------------------------------------------------ */

export interface HsrpMember {
  dev: string;
  iface: string;
  ip: number;
  priority: number;
  preempt: boolean;
}

/** Routers in the same HSRP group and broadcast domain, best first (priority, then highest IP). */
export function hsrpMembers(state: CiscoState, devId: string, ifName: string, group: number, uf = l2Domains(state)): HsrpMember[] {
  const vip = state.devices[devId]?.interfaces[ifName]?.hsrp?.[group]?.ip;
  if (vip === undefined) return [];
  const here = uf.find(l3Key(devId, ifName));
  const out: HsrpMember[] = [];
  for (const dev of Object.values(state.devices)) {
    if (dev.kind !== "router") continue;
    for (const i of upL3Ifaces(state, dev)) {
      const g = dev.interfaces[i.iface].hsrp?.[group];
      if (!g || g.ip !== vip || !sameSubnet(vip, i.ip, i.mask) || uf.find(l3Key(dev.id, i.iface)) !== here) continue;
      out.push({ dev: dev.id, iface: i.iface, ip: i.ip, priority: g.priority, preempt: g.preempt });
    }
  }
  return out.sort((a, b) => b.priority - a.priority || b.ip - a.ip);
}

/** The interface on which this router answers for a virtual IP as HSRP active, if any. */
export function activeVip(state: CiscoState, dev: Device, ip: number, uf: UnionFind): string | undefined {
  if (dev.kind !== "router") return undefined;
  for (const i of Object.values(dev.interfaces)) {
    if (!i.hsrp) continue;
    for (const [g, cfg] of Object.entries(i.hsrp)) {
      if (cfg.ip !== ip) continue;
      const best = hsrpMembers(state, dev.id, i.name, Number(g), uf)[0];
      if (best && best.dev === dev.id && best.iface === i.name) return i.name;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* IPv6                                                                */
/* ------------------------------------------------------------------ */

export interface L3If6 {
  iface: string;
  addr: bigint;
  prefix: number;
}

export function v6Enabled(i: Iface): boolean {
  return !!i.ipv6Enabled || !!i.ipv6?.length;
}

/** Up interfaces' IPv6 addresses, including link-local (prefix 64 under FE80::/10). */
export function upIfaces6(state: CiscoState, dev: Device, withLinkLocal = true): L3If6[] {
  const out: L3If6[] = [];
  for (const i of Object.values(dev.interfaces)) {
    if (!v6Enabled(i) || ifaceState(state, dev.id, i.name).protocol !== "up") continue;
    if (withLinkLocal) out.push({ iface: i.name, addr: linkLocal(dev.mac), prefix: 64 });
    for (const a of i.ipv6 ?? []) out.push({ iface: i.name, addr: a.addr, prefix: a.prefix });
  }
  return out;
}

export interface Route6 {
  source: "C" | "L" | "S";
  net: bigint;
  prefix: number;
  ad: number;
  nextHop?: bigint;
  iface?: string;
}

export function routingTable6(state: CiscoState, devId: string): Route6[] {
  const dev = state.devices[devId];
  const routes: Route6[] = [];
  for (const i of upIfaces6(state, dev, false)) {
    routes.push({ source: "C", net: network6(i.addr, i.prefix), prefix: i.prefix, ad: 0, iface: i.iface });
    if (dev.kind === "router") routes.push({ source: "L", net: i.addr, prefix: 128, ad: 0, iface: i.iface });
  }
  const connected = routes.filter((r) => r.source === "C");
  const resolvable = (nh: bigint) => connected.some((c) => sameSubnet6(nh, c.net, c.prefix));
  if (dev.kind === "router") {
    for (const r of dev.staticRoutes6) {
      if (resolvable(r.nextHop) && !connected.some((c) => c.net === r.net && c.prefix === r.prefix)) {
        routes.push({ source: "S", net: r.net, prefix: r.prefix, ad: 1, nextHop: r.nextHop });
      }
    }
  } else if (dev.gateway6 !== undefined && (isLinkLocal(dev.gateway6) ? upIfaces6(state, dev).length > 0 : resolvable(dev.gateway6))) {
    routes.push({ source: "S", net: BigInt(0), prefix: 0, ad: 1, nextHop: dev.gateway6, iface: isLinkLocal(dev.gateway6) ? "Ethernet0" : undefined });
  }
  return routes;
}

function lookup6(routes: Route6[], dst: bigint): Route6 | undefined {
  let best: Route6 | undefined;
  for (const r of routes) if (sameSubnet6(dst, r.net, r.prefix) && (!best || r.prefix > best.prefix)) best = r;
  return best;
}

export type Delivery6 = { ok: true; hops: string[]; src: bigint } | { ok: false; reason: "no-route" | "timeout"; at: string };

export function deliver6(state: CiscoState, fromId: string, dst: bigint, uf = l2Domains(state), src?: bigint): Delivery6 {
  let cur = fromId;
  const hops = [cur];
  for (let ttl = 0; ttl < 16; ttl++) {
    const dev = state.devices[cur];
    const mine = upIfaces6(state, dev);
    if (mine.some((i) => i.addr === dst)) return { ok: true, hops, src: src ?? dst };
    if (cur !== fromId && (dev.kind !== "router" || !dev.ipv6Routing)) return { ok: false, reason: "timeout", at: cur };
    const routes = routingTable6(state, cur);
    const route = lookup6(routes, dst);
    if (!route) return { ok: false, reason: "no-route", at: cur };
    const nextHop = route.source === "C" ? dst : route.nextHop!;
    let egress = route.iface;
    if (!egress) {
      const conn = lookup6(routes.filter((r) => r.source === "C"), nextHop);
      if (!conn) return { ok: false, reason: "no-route", at: cur };
      egress = conn.iface!;
    }
    if (src === undefined) src = mine.find((i) => i.iface === egress && !isLinkLocal(i.addr))?.addr ?? mine.find((i) => i.iface === egress)?.addr;
    const domain = uf.find(l3Key(cur, egress));
    let owner: { dev: string; iface: string } | undefined;
    for (const d of Object.values(state.devices)) {
      const hit = upIfaces6(state, d).find((i) => i.addr === nextHop && uf.find(l3Key(d.id, i.iface)) === domain);
      if (hit) { owner = { dev: d.id, iface: hit.iface }; break; }
    }
    if (!owner) return { ok: false, reason: "timeout", at: cur };
    cur = owner.dev;
    hops.push(cur);
  }
  return { ok: false, reason: "timeout", at: cur };
}

export function ping6(state: CiscoState, fromId: string, dst: bigint): { ok: boolean; unreachable: boolean } {
  const uf = l2Domains(state);
  const there = deliver6(state, fromId, dst, uf);
  if (!there.ok) return { ok: false, unreachable: there.reason === "no-route" };
  const owner = there.hops[there.hops.length - 1];
  if (owner === fromId || there.src === undefined) return { ok: owner === fromId, unreachable: false };
  const back = deliver6(state, owner, there.src, uf, dst);
  return { ok: back.ok, unreachable: false };
}

/** SLAAC: the first IPv6 router on the segment advertising a /64. */
export function slaacOffer(state: CiscoState, clientId: string, clientIf = "Ethernet0"): { prefix: bigint; gateway: bigint } | null {
  if (!physicalUp(state, clientId, clientIf)) return null;
  const uf = l2Domains(state);
  const me = uf.find(l3Key(clientId, clientIf));
  for (const dev of Object.values(state.devices)) {
    if (dev.kind !== "router" || !dev.ipv6Routing) continue;
    for (const i of upIfaces6(state, dev, false)) {
      if (i.prefix === 64 && uf.find(l3Key(dev.id, i.iface)) === me) return { prefix: network6(i.addr, 64), gateway: linkLocal(dev.mac) };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* DHCP                                                                */
/* ------------------------------------------------------------------ */

export interface DhcpLease {
  server: string;
  ip: number;
  mask: number;
  gateway?: number;
  dns?: number;
}

/** Find a DHCP server on the client's broadcast domain and pick the lowest free address. */
export function dhcpOffer(state: CiscoState, clientId: string, clientIf = "Ethernet0"): DhcpLease | null {
  if (!physicalUp(state, clientId, clientIf)) return null;
  const uf = l2Domains(state);
  const me = uf.find(l3Key(clientId, clientIf));
  const used = new Set<number>();
  for (const d of Object.values(state.devices)) {
    if (d.id === clientId) continue;
    for (const i of Object.values(d.interfaces)) if (i.ip !== undefined) used.add(i.ip);
  }
  for (const dev of Object.values(state.devices)) {
    if (dev.kind !== "router") continue;
    for (const i of upL3Ifaces(state, dev)) {
      if (uf.find(l3Key(dev.id, i.iface)) !== me) continue;
      const pool = Object.values(dev.dhcp.pools).find((p) => p.net !== undefined && p.mask !== undefined && sameSubnet(i.ip, p.net, p.mask));
      if (!pool) continue;
      const net = network(pool.net!, pool.mask!);
      const bcast = (net | (~pool.mask! >>> 0)) >>> 0;
      for (let a = net + 1; a < bcast; a++) {
        if (used.has(a) || dev.dhcp.excluded.some(([lo, hi]) => a >= lo && a <= hi)) continue;
        return { server: dev.id, ip: a, mask: pool.mask!, gateway: pool.defaultRouter, dns: pool.dns };
      }
      return null;
    }
  }
  return null;
}

export { prefixToMask };
