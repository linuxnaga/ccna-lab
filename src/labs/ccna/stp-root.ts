import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, parseIp, ping, spanningTreeAll, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "SW1", label: "CORE", kind: "switch" as const, x: 500, y: 90, labelPos: "above" as const },
    { id: "SW2", label: "ACC1", kind: "switch" as const, x: 230, y: 320 },
    { id: "SW3", label: "ACC2", kind: "switch" as const, x: 770, y: 320, labelPos: "above" as const },
    { id: "PC1", label: "ENG-1", kind: "pc" as const, x: 230, y: 520 },
    { id: "PC2", label: "ENG-2", kind: "pc" as const, x: 770, y: 520 },
  ],
  links: [
    { id: "core-acc1", a: { device: "SW1", port: "GigabitEthernet0/1" }, b: { device: "SW2", port: "GigabitEthernet0/1" } },
    { id: "core-acc2", a: { device: "SW1", port: "GigabitEthernet0/2" }, b: { device: "SW3", port: "GigabitEthernet0/1" } },
    { id: "acc1-acc2", a: { device: "SW2", port: "GigabitEthernet0/2" }, b: { device: "SW3", port: "GigabitEthernet0/2" } },
    { id: "acc1-pc1", a: { device: "SW2", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "acc2-pc2", a: { device: "SW3", port: "FastEthernet0/1" }, b: { device: "PC2", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const MASK = ip("255.255.255.0");
const SWITCHES = ["SW1", "SW2", "SW3"];

const coreIsRoot = (s: CiscoState) => {
  const t = spanningTreeAll(s, 10);
  return SWITCHES.every((sw) => t[sw]?.rootDevice === "SW1");
};

const edgePort = (s: CiscoState, sw: string) => {
  const sp = s.devices[sw].interfaces["FastEthernet0/1"].switchport!;
  return !!sp.portfast && !!sp.bpduguard;
};

export const stpRootLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "stp-root",
  title: "The Wrong Root Bridge",
  startDevice: "SW3",
  briefing: [
    "Engineering's two floor switches hang off a new core switch in a triangle, so there is a redundant path. Since the install, ENG-2 has been offline, and the NOC noticed spanning tree elected an old access switch as root because it has the lowest MAC address.",
    "Someone deleted VLAN 10 on ACC2 and its uplink to CORE never became a trunk. Fix that, make CORE the root bridge for VLAN 10 so the redundant link blocks at the access layer, move every switch to Rapid PVST+, and protect the PC ports with PortFast and BPDU Guard.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.SW1.hostname = "CORE";
      d.SW2.hostname = "ACC1";
      d.SW3.hostname = "ACC2";
      // ACC1 has the lowest MAC, so it wins the root election on default priorities.
      d.SW1.mac = "0060.7B33.0C03";
      d.SW2.mac = "0001.4A11.0A01";
      d.SW3.mac = "0001.4A22.0B02";
      for (const sw of SWITCHES) d[sw].vlans[10] = "ENG";
      delete d.SW3.vlans[10];
      const trunk = (sw: string, port: string) => (d[sw].interfaces[port].switchport!.mode = "trunk");
      trunk("SW1", "GigabitEthernet0/1");
      trunk("SW1", "GigabitEthernet0/2");
      trunk("SW2", "GigabitEthernet0/1");
      trunk("SW2", "GigabitEthernet0/2");
      trunk("SW3", "GigabitEthernet0/2");
      for (const sw of ["SW2", "SW3"]) Object.assign(d[sw].interfaces["FastEthernet0/1"].switchport!, { mode: "access", accessVlan: 10 });
      Object.assign(d.PC1.interfaces.Ethernet0, { ip: ip("10.1.10.11"), mask: MASK });
      Object.assign(d.PC2.interfaces.Ethernet0, { ip: ip("10.1.10.12"), mask: MASK });
      d.PC1.defaultGateway = ip("10.1.10.1");
      d.PC2.defaultGateway = ip("10.1.10.1");
    }),
  objectives: [
    { id: "vlan", text: "ACC2 has VLAN 10 named ENG again", check: (s) => s.devices.SW3.vlans[10] === "ENG" },
    {
      id: "trunk",
      text: "ACC2 Gi0/1 (the uplink to CORE) is an 802.1Q trunk",
      check: (s) => s.devices.SW3.interfaces["GigabitEthernet0/1"].switchport!.mode === "trunk",
    },
    { id: "root", text: "CORE is the root bridge for VLAN 10 on all three switches", check: coreIsRoot },
    {
      id: "block",
      text: "The redundant ACC1-ACC2 link blocks on one end in VLAN 10, and both core uplinks forward",
      check: (s) => {
        if (!coreIsRoot(s)) return false;
        const t = spanningTreeAll(s, 10);
        const role = (sw: string, port: string) => t[sw]?.ports.find((p) => p.iface === port)?.state;
        const blocked = [role("SW2", "GigabitEthernet0/2"), role("SW3", "GigabitEthernet0/2")].filter((x) => x === "BLK").length;
        return blocked === 1 && role("SW2", "GigabitEthernet0/1") === "FWD" && role("SW3", "GigabitEthernet0/1") === "FWD";
      },
    },
    { id: "rapid", text: "All three switches run Rapid PVST+", check: (s) => SWITCHES.every((sw) => s.devices[sw].stp.mode === "rapid-pvst") },
    { id: "edge", text: "PortFast and BPDU Guard on the PC ports (Fa0/1 on ACC1 and ACC2)", check: (s) => edgePort(s, "SW2") && edgePort(s, "SW3") },
    { id: "ping", text: "ENG-1 can ping ENG-2 (10.1.10.12)", check: (s) => ping(s, "PC1", ip("10.1.10.12")).ok },
  ],
  hints: [
    "Start on ACC2: 'show vlan brief' shows VLAN 10 is missing. In config mode: 'vlan 10', 'name ENG'. Then 'int g0/1', 'switchport mode trunk'.",
    "Run 'show spanning-tree vlan 10' on any switch. The root is the lowest bridge ID: priority first, then MAC. All three use the default 32768, so the lowest MAC (ACC1) wins.",
    "On CORE: 'spanning-tree vlan 10 root primary' (or 'spanning-tree vlan 10 priority 24576'). Re-check 'show spanning-tree vlan 10' on ACC2: one Gi0/2 should now be Altn BLK.",
    "On every switch: 'spanning-tree mode rapid-pvst'. On ACC1 and ACC2: 'int fa0/1', 'spanning-tree portfast', 'spanning-tree bpduguard enable'.",
  ],
  engine: ciscoEngine,
};
