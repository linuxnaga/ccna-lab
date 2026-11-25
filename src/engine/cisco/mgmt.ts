/**
 * Device management services: NTP, syslog, SNMP, CDP and LLDP. Like the
 * rest of the emulator these are computed from the current configuration
 * (an NTP client is synchronised when its server answers on UDP 123).
 */
import type { CiscoState, Device } from "./model";
import { shortName } from "./model";
import { formatIp } from "./ip";
import { deliver, findLink, l2Domains, physicalUp } from "./network";
import { SEVERITIES } from "./show";

const pad = (s: string, n: number) => (s.length >= n ? s + " " : s + " ".repeat(n - s.length));

/* ---------------------------- NTP ---------------------------- */

export interface NtpSync {
  server: number;
  stratum: number;
}

/** UDP request/reply between two devices (ACLs checked on the way there, reply treated as established). */
function udpExchange(state: CiscoState, fromId: string, dst: number, port: number): Device | null {
  const uf = l2Domains(state);
  const there = deliver(state, fromId, dst, uf, { proto: "udp", port });
  if (!there.ok) return null;
  const owner = state.devices[there.hops[there.hops.length - 1]];
  if (owner.id === fromId) return null;
  const back = deliver(state, owner.id, there.src, uf, { src: there.dst, proto: "udp", skipAcl: true });
  return back.ok ? owner : null;
}

/** Stratum this device serves time at, or null if it is not a time source. */
function serves(state: CiscoState, dev: Device, depth: number): number | null {
  if (dev.services?.ntp) return 1;
  if (dev.mgmt.ntpMaster !== undefined) return dev.mgmt.ntpMaster;
  if (depth > 0) {
    const up = ntpStatus(state, dev.id, depth - 1);
    if (up) return up.stratum;
  }
  return null;
}

/** The first configured server that answers, and our stratum (its stratum + 1). */
export function ntpStatus(state: CiscoState, devId: string, depth = 3): NtpSync | null {
  const dev = state.devices[devId];
  if (dev.mgmt.ntpMaster !== undefined && !dev.mgmt.ntpServers.length) return null;
  for (const server of dev.mgmt.ntpServers) {
    const owner = udpExchange(state, devId, server, 123);
    const st = owner ? serves(state, owner, depth) : null;
    if (st !== null) return { server, stratum: st + 1 };
  }
  return null;
}

export function showNtpStatus(state: CiscoState, dev: Device): string[] {
  const sync = ntpStatus(state, dev.id);
  if (dev.mgmt.ntpMaster !== undefined && !sync) {
    return [`Clock is synchronized, stratum ${dev.mgmt.ntpMaster}, reference is 127.127.1.1`, "nominal freq is 250.0000 Hz, actual freq is 250.0000 Hz, precision is 2**24"];
  }
  if (!sync) return ["Clock is unsynchronized, stratum 16, no reference clock", "nominal freq is 250.0000 Hz, actual freq is 250.0000 Hz, precision is 2**24"];
  return [
    `Clock is synchronized, stratum ${sync.stratum}, reference is ${formatIp(sync.server)}`,
    "nominal freq is 250.0000 Hz, actual freq is 249.9990 Hz, precision is 2**24",
    "clock offset is 0.0000 msec, root delay is 0.00 msec",
    "root dispersion is 0.02 msec, peer dispersion is 0.02 msec.",
  ];
}

export function showNtpAssociations(state: CiscoState, dev: Device): string[] {
  const sync = ntpStatus(state, dev.id);
  const out = ["", "address         ref clock       st   when  poll reach  delay  offset   disp"];
  for (const s of dev.mgmt.ntpServers) {
    const on = sync?.server === s;
    out.push(`${on ? "*~" : " ~"}${pad(formatIp(s), 16)}${pad(on ? "127.127.1.1" : ".INIT.", 16)}${pad(String(on ? sync!.stratum - 1 : 16), 5)}${pad(on ? "14" : "-", 6)}${pad("64", 5)}${pad(on ? "377" : "0", 6)}${pad("0.00", 7)}${pad("0.00", 9)}${on ? "0.12" : "16000."}`);
  }
  out.push(" * sys.peer, # selected, + candidate, - outlyer, x falseticker, ~ configured");
  return out;
}

export function showClock(state: CiscoState, dev: Device, now = new Date()): string[] {
  const tz = dev.mgmt.timezone ?? { name: "UTC", offset: 0 };
  const t = new Date(now.getTime() + tz.offset * 3600_000);
  const day = t.toUTCString().slice(0, 3);
  const mon = t.toUTCString().slice(8, 11);
  const hms = t.toISOString().slice(11, 23);
  const synced = !!ntpStatus(state, dev.id) || dev.mgmt.ntpMaster !== undefined;
  return [`${synced ? "" : "*"}${hms} ${tz.name} ${day} ${mon} ${t.getUTCDate()} ${t.getUTCFullYear()}`];
}

/* ---------------------------- Syslog / SNMP ---------------------------- */

export function showLogging(state: CiscoState, dev: Device): string[] {
  const trap = dev.mgmt.logTrap ?? 6;
  return [
    "Syslog logging: enabled (0 messages dropped, 0 messages rate-limited,",
    "                0 flushes, 0 overruns, xml disabled, filtering disabled)",
    "",
    `    Console logging: level debugging, 14 messages logged, xml disabled,`,
    "    Monitor logging: level debugging, 0 messages logged, xml disabled,",
    "    Buffer logging:  disabled, xml disabled,",
    `    Timestamp logging: ${dev.mgmt.timestamps ? "datetime msec" : "disabled"}`,
    `    Trap logging: level ${SEVERITIES[trap]}, 14 message lines logged`,
    ...dev.mgmt.logHosts.map((h) => {
      const up = udpExchange(state, dev.id, h, 514) !== null;
      return `        Logging to ${formatIp(h)}  (udp port 514, audit disabled, link ${up ? "up" : "down"}), ${up ? 14 : 0} message lines logged,`;
    }),
  ];
}

export function showSnmpCommunity(dev: Device): string[] {
  const out: string[] = [];
  for (const c of dev.mgmt.snmp) {
    out.push("", `Community name: ${c.name}`, `Community Index: ${c.name}`, `Community SecurityName: ${c.name}`, `storage-type: nonvolatile        active   access: ${c.access === "rw" ? "read-write" : "read-only"}`);
  }
  return out;
}

/* ---------------------------- CDP / LLDP ---------------------------- */

export interface DiscoveryNeighbor {
  device: Device;
  localIface: string;
  remoteIface: string;
}

const platform = (d: Device) => (d.kind === "router" ? "ISR4331" : "WS-C2960-24TT-L");

/** Directly cabled Cisco devices this device hears CDP from. */
export function cdpNeighbors(state: CiscoState, devId: string): DiscoveryNeighbor[] {
  const dev = state.devices[devId];
  if (!dev.mgmt.cdp || dev.kind === "pc") return [];
  const out: DiscoveryNeighbor[] = [];
  for (const i of Object.values(dev.interfaces)) {
    if (i.cdp === false || !physicalUp(state, devId, i.name)) continue;
    const l = findLink(state, devId, i.name);
    const peer = l && state.devices[l.peer.device];
    if (!l || !peer || peer.kind === "pc" || !peer.mgmt.cdp || peer.interfaces[l.peer.port].cdp === false) continue;
    out.push({ device: peer, localIface: i.name, remoteIface: l.peer.port });
  }
  return out.sort((a, b) => a.device.hostname.localeCompare(b.device.hostname));
}

/** LLDP needs "lldp run" on both ends, transmit on theirs and receive on ours. */
export function lldpNeighbors(state: CiscoState, devId: string): DiscoveryNeighbor[] {
  const dev = state.devices[devId];
  if (!dev.mgmt.lldp || dev.kind === "pc") return [];
  const out: DiscoveryNeighbor[] = [];
  for (const i of Object.values(dev.interfaces)) {
    if (i.lldpRx === false || !physicalUp(state, devId, i.name)) continue;
    const l = findLink(state, devId, i.name);
    const peer = l && state.devices[l.peer.device];
    if (!l || !peer || peer.kind === "pc" || !peer.mgmt.lldp || peer.interfaces[l.peer.port].lldpTx === false) continue;
    out.push({ device: peer, localIface: i.name, remoteIface: l.peer.port });
  }
  return out.sort((a, b) => a.device.hostname.localeCompare(b.device.hostname));
}

const cdpIf = (n: string) => n.replace("GigabitEthernet", "Gig ").replace("FastEthernet", "Fas ");

export function showCdpNeighbors(state: CiscoState, dev: Device, detail: boolean): string[] {
  if (!dev.mgmt.cdp) return ["% CDP is not enabled"];
  const ns = cdpNeighbors(state, dev.id);
  if (detail) {
    const out: string[] = [];
    for (const n of ns) {
      const addr = Object.values(n.device.interfaces).find((i) => i.ip !== undefined && (i.name === n.remoteIface || i.name.startsWith("Vlan")))?.ip
        ?? Object.values(n.device.interfaces).find((i) => i.ip !== undefined)?.ip;
      out.push(
        "-------------------------",
        `Device ID: ${n.device.hostname}`,
        "Entry address(es): ",
        ...(addr !== undefined ? [`  IP address: ${formatIp(addr)}`] : []),
        `Platform: cisco ${platform(n.device)},  Capabilities: ${n.device.kind === "router" ? "Router Source-Route-Bridge" : "Switch IGMP"}`,
        `Interface: ${n.localIface},  Port ID (outgoing port): ${n.remoteIface}`,
        "Holdtime : 152 sec",
        "",
        "Version :",
        n.device.kind === "router"
          ? "Cisco IOS XE Software, Version 16.09.04"
          : "Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.2(7)E2, RELEASE SOFTWARE (fc3)",
        "",
      );
    }
    out.push(`Total cdp entries displayed : ${ns.length}`);
    return out;
  }
  return [
    "Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge",
    "                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone",
    "",
    "Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID",
    ...ns.map((n) => pad(n.device.hostname, 17) + pad(cdpIf(n.localIface), 18) + pad("152", 11) + pad(n.device.kind === "router" ? "R B" : "S I", 12) + pad(platform(n.device).slice(0, 9), 10) + cdpIf(n.remoteIface)),
    "",
    `Total cdp entries displayed : ${ns.length}`,
  ];
}

export function showLldpNeighbors(state: CiscoState, dev: Device): string[] {
  if (!dev.mgmt.lldp) return ["% LLDP is not enabled"];
  const ns = lldpNeighbors(state, dev.id);
  return [
    "Capability codes:",
    "    (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device",
    "    (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other",
    "",
    "Device ID           Local Intf     Hold-time  Capability      Port ID",
    ...ns.map((n) => pad(n.device.hostname, 20) + pad(shortName(n.localIface), 15) + pad("120", 11) + pad(n.device.kind === "router" ? "R" : "B", 16) + shortName(n.remoteIface)),
    "",
    `Total entries displayed: ${ns.length}`,
  ];
}
