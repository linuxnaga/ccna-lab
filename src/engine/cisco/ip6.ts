/** IPv6 helpers. Addresses are 128-bit bigints internally. */

const ALL = (BigInt(1) << BigInt(128)) - BigInt(1);

export function parseIp6(s: string): bigint | null {
  if (!/^[0-9a-fA-F:]+$/.test(s) || !s.includes(":")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  return groups.reduce((n, g) => (n << BigInt(16)) | BigInt(parseInt(g, 16)), BigInt(0));
}

/** "2001:db8::1/64" -> { addr, prefix }. */
export function parsePrefix6(s: string): { addr: bigint; prefix: number } | null {
  const m = /^([^/]+)\/(\d{1,3})$/.exec(s);
  if (!m) return null;
  const addr = parseIp6(m[1]);
  const prefix = Number(m[2]);
  if (addr === null || prefix > 128) return null;
  return { addr, prefix };
}

/** RFC 5952 compression, upper case like IOS. */
export function formatIp6(n: bigint): string {
  const g = Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(112 - i * 16)) & BigInt(0xffff)));
  let best = { at: -1, len: 0 };
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > best.len && j - i > 1) best = { at: i, len: j - i };
    i = j;
  }
  const hex = (x: number) => x.toString(16).toUpperCase();
  if (best.at < 0) return g.map(hex).join(":");
  const left = g.slice(0, best.at).map(hex).join(":");
  const right = g.slice(best.at + best.len).map(hex).join(":");
  return `${left}::${right}`;
}

export function mask6(prefix: number): bigint {
  return prefix === 0 ? BigInt(0) : (ALL << BigInt(128 - prefix)) & ALL;
}

export function network6(addr: bigint, prefix: number): bigint {
  return addr & mask6(prefix);
}

export function sameSubnet6(a: bigint, b: bigint, prefix: number): boolean {
  return network6(a, prefix) === network6(b, prefix);
}

/** Modified EUI-64 interface ID from a Cisco-style MAC ("00E0.F7A1.2B3C"). */
export function eui64(mac: string): bigint {
  const hex = mac.replace(/\./g, "");
  const b = Array.from({ length: 6 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  b[0] ^= 0x02;
  const bytes = [b[0], b[1], b[2], 0xff, 0xfe, b[3], b[4], b[5]];
  return bytes.reduce((n, x) => (n << BigInt(8)) | BigInt(x), BigInt(0));
}

export const LINK_LOCAL_PREFIX = BigInt(0xfe80) << BigInt(112);

export function linkLocal(mac: string): bigint {
  return LINK_LOCAL_PREFIX | eui64(mac);
}

export function isLinkLocal(a: bigint): boolean {
  return a >> BigInt(118) === BigInt(0xfe80) >> BigInt(6);
}
