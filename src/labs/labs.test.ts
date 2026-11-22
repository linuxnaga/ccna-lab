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
