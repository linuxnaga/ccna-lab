import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, lldpNeighbors, ntpStatus, parseIp, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "R1", label: "BR-EDGE", kind: "router" as const, x: 480, y: 150, labelPos: "above" as const },
    { id: "R2", label: "PROVIDER-PE", kind: "router" as const, x: 800, y: 150, labelPos: "above" as const },
    { id: "SW1", label: "ACCESS-SW", kind: "switch" as const, x: 300, y: 330 },
    { id: "PC1", label: "BR-PC", kind: "pc" as const, x: 160, y: 500 },
    { id: "SRV", label: "NOC-SRV", kind: "server" as const, x: 800, y: 450 },
  ],
  links: [
    { id: "r1-r2", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "R2", port: "GigabitEthernet0/0" } },
    { id: "r1-sw1", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "GigabitEthernet0/1" } },
    { id: "sw1-pc1", a: { device: "SW1", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "r2-srv", a: { device: "R2", port: "GigabitEthernet0/1" }, b: { device: "SRV", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const LAN = ip("255.255.255.0");
const P2P = ip("255.255.255.252");
const NOC = ip("10.10.10.50");
const SWITCH_NAME = "BR-ACC-07";
const COMMUNITY = "N0c-R3ad";

const synced = (s: CiscoState, dev: string) => ntpStatus(s, dev)?.server === NOC;

export const deviceMgmtLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "device-mgmt",
  title: "Put the Branch on the NOC's Radar",
  startDevice: "R1",
  briefing: [
    "A new branch went live, but the network operations centre cannot see it: logs never arrive, the clocks drift so timestamps are useless, and the router still answers SNMP on the factory 'public' community with write access. Nobody even recorded which access switch is in the closet.",
    "Use CDP to identify the switch behind BR-EDGE and label the port, point both devices at the NOC server 10.10.10.50 for NTP, send BR-EDGE's syslog there, replace the SNMP community with a read-only one, stop CDP leaking details to the provider, and turn on LLDP for the new multi-vendor phones.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      const addr = (dev: string, iface: string, a: string, mask: number, desc?: string) =>
        Object.assign(d[dev].interfaces[iface], { ip: ip(a), mask, shutdown: false, ...(desc ? { description: desc } : {}) });
      d.R1.hostname = "BR-EDGE";
      addr("R1", "GigabitEthernet0/0", "192.168.50.1", LAN);
      addr("R1", "GigabitEthernet0/1", "100.64.0.2", P2P, "Provider uplink");
      d.R1.staticRoutes.push({ net: 0, mask: 0, nextHop: ip("100.64.0.1") });
      d.R1.mgmt.snmp = [{ name: "public", access: "rw" }];
      d.R2.hostname = "PROVIDER-PE";
      addr("R2", "GigabitEthernet0/0", "100.64.0.1", P2P, "Customer branch");
      addr("R2", "GigabitEthernet0/1", "10.10.10.1", LAN, "Customer NOC");
      d.R2.staticRoutes.push({ net: ip("192.168.50.0"), mask: LAN, nextHop: ip("100.64.0.2") });
      d.SW1.hostname = SWITCH_NAME;
      d.SW1.interfaces.Vlan1 = { name: "Vlan1", ip: ip("192.168.50.2"), mask: LAN, shutdown: false };
      d.SW1.defaultGateway = ip("192.168.50.1");
      Object.assign(d.PC1.interfaces.Ethernet0, { ip: ip("192.168.50.10"), mask: LAN });
      d.PC1.defaultGateway = ip("192.168.50.1");
      Object.assign(d.SRV.interfaces.Ethernet0, { ip: NOC, mask: LAN });
      d.SRV.defaultGateway = ip("10.10.10.1");
      d.SRV.services = { tcp: [22], ntp: true };
    }),
  objectives: [
    {
      id: "cdp-label",
      text: "BR-EDGE Gi0/0's description names the switch CDP discovers on it",
      check: (s) => !!s.devices.R1.interfaces["GigabitEthernet0/0"].description?.toUpperCase().includes(SWITCH_NAME),
    },
    { id: "ntp", text: "BR-EDGE and the access switch are both synchronised to NTP server 10.10.10.50", check: (s) => synced(s, "R1") && synced(s, "SW1") },
    {
      id: "syslog",
      text: "BR-EDGE sends syslog to 10.10.10.50 at level warnings, with timestamps on its log messages",
      check: (s) => {
        const m = s.devices.R1.mgmt;
        return m.logHosts.includes(NOC) && m.logTrap === 4 && m.timestamps;
      },
    },
    {
      id: "snmp",
      text: `SNMP: the read-write 'public' community is gone and the NOC polls with read-only community ${COMMUNITY}`,
      check: (s) => {
        const c = s.devices.R1.mgmt.snmp;
        return c.some((x) => x.name === COMMUNITY && x.access === "ro") && !c.some((x) => x.access === "rw" || x.name === "public");
      },
    },
    {
      id: "cdp-wan",
      text: "CDP is off on the provider-facing Gi0/1 but still runs toward the LAN",
      check: (s) => {
        const r = s.devices.R1;
        return r.mgmt.cdp && r.interfaces["GigabitEthernet0/1"].cdp === false && r.interfaces["GigabitEthernet0/0"].cdp !== false;
      },
    },
    {
      id: "lldp",
      text: "LLDP runs on BR-EDGE and the access switch, and each lists the other as a neighbor",
      check: (s) => lldpNeighbors(s, "R1").some((n) => n.device.id === "SW1") && lldpNeighbors(s, "SW1").some((n) => n.device.id === "R1"),
    },
  ],
  hints: [
    "'show cdp neighbors' on BR-EDGE lists the device on each port (add 'detail' for its IP and software). Then 'int g0/0', 'description to BR-ACC-07 Gi0/1'.",
    "On BR-EDGE and on the switch: 'ntp server 10.10.10.50'. Check with 'show ntp status' and 'show clock' (a leading * means the time is not trusted).",
    "Syslog on BR-EDGE: 'logging host 10.10.10.50', 'logging trap warnings', 'service timestamps log datetime msec'. 'show logging' confirms it.",
    "SNMP: 'no snmp-server community public', then 'snmp-server community N0c-R3ad ro'. For CDP: 'int g0/1', 'no cdp enable'. LLDP is off by default: 'lldp run' on both devices, then 'show lldp neighbors'.",
  ],
  engine: ciscoEngine,
};
