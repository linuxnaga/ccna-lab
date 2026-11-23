import type { LabDefinition } from "@/engine/types";
import { buildState, ciscoEngine, errDisabled, parseIp, ping, portSecurityState, type CiscoState } from "@/engine/cisco";

const topology = {
  devices: [
    { id: "R1", label: "GW", kind: "router" as const, x: 500, y: 80, labelPos: "left" as const },
    { id: "SW1", label: "LOBBY-SW", kind: "switch" as const, x: 500, y: 270 },
    { id: "PC1", label: "KIOSK-1", kind: "pc" as const, x: 220, y: 490 },
    { id: "PC2", label: "KIOSK-2", kind: "pc" as const, x: 500, y: 490 },
    { id: "PC3", label: "LAPTOP?", kind: "pc" as const, x: 780, y: 490 },
  ],
  links: [
    { id: "r1-sw1", a: { device: "R1", port: "GigabitEthernet0/0" }, b: { device: "SW1", port: "GigabitEthernet0/1" } },
    { id: "sw1-pc1", a: { device: "SW1", port: "FastEthernet0/1" }, b: { device: "PC1", port: "Ethernet0" } },
    { id: "sw1-pc2", a: { device: "SW1", port: "FastEthernet0/2" }, b: { device: "PC2", port: "Ethernet0" } },
    { id: "sw1-pc3", a: { device: "SW1", port: "FastEthernet0/3" }, b: { device: "PC3", port: "Ethernet0" } },
  ],
};

const ip = (s: string) => parseIp(s)!;
const MASK = ip("255.255.255.0");
const GW = ip("192.168.40.1");
export const PRINTER_MAC = "0060.3E1A.22B4";
const UNUSED = Array.from({ length: 21 }, (_, i) => `FastEthernet0/${i + 4}`);

const ps = (s: CiscoState, port: string) => s.devices.SW1.interfaces[port].switchport!.portSecurity;

const kioskSecure = (s: CiscoState, port: string) => {
  const p = ps(s, port);
  return !!p?.enabled && p.max === 1 && p.sticky && !!portSecurityState(s, "SW1", port)?.stickyMac;
};

export const portSecurityLab: LabDefinition<CiscoState> = {
  courseId: "ccna",
  labId: "port-security",
  title: "Lock the Lobby Ports",
  startDevice: "SW1",
  briefing: [
    "The public lobby switch has two self-service kiosks and a printer port. This morning the printer was unplugged and an unknown laptop is sitting on Fa0/3, fully on the network. Every other port in the lobby is live too.",
    `Lock it down: kiosk ports may only ever talk to the kiosk that is plugged in now (sticky learning), the printer port only accepts the printer's MAC ${PRINTER_MAC}, and every unused port is shut down and parked in a black-hole VLAN.`,
  ],
  topology,
  initialState: () =>
    buildState(topology, (d) => {
      d.R1.hostname = "GW";
      Object.assign(d.R1.interfaces["GigabitEthernet0/0"], { ip: GW, mask: MASK, shutdown: false, description: "Lobby LAN" });
      d.SW1.hostname = "LOBBY-SW";
      d.SW1.vlans[40] = "LOBBY";
      for (const p of ["FastEthernet0/1", "FastEthernet0/2", "FastEthernet0/3", "GigabitEthernet0/1"]) {
        Object.assign(d.SW1.interfaces[p].switchport!, { mode: "access", accessVlan: 40 });
      }
      d.SW1.interfaces["FastEthernet0/3"].description = "PRINTER";
      const hosts: [string, string][] = [["PC1", "192.168.40.21"], ["PC2", "192.168.40.22"], ["PC3", "192.168.40.66"]];
      for (const [pc, host] of hosts) {
        Object.assign(d[pc].interfaces.Ethernet0, { ip: ip(host), mask: MASK });
        d[pc].defaultGateway = GW;
      }
    }),
  objectives: [
    {
      id: "kiosks",
      text: "Fa0/1 and Fa0/2: port security, maximum 1 MAC, sticky learning (each kiosk's MAC is learned)",
      check: (s) => kioskSecure(s, "FastEthernet0/1") && kioskSecure(s, "FastEthernet0/2"),
    },
    {
      id: "printer",
      text: `Fa0/3: port security that only allows the printer's MAC ${PRINTER_MAC}, violation mode shutdown`,
      check: (s) => {
        const p = ps(s, "FastEthernet0/3");
        return !!p?.enabled && p.macs.includes(PRINTER_MAC) && p.macs.length <= p.max && p.violation === "shutdown";
      },
    },
    { id: "rogue", text: "The unknown laptop on Fa0/3 is cut off: the port is err-disabled", check: (s) => errDisabled(s, "SW1", "FastEthernet0/3") && !ping(s, "PC3", GW).ok },
    { id: "shut", text: "Unused ports Fa0/4 - Fa0/24 are administratively shut down", check: (s) => UNUSED.every((p) => s.devices.SW1.interfaces[p].shutdown) },
    {
      id: "blackhole",
      text: "Unused ports are access ports in black-hole VLAN 999",
      check: (s) => UNUSED.every((p) => {
        const sp = s.devices.SW1.interfaces[p].switchport!;
        return sp.mode === "access" && sp.accessVlan === 999;
      }),
    },
    {
      id: "kiosk-ok",
      text: "With port security on, both kiosks still reach the gateway 192.168.40.1",
      check: (s) => !!ps(s, "FastEthernet0/1")?.enabled && !!ps(s, "FastEthernet0/2")?.enabled && ping(s, "PC1", GW).ok && ping(s, "PC2", GW).ok,
    },
  ],
  hints: [
    "Port security only works on access ports, which these already are. Configure both kiosks at once: 'interface range fa0/1 - 2', 'switchport port-security', 'switchport port-security maximum 1', 'switchport port-security mac-address sticky'.",
    `Printer port: 'int fa0/3', 'switchport port-security', 'switchport port-security mac-address ${PRINTER_MAC}', 'switchport port-security violation shutdown' (shutdown is also the default).`,
    "Watch the console when you enable it on Fa0/3: the laptop's MAC is not allowed, so the port goes err-disabled. Check with 'show port-security interface fa0/3' and 'show interfaces status'.",
    "Unused ports: 'interface range fa0/4 - 24', 'switchport mode access', 'switchport access vlan 999', 'shutdown'. Verify kiosks with 'show port-security' and a ping from KIOSK-1.",
  ],
  engine: ciscoEngine,
};
