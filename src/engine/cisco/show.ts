import type { CiscoState, Device } from "./model";
import { shortName } from "./model";
import { formatIp, maskToPrefix } from "./ip";
import { ifaceState, l2Domains, ospfNeighbors, routingTable, type Route } from "./network";

const pad = (s: string, n: number) => (s.length >= n ? s + " " : s + " ".repeat(n - s.length));

/** Natural sort for interface names: Fa0/2 before Fa0/10. */
export function ifaceOrder(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function sortedIfaces(dev: Device) {
  const rank = (n: string) => (n.startsWith("Vlan") ? 2 : n.startsWith("FastEthernet") ? 0 : 1);
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
    (i) => i.switchport?.mode === "trunk" && ifaceState(state, dev.id, i.name).protocol === "up",
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

  const groups = new Map<number, Route[]>();
  const top: Route[] = [];
  for (const r of routes) {
    const cm = classfulMask(r.net);
    if (r.mask === 0 || (maskToPrefix(r.mask) ?? 0) <= (maskToPrefix(cm) ?? 0)) top.push(r);
    else {
      const major = (r.net & cm) >>> 0;
      groups.set(major, [...(groups.get(major) ?? []), r]);
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

export function showRunningConfig(dev: Device): string[] {
  const lines: string[] = ["Building configuration...", ""];
  const body: string[] = [
    "!",
    "version 15.2",
    "no service timestamps log datetime msec",
    "no service timestamps debug datetime msec",
    "no service password-encryption",
    "!",
    `hostname ${dev.hostname}`,
    "!",
  ];
  if (dev.kind === "switch") {
    body.push("spanning-tree mode pvst", "spanning-tree extend system-id", "!");
  }
  for (const i of sortedIfaces(dev)) {
    body.push(`interface ${i.name}`);
    if (i.description) body.push(` description ${i.description}`);
    if (i.switchport) {
      if (i.switchport.accessVlan !== 1) body.push(` switchport access vlan ${i.switchport.accessVlan}`);
      if (i.switchport.mode !== "dynamic") body.push(` switchport mode ${i.switchport.mode}`);
    } else if (i.ip !== undefined && i.mask !== undefined) {
      body.push(` ip address ${formatIp(i.ip)} ${formatIp(i.mask)}`);
    } else {
      body.push(" no ip address");
    }
    if (dev.kind === "router") body.push(" duplex auto", " speed auto");
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
  if (dev.defaultGateway !== undefined) body.push(`ip default-gateway ${formatIp(dev.defaultGateway)}`);
  if (dev.kind === "router") body.push("ip classless");
  for (const r of dev.staticRoutes) body.push(`ip route ${formatIp(r.net)} ${formatIp(r.mask)} ${formatIp(r.nextHop)}`);
  body.push("!", "ip flow-export version 9", "!", "line con 0", "!", "line aux 0", "!", "line vty 0 4", " login", "!", "!", "end");
  const bytes = body.join("\n").length;
  lines.push(`Current configuration : ${bytes} bytes`, ...body);
  return lines;
}
