/**
 * Per-VLAN spanning tree (PVST+ / Rapid PVST+), computed from the current
 * configuration rather than simulated over time: root bridge election,
 * root ports, designated ports and alternate (blocking) ports.
 */
import type { CiscoState, Device } from "./model";
import { findLink, physicalUp } from "./network";

const ifaceOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export const DEFAULT_PRIORITY = 32768;

export interface BridgeId {
  priority: number; // including sys-id-ext (priority + vlan)
  mac: string;
}

export interface StpPort {
  iface: string;
  role: "Root" | "Desg" | "Altn";
  state: "FWD" | "BLK";
  cost: number;
  portId: number;
  edge: boolean;
}

export interface StpVlan {
  vlan: number;
  bridge: BridgeId;
  root: BridgeId;
  rootDevice: string;
  rootCost: number;
  rootPort?: string;
  ports: StpPort[];
}

const cmpBid = (a: BridgeId, b: BridgeId) => a.priority - b.priority || a.mac.localeCompare(b.mac);

export function portCost(iface: string): number {
  return iface.startsWith("GigabitEthernet") ? 4 : 19;
}

/** Port number as IOS shows it in "Prio.Nbr": Fa0/n -> n, Gi0/n -> 24+n. */
export function portNumber(iface: string): number {
  const n = Number(iface.split("/").pop());
  return iface.startsWith("GigabitEthernet") ? 24 + n : n;
}

export function bridgeId(dev: Device, vlan: number): BridgeId {
  return { priority: (dev.stp.priority[vlan] ?? DEFAULT_PRIORITY) + vlan, mac: dev.mac };
}

/** Does this switch port forward frames for the VLAN? */
function carries(dev: Device, iface: string, vlan: number): boolean {
  const i = dev.interfaces[iface];
  if (!i?.switchport || !(vlan in dev.vlans)) return false;
  return i.switchport.mode === "trunk" || i.switchport.accessVlan === vlan;
}

function untagged(dev: Device, iface: string): number | null {
  const sp = dev.interfaces[iface].switchport!;
  return sp.mode === "trunk" ? 1 : sp.accessVlan;
}

interface Edge {
  dev: string;
  iface: string;
  peer: string;
  peerIface: string;
}

/** Switch-to-switch segments that carry the VLAN on both ends. */
function vlanEdges(state: CiscoState, vlan: number): Edge[] {
  const edges: Edge[] = [];
  for (const dev of Object.values(state.devices)) {
    if (dev.kind !== "switch") continue;
    for (const iface of Object.keys(dev.interfaces)) {
      if (!carries(dev, iface, vlan) || !physicalUp(state, dev.id, iface)) continue;
      const l = findLink(state, dev.id, iface);
      const peer = l && state.devices[l.peer.device];
      if (!l || !peer || peer.kind !== "switch" || !carries(peer, l.peer.port, vlan)) continue;
      const bothTrunk = dev.interfaces[iface].switchport!.mode === "trunk" && peer.interfaces[l.peer.port].switchport!.mode === "trunk";
      if (!bothTrunk && untagged(dev, iface) !== untagged(peer, l.peer.port)) continue;
      edges.push({ dev: dev.id, iface, peer: peer.id, peerIface: l.peer.port });
    }
  }
  return edges;
}

/** Spanning tree for every switch in one VLAN. */
export function spanningTreeAll(state: CiscoState, vlan: number): Record<string, StpVlan> {
  const switches = Object.values(state.devices).filter((d) => d.kind === "switch" && vlan in d.vlans);
  const edges = vlanEdges(state, vlan);
  const adj = new Map<string, Edge[]>(switches.map((d) => [d.id, []]));
  for (const e of edges) adj.get(e.dev)?.push(e);

  // Connected components, each elects its own root.
  const comp = new Map<string, string>();
  for (const d of switches) {
    if (comp.has(d.id)) continue;
    const members: string[] = [];
    const stack = [d.id];
    comp.set(d.id, d.id);
    while (stack.length) {
      const x = stack.pop()!;
      members.push(x);
      for (const e of adj.get(x) ?? []) if (!comp.has(e.peer)) { comp.set(e.peer, d.id); stack.push(e.peer); }
    }
    const root = members.reduce((a, b) => (cmpBid(bridgeId(state.devices[a], vlan), bridgeId(state.devices[b], vlan)) <= 0 ? a : b));
    for (const m of members) comp.set(m, root);
  }

  // Root path cost (Dijkstra; cost is that of the receiving port).
  const roots = new Set(comp.values());
  const dist = new Map<string, number>([...roots].map((r) => [r, 0]));
  const queue = [...roots];
  while (queue.length) {
    queue.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const x = queue.shift()!;
    for (const e of adj.get(x) ?? []) {
      const c = dist.get(x)! + portCost(e.peerIface);
      if (c < (dist.get(e.peer) ?? Infinity)) { dist.set(e.peer, c); queue.push(e.peer); }
    }
  }

  const bid = (id: string) => bridgeId(state.devices[id], vlan);
  const rootPort = new Map<string, string>();
  for (const d of switches) {
    if (roots.has(d.id)) continue;
    let best: { e: Edge; key: [number, BridgeId, number, number] } | null = null;
    for (const e of adj.get(d.id) ?? []) {
      const key: [number, BridgeId, number, number] = [dist.get(e.peer)! + portCost(e.iface), bid(e.peer), portNumber(e.peerIface), portNumber(e.iface)];
      if (
        !best ||
        key[0] < best.key[0] ||
        (key[0] === best.key[0] && (cmpBid(key[1], best.key[1]) < 0 || (cmpBid(key[1], best.key[1]) === 0 && (key[2] < best.key[2] || (key[2] === best.key[2] && key[3] < best.key[3])))))
      ) best = { e, key };
    }
    if (best) rootPort.set(d.id, best.e.iface);
  }

  const result: Record<string, StpVlan> = {};
  for (const d of switches) {
    const ports: StpPort[] = [];
    const edgeByIface = new Map((adj.get(d.id) ?? []).map((e) => [e.iface, e]));
    for (const iface of Object.keys(d.interfaces).sort(ifaceOrder)) {
      if (!carries(d, iface, vlan) || !physicalUp(state, d.id, iface)) continue;
      const e = edgeByIface.get(iface);
      const sp = d.interfaces[iface].switchport!;
      const base = { iface, cost: portCost(iface), portId: portNumber(iface), edge: !!sp.portfast };
      if (!e) {
        // Edge toward a host or router (or a switch that does not carry the VLAN).
        ports.push({ ...base, role: "Desg", state: "FWD" });
        continue;
      }
      if (rootPort.get(d.id) === iface) {
        ports.push({ ...base, role: "Root", state: "FWD" });
        continue;
      }
      // Designated on this segment if our advertised path is better than the peer's.
      const mine: [number, BridgeId, number] = [dist.get(d.id)!, bid(d.id), portNumber(iface)];
      const theirs: [number, BridgeId, number] = [dist.get(e.peer)!, bid(e.peer), portNumber(e.peerIface)];
      const better = mine[0] - theirs[0] || cmpBid(mine[1], theirs[1]) || mine[2] - theirs[2];
      ports.push({ ...base, ...(better < 0 ? { role: "Desg" as const, state: "FWD" as const } : { role: "Altn" as const, state: "BLK" as const }) });
    }
    const root = comp.get(d.id)!;
    result[d.id] = {
      vlan,
      bridge: bid(d.id),
      root: bid(root),
      rootDevice: root,
      rootCost: dist.get(d.id) ?? 0,
      rootPort: rootPort.get(d.id),
      ports,
    };
  }
  return result;
}

export function spanningTree(state: CiscoState, devId: string, vlan: number): StpVlan | null {
  return spanningTreeAll(state, vlan)[devId] ?? null;
}

/** VLANs that have at least one host-facing access port up somewhere: the ones users care about. */
function userVlans(state: CiscoState): Set<number> {
  const out = new Set<number>();
  for (const d of Object.values(state.devices)) {
    if (d.kind !== "switch") continue;
    for (const i of Object.values(d.interfaces)) {
      if (i.switchport && i.switchport.mode !== "trunk" && i.switchport.accessVlan in d.vlans && physicalUp(state, d.id, i.name)) {
        const l = findLink(state, d.id, i.name);
        if (l && state.devices[l.peer.device]?.kind !== "switch") out.add(i.switchport.accessVlan);
      }
    }
  }
  return out;
}

/**
 * Is a switch port blocking? Used for the topology lights: a port counts as
 * blocked when it blocks in every user VLAN it carries (or, with no user
 * VLANs anywhere, in every VLAN it carries).
 */
export function portBlocked(state: CiscoState, devId: string, iface: string): boolean {
  const dev = state.devices[devId];
  if (dev?.kind !== "switch" || !dev.interfaces[iface]?.switchport) return false;
  const users = userVlans(state);
  const candidates = Object.keys(dev.vlans).map(Number);
  const relevant = candidates.filter((v) => users.has(v));
  let any = false;
  for (const v of relevant.length ? relevant : candidates) {
    const p = spanningTree(state, devId, v)?.ports.find((x) => x.iface === iface);
    if (!p) continue;
    if (p.state === "FWD") return false;
    any = true;
  }
  return any;
}
