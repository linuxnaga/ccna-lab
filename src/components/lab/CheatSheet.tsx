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
    title: "Spanning tree",
    rows: [
      ["spanning-tree mode rapid-pvst", "Use Rapid PVST+ (faster convergence)"],
      ["spanning-tree vlan 10 root primary", "Make this switch the root bridge for VLAN 10"],
      ["spanning-tree vlan 10 priority 4096", "Set the bridge priority (multiples of 4096)"],
      ["spanning-tree portfast", "Host port: skip listening/learning (interface)"],
      ["spanning-tree bpduguard enable", "Shut the port if a switch is plugged in (interface)"],
      ["show spanning-tree vlan 10", "Root bridge, port roles and blocked ports"],
    ],
  },
  {
    title: "Routing",
    rows: [
      ["ip route 10.2.0.0 255.255.0.0 10.0.0.2", "Static route: network, mask, next hop"],
      ["router ospf 1", "Start OSPF process 1"],
      ["router-id 1.1.1.1", "Set the OSPF router ID"],
      ["network 10.0.0.0 0.0.0.3 area 0", "Enable OSPF on matching interfaces (wildcard mask)"],
      ["ip route 0.0.0.0 0.0.0.0 10.0.0.1", "Default route (gateway of last resort)"],
      ["ip route 0.0.0.0 0.0.0.0 10.0.9.1 10", "Floating static: AD 10 backs up the AD 1 route"],
    ],
  },
  {
    title: "DHCP and NAT",
    rows: [
      ["ip dhcp excluded-address 10.1.1.1 10.1.1.20", "Keep addresses out of the pool"],
      ["ip dhcp pool LAN / network ... / default-router ...", "Define a DHCP pool (dns-server too)"],
      ["ip nat inside  |  ip nat outside", "Mark NAT interfaces (interface)"],
      ["ip nat inside source list 1 interface g0/1 overload", "PAT: many inside hosts share one public IP"],
      ["ip nat inside source static 10.1.1.100 203.0.113.5", "Static NAT: publish one inside host"],
      ["show ip nat translations / show ip dhcp binding", "Verify NAT entries and DHCP leases"],
    ],
  },
  {
    title: "ACLs",
    rows: [
      ["access-list 10 deny 10.3.0.0 0.0.255.255", "Standard (1-99): source only. Place near the destination"],
      ["access-list 110 deny ip <src> <wc> <dst> <wc>", "Extended (100-199): place near the source"],
      ["access-list 110 permit ip any any", "Every ACL ends with an implicit deny any"],
      ["ip access-group 10 out", "Apply an ACL to an interface (in or out)"],
      ["show access-lists", "List entries in order"],
    ],
  },
  {
    title: "Device hardening",
    rows: [
      ["enable secret <pw>", "Hashed privileged EXEC password"],
      ["service password-encryption", "Encrypt line passwords in the config"],
      ["line con 0 / password <pw> / login", "Console password"],
      ["ip domain-name lab.local", "Needed before RSA keys"],
      ["crypto key generate rsa general-keys modulus 1024", "Keys for SSH (768+ bits for v2)"],
      ["username admin secret <pw>", "Local user account"],
      ["line vty 0 4 / login local / transport input ssh", "SSH-only remote access"],
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
      ["show ip protocols  /  show ip ospf int br", "OSPF networks, areas and interfaces"],
      ["show interfaces status", "Switch ports: connected, VLAN or trunk"],
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
      ["ipconfig  /  ipconfig /dhcp", "PC: show addressing, or lease one by DHCP"],
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
