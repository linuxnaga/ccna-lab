import { describe, expect, it } from "vitest";
import { LABS } from "./index";
import { COURSES } from "@/lib/courses";

/** A known-good solution for each lab, typed the way a student would. */
const SOLUTIONS: Record<string, [string, string[]][]> = {
  "ccna/router-interface": [
    ["R1", ["en", "conf t", "hostname BRANCH-R1", "int g0/0", "ip add 192.168.10.1 255.255.255.0", "no shut", "end", "copy run start"]],
  ],
  "ccna/vlan-access": [
    ["SW1", [
      "en", "conf t", "vlan 10", "name SALES", "exit",
      "int fa0/1", "sw mode acc", "sw acc vlan 10",
      "int fa0/2", "sw mode acc", "sw acc vlan 10",
      "int g0/1", "sw mode acc", "sw acc vlan 10",
      "int vlan 10", "ip add 192.168.10.2 255.255.255.0", "no shut", "exit",
      "ip default-gateway 192.168.10.1", "end",
    ]],
  ],
  "ccna/subnet-vlsm": [
    ["R1", [
      "en", "conf t",
      "int g0/0", "ip add 10.10.10.1 255.255.255.128", "no shut",
      "int g0/1", "ip add 10.10.10.129 255.255.255.192", "no shut",
      "int g0/2", "ip add 10.10.10.193 255.255.255.224", "no shut", "end",
    ]],
    ["PC1", ["ipconfig 10.10.10.126 255.255.255.128 10.10.10.1"]],
    ["PC2", ["ipconfig 10.10.10.190 255.255.255.192 10.10.10.129"]],
    ["PC3", ["ipconfig 10.10.10.222 255.255.255.224 10.10.10.193"]],
  ],
  "ccna/stp-root": [
    ["SW3", ["en", "conf t", "vlan 10", "name ENG", "exit", "int g0/1", "sw mode trunk", "int fa0/1", "spanning-tree portfast", "spanning-tree bpduguard enable", "exit", "spanning-tree mode rapid-pvst", "end"]],
    ["SW1", ["en", "conf t", "spanning-tree vlan 10 root primary", "spanning-tree mode rapid-pvst", "end"]],
    ["SW2", ["en", "conf t", "spanning-tree mode rapid-pvst", "int fa0/1", "spanning-tree portfast", "spanning-tree bpduguard enable", "end"]],
  ],
  "ccna/floating-static": [
    ["R2", ["en", "conf t", "ip route 0.0.0.0 0.0.0.0 10.0.12.1", "ip route 0.0.0.0 0.0.0.0 10.0.23.2 10", "end"]],
    ["R1", ["en", "conf t", "ip route 192.168.2.0 255.255.255.0 10.0.12.2", "ip route 192.168.2.0 255.255.255.0 10.0.13.2 10", "end"]],
  ],
  "ccna/dhcp-nat": [
    ["R1", [
      "en", "conf t",
      "ip dhcp excluded-address 192.168.10.1 192.168.10.20",
      "ip dhcp pool LAN", "network 192.168.10.0 255.255.255.0", "default-router 192.168.10.1", "dns-server 8.8.8.8", "exit",
      "int g0/0", "ip nat inside", "int g0/1", "ip nat outside", "exit",
      "access-list 1 permit 192.168.10.0 0.0.0.255",
      "ip nat inside source list 1 interface g0/1 overload",
      "ip nat inside source static 192.168.10.100 203.0.113.5", "end",
    ]],
    ["PC1", ["ipconfig /dhcp", "ping 8.8.8.8"]],
    ["PC2", ["ipconfig /dhcp"]],
  ],
  "ccna/acl-hardening": [
    ["R1", [
      "en", "conf t",
      "access-list 10 deny 192.168.30.0 0.0.0.255", "access-list 10 permit any",
      "int g0/2", "ip access-group 10 out", "exit",
      "access-list 110 deny ip 192.168.30.0 0.0.0.255 192.168.10.0 0.0.0.255", "access-list 110 permit ip any any",
      "int g0/1", "ip access-group 110 in", "exit",
      "enable secret Cl4ss!fied", "service password-encryption",
      "line con 0", "password C0ns0le", "login", "exit",
      "ip domain-name lab.local", "crypto key generate rsa general-keys modulus 1024", "ip ssh version 2",
      "username admin secret Adm1n!",
      "line vty 0 4", "login local", "transport input ssh", "end",
    ]],
  ],
  "ccna/troubleshoot": [
    ["PC1", ["ipconfig", "ipconfig 192.168.20.11 255.255.255.0 192.168.20.1"]],
    ["SW1", ["en", "show interfaces status", "conf t", "int fa0/2", "sw acc vlan 20", "end"]],
    ["R1", ["en", "show ip int br", "conf t", "int g0/0", "no shut", "int g0/1", "ip add 10.0.0.1 255.255.255.252", "end"]],
    ["R2", ["en", "show ip protocols", "conf t", "router ospf 1", "no network 10.0.0.0 0.0.0.3 area 1", "network 10.0.0.0 0.0.0.3 area 0", "end"]],
  ],
  "ccna/static-ospf": [
    ["R2", ["en", "conf t", "int g0/0", "ip add 192.168.20.1 255.255.255.0", "no shut", "int g0/1", "ip add 10.0.0.2 255.255.255.252", "no shut", "router ospf 1", "router-id 2.2.2.2", "network 10.0.0.0 0.0.0.3 area 0", "network 192.168.20.0 0.0.0.255 area 0", "end"]],
    ["R1", ["en", "conf t", "int g0/1", "no shut", "router ospf 1", "router-id 1.1.1.1", "net 10.0.0.0 0.0.0.3 area 0", "net 192.168.10.0 0.0.0.255 area 0", "end"]],
  ],
};

describe("lab catalog", () => {
  it("every catalog lab has a playable definition and a solution", () => {
    for (const c of COURSES) {
      for (const l of c.labs) {
        expect(LABS[`${c.id}/${l.id}`], `${c.id}/${l.id}`).toBeDefined();
        expect(SOLUTIONS[`${c.id}/${l.id}`], `${c.id}/${l.id}`).toBeDefined();
      }
    }
  });
});

for (const [key, lab] of Object.entries(LABS)) {
  describe(key, () => {
    it("starts with objectives open", () => {
      const s = lab.initialState();
      expect(lab.objectives.some((o) => !o.check(s))).toBe(true);
      expect(lab.objectives.filter((o) => o.check(s)).map((o) => o.id)).toEqual([]);
    });

    it("is solvable with the reference solution, with no CLI errors", () => {
      let s = lab.initialState();
      for (const [dev, lines] of SOLUTIONS[key]) {
        for (const line of lines) {
          const r = lab.engine.exec(s, dev, line);
          expect(r.ok, `${dev}: ${line}\n${r.output.join("\n")}`).toBe(true);
          s = r.state;
        }
      }
      const open = lab.objectives.filter((o) => !o.check(s)).map((o) => o.text);
      expect(open).toEqual([]);
    });

    it("has a start device and hints", () => {
      expect(lab.topology.devices.some((d) => d.id === lab.startDevice)).toBe(true);
      expect(lab.hints.length).toBeGreaterThan(0);
    });
  });
}
