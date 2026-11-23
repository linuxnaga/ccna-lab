import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, ifaceState, parseIp, ping, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "R1", label: "R1", kind: "router" as const, x: 500, y: 110, labelPos: "above" as const },
    { id: "PC1", label: "ENG-PC", kind: "pc" as const, x: 190, y: 470 },
    { id: "PC2", label: "SALES-PC", kind: "pc" as const, x: 500, y: 470 },
    { id: "PC3", label: "MGMT-PC", kind: "pc" as const, x: 810, y: 470 },
  ],
  links: [
    { id: "r1-pc1", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "r1-pc2", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "PC2", port: "Ethernet0" } },
    { id: "r1-pc3", a: { device: "R1", port: "GigabitEthernet0/2" }, b: { device: "PC3", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;

/** The VLSM plan for 10.10.10.0/24, largest subnet first. */
const PLAN = [
  { iface: "GigabitEthernet0/0", pc: "PC1", gw: "10.10.10.1", host: "10.10.10.126", mask: "255.255.255.128" }, // /25, 100 hosts
  { iface: "GigabitEthernet0/1", pc: "PC2", gw: "10.10.10.129", host: "10.10.10.190", mask: "255.255.255.192" }, // /26, 50 hosts
  { iface: "GigabitEthernet0/2", pc: "PC3", gw: "10.10.10.193", host: "10.10.10.222", mask: "255.255.255.224" }, // /27, 20 hosts
];

const routerOk = (s: CiscoState, n: number) => {
  const p = PLAN[n];
  const i = s.devices.R1.interfaces[p.iface];
  return i.ip === ip(p.gw) && i.mask === ip(p.mask) && ifaceState(s, "R1", p.iface).protocol === "up";
};

const pcOk = (s: CiscoState, n: number) => {
  const p = PLAN[n];
  const pc = s.devices[p.pc];
  const e = pc.interfaces.Ethernet0;
  return e.ip === ip(p.host) && e.mask === ip(p.mask) && pc.defaultGateway === ip(p.gw);
};

export const subnetVlsmLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "subnet-vlsm",
  title: "Carve Up the /24",
  startDevice: "R1",
  briefing: [
    "Facilities just handed you a single block, 10.10.10.0/24, for three new departments on one router: Engineering needs 100 hosts, Sales needs 50, and Management needs 20.",
    "Use VLSM: give the biggest department the first block, then pack the others right after it, each using the smallest subnet that fits. The router takes the first usable address in each subnet and each department PC takes the last usable one.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.R1.hostname = "R1";
    }),
  objectives: [
    { id: "eng", text: "Engineering (100 hosts): R1 Gi0/0 gets the first usable address of a subnet starting at 10.10.10.0, up/up", check: (s) => routerOk(s, 0) },
    { id: "sales", text: "Sales (50 hosts): R1 Gi0/1 gets the first usable address of the next free block, up/up", check: (s) => routerOk(s, 1) },
    { id: "mgmt", text: "Management (20 hosts): R1 Gi0/2 gets the first usable address of the block after that, up/up", check: (s) => routerOk(s, 2) },
    { id: "eng-pc", text: "ENG-PC uses the last usable address in its subnet, with R1 as its gateway", check: (s) => pcOk(s, 0) },
    { id: "sales-pc", text: "SALES-PC uses the last usable address in its subnet, with R1 as its gateway", check: (s) => pcOk(s, 1) },
    { id: "mgmt-pc", text: "MGMT-PC uses the last usable address in its subnet, with R1 as its gateway", check: (s) => pcOk(s, 2) },
    {
      id: "e2e",
      text: "ENG-PC can ping both SALES-PC and MGMT-PC",
      check: (s) => pcOk(s, 1) && pcOk(s, 2) && ping(s, "PC1", ip(PLAN[1].host)).ok && ping(s, "PC1", ip(PLAN[2].host)).ok,
    },
  ],
  hints: [
    "Hosts needed + 2 (network and broadcast) must fit in 2^h addresses. 100 hosts needs 7 host bits (126 usable): a /25, mask 255.255.255.128. 50 needs a /26 (62 usable), 20 needs a /27 (30 usable).",
    "Engineering is 10.10.10.0/25 (.0 to .127). Sales starts right after it at 10.10.10.128/26 (.128 to .191). Management starts at 10.10.10.192/27 (.192 to .223).",
    "On R1: 'int g0/0', 'ip add 10.10.10.1 255.255.255.128', 'no shut'. Then g0/1 gets 10.10.10.129 255.255.255.192 and g0/2 gets 10.10.10.193 255.255.255.224.",
    "Click each PC and use 'ipconfig <ip> <mask> <gateway>'. The last usable host is one below the broadcast: ENG-PC is 10.10.10.126, SALES-PC 10.10.10.190, MGMT-PC 10.10.10.222.",
  ],
  engine: ciscoEngine,
};
