import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, ifaceState, parseIp, ping, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "R1", label: "R1", kind: "router" as const, x: 500, y: 80 },
    { id: "SW1", label: "SW1", kind: "switch" as const, x: 500, y: 290 },
    { id: "PC1", label: "SALES-1", kind: "pc" as const, x: 200, y: 510 },
    { id: "PC2", label: "SALES-2", kind: "pc" as const, x: 500, y: 510 },
    { id: "PC3", label: "GUEST", kind: "pc" as const, x: 800, y: 510 },
  ],
  links: [
    { id: "r1-sw1", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "GigabitEthernet0/1" } },
    { id: "sw1-pc1", a: { device: "SW1", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "sw1-pc2", a: { device: "SW1", port: "FastEthernet0/2" }, b: { device: "PC2", port: "Ethernet0" } },
    { id: "sw1-pc3", a: { device: "SW1", port: "FastEthernet0/3" }, b: { device: "PC3", port: "Ethernet0" } },
  ],
};

const GW = parseIp("192.168.10.1")!;
const MASK = parseIp("255.255.255.0")!;
const MGMT = parseIp("192.168.10.2")!;

const accessIn = (s: CiscoState, port: string, vlan: number) => {
  const sp = s.devices.SW1.interfaces[port].switchport!;
  return sp.mode === "access" && sp.accessVlan === vlan;
};

export const vlanAccessLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "vlan-access",
  title: "Sales VLAN Cannot Reach the Gateway",
  startDevice: "SW1",
  briefing: [
    "Branch office outage: the Sales team has been moved to their own VLAN on paper, but nobody configured the switch. Sales PCs are sharing a broadcast domain with the guest PC, and security wants that fixed today.",
    "Create VLAN 10 (SALES), put both Sales PCs and the router uplink into it as access ports, and keep the guest PC out. Then give SW1 a management address in VLAN 10 so the NOC can reach it.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.R1.hostname = "R1";
      Object.assign(d.R1.interfaces["GigabitEthernet0/0"], { ip: GW, mask: MASK, shutdown: false, description: "LAN - SALES" });
      d.SW1.hostname = "SW1";
      const hosts: [string, string][] = [["PC1", "192.168.10.11"], ["PC2", "192.168.10.12"], ["PC3", "192.168.10.50"]];
      for (const [pc, host] of hosts) {
        Object.assign(d[pc].interfaces.Ethernet0, { ip: parseIp(host), mask: MASK });
        d[pc].defaultGateway = GW;
      }
    }),
  objectives: [
    { id: "vlan", text: "Create VLAN 10 named SALES on SW1", check: (s) => s.devices.SW1.vlans[10] === "SALES" },
    {
      id: "access",
      text: "Make Fa0/1 and Fa0/2 access ports in VLAN 10",
      check: (s) => accessIn(s, "FastEthernet0/1", 10) && accessIn(s, "FastEthernet0/2", 10),
    },
    { id: "uplink", text: "Put the router uplink Gi0/1 in VLAN 10 (access)", check: (s) => accessIn(s, "GigabitEthernet0/1", 10) },
    {
      id: "ping",
      text: "Both Sales PCs reach the gateway 192.168.10.1 through VLAN 10",
      check: (s) =>
        accessIn(s, "FastEthernet0/1", 10) && accessIn(s, "FastEthernet0/2", 10) && ping(s, "PC1", GW).ok && ping(s, "PC2", GW).ok,
    },
    {
      id: "guest",
      text: "Guest PC on Fa0/3 stays isolated in VLAN 1 (cannot reach the gateway)",
      check: (s) => accessIn(s, "GigabitEthernet0/1", 10) && !ping(s, "PC3", GW).ok && s.devices.SW1.interfaces["FastEthernet0/3"].switchport!.accessVlan === 1,
    },
    {
      id: "mgmt",
      text: "SW1 management: interface Vlan10 192.168.10.2/24 up, default gateway 192.168.10.1",
      check: (s) => {
        const svi = s.devices.SW1.interfaces["Vlan10"];
        return !!svi && svi.ip === MGMT && svi.mask === MASK && ifaceState(s, "SW1", "Vlan10").protocol === "up" && s.devices.SW1.defaultGateway === GW;
      },
    },
  ],
  hints: [
    "On SW1: 'en', 'conf t', then 'vlan 10' and 'name SALES'. Check later with 'do show vlan brief'.",
    "For each Sales port: 'int fa0/1', 'switchport mode access', 'switchport access vlan 10' (short: 'sw mode acc', 'sw acc vlan 10'). Repeat for fa0/2.",
    "The router is plugged into Gi0/1. Until that port joins VLAN 10, Sales has no path to 192.168.10.1. Leave fa0/3 alone so the guest stays in VLAN 1.",
    "Management: 'int vlan 10', 'ip add 192.168.10.2 255.255.255.0', 'no shut', 'exit', then 'ip default-gateway 192.168.10.1'.",
  ],
  engine: ciscoEngine,
};
