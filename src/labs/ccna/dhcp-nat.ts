import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, parseIp, ping, type CiscoState } from "@/engine/cisco";
import { aclPermitsSource } from "@/engine/cisco/acl";

const topology = {
  devices: [
    { id: "R2", label: "ISP", kind: "router" as const, x: 820, y: 110, labelPos: "above" as const },
    { id: "R1", label: "EDGE", kind: "router" as const, x: 500, y: 110, labelPos: "above" as const },
    { id: "SW1", label: "SW1", kind: "switch" as const, x: 500, y: 320 },
    { id: "PC1", label: "STAFF-1", kind: "pc" as const, x: 200, y: 510 },
    { id: "PC2", label: "STAFF-2", kind: "pc" as const, x: 500, y: 510 },
    { id: "SRV", label: "WEB-SRV", kind: "server" as const, x: 800, y: 500 },
  ],
  links: [
    { id: "isp-edge", a: { device: "R2", port: "GigabitEthernet0/0" }, b: { device: "R1", port: "GigabitEthernet0/1" } },
    { id: "edge-sw1", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "GigabitEthernet0/1" } },
    { id: "sw1-pc1", a: { device: "SW1", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "sw1-pc2", a: { device: "SW1", port: "FastEthernet0/2" }, b: { device: "PC2", port: "Ethernet0" } },
    { id: "sw1-srv", a: { device: "SW1", port: "FastEthernet0/3" }, b: { device: "SRV", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const LAN = ip("255.255.255.0");
const WAN = ip("255.255.255.248");
const LAN_NET = ip("192.168.10.0");

const leased = (s: CiscoState, pc: string) => {
  const d = s.devices[pc];
  const e = d.interfaces.Ethernet0;
  return d.dhcpServer === "R1" && e.ip !== undefined && (e.ip & LAN) >>> 0 === LAN_NET && d.defaultGateway === ip("192.168.10.1");
};

const patRule = (s: CiscoState) => {
  const r1 = s.devices.R1;
  return r1.nat.rules.some(
    (r) => r.kind === "overload" && r.iface === "GigabitEthernet0/1" && aclPermitsSource(r1, r.acl, ip("192.168.10.50")) && !aclPermitsSource(r1, r.acl, ip("10.9.9.9")),
  );
};

export const dhcpNatLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "dhcp-nat",
  title: "Branch Internet Edge",
  startDevice: "R1",
  briefing: [
    "A small office is moving onto a business broadband line. The ISP gave you 203.0.113.0/29: they use .1, your EDGE router has .2, and the rest is yours. EDGE already has a default route to the ISP, but the staff PCs have no addresses and the ISP will never route 192.168.10.0/24 back to you.",
    "Make EDGE the DHCP server for the LAN, translate staff traffic to EDGE's public address with PAT (NAT overload), and publish the web server to the Internet on 203.0.113.5 with static NAT.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.R1.hostname = "EDGE";
      Object.assign(d.R1.interfaces["GigabitEthernet0/0"], { ip: ip("192.168.10.1"), mask: LAN, shutdown: false, description: "LAN" });
      Object.assign(d.R1.interfaces["GigabitEthernet0/1"], { ip: ip("203.0.113.2"), mask: WAN, shutdown: false, description: "ISP uplink" });
      d.R1.staticRoutes.push({ net: 0, mask: 0, nextHop: ip("203.0.113.1") });
      d.R2.hostname = "ISP";
      Object.assign(d.R2.interfaces["GigabitEthernet0/0"], { ip: ip("203.0.113.1"), mask: WAN, shutdown: false, description: "Customer EDGE" });
      d.R2.interfaces["Loopback0"] = { name: "Loopback0", ip: ip("8.8.8.8"), mask: 0xffffffff, shutdown: false, description: "Public DNS" };
      d.SW1.hostname = "SW1";
      Object.assign(d.SRV.interfaces.Ethernet0, { ip: ip("192.168.10.100"), mask: LAN });
      d.SRV.defaultGateway = ip("192.168.10.1");
    }),
  objectives: [
    {
      id: "exclude",
      text: "Reserve 192.168.10.1 - 192.168.10.20 for infrastructure (excluded from DHCP)",
      check: (s) => {
        const ex = s.devices.R1.dhcp.excluded;
        for (let a = ip("192.168.10.1"); a <= ip("192.168.10.20"); a++) if (!ex.some(([lo, hi]) => a >= lo && a <= hi)) return false;
        return true;
      },
    },
    {
      id: "pool",
      text: "DHCP pool for 192.168.10.0/24 with default-router 192.168.10.1 and dns-server 8.8.8.8",
      check: (s) =>
        Object.values(s.devices.R1.dhcp.pools).some((p) => p.net === LAN_NET && p.mask === LAN && p.defaultRouter === ip("192.168.10.1") && p.dns === ip("8.8.8.8")),
    },
    { id: "leases", text: "STAFF-1 and STAFF-2 get their addresses from EDGE by DHCP", check: (s) => leased(s, "PC1") && leased(s, "PC2") },
    {
      id: "nat-ifs",
      text: "EDGE Gi0/0 is the NAT inside interface and Gi0/1 is the NAT outside interface",
      check: (s) => s.devices.R1.interfaces["GigabitEthernet0/0"].nat === "inside" && s.devices.R1.interfaces["GigabitEthernet0/1"].nat === "outside",
    },
    { id: "pat", text: "PAT: an ACL matching 192.168.10.0/24 is overloaded onto Gi0/1's address", check: patRule },
    {
      id: "static",
      text: "Static NAT publishes WEB-SRV 192.168.10.100 as 203.0.113.5",
      check: (s) => s.devices.R1.nat.rules.some((r) => r.kind === "static" && r.local === ip("192.168.10.100") && r.global === ip("203.0.113.5")),
    },
    { id: "internet", text: "STAFF-1 can ping 8.8.8.8 on the Internet", check: (s) => leased(s, "PC1") && ping(s, "PC1", ip("8.8.8.8")).ok },
    { id: "publish", text: "The ISP router can ping the web server at 203.0.113.5", check: (s) => ping(s, "R2", ip("203.0.113.5")).ok },
  ],
  hints: [
    "DHCP on EDGE: 'ip dhcp excluded-address 192.168.10.1 192.168.10.20', then 'ip dhcp pool LAN', 'network 192.168.10.0 255.255.255.0', 'default-router 192.168.10.1', 'dns-server 8.8.8.8'.",
    "Click each staff PC and run 'ipconfig /dhcp'. Check the leases on EDGE with 'show ip dhcp binding'.",
    "Mark the interfaces: 'int g0/0' then 'ip nat inside', 'int g0/1' then 'ip nat outside'. Then 'access-list 1 permit 192.168.10.0 0.0.0.255' and 'ip nat inside source list 1 interface g0/1 overload'.",
    "Static NAT is one line: 'ip nat inside source static 192.168.10.100 203.0.113.5'. Ping 8.8.8.8 from STAFF-1, then check 'show ip nat translations' on EDGE.",
  ],
  engine: ciscoEngine,
};
