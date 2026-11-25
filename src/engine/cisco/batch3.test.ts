import { describe, expect, it } from "vitest";
import { LABS } from "@/labs";
import { cdpNeighbors, ciscoEngine, isTrunking, lldpNeighbors, ntpStatus, ospfNeighbors, ospfSegment, parseIp, tcpConnect, type CiscoState } from "./index";

const ip = (s: string) => parseIp(s)!;

function play(key: string, steps: [string, string[]][], from?: CiscoState) {
  let s: CiscoState = from ?? LABS[key].initialState();
  const outputs: string[] = [];
  let ok = true;
  for (const [dev, lines] of steps) {
    for (const l of lines) {
      const r = ciscoEngine.exec(s, dev, l);
      outputs.push(...r.output);
      ok &&= r.ok;
      s = r.state;
    }
  }
  return { s, out: outputs.join("\n"), ok };
}

describe("DTP, native and allowed VLANs", () => {
  const uplink = "GigabitEthernet0/1";
  it("negotiates a trunk between desirable and auto, but not with access or nonegotiate", () => {
    const desirableAccess = LABS["ccna/trunk-security"].initialState();
    expect(isTrunking(desirableAccess, "SW1", uplink)).toBe(false);
    const { s: auto } = play("ccna/trunk-security", [["SW2", ["en", "conf t", "int g0/1", "switchport mode dynamic auto"]]]);
    expect(isTrunking(auto, "SW1", uplink) && isTrunking(auto, "SW2", uplink)).toBe(true);
    const { s: silent } = play("ccna/trunk-security", [
      ["SW1", ["en", "conf t", "int g0/1", "switchport mode trunk", "switchport nonegotiate"]],
      ["SW2", ["en", "conf t", "int g0/1", "switchport mode dynamic auto"]],
    ]);
    // A nonegotiate trunk sends no DTP, so the auto end stays an access port.
    expect(isTrunking(silent, "SW2", uplink)).toBe(false);
  });

  it("refuses nonegotiate on a dynamic port", () => {
    const { out, ok } = play("ccna/trunk-security", [["SW1", ["en", "conf t", "int g0/1", "switchport nonegotiate"]]]);
    expect(ok).toBe(false);
    expect(out).toContain("Conflict between 'nonegotiate' and 'dynamic' status");
  });

  it("logs a native VLAN mismatch and drops VLANs pruned from the allowed list", () => {
    const { out, s } = play("ccna/trunk-security", [
      ["SW1", ["en", "conf t", "int g0/1", "sw mode trunk", "sw trunk native vlan 999"]],
      ["SW2", ["en", "conf t", "int g0/1", "sw mode trunk"]],
    ]);
    expect(out).toContain("%CDP-4-NATIVE_VLAN_MISMATCH");
    const { s: pruned } = play("ccna/trunk-security", [["SW2", ["sw trunk allowed vlan 10"]]], s);
    const lab = LABS["ccna/trunk-security"];
    expect(lab.objectives.find((o) => o.id === "staff")!.check(pruned)).toBe(true);
    expect(lab.objectives.find((o) => o.id === "cams")!.check(pruned)).toBe(false);
  });
});

describe("OSPF DR election, passive interfaces, default origination", () => {
  it("elects by priority, then router ID", () => {
    const s0 = LABS["ccna/ospf-dr"].initialState();
    expect(ospfSegment(s0, "R1", "GigabitEthernet0/0").dr?.router).toBe("R3");
    const { s, out } = play("ccna/ospf-dr", [
      ["R1", ["en", "conf t", "int g0/0", "ip ospf priority 255", "end"]],
      ["R2", ["en", "show ip ospf neighbor"]],
    ]);
    expect(ospfSegment(s, "R2", "GigabitEthernet0/0").dr?.router).toBe("R1");
    expect(out).toMatch(/1\.1\.1\.1\s+255\s+FULL\/DR/);
  });

  it("shows 2WAY between two DROTHERs", () => {
    const { out } = play("ccna/ospf-dr", [
      ["R1", ["en", "conf t", "int g0/0", "ip ospf priority 0", "end"]],
      ["R2", ["en", "conf t", "int g0/0", "ip ospf priority 0", "end"]],
      ["R1", ["show ip ospf neighbor"]],
    ]);
    expect(out).toMatch(/2\.2\.2\.2\s+0\s+2WAY\/DROTHER/);
  });

  it("passive interfaces form no neighbors but stay advertised", () => {
    const { s, out } = play("ccna/ospf-dr", [["R1", ["en", "conf t", "router ospf 1", "passive-interface g0/0", "end", "show ip ospf interface g0/0"]]]);
    expect(ospfNeighbors(s, "R1")).toEqual([]);
    expect(out).toContain("No Hellos (Passive interface)");
  });

  it("only originates a default route it actually has", () => {
    const { out } = play("ccna/ospf-dr", [
      ["R1", ["en", "conf t", "no ip route 0.0.0.0 0.0.0.0 203.0.113.1", "router ospf 1", "default-information originate", "end"]],
      ["R2", ["en", "show ip route"]],
    ]);
    expect(out).not.toContain("O*E2");
  });
});

describe("DHCP relay", () => {
  const steps: [string, string[]][] = [
    ["R2", ["en", "conf t", "ip dhcp pool BRANCH", "network 192.168.20.0 255.255.255.0", "default-router 192.168.20.1", "end"]],
    ["R1", ["en", "conf t", "int g0/0", "ip helper-address 10.0.12.2", "end"]],
  ];
  it("needs a route back to the relay address", () => {
    const { s, out } = play("ccna/dhcp-relay", [...steps, ["PC1", ["ipconfig /dhcp"]]]);
    expect(out).toContain("DHCP request failed.");
    const { s: fixed } = play("ccna/dhcp-relay", [["R2", ["conf t", "ip route 192.168.20.0 255.255.255.0 10.0.12.1", "end"]], ["PC1", ["ipconfig /dhcp"]]], s);
    expect(fixed.devices.PC1.interfaces.Ethernet0.ip).toBe(ip("192.168.20.2"));
    expect(fixed.devices.PC1.dhcpServer).toBe("R2");
  });
});

describe("named ACLs and TCP tests", () => {
  const edit = (lines: string[]) => play("ccna/named-acl", [["R1", ["en", "conf t", "ip access-list extended DMZ-IN", ...lines]]]);

  it("inserts by sequence number and rejects duplicates", () => {
    const { s, out } = edit(["15 permit tcp any host 172.16.1.10 eq 443", "20 permit udp any any eq domain", "do show access-lists"]);
    expect(out).toContain("% Duplicate sequence number");
    expect(s.devices.R1.acls["DMZ-IN"].map((e) => e.seq)).toEqual([10, 15, 20, 30]);
    expect(out).toMatch(/15 permit tcp any host 172\.16\.1\.10 eq 443\n\s+20 permit tcp any any eq telnet/);
  });

  it("tells open, refused and filtered ports apart", () => {
    const s = LABS["ccna/named-acl"].initialState();
    expect(tcpConnect(s, "NET", ip("172.16.1.10"), 80)).toBe("open");
    expect(tcpConnect(s, "NET", ip("172.16.1.10"), 443)).toBe("filtered");
    expect(tcpConnect(s, "PC1", ip("172.16.1.10"), 8080)).toBe("refused");
  });

  it("keeps a numbered list numbered after editing it in named mode", () => {
    const { s, out } = play("ccna/named-acl", [
      ["R1", ["en", "conf t", "access-list 101 permit tcp any any eq www", "ip access-list extended 101", "5 deny tcp any any eq telnet", "end", "show running-config"]],
    ]);
    expect(s.devices.R1.acls["101"].map((e) => e.seq)).toEqual([5, 10]);
    expect(out).toContain("access-list 101 deny tcp any any eq telnet");
    expect(out).toContain("ip access-list extended DMZ-IN");
  });

  it("uses the standard-ACL prompt for a named standard list", () => {
    const { s } = play("ccna/named-acl", [["R1", ["en", "conf t", "ip access-list standard MGMT"]]]);
    expect(ciscoEngine.prompt(s, "R1")).toBe("EDGE(config-std-nacl)#");
  });
});

describe("NTP, CDP and LLDP", () => {
  it("syncs NTP only when the server answers", () => {
    const { s } = play("ccna/device-mgmt", [["R1", ["en", "conf t", "ntp server 10.10.10.99", "end"]]]);
    expect(ntpStatus(s, "R1")).toBeNull();
    const { s: good, out } = play("ccna/device-mgmt", [["R1", ["conf t", "ntp server 10.10.10.50", "end", "show ntp status"]]], s);
    expect(ntpStatus(good, "R1")).toEqual({ server: ip("10.10.10.50"), stratum: 2 });
    expect(out).toContain("Clock is synchronized, stratum 2, reference is 10.10.10.50");
  });

  it("hides a port from CDP with no cdp enable, and needs lldp run on both ends", () => {
    const { s } = play("ccna/device-mgmt", [["R1", ["en", "conf t", "int g0/1", "no cdp enable", "exit", "lldp run", "end"]]]);
    expect(cdpNeighbors(s, "R2")).toEqual([]);
    expect(cdpNeighbors(s, "R1").map((n) => n.device.hostname)).toEqual(["BR-ACC-07"]);
    expect(lldpNeighbors(s, "R1")).toEqual([]);
    const { s: both } = play("ccna/device-mgmt", [["SW1", ["en", "conf t", "lldp run", "end"]]], s);
    expect(lldpNeighbors(both, "R1").map((n) => n.device.id)).toEqual(["SW1"]);
  });

  it("reports CDP disabled after no cdp run", () => {
    const { out } = play("ccna/device-mgmt", [["R1", ["en", "conf t", "no cdp run", "end", "show cdp neighbors"]]]);
    expect(out).toContain("% CDP is not enabled");
  });
});
