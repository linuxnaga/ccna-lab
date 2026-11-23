import type { CiscoState, Device } from "./model";
import { shortName } from "./model";
import { formatIp, maskToPrefix } from "./ip";
import {
  attachedMac,
  errDisabled,
  hsrpMembers,
  ifaceState,
  l2Domains,
  memberStatus,
  ospfIfaces,
  ospfNeighbors,
  ospfRouterId,
  physicalUp,
  portSecurityState,
  routingTable,
  routingTable6,
  v6Enabled,
  type Route,
} from "./network";
import { formatIp6, linkLocal } from "./ip6";
import { aclKind, formatEntry } from "./acl";
import { spanningTreeAll, type BridgeId } from "./stp";

const pad = (s: string, n: number) => (s.length >= n ? s + " " : s + " ".repeat(n - s.length));

/** Natural sort for interface names: Fa0/2 before Fa0/10. */
export function ifaceOrder(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function sortedIfaces(dev: Device) {
  const rank = (n: string) => (n.startsWith("Loopback") ? 3 : n.startsWith("Vlan") ? 2 : n.startsWith("FastEthernet") ? 0 : 1);
  return Object.values(dev.interfaces).sort((a, b) => rank(a.name) - rank(b.name) || ifaceOrder(a.name, b.name));
}

export function showIpIntBrief(state: CiscoState, dev: Device): string[] {
  const out = [pad("Interface", 23) + pad("IP-Address", 16) + "OK? Method " + pad("Status", 22) + "Protocol"];
  for (const i of sortedIfaces(dev)) {
    const st = ifaceState(state, dev.id, i.name);
    out.push(
      pad(i.name, 23) +
        pad(i.ip !== undefined ? formatIp(i.ip) : "unassigned", 16) +
        "YES " +
        pad(i.ip !== undefined ? "manual" : "unset", 7) +
        pad(st.status, 22) +
        st.protocol,
    );
  }
  return out;
}

export function showVlanBrief(dev: Device): string[] {
  const out = [
    "",
    "VLAN Name                             Status    Ports",
    "---- -------------------------------- --------- -------------------------------",
  ];
  const ids = Object.keys(dev.vlans).map(Number).sort((a, b) => a - b);
  for (const id of ids) {
    const ports = sortedIfaces(dev)
      .filter((i) => i.switchport && i.switchport.mode !== "trunk" && i.switchport.accessVlan === id)
      .map((i) => shortName(i.name));
    const lines: string[] = [];
    for (let k = 0; k < Math.max(ports.length, 1); k += 4) lines.push(ports.slice(k, k + 4).join(", "));
    out.push(pad(String(id), 5) + pad(dev.vlans[id], 33) + pad("active", 10) + lines[0]);
    for (const l of lines.slice(1)) out.push(" ".repeat(48) + l);
  }
  out.push(
    "1002 fddi-default                     act/unsup ",
    "1003 token-ring-default               act/unsup ",
    "1004 fddinet-default                  act/unsup ",
    "1005 trnet-default                    act/unsup ",
  );
  return out;
}

export function showInterfacesTrunk(state: CiscoState, dev: Device): string[] {
  const trunks = sortedIfaces(dev).filter(
    (i) => i.switchport?.mode === "trunk" && ifaceState(state, dev.id, i.name).protocol === "up" && !(i.channelGroup && memberStatus(state, dev.id, i.name) === "P"),
  );
  if (!trunks.length) return [];
  const vlans = Object.keys(dev.vlans).map(Number).sort((a, b) => a - b).join(",");
  return [
    "Port        Mode         Encapsulation  Status        Native vlan",
    ...trunks.map((t) => pad(shortName(t.name), 12) + pad("on", 13) + pad("802.1q", 15) + pad("trunking", 14) + "1"),
    "",
    "Port        Vlans allowed on trunk",
    ...trunks.map((t) => pad(shortName(t.name), 12) + "1-4094"),
    "",
    "Port        Vlans allowed and active in management domain",
    ...trunks.map((t) => pad(shortName(t.name), 12) + vlans),
    "",
    "Port        Vlans in spanning tree forwarding state and not pruned",
    ...trunks.map((t) => pad(shortName(t.name), 12) + vlans),
  ];
}

const CODES = [
  "Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP",
  "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area",
  "       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2",
  "       E1 - OSPF external type 1, E2 - OSPF external type 2, E - EGP",
  "       i - IS-IS, L1 - IS-IS level-1, L2 - IS-IS level-2, ia - IS-IS inter area",
  "       * - candidate default, U - per-user static route, o - ODR",
  "       P - periodic downloaded static route",
  "",
];

function classfulMask(net: number): number {
  const first = net >>> 24;
  return first < 128 ? 0xff000000 : first < 192 ? 0xffff0000 : 0xffffff00;
}

function routeLine(r: Route, indent: boolean): string {
  const code = r.source + (r.net === 0 && r.mask === 0 ? "*" : "");
  const dest = `${formatIp(r.net)}${indent ? "/" + maskToPrefix(r.mask) : "/" + maskToPrefix(r.mask)}`;
  const head = pad(code, indent ? 9 : 6) + dest;
  if (r.source === "C" || r.source === "L") return `${head} is directly connected, ${r.iface}`;
  if (r.source === "S") return `${head} [${r.ad}/${r.metric}] via ${formatIp(r.nextHop!)}`;
  return `${head} [${r.ad}/${r.metric}] via ${formatIp(r.nextHop!)}, 00:00:12, ${r.iface}`;
}

export function showIpRoute(state: CiscoState, dev: Device): string[] {
  if (dev.kind !== "router") {
    return dev.defaultGateway !== undefined ? [`Default gateway is ${formatIp(dev.defaultGateway)}`, "", "Host               Gateway           Last Use    Total Uses  Interface", "ICMP redirect cache is empty"] : ["Default gateway is not set", "", "Host               Gateway           Last Use    Total Uses  Interface", "ICMP redirect cache is empty"];
  }
  const routes = routingTable(state, dev.id);
  const def = routes.find((r) => r.net === 0 && r.mask === 0);
  const out = [...CODES, def ? `Gateway of last resort is ${formatIp(def.nextHop!)} to network 0.0.0.0` : "Gateway of last resort is not set", ""];

  // Group by classful major network, as IOS does.
  const groups = new Map<number, Route[]>();
  const top: Route[] = [];
  for (const r of routes) {
    const cm = classfulMask(r.net);
    if (r.mask === 0 || (maskToPrefix(r.mask) ?? 0) < (maskToPrefix(cm) ?? 0)) top.push(r);
    else {
      const major = (r.net & cm) >>> 0;
      groups.set(major, [...(groups.get(major) ?? []), r]);
    }
  }
  for (const [major, rs] of groups) {
    if (rs.length === 1 && rs[0].mask === classfulMask(major)) {
      top.push(rs[0]);
      groups.delete(major);
    }
  }
  const entries: { key: number; lines: string[] }[] = [];
  for (const [major, rs] of groups) {
    rs.sort((a, b) => a.net - b.net || b.mask - a.mask);
    const masks = new Set(rs.map((r) => r.mask));
    const cm = maskToPrefix(classfulMask(major));
    const header =
      masks.size > 1
        ? `      ${formatIp(major)}/${cm} is variably subnetted, ${rs.length} subnets, ${masks.size} masks`
        : `      ${formatIp(major)}/${maskToPrefix(rs[0].mask)} is subnetted, ${rs.length} subnets`;
    entries.push({ key: major, lines: [header, ...rs.map((r) => routeLine(r, true))] });
  }
  for (const r of top) entries.push({ key: r.net, lines: [routeLine(r, false)] });
  entries.sort((a, b) => (a.key === 0 ? 1 : b.key === 0 ? -1 : a.key - b.key));
  for (const e of entries) out.push(...e.lines);
  return out;
}

export function showOspfNeighbor(state: CiscoState, dev: Device): string[] {
  const ns = ospfNeighbors(state, dev.id, l2Domains(state));
  if (!dev.ospf) return [];
  return [
    "",
    "Neighbor ID     Pri   State           Dead Time   Address         Interface",
    ...ns.map((n) => pad(formatIp(n.routerId), 16) + pad("  1", 6) + pad("FULL/DR", 16) + pad("00:00:33", 12) + pad(formatIp(n.ip), 16) + n.localIface),
  ];
}

/** Cisco type 7 "encryption" (reversible obfuscation), as service password-encryption shows it. */
export function type7(pw: string): string {
  const xlat = "dsfd;kfoA,.iyewrkldJKDHSUBsgvca69834ncxv9873254k;fg87";
  const seed = 2;
  let out = String(seed).padStart(2, "0");
  for (let i = 0; i < pw.length; i++) {
    out += ((pw.charCodeAt(i) ^ xlat.charCodeAt((seed + i) % xlat.length)) & 0xff).toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** Stand-in for an MD5-crypt hash: deterministic, one-way-looking, never the plain secret. */
export function type5(pw: string): string {
  const abc = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let h = 2166136261;
  let out = "";
  for (let i = 0; i < 26; i++) {
    for (const ch of pw + i) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    out += abc[h % 64];
  }
  return `$1$${out.slice(0, 4)}$${out.slice(4)}`;
}

function linePassword(dev: Device, pw: string): string {
  return dev.security.passwordEncryption ? `password 7 ${type7(pw)}` : `password ${pw}`;
}

export function showRunningConfig(dev: Device, state?: CiscoState): string[] {
  const lines: string[] = ["Building configuration...", ""];
  const sec = dev.security;
  const body: string[] = [
    "!",
    "version 15.2",
    "no service timestamps log datetime msec",
    "no service timestamps debug datetime msec",
    sec.passwordEncryption ? "service password-encryption" : "no service password-encryption",
    "!",
    `hostname ${dev.hostname}`,
    "!",
  ];
  if (sec.enableSecret) body.push(`enable secret 5 ${type5(sec.enableSecret)}`);
  if (sec.enablePassword) body.push(`enable password ${sec.passwordEncryption ? "7 " + type7(sec.enablePassword) : sec.enablePassword}`);
  if (sec.enableSecret || sec.enablePassword) body.push("!");
  if (dev.dhcp.excluded.length || Object.keys(dev.dhcp.pools).length) {
    for (const [lo, hi] of dev.dhcp.excluded) body.push(`ip dhcp excluded-address ${formatIp(lo)}${hi !== lo ? " " + formatIp(hi) : ""}`);
    body.push("!");
    for (const p of Object.values(dev.dhcp.pools)) {
      body.push(`ip dhcp pool ${p.name}`);
      if (p.net !== undefined) body.push(` network ${formatIp(p.net)} ${formatIp(p.mask!)}`);
      if (p.defaultRouter !== undefined) body.push(` default-router ${formatIp(p.defaultRouter)}`);
      if (p.dns !== undefined) body.push(` dns-server ${formatIp(p.dns)}`);
      if (p.domain) body.push(` domain-name ${p.domain}`);
      body.push("!");
    }
  }
  if (sec.domainName) body.push(`ip domain-name ${sec.domainName}`);
  for (const [u, pw] of Object.entries(sec.users)) body.push(`username ${u} secret 5 ${type5(pw)}`);
  if (sec.sshVersion === 2) body.push("ip ssh version 2");
  if (sec.domainName || Object.keys(sec.users).length || sec.sshVersion) body.push("!");
  if (dev.kind === "switch") {
    body.push(`spanning-tree mode ${dev.stp.mode}`, "spanning-tree extend system-id");
    for (const [v, p] of Object.entries(dev.stp.priority)) body.push(`spanning-tree vlan ${v} priority ${p}`);
    body.push("!");
  }
  for (const i of sortedIfaces(dev)) {
    body.push(`interface ${i.name}`);
    if (i.description) body.push(` description ${i.description}`);
    if (i.dot1q !== undefined) body.push(` encapsulation dot1Q ${i.dot1q}`);
    if (i.switchport) {
      if (i.switchport.accessVlan !== 1) body.push(` switchport access vlan ${i.switchport.accessVlan}`);
      if (i.switchport.mode !== "dynamic") body.push(` switchport mode ${i.switchport.mode}`);
      const ps = i.switchport.portSecurity;
      if (ps) {
        if (ps.enabled) body.push(" switchport port-security");
        if (ps.max !== 1) body.push(` switchport port-security maximum ${ps.max}`);
        if (ps.violation !== "shutdown") body.push(` switchport port-security violation ${ps.violation}`);
        if (ps.sticky) body.push(" switchport port-security mac-address sticky");
        const learned = state ? portSecurityState({ ...state, devices: { ...state.devices, [dev.id]: dev } }, dev.id, i.name)?.stickyMac : undefined;
        if (learned) body.push(` switchport port-security mac-address sticky ${learned}`);
        for (const m of ps.macs) body.push(` switchport port-security mac-address ${m}`);
      }
      if (i.channelGroup) body.push(` channel-group ${i.channelGroup.id} mode ${i.channelGroup.mode}`);
      if (i.switchport.portfast) body.push(" spanning-tree portfast");
      if (i.switchport.bpduguard) body.push(" spanning-tree bpduguard enable");
    } else if (i.ip !== undefined && i.mask !== undefined) {
      body.push(` ip address ${formatIp(i.ip)} ${formatIp(i.mask)}`);
    } else {
      body.push(" no ip address");
    }
    for (const [g, h] of Object.entries(i.hsrp ?? {})) {
      if (h.ip !== undefined) body.push(` standby ${g} ip ${formatIp(h.ip)}`);
      if (h.priority !== 100) body.push(` standby ${g} priority ${h.priority}`);
      if (h.preempt) body.push(` standby ${g} preempt`);
    }
    for (const a of i.ipv6 ?? []) body.push(` ipv6 address ${a.eui64 ? formatIp6(a.addr & ~((BigInt(1) << BigInt(64)) - BigInt(1))) : formatIp6(a.addr)}/${a.prefix}${a.eui64 ? " eui-64" : ""}`);
    if (i.ipv6Enabled) body.push(" ipv6 enable");
    if (i.acl?.in) body.push(` ip access-group ${i.acl.in} in`);
    if (i.acl?.out) body.push(` ip access-group ${i.acl.out} out`);
    if (i.nat) body.push(` ip nat ${i.nat}`);
    if (dev.kind === "router" && !i.name.startsWith("Loopback") && !i.name.includes(".")) body.push(" duplex auto", " speed auto");
    if (i.shutdown) body.push(" shutdown");
    body.push("!");
  }
  if (dev.ospf) {
    body.push(`router ospf ${dev.ospf.pid}`);
    if (dev.ospf.routerId !== undefined) body.push(` router-id ${formatIp(dev.ospf.routerId)}`);
    body.push(" log-adjacency-changes");
    for (const n of dev.ospf.networks) body.push(` network ${formatIp(n.net)} ${formatIp(n.wildcard)} area ${n.area}`);
    body.push("!");
  }
  for (const r of dev.nat.rules) {
    body.push(
      r.kind === "overload"
        ? `ip nat inside source list ${r.acl} interface ${r.iface} overload`
        : `ip nat inside source static ${formatIp(r.local)} ${formatIp(r.global)}`,
    );
  }
  if (dev.defaultGateway !== undefined) body.push(`ip default-gateway ${formatIp(dev.defaultGateway)}`);
  if (dev.kind === "router") body.push("ip classless");
  if (dev.ipv6Routing) body.push("ipv6 unicast-routing");
  for (const r of dev.staticRoutes6) body.push(`ipv6 route ${formatIp6(r.net)}/${r.prefix} ${formatIp6(r.nextHop)}`);
  for (const r of dev.staticRoutes) body.push(`ip route ${formatIp(r.net)} ${formatIp(r.mask)} ${formatIp(r.nextHop)}${r.ad ? " " + r.ad : ""}`);
  body.push("!", "ip flow-export version 9", "!");
  for (const [id, entries] of Object.entries(dev.acls)) for (const e of entries) body.push(`access-list ${id} ${formatEntry(e)}`);
  if (Object.keys(dev.acls).length) body.push("!");
  if (sec.banner) body.push(`banner motd ^C${sec.banner}^C`, "!");
  const lineBlock = (head: string, l: Device["security"]["lines"]["con"]) => {
    body.push(head);
    if (l.password) body.push(" " + linePassword(dev, l.password));
    if (l.login) body.push(l.login === "local" ? " login local" : " login");
    if (l.transport) body.push(` transport input ${l.transport}`);
    body.push("!");
  };
  lineBlock("line con 0", sec.lines.con);
  body.push("line aux 0", "!");
  lineBlock("line vty 0 4", sec.lines.vty.login || sec.lines.vty.password || sec.lines.vty.transport ? sec.lines.vty : { login: "line" });
  body.push("!", "end");
  const bytes = body.join("\n").length;
  lines.push(`Current configuration : ${bytes} bytes`, ...body);
  return lines;
}

/* ---------------------------- STP ---------------------------- */

const fmtMac = (b: BridgeId) => b.mac;

export function showSpanningTree(state: CiscoState, dev: Device, only?: number): string[] {
  const vlans = Object.keys(dev.vlans).map(Number).filter((v) => only === undefined || v === only).sort((a, b) => a - b);
  const out: string[] = [];
  for (const v of vlans) {
    const t = spanningTreeAll(state, v)[dev.id];
    if (!t || !t.ports.length) continue;
    const isRoot = t.rootDevice === dev.id;
    const base = t.bridge.priority - v;
    out.push(
      `VLAN${String(v).padStart(4, "0")}`,
      `  Spanning tree enabled protocol ${dev.stp.mode === "rapid-pvst" ? "rstp" : "ieee"}`,
      `  Root ID    Priority    ${t.root.priority}`,
      `             Address     ${fmtMac(t.root)}`,
      ...(isRoot
        ? ["             This bridge is the root"]
        : [`             Cost        ${t.rootCost}`, `             Port        ${t.rootPort ? portNo(t.rootPort) + "(" + t.rootPort + ")" : "-"}`]),
      "             Hello Time  2 sec  Max Age 20 sec  Forward Delay 15 sec",
      "",
      `  Bridge ID  Priority    ${t.bridge.priority}  (priority ${base} sys-id-ext ${v})`,
      `             Address     ${fmtMac(t.bridge)}`,
      "             Hello Time  2 sec  Max Age 20 sec  Forward Delay 15 sec",
      "             Aging Time  20",
      "",
      "Interface        Role Sts Cost      Prio.Nbr Type",
      "---------------- ---- --- --------- -------- --------------------------------",
      ...t.ports.map((p) => pad(shortName(p.iface), 17) + pad(p.role, 5) + pad(p.state, 4) + pad(String(p.cost), 10) + pad(`128.${p.portId}`, 9) + (p.edge ? "P2p Edge" : "P2p")),
      "",
    );
  }
  return out;
}

function portNo(iface: string): number {
  const n = Number(iface.split("/").pop());
  return iface.startsWith("GigabitEthernet") ? 24 + n : n;
}

export function showInterfacesStatus(state: CiscoState, dev: Device): string[] {
  const out = ["Port      Name               Status       Vlan       Duplex  Speed Type"];
  for (const i of sortedIfaces(dev)) {
    if (!i.switchport) continue;
    const status = i.shutdown ? "disabled" : errDisabled(state, dev.id, i.name) ? "err-disabled" : physicalUp(state, dev.id, i.name) ? "connected" : "notconnect";
    const vlan = i.switchport.mode === "trunk" ? "trunk" : String(i.switchport.accessVlan);
    const gig = i.name.startsWith("Gigabit");
    out.push(pad(shortName(i.name), 10) + pad(i.description ?? "", 19) + pad(status, 13) + pad(vlan, 11) + pad("auto", 8) + pad("auto", 6) + (gig ? "10/100/1000BaseTX" : "10/100BaseTX"));
  }
  return out;
}

/* ---------------------------- Routing protocol detail ---------------------------- */

export function showIpProtocols(state: CiscoState, dev: Device): string[] {
  if (!dev.ospf) return [];
  const rid = ospfRouterId(state, dev);
  const areas = new Set(dev.ospf.networks.map((n) => n.area));
  const ns = ospfNeighbors(state, dev.id, l2Domains(state));
  return [
    "",
    `Routing Protocol is "ospf ${dev.ospf.pid}"`,
    "  Outgoing update filter list for all interfaces is not set",
    "  Incoming update filter list for all interfaces is not set",
    `  Router ID ${rid !== undefined ? formatIp(rid) : "0.0.0.0"}`,
    `  Number of areas in this router is ${areas.size}. ${areas.size} normal 0 stub 0 nssa`,
    "  Maximum path: 4",
    "  Routing for Networks:",
    ...dev.ospf.networks.map((n) => `    ${formatIp(n.net)} ${formatIp(n.wildcard)} area ${n.area}`),
    "  Routing Information Sources:",
    "    Gateway         Distance      Last Update",
    ...ns.map((n) => `    ${pad(formatIp(n.routerId), 16)}     110      00:00:12`),
    "  Distance: (default is 110)",
    "",
  ];
}

export function showOspfIfBrief(state: CiscoState, dev: Device): string[] {
  if (!dev.ospf) return [];
  const uf = l2Domains(state);
  const ns = ospfNeighbors(state, dev.id, uf);
  const out = ["Interface    PID   Area            IP Address/Mask    Cost  State Nbrs F/C"];
  for (const i of ospfIfaces(state, dev)) {
    const n = ns.filter((x) => x.localIface === i.iface).length;
    out.push(
      pad(shortName(i.iface), 13) + pad(String(dev.ospf.pid), 6) + pad(String(i.area), 16) + pad(`${formatIp(i.ip)}/${maskToPrefix(i.mask)}`, 19) + pad("1", 6) + pad(n ? "DR" : "WAIT", 6) + `${n}/${n}`,
    );
  }
  return out;
}

/* ---------------------------- IP services ---------------------------- */

export function showNatTranslations(dev: Device): string[] {
  const rows: string[] = [];
  for (const t of dev.nat.translations) {
    rows.push(pad("icmp", 5) + pad(`${formatIp(t.insideGlobal)}:1`, 21) + pad(`${formatIp(t.insideLocal)}:1`, 20) + pad(`${formatIp(t.outside)}:1`, 20) + `${formatIp(t.outside)}:1`);
  }
  for (const r of dev.nat.rules) {
    if (r.kind === "static") rows.push(pad("---", 5) + pad(formatIp(r.global), 21) + pad(formatIp(r.local), 20) + pad("---", 20) + "---");
  }
  if (!rows.length) return [];
  return ["Pro  Inside global        Inside local        Outside local       Outside global", ...rows, ""];
}

export function showDhcpBinding(state: CiscoState, dev: Device): string[] {
  const out = ["IP address       Client-ID/              Lease expiration        Type", "                 Hardware address"];
  const clients = Object.values(state.devices).filter((d) => d.dhcpServer === dev.id && d.interfaces.Ethernet0?.ip !== undefined);
  clients.sort((a, b) => a.interfaces.Ethernet0.ip! - b.interfaces.Ethernet0.ip!);
  for (const c of clients) out.push(pad(formatIp(c.interfaces.Ethernet0.ip!), 17) + pad(c.mac, 24) + pad("--", 24) + "Automatic");
  return out;
}

export function showAccessLists(dev: Device): string[] {
  const out: string[] = [];
  for (const [id, entries] of Object.entries(dev.acls)) {
    const kind = aclKind(Number(id));
    out.push(`${kind === "extended" ? "Extended" : "Standard"} IP access list ${id}`);
    entries.forEach((e, i) => {
      let body = formatEntry(e);
      if (!e.proto && e.src.wildcard === 0) body = body.replace(/^(permit|deny) /, "$1 host ");
      out.push(`    ${(i + 1) * 10} ${body}`);
    });
  }
  return out;
}

/* ---------------------------- Second-batch features ---------------------------- */

export function showEtherchannelSummary(state: CiscoState, dev: Device): string[] {
  const groups = new Map<number, string[]>();
  for (const i of sortedIfaces(dev)) if (i.channelGroup) groups.set(i.channelGroup.id, [...(groups.get(i.channelGroup.id) ?? []), i.name]);
  const out = [
    "Flags:  D - down        P - bundled in port-channel",
    "        I - stand-alone s - suspended",
    "        H - Hot-standby (LACP only)",
    "        R - Layer3      S - Layer2",
    "        U - in use      f - failed to allocate aggregator",
    "",
    `Number of channel-groups in use: ${groups.size}`,
    `Number of aggregators:           ${groups.size}`,
    "",
    "Group  Port-channel  Protocol    Ports",
    "------+-------------+-----------+-----------------------------------------------",
  ];
  for (const [id, members] of [...groups].sort((a, b) => a[0] - b[0])) {
    const up = physicalUp(state, dev.id, `Port-channel${id}`);
    const mode = dev.interfaces[members[0]].channelGroup!.mode;
    const proto = mode === "active" || mode === "passive" ? "LACP" : mode === "on" ? "-" : "PAgP";
    const ports = members.map((m) => `${shortName(m)}(${memberStatus(state, dev.id, m)})`).join("  ");
    out.push(pad(String(id), 7) + pad(`Po${id}(S${up ? "U" : "D"})`, 14) + pad(proto, 12) + ports);
  }
  return out;
}

export function showPortSecurity(state: CiscoState, dev: Device): string[] {
  const out = [
    "Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action",
    "                (Count)       (Count)          (Count)",
    "---------------------------------------------------------------------------",
  ];
  for (const i of sortedIfaces(dev)) {
    const ps = i.switchport?.portSecurity;
    if (!ps?.enabled) continue;
    const st = portSecurityState(state, dev.id, i.name);
    out.push(pad(shortName(i.name), 13) + pad(String(ps.max), 15) + pad(String(st?.secure.length ?? 0), 13) + pad(st?.violation ? "1" : "0", 19) + ps.violation[0].toUpperCase() + ps.violation.slice(1));
  }
  out.push("---------------------------------------------------------------------------");
  return out;
}

export function showPortSecurityInterface(state: CiscoState, dev: Device, name: string): string[] {
  const ps = dev.interfaces[name]?.switchport?.portSecurity;
  const st = portSecurityState(state, dev.id, name);
  const enabled = !!ps?.enabled;
  const status = !enabled ? "Secure-down" : errDisabled(state, dev.id, name) ? "Secure-shutdown" : physicalUp(state, dev.id, name) ? "Secure-up" : "Secure-down";
  return [
    `Port Security              : ${enabled ? "Enabled" : "Disabled"}`,
    `Port Status                : ${status}`,
    `Violation Mode             : ${ps ? ps.violation[0].toUpperCase() + ps.violation.slice(1) : "Shutdown"}`,
    "Aging Time                 : 0 mins",
    "Aging Type                 : Absolute",
    "SecureStatic Address Aging : Disabled",
    `Maximum MAC Addresses      : ${ps?.max ?? 1}`,
    `Total MAC Addresses        : ${st?.secure.length ?? 0}`,
    `Configured MAC Addresses   : ${ps?.macs.length ?? 0}`,
    `Sticky MAC Addresses       : ${st?.stickyMac ? 1 : 0}`,
    `Last Source Address:Vlan   : ${st?.violator ?? attachedMac(state, dev.id, name) ?? "0000.0000.0000"}:${dev.interfaces[name]?.switchport?.accessVlan ?? 1}`,
    `Security Violation Count   : ${st?.violation ? 1 : 0}`,
  ];
}

export function showMacAddressTable(state: CiscoState, dev: Device): string[] {
  const out = ["          Mac Address Table", "-------------------------------------------", "", "Vlan    Mac Address       Type        Ports", "----    -----------       --------    -----"];
  for (const i of sortedIfaces(dev)) {
    if (!i.switchport || i.switchport.mode === "trunk" || !physicalUp(state, dev.id, i.name)) continue;
    const mac = attachedMac(state, dev.id, i.name);
    const st = portSecurityState(state, dev.id, i.name);
    if (!mac || st?.violation) continue;
    const type = st ? (st.stickyMac === mac || i.switchport.portSecurity?.macs.includes(mac) ? "STATIC" : "DYNAMIC") : "DYNAMIC";
    out.push(pad(String(i.switchport.accessVlan).padStart(4), 8) + pad(mac.toLowerCase(), 18) + pad(type, 12) + shortName(i.name));
  }
  return out;
}

export function showStandbyBrief(state: CiscoState, dev: Device): string[] {
  const uf = l2Domains(state);
  const out = [
    "                     P indicates configured to preempt.",
    "                     |",
    "Interface   Grp  Pri P State    Active          Standby         Virtual IP",
  ];
  for (const i of sortedIfaces(dev)) {
    for (const [g, h] of Object.entries(i.hsrp ?? {})) {
      const members = hsrpMembers(state, dev.id, i.name, Number(g), uf);
      const idx = members.findIndex((m) => m.dev === dev.id && m.iface === i.name);
      const st = ifaceState(state, dev.id, i.name).protocol !== "up" ? "Init" : idx === 0 ? "Active" : idx === 1 ? "Standby" : idx > 1 ? "Listen" : "Init";
      const who = (k: number) => (members[k] ? (members[k].dev === dev.id ? "local" : formatIp(members[k].ip)) : "unknown");
      out.push(
        pad(shortName(i.name), 12) + pad(g, 5) + pad(String(h.priority), 4) + pad(h.preempt ? "P" : " ", 2) + pad(st, 9) + pad(who(0), 16) + pad(who(1), 16) + (h.ip !== undefined ? formatIp(h.ip) : "unknown"),
      );
    }
  }
  return out;
}

export function showIpv6IntBrief(state: CiscoState, dev: Device): string[] {
  const out: string[] = [];
  for (const i of sortedIfaces(dev)) {
    if (i.switchport) continue;
    const st = ifaceState(state, dev.id, i.name);
    out.push(pad(i.name, 23) + `[${st.status}/${st.protocol}]`);
    if (!v6Enabled(i)) out.push("    unassigned");
    else {
      out.push("    " + formatIp6(linkLocal(dev.mac)));
      for (const a of i.ipv6 ?? []) out.push("    " + formatIp6(a.addr));
    }
  }
  return out;
}

export function showIpv6Route(state: CiscoState, dev: Device): string[] {
  const routes = routingTable6(state, dev.id).sort((a, b) => (a.net < b.net ? -1 : a.net > b.net ? 1 : a.prefix - b.prefix));
  const out = [
    `IPv6 Routing Table - default - ${routes.length} entries`,
    "Codes: C - Connected, L - Local, S - Static, U - Per-user Static route",
    "       B - BGP, R - RIP, H - NHRP, I1 - ISIS L1",
    "       I2 - ISIS L2, IA - ISIS interarea, IS - ISIS summary, D - EIGRP",
    "       EX - EIGRP external, ND - ND Default, NDp - ND Prefix, DCE - Destination",
    "       NDr - Redirect, O - OSPF Intra, OI - OSPF Inter, OE1 - OSPF ext 1",
    "       OE2 - OSPF ext 2, ON1 - OSPF NSSA ext 1, ON2 - OSPF NSSA ext 2",
  ];
  for (const r of routes) {
    out.push(`${pad(r.source, 4)}${formatIp6(r.net)}/${r.prefix} [${r.ad}/0]`);
    if (r.source === "S") out.push(`     via ${formatIp6(r.nextHop!)}`);
    else out.push(`     via ${r.iface}, ${r.source === "L" ? "receive" : "directly connected"}`);
  }
  return out;
}
