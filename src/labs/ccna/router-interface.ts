import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, ifaceState, parseIp, ping, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "R1", label: "R1", kind: "router" as const, x: 500, y: 90 },
    { id: "SW1", label: "SW1", kind: "switch" as const, x: 500, y: 300 },
    { id: "PC1", label: "PC1", kind: "pc" as const, x: 260, y: 510 },
    { id: "PC2", label: "PC2", kind: "pc" as const, x: 740, y: 510 },
  ],
  links: [
    { id: "r1-sw1", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "GigabitEthernet0/1" } },
    { id: "sw1-pc1", a: { device: "SW1", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "sw1-pc2", a: { device: "SW1", port: "FastEthernet0/2" }, b: { device: "PC2", port: "Ethernet0" } },
  ],
};

const GW = parseIp("192.168.10.1")!;
const MASK = parseIp("255.255.255.0")!;

export const routerInterfaceLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "router-interface",
  title: "Branch Router Bring-up",
  startDevice: "R1",
  briefing: [
    "A new branch office opened this morning. The switch and PCs are cabled and the PCs already have their addresses, but the router came out of the box with a blank config.",
    "Name the router, give its LAN interface the gateway address 192.168.10.1/24, bring the interface up, and prove the PCs can reach their gateway. Save your work so it survives a reload.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.SW1.hostname = "SW1";
      for (const [pc, host] of [["PC1", "192.168.10.10"], ["PC2", "192.168.10.11"]] as const) {
        Object.assign(d[pc].interfaces.Ethernet0, { ip: parseIp(host), mask: MASK });
        d[pc].defaultGateway = GW;
      }
    }),
  objectives: [
    { id: "hostname", text: "Set R1's hostname to BRANCH-R1", check: (s) => s.devices.R1.hostname === "BRANCH-R1" },
    {
      id: "ip",
      text: "Configure 192.168.10.1/24 on R1 Gig0/0",
      check: (s) => {
        const i = s.devices.R1.interfaces["GigabitEthernet0/0"];
        return i.ip === GW && i.mask === MASK;
      },
    },
    {
      id: "up",
      text: "Enable R1 Gig0/0 (status up/up)",
      check: (s) => ifaceState(s, "R1", "GigabitEthernet0/0").protocol === "up",
    },
    { id: "ping", text: "PC1 can ping its gateway 192.168.10.1", check: (s) => ping(s, "PC1", GW).ok },
    { id: "save", text: "Save the running config to startup-config", check: (s) => s.devices.R1.saved && s.devices.R1.hostname === "BRANCH-R1" },
  ],
  hints: [
    "Start in R1's console: 'enable' then 'configure terminal' (or just 'en' and 'conf t').",
    "Rename with 'hostname BRANCH-R1'. Then enter the interface with 'interface g0/0'.",
    "In interface mode: 'ip address 192.168.10.1 255.255.255.0' then 'no shutdown'. Router ports are shut down by default.",
    "Type 'end', then 'copy running-config startup-config' (or 'wr'). Verify with 'show ip interface brief' and ping from PC1.",
  ],
  engine: ciscoEngine,
};
