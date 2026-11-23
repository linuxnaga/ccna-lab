import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, deliver, parseIp, ping, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "PC1", label: "HQ-PC", kind: "pc" as const, x: 90, y: 430 },
    { id: "R1", label: "HQ", kind: "router" as const, x: 330, y: 430, labelPos: "below" as const },
    { id: "R2", label: "BRANCH", kind: "router" as const, x: 670, y: 430, labelPos: "below" as const },
    { id: "PC2", label: "BR-PC", kind: "pc" as const, x: 910, y: 430 },
    { id: "R3", label: "LTE-BACKUP", kind: "router" as const, x: 500, y: 130, labelPos: "above" as const },
  ],
  links: [
    { id: "pc1-r1", a: { device: "PC1", port: "Ethernet0" }, b: { device: "R1", port: "GigabitEthernet0/0" } },
    { id: "r1-r2", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "R2", port: "GigabitEthernet0/1" } },
    { id: "r2-pc2", a: { device: "R2", port: "GigabitEthernet0/0" }, b: { device: "PC2", port: "Ethernet0" } },
    { id: "r1-r3", a: { device: "R1", port: "GigabitEthernet0/2" }, b: { device: "R3", port: "GigabitEthernet0/0" } },
    { id: "r3-r2", a: { device: "R3", port: "GigabitEthernet0/1" }, b: { device: "R2", port: "GigabitEthernet0/2" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const LAN = ip("255.255.255.0");
const P2P = ip("255.255.255.252");
const BR_PC = ip("192.168.2.10");

const route = (s: CiscoState, dev: string, net: string, mask: number, nh: string, floating: boolean) =>
  s.devices[dev].staticRoutes.some(
    (r) => r.net === ip(net) && r.mask === mask && r.nextHop === ip(nh) && (floating ? (r.ad ?? 1) > 1 : (r.ad ?? 1) === 1),
  );

/** Simulate the primary circuit failing (BRANCH Gi0/1 down) without touching the student's config. */
function withPrimaryDown(s: CiscoState): CiscoState {
  const r2 = structuredClone(s.devices.R2);
  r2.interfaces["GigabitEthernet0/1"].shutdown = true;
  return { ...s, devices: { ...s.devices, R2: r2 } };
}

export const floatingStaticLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "floating-static",
  title: "Backup Link Failover",
  startDevice: "R2",
  briefing: [
    "The branch office runs on a fibre circuit straight to HQ, with an LTE backup router as the second path. Every interface is addressed and up, but nobody configured any routes, so the two LANs cannot talk at all.",
    "Use static routes over the fibre as the primary path, and floating static routes (a higher administrative distance) through LTE-BACKUP so traffic fails over by itself if the fibre drops. LTE-BACKUP already knows both LANs.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      const addr = (dev: string, iface: string, a: string, mask: number, desc?: string) =>
        Object.assign(d[dev].interfaces[iface], { ip: ip(a), mask, shutdown: false, description: desc });
      d.R1.hostname = "HQ";
      addr("R1", "GigabitEthernet0/0", "192.168.1.1", LAN, "HQ LAN");
      addr("R1", "GigabitEthernet0/1", "10.0.12.1", P2P, "FIBRE to BRANCH");
      addr("R1", "GigabitEthernet0/2", "10.0.13.1", P2P, "LTE backup");
      d.R2.hostname = "BRANCH";
      addr("R2", "GigabitEthernet0/0", "192.168.2.1", LAN, "BRANCH LAN");
      addr("R2", "GigabitEthernet0/1", "10.0.12.2", P2P, "FIBRE to HQ");
      addr("R2", "GigabitEthernet0/2", "10.0.23.1", P2P, "LTE backup");
      d.R3.hostname = "LTE-BACKUP";
      addr("R3", "GigabitEthernet0/0", "10.0.13.2", P2P, "to HQ");
      addr("R3", "GigabitEthernet0/1", "10.0.23.2", P2P, "to BRANCH");
      d.R3.staticRoutes.push({ net: ip("192.168.1.0"), mask: LAN, nextHop: ip("10.0.13.1") }, { net: ip("192.168.2.0"), mask: LAN, nextHop: ip("10.0.23.1") });
      Object.assign(d.PC1.interfaces.Ethernet0, { ip: ip("192.168.1.10"), mask: LAN });
      d.PC1.defaultGateway = ip("192.168.1.1");
      Object.assign(d.PC2.interfaces.Ethernet0, { ip: BR_PC, mask: LAN });
      d.PC2.defaultGateway = ip("192.168.2.1");
    }),
  objectives: [
    { id: "br-default", text: "BRANCH: default route 0.0.0.0/0 via the fibre (10.0.12.1)", check: (s) => route(s, "R2", "0.0.0.0", 0, "10.0.12.1", false) },
    {
      id: "br-float",
      text: "BRANCH: floating default route via LTE-BACKUP (10.0.23.2) with administrative distance 10",
      check: (s) => route(s, "R2", "0.0.0.0", 0, "10.0.23.2", true),
    },
    { id: "hq-static", text: "HQ: static route to 192.168.2.0/24 via the fibre (10.0.12.2)", check: (s) => route(s, "R1", "192.168.2.0", LAN, "10.0.12.2", false) },
    {
      id: "hq-float",
      text: "HQ: floating static route to 192.168.2.0/24 via LTE-BACKUP (10.0.13.2) with administrative distance 10",
      check: (s) => route(s, "R1", "192.168.2.0", LAN, "10.0.13.2", true),
    },
    {
      id: "primary",
      text: "HQ-PC can ping BR-PC (192.168.2.10) over the fibre, not the LTE path",
      check: (s) => {
        const d = deliver(s, "PC1", BR_PC);
        return ping(s, "PC1", BR_PC).ok && d.ok && !d.hops.includes("R3");
      },
    },
    {
      id: "failover",
      text: "Failover works: if the fibre goes down, HQ-PC still reaches BR-PC through LTE-BACKUP",
      check: (s) => {
        const down = withPrimaryDown(s);
        const d = deliver(down, "PC1", BR_PC);
        return ping(down, "PC1", BR_PC).ok && d.ok && d.hops.includes("R3");
      },
    },
  ],
  hints: [
    "A static route is 'ip route <network> <mask> <next-hop>'. A default route uses network and mask 0.0.0.0 0.0.0.0. On BRANCH: 'ip route 0.0.0.0 0.0.0.0 10.0.12.1'.",
    "Add a number after the next hop to set the administrative distance. Static routes default to 1, so 'ip route 0.0.0.0 0.0.0.0 10.0.23.2 10' stays hidden until the AD 1 route disappears.",
    "On HQ: 'ip route 192.168.2.0 255.255.255.0 10.0.12.2' and 'ip route 192.168.2.0 255.255.255.0 10.0.13.2 10'. 'show ip route' only lists the AD 1 route while the fibre is up.",
    "Test it yourself: on BRANCH 'int g0/1' then 'shutdown', check 'show ip route', ping from HQ-PC, then 'no shutdown' to restore the fibre.",
  ],
  engine: ciscoEngine,
};
