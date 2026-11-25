import type { AclEntry, AddrMatch, CiscoState, Device, Mode } from "./model";
import { formatIp, isHostAddress, maskToPrefix, network, parseIp, sameSubnet } from "./ip";
import { eui64, formatIp6, isLinkLocal, network6, parseIp6, parsePrefix6, sameSubnet6 } from "./ip6";
import { spec, type Args, type Spec } from "./parser";
import { dhcpOffer, ping, ping6, slaacOffer, tcpConnect, type PingResult } from "./network";
import { ANY, aclKind, aclType, parsePort } from "./acl";
import {
  showCdpNeighbors,
  showClock,
  showLldpNeighbors,
  showLogging,
  showNtpAssociations,
  showNtpStatus,
  showSnmpCommunity,
} from "./mgmt";
import { spanningTreeAll } from "./stp";
import {
  showAccessLists,
  showDhcpBinding,
  showEtherchannelSummary,
  showIpv6IntBrief,
  showIpv6Route,
  showMacAddressTable,
  showPortSecurity,
  showPortSecurityInterface,
  showStandbyBrief,
  showInterfacesStatus,
  showInterfacesTrunk,
  showIpIntBrief,
  showIpProtocols,
  showIpRoute,
  showInterfaceSwitchport,
  showNatTranslations,
  showOspfInterface,
  SEVERITIES,
  showOspfIfBrief,
  showOspfNeighbor,
  showRunningConfig,
  showSpanningTree,
  showVlanBrief,
} from "./show";

export interface Ctx {
  /** State before the command (read-only). */
  state: CiscoState;
  /** Mutable copy of the active device. */
  dev: Device;
  out: string[];
  ok: boolean;
  /** Re-dispatch (used by "do"). */
  execIn: (mode: Mode, line: string) => void;
  /** Changes to other devices (e.g. NAT translations created on a router by a PC's ping). */
  effects: ((devices: Record<string, Device>) => void)[];
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
const onSubIf = (d: Device) => isRouter(d) && !!d.ctx.iface && /\.\d+$/.test(d.ctx.iface);
const onAccessCapable = (d: Device) => onSwitchPort(d) && !d.ctx.iface!.startsWith("Port-channel");
const MAC_RE = /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i;

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

/** "10,20,30-35" -> [10, 20, 30, 31, ...]. */
function parseVlanList(ctx: Ctx, text: string): number[] | null {
  const out: number[] = [];
  for (const part of text.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    const lo = m ? Number(m[1]) : NaN;
    const hi = m?.[2] ? Number(m[2]) : lo;
    if (!m || lo < 1 || hi > 4094 || hi < lo) {
      fail(ctx, "Command rejected: Bad VLAN allowed list.", "% Use a list like 10,20,999 or a range like 10-20.");
      return null;
    }
    for (let v = lo; v <= hi; v++) out.push(v);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/* ---------------------------- EXEC ---------------------------- */

/** Remember the NAT translations a ping created, for "show ip nat translations". */
function recordNat(ctx: Ctx, r: PingResult) {
  for (const { router, t } of r.translations) {
    const apply = (d: Device) => {
      const list = d.nat.translations.filter((x) => !(x.insideLocal === t.insideLocal && x.outside === t.outside));
      d.nat.translations = [...list, t].slice(-20);
    };
    if (router === ctx.dev.id) apply(ctx.dev);
    else ctx.effects.push((devices) => apply(devices[router]));
  }
}

function doPing(ctx: Ctx, dst: string) {
  const target = ip(dst);
  const r = ping(ctx.state, ctx.dev.id, target);
  recordNat(ctx, r);
  const marks = r.ok ? "!!!!!" : r.unreachable ? "U.U.U" : ".....";
  const ok = r.ok ? 5 : 0;
  ctx.out.push(
    "Type escape sequence to abort.",
    `Sending 5, 100-byte ICMP Echos to ${formatIp(target)}, timeout is 2 seconds:`,
    marks,
    `Success rate is ${ok * 20} percent (${ok}/5)${r.ok ? ", round-trip min/avg/max = 0/1/4 ms" : ""}`,
  );
}

function doPing6(ctx: Ctx, dst: string) {
  const target = parseIp6(dst)!;
  const r = ping6(ctx.state, ctx.dev.id, target);
  const marks = r.ok ? "!!!!!" : r.unreachable ? "UUUUU" : ".....";
  const ok = r.ok ? 5 : 0;
  ctx.out.push(
    "Type escape sequence to abort.",
    `Sending 5, 100-byte ICMP Echos to ${formatIp6(target)}, timeout is 2 seconds:`,
    marks,
    `Success rate is ${ok * 20} percent (${ok}/5)${r.ok ? ", round-trip min/avg/max = 0/1/4 ms" : ""}`,
  );
}

function tcpLines(ctx: Ctx, dst: string, port: number, kind: "telnet" | "ssh"): string[] {
  const r = tcpConnect(ctx.state, ctx.dev.id, ip(dst), port);
  const t = formatIp(ip(dst));
  if (r === "open") {
    const peer = Object.values(ctx.state.devices).find((d) => Object.values(d.interfaces).some((i) => i.ip === ip(dst)));
    if (kind === "ssh") return [`Connected to ${t} port 22 (SSH-2.0-OpenSSH)`, "Password: ", `% Lab note: the session to ${peer?.hostname ?? t} was opened and closed again.`];
    return [`Trying ${t} ...Open`, "", "User Access Verification", "", "Password: ", `% Lab note: the session to ${peer?.hostname ?? t} was opened and closed again.`];
  }
  if (r === "refused") return [`Trying ${t} ...`, `% Connection refused by remote host`];
  if (r === "filtered" || r === "unreachable") return [`Trying ${t} ...`, "% Destination unreachable; gateway or host down"];
  return [`Trying ${t} ...`, "% Connection timed out; remote host not responding"];
}

const mgmtShows: S[] = [
  spec("show cdp neighbors", "CDP neighbor entries", (c) => c.out.push(...showCdpNeighbors(c.state, c.dev, false))),
  spec("show cdp neighbors detail", "Show detailed information", (c) => c.out.push(...showCdpNeighbors(c.state, c.dev, true))),
  spec("show lldp neighbors", "LLDP neighbor entries", (c) => c.out.push(...showLldpNeighbors(c.state, c.dev))),
  spec("show ntp status", "NTP status", (c) => c.out.push(...showNtpStatus(c.state, c.dev))),
  spec("show ntp associations", "NTP associations", (c) => c.out.push(...showNtpAssociations(c.state, c.dev))),
  spec("show clock", "Display the system clock", (c) => c.out.push(...showClock(c.state, c.dev))),
];

const userExec: S[] = [
  spec("ping <ipv6:dst>", "Send echo messages", (c, a) => doPing6(c, String(a.dst))),
  spec("enable", "Turn on privileged commands", (c) => setMode(c, "priv")),
  spec("ping <ip:dst>", "Send echo messages", (c, a) => doPing(c, String(a.dst))),
  spec("show ip interface brief", "Brief summary of IP status and configuration", (c) => c.out.push(...showIpIntBrief(c.state, c.dev))),
  spec("show ip route", "IP routing table", (c) => c.out.push(...showIpRoute(c.state, c.dev))),
  ...mgmtShows,
  spec("telnet <ip:dst>", "Open a telnet connection", (c, a) => c.out.push(...tcpLines(c, String(a.dst), 23, "telnet"))),
  spec("exit", "Exit from the EXEC", (c) => setMode(c, "user")),
  spec("logout", "Exit from the EXEC", (c) => setMode(c, "user")),
];

const privExec: S[] = [
  ...mgmtShows,
  spec("show logging", "Show the contents of logging buffers", (c) => c.out.push(...showLogging(c.state, c.dev))),
  spec("show snmp community", "show snmp communities", (c) => c.out.push(...showSnmpCommunity(c.dev))),
  spec("show interfaces <iface:name> switchport", "Show interface switchport information", (c, a) => {
    const out = showInterfaceSwitchport(c.state, c.dev, String(a.name));
    if (!out.length) return fail(c, "% Interface is not a switchport");
    c.out.push(...out);
  }, isSwitch),
  spec("show ip ospf interface", "Interface information", (c) => c.out.push(...showOspfInterface(c.state, c.dev)), isRouter),
  spec("show ip ospf interface <iface:name>", "Interface information", (c, a) => c.out.push(...showOspfInterface(c.state, c.dev, String(a.name))), isRouter),
  spec("clear ip ospf process", "Reset OSPF process", (c) => {
    if (!c.dev.ospf) return fail(c, "% OSPF is not running");
    c.out.push("Reset ALL OSPF processes? [no]: yes");
  }, isRouter),
  spec("show ip access-lists", "List IP access lists", (c) => c.out.push(...showAccessLists(c.dev))),
  spec("telnet <ip:dst>", "Open a telnet connection", (c, a) => c.out.push(...tcpLines(c, String(a.dst), 23, "telnet"))),
  spec("ssh -l <word:user> <ip:dst>", "Open a secure shell client connection", (c, a) => c.out.push(...tcpLines(c, String(a.dst), 22, "ssh"))),
  spec("configure terminal", "Configure from the terminal", (c) => {
    c.out.push("Enter configuration commands, one per line.  End with CNTL/Z.");
    setMode(c, "config");
  }),
  spec("disable", "Turn off privileged commands", (c) => setMode(c, "user")),
  spec("ping <ipv6:dst>", "Send echo messages", (c, a) => doPing6(c, String(a.dst))),
  spec("show ipv6 interface brief", "Brief summary of IPv6 status and configuration", (c) => c.out.push(...showIpv6IntBrief(c.state, c.dev))),
  spec("show ipv6 route", "Show IPv6 route table entries", (c) => c.out.push(...showIpv6Route(c.state, c.dev)), isRouter),
  spec("show standby brief", "Brief output", (c) => c.out.push(...showStandbyBrief(c.state, c.dev)), isRouter),
  spec("show standby", "HSRP information", (c) => c.out.push(...showStandbyBrief(c.state, c.dev)), isRouter),
  spec("show etherchannel summary", "One-line summary per channel-group", (c) => c.out.push(...showEtherchannelSummary(c.state, c.dev)), isSwitch),
  spec("show port-security", "Show secure port information", (c) => c.out.push(...showPortSecurity(c.state, c.dev)), isSwitch),
  spec("show port-security interface <iface:name>", "Show secure port information", (c, a) => c.out.push(...showPortSecurityInterface(c.state, c.dev, String(a.name))), isSwitch),
  spec("show mac address-table", "MAC forwarding table", (c) => c.out.push(...showMacAddressTable(c.state, c.dev)), isSwitch),
  spec("enable", "Turn on privileged commands", () => {}),
  spec("ping <ip:dst>", "Send echo messages", (c, a) => doPing(c, String(a.dst))),
  spec("show running-config", "Current operating configuration", (c) => c.out.push(...showRunningConfig(c.dev, c.state))),
  spec("show ip interface brief", "Brief summary of IP status and configuration", (c) => c.out.push(...showIpIntBrief(c.state, c.dev))),
  spec("show ip route", "IP routing table", (c) => c.out.push(...showIpRoute(c.state, c.dev))),
  spec("show ip ospf neighbor", "Neighbor list", (c) => c.out.push(...showOspfNeighbor(c.state, c.dev)), isRouter),
  spec("show vlan brief", "VTP all VLAN status in brief", (c) => c.out.push(...showVlanBrief(c.state, c.dev)), isSwitch),
  spec("show interfaces trunk", "Show interface trunk information", (c) => c.out.push(...showInterfacesTrunk(c.state, c.dev)), isSwitch),
  spec("show interfaces status", "Show interface line status", (c) => c.out.push(...showInterfacesStatus(c.state, c.dev)), isSwitch),
  spec("show spanning-tree", "Spanning tree topology", (c) => c.out.push(...showSpanningTree(c.state, c.dev)), isSwitch),
  spec("show spanning-tree vlan <int:vlan>", "Spanning tree topology", (c, a) => {
    const out = showSpanningTree(c.state, c.dev, Number(a.vlan));
    if (!out.length) return fail(c, `Spanning tree instance(s) for vlan ${a.vlan} does not exist.`);
    c.out.push(...out);
  }, isSwitch),
  spec("show ip protocols", "IP routing protocol process parameters and statistics", (c) => c.out.push(...showIpProtocols(c.state, c.dev)), isRouter),
  spec("show ip ospf interface brief", "Brief summary of OSPF interfaces", (c) => c.out.push(...showOspfIfBrief(c.state, c.dev)), isRouter),
  spec("show ip nat translations", "Translation entries", (c) => c.out.push(...showNatTranslations(c.dev)), isRouter),
  spec("clear ip nat translation *", "Delete all dynamic translations", (c) => {
    c.dev.nat.translations = [];
  }, isRouter),
  spec("show ip dhcp binding", "DHCP address bindings", (c) => c.out.push(...showDhcpBinding(c.state, c.dev)), isRouter),
  spec("show access-lists", "List access lists", (c) => c.out.push(...showAccessLists(c.dev))),
  spec("show ip ssh", "Information on SSH", (c) => {
    const sec = c.dev.security;
    if (!sec.rsaBits) return void c.out.push("SSH Disabled - version 1.99", "%Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).");
    c.out.push(`SSH Enabled - version ${sec.sshVersion === 2 ? "2.0" : "1.99"}`, "Authentication timeout: 120 secs; Authentication retries: 3", `RSA key size: ${sec.rsaBits} bits`);
  }),
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

const shortIf = (n: string) => n.replace("FastEthernet", "Fa").replace("GigabitEthernet", "Gi");

function defaultSecurity() {
  return { enabled: false, max: 1, sticky: false, macs: [] as string[], violation: "shutdown" as const };
}

function security(c: Ctx) {
  const sp = curIf(c).switchport!;
  sp.portSecurity ??= defaultSecurity();
  return sp.portSecurity;
}

function hsrp(c: Ctx, g: number) {
  const i = curIf(c);
  i.hsrp ??= {};
  i.hsrp[g] ??= { priority: 100, preempt: false };
  return i.hsrp[g];
}

function addV6(c: Ctx, text: string, eui: boolean) {
  const { addr, prefix } = parsePrefix6(text)!;
  if (eui && prefix > 64) return fail(c, "% Prefix length must be 64 or less for an EUI-64 address");
  const full = eui ? network6(addr, 64) | eui64(c.dev.mac) : addr;
  if (isLinkLocal(full)) return fail(c, "% Use 'ipv6 address <addr> link-local' for link-local addresses");
  for (const other of Object.values(c.dev.interfaces)) {
    if (other.name === c.dev.ctx.iface) continue;
    for (const o of other.ipv6 ?? []) {
      if (sameSubnet6(full, o.addr, Math.min(prefix, o.prefix))) return fail(c, `% ${formatIp6(network6(full, prefix))}/${prefix} overlaps with ${other.name}`);
    }
  }
  const i = curIf(c);
  i.ipv6 = [...(i.ipv6 ?? []).filter((x) => network6(x.addr, x.prefix) !== network6(full, prefix)), { addr: full, prefix, ...(eui ? { eui64: true } : {}) }];
}

function addStatic(c: Ctx, a: Args) {
  const net = ip(a.net);
  const mask = ip(a.mask);
  if (maskToPrefix(mask) === null || network(net, mask) !== net) return fail(c, "%Inconsistent address and mask");
  const nh = ip(a.nh);
  const ad = a.ad === undefined ? undefined : Number(a.ad);
  if (ad !== undefined && (ad < 1 || ad > 255)) return fail(c, "% Invalid input detected at '^' marker.");
  if (Object.values(c.dev.interfaces).some((i) => i.ip === nh)) return fail(c, "%Invalid next hop address (it's this router)");
  const existing = c.dev.staticRoutes.find((r) => r.net === net && r.mask === mask && r.nextHop === nh);
  if (existing) {
    if (ad === undefined || ad === 1) delete existing.ad;
    else existing.ad = ad;
  } else {
    c.dev.staticRoutes.push(ad === undefined || ad === 1 ? { net, mask, nextHop: nh } : { net, mask, nextHop: nh, ad });
  }
}

/* Access lists: every combination of source/destination forms, generated as specs. */

const SRC_FORMS = [
  { pat: "any", get: (): AddrMatch => ANY },
  { pat: "host <ip:srcHost>", get: (a: Args): AddrMatch => ({ ip: ip(a.srcHost), wildcard: 0 }) },
  { pat: "<ip:srcNet> <ip:srcWc>", get: (a: Args): AddrMatch => ({ ip: (ip(a.srcNet) & ~ip(a.srcWc)) >>> 0, wildcard: ip(a.srcWc) }) },
];
const DST_FORMS = SRC_FORMS.map((f) => ({
  pat: f.pat.replace(/src/g, "dst"),
  get: (a: Args) => f.get(Object.fromEntries(Object.entries(a).map(([k, v]) => [k.replace(/^dst/, "src"), v]))),
}));

function addAce(c: Ctx, a: Args, kind: "standard" | "extended", entry: AclEntry) {
  if (c.dev.namedAcls[String(a.n)]) return fail(c, `% Access list ${a.n} is a named list: edit it with "ip access-list ${c.dev.namedAcls[String(a.n)]} ${a.n}".`);
  const n = Number(a.n);
  const actual = aclKind(n);
  if (!actual) return fail(c, "% Invalid input detected at '^' marker.", "% Use 1-99 for standard and 100-199 for extended access lists.");
  if (actual !== kind) {
    return fail(
      c,
      actual === "standard"
        ? `% Access list ${n} is a standard list: it only matches a source, e.g. "access-list ${n} permit 192.168.1.0 0.0.0.255".`
        : `% Access list ${n} is an extended list: give a protocol, source and destination, e.g. "access-list ${n} deny ip any any".`,
    );
  }
  const list = (c.dev.acls[String(n)] ??= []);
  const same = (x: AclEntry) => JSON.stringify({ ...x, seq: undefined }) === JSON.stringify(entry);
  // Once a numbered list has been edited in named mode its entries carry sequence numbers.
  if (!list.some(same)) list.push(list.some((e) => e.seq !== undefined) ? { ...entry, seq: Math.max(...list.map((e) => e.seq ?? 0)) + 10 } : entry);
}

/**
 * Every permit/deny form, as specs. "head" is what comes before the action:
 * "access-list <int:n>" for numbered lists, "" or "<int:seq>" inside a named list.
 */
function aceSpecs(head: string, add: (c: Ctx, a: Args, kind: "standard" | "extended", entry: AclEntry) => void, when: (d: Device) => boolean, kinds: ("standard" | "extended")[]): S[] {
  const out: S[] = [];
  const pre = head ? head + " " : "";
  for (const action of ["permit", "deny"] as const) {
    if (kinds.includes("standard")) {
      out.push(spec(`${pre}${action} <ip:srcHost>`, "Specify packets to " + (action === "permit" ? "forward" : "reject"), (c, a) =>
        add(c, a, "standard", { action, src: { ip: ip(a.srcHost), wildcard: 0 } }), when));
    }
    for (const sf of SRC_FORMS) {
      if (kinds.includes("standard")) {
        out.push(spec(`${pre}${action} ${sf.pat}`, "Specify packets to " + (action === "permit" ? "forward" : "reject"), (c, a) => add(c, a, "standard", { action, src: sf.get(a) }), when));
      }
      if (!kinds.includes("extended")) continue;
      for (const proto of ["ip", "icmp", "tcp", "udp"] as const) {
        for (const df of DST_FORMS) {
          const base = `${pre}${action} ${proto} ${sf.pat} ${df.pat}`;
          out.push(spec(base, "Specify packets to " + (action === "permit" ? "forward" : "reject"), (c, a) =>
            add(c, a, "extended", { action, proto, src: sf.get(a), dst: df.get(a) }), when));
          if (proto === "tcp" || proto === "udp") {
            out.push(spec(`${base} eq <word:port>`, "Match only packets on a given port number", (c, a) => {
              const port = parsePort(proto, String(a.port));
              if (port === null) return fail(c, "% Invalid input detected at '^' marker.", `% Give a port number or a ${proto.toUpperCase()} port name (e.g. ${proto === "tcp" ? "www, telnet, 443" : "domain, ntp, 514"}).`);
              add(c, a, "extended", { action, proto, src: sf.get(a), dst: df.get(a), port });
            }, when));
          }
        }
      }
    }
  }
  return out;
}

const aclSpecs: S[] = aceSpecs("access-list <int:n>", addAce, isRouter, ["standard", "extended"]);

/** Named-list entries carry sequence numbers; numbered lists edited in named mode get them on entry. */
function numberEntries(list: AclEntry[]) {
  list.forEach((e, i) => {
    e.seq ??= (i + 1) * 10;
  });
}

function addNamedAce(c: Ctx, a: Args, _kind: "standard" | "extended", entry: AclEntry) {
  const list = (c.dev.acls[c.dev.ctx.acl!] ??= []);
  numberEntries(list);
  const same = (x: AclEntry) => JSON.stringify({ ...x, seq: undefined }) === JSON.stringify({ ...entry, seq: undefined });
  if (list.some(same)) return;
  const seq = a.seq !== undefined ? Number(a.seq) : Math.max(0, ...list.map((e) => e.seq!)) + 10;
  if (seq < 1 || seq > 2147483647) return fail(c, "% Invalid input detected at '^' marker.");
  if (list.some((e) => e.seq === seq)) return fail(c, "% Duplicate sequence number");
  list.push({ ...entry, seq });
  list.sort((x, y) => x.seq! - y.seq!);
}

const naclKind = (kind: "standard" | "extended") => (d: Device) => !!d.ctx.acl && aclType(d, d.ctx.acl) === kind;

function enterNamedAcl(c: Ctx, kind: "standard" | "extended", name: string) {
  if (/^\d+$/.test(name)) {
    if (aclKind(Number(name)) !== kind) return fail(c, `% ${name} is not a valid ${kind} access list number`);
  } else {
    const existing = c.dev.namedAcls[name];
    if (existing && existing !== kind) return fail(c, `% A named ${existing} IP access list with this name already exists`);
    c.dev.namedAcls[name] = kind;
  }
  numberEntries((c.dev.acls[name] ??= []));
  setMode(c, "nacl", { acl: name });
}

function genKeys(c: Ctx, bits: number) {
  const sec = c.dev.security;
  if (c.dev.hostname === "Router" || c.dev.hostname === "Switch") return fail(c, "% Please define a hostname other than Router.");
  if (!sec.domainName) return fail(c, "% Please define a domain-name first.");
  if (bits < 360 || bits > 4096) return fail(c, "% Invalid input detected at '^' marker.", "% Key size must be between 360 and 4096 bits.");
  c.out.push(
    `The name for the keys will be: ${c.dev.hostname}.${sec.domainName}`,
    `Choose the size of the key modulus in the range of 360 to 4096 for your`,
    `  General Purpose Keys. Choosing a key modulus greater than 512 may take`,
    `  a few minutes.`,
    "",
    `How many bits in the modulus [512]: ${bits}`,
    `% Generating ${bits} bit RSA keys, keys will be non-exportable...[OK]`,
    "",
    `*Mar 1 0:12:31.123: %SSH-5-ENABLED: SSH 1.99 has been enabled`,
  );
  sec.rsaBits = bits;
}

function setRootPriority(c: Ctx, vlan: number, primary: boolean) {
  if (!ensureVlan(c, vlan)) return;
  if (!primary) {
    c.dev.stp.priority[vlan] = 28672;
    return;
  }
  // Like IOS: 24576, or 4096 below the current root if that is already lower.
  const tree = spanningTreeAll(c.state, vlan)[c.dev.id];
  const rootBase = tree && tree.rootDevice !== c.dev.id ? tree.root.priority - vlan : Infinity;
  const target = rootBase <= 24576 ? Math.max(0, rootBase - 4096) : 24576;
  c.dev.stp.priority[vlan] = target;
}

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
    // SVIs ("interface vlan 10"), loopbacks, subinterfaces and port-channels are created on first use.
    if (!c.dev.interfaces[name]) {
      c.dev.interfaces[name] = name.startsWith("Port-channel")
        ? { name, shutdown: false, switchport: { mode: "dynamic", accessVlan: 1 } }
        : { name, shutdown: false };
    }
    setMode(c, "if", { iface: name });
  }),
  spec("interface range <iface:first> - <int:last>", "interface range command", (c, a) => {
    const first = String(a.first);
    const m = /^(.*\/)(\d+)$/.exec(first);
    const last = Number(a.last);
    if (!m || last < Number(m[2])) return fail(c, "% Invalid input detected at '^' marker.");
    const names: string[] = [];
    for (let n = Number(m[2]); n <= last; n++) {
      const name = m[1] + n;
      if (!c.dev.interfaces[name]) return fail(c, `% Interface ${name} does not exist`, "% Command rejected: Bad interface range");
      names.push(name);
    }
    setMode(c, "if", { iface: names[0], range: names });
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
  spec("ip route <ip:net> <ip:mask> <ip:nh>", "Establish static routes", (c, a) => addStatic(c, a), isRouter),
  spec("ip route <ip:net> <ip:mask> <ip:nh> <int:ad>", "Establish static routes", (c, a) => addStatic(c, a), isRouter),
  spec("no ip route <ip:net> <ip:mask> <ip:nh> <int:ad>", "Establish static routes", (c, a) => {
    const [net, mask, nh] = [ip(a.net), ip(a.mask), ip(a.nh)];
    c.dev.staticRoutes = c.dev.staticRoutes.filter((r) => !(r.net === net && r.mask === mask && r.nextHop === nh));
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
  ...aclSpecs,
  spec("no access-list <int:n>", "Add an access list entry", (c, a) => {
    delete c.dev.acls[String(a.n)];
  }, isRouter),
  spec("ip nat inside source list <word:acl> interface <iface:o> overload", "Specify access list describing local addresses", (c, a) => {
    const rule = { kind: "overload" as const, acl: String(a.acl), iface: String(a.o) };
    c.dev.nat.rules = c.dev.nat.rules.filter((r) => !(r.kind === "overload" && r.acl === rule.acl));
    c.dev.nat.rules.push(rule);
  }, isRouter),
  spec("no ip nat inside source list <word:acl> interface <iface:o> overload", "Specify access list describing local addresses", (c, a) => {
    c.dev.nat.rules = c.dev.nat.rules.filter((r) => !(r.kind === "overload" && r.acl === String(a.acl)));
  }, isRouter),
  spec("ip nat inside source static <ip:local> <ip:global>", "Specify static local->global mapping", (c, a) => {
    const [local, global] = [ip(a.local), ip(a.global)];
    if (c.dev.nat.rules.some((r) => r.kind === "static" && (r.local === local || r.global === global))) {
      return fail(c, `% ${formatIp(local)} already mapped (${formatIp(local)} -> ${formatIp(global)})`);
    }
    c.dev.nat.rules.push({ kind: "static", local, global });
  }, isRouter),
  spec("no ip nat inside source static <ip:local> <ip:global>", "Specify static local->global mapping", (c, a) => {
    const [local, global] = [ip(a.local), ip(a.global)];
    c.dev.nat.rules = c.dev.nat.rules.filter((r) => !(r.kind === "static" && r.local === local && r.global === global));
  }, isRouter),
  spec("ip dhcp excluded-address <ip:lo>", "Prevent DHCP from assigning certain addresses", (c, a) => {
    c.dev.dhcp.excluded.push([ip(a.lo), ip(a.lo)]);
  }, isRouter),
  spec("ip dhcp excluded-address <ip:lo> <ip:hi>", "Prevent DHCP from assigning certain addresses", (c, a) => {
    const [lo, hi] = [ip(a.lo), ip(a.hi)];
    if (hi < lo) return fail(c, "% Invalid address range");
    c.dev.dhcp.excluded.push([lo, hi]);
  }, isRouter),
  spec("no ip dhcp excluded-address <ip:lo> <ip:hi>", "Prevent DHCP from assigning certain addresses", (c, a) => {
    const [lo, hi] = [ip(a.lo), ip(a.hi)];
    c.dev.dhcp.excluded = c.dev.dhcp.excluded.filter(([x, y]) => !(x === lo && y === hi));
  }, isRouter),
  spec("ip dhcp pool <word:name>", "Configure DHCP address pools", (c, a) => {
    const name = String(a.name);
    c.dev.dhcp.pools[name] ??= { name };
    setMode(c, "dhcp", { pool: name });
  }, isRouter),
  spec("no ip dhcp pool <word:name>", "Configure DHCP address pools", (c, a) => {
    delete c.dev.dhcp.pools[String(a.name)];
  }, isRouter),
  spec("spanning-tree mode rapid-pvst", "Per-Vlan rapid spanning tree mode", (c) => {
    c.dev.stp.mode = "rapid-pvst";
  }, isSwitch),
  spec("spanning-tree mode pvst", "Per-Vlan spanning tree mode", (c) => {
    c.dev.stp.mode = "pvst";
  }, isSwitch),
  spec("spanning-tree vlan <int:vlan> priority <int:p>", "Set the bridge priority for the spanning tree", (c, a) => {
    const p = Number(a.p);
    if (p > 61440 || p % 4096 !== 0) {
      return fail(c, "% Bridge Priority must be in increments of 4096.", "% Allowed values are:", "  0     4096  8192  12288 16384 20480 24576 28672", "  32768 36864 40960 45056 49152 53248 57344 61440");
    }
    if (ensureVlan(c, Number(a.vlan))) c.dev.stp.priority[Number(a.vlan)] = p;
  }, isSwitch),
  spec("spanning-tree vlan <int:vlan> root primary", "Configure switch as root", (c, a) => setRootPriority(c, Number(a.vlan), true), isSwitch),
  spec("spanning-tree vlan <int:vlan> root secondary", "Configure switch as secondary root", (c, a) => setRootPriority(c, Number(a.vlan), false), isSwitch),
  spec("no spanning-tree vlan <int:vlan> priority", "Set the bridge priority for the spanning tree", (c, a) => {
    delete c.dev.stp.priority[Number(a.vlan)];
  }, isSwitch),
  spec("no spanning-tree vlan <int:vlan>", "VLAN Switch Spanning Tree", (c, a) => {
    delete c.dev.stp.priority[Number(a.vlan)];
  }, isSwitch),
  spec("enable secret <word:pw>", "Assign the privileged level secret", (c, a) => {
    c.dev.security.enableSecret = String(a.pw);
  }),
  spec("enable password <word:pw>", "Assign the privileged level password", (c, a) => {
    c.dev.security.enablePassword = String(a.pw);
  }),
  spec("no enable secret", "Assign the privileged level secret", (c) => {
    delete c.dev.security.enableSecret;
  }),
  spec("service password-encryption", "Encrypt system passwords", (c) => {
    c.dev.security.passwordEncryption = true;
  }),
  spec("no service password-encryption", "Encrypt system passwords", (c) => {
    c.dev.security.passwordEncryption = false;
  }),
  spec("ip domain-name <word:d>", "Define the default domain name", (c, a) => {
    c.dev.security.domainName = String(a.d);
  }),
  spec("ip domain name <word:d>", "Define the default domain name", (c, a) => {
    c.dev.security.domainName = String(a.d);
  }),
  spec("crypto key generate rsa", "Generate RSA keys", (c) => genKeys(c, 512)),
  spec("crypto key generate rsa modulus <int:bits>", "Generate RSA keys", (c, a) => genKeys(c, Number(a.bits))),
  spec("crypto key generate rsa general-keys modulus <int:bits>", "Generate RSA keys", (c, a) => genKeys(c, Number(a.bits))),
  spec("ip ssh version <int:version>", "Specify protocol version to be supported", (c, a) => {
    const v = Number(a.version);
    if (v !== 1 && v !== 2) return fail(c, "% Invalid input detected at '^' marker.");
    if (v === 2 && (c.dev.security.rsaBits ?? 0) < 768) return fail(c, "Please create RSA keys (of atleast 768 bits size) to enable SSH v2.");
    if (v === 2) c.dev.security.sshVersion = 2;
    else delete c.dev.security.sshVersion;
  }),
  spec("username <word:u> secret <word:pw>", "Establish User Name Authentication", (c, a) => {
    c.dev.security.users[String(a.u)] = String(a.pw);
  }),
  spec("username <word:u> password <word:pw>", "Establish User Name Authentication", (c, a) => {
    c.dev.security.users[String(a.u)] = String(a.pw);
  }),
  spec("banner motd <line:text>", "Set Message of the Day banner", (c, a) => {
    const t = String(a.text);
    const d = t[0];
    const end = t.indexOf(d, 1);
    c.dev.security.banner = end > 0 ? t.slice(1, end) : t.slice(1);
  }),
  spec("line console 0", "Primary terminal line", (c) => setMode(c, "line", { line: "con" })),
  spec("line vty <int:a> <int:b>", "Virtual terminal", (c, a) => {
    if (Number(a.a) !== 0 || Number(a.b) < 4 || Number(a.b) > 15) return fail(c, "% Invalid input detected at '^' marker.", "% Use 'line vty 0 4' or 'line vty 0 15' in this lab.");
    setMode(c, "line", { line: "vty" });
  }),
  ...(["standard", "extended"] as const).flatMap((kind) => [
    spec<Ctx>(`ip access-list ${kind} <word:name>`, `${kind[0].toUpperCase() + kind.slice(1)} Access List`, (c, a) => enterNamedAcl(c, kind, String(a.name)), isRouter),
    spec<Ctx>(`no ip access-list ${kind} <word:name>`, `${kind[0].toUpperCase() + kind.slice(1)} Access List`, (c, a) => {
      const name = String(a.name);
      delete c.dev.acls[name];
      delete c.dev.namedAcls[name];
    }, isRouter),
  ]),
  spec("ntp server <ip:addr>", "Configure NTP server", (c, a) => {
    const addr = ip(a.addr);
    if (!c.dev.mgmt.ntpServers.includes(addr)) c.dev.mgmt.ntpServers.push(addr);
  }),
  spec("no ntp server <ip:addr>", "Configure NTP server", (c, a) => {
    c.dev.mgmt.ntpServers = c.dev.mgmt.ntpServers.filter((x) => x !== ip(a.addr));
  }),
  spec("ntp master", "Act as NTP master clock", (c) => {
    c.dev.mgmt.ntpMaster = 8;
  }, isRouter),
  spec("ntp master <int:stratum>", "Act as NTP master clock", (c, a) => {
    const st = Number(a.stratum);
    if (st < 1 || st > 15) return fail(c, "% Invalid input detected at '^' marker.");
    c.dev.mgmt.ntpMaster = st;
  }, isRouter),
  spec("no ntp master", "Act as NTP master clock", (c) => {
    delete c.dev.mgmt.ntpMaster;
  }, isRouter),
  spec("clock timezone <word:zone> <word:hours>", "Configure time zone", (c, a) => {
    const h = Number(a.hours);
    if (!Number.isInteger(h) || h < -23 || h > 23) return fail(c, "% Invalid input detected at '^' marker.");
    c.dev.mgmt.timezone = { name: String(a.zone), offset: h };
  }),
  ...["logging host <ip:h>", "logging <ip:h>"].map((pat) =>
    spec<Ctx>(pat, "Set syslog server IP address and parameters", (c, a) => {
      const h = ip(a.h);
      if (!c.dev.mgmt.logHosts.includes(h)) c.dev.mgmt.logHosts.push(h);
    }),
  ),
  spec("no logging host <ip:h>", "Set syslog server IP address and parameters", (c, a) => {
    c.dev.mgmt.logHosts = c.dev.mgmt.logHosts.filter((x) => x !== ip(a.h));
  }),
  spec("logging trap <word:level>", "Set syslog server logging level", (c, a) => {
    const t = String(a.level).toLowerCase();
    const n = /^[0-7]$/.test(t) ? Number(t) : SEVERITIES.findIndex((x) => x.startsWith(t));
    if (n < 0) return fail(c, "% Invalid input detected at '^' marker.", `% Levels: 0-7 or ${SEVERITIES.join(", ")}`);
    c.dev.mgmt.logTrap = n;
  }),
  ...["service timestamps log datetime msec", "service timestamps log datetime", "service timestamps"].map((pat) =>
    spec<Ctx>(pat, "Timestamp debug/log messages", (c) => {
      c.dev.mgmt.timestamps = true;
    }),
  ),
  spec("no service timestamps", "Timestamp debug/log messages", (c) => {
    c.dev.mgmt.timestamps = false;
  }),
  ...(["ro", "rw"] as const).map((access) =>
    spec<Ctx>(`snmp-server community <word:name> ${access}`, access === "ro" ? "Read-only access with this community string" : "Read-write access with this community string", (c, a) => {
      const name = String(a.name);
      c.dev.mgmt.snmp = [...c.dev.mgmt.snmp.filter((x) => x.name !== name), { name, access }];
    }),
  ),
  spec("no snmp-server community <word:name>", "Enable SNMP; set community string and access privs", (c, a) => {
    c.dev.mgmt.snmp = c.dev.mgmt.snmp.filter((x) => x.name !== String(a.name));
  }),
  spec("snmp-server location <line:text>", "Text for mib object sysLocation", (c, a) => {
    c.dev.mgmt.snmpLocation = String(a.text);
  }),
  spec("snmp-server contact <line:text>", "Text for mib object sysContact", (c, a) => {
    c.dev.mgmt.snmpContact = String(a.text);
  }),
  spec("cdp run", "Enable CDP", (c) => {
    c.dev.mgmt.cdp = true;
  }),
  spec("no cdp run", "Enable CDP", (c) => {
    c.dev.mgmt.cdp = false;
  }),
  spec("lldp run", "Enable LLDP", (c) => {
    c.dev.mgmt.lldp = true;
  }),
  spec("no lldp run", "Enable LLDP", (c) => {
    c.dev.mgmt.lldp = false;
  }),
  spec("ip routing", "Enable IP routing", () => {}),
  spec("ipv6 unicast-routing", "Enable unicast routing", (c) => {
    c.dev.ipv6Routing = true;
  }, isRouter),
  spec("no ipv6 unicast-routing", "Enable unicast routing", (c) => {
    c.dev.ipv6Routing = false;
  }, isRouter),
  spec("ipv6 route <ipv6p:pfx> <ipv6:nh>", "Configure static routes", (c, a) => {
    const { addr, prefix } = parsePrefix6(String(a.pfx))!;
    const nh = parseIp6(String(a.nh))!;
    if (isLinkLocal(nh)) return fail(c, "% Interface has to be specified for a link-local nexthop");
    const net = network6(addr, prefix);
    if (!c.dev.staticRoutes6.some((r) => r.net === net && r.prefix === prefix && r.nextHop === nh)) c.dev.staticRoutes6.push({ net, prefix, nextHop: nh });
  }, isRouter),
  spec("no ipv6 route <ipv6p:pfx> <ipv6:nh>", "Configure static routes", (c, a) => {
    const { addr, prefix } = parsePrefix6(String(a.pfx))!;
    const nh = parseIp6(String(a.nh))!;
    const net = network6(addr, prefix);
    c.dev.staticRoutes6 = c.dev.staticRoutes6.filter((r) => !(r.net === net && r.prefix === prefix && r.nextHop === nh));
  }, isRouter),
  spec("no ip domain-lookup", "Disable IP Domain Name System hostname translation", () => {}),
  spec("ip domain-lookup", "Enable IP Domain Name System hostname translation", () => {}),
  spec("exit", "Exit from configure mode", (c) => setMode(c, "priv")),
  ...common,
];

const ifConfig: S[] = [
  spec("ip address <ip:addr> <ip:mask>", "Set the IP address of an interface", (c, a) => {
    const addr = ip(a.addr);
    const mask = ip(a.mask);
    if (onSubIf(c.dev) && curIf(c).dot1q === undefined) {
      return fail(c, "% Configuring IP routing on a LAN subinterface is only allowed if that", "subinterface is already configured as part of an IEEE 802.10, IEEE 802.1Q,", "or ISL vLAN.");
    }
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
  spec("encapsulation dot1q <int:vlan>", "IEEE 802.1Q Virtual LAN", (c, a) => {
    const v = Number(a.vlan);
    if (v < 1 || v > 4094) return fail(c, "% Invalid input detected at '^' marker.");
    const parent = c.dev.ctx.iface!.replace(/\.\d+$/, "");
    const clash = Object.values(c.dev.interfaces).find((i) => i.name !== c.dev.ctx.iface && i.dot1q === v && i.name.startsWith(parent + "."));
    if (clash) return fail(c, `Configuration of multiple subinterfaces of the same main`, `interface with the same VID (${v}) is not permitted.`, `This VID is already configured on ${clash.name}.`);
    curIf(c).dot1q = v;
  }, onSubIf),
  ...(["active", "passive", "on", "desirable", "auto"] as const).map((mode) =>
    spec<Ctx>(`channel-group <int:id> mode ${mode}`, "Etherchannel / port bundling configuration", (c, a) => {
      const id = Number(a.id);
      if (id < 1 || id > 48) return fail(c, "% Invalid input detected at '^' marker.");
      const me = curIf(c);
      if (me.channelGroup && me.channelGroup.id === id && me.channelGroup.mode !== mode) {
        const proto = (m: string) => (m === "active" || m === "passive" ? "LACP" : m === "on" ? "none" : "PAgP");
        if (proto(me.channelGroup.mode) !== proto(mode)) return fail(c, `Command rejected (Channel protocol mismatch for interface ${shortIf(me.name)} in group ${id}): the interface can not be added to the channel group`);
      }
      const po = `Port-channel${id}`;
      if (!c.dev.interfaces[po]) {
        c.out.push(`Creating a port-channel interface Port-channel ${id}`);
        c.dev.interfaces[po] = { name: po, shutdown: false, switchport: { mode: me.switchport!.mode, accessVlan: me.switchport!.accessVlan } };
      }
      me.channelGroup = { id, mode };
    }, onAccessCapable),
  ),
  spec("no channel-group", "Etherchannel / port bundling configuration", (c) => {
    delete curIf(c).channelGroup;
  }, onAccessCapable),
  spec("switchport port-security", "Security related command", (c) => {
    const sp = curIf(c).switchport!;
    if (sp.mode !== "access") return fail(c, `Command rejected: ${c.dev.ctx.iface} is a dynamic port.`);
    sp.portSecurity = { ...(sp.portSecurity ?? defaultSecurity()), enabled: true };
  }, onAccessCapable),
  spec("no switchport port-security", "Security related command", (c) => {
    const sp = curIf(c).switchport!;
    if (sp.portSecurity) sp.portSecurity.enabled = false;
  }, onAccessCapable),
  spec("switchport port-security maximum <int:n>", "Max secure addresses", (c, a) => {
    const n = Number(a.n);
    if (n < 1 || n > 132) return fail(c, "% Invalid input detected at '^' marker.");
    security(c).max = n;
  }, onAccessCapable),
  spec("switchport port-security mac-address sticky", "Configure dynamic secure addresses as sticky", (c) => {
    security(c).sticky = true;
  }, onAccessCapable),
  spec("no switchport port-security mac-address sticky", "Configure dynamic secure addresses as sticky", (c) => {
    security(c).sticky = false;
  }, onAccessCapable),
  spec("switchport port-security mac-address <word:mac>", "Secure mac address", (c, a) => {
    const mac = String(a.mac);
    if (!MAC_RE.test(mac)) return fail(c, "% Invalid input detected at '^' marker.", "% Use the format HHHH.HHHH.HHHH, e.g. 0060.3E1A.22B4");
    const ps = security(c);
    if (ps.macs.length >= ps.max) return fail(c, `Total secure mac-addresses on interface ${c.dev.ctx.iface} has reached maximum limit.`);
    const norm = mac.toUpperCase();
    if (!ps.macs.includes(norm)) ps.macs.push(norm);
  }, onAccessCapable),
  ...(["shutdown", "restrict", "protect"] as const).map((v) =>
    spec<Ctx>(`switchport port-security violation ${v}`, "Security violation mode", (c) => {
      security(c).violation = v;
    }, onAccessCapable),
  ),
  spec("standby <int:g> ip <ip:vip>", "HSRP interface configuration commands", (c, a) => {
    const i = curIf(c);
    const vip = ip(a.vip);
    if (i.ip === undefined || i.mask === undefined) return fail(c, "% Interface has no IP address: configure one before HSRP.");
    if (!sameSubnet(vip, i.ip, i.mask) || vip === i.ip) return fail(c, `% ${formatIp(vip)} is not a valid virtual address on this interface's subnet`);
    hsrp(c, Number(a.g)).ip = vip;
  }, (d) => isRouter(d) && onL3If(d)),
  spec("standby <int:g> priority <int:p>", "Priority level", (c, a) => {
    const p = Number(a.p);
    if (p > 255) return fail(c, "% Invalid input detected at '^' marker.");
    hsrp(c, Number(a.g)).priority = p;
  }, (d) => isRouter(d) && onL3If(d)),
  spec("standby <int:g> preempt", "Overthrow lower priority Active routers", (c, a) => {
    hsrp(c, Number(a.g)).preempt = true;
  }, (d) => isRouter(d) && onL3If(d)),
  spec("no standby <int:g> preempt", "Overthrow lower priority Active routers", (c, a) => {
    hsrp(c, Number(a.g)).preempt = false;
  }, (d) => isRouter(d) && onL3If(d)),
  spec("standby version <int:v>", "HSRP version", (c, a) => {
    if (Number(a.v) !== 1 && Number(a.v) !== 2) return fail(c, "% Invalid input detected at '^' marker.");
  }, (d) => isRouter(d) && onL3If(d)),
  spec("ipv6 address <ipv6p:a>", "Configure IPv6 address on interface", (c, a) => addV6(c, String(a.a), false), (d) => onL3If(d)),
  spec("ipv6 address <ipv6p:a> eui-64", "Use eui-64 interface identifier", (c, a) => addV6(c, String(a.a), true), (d) => onL3If(d)),
  spec("no ipv6 address", "Configure IPv6 address on interface", (c) => {
    delete curIf(c).ipv6;
  }, (d) => onL3If(d)),
  spec("ipv6 enable", "Enable IPv6 on interface", (c) => {
    curIf(c).ipv6Enabled = true;
  }, (d) => onL3If(d)),
  spec("spanning-tree portfast", "Enable an interface to move directly to forwarding on link up", (c) => {
    curIf(c).switchport!.portfast = true;
    c.out.push(
      "%Warning: portfast should only be enabled on ports connected to a single",
      " host. Connecting hubs, concentrators, switches, bridges, etc... to this",
      " interface  when portfast is enabled, can cause temporary bridging loops.",
      " Use with CAUTION",
      "",
      `%Portfast has been configured on ${c.dev.ctx.iface} but will only`,
      " have effect when the interface is in a non-trunking mode.",
    );
  }, onSwitchPort),
  spec("no spanning-tree portfast", "Enable an interface to move directly to forwarding on link up", (c) => {
    delete curIf(c).switchport!.portfast;
  }, onSwitchPort),
  spec("spanning-tree bpduguard enable", "Enable BPDU guard for this interface", (c) => {
    curIf(c).switchport!.bpduguard = true;
  }, onSwitchPort),
  spec("spanning-tree bpduguard disable", "Disable BPDU guard for this interface", (c) => {
    delete curIf(c).switchport!.bpduguard;
  }, onSwitchPort),
  spec("no spanning-tree bpduguard", "Don't configure BPDU guard for this interface", (c) => {
    delete curIf(c).switchport!.bpduguard;
  }, onSwitchPort),
  spec("ip nat inside", "Inside interface for address translation", (c) => {
    curIf(c).nat = "inside";
  }, (d) => isRouter(d) && onL3If(d)),
  spec("ip nat outside", "Outside interface for address translation", (c) => {
    curIf(c).nat = "outside";
  }, (d) => isRouter(d) && onL3If(d)),
  spec("no ip nat inside", "Inside interface for address translation", (c) => {
    if (curIf(c).nat === "inside") delete curIf(c).nat;
  }, (d) => isRouter(d) && onL3If(d)),
  spec("no ip nat outside", "Outside interface for address translation", (c) => {
    if (curIf(c).nat === "outside") delete curIf(c).nat;
  }, (d) => isRouter(d) && onL3If(d)),
  ...(["in", "out"] as const).flatMap((dir) => [
    spec<Ctx>(`ip access-group <word:acl> ${dir}`, "Specify access control for packets", (c, a) => {
      const i = curIf(c);
      i.acl = { ...i.acl, [dir]: String(a.acl) };
    }, (d: Device) => isRouter(d) && onL3If(d)),
    spec<Ctx>(`no ip access-group <word:acl> ${dir}`, "Specify access control for packets", (c) => {
      const i = curIf(c);
      if (i.acl) delete i.acl[dir];
    }, (d: Device) => isRouter(d) && onL3If(d)),
  ]),
  spec("ip helper-address <ip:addr>", "Specify a destination address for UDP broadcasts", (c, a) => {
    curIf(c).helper = ip(a.addr);
  }, (d) => isRouter(d) && onL3If(d)),
  spec("no ip helper-address", "Specify a destination address for UDP broadcasts", (c) => {
    delete curIf(c).helper;
  }, (d) => isRouter(d) && onL3If(d)),
  spec("no ip helper-address <ip:addr>", "Specify a destination address for UDP broadcasts", (c) => {
    delete curIf(c).helper;
  }, (d) => isRouter(d) && onL3If(d)),
  spec("ip ospf priority <int:p>", "Router priority", (c, a) => {
    const p = Number(a.p);
    if (p > 255) return fail(c, "% Invalid input detected at '^' marker.");
    curIf(c).ospfPriority = p;
  }, (d) => isRouter(d) && onL3If(d)),
  spec("no ip ospf priority", "Router priority", (c) => {
    delete curIf(c).ospfPriority;
  }, (d) => isRouter(d) && onL3If(d)),
  spec("switchport mode dynamic desirable", "Set trunking mode dynamic negotiation parameter to DESIRABLE", (c) => {
    curIf(c).switchport!.mode = "desirable";
    delete curIf(c).switchport!.nonegotiate;
  }, onSwitchPort),
  spec("switchport mode dynamic auto", "Set trunking mode dynamic negotiation parameter to AUTO", (c) => {
    curIf(c).switchport!.mode = "dynamic";
    delete curIf(c).switchport!.nonegotiate;
  }, onSwitchPort),
  spec("switchport nonegotiate", "Device will not engage in negotiation protocol on this interface", (c) => {
    const sp = curIf(c).switchport!;
    if (sp.mode === "dynamic" || sp.mode === "desirable") return fail(c, "Command rejected: Conflict between 'nonegotiate' and 'dynamic' status.");
    sp.nonegotiate = true;
  }, onSwitchPort),
  spec("no switchport nonegotiate", "Device will not engage in negotiation protocol on this interface", (c) => {
    delete curIf(c).switchport!.nonegotiate;
  }, onSwitchPort),
  spec("switchport trunk native vlan <int:id>", "Set native VLAN when interface is in trunking mode", (c, a) => {
    const id = Number(a.id);
    if (id < 1 || id > 4094) return fail(c, "% Invalid input detected at '^' marker.");
    curIf(c).switchport!.nativeVlan = id;
  }, onSwitchPort),
  spec("no switchport trunk native vlan", "Set native VLAN when interface is in trunking mode", (c) => {
    delete curIf(c).switchport!.nativeVlan;
  }, onSwitchPort),
  spec("switchport trunk allowed vlan add <word:list>", "add VLANs to the current list", (c, a) => {
    const ids = parseVlanList(c, String(a.list));
    const sp = curIf(c).switchport!;
    if (ids && sp.allowedVlans) sp.allowedVlans = [...new Set([...sp.allowedVlans, ...ids])].sort((x, y) => x - y);
  }, onSwitchPort),
  spec("switchport trunk allowed vlan remove <word:list>", "remove VLANs from the current list", (c, a) => {
    const ids = parseVlanList(c, String(a.list));
    const sp = curIf(c).switchport!;
    if (!ids) return;
    const base = sp.allowedVlans ?? Array.from({ length: 4094 }, (_, k) => k + 1);
    sp.allowedVlans = base.filter((v) => !ids.includes(v));
  }, onSwitchPort),
  spec("switchport trunk allowed vlan <word:list>", "Set allowed VLAN characteristics when interface is in trunking mode", (c, a) => {
    const t = String(a.list).toLowerCase();
    const sp = curIf(c).switchport!;
    if (t === "all") return void delete sp.allowedVlans;
    if (t === "none") return void (sp.allowedVlans = []);
    const ids = parseVlanList(c, t);
    if (ids) sp.allowedVlans = ids;
  }, onSwitchPort),
  spec("no switchport trunk allowed vlan", "Set allowed VLAN characteristics when interface is in trunking mode", (c) => {
    delete curIf(c).switchport!.allowedVlans;
  }, onSwitchPort),
  spec("cdp enable", "Enable CDP on interface", (c) => {
    delete curIf(c).cdp;
  }),
  spec("no cdp enable", "Enable CDP on interface", (c) => {
    curIf(c).cdp = false;
  }),
  ...(["transmit", "receive"] as const).flatMap((dir) => {
    const key = dir === "transmit" ? "lldpTx" : "lldpRx";
    return [
      spec<Ctx>(`lldp ${dir}`, `Enable LLDP ${dir} on interface`, (c) => {
        delete curIf(c)[key];
      }),
      spec<Ctx>(`no lldp ${dir}`, `Enable LLDP ${dir} on interface`, (c) => {
        curIf(c)[key] = false;
      }),
    ];
  }),
  spec("exit", "Exit from interface configuration mode", (c) => setMode(c, "config")),
  ...common,
];

const routerConfig: S[] = [
  spec("network <ip:net> <ip:wc> area <int:area>", "Enable routing on an IP network", (c, a) => {
    const [net, wc, area] = [ip(a.net), ip(a.wc), Number(a.area)];
    const o = c.dev.ospf!;
    const normalized = (net & ~wc) >>> 0;
    const existing = o.networks.find((n) => n.net === normalized && n.wildcard === wc);
    if (existing && existing.area !== area) {
      return fail(c, `% OSPF: "network ${formatIp(normalized)} ${formatIp(wc)} area ${existing.area}" is already configured.`, `  Remove it with "no network ${formatIp(normalized)} ${formatIp(wc)} area ${existing.area}" first.`);
    }
    if (!existing) o.networks.push({ net: normalized, wildcard: wc, area });
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
  spec("passive-interface <iface:name>", "Suppress routing updates on an interface", (c, a) => {
    const o = c.dev.ospf!;
    const name = String(a.name);
    if (!c.dev.interfaces[name]) return fail(c, "% Invalid input detected at '^' marker.");
    o.passive = [...new Set([...(o.passive ?? []), name])];
  }),
  spec("no passive-interface <iface:name>", "Suppress routing updates on an interface", (c, a) => {
    const o = c.dev.ospf!;
    o.passive = (o.passive ?? []).filter((x) => x !== String(a.name));
  }),
  spec("default-information originate", "Distribute a default route", (c) => {
    c.dev.ospf!.defaultOriginate = true;
  }),
  spec("no default-information originate", "Distribute a default route", (c) => {
    delete c.dev.ospf!.defaultOriginate;
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

const pool = (c: Ctx) => c.dev.dhcp.pools[c.dev.ctx.pool!];

const dhcpConfig: S[] = [
  spec("network <ip:net> <ip:mask>", "Network number and mask", (c, a) => {
    const [net, mask] = [ip(a.net), ip(a.mask)];
    if (maskToPrefix(mask) === null) return fail(c, "% Invalid mask");
    Object.assign(pool(c), { net: network(net, mask), mask });
  }),
  spec("default-router <ip:gw>", "Default routers", (c, a) => {
    pool(c).defaultRouter = ip(a.gw);
  }),
  spec("dns-server <ip:dns>", "DNS servers", (c, a) => {
    pool(c).dns = ip(a.dns);
  }),
  spec("domain-name <word:d>", "Domain name", (c, a) => {
    pool(c).domain = String(a.d);
  }),
  spec("exit", "Exit from DHCP pool configuration mode", (c) => setMode(c, "config")),
  ...common,
];

const line = (c: Ctx) => c.dev.security.lines[c.dev.ctx.line!];

const lineConfig: S[] = [
  spec("password <word:pw>", "Set a password", (c, a) => {
    line(c).password = String(a.pw);
  }),
  spec("no password", "Set a password", (c) => {
    delete line(c).password;
  }),
  spec("login", "Enable password checking", (c) => {
    if (!line(c).password) c.out.push("% Login disabled on line, until 'password' is set");
    line(c).login = "line";
  }),
  spec("login local", "Local password checking", (c) => {
    line(c).login = "local";
  }),
  spec("no login", "Enable password checking", (c) => {
    delete line(c).login;
  }),
  ...(["ssh", "telnet", "all", "none"] as const).map((t) =>
    spec<Ctx>(`transport input ${t}`, "Define which protocols to use when connecting to the terminal server", (c) => {
      line(c).transport = t;
    }, (d: Device) => d.ctx.line === "vty"),
  ),
  spec("exec-timeout <int:m> <int:s>", "Set the EXEC timeout", () => {}),
  spec("logging synchronous", "Synchronized message output", () => {}),
  spec("exit", "Exit from line configuration mode", (c) => setMode(c, "config")),
  ...common,
];

const naclConfig: S[] = [
  ...aceSpecs("", addNamedAce, naclKind("standard"), ["standard"]),
  ...aceSpecs("<int:seq>", addNamedAce, naclKind("standard"), ["standard"]),
  ...aceSpecs("", addNamedAce, naclKind("extended"), ["extended"]),
  ...aceSpecs("<int:seq>", addNamedAce, naclKind("extended"), ["extended"]),
  spec("no <int:seq>", "Delete an entry by its sequence number", (c, a) => {
    const list = c.dev.acls[c.dev.ctx.acl!] ?? [];
    numberEntries(list);
    c.dev.acls[c.dev.ctx.acl!] = list.filter((e) => e.seq !== Number(a.seq));
  }),
  spec("remark <line:text>", "Access list entry comment", () => {}),
  spec("exit", "Exit from access-list configuration mode", (c) => setMode(c, "config")),
  ...common,
];

/* ---------------------------- PC ---------------------------- */

function pcPing(ctx: Ctx, dst: string) {
  const target = ip(dst);
  const r = ping(ctx.state, ctx.dev.id, target);
  recordNat(ctx, r);
  const t = formatIp(target);
  const gw = ctx.dev.defaultGateway !== undefined ? formatIp(ctx.dev.defaultGateway) : t;
  ctx.out.push("", `Pinging ${t} with 32 bytes of data:`, "");
  for (let i = 0; i < 4; i++) {
    ctx.out.push(r.ok ? `Reply from ${t}: bytes=32 time<1ms TTL=255` : r.unreachable ? `Reply from ${gw}: Destination host unreachable.` : "Request timed out.");
  }
  ctx.out.push(
    "",
    `Ping statistics for ${t}:`,
    `    Packets: Sent = 4, Received = ${r.ok ? 4 : 0}, Lost = ${r.ok ? 0 : 4} (${r.ok ? 0 : 100}% loss),`,
  );
}

function pcIpconfig(c: Ctx) {
  const e = c.dev.interfaces["Ethernet0"];
  c.out.push(
    "",
    "FastEthernet0 Connection:(default port)",
    "",
    `   IPv4 Address....................: ${e.ip !== undefined ? formatIp(e.ip) : "0.0.0.0"}`,
    `   Subnet Mask.....................: ${e.mask !== undefined ? formatIp(e.mask) : "0.0.0.0"}`,
    `   Default Gateway.................: ${c.dev.defaultGateway !== undefined ? formatIp(c.dev.defaultGateway) : "0.0.0.0"}`,
    ...(c.dev.dns !== undefined ? [`   DNS Servers.....................: ${formatIp(c.dev.dns)}`] : []),
    "",
  );
}

function pcIpv6config(c: Ctx) {
  const e = c.dev.interfaces.Ethernet0;
  const g = e.ipv6?.[0];
  c.out.push(
    "",
    "FastEthernet0 Connection:(default port)",
    "",
    `   Link-local IPv6 Address.........: ${formatIp6((BigInt(0xfe80) << BigInt(112)) | eui64(c.dev.mac))}`,
    `   IPv6 Address....................: ${g ? `${formatIp6(g.addr)}/${g.prefix}` : "::"}`,
    `   Default Gateway.................: ${c.dev.gateway6 !== undefined ? formatIp6(c.dev.gateway6) : "::"}`,
    "",
  );
}

const pcCommands: S[] = [
  spec("ipconfig", "Display IP configuration", pcIpconfig),
  spec("ipconfig <ip:addr> <ip:mask> <ip:gw>", "Set IP address, mask and gateway", (c, a) => {
    const [addr, mask] = [ip(a.addr), ip(a.mask)];
    if (maskToPrefix(mask) === null) return fail(c, "Invalid subnet mask.");
    if (!isHostAddress(addr, mask)) return fail(c, `Invalid IP address: ${formatIp(addr)} is the network or broadcast address of its subnet.`);
    const e = c.dev.interfaces["Ethernet0"];
    e.ip = addr;
    e.mask = mask;
    c.dev.defaultGateway = ip(a.gw);
    delete c.dev.dhcpServer;
  }),
  spec("ipconfig /dhcp", "Request an address from a DHCP server", (c) => {
    const lease = dhcpOffer(c.state, c.dev.id);
    if (!lease) return fail(c, "DHCP request failed.");
    const e = c.dev.interfaces["Ethernet0"];
    e.ip = lease.ip;
    e.mask = lease.mask;
    if (lease.gateway !== undefined) c.dev.defaultGateway = lease.gateway;
    else delete c.dev.defaultGateway;
    if (lease.dns !== undefined) c.dev.dns = lease.dns;
    c.dev.dhcpServer = lease.server;
    c.out.push("DHCP request successful.");
    pcIpconfig(c);
  }),
  spec("ipv6config", "Display IPv6 configuration", (c) => pcIpv6config(c)),
  spec("ipv6config <ipv6p:a> <ipv6:gw>", "Set IPv6 address and default gateway", (c, a) => {
    const { addr, prefix } = parsePrefix6(String(a.a))!;
    c.dev.interfaces.Ethernet0.ipv6 = [{ addr, prefix }];
    c.dev.gateway6 = parseIp6(String(a.gw))!;
  }),
  spec("ipv6config autoconfig", "Get an IPv6 address by SLAAC (EUI-64)", (c) => {
    const ra = slaacOffer(c.state, c.dev.id);
    if (!ra) return fail(c, "IPv6 autoconfiguration failed: no router advertisement received.");
    c.dev.interfaces.Ethernet0.ipv6 = [{ addr: ra.prefix | eui64(c.dev.mac), prefix: 64, eui64: true }];
    c.dev.gateway6 = ra.gateway;
    c.out.push("IPv6 autoconfiguration successful.");
    pcIpv6config(c);
  }),
  spec("ping <ipv6:dst>", "Send echo messages", (c, a) => {
    const target = parseIp6(String(a.dst))!;
    const r = ping6(c.state, c.dev.id, target);
    const t = formatIp6(target);
    c.out.push("", `Pinging ${t} with 32 bytes of data:`, "");
    for (let i = 0; i < 4; i++) c.out.push(r.ok ? `Reply from ${t}: bytes=32 time<1ms TTL=255` : r.unreachable ? "Destination host unreachable." : "Request timed out.");
    c.out.push("", `Ping statistics for ${t}:`, `    Packets: Sent = 4, Received = ${r.ok ? 4 : 0}, Lost = ${r.ok ? 0 : 4} (${r.ok ? 0 : 100}% loss),`);
  }),
  spec("ipconfig /release", "Release the DHCP lease", (c) => {
    const e = c.dev.interfaces["Ethernet0"];
    delete e.ip;
    delete e.mask;
    delete c.dev.defaultGateway;
    delete c.dev.dns;
    delete c.dev.dhcpServer;
    pcIpconfig(c);
  }),
  spec("curl <word:url>", "Fetch a web page (HTTP or HTTPS)", (c, a) => {
    const m = /^(?:(https?):\/\/)?([\d.]+)(?::(\d+))?\/?$/i.exec(String(a.url));
    const host = m && parseIp(m[2]);
    if (!m || host === null) return fail(c, `curl: (6) Could not resolve host: ${a.url}`, "Lab note: use an IP address, e.g. curl http://172.16.1.10");
    const scheme = (m[1] ?? "http").toLowerCase();
    const port = m[3] ? Number(m[3]) : scheme === "https" ? 443 : 80;
    const r = tcpConnect(c.state, c.dev.id, host!, port);
    const t = formatIp(host!);
    if (r === "open") return void c.out.push(`HTTP/1.1 200 OK`, `Server: lab-httpd`, "", `<html><body><h1>It works! (${t} port ${port})</h1></body></html>`);
    if (r === "refused") return fail(c, `curl: (7) Failed to connect to ${t} port ${port}: Connection refused`);
    if (r === "unreachable") return fail(c, `curl: (7) Failed to connect to ${t} port ${port}: No route to host`);
    fail(c, `curl: (28) Failed to connect to ${t} port ${port}: Timed out`);
  }),
  spec("telnet <ip:dst>", "Open a Telnet session (TCP 23)", (c, a) => c.out.push(...tcpLines(c, String(a.dst), 23, "telnet"))),
  spec("telnet <ip:dst> <int:port>", "Test a TCP port", (c, a) => c.out.push(...tcpLines(c, String(a.dst), Number(a.port), "telnet"))),
  spec("ssh -l <word:user> <ip:dst>", "Open an SSH session (TCP 22)", (c, a) => c.out.push(...tcpLines(c, String(a.dst), 22, "ssh"))),
  spec("ping <ip:dst>", "Send echo messages", (c, a) => pcPing(c, String(a.dst))),
  spec("help", "Display PC commands", (c) => {
    c.out.push("Available Commands:", "  ipconfig                         Display IP configuration", "  ipconfig <ip> <mask> <gateway>   Set IP configuration", "  ipconfig /dhcp                   Get an address from DHCP", "  ipconfig /release                Release the DHCP address", "  ipv6config <addr/len> <gateway>  Set IPv6 address and gateway", "  ipv6config autoconfig            Get an IPv6 address by SLAAC", "  ping <ip>                        Send echo request", "  curl http://<ip>  |  https://<ip> Fetch a web page (TCP 80 / 443)", "  telnet <ip> [port]               Telnet, or test any TCP port", "  ssh -l <user> <ip>               Open an SSH session (TCP 22)");
  }),
];

export const MODE_SPECS: Record<Mode, S[]> = {
  user: userExec,
  priv: privExec,
  config: globalConfig,
  if: ifConfig,
  router: routerConfig,
  vlan: vlanConfig,
  dhcp: dhcpConfig,
  line: lineConfig,
  nacl: naclConfig,
  pc: pcCommands,
};

/** Sub-modes fall back to global config commands, like real IOS. */
export const PARENT: Partial<Record<Mode, Mode>> = { if: "config", router: "config", vlan: "config", dhcp: "config", line: "config", nacl: "config" };
