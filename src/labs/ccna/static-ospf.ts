import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, ifaceState, ospfNeighbors, parseIp, ping, routingTable, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "PC1", label: "HQ-PC", kind: "pc" as const, x: 110, y: 300 },
    { id: "R1", label: "HQ", kind: "router" as const, x: 360, y: 300, labelPos: "above" as const },
    { id: "R2", label: "BRANCH", kind: "router" as const, x: 640, y: 300, labelPos: "above" as const },
    { id: "PC2", label: "BR-PC", kind: "pc" as const, x: 890, y: 300 },
  ],
  links: [
    { id: "pc1-r1", a: { device: "PC1", port: "Ethernet0" }, b: { device: "R1", port: "GigabitEthernet0/0" } },
    { id: "r1-r2", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "R2", port: "GigabitEthernet0/1" } },
    { id: "r2-pc2", a: { device: "R2", port: "GigabitEthernet0/0" }, b: { device: "PC2", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const LAN = ip("255.255.255.0");
const WAN = ip("255.255.255.252");

const has = (s: CiscoState, dev: string, iface: string, addr: string, mask: number) => {
  const i = s.devices[dev].interfaces[iface];
  return i.ip === ip(addr) && i.mask === mask && ifaceState(s, dev, iface).protocol === "up";
};

export const staticOspfLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "static-ospf",
  title: "Two Sites, One Network",
  startDevice: "R2",
  briefing: [
    "The company just lit up a point-to-point link between HQ and the new branch. HQ's router is half configured; the branch router is fresh out of the box.",
    "Address the branch router, bring up the /30 WAN link, and run OSPF area 0 on both routers so each site learns the other's LAN. Done means a PC at HQ can ping a PC at the branch.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.R1.hostname = "HQ";
      Object.assign(d.R1.interfaces["GigabitEthernet0/0"], { ip: ip("192.168.10.1"), mask: LAN, shutdown: false, description: "HQ LAN" });
      Object.assign(d.R1.interfaces["GigabitEthernet0/1"], { ip: ip("10.0.0.1"), mask: WAN, description: "WAN to BRANCH" });
      d.R2.hostname = "BRANCH";
      Object.assign(d.PC1.interfaces.Ethernet0, { ip: ip("192.168.10.10"), mask: LAN });
      d.PC1.defaultGateway = ip("192.168.10.1");
      Object.assign(d.PC2.interfaces.Ethernet0, { ip: ip("192.168.20.10"), mask: LAN });
      d.PC2.defaultGateway = ip("192.168.20.1");
    }),
  objectives: [
    { id: "br-lan", text: "BRANCH Gig0/0: 192.168.20.1/24, up/up", check: (s) => has(s, "R2", "GigabitEthernet0/0", "192.168.20.1", LAN) },
    {
      id: "wan",
      text: "WAN link up: HQ Gig0/1 10.0.0.1/30 and BRANCH Gig0/1 10.0.0.2/30",
      check: (s) => has(s, "R1", "GigabitEthernet0/1", "10.0.0.1", WAN) && has(s, "R2", "GigabitEthernet0/1", "10.0.0.2", WAN),
    },
    {
      id: "rid",
      text: "OSPF process 1 with router-id 1.1.1.1 on HQ and 2.2.2.2 on BRANCH",
      check: (s) => s.devices.R1.ospf?.pid === 1 && s.devices.R1.ospf.routerId === ip("1.1.1.1") && s.devices.R2.ospf?.pid === 1 && s.devices.R2.ospf.routerId === ip("2.2.2.2"),
    },
    { id: "adj", text: "HQ and BRANCH form a FULL OSPF adjacency in area 0", check: (s) => ospfNeighbors(s, "R1").some((n) => n.router === "R2") },
    {
      id: "routes",
      text: "Each router learns the other site's LAN via OSPF",
      check: (s) =>
        routingTable(s, "R1").some((r) => r.source === "O" && r.net === ip("192.168.20.0")) &&
        routingTable(s, "R2").some((r) => r.source === "O" && r.net === ip("192.168.10.0")),
    },
    { id: "e2e", text: "HQ-PC can ping BR-PC (192.168.20.10)", check: (s) => ping(s, "PC1", ip("192.168.20.10")).ok },
  ],
  hints: [
    "Start on BRANCH: 'int g0/0', 'ip add 192.168.20.1 255.255.255.0', 'no shut'. Then do the same on g0/1 with 10.0.0.2 255.255.255.252.",
    "HQ's WAN port already has its address but is still shut down. Open HQ's console and check 'show ip interface brief'.",
    "On each router: 'router ospf 1', then 'router-id 1.1.1.1' (or 2.2.2.2). Advertise networks with wildcard masks, e.g. 'network 10.0.0.0 0.0.0.3 area 0'.",
    "HQ needs 'network 192.168.10.0 0.0.0.255 area 0' and BRANCH needs 'network 192.168.20.0 0.0.0.255 area 0'. Verify with 'show ip ospf neighbor' and 'show ip route'.",
  ],
  engine: ciscoEngine,
};
