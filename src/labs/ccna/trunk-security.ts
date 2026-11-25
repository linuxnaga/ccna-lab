import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, nativeMismatch, parseIp, ping, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "SW1", label: "FLOOR1-SW", kind: "switch" as const, x: 280, y: 200, labelPos: "above" as const },
    { id: "SW2", label: "FLOOR2-SW", kind: "switch" as const, x: 720, y: 200, labelPos: "above" as const },
    { id: "PC1", label: "F1-STAFF", kind: "pc" as const, x: 160, y: 470 },
    { id: "PC2", label: "F1-CAM", kind: "pc" as const, x: 400, y: 470 },
    { id: "PC3", label: "F2-STAFF", kind: "pc" as const, x: 600, y: 470 },
    { id: "PC4", label: "F2-CAM", kind: "pc" as const, x: 840, y: 470 },
  ],
  links: [
    { id: "sw1-sw2", a: { device: "SW1", port: "GigabitEthernet0/1" }, b: { device: "SW2", port: "GigabitEthernet0/1" } },
    { id: "sw1-pc1", a: { device: "SW1", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "sw1-pc2", a: { device: "SW1", port: "FastEthernet0/2" }, b: { device: "PC2", port: "Ethernet0" } },
    { id: "sw2-pc3", a: { device: "SW2", port: "FastEthernet0/1" }, b: { device: "PC3", port: "Ethernet0" } },
    { id: "sw2-pc4", a: { device: "SW2", port: "FastEthernet0/2" }, b: { device: "PC4", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const LAN = ip("255.255.255.0");
const UPLINK = "GigabitEthernet0/1";
const SWITCHES = ["SW1", "SW2"] as const;
const sp = (s: CiscoState, sw: string) => s.devices[sw].interfaces[UPLINK].switchport!;

export const trunkSecurityLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "trunk-security",
  title: "Seal the Trunk",
  startDevice: "SW2",
  briefing: [
    "Since last night's change window, staff and security cameras on floor 2 cannot reach their colleagues on floor 1. The uplink between the floor switches is meant to be an 802.1Q trunk, but FLOOR1-SW was left negotiating with DTP and someone set FLOOR2-SW's end as an access port.",
    "The security team also wants the trunk hardened against VLAN hopping: static trunking with DTP turned off, an unused native VLAN 999 instead of VLAN 1, and only the VLANs that need to cross carried on the link. VLAN 30 (the test lab) stays local to each floor.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      const hosts: [string, string, string, number, string][] = [
        ["SW1", "FastEthernet0/1", "PC1", 10, "192.168.10.11"],
        ["SW1", "FastEthernet0/2", "PC2", 20, "192.168.20.11"],
        ["SW2", "FastEthernet0/1", "PC3", 10, "192.168.10.12"],
        ["SW2", "FastEthernet0/2", "PC4", 20, "192.168.20.12"],
      ];
      d.SW1.hostname = "FLOOR1-SW";
      d.SW2.hostname = "FLOOR2-SW";
      for (const sw of SWITCHES) Object.assign(d[sw].vlans, { 10: "STAFF", 20: "CAMERAS", 30: "TESTLAB" });
      for (const [sw, port, pc, vlan, addr] of hosts) {
        d[sw].interfaces[port].switchport = { mode: "access", accessVlan: vlan, portfast: true };
        Object.assign(d[pc].interfaces.Ethernet0, { ip: ip(addr), mask: LAN });
      }
      d.SW1.interfaces[UPLINK].switchport = { mode: "desirable", accessVlan: 1 };
      d.SW1.interfaces[UPLINK].description = "to FLOOR2-SW";
      d.SW2.interfaces[UPLINK].switchport = { mode: "access", accessVlan: 1 };
      d.SW2.interfaces[UPLINK].description = "to FLOOR1-SW";
    }),
  objectives: [
    {
      id: "static",
      text: "Both ends of the uplink are static trunks with DTP off (mode trunk + nonegotiate)",
      check: (s) => SWITCHES.every((sw) => sp(s, sw).mode === "trunk" && !!sp(s, sw).nonegotiate),
    },
    {
      id: "native",
      text: "VLAN 999 exists on both switches and is the native VLAN on both ends, with no mismatch",
      check: (s) =>
        SWITCHES.every((sw) => 999 in s.devices[sw].vlans && sp(s, sw).nativeVlan === 999) && !nativeMismatch(s, "SW1", UPLINK),
    },
    {
      id: "allowed",
      text: "The trunk carries only VLANs 10, 20 and 999 on both ends",
      check: (s) => SWITCHES.every((sw) => sp(s, sw).allowedVlans?.join(",") === "10,20,999"),
    },
    { id: "staff", text: "F1-STAFF can ping F2-STAFF across the trunk (VLAN 10)", check: (s) => ping(s, "PC1", ip("192.168.10.12")).ok },
    { id: "cams", text: "F1-CAM can ping F2-CAM across the trunk (VLAN 20)", check: (s) => ping(s, "PC2", ip("192.168.20.12")).ok },
  ],
  hints: [
    "Run 'show interfaces g0/1 switchport' on both switches and compare Administrative and Operational Mode. On each: 'int g0/1', 'switchport mode trunk', 'switchport nonegotiate'.",
    "Create an unused VLAN on both switches: 'vlan 999', 'name NATIVE-BH'. Then on each trunk end 'switchport trunk native vlan 999'. Until both ends match, CDP logs a native VLAN mismatch.",
    "Prune the trunk to what must cross: 'switchport trunk allowed vlan 10,20,999' on both ends. 'show interfaces trunk' shows the native VLAN and the allowed list.",
    "Test with 'ping 192.168.10.12' from F1-STAFF and 'ping 192.168.20.12' from F1-CAM.",
  ],
  engine: ciscoEngine,
};
