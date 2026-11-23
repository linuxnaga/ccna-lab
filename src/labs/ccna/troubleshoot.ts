import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, ospfNeighbors, parseIp, ping, routingTable, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "PC1", label: "FL3-PC1", kind: "pc" as const, x: 110, y: 500 },
    { id: "PC2", label: "FL3-PC2", kind: "pc" as const, x: 330, y: 500 },
    { id: "SW1", label: "FL3-SW", kind: "switch" as const, x: 220, y: 300 },
    { id: "R1", label: "FL3-R", kind: "router" as const, x: 450, y: 120, labelPos: "above" as const },
    { id: "R2", label: "DC-R", kind: "router" as const, x: 730, y: 120, labelPos: "above" as const },
    { id: "SRV", label: "FILE-SRV", kind: "server" as const, x: 730, y: 420 },
  ],
  links: [
    { id: "pc1-sw1", a: { device: "PC1", port: "Ethernet0" }, b: { device: "SW1", port: "FastEthernet0/1" } },
    { id: "pc2-sw1", a: { device: "PC2", port: "Ethernet0" }, b: { device: "SW1", port: "FastEthernet0/2" } },
    { id: "sw1-r1", a: { device: "SW1", port: "GigabitEthernet0/1" }, b: { device: "R1", port: "GigabitEthernet0/0" } },
    { id: "r1-r2", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "R2", port: "GigabitEthernet0/1" } },
    { id: "r2-srv", a: { device: "R2", port: "GigabitEthernet0/0" }, b: { device: "SRV", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const LAN = ip("255.255.255.0");
const GW = ip("192.168.20.1");
const SERVER = ip("172.16.0.10");

export const troubleshootLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "troubleshoot",
  title: "Ticket #4471: Floor 3 Is Down",
  startDevice: "PC1",
  briefing: [
    "Priority ticket: nobody on floor 3 can open the file share in the data centre. Last night's change window touched the floor switch, both routers and one PC, and the engineer who made the changes is on a plane.",
    "There are five separate faults. Work up the stack from the PC: addressing, VLANs, interfaces, then routing. Every objective is a symptom, so verify with show commands and ping instead of guessing.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.SW1.hostname = "FL3-SW";
      d.SW1.vlans[20] = "FLOOR3";
      d.SW1.vlans[99] = "QUARANTINE";
      Object.assign(d.SW1.interfaces["FastEthernet0/1"].switchport!, { mode: "access", accessVlan: 20 });
      // Fault: PC2's port was moved to the quarantine VLAN.
      Object.assign(d.SW1.interfaces["FastEthernet0/2"].switchport!, { mode: "access", accessVlan: 99 });
      Object.assign(d.SW1.interfaces["GigabitEthernet0/1"].switchport!, { mode: "access", accessVlan: 20 });

      d.R1.hostname = "FL3-R";
      // Fault: LAN interface left shut down after the change.
      Object.assign(d.R1.interfaces["GigabitEthernet0/0"], { ip: GW, mask: LAN, shutdown: true, description: "Floor 3 LAN" });
      // Fault: /24 instead of /30 on the WAN link, so OSPF will not form an adjacency.
      Object.assign(d.R1.interfaces["GigabitEthernet0/1"], { ip: ip("10.0.0.1"), mask: LAN, shutdown: false, description: "WAN to DC-R" });
      d.R1.ospf = {
        pid: 1,
        routerId: ip("1.1.1.1"),
        networks: [
          { net: ip("192.168.20.0"), wildcard: ip("0.0.0.255"), area: 0 },
          { net: ip("10.0.0.0"), wildcard: ip("0.0.0.3"), area: 0 },
        ],
      };

      d.R2.hostname = "DC-R";
      Object.assign(d.R2.interfaces["GigabitEthernet0/0"], { ip: ip("172.16.0.1"), mask: LAN, shutdown: false, description: "DC servers" });
      Object.assign(d.R2.interfaces["GigabitEthernet0/1"], { ip: ip("10.0.0.2"), mask: ip("255.255.255.252"), shutdown: false, description: "WAN to FL3-R" });
      d.R2.ospf = {
        pid: 1,
        routerId: ip("2.2.2.2"),
        networks: [
          { net: ip("172.16.0.0"), wildcard: ip("0.0.0.255"), area: 0 },
          // Fault: WAN link advertised in the wrong area.
          { net: ip("10.0.0.0"), wildcard: ip("0.0.0.3"), area: 1 },
        ],
      };

      Object.assign(d.PC1.interfaces.Ethernet0, { ip: ip("192.168.20.11"), mask: LAN });
      // Fault: wrong default gateway.
      d.PC1.defaultGateway = ip("192.168.20.254");
      Object.assign(d.PC2.interfaces.Ethernet0, { ip: ip("192.168.20.12"), mask: LAN });
      d.PC2.defaultGateway = GW;
      Object.assign(d.SRV.interfaces.Ethernet0, { ip: SERVER, mask: LAN });
      d.SRV.defaultGateway = ip("172.16.0.1");
    }),
  objectives: [
    { id: "pc1-gw", text: "FL3-PC1 can ping its gateway 192.168.20.1", check: (s) => ping(s, "PC1", GW).ok },
    { id: "pc2-gw", text: "FL3-PC2 can ping its gateway 192.168.20.1", check: (s) => ping(s, "PC2", GW).ok },
    { id: "adj", text: "FL3-R and DC-R form a FULL OSPF adjacency", check: (s) => ospfNeighbors(s, "R1").some((n) => n.router === "R2") },
    {
      id: "route",
      text: "FL3-R learns the data centre LAN 172.16.0.0/24 from OSPF",
      check: (s) => routingTable(s, "R1").some((r) => r.source === "O" && r.net === ip("172.16.0.0") && r.mask === LAN),
    },
    { id: "pc1-srv", text: "FL3-PC1 can reach FILE-SRV (172.16.0.10)", check: (s) => ping(s, "PC1", SERVER).ok },
    { id: "pc2-srv", text: "FL3-PC2 can reach FILE-SRV (172.16.0.10)", check: (s) => ping(s, "PC2", SERVER).ok },
  ],
  hints: [
    "Start at the PCs: 'ipconfig' on each. Compare FL3-PC1's default gateway with FL3-PC2's. Fix it with 'ipconfig 192.168.20.11 255.255.255.0 192.168.20.1'.",
    "On FL3-SW: 'show vlan brief' or 'show interfaces status'. One PC port is not in VLAN 20. On FL3-R: 'show ip interface brief' shows which interface is administratively down.",
    "OSPF neighbors must agree on subnet and area. Compare 'show ip interface brief' (or 'show run') on both routers: the WAN masks differ. Then compare 'show ip protocols' or 'show ip ospf interface brief'.",
    "On FL3-R: 'int g0/1', 'ip add 10.0.0.1 255.255.255.252'. On DC-R: 'router ospf 1', 'no network 10.0.0.0 0.0.0.3 area 1', 'network 10.0.0.0 0.0.0.3 area 0'.",
  ],
  engine: ciscoEngine,
};
