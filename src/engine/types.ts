/**
 * Vendor-neutral lab engine contracts. Each vendor (Cisco IOS, F5 tmsh,
 * PAN-OS, ...) implements VendorEngine; the lab workspace UI only talks
 * to these types, so new vendors plug in without UI changes.
 */

export type DeviceKind = "router" | "switch" | "pc" | "firewall" | "loadbalancer" | "server";

export interface TopologyDevice {
  id: string;
  label: string;
  kind: DeviceKind;
  /** Position in the SVG viewBox (0..1000 x 0..600). */
  x: number;
  y: number;
}

export interface LinkEnd {
  device: string;
  port: string;
}

export interface TopologyLink {
  id: string;
  a: LinkEnd;
  b: LinkEnd;
}

export interface Topology {
  devices: TopologyDevice[];
  links: TopologyLink[];
}

export interface ExecResult<S> {
  state: S;
  /** Lines printed to the terminal (without the echoed command). */
  output: string[];
  /** false when the device rejected the command (syntax or semantic error). */
  ok: boolean;
  /** Normalised command (e.g. "conf t" -> "configure terminal") for stats. */
  canonical?: string;
}

export interface LinkStatus {
  /** Physical/line-protocol state of each end. */
  a: boolean;
  b: boolean;
}

export interface VendorEngine<S> {
  vendor: string;
  /** Prompt to show for a device, e.g. "R1(config-if)#". */
  prompt(state: S, deviceId: string): string;
  /** Execute one line typed at a device's console. */
  exec(state: S, deviceId: string, line: string): ExecResult<S>;
  /** Tab completion: returns the completed line (or the same line). */
  complete(state: S, deviceId: string, line: string): string;
  /** Status lights for a link. */
  linkStatus(state: S, topology: Topology, link: TopologyLink): LinkStatus;
  /** Banner printed when a console is first opened. */
  banner(state: S, deviceId: string): string[];
}

export interface Objective<S> {
  id: string;
  text: string;
  check(state: S): boolean;
}

export interface LabDefinition<S> {
  courseId: string;
  labId: string;
  title: string;
  briefing: string[];
  topology: Topology;
  initialState(): S;
  objectives: Objective<S>[];
  /** Progressive hints, revealed one at a time (each costs XP). */
  hints: string[];
  engine: VendorEngine<S>;
  /** Device whose console opens first. */
  startDevice: string;
}
