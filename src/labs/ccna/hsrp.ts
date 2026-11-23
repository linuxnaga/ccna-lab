import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, hsrpMembers, parseIp, ping, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "R3", label: "CORE", kind: "router" as const, x: 500, y: 80, labelPos: "left" as const },
    { id: "R1", label: "GW1", kind: "router" as const, x: 280, y: 250 },
    { id: "R2", label: "GW2", kind: "router" as const, x: 720, y: 250, labelPos: "above" as const },
    { id: "SW1", label: "SW1", kind: "switch" as const, x: 500, y: 390 },
    { id: "PC1", label: "USER-1", kind: "pc" as const, x: 300, y: 530 },
    { id: "PC2", label: "USER-2", kind: "pc" as const, x: 700, y: 530 },
  ],
  links: [
    { id: "r1-r3", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "R3", port: "GigabitEthernet0/0" } },
    { id: "r2-r3", a: { device: "R2", port: "GigabitEthernet0/1" }, b: { device: "R3", port: "GigabitEthernet0/1" } },
    { id: "r1-sw1", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "GigabitEthernet0/1" } },
    { id: "r2-sw1", a: { device: "R2", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "GigabitEthernet0/2" } },
    { id: "sw1-pc1", a: { device: "SW1", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "sw1-pc2", a: { device: "SW1", port: "FastEthernet0/2" }, b: { device: "PC2", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const LAN = ip("255.255.255.0");
const P2P = ip("255.255.255.252");
const VIP = ip("192.168.50.1");
const DC = ip("10.99.99.99");
const LAN_IF = "GigabitEthernet0/0";

const group1 = (s: CiscoState, r: string) => s.devices[r].interfaces[LAN_IF].hsrp?.[1]?.ip === VIP;
const roles = (s: CiscoState) => hsrpMembers(s, "R1", LAN_IF, 1);

export const hsrpLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "hsrp",
  title: "The Gateway That Never Dies",
  startDevice: "R1",
  briefing: [
    "The user LAN has two gateway routers for redundancy, but the PCs can only point at one default gateway. Someone set them all to 192.168.50.1, an address no router owns yet, so nobody can reach the data centre at 10.99.99.99.",
    "Configure HSRP group 1 on both routers so they share the virtual gateway 192.168.50.1. GW1 should be the active router and take the role back after an outage, and GW2 must take over by itself if GW1 fails. OSPF to CORE is already running.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      const addr = (dev: string, iface: string, a: string, mask: number, desc: string) =>
        Object.assign(d[dev].interfaces[iface], { ip: ip(a), mask, shutdown: false, description: desc });
      const ospf = (dev: string, rid: string, nets: [string, string][]) => {
        d[dev].ospf = { pid: 1, routerId: ip(rid), networks: nets.map(([n, w]) => ({ net: ip(n), wildcard: ip(w), area: 0 })) };
      };
      d.R1.hostname = "GW1";
      addr("R1", LAN_IF, "192.168.50.2", LAN, "User LAN");
      addr("R1", "GigabitEthernet0/1", "10.0.13.1", P2P, "to CORE");
      ospf("R1", "1.1.1.1", [["192.168.50.0", "0.0.0.255"], ["10.0.13.0", "0.0.0.3"]]);
      d.R2.hostname = "GW2";
      addr("R2", LAN_IF, "192.168.50.3", LAN, "User LAN");
      addr("R2", "GigabitEthernet0/1", "10.0.23.1", P2P, "to CORE");
      ospf("R2", "2.2.2.2", [["192.168.50.0", "0.0.0.255"], ["10.0.23.0", "0.0.0.3"]]);
      d.R3.hostname = "CORE";
      addr("R3", "GigabitEthernet0/0", "10.0.13.2", P2P, "to GW1");
      addr("R3", "GigabitEthernet0/1", "10.0.23.2", P2P, "to GW2");
      d.R3.interfaces["Loopback0"] = { name: "Loopback0", ip: DC, mask: 0xffffffff, shutdown: false, description: "Data centre" };
      ospf("R3", "3.3.3.3", [["10.0.13.0", "0.0.0.3"], ["10.0.23.0", "0.0.0.3"], ["10.99.99.99", "0.0.0.0"]]);
      d.SW1.hostname = "SW1";
      for (const [pc, host] of [["PC1", "192.168.50.11"], ["PC2", "192.168.50.12"]] as const) {
        Object.assign(d[pc].interfaces.Ethernet0, { ip: ip(host), mask: LAN });
        d[pc].defaultGateway = VIP;
      }
    }),
  objectives: [
    { id: "gw1", text: "GW1 Gi0/0 is in HSRP group 1 with virtual IP 192.168.50.1", check: (s) => group1(s, "R1") },
    { id: "gw2", text: "GW2 Gi0/0 is in HSRP group 1 with virtual IP 192.168.50.1", check: (s) => group1(s, "R2") },
    {
      id: "prio",
      text: "GW1 has priority 110 and preempt, so it takes back the active role after a failure",
      check: (s) => {
        const g = s.devices.R1.interfaces[LAN_IF].hsrp?.[1];
        return g?.priority === 110 && g.preempt;
      },
    },
    {
      id: "roles",
      text: "GW1 is HSRP active and GW2 is standby",
      check: (s) => {
        const r = roles(s);
        return r[0]?.dev === "R1" && r[1]?.dev === "R2";
      },
    },
    { id: "reach", text: "USER-1 can ping the data centre at 10.99.99.99 through the virtual gateway", check: (s) => ping(s, "PC1", DC).ok },
    {
      id: "failover",
      text: "Failover works: with GW1's LAN port down, USER-1 still reaches 10.99.99.99 through GW2",
      check: (s) => {
        const r1 = structuredClone(s.devices.R1);
        r1.interfaces[LAN_IF].shutdown = true;
        const down = { ...s, devices: { ...s.devices, R1: r1 } };
        return hsrpMembers(down, "R2", LAN_IF, 1)[0]?.dev === "R2" && ping(down, "PC1", DC).ok;
      },
    },
  ],
  hints: [
    "HSRP is configured on the LAN interface of each router: 'int g0/0', then 'standby 1 ip 192.168.50.1'. Do the same on GW2.",
    "The router with the highest priority (default 100) becomes active. On GW1: 'standby 1 priority 110' and 'standby 1 preempt'.",
    "Check the roles with 'show standby brief' on both routers: GW1 should say Active and GW2 Standby, with 192.168.50.1 as the virtual IP.",
    "Test failover: on GW1 'int g0/0', 'shutdown', ping 10.99.99.99 from USER-1, check 'show standby brief' on GW2, then 'no shutdown'.",
  ],
  engine: ciscoEngine,
};
