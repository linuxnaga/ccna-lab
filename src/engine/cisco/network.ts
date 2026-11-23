import type { TopologyLink } from "../types";
import type { CiscoState, Device, Iface, NatTranslation } from "./model";
import { maskToPrefix, network, prefixToMask, sameSubnet, wildcardMatch } from "./ip";
import { aclPermits, aclPermitsSource } from "./acl";

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

/** A physical port is up when it is not shut, cabled, and the far end is not shut. */
export function physicalUp(state: CiscoState, devId: string, ifName: string): boolean {
  const iface = state.devices[devId]?.interfaces[ifName];
  if (!iface || iface.shutdown) return false;
  const l = findLink(state, devId, ifName);
  if (!l) return false;
  const peer = state.devices[l.peer.device]?.interfaces[l.peer.port];
  return !!peer && !peer.shutdown;
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

/** What a port contributes to the L2 graph: one untagged segment, or a set of tagged VLANs. */
function attachment(dev: Device, iface: Iface): { untagged: string | null; tagged: number[] } {
  if (!iface.switchport) return { untagged: l3Key(dev.id, iface.name), tagged: [] };
  if (iface.switchport.mode === "trunk") {
    return { untagged: 1 in dev.vlans ? vlanKey(dev.id, 1) : null, tagged: Object.keys(dev.vlans).map(Number) };
  }
  const v = iface.switchport.accessVlan;
  return { untagged: v in dev.vlans ? vlanKey(dev.id, v) : null, tagged: [] };
}

export function l2Domains(state: CiscoState): UnionFind {
  const uf = new UnionFind();
  for (const link of state.topology.links) {
    if (!physicalUp(state, link.a.device, link.a.port)) continue;
    const da = state.devices[link.a.device];
    const db = state.devices[link.b.device];
    const ia = da.interfaces[link.a.port];
    const ib = db.interfaces[link.b.port];
    const aa = attachment(da, ia);
    const ab = attachment(db, ib);
    const bothTrunk = ia.switchport?.mode === "trunk" && ib.switchport?.mode === "trunk";
    if (bothTrunk) {
      for (const v of aa.tagged) if (ab.tagged.includes(v)) uf.union(vlanKey(da.id, v), vlanKey(db.id, v));
    } else if (aa.untagged && ab.untagged) {
      uf.union(aa.untagged, ab.untagged);
    }
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
function ownerOf(state: CiscoState, ip: number): { dev: string; iface: string } | undefined {
  for (const dev of Object.values(state.devices)) {
    for (const i of upL3Ifaces(state, dev)) if (i.ip === ip) return { dev: dev.id, iface: i.iface };
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
    if (upL3Ifaces(state, dev).some((i) => i.ip === dst)) return { ok: true, hops, src: src ?? dst, dst };
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

    const owner = ownerOf(state, nextHop);
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
