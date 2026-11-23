import type { LabDefinition } from "@/engine/types";
import { aclPermits, buildState, ciscoEngine, parseIp, ping, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "R1", label: "CORE-R", kind: "router" as const, x: 500, y: 130, labelPos: "above" as const },
    { id: "PC1", label: "STAFF-PC", kind: "pc" as const, x: 190, y: 470 },
    { id: "PC2", label: "GUEST-PC", kind: "pc" as const, x: 500, y: 470 },
    { id: "SRV", label: "FILE-SRV", kind: "server" as const, x: 810, y: 470 },
  ],
  links: [
    { id: "r1-staff", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "r1-guest", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "PC2", port: "Ethernet0" } },
    { id: "r1-srv", a: { device: "R1", port: "GigabitEthernet0/2" }, b: { device: "SRV", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const LAN = ip("255.255.255.0");
const STAFF_PC = ip("192.168.10.10");
const GUEST_PC = ip("192.168.30.10");
const SERVER = ip("192.168.99.10");

const r1 = (s: CiscoState) => s.devices.R1;
const iface = (s: CiscoState, n: string) => r1(s).interfaces[n];

export const aclHardeningLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "acl-hardening",
  title: "Lock Down the Server Farm",
  startDevice: "R1",
  briefing: [
    "An audit found that the guest Wi-Fi subnet can reach the file server and the staff LAN, and that the core router still allows plain-text Telnet with no passwords at all.",
    "Filter traffic with a standard ACL close to the servers and an extended ACL close to the guests, then harden the router: an encrypted enable secret, a console password, and SSH-only remote access with a local admin account.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.R1.hostname = "CORE-R";
      const lans: [string, string, string, string, string][] = [
        ["GigabitEthernet0/0", "192.168.10.1", "PC1", "192.168.10.10", "STAFF"],
        ["GigabitEthernet0/1", "192.168.30.1", "PC2", "192.168.30.10", "GUEST"],
        ["GigabitEthernet0/2", "192.168.99.1", "SRV", "192.168.99.10", "SERVERS"],
      ];
      for (const [port, gw, host, addr, desc] of lans) {
        Object.assign(d.R1.interfaces[port], { ip: ip(gw), mask: LAN, shutdown: false, description: desc });
        Object.assign(d[host].interfaces.Ethernet0, { ip: ip(addr), mask: LAN });
        d[host].defaultGateway = ip(gw);
      }
    }),
  objectives: [
    {
      id: "std-acl",
      text: "Standard ACL 10 denies the guest subnet 192.168.30.0/24 and permits everyone else",
      check: (s) => {
        const pkt = (src: number) => ({ src, dst: SERVER, proto: "icmp" as const });
        return !!r1(s).acls["10"]?.length && !aclPermits(r1(s), "10", pkt(GUEST_PC)) && aclPermits(r1(s), "10", pkt(STAFF_PC));
      },
    },
    { id: "std-apply", text: "ACL 10 is applied outbound on Gi0/2, the interface closest to the servers", check: (s) => iface(s, "GigabitEthernet0/2").acl?.out === "10" },
    {
      id: "ext-acl",
      text: "Extended ACL 110 inbound on Gi0/1 blocks guests from the staff LAN but still lets them reach their gateway",
      check: (s) => iface(s, "GigabitEthernet0/1").acl?.in === "110" && !!r1(s).acls["110"]?.length && !ping(s, "PC2", STAFF_PC).ok && ping(s, "PC2", ip("192.168.30.1")).ok,
    },
    {
      id: "verify",
      text: "GUEST-PC cannot reach FILE-SRV, while STAFF-PC still can",
      check: (s) => !ping(s, "PC2", SERVER).ok && ping(s, "PC1", SERVER).ok,
    },
    {
      id: "secrets",
      text: "Enable secret is set, service password-encryption is on, and the console needs a password (login)",
      check: (s) => {
        const sec = r1(s).security;
        return !!sec.enableSecret && sec.passwordEncryption && !!sec.lines.con.password && sec.lines.con.login === "line";
      },
    },
    {
      id: "ssh-keys",
      text: "SSH is ready: domain name set, RSA keys of 1024 bits or more, SSH version 2, and a local user",
      check: (s) => {
        const sec = r1(s).security;
        return !!sec.domainName && (sec.rsaBits ?? 0) >= 1024 && sec.sshVersion === 2 && Object.keys(sec.users).length > 0;
      },
    },
    {
      id: "vty",
      text: "VTY lines accept SSH only and log in with the local user database",
      check: (s) => {
        const vty = r1(s).security.lines.vty;
        return vty.transport === "ssh" && vty.login === "local";
      },
    },
  ],
  hints: [
    "Standard ACLs only match the source, so place them near the destination: 'access-list 10 deny 192.168.30.0 0.0.0.255', 'access-list 10 permit any', then 'int g0/2' and 'ip access-group 10 out'.",
    "Extended ACLs match source and destination, so place them near the source: 'access-list 110 deny ip 192.168.30.0 0.0.0.255 192.168.10.0 0.0.0.255', 'access-list 110 permit ip any any', then 'int g0/1' and 'ip access-group 110 in'. Without the permit, the implicit deny blocks everything.",
    "Hardening: 'enable secret Cl4ss!fied', 'service password-encryption', 'line con 0', 'password C0ns0le', 'login'. Check 'show running-config' to see the passwords encrypted.",
    "SSH: 'ip domain-name lab.local', 'crypto key generate rsa general-keys modulus 1024', 'ip ssh version 2', 'username admin secret Adm1n!', then 'line vty 0 4', 'login local', 'transport input ssh'.",
  ],
  engine: ciscoEngine,
};
