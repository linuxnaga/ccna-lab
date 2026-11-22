import { describe, expect, it } from "vitest";
import { buildState, ciscoEngine, parseIp, type CiscoState } from "./index";
import type { Topology } from "../types";

const topo: Topology = {
  devices: [
    { id: "R1", label: "R1", kind: "router", x: 0, y: 0 },
    { id: "R2", label: "R2", kind: "router", x: 0, y: 0 },
    { id: "SW1", label: "SW1", kind: "switch", x: 0, y: 0 },
    { id: "PC1", label: "PC1", kind: "pc", x: 0, y: 0 },
    { id: "PC2", label: "PC2", kind: "pc", x: 0, y: 0 },
  ],
  links: [
    { id: "l1", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "GigabitEthernet0/1" } },
    { id: "l2", a: { device: "SW1", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "l3", a: { device: "R1", port: "GigabitEthernet0/1" }, b: { device: "R2", port: "GigabitEthernet0/1" } },
    { id: "l4", a: { device: "R2", port: "GigabitEthernet0/0" }, b: { device: "PC2", port: "Ethernet0" } },
  ],
};

function fresh(): CiscoState {
  return buildState(topo, (d) => {
    d.R1.hostname = "R1";
    d.R2.hostname = "R2";
    d.SW1.hostname = "SW1";
    Object.assign(d.PC1.interfaces.Ethernet0, { ip: parseIp("192.168.10.10"), mask: parseIp("255.255.255.0") });
    d.PC1.defaultGateway = parseIp("192.168.10.1")!;
    Object.assign(d.PC2.interfaces.Ethernet0, { ip: parseIp("192.168.20.10"), mask: parseIp("255.255.255.0") });
    d.PC2.defaultGateway = parseIp("192.168.20.1")!;
  });
}

function run(state: CiscoState, dev: string, lines: string[]) {
  let s = state;
  let last = { output: [] as string[], ok: true };
  for (const l of lines) {
    const r = ciscoEngine.exec(s, dev, l);
    s = r.state;
    last = r;
  }
  return { state: s, ...last };
}

describe("modes and abbreviations", () => {
  it("walks through every mode with shortcuts", () => {
    let s = fresh();
    expect(ciscoEngine.prompt(s, "R1")).toBe("R1>");
    s = run(s, "R1", ["en"]).state;
    expect(ciscoEngine.prompt(s, "R1")).toBe("R1#");
    s = run(s, "R1", ["conf t"]).state;
    expect(ciscoEngine.prompt(s, "R1")).toBe("R1(config)#");
    s = run(s, "R1", ["int g0/0"]).state;
    expect(ciscoEngine.prompt(s, "R1")).toBe("R1(config-if)#");
    s = run(s, "R1", ["router ospf 1"]).state;
    expect(ciscoEngine.prompt(s, "R1")).toBe("R1(config-router)#");
    s = run(s, "R1", ["end"]).state;
    expect(ciscoEngine.prompt(s, "R1")).toBe("R1#");
  });

  it("accepts 'int gig 0/1' and 'interface GigabitEthernet0/1'", () => {
    const s = run(fresh(), "R1", ["en", "conf t", "int gig 0/1"]).state;
    expect(s.devices.R1.ctx.iface).toBe("GigabitEthernet0/1");
  });

  it("shows the ^ marker under the bad token", () => {
    const r = run(fresh(), "R1", ["en", "conf t", "int g0/0", "ip adress 1.1.1.1 255.0.0.0"]);
    expect(r.ok).toBe(false);
    expect(r.output[0]).toBe(" ".repeat("R1(config-if)#".length + 3) + "^");
    expect(r.output[1]).toBe("% Invalid input detected at '^' marker.");
  });

  it("reports ambiguous and incomplete commands", () => {
    expect(run(fresh(), "R1", ["en", "co"]).output[0]).toContain("% Ambiguous command");
    expect(run(fresh(), "R1", ["en", "conf t", "int g0/0", "ip address"]).output[0]).toBe("% Incomplete command.");
  });

  it("rejects switch commands on a router", () => {
    expect(run(fresh(), "R1", ["en", "conf t", "int g0/0", "sw mode acc"]).ok).toBe(false);
  });

  it("tab-completes keywords", () => {
    const s = run(fresh(), "R1", ["en"]).state;
    expect(ciscoEngine.complete(s, "R1", "conf")).toBe("configure ");
    expect(ciscoEngine.complete(s, "R1", "sh")).toBe("show ");
  });
});

describe("interfaces and routing", () => {
  it("brings a link up with no shutdown and logs it", () => {
    const r = run(fresh(), "R1", ["en", "conf t", "int g0/0", "ip add 192.168.10.1 255.255.255.0", "no shut"]);
    expect(r.output.some((l) => l.includes("GigabitEthernet0/0, changed state to up"))).toBe(true);
    const link = topo.links[0];
    expect(ciscoEngine.linkStatus(r.state, topo, link)).toEqual({ a: true, b: true });
    const brief = run(r.state, "R1", ["do sh ip int br"]).output.join("\n");
    expect(brief).toMatch(/GigabitEthernet0\/0\s+192\.168\.10\.1\s+YES manual up\s+up/);
  });

  it("rejects a network address", () => {
    const r = run(fresh(), "R1", ["en", "conf t", "int g0/0", "ip add 192.168.10.0 255.255.255.0"]);
    expect(r.ok).toBe(false);
    expect(r.output[0]).toContain("Bad mask");
  });

  it("PC can ping its gateway once the router port is up", () => {
    let s = fresh();
    expect(run(s, "PC1", ["ping 192.168.10.1"]).output.join("\n")).toContain("Request timed out.");
    s = run(s, "R1", ["en", "conf t", "int g0/0", "ip add 192.168.10.1 255.255.255.0", "no shut"]).state;
    expect(run(s, "PC1", ["ping 192.168.10.1"]).output.join("\n")).toContain("Received = 4");
  });

  function twoSites(): CiscoState {
    let s = fresh();
    s = run(s, "R1", ["en", "conf t", "int g0/0", "ip add 192.168.10.1 255.255.255.0", "no shut", "int g0/1", "ip add 10.0.0.1 255.255.255.252", "no shut", "end"]).state;
    s = run(s, "R2", ["en", "conf t", "int g0/0", "ip add 192.168.20.1 255.255.255.0", "no shut", "int g0/1", "ip add 10.0.0.2 255.255.255.252", "no shut", "end"]).state;
    return s;
  }

  it("needs routes in both directions for an end-to-end ping", () => {
    let s = twoSites();
    expect(run(s, "PC1", ["ping 192.168.20.10"]).output.join("\n")).toContain("Received = 0");
    s = run(s, "R1", ["conf t", "ip route 192.168.20.0 255.255.255.0 10.0.0.2"]).state;
    expect(run(s, "PC1", ["ping 192.168.20.10"]).output.join("\n")).toContain("Received = 0");
    s = run(s, "R2", ["conf t", "ip route 192.168.10.0 255.255.255.0 10.0.0.1"]).state;
    expect(run(s, "PC1", ["ping 192.168.20.10"]).output.join("\n")).toContain("Received = 4");
    const table = run(s, "R1", ["do show ip route"]).output.join("\n");
    expect(table).toContain("S     192.168.20.0/24 [1/0] via 10.0.0.2");
  });

  it("forms an OSPF adjacency and learns routes", () => {
    let s = twoSites();
    s = run(s, "R1", ["conf t", "router ospf 1", "net 192.168.10.0 0.0.0.255 area 0"]).state;
    const r = run(s, "R1", ["net 10.0.0.0 0.0.0.3 area 0"]);
    s = r.state;
    expect(r.output.join("")).not.toContain("ADJCHG");
    const r2 = run(s, "R2", ["conf t", "router ospf 1", "network 10.0.0.0 0.0.0.3 area 0", "network 192.168.20.0 0.0.0.255 area 0"]);
    s = r2.state;
    const nbr = run(s, "R1", ["do show ip ospf neighbor"]).output.join("\n");
    expect(nbr).toContain("10.0.0.2");
    expect(run(s, "R1", ["do show ip route"]).output.join("\n")).toMatch(/O\s+192\.168\.20\.0\/24 \[110\/2\] via 10\.0\.0\.2/);
    expect(run(s, "PC1", ["ping 192.168.20.10"]).output.join("\n")).toContain("Received = 4");
  });
});

describe("switching", () => {
  it("creates VLANs and access ports and shows them", () => {
    let s = fresh();
    s = run(s, "SW1", ["en", "conf t", "vlan 10", "name SALES", "exit", "int fa0/1", "sw mode acc", "sw acc vlan 10", "end"]).state;
    const vlans = run(s, "SW1", ["sh vlan br"]).output.join("\n");
    expect(vlans).toMatch(/10\s+SALES\s+active\s+Fa0\/1/);
    expect(s.devices.SW1.interfaces["FastEthernet0/1"].switchport).toEqual({ mode: "access", accessVlan: 10 });
  });

  it("auto-creates a missing access VLAN like IOS", () => {
    const r = run(fresh(), "SW1", ["en", "conf t", "int fa0/1", "switchport access vlan 30"]);
    expect(r.output[0]).toBe("% Access VLAN does not exist. Creating vlan 30");
  });

  it("isolates hosts in different VLANs from the router port", () => {
    let s = run(fresh(), "R1", ["en", "conf t", "int g0/0", "ip add 192.168.10.1 255.255.255.0", "no shut"]).state;
    expect(run(s, "PC1", ["ping 192.168.10.1"]).output.join("\n")).toContain("Received = 4");
    s = run(s, "SW1", ["en", "conf t", "int fa0/1", "sw acc vlan 10"]).state;
    expect(run(s, "PC1", ["ping 192.168.10.1"]).output.join("\n")).toContain("Received = 0");
    s = run(s, "SW1", ["int g0/1", "sw acc vlan 10"]).state;
    expect(run(s, "PC1", ["ping 192.168.10.1"]).output.join("\n")).toContain("Received = 4");
  });

  it("does not allow deleting VLAN 1", () => {
    expect(run(fresh(), "SW1", ["en", "conf t", "no vlan 1"]).output[0]).toBe("%Default VLAN 1 may not be deleted.");
  });
});

describe("running-config", () => {
  it("reflects configuration", () => {
    const s = run(fresh(), "R1", ["en", "conf t", "hostname EDGE", "int g0/0", "ip add 192.168.10.1 255.255.255.0", "no shut", "end"]).state;
    const cfg = run(s, "R1", ["sh run"]).output.join("\n");
    expect(cfg).toContain("hostname EDGE");
    expect(cfg).toContain("interface GigabitEthernet0/0\n ip address 192.168.10.1 255.255.255.0\n duplex auto");
    expect(ciscoEngine.prompt(s, "R1")).toBe("EDGE#");
  });
});
