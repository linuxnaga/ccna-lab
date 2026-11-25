/**
 * Free "how to run this lab" walkthroughs and per-device roles, shown in the
 * lab workspace's Lab Guide. Steps say which device to click, which IOS mode
 * to be in and how to verify, but leave the exact configuration lines to the
 * objectives and the paid Tier-2 hints.
 */

/** IOS mode a step is done in. Matches the prompts the Cisco engine prints. */
export type GuideMode = "pc" | "exec" | "config" | "if" | "router" | "vlan" | "dhcp" | "line" | "nacl";

export interface GuideStep {
  /** Topology device id to click. */
  device: string;
  mode: GuideMode;
  /** The command that enters the sub-mode, e.g. "interface g0/0". */
  at?: string;
  /** What to do there, in words. */
  task: string;
  /** Command that proves the step worked. */
  verify?: string;
}

export interface LabGuide {
  /** What each device is for in this scenario, keyed by device id. */
  roles: Record<string, string>;
  steps: GuideStep[];
}

export const MODE_INFO: Record<GuideMode, { prompt: string; name: string; reach: string }> = {
  pc: { prompt: "C:\\>", name: "PC command prompt", reach: "Click the PC. No modes: ipconfig, ping, curl, telnet and ssh work straight away." },
  exec: { prompt: "#", name: "Privileged EXEC", reach: "enable (en) from the > prompt. show, ping, copy and clear run here." },
  config: { prompt: "(config)#", name: "Global config", reach: "configure terminal (conf t) from #." },
  if: { prompt: "(config-if)#", name: "Interface config", reach: "interface <name> (int g0/0) or interface range from (config)#." },
  router: { prompt: "(config-router)#", name: "Router config", reach: "router ospf <id> from (config)#." },
  vlan: { prompt: "(config-vlan)#", name: "VLAN config", reach: "vlan <id> from (config)#." },
  dhcp: { prompt: "(dhcp-config)#", name: "DHCP pool config", reach: "ip dhcp pool <name> from (config)#." },
  line: { prompt: "(config-line)#", name: "Line config", reach: "line con 0 or line vty 0 4 from (config)#." },
  nacl: { prompt: "(config-ext-nacl)#", name: "Named ACL config", reach: "ip access-list extended <name> from (config)#." },
};

export const GUIDES: Record<string, LabGuide> = {
  "ccna/router-interface": {
    roles: {
      R1: "The branch router. Its Gi0/0 is the LAN's default gateway, and it starts with a blank config.",
      SW1: "Layer 2 access switch. Already works out of the box: every port is in VLAN 1.",
      PC1: "Staff PC, already addressed as 192.168.10.10 with gateway 192.168.10.1. Use it to test.",
      PC2: "Staff PC, already addressed as 192.168.10.11.",
    },
    steps: [
      { device: "R1", mode: "exec", task: "Open R1's console (it opens first), type enable, then look at the starting point.", verify: "show ip interface brief" },
      { device: "R1", mode: "config", task: "Enter global config and set the hostname. The prompt changes as soon as you press Enter." },
      { device: "R1", mode: "if", at: "interface g0/0", task: "Give Gi0/0 the gateway address and mask from the objectives, then enable the port. Router ports start administratively down." },
      { device: "R1", mode: "exec", task: "Type end to get back to #. Gi0/0 should now be up/up and the link lights green.", verify: "show ip interface brief" },
      { device: "PC1", mode: "pc", task: "Click PC1 and ping the gateway.", verify: "ping 192.168.10.1" },
      { device: "R1", mode: "exec", task: "Back on R1, save the running config to startup-config so it survives a reload. The last objective ticks when the save succeeds." },
    ],
  },

  "ccna/subnet-vlsm": {
    roles: {
      R1: "One router with three LAN ports, one per department. Each port becomes the gateway (first usable address) of its subnet.",
      PC1: "ENG-PC, Engineering (100 hosts). Gets the last usable address of the first, largest subnet.",
      PC2: "SALES-PC, Sales (50 hosts). Lives in the next block after Engineering.",
      PC3: "MGMT-PC, Management (20 hosts). Lives in the block after Sales.",
    },
    steps: [
      { device: "R1", mode: "exec", task: "Work out the subnets on paper first: largest department first, smallest block that fits hosts + 2. The hints have the maths if you get stuck." },
      { device: "R1", mode: "if", at: "interface g0/0", task: "en, conf t, then address Gi0/0 with the first usable IP of the Engineering subnet and its mask, and no shutdown." },
      { device: "R1", mode: "if", at: "interface g0/1", task: "Do the same for Sales on Gi0/1, then Management on Gi0/2 (int g0/2). You can jump between interfaces without exiting." },
      { device: "R1", mode: "exec", task: "end, then check every port is up/up with the right address.", verify: "show ip interface brief" },
      { device: "PC1", mode: "pc", task: "Click each PC in turn and set address, mask and gateway in one line: ipconfig <ip> <mask> <gateway>. Repeat on SALES-PC and MGMT-PC.", verify: "ipconfig" },
      { device: "PC1", mode: "pc", task: "From ENG-PC, ping the other two PCs to prove routing between the subnets.", verify: "ping 10.10.10.190" },
    ],
  },

  "ccna/vlan-access": {
    roles: {
      R1: "The gateway router, 192.168.10.1. Already configured; you do not need to touch it.",
      SW1: "The access switch you fix. Everything starts in VLAN 1.",
      PC1: "SALES-1 on Fa0/1. Must end up in VLAN 10.",
      PC2: "SALES-2 on Fa0/2. Must end up in VLAN 10.",
      PC3: "GUEST on Fa0/3. Must stay in VLAN 1, cut off from the Sales gateway.",
    },
    steps: [
      { device: "SW1", mode: "exec", task: "SW1's console opens first. Type enable and see that only VLAN 1 exists.", verify: "show vlan brief" },
      { device: "SW1", mode: "vlan", at: "vlan 10", task: "From global config, create VLAN 10 and name it SALES." },
      { device: "SW1", mode: "if", at: "interface fa0/1", task: "Make Fa0/1 an access port in VLAN 10. Repeat on Fa0/2, then on the router uplink Gi0/1. Leave Fa0/3 alone." },
      { device: "SW1", mode: "if", at: "interface vlan 10", task: "Give the switch its management address on the VLAN 10 SVI and no shutdown it. Then exit and set the default gateway in global config." },
      { device: "SW1", mode: "exec", task: "Confirm the ports moved to VLAN 10 and the SVI is up.", verify: "show vlan brief" },
      { device: "PC1", mode: "pc", task: "Ping the gateway from SALES-1, and from GUEST to see it fail on purpose.", verify: "ping 192.168.10.1" },
    ],
  },

  "ccna/inter-vlan": {
    roles: {
      R1: "Router with one LAN port. It routes between VLANs using one 802.1Q subinterface per VLAN (router-on-a-stick).",
      SW1: "Access switch. Fa0/1 is in VLAN 10, Fa0/2 in VLAN 20; the uplink Gi0/1 must carry both VLANs to R1.",
      PC1: "SALES-PC in VLAN 10, gateway 192.168.10.1.",
      PC2: "ENG-PC in VLAN 20 (192.168.20.10), gateway 192.168.20.1.",
    },
    steps: [
      { device: "SW1", mode: "if", at: "interface g0/1", task: "On SW1 (opens first): en, conf t, then make the uplink to R1 a trunk.", verify: "show interfaces trunk" },
      { device: "R1", mode: "if", at: "interface g0/0", task: "Click R1. Enable the physical port. It gets no IP address of its own." },
      { device: "R1", mode: "if", at: "interface g0/0.10", task: "Create the VLAN 10 subinterface: set the 802.1Q tag first, then the gateway address." },
      { device: "R1", mode: "if", at: "interface g0/0.20", task: "Repeat for VLAN 20." },
      { device: "R1", mode: "exec", task: "Both subinterfaces should be up/up with their addresses.", verify: "show ip interface brief" },
      { device: "PC1", mode: "pc", task: "From SALES-PC, ping the gateway, then ENG-PC across the VLANs.", verify: "ping 192.168.20.10" },
    ],
  },

  "ccna/stp-root": {
    roles: {
      SW1: "CORE switch. Should be the spanning tree root bridge for VLAN 10.",
      SW2: "ACC1 access switch, ENG-1 on Fa0/1. Currently the root because it has the lowest MAC.",
      SW3: "ACC2 access switch, ENG-2 on Fa0/1. VLAN 10 was deleted here and its uplink is not a trunk.",
      PC1: "ENG-1, used to test with a ping to ENG-2.",
      PC2: "ENG-2 (10.1.10.12), offline until ACC2 is fixed.",
    },
    steps: [
      { device: "SW3", mode: "exec", task: "ACC2 opens first. Confirm VLAN 10 is missing.", verify: "show vlan brief" },
      { device: "SW3", mode: "vlan", at: "vlan 10", task: "Recreate VLAN 10 named ENG, then make the CORE uplink Gi0/1 a trunk (int g0/1)." },
      { device: "SW3", mode: "if", at: "interface fa0/1", task: "On the PC port, turn on PortFast and BPDU Guard. Then set the switch to Rapid PVST+ from global config." },
      { device: "SW1", mode: "config", task: "Click CORE and make it the root bridge for VLAN 10, and set Rapid PVST+.", verify: "show spanning-tree vlan 10" },
      { device: "SW2", mode: "if", at: "interface fa0/1", task: "On ACC1, set Rapid PVST+ in global config and protect Fa0/1 with PortFast and BPDU Guard." },
      { device: "SW3", mode: "exec", task: "Back on ACC2, one end of the ACC1-ACC2 link should now be Altn BLK (amber light on the map).", verify: "show spanning-tree vlan 10" },
      { device: "PC1", mode: "pc", task: "Ping ENG-2 from ENG-1.", verify: "ping 10.1.10.12" },
    ],
  },

  "ccna/etherchannel": {
    roles: {
      SW1: "DIST-1 distribution switch. Uses LACP active on Fa0/23-24.",
      SW2: "DIST-2 distribution switch. Uses LACP active or passive on Fa0/23-24.",
      PC1: "LAB-PC1 in VLAN 30.",
      PC2: "LAB-PC2 in VLAN 30 (10.30.0.12). Unreachable until the port-channel trunks VLAN 30.",
    },
    steps: [
      { device: "SW1", mode: "exec", task: "On DIST-1, see that STP blocks one of the two cables (amber light).", verify: "show spanning-tree vlan 30" },
      { device: "SW1", mode: "if", at: "interface range fa0/23 - 24", task: "Select both member ports at once and put them in channel-group 1 with LACP active." },
      { device: "SW1", mode: "if", at: "interface port-channel 1", task: "Configure the bundle itself as a trunk. Members inherit it." },
      { device: "SW2", mode: "if", at: "interface range fa0/23 - 24", task: "Click DIST-2 and repeat: channel-group 1 (active or passive), then trunk Port-channel 1." },
      { device: "SW2", mode: "exec", task: "Both members should show P (bundled) and STP should see one forwarding link.", verify: "show etherchannel summary" },
      { device: "PC1", mode: "pc", task: "Ping LAB-PC2 from LAB-PC1.", verify: "ping 10.30.0.12" },
    ],
  },

  "ccna/trunk-security": {
    roles: {
      SW1: "FLOOR1-SW. Its uplink was left negotiating with DTP.",
      SW2: "FLOOR2-SW. Its uplink was wrongly set as an access port.",
      PC1: "F1-STAFF, VLAN 10 on floor 1.",
      PC2: "F1-CAM, VLAN 20 camera on floor 1.",
      PC3: "F2-STAFF, VLAN 10 on floor 2 (192.168.10.12).",
      PC4: "F2-CAM, VLAN 20 camera on floor 2.",
    },
    steps: [
      { device: "SW2", mode: "exec", task: "FLOOR2-SW opens first. Compare the administrative and operational mode of the uplink.", verify: "show interfaces g0/1 switchport" },
      { device: "SW2", mode: "vlan", at: "vlan 999", task: "Create the unused native VLAN 999 (give it a name)." },
      { device: "SW2", mode: "if", at: "interface g0/1", task: "Make the uplink a static trunk, turn off DTP, set native VLAN 999 and allow only VLANs 10, 20 and 999." },
      { device: "SW1", mode: "if", at: "interface g0/1", task: "Click FLOOR1-SW and do the same: VLAN 999 first, then the identical trunk settings. Both ends must match." },
      { device: "SW1", mode: "exec", task: "Check the trunk, its native VLAN and allowed list on both switches.", verify: "show interfaces trunk" },
      { device: "PC1", mode: "pc", task: "Ping F2-STAFF from F1-STAFF, then F2-CAM from F1-CAM.", verify: "ping 192.168.10.12" },
    ],
  },

  "ccna/static-ospf": {
    roles: {
      PC1: "HQ-PC on the HQ LAN 192.168.10.0/24.",
      R1: "HQ router. LAN is done; its WAN port Gi0/1 is addressed but shut down, and OSPF is not running.",
      R2: "BRANCH router, blank config. Gi0/0 is the branch LAN, Gi0/1 the /30 WAN link to HQ.",
      PC2: "BR-PC on the branch LAN (192.168.20.10).",
    },
    steps: [
      { device: "R2", mode: "if", at: "interface g0/0", task: "BRANCH opens first. Address the LAN port and no shutdown it, then the WAN port Gi0/1 with the /30 address." },
      { device: "R2", mode: "router", at: "router ospf 1", task: "Start OSPF, set the router ID, and add network statements (with wildcard masks) for the WAN and LAN in area 0." },
      { device: "R1", mode: "exec", task: "Click HQ and find what is still down.", verify: "show ip interface brief" },
      { device: "R1", mode: "if", at: "interface g0/1", task: "Enable the WAN port." },
      { device: "R1", mode: "router", at: "router ospf 1", task: "Start OSPF with router ID 1.1.1.1 and advertise the WAN and HQ LAN in area 0." },
      { device: "R1", mode: "exec", task: "The neighbor should reach FULL and the branch LAN should appear as an O route.", verify: "show ip ospf neighbor" },
      { device: "PC1", mode: "pc", task: "Ping BR-PC from HQ-PC.", verify: "ping 192.168.20.10" },
    ],
  },

  "ccna/ospf-dr": {
    roles: {
      R1: "HQ-EDGE. Should be the DR on the transit LAN and hands its Internet default route to OSPF.",
      R4: "ISP router, the way to 8.8.8.8. Nothing to configure.",
      SW1: "CORE-SW, the shared 10.0.0.0/24 transit LAN that triggers a DR/BDR election. Nothing to configure.",
      R2: "BR-A branch router. Should end up BDR; its user LAN on Gi0/1 should be passive.",
      R3: "BR-B branch router. Wins the election today; must never be DR or BDR (priority 0).",
      PC2: "A-USER on BR-A's LAN.",
      PC3: "B-USER on BR-B's LAN. Use it for the final ping to 8.8.8.8.",
    },
    steps: [
      { device: "R2", mode: "exec", task: "BR-A opens first. See who is DR and BDR in the State column.", verify: "show ip ospf neighbor" },
      { device: "R2", mode: "router", at: "router ospf 1", task: "Make the user LAN port Gi0/1 passive." },
      { device: "R1", mode: "if", at: "interface g0/0", task: "Click HQ-EDGE and raise its OSPF priority on the transit LAN port to the maximum." },
      { device: "R1", mode: "router", at: "router ospf 1", task: "Advertise HQ-EDGE's default route into OSPF." },
      { device: "R3", mode: "if", at: "interface g0/0", task: "Click BR-B and set OSPF priority 0 on the transit port. Make its Gi0/1 passive under router ospf 1." },
      { device: "R3", mode: "exec", task: "Type end, then clear ip ospf process to re-run the election (a sitting DR is never preempted). Check the roles, then look for the O*E2 default in show ip route.", verify: "show ip ospf interface g0/0" },
      { device: "PC3", mode: "pc", task: "Ping the Internet from B-USER (and A-USER).", verify: "ping 8.8.8.8" },
    ],
  },

  "ccna/floating-static": {
    roles: {
      PC1: "HQ-PC on 192.168.1.0/24.",
      R1: "HQ router. Needs a primary and a floating route to the branch LAN.",
      R2: "BRANCH router. Needs a primary and a floating default route.",
      PC2: "BR-PC on 192.168.2.0/24 (192.168.2.10).",
      R3: "LTE-BACKUP, the backup path. Already knows both LANs; nothing to configure.",
    },
    steps: [
      { device: "R2", mode: "config", task: "BRANCH opens first. Add a default route via the fibre next hop on HQ (10.0.12.1)." },
      { device: "R2", mode: "config", task: "Add a second default route via LTE-BACKUP (10.0.23.2) with administrative distance 10 at the end of the line.", verify: "show ip route" },
      { device: "R1", mode: "config", task: "Click HQ. Add a static route to the branch LAN via the fibre, then the same route via LTE-BACKUP (10.0.13.2) with AD 10." },
      { device: "PC1", mode: "pc", task: "Ping BR-PC from HQ-PC.", verify: "ping 192.168.2.10" },
      { device: "R2", mode: "if", at: "interface g0/1", task: "Optional test: shut the fibre port on BRANCH, check that the floating routes take over and HQ-PC still pings, then no shutdown." },
    ],
  },

  "ccna/ipv6-routing": {
    roles: {
      PC1: "HQ-PC, already has IPv6.",
      R1: "HQ router, already dual-stacked. Needs one static route to the branch /64.",
      R2: "BRANCH router, IPv4-only today. Needs IPv6 routing, addresses and a default route.",
      PC2: "BR-PC. Will build its own IPv6 address with SLAAC (EUI-64).",
    },
    steps: [
      { device: "R2", mode: "config", task: "BRANCH opens first. Turn on IPv6 unicast routing." },
      { device: "R2", mode: "if", at: "interface g0/0", task: "Add the branch LAN IPv6 address with its /64 and no shutdown, then the same on Gi0/1 for the HQ link.", verify: "show ipv6 interface brief" },
      { device: "R2", mode: "config", task: "Add an IPv6 default route ::/0 via HQ's link address." },
      { device: "PC2", mode: "pc", task: "Click BR-PC and let it autoconfigure from the router advertisement. Note its new address.", verify: "ipv6config" },
      { device: "R1", mode: "config", task: "Click HQ and add an IPv6 static route to the branch /64 via BRANCH.", verify: "show ipv6 route" },
      { device: "PC1", mode: "pc", task: "From HQ-PC, ping BR-PC's IPv6 address.", verify: "ping <BR-PC IPv6 address>" },
    ],
  },

  "ccna/hsrp": {
    roles: {
      R3: "CORE router, the way to the data centre 10.99.99.99. OSPF already runs; nothing to configure.",
      R1: "GW1. Should be the HSRP active router (priority 110, preempt).",
      R2: "GW2. Should be standby and take over if GW1 fails.",
      SW1: "LAN switch joining both gateways and the users. Nothing to configure.",
      PC1: "USER-1, gateway 192.168.50.1 (the HSRP virtual IP).",
      PC2: "USER-2, same gateway.",
    },
    steps: [
      { device: "R1", mode: "if", at: "interface g0/0", task: "GW1 opens first. Join HSRP group 1 with the virtual IP, set priority 110 and preempt." },
      { device: "R2", mode: "if", at: "interface g0/0", task: "Click GW2 and join the same group with the same virtual IP. Leave the default priority." },
      { device: "R2", mode: "exec", task: "GW1 should be Active and GW2 Standby.", verify: "show standby brief" },
      { device: "PC1", mode: "pc", task: "Ping the data centre from USER-1.", verify: "ping 10.99.99.99" },
      { device: "R1", mode: "if", at: "interface g0/0", task: "Prove failover: shut GW1's LAN port, ping again from USER-1, check GW2 is Active, then no shutdown." },
    ],
  },

  "ccna/dhcp-nat": {
    roles: {
      R2: "ISP router (203.0.113.1). Use its console to test the published web server.",
      R1: "EDGE router. Gi0/0 is the LAN (NAT inside), Gi0/1 the ISP link (NAT outside). Becomes the DHCP server.",
      SW1: "LAN switch. Nothing to configure.",
      PC1: "STAFF-1, no address yet. Gets one by DHCP.",
      PC2: "STAFF-2, no address yet. Gets one by DHCP.",
      SRV: "WEB-SRV, fixed address 192.168.10.100. Published to the Internet as 203.0.113.5.",
    },
    steps: [
      { device: "R1", mode: "config", task: "EDGE opens first. Exclude the infrastructure range from DHCP." },
      { device: "R1", mode: "dhcp", at: "ip dhcp pool LAN", task: "Define the pool: network, default router and DNS server." },
      { device: "PC1", mode: "pc", task: "Click STAFF-1 and STAFF-2 and lease an address on each.", verify: "ipconfig /dhcp" },
      { device: "R1", mode: "if", at: "interface g0/0", task: "Back on EDGE, mark Gi0/0 as NAT inside and Gi0/1 as NAT outside." },
      { device: "R1", mode: "config", task: "Create a standard ACL matching the LAN, overload it onto Gi0/1 (PAT), and add a static NAT for the web server.", verify: "show ip nat translations" },
      { device: "PC1", mode: "pc", task: "Ping the Internet from STAFF-1.", verify: "ping 8.8.8.8" },
      { device: "R2", mode: "exec", task: "Click ISP and ping the published web server address.", verify: "ping 203.0.113.5" },
    ],
  },

  "ccna/dhcp-relay": {
    roles: {
      R1: "BR-RTR, the branch gateway (192.168.20.1). Relays DHCP broadcasts to HQ.",
      R2: "HQ-RTR, the central DHCP server (10.0.12.2). Needs a branch pool and a route back to the branch.",
      SW1: "BR-SW branch switch. Nothing to configure.",
      PC1: "BR-PC1, no address yet.",
      PC2: "BR-PC2, no address yet.",
      PC3: "HQ-PC (192.168.10.50), the ping target.",
    },
    steps: [
      { device: "R2", mode: "config", task: "HQ-RTR opens first. Exclude the first ten branch addresses." },
      { device: "R2", mode: "dhcp", at: "ip dhcp pool BRANCH", task: "Build the branch pool: network, default router and DNS server." },
      { device: "R2", mode: "config", task: "Add a static route to the branch LAN via BR-RTR (10.0.12.1), so HQ-RTR can answer.", verify: "ping 192.168.20.1" },
      { device: "R1", mode: "if", at: "interface g0/0", task: "Click BR-RTR. On the LAN port facing the PCs, point DHCP relay at HQ-RTR with ip helper-address." },
      { device: "PC1", mode: "pc", task: "Click BR-PC1 and BR-PC2 and lease an address on each.", verify: "ipconfig /dhcp" },
      { device: "PC1", mode: "pc", task: "Ping HQ-PC from BR-PC1, then check the leases on HQ-RTR with show ip dhcp binding.", verify: "ping 192.168.10.50" },
    ],
  },

  "ccna/device-mgmt": {
    roles: {
      R1: "BR-EDGE, the branch router you put on the NOC's radar.",
      R2: "PROVIDER-PE, the service provider's router. CDP must not leak toward it. Nothing to configure.",
      SW1: "ACCESS-SW in the closet. Discover it with CDP, then add NTP and LLDP.",
      PC1: "BR-PC, a branch user. Nothing to configure.",
      SRV: "NOC-SRV (10.10.10.50): NTP, syslog and SNMP server.",
    },
    steps: [
      { device: "R1", mode: "exec", task: "BR-EDGE opens first. Find the switch name and port behind Gi0/0.", verify: "show cdp neighbors detail" },
      { device: "R1", mode: "if", at: "interface g0/0", task: "Write a description naming that switch. Then on Gi0/1 (the provider side) turn CDP off." },
      { device: "R1", mode: "config", task: "Point NTP and syslog at 10.10.10.50, set the logging level to warnings and timestamp log messages." },
      { device: "R1", mode: "config", task: "Remove the 'public' SNMP community, add the read-only N0c-R3ad community, and turn on LLDP.", verify: "show snmp community" },
      { device: "SW1", mode: "config", task: "Click ACCESS-SW. Point it at the same NTP server and turn on LLDP.", verify: "show ntp status" },
      { device: "SW1", mode: "exec", task: "Each device should list the other as an LLDP neighbor.", verify: "show lldp neighbors" },
    ],
  },

  "ccna/port-security": {
    roles: {
      R1: "GW, the lobby gateway (192.168.40.1). Nothing to configure.",
      SW1: "LOBBY-SW, the switch you lock down.",
      PC1: "KIOSK-1 on Fa0/1. Its MAC should be learned sticky.",
      PC2: "KIOSK-2 on Fa0/2. Its MAC should be learned sticky.",
      PC3: "The unknown laptop on Fa0/3, the printer's port. It must be cut off.",
    },
    steps: [
      { device: "SW1", mode: "if", at: "interface range fa0/1 - 2", task: "LOBBY-SW opens first. On both kiosk ports at once: port security, maximum 1 MAC, sticky learning." },
      { device: "SW1", mode: "if", at: "interface fa0/3", task: "On the printer port: port security with only the printer's static MAC and violation mode shutdown. Watch the console: the laptop's port goes err-disabled.", verify: "show port-security interface fa0/3" },
      { device: "SW1", mode: "if", at: "interface range fa0/4 - 24", task: "Make every unused port an access port in VLAN 999, then shut them down." },
      { device: "SW1", mode: "exec", task: "Confirm the secure ports and the err-disabled Fa0/3.", verify: "show interfaces status" },
      { device: "PC1", mode: "pc", task: "Make sure the kiosks still work.", verify: "ping 192.168.40.1" },
    ],
  },

  "ccna/acl-hardening": {
    roles: {
      R1: "CORE-R. Gi0/0 is the staff LAN, Gi0/1 the guest Wi-Fi, Gi0/2 the server farm.",
      PC1: "STAFF-PC (192.168.10.0/24). Must still reach the file server.",
      PC2: "GUEST-PC (192.168.30.0/24). Must lose access to the server and staff LAN.",
      SRV: "FILE-SRV (192.168.99.10) in the server farm.",
    },
    steps: [
      { device: "R1", mode: "config", task: "CORE-R opens first. Write standard ACL 10: deny the guest subnet, permit everything else." },
      { device: "R1", mode: "if", at: "interface g0/2", task: "Apply ACL 10 outbound on the server-facing port (standard ACLs go near the destination)." },
      { device: "R1", mode: "config", task: "Write extended ACL 110 denying guest to staff LAN, then permit ip any any. Apply it inbound on Gi0/1 (near the source).", verify: "show access-lists" },
      { device: "PC2", mode: "pc", task: "Test from GUEST-PC (should fail to reach FILE-SRV) and STAFF-PC (should work).", verify: "ping 192.168.99.10" },
      { device: "R1", mode: "line", at: "line con 0", task: "Back on CORE-R: set the enable secret and password encryption in global config, then a console password with login." },
      { device: "R1", mode: "line", at: "line vty 0 4", task: "Prepare SSH in global config (domain name, RSA keys, version 2, local user), then make the VTY lines SSH-only with local login.", verify: "show running-config" },
    ],
  },

  "ccna/named-acl": {
    roles: {
      R1: "EDGE router. Gi0/0 is the staff LAN, Gi0/1 the DMZ, Gi0/2 the Internet with named ACL DMZ-IN inbound.",
      NET: "REMOTE-NOC (198.51.100.50) on the Internet side. Use it to test what the Internet can reach.",
      PC1: "STAFF-PC on the staff LAN.",
      WEB: "WEB-DMZ (172.16.1.10), the public web server.",
    },
    steps: [
      { device: "R1", mode: "exec", task: "EDGE opens first. Read DMZ-IN and note its sequence numbers.", verify: "show access-lists" },
      { device: "R1", mode: "nacl", at: "ip access-list extended DMZ-IN", task: "Delete the Telnet entry by its number, then insert entries by sequence number for HTTPS and for NOC-only ping, ahead of the final deny." },
      { device: "NET", mode: "pc", task: "Click REMOTE-NOC and test HTTPS, Telnet and ping to the server.", verify: "curl https://172.16.1.10" },
      { device: "R1", mode: "nacl", at: "ip access-list extended STAFF-IN", task: "Back on EDGE, create STAFF-IN: deny Telnet from the staff LAN to the server, permit everything else." },
      { device: "R1", mode: "if", at: "interface g0/0", task: "Apply STAFF-IN inbound on the staff port." },
      { device: "PC1", mode: "pc", task: "From STAFF-PC, confirm SSH still works and Telnet does not.", verify: "ssh -l admin 172.16.1.10" },
    ],
  },

  "ccna/troubleshoot": {
    roles: {
      PC1: "FL3-PC1. Something is wrong with its own addressing.",
      PC2: "FL3-PC2. Its addressing is correct; compare against it.",
      SW1: "FL3-SW, floor 3 access switch. Floor 3 PCs belong in VLAN 20.",
      R1: "FL3-R, floor 3 gateway (192.168.20.1) and OSPF neighbor of DC-R.",
      R2: "DC-R, the data centre router.",
      SRV: "FILE-SRV (172.16.0.10), the file share nobody can reach.",
    },
    steps: [
      { device: "PC1", mode: "pc", task: "FL3-PC1 opens first. Compare its settings with FL3-PC2's and fix the odd one out with ipconfig <ip> <mask> <gateway>.", verify: "ipconfig" },
      { device: "SW1", mode: "exec", task: "Click FL3-SW. Find the PC port that is not in VLAN 20 and fix it in interface config.", verify: "show interfaces status" },
      { device: "R1", mode: "exec", task: "Click FL3-R. Look for an interface that is down or misaddressed and fix it.", verify: "show ip interface brief" },
      { device: "R2", mode: "exec", task: "Click DC-R. Compare its OSPF networks and areas with FL3-R's and fix the mismatch under router ospf 1.", verify: "show ip protocols" },
      { device: "R1", mode: "exec", task: "The adjacency should be FULL and 172.16.0.0/24 should be an O route.", verify: "show ip ospf neighbor" },
      { device: "PC1", mode: "pc", task: "Ping FILE-SRV from both floor 3 PCs.", verify: "ping 172.16.0.10" },
    ],
  },
};

export function getLabGuide(courseId: string, labId: string): LabGuide | undefined {
  return GUIDES[`${courseId}/${labId}`];
}

/** What each kind of device does, in any lab. */
export const DEVICE_KINDS: Record<string, { name: string; what: string }> = {
  router: {
    name: "Router",
    what: "Layer 3. Moves packets between different IP networks using its routing table (connected, static and OSPF routes). Each interface is its own subnet. Router ports start shut down.",
  },
  switch: {
    name: "Switch",
    what: "Layer 2. Forwards frames inside a VLAN by MAC address. Access ports carry one VLAN; trunks carry many with 802.1Q tags. Switch ports start enabled in VLAN 1.",
  },
  pc: {
    name: "PC",
    what: "An end host. No IOS modes: set addresses with ipconfig, lease them with ipconfig /dhcp, and test with ping, curl, telnet and ssh.",
  },
  server: {
    name: "Server",
    what: "An end host offering a service (file share, web, NTP/syslog). Usually a target for your tests rather than something you configure.",
  },
};

/** Common interface names you will see on the map. */
export const PORT_TYPES: [string, string][] = [
  ["Gi0/0, Gi0/1 (GigabitEthernet)", "1 Gbit/s ports. Router LAN/WAN ports and switch uplinks. Gi0/0.10 is a subinterface for VLAN 10."],
  ["Fa0/1 - Fa0/24 (FastEthernet)", "100 Mbit/s switch access ports, where PCs plug in."],
  ["Eth0 (Ethernet0)", "A PC's or server's network card."],
  ["Vlan10 (SVI)", "A switch's virtual interface in VLAN 10, used for its management IP."],
  ["Po1 (Port-channel)", "An EtherChannel bundle of several physical links acting as one."],
];

/** Parts of the app itself. */
export const UI_PARTS: [string, string][] = [
  ["HUD (top bar)", "Your rank title and level, the XP bar to the next rank, your streak of consecutive valid commands (the flame) and one badge per exam domain, lit once you finish every lab in it."],
  ["Mission map", "On the dashboard. The five CCNA domains in order, each with its missions. Missions unlock one after another; a crown means Pro, a lock means finish the previous mission first."],
  ["Incident briefing", "The amber box at the top of a lab: the scenario and what done looks like. Dismiss it with the X."],
  ["Topology panel", "The network diagram. Click a device to open its console (the active one glows cyan). Port names sit beside each link."],
  ["Link lights", "Green: up and forwarding. Amber: up, but spanning tree is blocking that end. Red: down (shut, unaddressed or misconfigured). Dashed grey link: not up at both ends."],
  ["CLI terminal", "A simulated Cisco IOS console for the selected device. Tab completes, ? lists options, Up/Down recalls history, Ctrl+C or Ctrl+Z returns to #."],
  ["Objectives", "Checked off live as the simulator sees the right state. You can do them in any order; the lab ends when all are ticked."],
  ["Request Tier-2 Support", "Reveals the next hint with exact commands. Each hint costs XP from this lab's reward."],
  ["Cheat Sheet", "Quick reference of IOS commands grouped by topic."],
  ["Lab Guide", "Opens from a lab: the step-by-step walkthrough for this lab, what each device does, and how the workspace works."],
  ["Reset Lab", "Puts every device back to the lab's starting config and clears the consoles and hints."],
  ["Victory screen", "Appears when the last objective is ticked: XP earned (minus hints), your best streak, the commands you used, and a link to the next mission."],
];
