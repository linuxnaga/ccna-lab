/** Rank ladder shared by every course. Level n requires RANKS[n-1].xp total XP. */
export const RANKS = [
  { level: 1, title: "Cable Crimper", xp: 0 },
  { level: 2, title: "Patch Panel Pro", xp: 200 },
  { level: 3, title: "Subnet Scout", xp: 500 },
  { level: 4, title: "VLAN Wrangler", xp: 900 },
  { level: 5, title: "Packet Whisperer", xp: 1400 },
  { level: 6, title: "Route Ranger", xp: 2000 },
  { level: 7, title: "OSPF Oracle", xp: 2700 },
  { level: 8, title: "ACL Enforcer", xp: 3500 },
  { level: 9, title: "NOC Commander", xp: 4400 },
  { level: 10, title: "CCNA Architect", xp: 5400 },
] as const;

export function rankFor(xp: number) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const current = RANKS[i];
  const next = RANKS[i + 1];
  const progress = next ? (xp - current.xp) / (next.xp - current.xp) : 1;
  return { ...current, next, progress: Math.max(0, Math.min(1, progress)) };
}
