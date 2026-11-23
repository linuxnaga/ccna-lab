import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, eui64, ifaceState, parseIp6, ping6, type CiscoState } from "@/engine/cisco";
import { linkLocal } from "@/engine/cisco/ip6";

const topology = {
  devices: [
    { id: "PC1", label: "HQ-PC", kind: "pc" as const, x: 110, y: 300 },
    { id: "R1", label: "HQ", kind: "router" as const, x: 360, y: 300, labelPos: "above" as const },
    { id: "R2", label: "BRANCH", kind: "router" as const, x: 640, y: 300, labelPos: "above" as const },
    { id: "PC2", label: "BR-PC", kind: "pc" as const, x: 890, y: 300 },
  ],
  links: [
    { id: "pc1-r1", a: { device: "PC1", port: "Ethernet0" }, b: { device: "R1", port: "GigabitEthernet0/0" } },
    { id: "r1-r2", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "R2", port: "GigabitEthernet0/1" } },
    { id: "r2-pc2", a: { device: "R2", port: "GigabitEthernet0/0" }, b: { device: "PC2", port: "Ethernet0" } },
  ],
};

const v6 = (s: string) => parseIp6(s)!;
const BR_LAN = v6("2001:db8:acad:2::");

const hasAddr = (s: CiscoState, dev: string, iface: string, a: string) =>
  !!s.devices[dev].interfaces[iface].ipv6?.some((x) => x.addr === v6(a) && x.prefix === 64) && ifaceState(s, dev, iface).protocol === "up";

const brPcAddr = (s: CiscoState) => s.devices.PC2.interfaces.Ethernet0.ipv6?.[0];

export const ipv6RoutingLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "ipv6-routing",
  title: "IPv6 Comes to the Branch",
  startDevice: "R2",
  briefing: [
    "The company is rolling out IPv6 with the block 2001:DB8:ACAD::/48. HQ is already dual-stacked and routing IPv6; the branch router is still IPv4-only and the branch PC has no IPv6 address.",
    "Turn on IPv6 routing at the branch, address its interfaces, let BR-PC build its own address with SLAAC (EUI-64), and add static routes so the two sites can reach each other over IPv6.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.R1.hostname = "HQ";
      d.R1.ipv6Routing = true;
      Object.assign(d.R1.interfaces["GigabitEthernet0/0"], { shutdown: false, description: "HQ LAN", ipv6: [{ addr: v6("2001:db8:acad:1::1"), prefix: 64 }] });
      Object.assign(d.R1.interfaces["GigabitEthernet0/1"], { shutdown: false, description: "WAN to BRANCH", ipv6: [{ addr: v6("2001:db8:acad:12::1"), prefix: 64 }] });
      d.R2.hostname = "BRANCH";
      d.PC1.interfaces.Ethernet0.ipv6 = [{ addr: v6("2001:db8:acad:1::10"), prefix: 64 }];
      d.PC1.gateway6 = v6("2001:db8:acad:1::1");
    }),
  objectives: [
    { id: "routing", text: "BRANCH has IPv6 unicast routing enabled", check: (s) => s.devices.R2.ipv6Routing },
    {
      id: "addr",
      text: "BRANCH Gi0/0 is 2001:DB8:ACAD:2::1/64 and Gi0/1 is 2001:DB8:ACAD:12::2/64, both up",
      check: (s) => hasAddr(s, "R2", "GigabitEthernet0/0", "2001:db8:acad:2::1") && hasAddr(s, "R2", "GigabitEthernet0/1", "2001:db8:acad:12::2"),
    },
    {
      id: "slaac",
      text: "BR-PC builds its address with SLAAC: the branch /64 prefix plus its EUI-64 interface ID",
      check: (s) => {
        const a = brPcAddr(s);
        return !!a && a.prefix === 64 && a.addr === (BR_LAN | eui64(s.devices.PC2.mac)) && s.devices.PC2.gateway6 === linkLocal(s.devices.R2.mac);
      },
    },
    {
      id: "br-default",
      text: "BRANCH has a default route ::/0 via HQ (2001:DB8:ACAD:12::1)",
      check: (s) => s.devices.R2.staticRoutes6.some((r) => r.prefix === 0 && r.nextHop === v6("2001:db8:acad:12::1")),
    },
    {
      id: "hq-route",
      text: "HQ has a static route to 2001:DB8:ACAD:2::/64 via BRANCH (2001:DB8:ACAD:12::2)",
      check: (s) => s.devices.R1.staticRoutes6.some((r) => r.net === BR_LAN && r.prefix === 64 && r.nextHop === v6("2001:db8:acad:12::2")),
    },
    {
      id: "e2e",
      text: "HQ-PC can ping BR-PC's IPv6 address",
      check: (s) => {
        const a = brPcAddr(s);
        return !!a && ping6(s, "PC1", a.addr).ok;
      },
    },
  ],
  hints: [
    "On BRANCH: 'ipv6 unicast-routing' turns the router into an IPv6 router. Without it the router will not forward IPv6 or send router advertisements.",
    "'int g0/0', 'ipv6 address 2001:db8:acad:2::1/64', 'no shutdown'. Then 'int g0/1', 'ipv6 address 2001:db8:acad:12::2/64', 'no shutdown'. Check with 'show ipv6 interface brief'.",
    "Click BR-PC and run 'ipv6config autoconfig'. It takes the /64 prefix from BRANCH and builds the host part from its MAC (EUI-64: FFFE inserted in the middle, 7th bit flipped). Its gateway is BRANCH's link-local address.",
    "Routes: on BRANCH 'ipv6 route ::/0 2001:db8:acad:12::1'. On HQ 'ipv6 route 2001:db8:acad:2::/64 2001:db8:acad:12::2'. Then ping BR-PC's address from HQ-PC (see it with 'ipv6config').",
  ],
  engine: ciscoEngine,
};
