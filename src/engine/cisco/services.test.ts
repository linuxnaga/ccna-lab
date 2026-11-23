import { describe, expect, it } from "vitest";
import { LABS } from "@/labs";
import { COURSES } from "@/lib/courses";
import { isUnlocked } from "@/lib/progression";
import { ciscoEngine, parseIp, ping, spanningTreeAll, type CiscoState } from "./index";

const ip = (s: string) => parseIp(s)!;

function play(key: string, steps: [string, string[]][], from?: CiscoState) {
  const lab = LABS[key];
  let s = from ?? lab.initialState();
  const outputs: string[] = [];
  for (const [dev, lines] of steps) {
    for (const l of lines) {
      const r = ciscoEngine.exec(s, dev, l);
      outputs.push(...r.output);
      s = r.state;
    }
  }
  return { s, out: outputs.join("\n"), done: (id: string) => lab.objectives.find((o) => o.id === id)!.check(s) };
}

describe("ACLs", () => {
  it("apply first-match with an implicit deny at the end", () => {
    const { s, done } = play("ccna/acl-hardening", [
      ["R1", ["en", "conf t", "access-list 10 deny 192.168.30.0 0.0.0.255", "int g0/2", "ip access-group 10 out", "end"]],
    ]);
    // Without "permit any", the implicit deny blocks staff too.
    expect(ping(s, "PC1", ip("192.168.99.10")).ok).toBe(false);
    expect(done("std-acl")).toBe(false);
    const fixed = play("ccna/acl-hardening", [["R1", ["conf t", "access-list 10 permit any", "end"]]], s);
    expect(ping(fixed.s, "PC1", ip("192.168.99.10")).ok).toBe(true);
    expect(ping(fixed.s, "PC2", ip("192.168.99.10")).ok).toBe(false);
    expect(fixed.done("verify")).toBe(true);
  });

  it("rejects extended syntax on a standard list number", () => {
    const { out } = play("ccna/acl-hardening", [["R1", ["en", "conf t", "access-list 10 permit ip any any"]]]);
    expect(out).toMatch(/standard list/);
  });

  it("shows ACL entries with sequence numbers", () => {
    const { out } = play("ccna/acl-hardening", [
      ["R1", ["en", "conf t", "access-list 110 deny ip 192.168.30.0 0.0.0.255 host 192.168.10.10", "access-list 110 permit ip any any", "end", "show access-lists"]],
    ]);
    expect(out).toContain("Extended IP access list 110");
    expect(out).toContain("10 deny ip 192.168.30.0 0.0.0.255 host 192.168.10.10");
    expect(out).toContain("20 permit ip any any");
  });
});

describe("NAT and DHCP", () => {
  it("fails DHCP without a pool and leases above the excluded range", () => {
    const none = play("ccna/dhcp-nat", [["PC1", ["ipconfig /dhcp"]]]);
    expect(none.out).toContain("DHCP request failed.");
    const { s } = play("ccna/dhcp-nat", [
      ["R1", ["en", "conf t", "ip dhcp excluded-address 192.168.10.1 192.168.10.20", "ip dhcp pool LAN", "network 192.168.10.0 255.255.255.0", "default-router 192.168.10.1", "end"]],
      ["PC1", ["ipconfig /dhcp"]],
      ["PC2", ["ipconfig /dhcp"]],
    ]);
    expect(s.devices.PC1.interfaces.Ethernet0.ip).toBe(ip("192.168.10.21"));
    expect(s.devices.PC2.interfaces.Ethernet0.ip).toBe(ip("192.168.10.22"));
  });

  it("needs PAT for inside hosts to reach the Internet, and records the translation", () => {
    const base: [string, string[]][] = [
      ["R1", ["en", "conf t", "ip dhcp pool LAN", "network 192.168.10.0 255.255.255.0", "default-router 192.168.10.1", "end"]],
      ["PC1", ["ipconfig /dhcp"]],
    ];
    const before = play("ccna/dhcp-nat", base);
    expect(ping(before.s, "PC1", ip("8.8.8.8")).ok).toBe(false);
    const after = play("ccna/dhcp-nat", [
      ["R1", ["conf t", "int g0/0", "ip nat inside", "int g0/1", "ip nat outside", "exit", "access-list 1 permit 192.168.10.0 0.0.0.255", "ip nat inside source list 1 int g0/1 overload", "end"]],
      ["PC1", ["ping 8.8.8.8"]],
      ["R1", ["show ip nat translations"]],
    ], before.s);
    expect(after.out).toMatch(/icmp 203\.0\.113\.2:1\s+192\.168\.10\.\d+:1\s+8\.8\.8\.8:1/);
  });
});

describe("spanning tree", () => {
  it("elects the lowest MAC on default priority, and root primary takes over", () => {
    const fixed: [string, string[]][] = [["SW3", ["en", "conf t", "vlan 10", "name ENG", "exit", "int g0/1", "sw mode trunk", "end"]]];
    const { s } = play("ccna/stp-root", fixed);
    expect(spanningTreeAll(s, 10).SW3.rootDevice).toBe("SW2");
    const after = play("ccna/stp-root", [["SW1", ["en", "conf t", "spanning-tree vlan 10 root primary", "end"]]], s);
    const t = spanningTreeAll(after.s, 10);
    expect(t.SW2.rootDevice).toBe("SW1");
    expect(t.SW1.bridge.priority).toBe(24576 + 10);
    expect(t.SW3.ports.find((p) => p.iface === "GigabitEthernet0/2")?.role).toBe("Altn");
    expect(after.done("block")).toBe(true);
  });

  it("rejects priorities that are not multiples of 4096", () => {
    const { out } = play("ccna/stp-root", [["SW1", ["en", "conf t", "spanning-tree vlan 10 priority 1000"]]]);
    expect(out).toContain("increments of 4096");
  });
});

describe("floating static routes", () => {
  it("hides the higher-AD route until the primary next hop goes away", () => {
    const { s, out } = play("ccna/floating-static", [
      ["R2", ["en", "conf t", "ip route 0.0.0.0 0.0.0.0 10.0.12.1", "ip route 0.0.0.0 0.0.0.0 10.0.23.2 10", "do show ip route"]],
    ]);
    expect(out).toContain("S*    0.0.0.0/0 [1/0] via 10.0.12.1");
    expect(out).not.toContain("via 10.0.23.2");
    const down = play("ccna/floating-static", [["R2", ["int g0/1", "shutdown", "do show ip route"]]], s);
    expect(down.out).toContain("S*    0.0.0.0/0 [10/0] via 10.0.23.2");
  });
});

describe("subnetting lab", () => {
  it("does not accept a mask that is too big for the department", () => {
    const { done } = play("ccna/subnet-vlsm", [["R1", ["en", "conf t", "int g0/0", "ip add 10.10.10.1 255.255.255.0", "no shut", "end"]]]);
    expect(done("eng")).toBe(false);
  });

  it("refuses network and broadcast addresses on PCs", () => {
    const { out } = play("ccna/subnet-vlsm", [["PC1", ["ipconfig 10.10.10.127 255.255.255.128 10.10.10.1"]]]);
    expect(out).toMatch(/network or broadcast/);
  });
});

describe("progression", () => {
  it("keeps completed labs open even if an earlier lab is new", () => {
    const ccna = COURSES[0];
    const done = new Set(["router-interface", "vlan-access", "static-ospf"]);
    expect(isUnlocked(ccna, "subnet-vlsm", done)).toBe(true);
    expect(isUnlocked(ccna, "vlan-access", done)).toBe(true);
    expect(isUnlocked(ccna, "stp-root", done)).toBe(true);
    expect(isUnlocked(ccna, "floating-static", done)).toBe(true);
    expect(isUnlocked(ccna, "dhcp-nat", done)).toBe(false);
  });
});
