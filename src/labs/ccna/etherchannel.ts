import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, memberStatus, parseIp, ping, spanningTreeAll, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "SW1", label: "DIST-1", kind: "switch" as const, x: 270, y: 230, labelPos: "above" as const },
    { id: "SW2", label: "DIST-2", kind: "switch" as const, x: 730, y: 230, labelPos: "above" as const },
    { id: "PC1", label: "LAB-PC1", kind: "pc" as const, x: 270, y: 490 },
    { id: "PC2", label: "LAB-PC2", kind: "pc" as const, x: 730, y: 490 },
  ],
  links: [
    { id: "sw-23", a: { device: "SW1", port: "FastEthernet0/23" }, b: { device: "SW2", port: "FastEthernet0/23" } },
    { id: "sw-24", a: { device: "SW1", port: "FastEthernet0/24" }, b: { device: "SW2", port: "FastEthernet0/24" } },
    { id: "sw1-pc1", a: { device: "SW1", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "sw2-pc2", a: { device: "SW2", port: "FastEthernet0/1" }, b: { device: "PC2", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const MASK = ip("255.255.255.0");
const MEMBERS = ["FastEthernet0/23", "FastEthernet0/24"];
const lacp = (m?: string) => m === "active" || m === "passive";

const group = (s: CiscoState, sw: string, modes: (m?: string) => boolean) =>
  MEMBERS.every((p) => s.devices[sw].interfaces[p].channelGroup?.id === 1 && modes(s.devices[sw].interfaces[p].channelGroup?.mode));

const bundled = (s: CiscoState) => ["SW1", "SW2"].every((sw) => MEMBERS.every((p) => memberStatus(s, sw, p) === "P"));

export const etherchannelLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "etherchannel",
  title: "Double the Uplink",
  startDevice: "SW1",
  briefing: [
    "The two distribution switches are joined by two cables, Fa0/23 and Fa0/24, but spanning tree blocks one of them, so you are paying for bandwidth you cannot use. The lab VLAN also never made it across, so the two lab PCs cannot talk.",
    "Bundle both links into one logical Port-channel 1 using LACP, make the port-channel an 802.1Q trunk on both switches, and confirm spanning tree now sees one link with nothing blocked.",
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.SW1.hostname = "DIST-1";
      d.SW2.hostname = "DIST-2";
      for (const sw of ["SW1", "SW2"]) {
        d[sw].vlans[30] = "LAB";
        Object.assign(d[sw].interfaces["FastEthernet0/1"].switchport!, { mode: "access", accessVlan: 30 });
      }
      Object.assign(d.PC1.interfaces.Ethernet0, { ip: ip("10.30.0.11"), mask: MASK });
      Object.assign(d.PC2.interfaces.Ethernet0, { ip: ip("10.30.0.12"), mask: MASK });
      d.PC1.defaultGateway = ip("10.30.0.1");
      d.PC2.defaultGateway = ip("10.30.0.1");
    }),
  objectives: [
    { id: "sw1-lacp", text: "DIST-1: Fa0/23 and Fa0/24 in channel-group 1 with LACP active", check: (s) => group(s, "SW1", (m) => m === "active") },
    { id: "sw2-lacp", text: "DIST-2: Fa0/23 and Fa0/24 in channel-group 1 with LACP (active or passive)", check: (s) => group(s, "SW2", lacp) },
    { id: "bundle", text: "Port-channel 1 is up with both members bundled (P) on both switches", check: bundled },
    {
      id: "trunk",
      text: "Port-channel 1 is an 802.1Q trunk on both switches",
      check: (s) => ["SW1", "SW2"].every((sw) => s.devices[sw].interfaces["Port-channel1"]?.switchport?.mode === "trunk"),
    },
    {
      id: "stp",
      text: "Spanning tree sees Po1 as one forwarding link in VLAN 30, with no member port blocked",
      check: (s) => {
        if (!bundled(s)) return false;
        const t = spanningTreeAll(s, 30);
        return ["SW1", "SW2"].every((sw) => {
          const ports = t[sw]?.ports ?? [];
          return ports.some((p) => p.iface === "Port-channel1" && p.state === "FWD") && ports.every((p) => p.state === "FWD");
        });
      },
    },
    { id: "ping", text: "LAB-PC1 can ping LAB-PC2 (10.30.0.12)", check: (s) => ping(s, "PC1", ip("10.30.0.12")).ok },
  ],
  hints: [
    "Configure both member ports at once: 'interface range fa0/23 - 24', then 'channel-group 1 mode active'. IOS creates Port-channel1 for you.",
    "LACP needs at least one active side: active/active or active/passive bundles, passive/passive never does. Do the same range on DIST-2 (active or passive).",
    "Configure the bundle on the port-channel, not the members: 'interface port-channel 1', 'switchport mode trunk'. The members inherit it. Do this on both switches.",
    "Verify with 'show etherchannel summary' (look for Po1(SU) and both ports flagged P) and 'show spanning-tree vlan 30', where Po1 appears as a single port.",
  ],
  engine: ciscoEngine,
};
