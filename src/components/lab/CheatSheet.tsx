"use client";

import { X } from "lucide-react";

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Moving between modes",
    rows: [
      ["enable  (en)", "User EXEC > to Privileged EXEC #"],
      ["configure terminal  (conf t)", "# to global config (config)#"],
      ["interface g0/0  (int g0/0)", "Configure one interface (config-if)#"],
      ["router ospf 1", "Configure OSPF (config-router)#"],
      ["vlan 10", "Configure a VLAN (config-vlan)#"],
      ["exit", "Go up one level"],
      ["end  or  Ctrl+Z", "Jump straight back to #"],
    ],
  },
  {
    title: "Interfaces",
    rows: [
      ["ip address 192.168.1.1 255.255.255.0", "Set an IPv4 address (ip add ...)"],
      ["no shutdown  (no shut)", "Enable the port. Router ports start shut down."],
      ["description WAN to ISP", "Label the port"],
    ],
  },
  {
    title: "Switching",
    rows: [
      ["vlan 10 / name SALES", "Create and name a VLAN"],
      ["switchport mode access  (sw mode acc)", "Make the port an access port"],
      ["switchport access vlan 10  (sw acc vlan 10)", "Put the port in VLAN 10"],
      ["switchport mode trunk", "Carry all VLANs to another switch"],
      ["interface vlan 10 / ip address ...", "Switch management address (SVI)"],
      ["ip default-gateway 192.168.1.1", "Switch's gateway for management"],
    ],
  },
  {
    title: "Routing",
    rows: [
      ["ip route 10.2.0.0 255.255.0.0 10.0.0.2", "Static route: network, mask, next hop"],
      ["router ospf 1", "Start OSPF process 1"],
      ["router-id 1.1.1.1", "Set the OSPF router ID"],
      ["network 10.0.0.0 0.0.0.3 area 0", "Enable OSPF on matching interfaces (wildcard mask)"],
    ],
  },
  {
    title: "Verify and save",
    rows: [
      ["show ip interface brief  (sh ip int br)", "Addresses and up/down status"],
      ["show running-config  (sh run)", "The current configuration"],
      ["show vlan brief", "VLANs and their access ports"],
      ["show ip route", "Routing table (C, L, S, O codes)"],
      ["show ip ospf neighbor", "OSPF adjacencies"],
      ["ping 192.168.1.1", "Test reachability (! = reply, . = timeout)"],
      ["do <command>", "Run a show/ping from config mode"],
      ["copy running-config startup-config  (wr)", "Save the configuration"],
    ],
  },
  {
    title: "Terminal tricks",
    rows: [
      ["Tab", "Complete the current word"],
      ["?", "List what can come next"],
      ["Up / Down", "Command history"],
      ["Click a device", "Open its console"],
    ],
  },
];

export function CheatSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Cheat sheet" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-cyan-500/40 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Quick reference</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          {SECTIONS.map((sec) => (
            <section key={sec.title}>
              <h3 className="font-mono text-xs uppercase tracking-widest text-cyan-300">{sec.title}</h3>
              <dl className="mt-2 space-y-1.5">
                {sec.rows.map(([cmd, what]) => (
                  <div key={cmd}>
                    <dt className="font-mono text-[13px] text-emerald-300">{cmd}</dt>
                    <dd className="text-xs text-slate-400">{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
