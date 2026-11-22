/** IPv4 helpers. Addresses are unsigned 32-bit numbers internally. */

export function parseIp(s: string): number | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function formatIp(n: number): string {
  return [24, 16, 8, 0].map((sh) => (n >>> sh) & 255).join(".");
}

/** Prefix length of a contiguous mask, or null if not contiguous. */
export function maskToPrefix(mask: number): number | null {
  const inv = ~mask >>> 0;
  if ((inv & (inv + 1)) !== 0) return null;
  let bits = 0;
  for (let m = mask; m; m = (m << 1) >>> 0) bits++;
  return bits;
}

export function prefixToMask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function network(ip: number, mask: number): number {
  return (ip & mask) >>> 0;
}

export function sameSubnet(a: number, b: number, mask: number): boolean {
  return network(a, mask) === network(b, mask);
}

/** True if ip matches net under a wildcard (inverse) mask, as in OSPF/ACLs. */
export function wildcardMatch(ip: number, net: number, wildcard: number): boolean {
  const care = ~wildcard >>> 0;
  return ((ip & care) >>> 0) === ((net & care) >>> 0);
}

export function isHostAddress(ip: number, mask: number): boolean {
  const prefix = maskToPrefix(mask);
  if (prefix === null || prefix >= 31) return prefix !== null;
  const net = network(ip, mask);
  const bcast = (net | (~mask >>> 0)) >>> 0;
  return ip !== net && ip !== bcast;
}
