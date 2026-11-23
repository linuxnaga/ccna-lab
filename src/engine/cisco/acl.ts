/** Numbered IPv4 access lists: standard (1-99, 1300-1999) and extended (100-199, 2000-2699). */
import type { AclEntry, AddrMatch, Device } from "./model";
import { formatIp, wildcardMatch } from "./ip";

export const ANY: AddrMatch = { ip: 0, wildcard: 0xffffffff };

export function aclKind(n: number): "standard" | "extended" | null {
  if ((n >= 1 && n <= 99) || (n >= 1300 && n <= 1999)) return "standard";
  if ((n >= 100 && n <= 199) || (n >= 2000 && n <= 2699)) return "extended";
  return null;
}

export interface Packet {
  src: number;
  dst: number;
  proto: "icmp";
}

const hit = (m: AddrMatch, ip: number) => wildcardMatch(ip, m.ip, m.wildcard);

export function entryMatches(e: AclEntry, p: Packet): boolean {
  if (!hit(e.src, p.src)) return false;
  if (!e.proto) return true; // standard
  if (e.proto !== "ip" && e.proto !== p.proto) return false;
  return !e.dst || hit(e.dst, p.dst);
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
  const port = e.port !== undefined ? ` eq ${e.port}` : "";
  return `${e.action} ${e.proto} ${formatMatch(e.src)} ${formatMatch(e.dst ?? ANY)}${port}`;
}
