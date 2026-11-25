import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, ospfSegment, parseIp, ping, routingTable, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "R1", label: "HQ-EDGE", kind: "router" as const, x: 500, y: 90, labelPos: "left" as const },
    { id: "R4", label: "ISP", kind: "router" as const, x: 860, y: 90, labelPos: "above" as const },
    { id: "SW1", label: "CORE-SW", kind: "switch" as const, x: 500, y: 290 },
    { id: "R2", label: "BR-A", kind: "router" as const, x: 220, y: 330, labelPos: "above" as const },
    { id: "R3", label: "BR-B", kind: "router" as const, x: 780, y: 330, labelPos: "above" as const },
    { id: "PC2", label: "A-USER", kind: "pc" as const, x: 220, y: 520 },
    { id: "PC3", label: "B-USER", kind: "pc" as const, x: 780, y: 520 },
  ],
  links: [
    { id: "r1-isp", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "R4", port: "GigabitEthernet0/0" } },
    { id: "r1-sw1", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "GigabitEthernet0/1" } },
    { id: "r2-sw1", a: { device: "R2", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "FastEthernet0/1" } },
    { id: "r3-sw1", a: { device: "R3", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "FastEthernet0/2" } },
    { id: "r2-pc2", a: { device: "R2", port: "GigabitEthernet0/1" }, b: { device: "PC2", port: "Ethernet0" } },
    { id: "r3-pc3", a: { device: "R3", port: "GigabitEthernet0/1" }, b: { device: "PC3", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const LAN = ip("255.255.255.0");
const P2P = ip("255.255.255.252");
const INTERNET = ip("8.8.8.8");
const TRANSIT = "GigabitEthernet0/0";
const USER_IF = "GigabitEthernet0/1";

/** The election as BR-A sees it (any router on the segment sees the same result). */
const election = (s: CiscoState) => ospfSegment(s, "R2", TRANSIT);
const hasNeighbors = (s: CiscoState) => !!election(s).dr && !!election(s).bdr;

const learns = (s: CiscoState, dev: string, net: string) =>
  routingTable(s, dev).some((r) => r.source === "O" && r.net === ip(net) && r.mask === LAN);

const externalDefault = (s: CiscoState, dev: string) =>
  routingTable(s, dev).some((r) => r.source === "O" && r.ext && r.net === 0 && r.mask === 0);

export const ospfDrLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "ospf-dr",
  title: "Elect the Right DR",
  startDevice: "R2",
  briefing: [
    "Three routers share the 10.0.0.0/24 transit LAN behind CORE-SW, so OSPF elects a Designated Router (DR) and a Backup (BDR) there. Right now the little BR-B branch box wins the election just because it has the highest router ID, and it is struggling to keep up.",
    "Make HQ-EDGE the DR and keep BR-B out of the election for good. While you are in there, stop OSPF hellos leaking onto the user LANs, and have HQ-EDGE hand its Internet default route to the branches through OSPF instead of everyone needing a static route.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      const addr = (dev: string, iface: string, a: string, mask: number, desc: string) =>
        Object.assign(d[dev].interfaces[iface], { ip: ip(a), mask, shutdown: false, description: desc });
      const ospf = (dev: string, rid: string, nets: [string, string][]) => {
        d[dev].ospf = { pid: 1, routerId: ip(rid), networks: nets.map(([n, w]) => ({ net: ip(n), wildcard: ip(w), area: 0 })) };
      };
      d.R1.hostname = "HQ-EDGE";
      addr("R1", TRANSIT, "10.0.0.1", LAN, "Transit LAN");
      addr("R1", "GigabitEthernet0/1", "203.0.113.2", P2P, "Internet");
      d.R1.staticRoutes.push({ net: 0, mask: 0, nextHop: ip("203.0.113.1") });
      ospf("R1", "1.1.1.1", [["10.0.0.0", "0.0.0.255"]]);
      d.R2.hostname = "BR-A";
      addr("R2", TRANSIT, "10.0.0.2", LAN, "Transit LAN");
      addr("R2", USER_IF, "192.168.2.1", LAN, "Users A");
      ospf("R2", "2.2.2.2", [["10.0.0.0", "0.0.0.255"], ["192.168.2.0", "0.0.0.255"]]);
      d.R3.hostname = "BR-B";
      addr("R3", TRANSIT, "10.0.0.3", LAN, "Transit LAN");
      addr("R3", USER_IF, "192.168.3.1", LAN, "Users B");
      ospf("R3", "3.3.3.3", [["10.0.0.0", "0.0.0.255"], ["192.168.3.0", "0.0.0.255"]]);
      d.R4.hostname = "ISP";
      addr("R4", "GigabitEthernet0/0", "203.0.113.1", P2P, "Customer HQ");
      d.R4.interfaces.Loopback0 = { name: "Loopback0", ip: INTERNET, mask: 0xffffffff, shutdown: false, description: "Public DNS" };
      d.R4.staticRoutes.push({ net: ip("192.168.0.0"), mask: ip("255.255.0.0"), nextHop: ip("203.0.113.2") });
      d.SW1.hostname = "CORE-SW";
      for (const [pc, host, gw] of [["PC2", "192.168.2.10", "192.168.2.1"], ["PC3", "192.168.3.10", "192.168.3.1"]] as const) {
        Object.assign(d[pc].interfaces.Ethernet0, { ip: ip(host), mask: LAN });
        d[pc].defaultGateway = ip(gw);
      }
    }),
  objectives: [
    { id: "dr", text: "HQ-EDGE is the DR on the 10.0.0.0/24 transit LAN", check: (s) => hasNeighbors(s) && election(s).dr?.router === "R1" },
    {
      id: "bdr",
      text: "BR-B can never become DR or BDR (priority 0), which leaves BR-A as the BDR",
      check: (s) => s.devices.R3.interfaces[TRANSIT].ospfPriority === 0 && hasNeighbors(s) && election(s).bdr?.router === "R2",
    },
    {
      id: "passive",
      text: "The user LAN ports (BR-A and BR-B Gi0/1) are passive, and both user LANs are still advertised to HQ-EDGE",
      check: (s) =>
        !!s.devices.R2.ospf?.passive?.includes(USER_IF) && !!s.devices.R3.ospf?.passive?.includes(USER_IF) && learns(s, "R1", "192.168.2.0") && learns(s, "R1", "192.168.3.0"),
    },
    {
      id: "default",
      text: "HQ-EDGE originates its default route into OSPF: BR-A and BR-B learn O*E2 0.0.0.0/0",
      check: (s) => externalDefault(s, "R2") && externalDefault(s, "R3"),
    },
    { id: "reach", text: "Both user PCs can ping 8.8.8.8 on the Internet", check: (s) => ping(s, "PC2", INTERNET).ok && ping(s, "PC3", INTERNET).ok },
  ],
  hints: [
    "Run 'show ip ospf neighbor' on BR-A: the State column shows who is DR and BDR. The highest interface priority wins (default 1), then the highest router ID. On HQ-EDGE: 'int g0/0', 'ip ospf priority 255'.",
    "Priority 0 means 'never DR or BDR'. On BR-B: 'int g0/0', 'ip ospf priority 0'. On real routers the election does not preempt a sitting DR, so you would also run 'clear ip ospf process'.",
    "Hellos on a user LAN are wasted and let a rogue router peer with you. On BR-A and BR-B: 'router ospf 1', 'passive-interface g0/1'. The subnet is still advertised; check 'show ip route' on HQ-EDGE.",
    "HQ-EDGE already has a static default to the ISP. Under 'router ospf 1' add 'default-information originate', then look for O*E2 in 'show ip route' on the branches and ping 8.8.8.8 from B-USER.",
  ],
  engine: ciscoEngine,
};
