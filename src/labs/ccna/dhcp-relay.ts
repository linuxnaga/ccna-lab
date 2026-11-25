import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, parseIp, ping, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "R1", label: "BR-RTR", kind: "router" as const, x: 300, y: 130, labelPos: "above" as const },
    { id: "R2", label: "HQ-RTR", kind: "router" as const, x: 720, y: 130, labelPos: "above" as const },
    { id: "SW1", label: "BR-SW", kind: "switch" as const, x: 300, y: 330 },
    { id: "PC1", label: "BR-PC1", kind: "pc" as const, x: 170, y: 510 },
    { id: "PC2", label: "BR-PC2", kind: "pc" as const, x: 430, y: 510 },
    { id: "PC3", label: "HQ-PC", kind: "pc" as const, x: 720, y: 450 },
  ],
  links: [
    { id: "r1-r2", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "R2", port: "GigabitEthernet0/1" } },
    { id: "r1-sw1", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "GigabitEthernet0/1" } },
    { id: "sw1-pc1", a: { device: "SW1", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "sw1-pc2", a: { device: "SW1", port: "FastEthernet0/2" }, b: { device: "PC2", port: "Ethernet0" } },
    { id: "r2-pc3", a: { device: "R2", port: "GigabitEthernet0/0" }, b: { device: "PC3", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const LAN = ip("255.255.255.0");
const P2P = ip("255.255.255.252");
const BRANCH = ip("192.168.20.0");
const BR_GW = ip("192.168.20.1");
const DNS = ip("192.168.10.53");
const HQ_PC = ip("192.168.10.50");

const branchPool = (s: CiscoState) =>
  Object.values(s.devices.R2.dhcp.pools).find((p) => p.net === BRANCH && p.mask === LAN);

const r2Owns = (s: CiscoState, addr: number | undefined) =>
  addr !== undefined && Object.values(s.devices.R2.interfaces).some((i) => i.ip === addr);

const leasedFromHq = (s: CiscoState, pc: string) => {
  const d = s.devices[pc];
  const a = d.interfaces.Ethernet0.ip;
  return d.dhcpServer === "R2" && a !== undefined && (a & LAN) >>> 0 === BRANCH && (a & 0xff) > 10 && d.defaultGateway === BR_GW;
};

export const dhcpRelayLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "dhcp-relay",
  title: "The Branch Gets No Lease",
  startDevice: "R2",
  briefing: [
    "The company is centralising services: every site will get its addresses from the DHCP server on HQ-RTR instead of running its own. HQ already leases addresses to its own LAN, but the new branch PCs sit on 192.168.20.0/24, one router hop away, and come up with no address at all.",
    "Build a pool for the branch on HQ-RTR, keep the first ten addresses for network gear, and make BR-RTR relay the PCs' DHCP broadcasts to HQ. Then make sure HQ-RTR can actually answer: it has never heard of the branch subnet.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      const addr = (dev: string, iface: string, a: string, mask: number, desc: string) =>
        Object.assign(d[dev].interfaces[iface], { ip: ip(a), mask, shutdown: false, description: desc });
      d.R1.hostname = "BR-RTR";
      addr("R1", "GigabitEthernet0/0", "192.168.20.1", LAN, "Branch LAN");
      addr("R1", "GigabitEthernet0/1", "10.0.12.1", P2P, "WAN to HQ");
      d.R1.staticRoutes.push({ net: 0, mask: 0, nextHop: ip("10.0.12.2") });
      d.R2.hostname = "HQ-RTR";
      addr("R2", "GigabitEthernet0/0", "192.168.10.1", LAN, "HQ LAN");
      addr("R2", "GigabitEthernet0/1", "10.0.12.2", P2P, "WAN to branch");
      d.R2.dhcp.excluded.push([ip("192.168.10.1"), ip("192.168.10.99")]);
      d.R2.dhcp.pools.HQ = { name: "HQ", net: ip("192.168.10.0"), mask: LAN, defaultRouter: ip("192.168.10.1"), dns: DNS };
      d.SW1.hostname = "BR-SW";
      Object.assign(d.PC3.interfaces.Ethernet0, { ip: HQ_PC, mask: LAN });
      d.PC3.defaultGateway = ip("192.168.10.1");
    }),
  objectives: [
    {
      id: "pool",
      text: "HQ-RTR has a pool for 192.168.20.0/24 with default router 192.168.20.1 and DNS 192.168.10.53",
      check: (s) => {
        const p = branchPool(s);
        return p?.defaultRouter === BR_GW && p.dns === DNS;
      },
    },
    {
      id: "exclude",
      text: "Addresses 192.168.20.1 to 192.168.20.10 are excluded from leasing",
      check: (s) => {
        const ex = s.devices.R2.dhcp.excluded;
        for (let a = BR_GW; a <= ip("192.168.20.10"); a++) if (!ex.some(([lo, hi]) => a >= lo && a <= hi)) return false;
        return true;
      },
    },
    { id: "return", text: "HQ-RTR can reach the branch LAN (ping 192.168.20.1 from HQ-RTR works)", check: (s) => ping(s, "R2", BR_GW).ok },
    {
      id: "helper",
      text: "BR-RTR Gi0/0 relays DHCP requests to HQ-RTR with ip helper-address",
      check: (s) => r2Owns(s, s.devices.R1.interfaces["GigabitEthernet0/0"].helper),
    },
    { id: "lease", text: "BR-PC1 and BR-PC2 both lease a branch address from HQ-RTR (ipconfig /dhcp)", check: (s) => leasedFromHq(s, "PC1") && leasedFromHq(s, "PC2") },
    { id: "reach", text: "BR-PC1 can ping HQ-PC at 192.168.10.50", check: (s) => leasedFromHq(s, "PC1") && ping(s, "PC1", HQ_PC).ok },
  ],
  hints: [
    "Start on HQ-RTR, next to the existing HQ pool: 'ip dhcp excluded-address 192.168.20.1 192.168.20.10', then 'ip dhcp pool BRANCH', 'network 192.168.20.0 255.255.255.0', 'default-router 192.168.20.1', 'dns-server 192.168.10.53'.",
    "A DHCP Discover is a broadcast, and routers do not forward broadcasts. On BR-RTR: 'int g0/0', 'ip helper-address 10.0.12.2' turns it into a unicast to HQ, stamped with the relay address 192.168.20.1.",
    "HQ-RTR picks the pool by that relay address and sends its reply to 192.168.20.1, but it has no route there. On HQ-RTR: 'ip route 192.168.20.0 255.255.255.0 10.0.12.1'.",
    "On each branch PC run 'ipconfig /dhcp', then check 'show ip dhcp binding' on HQ-RTR and ping 192.168.10.50 from BR-PC1.",
  ],
  engine: ciscoEngine,
};
