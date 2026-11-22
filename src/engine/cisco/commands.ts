import type { CiscoState, Device, Mode } from "./model";
import { formatIp, isHostAddress, maskToPrefix, network, parseIp, sameSubnet } from "./ip";
import { spec, type Spec } from "./parser";
import { ping } from "./network";
import { showInterfacesTrunk, showIpIntBrief, showIpRoute, showOspfNeighbor, showRunningConfig, showVlanBrief } from "./show";

export interface Ctx {
  /** State before the command (read-only). */
  state: CiscoState;
  /** Mutable copy of the active device. */
  dev: Device;
  out: string[];
  ok: boolean;
  /** Re-dispatch (used by "do"). */
  execIn: (mode: Mode, line: string) => void;
}

type S = Spec<Ctx>;

function fail(ctx: Ctx, ...lines: string[]) {
  ctx.ok = false;
  ctx.out.push(...lines);
}

const ip = (s: string | number) => parseIp(String(s))!;
const isRouter = (d: Device) => d.kind === "router";
const isSwitch = (d: Device) => d.kind === "switch";
const curIf = (ctx: Ctx) => ctx.dev.interfaces[ctx.dev.ctx.iface!];
const onSwitchPort = (d: Device) => !!d.ctx.iface && !!d.interfaces[d.ctx.iface]?.switchport;
const onL3If = (d: Device) => !!d.ctx.iface && !d.interfaces[d.ctx.iface]?.switchport;

function setMode(ctx: Ctx, mode: Mode, extra: Device["ctx"] = {}) {
  ctx.dev.mode = mode;
  ctx.dev.ctx = extra;
}

function ensureVlan(ctx: Ctx, id: number): boolean {
  if (id < 1 || id > 4094) {
    fail(ctx, "Command rejected: Bad VLAN list - character #1 is a non-numeric", "character or out of range.");
    return false;
  }
  if (!(id in ctx.dev.vlans)) ctx.dev.vlans[id] = `VLAN${String(id).padStart(4, "0")}`;
  return true;
}

/* ---------------------------- EXEC ---------------------------- */

function doPing(ctx: Ctx, dst: string) {
  const target = ip(dst);
  const r = ping(ctx.state, ctx.dev.id, target);
  const marks = r.ok ? "!!!!!" : r.unreachable ? "U.U.U" : ".....";
  const ok = r.ok ? 5 : 0;
  ctx.out.push(
    "Type escape sequence to abort.",
    `Sending 5, 100-byte ICMP Echos to ${formatIp(target)}, timeout is 2 seconds:`,
    marks,
    `Success rate is ${ok * 20} percent (${ok}/5)${r.ok ? ", round-trip min/avg/max = 0/1/4 ms" : ""}`,
  );
}

const userExec: S[] = [
  spec("enable", "Turn on privileged commands", (c) => setMode(c, "priv")),
  spec("ping <ip:dst>", "Send echo messages", (c, a) => doPing(c, String(a.dst))),
  spec("show ip interface brief", "Brief summary of IP status and configuration", (c) => c.out.push(...showIpIntBrief(c.state, c.dev))),
  spec("show ip route", "IP routing table", (c) => c.out.push(...showIpRoute(c.state, c.dev))),
  spec("exit", "Exit from the EXEC", (c) => setMode(c, "user")),
  spec("logout", "Exit from the EXEC", (c) => setMode(c, "user")),
];

const privExec: S[] = [
  spec("configure terminal", "Configure from the terminal", (c) => {
    c.out.push("Enter configuration commands, one per line.  End with CNTL/Z.");
    setMode(c, "config");
  }),
  spec("disable", "Turn off privileged commands", (c) => setMode(c, "user")),
  spec("enable", "Turn on privileged commands", () => {}),
  spec("ping <ip:dst>", "Send echo messages", (c, a) => doPing(c, String(a.dst))),
  spec("show running-config", "Current operating configuration", (c) => c.out.push(...showRunningConfig(c.dev))),
  spec("show ip interface brief", "Brief summary of IP status and configuration", (c) => c.out.push(...showIpIntBrief(c.state, c.dev))),
  spec("show ip route", "IP routing table", (c) => c.out.push(...showIpRoute(c.state, c.dev))),
  spec("show ip ospf neighbor", "Neighbor list", (c) => c.out.push(...showOspfNeighbor(c.state, c.dev)), isRouter),
  spec("show vlan brief", "VTP all VLAN status in brief", (c) => c.out.push(...showVlanBrief(c.dev)), isSwitch),
  spec("show interfaces trunk", "Show interface trunk information", (c) => c.out.push(...showInterfacesTrunk(c.state, c.dev)), isSwitch),
  spec("copy running-config startup-config", "Copy from current system configuration", (c) => {
    c.out.push("Destination filename [startup-config]? ", "Building configuration...", "[OK]");
    c.dev.saved = true;
  }),
  spec("write", "Write running configuration to memory", (c) => {
    c.out.push("Building configuration...", "[OK]");
    c.dev.saved = true;
  }),
  spec("write memory", "Write to NV memory", (c) => {
    c.out.push("Building configuration...", "[OK]");
    c.dev.saved = true;
  }),
  spec("exit", "Exit from the EXEC", (c) => setMode(c, "user")),
  spec("logout", "Exit from the EXEC", (c) => setMode(c, "user")),
];

/* ---------------------------- CONFIG ---------------------------- */

const common: S[] = [
  spec("end", "Exit to privileged EXEC mode", (c) => {
    setMode(c, "priv");
    c.out.push("%SYS-5-CONFIG_I: Configured from console by console");
  }),
  spec("do <line:cmd>", "To run exec commands in config mode", (c, a) => c.execIn("priv", String(a.cmd))),
];

const globalConfig: S[] = [
  spec("hostname <word:name>", "Set system's network name", (c, a) => {
    c.dev.hostname = String(a.name);
  }),
  spec("interface <iface:name>", "Select an interface to configure", (c, a) => {
    const name = String(a.name);
    if (!c.dev.interfaces[name]) {
      c.dev.interfaces[name] = { name, shutdown: false };
      c.out.push(`%LINK-5-CHANGED: Interface ${name}, changed state to up`);
    }
    setMode(c, "if", { iface: name });
  }),
  spec("vlan <int:id>", "Vlan commands", (c, a) => {
    if (ensureVlan(c, Number(a.id))) setMode(c, "vlan", { vlan: Number(a.id) });
  }, isSwitch),
  spec("no vlan <int:id>", "Vlan commands", (c, a) => {
    const id = Number(a.id);
    if (id === 1) return fail(c, "%Default VLAN 1 may not be deleted.");
    delete c.dev.vlans[id];
  }, isSwitch),
  spec("ip default-gateway <ip:gw>", "Specify default gateway (if not routing IP)", (c, a) => {
    c.dev.defaultGateway = ip(a.gw);
  }, isSwitch),
  spec("no ip default-gateway", "Specify default gateway (if not routing IP)", (c) => {
    delete c.dev.defaultGateway;
  }, isSwitch),
  spec("ip route <ip:net> <ip:mask> <ip:nh>", "Establish static routes", (c, a) => {
    const net = ip(a.net);
    const mask = ip(a.mask);
    if (maskToPrefix(mask) === null || network(net, mask) !== net) return fail(c, "%Inconsistent address and mask");
    const nh = ip(a.nh);
    if (!c.dev.staticRoutes.some((r) => r.net === net && r.mask === mask && r.nextHop === nh)) {
      c.dev.staticRoutes.push({ net, mask, nextHop: nh });
    }
  }, isRouter),
  spec("no ip route <ip:net> <ip:mask> <ip:nh>", "Establish static routes", (c, a) => {
    const [net, mask, nh] = [ip(a.net), ip(a.mask), ip(a.nh)];
    c.dev.staticRoutes = c.dev.staticRoutes.filter((r) => !(r.net === net && r.mask === mask && r.nextHop === nh));
  }, isRouter),
  spec("router ospf <int:pid>", "Open Shortest Path First (OSPF)", (c, a) => {
    const pid = Number(a.pid);
    if (pid < 1 || pid > 65535) return fail(c, "% Invalid input detected at '^' marker.");
    if (c.dev.ospf && c.dev.ospf.pid !== pid) {
      return fail(c, `% Only one OSPF process is supported in this lab (process ${c.dev.ospf.pid} exists).`);
    }
    if (!c.dev.ospf) c.dev.ospf = { pid, networks: [] };
    setMode(c, "router", { ospfPid: pid });
  }, isRouter),
  spec("no router ospf <int:pid>", "Open Shortest Path First (OSPF)", (c, a) => {
    if (c.dev.ospf?.pid === Number(a.pid)) c.dev.ospf = null;
  }, isRouter),
  spec("ip routing", "Enable IP routing", () => {}),
  spec("no ip domain-lookup", "Disable IP Domain Name System hostname translation", () => {}),
  spec("ip domain-lookup", "Enable IP Domain Name System hostname translation", () => {}),
  spec("exit", "Exit from configure mode", (c) => setMode(c, "priv")),
  ...common,
];

const ifConfig: S[] = [
  spec("ip address <ip:addr> <ip:mask>", "Set the IP address of an interface", (c, a) => {
    const addr = ip(a.addr);
    const mask = ip(a.mask);
    if (maskToPrefix(mask) === null || !isHostAddress(addr, mask)) {
      return fail(c, `Bad mask /${maskToPrefix(mask) ?? "0x" + mask.toString(16).toUpperCase()} for address ${formatIp(addr)}`);
    }
    for (const other of Object.values(c.dev.interfaces)) {
      if (other.name === c.dev.ctx.iface || other.ip === undefined || other.mask === undefined) continue;
      // Overlap if either subnet contains the other: compare under the shorter mask.
      if (sameSubnet(addr, other.ip, (mask & other.mask) >>> 0)) {
        return fail(c, `% ${formatIp(network(addr, mask))} overlaps with ${other.name}`);
      }
    }
    const i = curIf(c);
    i.ip = addr;
    i.mask = mask;
  }, onL3If),
  spec("no ip address", "Set the IP address of an interface", (c) => {
    delete curIf(c).ip;
    delete curIf(c).mask;
  }, onL3If),
  spec("shutdown", "Shutdown the selected interface", (c) => {
    curIf(c).shutdown = true;
  }),
  spec("no shutdown", "Shutdown the selected interface", (c) => {
    curIf(c).shutdown = false;
  }),
  spec("description <line:text>", "Interface specific description", (c, a) => {
    curIf(c).description = String(a.text);
  }),
  spec("no description", "Interface specific description", (c) => {
    delete curIf(c).description;
  }),
  spec("switchport mode access", "Set trunking mode to ACCESS unconditionally", (c) => {
    curIf(c).switchport!.mode = "access";
  }, onSwitchPort),
  spec("switchport mode trunk", "Set trunking mode to TRUNK unconditionally", (c) => {
    curIf(c).switchport!.mode = "trunk";
  }, onSwitchPort),
  spec("switchport access vlan <int:id>", "Set VLAN when interface is in access mode", (c, a) => {
    const id = Number(a.id);
    if (id < 1 || id > 4094) return fail(c, "% Invalid input detected at '^' marker.");
    if (!(id in c.dev.vlans)) {
      c.out.push("% Access VLAN does not exist. Creating vlan " + id);
      ensureVlan(c, id);
    }
    curIf(c).switchport!.accessVlan = id;
  }, onSwitchPort),
  spec("no switchport access vlan", "Set VLAN when interface is in access mode", (c) => {
    curIf(c).switchport!.accessVlan = 1;
  }, onSwitchPort),
  spec("exit", "Exit from interface configuration mode", (c) => setMode(c, "config")),
  ...common,
];

const routerConfig: S[] = [
  spec("network <ip:net> <ip:wc> area <int:area>", "Enable routing on an IP network", (c, a) => {
    const [net, wc, area] = [ip(a.net), ip(a.wc), Number(a.area)];
    const o = c.dev.ospf!;
    const normalized = (net & ~wc) >>> 0;
    if (!o.networks.some((n) => n.net === normalized && n.wildcard === wc)) o.networks.push({ net: normalized, wildcard: wc, area });
  }),
  spec("no network <ip:net> <ip:wc> area <int:area>", "Enable routing on an IP network", (c, a) => {
    const [net, wc] = [ip(a.net), ip(a.wc)];
    const normalized = (net & ~wc) >>> 0;
    c.dev.ospf!.networks = c.dev.ospf!.networks.filter((n) => !(n.net === normalized && n.wildcard === wc));
  }),
  spec("router-id <ip:rid>", "router-id for this OSPF process", (c, a) => {
    c.dev.ospf!.routerId = ip(a.rid);
    c.out.push("Reload or use \"clear ip ospf process\" command, for this to take effect");
  }),
  spec("no router-id", "router-id for this OSPF process", (c) => {
    delete c.dev.ospf!.routerId;
  }),
  spec("exit", "Exit from routing protocol configuration mode", (c) => setMode(c, "config")),
  ...common,
];

const vlanConfig: S[] = [
  spec("name <word:name>", "Ascii name of the VLAN", (c, a) => {
    c.dev.vlans[c.dev.ctx.vlan!] = String(a.name).slice(0, 32);
  }),
  spec("exit", "Apply changes, bump revision number, and exit mode", (c) => setMode(c, "config")),
  ...common,
];

/* ---------------------------- PC ---------------------------- */

function pcPing(ctx: Ctx, dst: string) {
  const target = ip(dst);
  const r = ping(ctx.state, ctx.dev.id, target);
  const t = formatIp(target);
  ctx.out.push("", `Pinging ${t} with 32 bytes of data:`, "");
  for (let i = 0; i < 4; i++) ctx.out.push(r.ok ? `Reply from ${t}: bytes=32 time<1ms TTL=255` : "Request timed out.");
  ctx.out.push(
    "",
    `Ping statistics for ${t}:`,
    `    Packets: Sent = 4, Received = ${r.ok ? 4 : 0}, Lost = ${r.ok ? 0 : 4} (${r.ok ? 0 : 100}% loss),`,
  );
}

const pcCommands: S[] = [
  spec("ipconfig", "Display IP configuration", (c) => {
    const e = c.dev.interfaces["Ethernet0"];
    c.out.push(
      "",
      "FastEthernet0 Connection:(default port)",
      "",
      `   IPv4 Address....................: ${e.ip !== undefined ? formatIp(e.ip) : "0.0.0.0"}`,
      `   Subnet Mask.....................: ${e.mask !== undefined ? formatIp(e.mask) : "0.0.0.0"}`,
      `   Default Gateway.................: ${c.dev.defaultGateway !== undefined ? formatIp(c.dev.defaultGateway) : "0.0.0.0"}`,
      "",
    );
  }),
  spec("ipconfig <ip:addr> <ip:mask> <ip:gw>", "Set IP address, mask and gateway", (c, a) => {
    const e = c.dev.interfaces["Ethernet0"];
    e.ip = ip(a.addr);
    e.mask = ip(a.mask);
    c.dev.defaultGateway = ip(a.gw);
  }),
  spec("ping <ip:dst>", "Send echo messages", (c, a) => pcPing(c, String(a.dst))),
  spec("help", "Display PC commands", (c) => {
    c.out.push("Available Commands:", "  ipconfig                         Display IP configuration", "  ipconfig <ip> <mask> <gateway>   Set IP configuration", "  ping <ip>                        Send echo request");
  }),
];

export const MODE_SPECS: Record<Mode, S[]> = {
  user: userExec,
  priv: privExec,
  config: globalConfig,
  if: ifConfig,
  router: routerConfig,
  vlan: vlanConfig,
  pc: pcCommands,
};

/** Sub-modes fall back to global config commands, like real IOS. */
export const PARENT: Partial<Record<Mode, Mode>> = { if: "config", router: "config", vlan: "config" };
