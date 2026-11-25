import { describe, expect, it } from "vitest";
import { LABS } from "./index";
import { COURSES } from "@/lib/courses";
import { GUIDES } from "./guides";

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
  "ccna/inter-vlan": [
    ["SW1", ["en", "conf t", "int g0/1", "sw mode trunk", "end"]],
    ["R1", ["en", "conf t", "int g0/0", "no shut", "int g0/0.10", "encapsulation dot1q 10", "ip add 192.168.10.1 255.255.255.0", "int g0/0.20", "encap dot1q 20", "ip add 192.168.20.1 255.255.255.0", "end"]],
  ],
  "ccna/etherchannel": [
    ["SW1", ["en", "conf t", "interface range fa0/23 - 24", "channel-group 1 mode active", "exit", "interface port-channel 1", "switchport mode trunk", "end"]],
    ["SW2", ["en", "conf t", "int range fa0/23 - 24", "channel-group 1 mode passive", "exit", "int po1", "sw mode trunk", "end", "show etherchannel summary"]],
  ],
  "ccna/ipv6-routing": [
    ["R2", ["en", "conf t", "ipv6 unicast-routing", "int g0/0", "ipv6 address 2001:db8:acad:2::1/64", "no shut", "int g0/1", "ipv6 address 2001:db8:acad:12::2/64", "no shut", "exit", "ipv6 route ::/0 2001:db8:acad:12::1", "end"]],
    ["PC2", ["ipv6config autoconfig"]],
    ["R1", ["en", "conf t", "ipv6 route 2001:db8:acad:2::/64 2001:db8:acad:12::2", "end"]],
  ],
  "ccna/hsrp": [
    ["R1", ["en", "conf t", "int g0/0", "standby 1 ip 192.168.50.1", "standby 1 priority 110", "standby 1 preempt", "end"]],
    ["R2", ["en", "conf t", "int g0/0", "standby 1 ip 192.168.50.1", "end", "show standby brief"]],
  ],
  "ccna/port-security": [
    ["SW1", [
      "en", "conf t",
      "interface range fa0/1 - 2", "switchport port-security", "switchport port-security maximum 1", "switchport port-security mac-address sticky", "exit",
      "int fa0/3", "switchport port-security", "switchport port-security mac-address 0060.3E1A.22B4", "switchport port-security violation shutdown", "exit",
      "interface range fa0/4 - 24", "switchport mode access", "switchport access vlan 999", "shutdown", "end",
    ]],
  ],
  "ccna/trunk-security": [
    ["SW1", ["en", "conf t", "vlan 999", "name NATIVE-BH", "exit", "int g0/1", "switchport mode trunk", "switchport nonegotiate", "switchport trunk native vlan 999", "switchport trunk allowed vlan 10,20,999", "end"]],
    ["SW2", ["en", "show interfaces g0/1 switchport", "conf t", "vlan 999", "name NATIVE-BH", "exit", "int g0/1", "sw mode trunk", "sw nonegotiate", "sw trunk native vlan 999", "sw trunk allowed vlan 10,20,999", "end", "show interfaces trunk"]],
    ["PC1", ["ping 192.168.10.12"]],
  ],
  "ccna/ospf-dr": [
    ["R2", ["en", "show ip ospf neighbor", "conf t", "router ospf 1", "passive-interface g0/1", "end"]],
    ["R1", ["en", "conf t", "int g0/0", "ip ospf priority 255", "exit", "router ospf 1", "default-information originate", "end"]],
    ["R3", ["en", "conf t", "int g0/0", "ip ospf priority 0", "exit", "router ospf 1", "passive-interface g0/1", "end", "clear ip ospf process", "show ip ospf interface g0/0", "show ip route"]],
    ["PC3", ["ping 8.8.8.8"]],
  ],
  "ccna/dhcp-relay": [
    ["R2", ["en", "conf t", "ip dhcp excluded-address 192.168.20.1 192.168.20.10", "ip dhcp pool BRANCH", "network 192.168.20.0 255.255.255.0", "default-router 192.168.20.1", "dns-server 192.168.10.53", "exit", "ip route 192.168.20.0 255.255.255.0 10.0.12.1", "end"]],
    ["R1", ["en", "conf t", "int g0/0", "ip helper-address 10.0.12.2", "end"]],
    ["PC1", ["ipconfig /dhcp", "ping 192.168.10.50"]],
    ["PC2", ["ipconfig /dhcp"]],
    ["R2", ["show ip dhcp binding"]],
  ],
  "ccna/device-mgmt": [
    ["R1", [
      "en", "show cdp neighbors", "show cdp neighbors detail", "conf t",
      "int g0/0", "description to BR-ACC-07 Gi0/1", "int g0/1", "no cdp enable", "exit",
      "ntp server 10.10.10.50", "clock timezone EST -5",
      "logging host 10.10.10.50", "logging trap warnings", "service timestamps log datetime msec",
      "no snmp-server community public", "snmp-server community N0c-R3ad ro", "lldp run", "end",
    ]],
    ["SW1", ["en", "conf t", "ntp server 10.10.10.50", "lldp run", "end", "show ntp status", "show lldp neighbors"]],
    ["R1", ["show ntp associations", "show logging", "show clock", "show snmp community"]],
  ],
  "ccna/named-acl": [
    ["R1", [
      "en", "show access-lists", "conf t", "ip access-list extended DMZ-IN", "no 20",
      "15 permit tcp any host 172.16.1.10 eq 443", "25 permit icmp host 198.51.100.50 host 172.16.1.10", "exit",
      "ip access-list extended STAFF-IN", "deny tcp 192.168.10.0 0.0.0.255 host 172.16.1.10 eq telnet", "permit ip any any", "exit",
      "int g0/0", "ip access-group STAFF-IN in", "end",
    ]],
    ["NET", ["curl https://172.16.1.10", "ping 172.16.1.10"]],
    ["PC1", ["ssh -l admin 172.16.1.10"]],
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

    it("has a guide that matches its topology, with verify commands the CLI accepts", () => {
      const guide = GUIDES[key];
      expect(guide, key).toBeDefined();
      const ids = lab.topology.devices.map((d) => d.id);
      expect(Object.keys(guide.roles).sort()).toEqual([...ids].sort());
      expect(guide.steps.length).toBeGreaterThan(2);
      let s = lab.initialState();
      for (const [dev, lines] of SOLUTIONS[key]) for (const line of lines) s = lab.engine.exec(s, dev, line).state;
      for (const st of guide.steps) {
        expect(ids, st.task).toContain(st.device);
        if (!st.verify || st.verify.includes("<")) continue;
        // Verify commands run from # on network gear, or straight away on a PC.
        let t = s;
        if (st.mode !== "pc") for (const l of ["end", "enable"]) t = lab.engine.exec(t, st.device, l).state;
        const r = lab.engine.exec(t, st.device, st.verify);
        expect(r.ok, `${st.device}: ${st.verify}\n${r.output.join("\n")}`).toBe(true);
      }
    });

    it("has a start device and hints", () => {
      expect(lab.topology.devices.some((d) => d.id === lab.startDevice)).toBe(true);
      expect(lab.hints.length).toBeGreaterThan(0);
    });
  });
}
