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
    title: "Inter-VLAN, EtherChannel, port security",
    rows: [
      ["interface g0/0.10 / encapsulation dot1q 10", "Router-on-a-stick subinterface for VLAN 10"],
      ["interface range fa0/23 - 24", "Configure several ports at once"],
      ["channel-group 1 mode active", "Bundle with LACP (active/passive). 'on' = no negotiation"],
      ["interface port-channel 1", "Configure the bundle; members inherit it"],
      ["show etherchannel summary", "P = bundled, I = stand-alone, s = suspended"],
      ["switchport port-security", "Turn on port security (access ports only)"],
      ["switchport port-security mac-address sticky", "Learn the connected MAC into the config"],
      ["switchport port-security violation shutdown", "err-disable the port on a violation"],
      ["show port-security interface fa0/1", "Secure MACs, status and violations"],
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
    title: "Trunk security",
    rows: [
      ["switchport mode dynamic desirable | auto", "Let DTP negotiate a trunk (auto + auto never trunks)"],
      ["switchport nonegotiate", "Stop sending DTP (needs mode trunk or access)"],
      ["switchport trunk native vlan 999", "Untagged VLAN on the trunk: use an unused one, same on both ends"],
      ["switchport trunk allowed vlan 10,20,999", "Only carry these VLANs (add / remove edit the list)"],
      ["show interfaces g0/1 switchport", "Administrative vs operational mode, native VLAN"],
      ["show interfaces trunk", "Trunking ports, native VLAN and allowed list"],
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
      ["ip ospf priority 255  (interface)", "Win the DR election. 0 = never DR or BDR"],
      ["passive-interface g0/1  (router ospf)", "No hellos on a user LAN; the subnet is still advertised"],
      ["default-information originate  (router ospf)", "Advertise this router's default route (O*E2)"],
      ["show ip ospf interface g0/0", "DR, BDR, priority and adjacencies on a segment"],
    ],
  },
  {
    title: "HSRP and IPv6",
    rows: [
      ["standby 1 ip 192.168.1.1", "Join HSRP group 1 with a virtual gateway IP"],
      ["standby 1 priority 110 / standby 1 preempt", "Win the election and take it back after a failure"],
      ["show standby brief", "Active, standby and virtual IP"],
      ["ipv6 unicast-routing", "Let the router forward IPv6 and send RAs"],
      ["ipv6 address 2001:db8:1::1/64", "IPv6 address (add eui-64 to build it from the MAC)"],
      ["ipv6 route ::/0 2001:db8:12::1", "IPv6 default route"],
      ["show ipv6 interface brief  /  show ipv6 route", "IPv6 addresses and routing table"],
      ["ipv6config autoconfig", "PC: SLAAC address from the router's prefix"],
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
      ["ip helper-address 10.0.12.2  (interface)", "DHCP relay: forward client broadcasts to a remote server"],
    ],
  },
  {
    title: "Management: NTP, syslog, SNMP, CDP, LLDP",
    rows: [
      ["ntp server 10.10.10.50", "Sync the clock (show ntp status, show clock)"],
      ["logging host 10.10.10.50 / logging trap warnings", "Send syslog at severity 4 and more urgent"],
      ["service timestamps log datetime msec", "Timestamp log messages"],
      ["snmp-server community <name> ro", "Read-only SNMP community (avoid public / RW)"],
      ["show cdp neighbors [detail]", "Cisco neighbors: hostname, platform, port, IP"],
      ["no cdp enable  (interface)  |  no cdp run", "Stop CDP on one port, or everywhere"],
      ["lldp run  /  show lldp neighbors", "Vendor-neutral discovery (off by default)"],
    ],
  },
  {
    title: "ACLs",
    rows: [
      ["access-list 10 deny 10.3.0.0 0.0.255.255", "Standard (1-99): source only. Place near the destination"],
      ["access-list 110 deny ip <src> <wc> <dst> <wc>", "Extended (100-199): place near the source"],
      ["access-list 110 permit ip any any", "Every ACL ends with an implicit deny any"],
      ["ip access-group 10 out", "Apply an ACL to an interface (in or out)"],
      ["show access-lists", "List entries in order, with sequence numbers"],
      ["ip access-list extended WEB-IN", "Named ACL (config-ext-nacl)#; standard works too"],
      ["15 permit tcp any host 10.1.1.10 eq 443", "Insert by sequence number; eq www, telnet, 22, ..."],
      ["no 20", "Delete one entry from a named ACL"],
      ["curl https://10.1.1.10  |  telnet 10.1.1.10 [port]", "PC: test TCP ports through your ACLs"],
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
