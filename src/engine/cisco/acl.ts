/** IPv4 access lists: numbered standard (1-99, 1300-1999) and extended (100-199, 2000-2699), and named lists. */
import type { AclEntry, AddrMatch, Device } from "./model";
import { formatIp, wildcardMatch } from "./ip";

export const ANY: AddrMatch = { ip: 0, wildcard: 0xffffffff };

/** Standard or extended, for a numbered or named list. */
export function aclType(dev: Device, id: string): "standard" | "extended" | null {
  return dev.namedAcls[id] ?? (/^\d+$/.test(id) ? aclKind(Number(id)) : null);
}

export function aclKind(n: number): "standard" | "extended" | null {
  if ((n >= 1 && n <= 99) || (n >= 1300 && n <= 1999)) return "standard";
  if ((n >= 100 && n <= 199) || (n >= 2000 && n <= 2699)) return "extended";
  return null;
}

export interface Packet {
  src: number;
  dst: number;
  proto: "icmp" | "tcp" | "udp";
  /** Destination port, for TCP and UDP. */
  port?: number;
}

/** Well-known port names IOS accepts after "eq", per protocol, and prints in the config. */
const PORT_NAMES: Record<"tcp" | "udp", Record<string, number>> = {
  tcp: { ftp: 21, telnet: 23, smtp: 25, domain: 53, www: 80, pop3: 110 },
  udp: { domain: 53, bootps: 67, tftp: 69, ntp: 123, snmp: 161, syslog: 514 },
};

export function parsePort(proto: "tcp" | "udp", text: string): number | null {
  const t = text.toLowerCase();
  if (t in PORT_NAMES[proto]) return PORT_NAMES[proto][t];
  return /^\d+$/.test(t) && +t <= 65535 ? +t : null;
}

function portName(proto: "tcp" | "udp", port: number): string {
  return Object.entries(PORT_NAMES[proto]).find(([, p]) => p === port)?.[0] ?? String(port);
}

const hit = (m: AddrMatch, ip: number) => wildcardMatch(ip, m.ip, m.wildcard);

export function entryMatches(e: AclEntry, p: Packet): boolean {
  if (!hit(e.src, p.src)) return false;
  if (!e.proto) return true; // standard
  if (e.proto !== "ip" && e.proto !== p.proto) return false;
  if (e.dst && !hit(e.dst, p.dst)) return false;
  return e.port === undefined || e.port === p.port;
}

/**
 * First match wins, with the implicit "deny any" at the end. Like IOS, an
 * access-group that references an ACL with no entries permits everything.
 */
export function aclPermits(dev: Device, id: string | undefined, p: Packet): boolean {
  if (id === undefined) return true;
  const entries = dev.acls[id];
  if (!entries || !entries.length) return true;
  const e = entries.find((x) => entryMatches(x, p));
  return e?.action === "permit";
}

/** Source-only check, used by NAT "ip nat inside source list N". */
export function aclPermitsSource(dev: Device, id: string, src: number): boolean {
  const entries = dev.acls[id];
  if (!entries) return false;
  const e = entries.find((x) => hit(x.src, src));
  return e?.action === "permit";
}

export function formatMatch(m: AddrMatch): string {
  if (m.wildcard === 0xffffffff) return "any";
  if (m.wildcard === 0) return `host ${formatIp(m.ip)}`;
  return `${formatIp(m.ip)} ${formatIp(m.wildcard)}`;
}

/** Body of an entry as it appears after "access-list N" in the running config. */
export function formatEntry(e: AclEntry): string {
  if (!e.proto) {
    const src = e.src.wildcard === 0 ? formatIp(e.src.ip) : formatMatch(e.src);
    return `${e.action} ${src}`;
  }
  const port = e.port !== undefined ? ` eq ${portName(e.proto as "tcp" | "udp", e.port)}` : "";
  return `${e.action} ${e.proto} ${formatMatch(e.src)} ${formatMatch(e.dst ?? ANY)}${port}`;
}
