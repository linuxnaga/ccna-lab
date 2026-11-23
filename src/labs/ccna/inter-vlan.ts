import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, ifaceState, parseIp, ping, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "R1", label: "R1", kind: "router" as const, x: 500, y: 90, labelPos: "left" as const },
    { id: "SW1", label: "SW1", kind: "switch" as const, x: 500, y: 300 },
    { id: "PC1", label: "SALES-PC", kind: "pc" as const, x: 250, y: 500 },
    { id: "PC2", label: "ENG-PC", kind: "pc" as const, x: 750, y: 500 },
  ],
  links: [
    { id: "r1-sw1", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "GigabitEthernet0/1" } },
    { id: "sw1-pc1", a: { device: "SW1", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "sw1-pc2", a: { device: "SW1", port: "FastEthernet0/2" }, b: { device: "PC2", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const MASK = ip("255.255.255.0");

const subif = (s: CiscoState, vlan: number, gw: string) => {
  const i = s.devices.R1.interfaces[`GigabitEthernet0/0.${vlan}`];
  return !!i && i.dot1q === vlan && i.ip === ip(gw) && i.mask === MASK;
};

export const interVlanLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "inter-vlan",
  title: "Route Between the VLANs",
  startDevice: "SW1",
  briefing: [
    "Sales (VLAN 10) and Engineering (VLAN 20) were split into separate VLANs last week, and now they cannot share files. The office only has a router with a single LAN port, so there is no layer 3 switch to route between them.",
    "Build a router-on-a-stick: trunk the switch uplink to R1, then create one 802.1Q subinterface per VLAN on R1 Gi0/0 to act as each VLAN's default gateway.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.R1.hostname = "R1";
      d.SW1.hostname = "SW1";
      d.SW1.vlans[10] = "SALES";
      d.SW1.vlans[20] = "ENG";
      Object.assign(d.SW1.interfaces["FastEthernet0/1"].switchport!, { mode: "access", accessVlan: 10 });
      Object.assign(d.SW1.interfaces["FastEthernet0/2"].switchport!, { mode: "access", accessVlan: 20 });
      Object.assign(d.PC1.interfaces.Ethernet0, { ip: ip("192.168.10.10"), mask: MASK });
      d.PC1.defaultGateway = ip("192.168.10.1");
      Object.assign(d.PC2.interfaces.Ethernet0, { ip: ip("192.168.20.10"), mask: MASK });
      d.PC2.defaultGateway = ip("192.168.20.1");
    }),
  objectives: [
    { id: "trunk", text: "SW1 Gi0/1 (the link to R1) is an 802.1Q trunk", check: (s) => s.devices.SW1.interfaces["GigabitEthernet0/1"].switchport!.mode === "trunk" },
    { id: "phys", text: "R1 Gi0/0 is enabled (up/up)", check: (s) => ifaceState(s, "R1", "GigabitEthernet0/0").protocol === "up" },
    { id: "sub10", text: "R1 Gi0/0.10: 802.1Q VLAN 10, gateway 192.168.10.1/24", check: (s) => subif(s, 10, "192.168.10.1") },
    { id: "sub20", text: "R1 Gi0/0.20: 802.1Q VLAN 20, gateway 192.168.20.1/24", check: (s) => subif(s, 20, "192.168.20.1") },
    { id: "gw", text: "SALES-PC can ping its gateway 192.168.10.1", check: (s) => ping(s, "PC1", ip("192.168.10.1")).ok },
    { id: "inter", text: "SALES-PC can ping ENG-PC (192.168.20.10) across VLANs", check: (s) => ping(s, "PC1", ip("192.168.20.10")).ok },
  ],
  hints: [
    "On SW1: 'int g0/1', 'switchport mode trunk'. A trunk carries every VLAN to the router with an 802.1Q tag.",
    "On R1 the physical port only needs to be up: 'int g0/0', 'no shutdown'. It gets no IP address of its own.",
    "Create a subinterface per VLAN. The tag must come first: 'int g0/0.10', 'encapsulation dot1q 10', 'ip add 192.168.10.1 255.255.255.0'.",
    "Repeat for VLAN 20 with 'int g0/0.20', 'encapsulation dot1q 20', 'ip add 192.168.20.1 255.255.255.0'. Verify with 'show ip interface brief' and ping from SALES-PC.",
  ],
  engine: ciscoEngine,
};
