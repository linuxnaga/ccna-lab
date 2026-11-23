import type { ExecResult, Topology, TopologyLink, VendorEngine } from "../types";
import { cloneDevice, makeDevice, shortName, type CiscoState, type Device, type Mode } from "./model";
import { MODE_SPECS, PARENT, type Ctx } from "./commands";
import { completeLine, match, nextOptions, type MatchResult, type Spec } from "./parser";
import { ifaceState, l2Domains, ospfNeighbors, portSecurityState } from "./network";
import { portBlocked } from "./stp";
import { formatIp } from "./ip";

export * from "./model";
export {
  deliver,
  deliver6,
  dhcpOffer,
  hsrpMembers,
  ifaceState,
  memberStatus,
  ping,
  ping6,
  portSecurityState,
  errDisabled,
  routingTable,
  routingTable6,
  ospfNeighbors,
} from "./network";
export { parseIp6, formatIp6, eui64 } from "./ip6";
export { spanningTree, spanningTreeAll, portBlocked } from "./stp";
export { aclPermits } from "./acl";
export { parseIp, formatIp } from "./ip";

const SUFFIX: Record<Mode, string> = {
  user: ">",
  priv: "#",
  config: "(config)#",
  if: "(config-if)#",
  router: "(config-router)#",
  vlan: "(config-vlan)#",
  dhcp: "(dhcp-config)#",
  line: "(config-line)#",
  pc: "",
};

function promptFor(dev: Device): string {
  if (dev.kind === "pc") return "C:\\>";
  if (dev.mode === "if" && dev.ctx.range) return dev.hostname + "(config-if-range)#";
  return dev.hostname + SUFFIX[dev.mode];
}

/** Port-channel members always forward with their port-channel's switchport settings, as IOS enforces. */
function syncPortChannels(dev: Device) {
  for (const m of Object.values(dev.interfaces)) {
    const po = m.channelGroup && dev.interfaces[`Port-channel${m.channelGroup.id}`]?.switchport;
    if (!po || !m.switchport) continue;
    m.switchport.mode = po.mode;
    m.switchport.accessVlan = po.accessVlan;
  }
}

function specsFor(dev: Device, mode: Mode, ctx: Ctx): Spec<Ctx>[] {
  return MODE_SPECS[mode].filter((s) => !s.when || s.when(dev, ctx));
}

/** Build the initial lab state from a topology and per-device overrides. */
export function buildState(topology: Topology, setup: (devices: Record<string, Device>) => void): CiscoState {
  const devices: Record<string, Device> = {};
  for (const d of topology.devices) {
    const kind = d.kind === "router" || d.kind === "switch" ? d.kind : "pc";
    devices[d.id] = makeDevice({ id: d.id, kind, hostname: kind === "pc" ? d.label : undefined });
  }
  setup(devices);
  return { devices, topology, rev: 0 };
}

function errorLines(prompt: string, r: MatchResult<Ctx>, line: string, mode: Mode): string[] {
  if (r.kind === "ambiguous") return [`% Ambiguous command:  "${r.token}"`];
  if (r.kind === "incomplete") return ["% Incomplete command.", ""];
  if (r.kind !== "invalid") return [];
  const words = line.trim().split(/\s+/);
  if ((mode === "user" || mode === "priv") && words.length === 1 && r.tokenIndex === 0) {
    return [
      `Translating "${words[0]}"...domain server (255.255.255.255)`,
      "% Unknown command or computer name, or unable to find computer address",
    ];
  }
  return [" ".repeat(prompt.length + r.col) + "^", "% Invalid input detected at '^' marker.", ""];
}

function linkLogs(before: CiscoState, after: CiscoState, devId: string): string[] {
  const out: string[] = [];
  for (const name of Object.keys(after.devices[devId].interfaces)) {
    const was = before.devices[devId].interfaces[name] ? portSecurityState(before, devId, name) : null;
    const now = portSecurityState(after, devId, name);
    if (now?.violation && !was?.violation) {
      const mode = after.devices[devId].interfaces[name].switchport!.portSecurity!.violation;
      out.push(`%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${now.violator} on port ${name}.`);
      if (mode === "shutdown") out.push(`%PM-4-ERR_DISABLE: psecure-violation error detected on ${shortName(name)}, putting ${shortName(name)} in err-disable state`);
    }
  }
  const dev = after.devices[devId];
  for (const name of Object.keys(dev.interfaces)) {
    const a = before.devices[devId].interfaces[name] ? ifaceState(before, devId, name) : null;
    const b = ifaceState(after, devId, name);
    // A newly created interface only logs if it comes straight up (e.g. a loopback).
    if (!a && b.status !== "up") continue;
    if (a?.status !== b.status) out.push(`%LINK-${b.status === "administratively down" ? 5 : 3}-CHANGED: Interface ${name}, changed state to ${b.status}`);
    if (a && a.protocol !== b.protocol) out.push(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to ${b.protocol}`);
  }
  if (dev.kind === "router" && (before.devices[devId].ospf || dev.ospf)) {
    const key = (n: { routerId: number; localIface: string }) => `${n.routerId}|${n.localIface}`;
    const pid = dev.ospf?.pid ?? before.devices[devId].ospf?.pid;
    const was = new Map(ospfNeighbors(before, devId, l2Domains(before)).map((n) => [key(n), n]));
    const now = new Map(ospfNeighbors(after, devId, l2Domains(after)).map((n) => [key(n), n]));
    for (const [k, n] of now) if (!was.has(k)) out.push(`%OSPF-5-ADJCHG: Process ${pid}, Nbr ${formatIp(n.routerId)} on ${n.localIface} from LOADING to FULL, Loading Done`);
    for (const [k, n] of was) if (!now.has(k)) out.push(`%OSPF-5-ADJCHG: Process ${pid}, Nbr ${formatIp(n.routerId)} on ${n.localIface} from FULL to DOWN, Neighbor Down: Interface down or detached`);
  }
  return out;
}

function run(state: CiscoState, devId: string, line: string): ExecResult<CiscoState> {
  const dev = cloneDevice(state.devices[devId]);
  const prompt = promptFor(dev);
  const ctx: Ctx = {
    state,
    dev,
    out: [],
    ok: true,
    effects: [],
    execIn: (mode, sub) => {
      const r = match(specsFor(dev, mode, ctx), sub, dev);
      if (r.kind === "ok") r.spec.run(ctx, r.args);
      else {
        ctx.ok = false;
        ctx.out.push(...errorLines(prompt + "do ", r, sub, mode));
      }
    },
  };

  const trimmed = line.trim();
  if (!trimmed) return { state, output: [], ok: true };

  if (trimmed.endsWith("?")) {
    const q = line.replace(/\?\s*$/, "");
    const opts = nextOptions(specsFor(dev, dev.mode, ctx), q, dev);
    const parent = PARENT[dev.mode];
    const extra = parent ? nextOptions(specsFor(dev, parent, ctx), q, dev) : [];
    const all = [...opts, ...extra.filter((e) => !opts.some((o) => o.word === e.word))];
    if (!all.length) return { state, output: ["% Unrecognized command"], ok: false };
    const w = Math.max(...all.map((o) => o.word.length)) + 2;
    return { state, output: all.map((o) => "  " + o.word.padEnd(w) + o.help), ok: true };
  }

  let r = match(specsFor(dev, dev.mode, ctx), line, dev);
  const parent = PARENT[dev.mode];
  if (r.kind !== "ok" && parent) {
    const pr = match(specsFor(dev, parent, ctx), line, dev);
    if (pr.kind === "ok") {
      // Like IOS: a global command typed in a sub-mode drops back to global config.
      dev.mode = parent;
      dev.ctx = {};
      r = pr;
    } else if (r.kind === "invalid" && pr.kind !== "invalid") {
      r = pr;
    } else if (r.kind === "invalid" && pr.kind === "invalid" && pr.col > r.col) {
      r = pr;
    }
  }

  if (r.kind !== "ok") {
    if (dev.kind === "pc") return { state, output: ["Invalid Command."], ok: false };
    return { state, output: errorLines(prompt, r, line, dev.mode), ok: false };
  }

  const wasMode = state.devices[devId].mode;
  const range = dev.mode === "if" && wasMode === "if" ? dev.ctx.range : undefined;
  if (range && !r.canonical.startsWith("do ")) {
    // "interface range": run the command once per member port, like IOS.
    for (const name of range) {
      if (dev.mode !== "if" || !dev.ctx.range) break;
      dev.ctx = { ...dev.ctx, iface: name };
      r.spec.run(ctx, r.args);
    }
    if (dev.mode === "if" && dev.ctx.range) dev.ctx = { ...dev.ctx, iface: range[0] };
    ctx.out = ctx.out.filter((l, i, all) => all.indexOf(l) === i || l === "");
  } else {
    r.spec.run(ctx, r.args);
  }
  if (dev.kind === "switch") syncPortChannels(dev);
  if (ctx.ok && !["user", "priv", "pc"].includes(wasMode)) dev.saved = false;
  const devices = { ...state.devices, [devId]: dev };
  if (ctx.ok) {
    for (const fx of ctx.effects) {
      // Effects may touch other devices: clone each one before it is mutated.
      const touched = new Proxy(devices, {
        get(target, key: string) {
          if (key !== devId && target[key] === state.devices[key]) target[key] = cloneDevice(state.devices[key]);
          return target[key];
        },
      });
      fx(touched);
    }
  }
  const next: CiscoState = { ...state, devices, rev: state.rev + 1 };
  const logs = ctx.ok ? linkLogs(state, next, devId) : [];
  return { state: next, output: [...ctx.out, ...logs], ok: ctx.ok, canonical: r.canonical };
}

export const ciscoEngine: VendorEngine<CiscoState> = {
  vendor: "cisco",
  prompt: (state, id) => promptFor(state.devices[id]),
  exec: run,
  complete(state, id, line) {
    const dev = state.devices[id];
    const ctx = { state, dev, out: [], ok: true, effects: [], execIn: () => {} } as Ctx;
    const own = completeLine(specsFor(dev, dev.mode, ctx), line, dev);
    if (own !== line) return own;
    const parent = PARENT[dev.mode];
    return parent ? completeLine(specsFor(dev, parent, ctx), line, dev) : line;
  },
  linkStatus(state: CiscoState, _t: Topology, link: TopologyLink) {
    const a = ifaceState(state, link.a.device, link.a.port).protocol === "up";
    const b = ifaceState(state, link.b.device, link.b.port).protocol === "up";
    return {
      a,
      b,
      aBlocked: a && b && portBlocked(state, link.a.device, link.a.port),
      bBlocked: a && b && portBlocked(state, link.b.device, link.b.port),
    };
  },
  banner(state, id) {
    const dev = state.devices[id];
    if (dev.kind === "pc") return ["PC Command Line 1.0", "Type 'help' for available commands.", ""];
    const motd = dev.security.banner ? [dev.security.banner, ""] : [];
    return [`${dev.hostname} con0 is now available`, "", "Press RETURN to get started.", "", ...motd];
  },
};
