import type { LabDefinition } from "@/engine/types";
import { aclPermits, buildState, ciscoEngine, parseIp, ping, tcpConnect, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "R1", label: "EDGE", kind: "router" as const, x: 500, y: 250, labelPos: "left" as const },
    { id: "NET", label: "REMOTE-NOC", kind: "pc" as const, x: 820, y: 90 },
    { id: "PC1", label: "STAFF-PC", kind: "pc" as const, x: 180, y: 480 },
    { id: "WEB", label: "WEB-DMZ", kind: "server" as const, x: 820, y: 470 },
  ],
  links: [
    { id: "r1-staff", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "r1-dmz", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "WEB", port: "Ethernet0" } },
    { id: "r1-net", a: { device: "R1", port: "GigabitEthernet0/2" }, b: { device: "NET", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const LAN = ip("255.255.255.0");
const WEB = ip("172.16.1.10");
const OTHER_INTERNET_HOST = ip("198.51.100.77");
const r1 = (s: CiscoState) => s.devices.R1;
const any = { ip: 0, wildcard: 0xffffffff };
const host = (a: number) => ({ ip: a, wildcard: 0 });

const dmzIn = (s: CiscoState) => r1(s).namedAcls["DMZ-IN"] === "extended" && r1(s).interfaces["GigabitEthernet0/2"].acl?.in === "DMZ-IN";
const staffIn = (s: CiscoState) => r1(s).namedAcls["STAFF-IN"] === "extended" && r1(s).interfaces["GigabitEthernet0/0"].acl?.in === "STAFF-IN";
const tcp = (s: CiscoState, from: string, port: number) => tcpConnect(s, from, WEB, port);

export const namedAclLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "named-acl",
  title: "Tighten the DMZ Firewall",
  startDevice: "R1",
  briefing: [
    "The public web server in the DMZ has moved to HTTPS, and customers now get a timeout. Worse, last week's quick fix to the edge router's named ACL DMZ-IN opened Telnet from the whole Internet. Only the remote NOC at 198.51.100.50 should be able to ping the server.",
    "Edit DMZ-IN in place using its sequence numbers, without rebuilding it. Then write a second named ACL, STAFF-IN, so the staff LAN can no longer Telnet to the server in clear text, while SSH, web and ping keep working.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.R1.hostname = "EDGE";
      const lans: [string, string, string, string, string][] = [
        ["GigabitEthernet0/0", "192.168.10.1", "PC1", "192.168.10.10", "STAFF"],
        ["GigabitEthernet0/1", "172.16.1.1", "WEB", "172.16.1.10", "DMZ"],
        ["GigabitEthernet0/2", "198.51.100.1", "NET", "198.51.100.50", "INTERNET"],
      ];
      for (const [port, gw, h, addr, desc] of lans) {
        Object.assign(d.R1.interfaces[port], { ip: ip(gw), mask: LAN, shutdown: false, description: desc });
        Object.assign(d[h].interfaces.Ethernet0, { ip: ip(addr), mask: LAN });
        d[h].defaultGateway = ip(gw);
      }
      d.WEB.services = { tcp: [22, 23, 80, 443] };
      d.R1.namedAcls["DMZ-IN"] = "extended";
      d.R1.acls["DMZ-IN"] = [
        { seq: 10, action: "permit", proto: "tcp", src: any, dst: host(WEB), port: 80 },
        { seq: 20, action: "permit", proto: "tcp", src: any, dst: any, port: 23 },
        { seq: 30, action: "deny", proto: "ip", src: any, dst: any },
      ];
      d.R1.interfaces["GigabitEthernet0/2"].acl = { in: "DMZ-IN" };
    }),
  objectives: [
    {
      id: "https",
      text: "Internet users reach WEB-DMZ over HTTP and HTTPS (TCP 80 and 443), with DMZ-IN still applied inbound on Gi0/2",
      check: (s) => dmzIn(s) && tcp(s, "NET", 80) === "open" && tcp(s, "NET", 443) === "open",
    },
    {
      id: "telnet",
      text: "Telnet and SSH from the Internet to WEB-DMZ are filtered by DMZ-IN",
      check: (s) => dmzIn(s) && tcp(s, "NET", 23) === "filtered" && tcp(s, "NET", 22) === "filtered",
    },
    {
      id: "icmp",
      text: "Only the NOC host 198.51.100.50 can ping WEB-DMZ from the Internet; other Internet hosts cannot",
      check: (s) => dmzIn(s) && ping(s, "NET", WEB).ok && !aclPermits(r1(s), "DMZ-IN", { src: OTHER_INTERNET_HOST, dst: WEB, proto: "icmp" }),
    },
    {
      id: "staff-telnet",
      text: "Named extended ACL STAFF-IN, inbound on Gi0/0, blocks Telnet from the staff LAN to WEB-DMZ",
      check: (s) => staffIn(s) && tcp(s, "PC1", 23) === "filtered",
    },
    {
      id: "staff-ok",
      text: "With STAFF-IN in place, staff can still SSH to, browse (HTTP and HTTPS) and ping WEB-DMZ",
      check: (s) => staffIn(s) && tcp(s, "PC1", 22) === "open" && tcp(s, "PC1", 80) === "open" && tcp(s, "PC1", 443) === "open" && ping(s, "PC1", WEB).ok,
    },
  ],
  hints: [
    "Run 'show access-lists' on EDGE: every entry in a named ACL has a sequence number. 'ip access-list extended DMZ-IN' then 'no 20' deletes just the Telnet line.",
    "New entries go in by sequence number, so you can slot them in ahead of the 'deny ip any any' at 30: '15 permit tcp any host 172.16.1.10 eq 443' and '25 permit icmp host 198.51.100.50 host 172.16.1.10'.",
    "Test from REMOTE-NOC: 'curl https://172.16.1.10', 'telnet 172.16.1.10' and 'ping 172.16.1.10'.",
    "For the staff: 'ip access-list extended STAFF-IN', 'deny tcp 192.168.10.0 0.0.0.255 host 172.16.1.10 eq telnet', 'permit ip any any', then 'int g0/0', 'ip access-group STAFF-IN in'. Test with 'ssh -l admin 172.16.1.10' from STAFF-PC.",
  ],
  engine: ciscoEngine,
};
