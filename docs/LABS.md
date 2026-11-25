# Lab walkthroughs

How to run each CCNA lab: what every device is for, and the order of steps. The same content appears in the app under **Lab Guide** in each lab. Exact configuration lines are left to the objectives and the in-app Tier-2 hints.

Mirrors `src/labs/guides.ts`; update both together.

## 1. Branch Router Bring-up

A new branch office opened this morning. The switch and PCs are cabled and the PCs already have their addresses, but the router came out of the box with a blank config. Name the router, give its LAN interface the gateway address 192.168.10.1/24, bring the interface up, and prove the PCs can reach their gateway. Save your work so it survives a reload.

Console that opens first: **R1**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| R1 | Router | Gi0/0 → SW1 Gi0/1 | The branch router. Its Gi0/0 is the LAN's default gateway, and it starts with a blank config. |
| SW1 | Switch | Gi0/1 → R1 Gi0/0<br>Fa0/1 → PC1 Eth0<br>Fa0/2 → PC2 Eth0 | Layer 2 access switch. Already works out of the box: every port is in VLAN 1. |
| PC1 | PC | Eth0 → SW1 Fa0/1 | Staff PC, already addressed as 192.168.10.10 with gateway 192.168.10.1. Use it to test. |
| PC2 | PC | Eth0 → SW1 Fa0/2 | Staff PC, already addressed as 192.168.10.11. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | R1 | `#` | Open R1's console (it opens first), type enable, then look at the starting point. | `show ip interface brief` |
| 2 | R1 | `(config)#` | Enter global config and set the hostname. The prompt changes as soon as you press Enter. |  |
| 3 | R1 | `(config-if)#` via `interface g0/0` | Give Gi0/0 the gateway address and mask from the objectives, then enable the port. Router ports start administratively down. |  |
| 4 | R1 | `#` | Type end to get back to #. Gi0/0 should now be up/up and the link lights green. | `show ip interface brief` |
| 5 | PC1 | `C:\>` | Click PC1 and ping the gateway. | `ping 192.168.10.1` |
| 6 | R1 | `#` | Back on R1, save the running config to startup-config so it survives a reload. The last objective ticks when the save succeeds. |  |

Objectives:

- Set R1's hostname to BRANCH-R1
- Configure 192.168.10.1/24 on R1 Gig0/0
- Enable R1 Gig0/0 (status up/up)
- PC1 can ping its gateway 192.168.10.1
- Save the running config to startup-config

## 2. Carve Up the /24

Facilities just handed you a single block, 10.10.10.0/24, for three new departments on one router: Engineering needs 100 hosts, Sales needs 50, and Management needs 20. Use VLSM: give the biggest department the first block, then pack the others right after it, each using the smallest subnet that fits. The router takes the first usable address in each subnet and each department PC takes the last usable one.

Console that opens first: **R1**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| R1 | Router | Gi0/0 → ENG-PC Eth0<br>Gi0/1 → SALES-PC Eth0<br>Gi0/2 → MGMT-PC Eth0 | One router with three LAN ports, one per department. Each port becomes the gateway (first usable address) of its subnet. |
| ENG-PC | PC | Eth0 → R1 Gi0/0 | ENG-PC, Engineering (100 hosts). Gets the last usable address of the first, largest subnet. |
| SALES-PC | PC | Eth0 → R1 Gi0/1 | SALES-PC, Sales (50 hosts). Lives in the next block after Engineering. |
| MGMT-PC | PC | Eth0 → R1 Gi0/2 | MGMT-PC, Management (20 hosts). Lives in the block after Sales. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | R1 | `#` | Work out the subnets on paper first: largest department first, smallest block that fits hosts + 2. The hints have the maths if you get stuck. |  |
| 2 | R1 | `(config-if)#` via `interface g0/0` | en, conf t, then address Gi0/0 with the first usable IP of the Engineering subnet and its mask, and no shutdown. |  |
| 3 | R1 | `(config-if)#` via `interface g0/1` | Do the same for Sales on Gi0/1, then Management on Gi0/2 (int g0/2). You can jump between interfaces without exiting. |  |
| 4 | R1 | `#` | end, then check every port is up/up with the right address. | `show ip interface brief` |
| 5 | ENG-PC | `C:\>` | Click each PC in turn and set address, mask and gateway in one line: ipconfig <ip> <mask> <gateway>. Repeat on SALES-PC and MGMT-PC. | `ipconfig` |
| 6 | ENG-PC | `C:\>` | From ENG-PC, ping the other two PCs to prove routing between the subnets. | `ping 10.10.10.190` |

Objectives:

- Engineering (100 hosts): R1 Gi0/0 gets the first usable address of a subnet starting at 10.10.10.0, up/up
- Sales (50 hosts): R1 Gi0/1 gets the first usable address of the next free block, up/up
- Management (20 hosts): R1 Gi0/2 gets the first usable address of the block after that, up/up
- ENG-PC uses the last usable address in its subnet, with R1 as its gateway
- SALES-PC uses the last usable address in its subnet, with R1 as its gateway
- MGMT-PC uses the last usable address in its subnet, with R1 as its gateway
- ENG-PC can ping both SALES-PC and MGMT-PC

## 3. Sales VLAN Cannot Reach the Gateway

Branch office outage: the Sales team has been moved to their own VLAN on paper, but nobody configured the switch. Sales PCs are sharing a broadcast domain with the guest PC, and security wants that fixed today. Create VLAN 10 (SALES), put both Sales PCs and the router uplink into it as access ports, and keep the guest PC out. Then give SW1 a management address in VLAN 10 so the NOC can reach it.

Console that opens first: **SW1**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| R1 | Router | Gi0/0 → SW1 Gi0/1 | The gateway router, 192.168.10.1. Already configured; you do not need to touch it. |
| SW1 | Switch | Gi0/1 → R1 Gi0/0<br>Fa0/1 → SALES-1 Eth0<br>Fa0/2 → SALES-2 Eth0<br>Fa0/3 → GUEST Eth0 | The access switch you fix. Everything starts in VLAN 1. |
| SALES-1 | PC | Eth0 → SW1 Fa0/1 | SALES-1 on Fa0/1. Must end up in VLAN 10. |
| SALES-2 | PC | Eth0 → SW1 Fa0/2 | SALES-2 on Fa0/2. Must end up in VLAN 10. |
| GUEST | PC | Eth0 → SW1 Fa0/3 | GUEST on Fa0/3. Must stay in VLAN 1, cut off from the Sales gateway. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | SW1 | `#` | SW1's console opens first. Type enable and see that only VLAN 1 exists. | `show vlan brief` |
| 2 | SW1 | `(config-vlan)#` via `vlan 10` | From global config, create VLAN 10 and name it SALES. |  |
| 3 | SW1 | `(config-if)#` via `interface fa0/1` | Make Fa0/1 an access port in VLAN 10. Repeat on Fa0/2, then on the router uplink Gi0/1. Leave Fa0/3 alone. |  |
| 4 | SW1 | `(config-if)#` via `interface vlan 10` | Give the switch its management address on the VLAN 10 SVI and no shutdown it. Then exit and set the default gateway in global config. |  |
| 5 | SW1 | `#` | Confirm the ports moved to VLAN 10 and the SVI is up. | `show vlan brief` |
| 6 | SALES-1 | `C:\>` | Ping the gateway from SALES-1, and from GUEST to see it fail on purpose. | `ping 192.168.10.1` |

Objectives:

- Create VLAN 10 named SALES on SW1
- Make Fa0/1 and Fa0/2 access ports in VLAN 10
- Put the router uplink Gi0/1 in VLAN 10 (access)
- Both Sales PCs reach the gateway 192.168.10.1 through VLAN 10
- Guest PC on Fa0/3 stays isolated in VLAN 1 (cannot reach the gateway)
- SW1 management: interface Vlan10 192.168.10.2/24 up, default gateway 192.168.10.1

## 4. Route Between the VLANs

Sales (VLAN 10) and Engineering (VLAN 20) were split into separate VLANs last week, and now they cannot share files. The office only has a router with a single LAN port, so there is no layer 3 switch to route between them. Build a router-on-a-stick: trunk the switch uplink to R1, then create one 802.1Q subinterface per VLAN on R1 Gi0/0 to act as each VLAN's default gateway.

Console that opens first: **SW1**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| R1 | Router | Gi0/0 → SW1 Gi0/1 | Router with one LAN port. It routes between VLANs using one 802.1Q subinterface per VLAN (router-on-a-stick). |
| SW1 | Switch | Gi0/1 → R1 Gi0/0<br>Fa0/1 → SALES-PC Eth0<br>Fa0/2 → ENG-PC Eth0 | Access switch. Fa0/1 is in VLAN 10, Fa0/2 in VLAN 20; the uplink Gi0/1 must carry both VLANs to R1. |
| SALES-PC | PC | Eth0 → SW1 Fa0/1 | SALES-PC in VLAN 10, gateway 192.168.10.1. |
| ENG-PC | PC | Eth0 → SW1 Fa0/2 | ENG-PC in VLAN 20 (192.168.20.10), gateway 192.168.20.1. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | SW1 | `(config-if)#` via `interface g0/1` | On SW1 (opens first): en, conf t, then make the uplink to R1 a trunk. | `show interfaces trunk` |
| 2 | R1 | `(config-if)#` via `interface g0/0` | Click R1. Enable the physical port. It gets no IP address of its own. |  |
| 3 | R1 | `(config-if)#` via `interface g0/0.10` | Create the VLAN 10 subinterface: set the 802.1Q tag first, then the gateway address. |  |
| 4 | R1 | `(config-if)#` via `interface g0/0.20` | Repeat for VLAN 20. |  |
| 5 | R1 | `#` | Both subinterfaces should be up/up with their addresses. | `show ip interface brief` |
| 6 | SALES-PC | `C:\>` | From SALES-PC, ping the gateway, then ENG-PC across the VLANs. | `ping 192.168.20.10` |

Objectives:

- SW1 Gi0/1 (the link to R1) is an 802.1Q trunk
- R1 Gi0/0 is enabled (up/up)
- R1 Gi0/0.10: 802.1Q VLAN 10, gateway 192.168.10.1/24
- R1 Gi0/0.20: 802.1Q VLAN 20, gateway 192.168.20.1/24
- SALES-PC can ping its gateway 192.168.10.1
- SALES-PC can ping ENG-PC (192.168.20.10) across VLANs

## 5. The Wrong Root Bridge

Engineering's two floor switches hang off a new core switch in a triangle, so there is a redundant path. Since the install, ENG-2 has been offline, and the NOC noticed spanning tree elected an old access switch as root because it has the lowest MAC address. Someone deleted VLAN 10 on ACC2 and its uplink to CORE never became a trunk. Fix that, make CORE the root bridge for VLAN 10 so the redundant link blocks at the access layer, move every switch to Rapid PVST+, and protect the PC ports with PortFast and BPDU Guard.

Console that opens first: **ACC2**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| CORE | Switch | Gi0/1 → ACC1 Gi0/1<br>Gi0/2 → ACC2 Gi0/1 | CORE switch. Should be the spanning tree root bridge for VLAN 10. |
| ACC1 | Switch | Gi0/1 → CORE Gi0/1<br>Gi0/2 → ACC2 Gi0/2<br>Fa0/1 → ENG-1 Eth0 | ACC1 access switch, ENG-1 on Fa0/1. Currently the root because it has the lowest MAC. |
| ACC2 | Switch | Gi0/1 → CORE Gi0/2<br>Gi0/2 → ACC1 Gi0/2<br>Fa0/1 → ENG-2 Eth0 | ACC2 access switch, ENG-2 on Fa0/1. VLAN 10 was deleted here and its uplink is not a trunk. |
| ENG-1 | PC | Eth0 → ACC1 Fa0/1 | ENG-1, used to test with a ping to ENG-2. |
| ENG-2 | PC | Eth0 → ACC2 Fa0/1 | ENG-2 (10.1.10.12), offline until ACC2 is fixed. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | ACC2 | `#` | ACC2 opens first. Confirm VLAN 10 is missing. | `show vlan brief` |
| 2 | ACC2 | `(config-vlan)#` via `vlan 10` | Recreate VLAN 10 named ENG, then make the CORE uplink Gi0/1 a trunk (int g0/1). |  |
| 3 | ACC2 | `(config-if)#` via `interface fa0/1` | On the PC port, turn on PortFast and BPDU Guard. Then set the switch to Rapid PVST+ from global config. |  |
| 4 | CORE | `(config)#` | Click CORE and make it the root bridge for VLAN 10, and set Rapid PVST+. | `show spanning-tree vlan 10` |
| 5 | ACC1 | `(config-if)#` via `interface fa0/1` | On ACC1, set Rapid PVST+ in global config and protect Fa0/1 with PortFast and BPDU Guard. |  |
| 6 | ACC2 | `#` | Back on ACC2, one end of the ACC1-ACC2 link should now be Altn BLK (amber light on the map). | `show spanning-tree vlan 10` |
| 7 | ENG-1 | `C:\>` | Ping ENG-2 from ENG-1. | `ping 10.1.10.12` |

Objectives:

- ACC2 has VLAN 10 named ENG again
- ACC2 Gi0/1 (the uplink to CORE) is an 802.1Q trunk
- CORE is the root bridge for VLAN 10 on all three switches
- The redundant ACC1-ACC2 link blocks on one end in VLAN 10, and both core uplinks forward
- All three switches run Rapid PVST+
- PortFast and BPDU Guard on the PC ports (Fa0/1 on ACC1 and ACC2)
- ENG-1 can ping ENG-2 (10.1.10.12)

## 6. Double the Uplink

The two distribution switches are joined by two cables, Fa0/23 and Fa0/24, but spanning tree blocks one of them, so you are paying for bandwidth you cannot use. The lab VLAN also never made it across, so the two lab PCs cannot talk. Bundle both links into one logical Port-channel 1 using LACP, make the port-channel an 802.1Q trunk on both switches, and confirm spanning tree now sees one link with nothing blocked.

Console that opens first: **DIST-1**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| DIST-1 | Switch | Fa0/23 → DIST-2 Fa0/23<br>Fa0/24 → DIST-2 Fa0/24<br>Fa0/1 → LAB-PC1 Eth0 | DIST-1 distribution switch. Uses LACP active on Fa0/23-24. |
| DIST-2 | Switch | Fa0/23 → DIST-1 Fa0/23<br>Fa0/24 → DIST-1 Fa0/24<br>Fa0/1 → LAB-PC2 Eth0 | DIST-2 distribution switch. Uses LACP active or passive on Fa0/23-24. |
| LAB-PC1 | PC | Eth0 → DIST-1 Fa0/1 | LAB-PC1 in VLAN 30. |
| LAB-PC2 | PC | Eth0 → DIST-2 Fa0/1 | LAB-PC2 in VLAN 30 (10.30.0.12). Unreachable until the port-channel trunks VLAN 30. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | DIST-1 | `#` | On DIST-1, see that STP blocks one of the two cables (amber light). | `show spanning-tree vlan 30` |
| 2 | DIST-1 | `(config-if)#` via `interface range fa0/23 - 24` | Select both member ports at once and put them in channel-group 1 with LACP active. |  |
| 3 | DIST-1 | `(config-if)#` via `interface port-channel 1` | Configure the bundle itself as a trunk. Members inherit it. |  |
| 4 | DIST-2 | `(config-if)#` via `interface range fa0/23 - 24` | Click DIST-2 and repeat: channel-group 1 (active or passive), then trunk Port-channel 1. |  |
| 5 | DIST-2 | `#` | Both members should show P (bundled) and STP should see one forwarding link. | `show etherchannel summary` |
| 6 | LAB-PC1 | `C:\>` | Ping LAB-PC2 from LAB-PC1. | `ping 10.30.0.12` |

Objectives:

- DIST-1: Fa0/23 and Fa0/24 in channel-group 1 with LACP active
- DIST-2: Fa0/23 and Fa0/24 in channel-group 1 with LACP (active or passive)
- Port-channel 1 is up with both members bundled (P) on both switches
- Port-channel 1 is an 802.1Q trunk on both switches
- Spanning tree sees Po1 as one forwarding link in VLAN 30, with no member port blocked
- LAB-PC1 can ping LAB-PC2 (10.30.0.12)

## 7. Seal the Trunk

Since last night's change window, staff and security cameras on floor 2 cannot reach their colleagues on floor 1. The uplink between the floor switches is meant to be an 802.1Q trunk, but FLOOR1-SW was left negotiating with DTP and someone set FLOOR2-SW's end as an access port. The security team also wants the trunk hardened against VLAN hopping: static trunking with DTP turned off, an unused native VLAN 999 instead of VLAN 1, and only the VLANs that need to cross carried on the link. VLAN 30 (the test lab) stays local to each floor.

Console that opens first: **FLOOR2-SW**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| FLOOR1-SW | Switch | Gi0/1 → FLOOR2-SW Gi0/1<br>Fa0/1 → F1-STAFF Eth0<br>Fa0/2 → F1-CAM Eth0 | FLOOR1-SW. Its uplink was left negotiating with DTP. |
| FLOOR2-SW | Switch | Gi0/1 → FLOOR1-SW Gi0/1<br>Fa0/1 → F2-STAFF Eth0<br>Fa0/2 → F2-CAM Eth0 | FLOOR2-SW. Its uplink was wrongly set as an access port. |
| F1-STAFF | PC | Eth0 → FLOOR1-SW Fa0/1 | F1-STAFF, VLAN 10 on floor 1. |
| F1-CAM | PC | Eth0 → FLOOR1-SW Fa0/2 | F1-CAM, VLAN 20 camera on floor 1. |
| F2-STAFF | PC | Eth0 → FLOOR2-SW Fa0/1 | F2-STAFF, VLAN 10 on floor 2 (192.168.10.12). |
| F2-CAM | PC | Eth0 → FLOOR2-SW Fa0/2 | F2-CAM, VLAN 20 camera on floor 2. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | FLOOR2-SW | `#` | FLOOR2-SW opens first. Compare the administrative and operational mode of the uplink. | `show interfaces g0/1 switchport` |
| 2 | FLOOR2-SW | `(config-vlan)#` via `vlan 999` | Create the unused native VLAN 999 (give it a name). |  |
| 3 | FLOOR2-SW | `(config-if)#` via `interface g0/1` | Make the uplink a static trunk, turn off DTP, set native VLAN 999 and allow only VLANs 10, 20 and 999. |  |
| 4 | FLOOR1-SW | `(config-if)#` via `interface g0/1` | Click FLOOR1-SW and do the same: VLAN 999 first, then the identical trunk settings. Both ends must match. |  |
| 5 | FLOOR1-SW | `#` | Check the trunk, its native VLAN and allowed list on both switches. | `show interfaces trunk` |
| 6 | F1-STAFF | `C:\>` | Ping F2-STAFF from F1-STAFF, then F2-CAM from F1-CAM. | `ping 192.168.10.12` |

Objectives:

- Both ends of the uplink are static trunks with DTP off (mode trunk + nonegotiate)
- VLAN 999 exists on both switches and is the native VLAN on both ends, with no mismatch
- The trunk carries only VLANs 10, 20 and 999 on both ends
- F1-STAFF can ping F2-STAFF across the trunk (VLAN 10)
- F1-CAM can ping F2-CAM across the trunk (VLAN 20)

## 8. Two Sites, One Network

The company just lit up a point-to-point link between HQ and the new branch. HQ's router is half configured; the branch router is fresh out of the box. Address the branch router, bring up the /30 WAN link, and run OSPF area 0 on both routers so each site learns the other's LAN. Done means a PC at HQ can ping a PC at the branch.

Console that opens first: **BRANCH**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| HQ-PC | PC | Eth0 → HQ Gi0/0 | HQ-PC on the HQ LAN 192.168.10.0/24. |
| HQ | Router | Gi0/0 → HQ-PC Eth0<br>Gi0/1 → BRANCH Gi0/1 | HQ router. LAN is done; its WAN port Gi0/1 is addressed but shut down, and OSPF is not running. |
| BRANCH | Router | Gi0/1 → HQ Gi0/1<br>Gi0/0 → BR-PC Eth0 | BRANCH router, blank config. Gi0/0 is the branch LAN, Gi0/1 the /30 WAN link to HQ. |
| BR-PC | PC | Eth0 → BRANCH Gi0/0 | BR-PC on the branch LAN (192.168.20.10). |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | BRANCH | `(config-if)#` via `interface g0/0` | BRANCH opens first. Address the LAN port and no shutdown it, then the WAN port Gi0/1 with the /30 address. |  |
| 2 | BRANCH | `(config-router)#` via `router ospf 1` | Start OSPF, set the router ID, and add network statements (with wildcard masks) for the WAN and LAN in area 0. |  |
| 3 | HQ | `#` | Click HQ and find what is still down. | `show ip interface brief` |
| 4 | HQ | `(config-if)#` via `interface g0/1` | Enable the WAN port. |  |
| 5 | HQ | `(config-router)#` via `router ospf 1` | Start OSPF with router ID 1.1.1.1 and advertise the WAN and HQ LAN in area 0. |  |
| 6 | HQ | `#` | The neighbor should reach FULL and the branch LAN should appear as an O route. | `show ip ospf neighbor` |
| 7 | HQ-PC | `C:\>` | Ping BR-PC from HQ-PC. | `ping 192.168.20.10` |

Objectives:

- BRANCH Gig0/0: 192.168.20.1/24, up/up
- WAN link up: HQ Gig0/1 10.0.0.1/30 and BRANCH Gig0/1 10.0.0.2/30
- OSPF process 1 with router-id 1.1.1.1 on HQ and 2.2.2.2 on BRANCH
- HQ and BRANCH form a FULL OSPF adjacency in area 0
- Each router learns the other site's LAN via OSPF
- HQ-PC can ping BR-PC (192.168.20.10)

## 9. Elect the Right DR

Three routers share the 10.0.0.0/24 transit LAN behind CORE-SW, so OSPF elects a Designated Router (DR) and a Backup (BDR) there. Right now the little BR-B branch box wins the election just because it has the highest router ID, and it is struggling to keep up. Make HQ-EDGE the DR and keep BR-B out of the election for good. While you are in there, stop OSPF hellos leaking onto the user LANs, and have HQ-EDGE hand its Internet default route to the branches through OSPF instead of everyone needing a static route.

Console that opens first: **BR-A**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| HQ-EDGE | Router | Gi0/1 → ISP Gi0/0<br>Gi0/0 → CORE-SW Gi0/1 | HQ-EDGE. Should be the DR on the transit LAN and hands its Internet default route to OSPF. |
| ISP | Router | Gi0/0 → HQ-EDGE Gi0/1 | ISP router, the way to 8.8.8.8. Nothing to configure. |
| CORE-SW | Switch | Gi0/1 → HQ-EDGE Gi0/0<br>Fa0/1 → BR-A Gi0/0<br>Fa0/2 → BR-B Gi0/0 | CORE-SW, the shared 10.0.0.0/24 transit LAN that triggers a DR/BDR election. Nothing to configure. |
| BR-A | Router | Gi0/0 → CORE-SW Fa0/1<br>Gi0/1 → A-USER Eth0 | BR-A branch router. Should end up BDR; its user LAN on Gi0/1 should be passive. |
| BR-B | Router | Gi0/0 → CORE-SW Fa0/2<br>Gi0/1 → B-USER Eth0 | BR-B branch router. Wins the election today; must never be DR or BDR (priority 0). |
| A-USER | PC | Eth0 → BR-A Gi0/1 | A-USER on BR-A's LAN. |
| B-USER | PC | Eth0 → BR-B Gi0/1 | B-USER on BR-B's LAN. Use it for the final ping to 8.8.8.8. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | BR-A | `#` | BR-A opens first. See who is DR and BDR in the State column. | `show ip ospf neighbor` |
| 2 | BR-A | `(config-router)#` via `router ospf 1` | Make the user LAN port Gi0/1 passive. |  |
| 3 | HQ-EDGE | `(config-if)#` via `interface g0/0` | Click HQ-EDGE and raise its OSPF priority on the transit LAN port to the maximum. |  |
| 4 | HQ-EDGE | `(config-router)#` via `router ospf 1` | Advertise HQ-EDGE's default route into OSPF. |  |
| 5 | BR-B | `(config-if)#` via `interface g0/0` | Click BR-B and set OSPF priority 0 on the transit port. Make its Gi0/1 passive under router ospf 1. |  |
| 6 | BR-B | `#` | Type end, then clear ip ospf process to re-run the election (a sitting DR is never preempted). Check the roles, then look for the O*E2 default in show ip route. | `show ip ospf interface g0/0` |
| 7 | B-USER | `C:\>` | Ping the Internet from B-USER (and A-USER). | `ping 8.8.8.8` |

Objectives:

- HQ-EDGE is the DR on the 10.0.0.0/24 transit LAN
- BR-B can never become DR or BDR (priority 0), which leaves BR-A as the BDR
- The user LAN ports (BR-A and BR-B Gi0/1) are passive, and both user LANs are still advertised to HQ-EDGE
- HQ-EDGE originates its default route into OSPF: BR-A and BR-B learn O*E2 0.0.0.0/0
- Both user PCs can ping 8.8.8.8 on the Internet

## 10. Backup Link Failover

The branch office runs on a fibre circuit straight to HQ, with an LTE backup router as the second path. Every interface is addressed and up, but nobody configured any routes, so the two LANs cannot talk at all. Use static routes over the fibre as the primary path, and floating static routes (a higher administrative distance) through LTE-BACKUP so traffic fails over by itself if the fibre drops. LTE-BACKUP already knows both LANs.

Console that opens first: **BRANCH**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| HQ-PC | PC | Eth0 → HQ Gi0/0 | HQ-PC on 192.168.1.0/24. |
| HQ | Router | Gi0/0 → HQ-PC Eth0<br>Gi0/1 → BRANCH Gi0/1<br>Gi0/2 → LTE-BACKUP Gi0/0 | HQ router. Needs a primary and a floating route to the branch LAN. |
| BRANCH | Router | Gi0/1 → HQ Gi0/1<br>Gi0/0 → BR-PC Eth0<br>Gi0/2 → LTE-BACKUP Gi0/1 | BRANCH router. Needs a primary and a floating default route. |
| BR-PC | PC | Eth0 → BRANCH Gi0/0 | BR-PC on 192.168.2.0/24 (192.168.2.10). |
| LTE-BACKUP | Router | Gi0/0 → HQ Gi0/2<br>Gi0/1 → BRANCH Gi0/2 | LTE-BACKUP, the backup path. Already knows both LANs; nothing to configure. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | BRANCH | `(config)#` | BRANCH opens first. Add a default route via the fibre next hop on HQ (10.0.12.1). |  |
| 2 | BRANCH | `(config)#` | Add a second default route via LTE-BACKUP (10.0.23.2) with administrative distance 10 at the end of the line. | `show ip route` |
| 3 | HQ | `(config)#` | Click HQ. Add a static route to the branch LAN via the fibre, then the same route via LTE-BACKUP (10.0.13.2) with AD 10. |  |
| 4 | HQ-PC | `C:\>` | Ping BR-PC from HQ-PC. | `ping 192.168.2.10` |
| 5 | BRANCH | `(config-if)#` via `interface g0/1` | Optional test: shut the fibre port on BRANCH, check that the floating routes take over and HQ-PC still pings, then no shutdown. |  |

Objectives:

- BRANCH: default route 0.0.0.0/0 via the fibre (10.0.12.1)
- BRANCH: floating default route via LTE-BACKUP (10.0.23.2) with administrative distance 10
- HQ: static route to 192.168.2.0/24 via the fibre (10.0.12.2)
- HQ: floating static route to 192.168.2.0/24 via LTE-BACKUP (10.0.13.2) with administrative distance 10
- HQ-PC can ping BR-PC (192.168.2.10) over the fibre, not the LTE path
- Failover works: if the fibre goes down, HQ-PC still reaches BR-PC through LTE-BACKUP

## 11. IPv6 Comes to the Branch

The company is rolling out IPv6 with the block 2001:DB8:ACAD::/48. HQ is already dual-stacked and routing IPv6; the branch router is still IPv4-only and the branch PC has no IPv6 address. Turn on IPv6 routing at the branch, address its interfaces, let BR-PC build its own address with SLAAC (EUI-64), and add static routes so the two sites can reach each other over IPv6.

Console that opens first: **BRANCH**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| HQ-PC | PC | Eth0 → HQ Gi0/0 | HQ-PC, already has IPv6. |
| HQ | Router | Gi0/0 → HQ-PC Eth0<br>Gi0/1 → BRANCH Gi0/1 | HQ router, already dual-stacked. Needs one static route to the branch /64. |
| BRANCH | Router | Gi0/1 → HQ Gi0/1<br>Gi0/0 → BR-PC Eth0 | BRANCH router, IPv4-only today. Needs IPv6 routing, addresses and a default route. |
| BR-PC | PC | Eth0 → BRANCH Gi0/0 | BR-PC. Will build its own IPv6 address with SLAAC (EUI-64). |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | BRANCH | `(config)#` | BRANCH opens first. Turn on IPv6 unicast routing. |  |
| 2 | BRANCH | `(config-if)#` via `interface g0/0` | Add the branch LAN IPv6 address with its /64 and no shutdown, then the same on Gi0/1 for the HQ link. | `show ipv6 interface brief` |
| 3 | BRANCH | `(config)#` | Add an IPv6 default route ::/0 via HQ's link address. |  |
| 4 | BR-PC | `C:\>` | Click BR-PC and let it autoconfigure from the router advertisement. Note its new address. | `ipv6config` |
| 5 | HQ | `(config)#` | Click HQ and add an IPv6 static route to the branch /64 via BRANCH. | `show ipv6 route` |
| 6 | HQ-PC | `C:\>` | From HQ-PC, ping BR-PC's IPv6 address. | `ping <BR-PC IPv6 address>` |

Objectives:

- BRANCH has IPv6 unicast routing enabled
- BRANCH Gi0/0 is 2001:DB8:ACAD:2::1/64 and Gi0/1 is 2001:DB8:ACAD:12::2/64, both up
- BR-PC builds its address with SLAAC: the branch /64 prefix plus its EUI-64 interface ID
- BRANCH has a default route ::/0 via HQ (2001:DB8:ACAD:12::1)
- HQ has a static route to 2001:DB8:ACAD:2::/64 via BRANCH (2001:DB8:ACAD:12::2)
- HQ-PC can ping BR-PC's IPv6 address

## 12. The Gateway That Never Dies

The user LAN has two gateway routers for redundancy, but the PCs can only point at one default gateway. Someone set them all to 192.168.50.1, an address no router owns yet, so nobody can reach the data centre at 10.99.99.99. Configure HSRP group 1 on both routers so they share the virtual gateway 192.168.50.1. GW1 should be the active router and take the role back after an outage, and GW2 must take over by itself if GW1 fails. OSPF to CORE is already running.

Console that opens first: **GW1**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| CORE | Router | Gi0/0 → GW1 Gi0/1<br>Gi0/1 → GW2 Gi0/1 | CORE router, the way to the data centre 10.99.99.99. OSPF already runs; nothing to configure. |
| GW1 | Router | Gi0/1 → CORE Gi0/0<br>Gi0/0 → SW1 Gi0/1 | GW1. Should be the HSRP active router (priority 110, preempt). |
| GW2 | Router | Gi0/1 → CORE Gi0/1<br>Gi0/0 → SW1 Gi0/2 | GW2. Should be standby and take over if GW1 fails. |
| SW1 | Switch | Gi0/1 → GW1 Gi0/0<br>Gi0/2 → GW2 Gi0/0<br>Fa0/1 → USER-1 Eth0<br>Fa0/2 → USER-2 Eth0 | LAN switch joining both gateways and the users. Nothing to configure. |
| USER-1 | PC | Eth0 → SW1 Fa0/1 | USER-1, gateway 192.168.50.1 (the HSRP virtual IP). |
| USER-2 | PC | Eth0 → SW1 Fa0/2 | USER-2, same gateway. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | GW1 | `(config-if)#` via `interface g0/0` | GW1 opens first. Join HSRP group 1 with the virtual IP, set priority 110 and preempt. |  |
| 2 | GW2 | `(config-if)#` via `interface g0/0` | Click GW2 and join the same group with the same virtual IP. Leave the default priority. |  |
| 3 | GW2 | `#` | GW1 should be Active and GW2 Standby. | `show standby brief` |
| 4 | USER-1 | `C:\>` | Ping the data centre from USER-1. | `ping 10.99.99.99` |
| 5 | GW1 | `(config-if)#` via `interface g0/0` | Prove failover: shut GW1's LAN port, ping again from USER-1, check GW2 is Active, then no shutdown. |  |

Objectives:

- GW1 Gi0/0 is in HSRP group 1 with virtual IP 192.168.50.1
- GW2 Gi0/0 is in HSRP group 1 with virtual IP 192.168.50.1
- GW1 has priority 110 and preempt, so it takes back the active role after a failure
- GW1 is HSRP active and GW2 is standby
- USER-1 can ping the data centre at 10.99.99.99 through the virtual gateway
- Failover works: with GW1's LAN port down, USER-1 still reaches 10.99.99.99 through GW2

## 13. Branch Internet Edge

A small office is moving onto a business broadband line. The ISP gave you 203.0.113.0/29: they use .1, your EDGE router has .2, and the rest is yours. EDGE already has a default route to the ISP, but the staff PCs have no addresses and the ISP will never route 192.168.10.0/24 back to you. Make EDGE the DHCP server for the LAN, translate staff traffic to EDGE's public address with PAT (NAT overload), and publish the web server to the Internet on 203.0.113.5 with static NAT.

Console that opens first: **EDGE**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| ISP | Router | Gi0/0 → EDGE Gi0/1 | ISP router (203.0.113.1). Use its console to test the published web server. |
| EDGE | Router | Gi0/1 → ISP Gi0/0<br>Gi0/0 → SW1 Gi0/1 | EDGE router. Gi0/0 is the LAN (NAT inside), Gi0/1 the ISP link (NAT outside). Becomes the DHCP server. |
| SW1 | Switch | Gi0/1 → EDGE Gi0/0<br>Fa0/1 → STAFF-1 Eth0<br>Fa0/2 → STAFF-2 Eth0<br>Fa0/3 → WEB-SRV Eth0 | LAN switch. Nothing to configure. |
| STAFF-1 | PC | Eth0 → SW1 Fa0/1 | STAFF-1, no address yet. Gets one by DHCP. |
| STAFF-2 | PC | Eth0 → SW1 Fa0/2 | STAFF-2, no address yet. Gets one by DHCP. |
| WEB-SRV | Server | Eth0 → SW1 Fa0/3 | WEB-SRV, fixed address 192.168.10.100. Published to the Internet as 203.0.113.5. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | EDGE | `(config)#` | EDGE opens first. Exclude the infrastructure range from DHCP. |  |
| 2 | EDGE | `(dhcp-config)#` via `ip dhcp pool LAN` | Define the pool: network, default router and DNS server. |  |
| 3 | STAFF-1 | `C:\>` | Click STAFF-1 and STAFF-2 and lease an address on each. | `ipconfig /dhcp` |
| 4 | EDGE | `(config-if)#` via `interface g0/0` | Back on EDGE, mark Gi0/0 as NAT inside and Gi0/1 as NAT outside. |  |
| 5 | EDGE | `(config)#` | Create a standard ACL matching the LAN, overload it onto Gi0/1 (PAT), and add a static NAT for the web server. | `show ip nat translations` |
| 6 | STAFF-1 | `C:\>` | Ping the Internet from STAFF-1. | `ping 8.8.8.8` |
| 7 | ISP | `#` | Click ISP and ping the published web server address. | `ping 203.0.113.5` |

Objectives:

- Reserve 192.168.10.1 - 192.168.10.20 for infrastructure (excluded from DHCP)
- DHCP pool for 192.168.10.0/24 with default-router 192.168.10.1 and dns-server 8.8.8.8
- STAFF-1 and STAFF-2 get their addresses from EDGE by DHCP
- EDGE Gi0/0 is the NAT inside interface and Gi0/1 is the NAT outside interface
- PAT: an ACL matching 192.168.10.0/24 is overloaded onto Gi0/1's address
- Static NAT publishes WEB-SRV 192.168.10.100 as 203.0.113.5
- STAFF-1 can ping 8.8.8.8 on the Internet
- The ISP router can ping the web server at 203.0.113.5

## 14. The Branch Gets No Lease

The company is centralising services: every site will get its addresses from the DHCP server on HQ-RTR instead of running its own. HQ already leases addresses to its own LAN, but the new branch PCs sit on 192.168.20.0/24, one router hop away, and come up with no address at all. Build a pool for the branch on HQ-RTR, keep the first ten addresses for network gear, and make BR-RTR relay the PCs' DHCP broadcasts to HQ. Then make sure HQ-RTR can actually answer: it has never heard of the branch subnet.

Console that opens first: **HQ-RTR**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| BR-RTR | Router | Gi0/1 → HQ-RTR Gi0/1<br>Gi0/0 → BR-SW Gi0/1 | BR-RTR, the branch gateway (192.168.20.1). Relays DHCP broadcasts to HQ. |
| HQ-RTR | Router | Gi0/1 → BR-RTR Gi0/1<br>Gi0/0 → HQ-PC Eth0 | HQ-RTR, the central DHCP server (10.0.12.2). Needs a branch pool and a route back to the branch. |
| BR-SW | Switch | Gi0/1 → BR-RTR Gi0/0<br>Fa0/1 → BR-PC1 Eth0<br>Fa0/2 → BR-PC2 Eth0 | BR-SW branch switch. Nothing to configure. |
| BR-PC1 | PC | Eth0 → BR-SW Fa0/1 | BR-PC1, no address yet. |
| BR-PC2 | PC | Eth0 → BR-SW Fa0/2 | BR-PC2, no address yet. |
| HQ-PC | PC | Eth0 → HQ-RTR Gi0/0 | HQ-PC (192.168.10.50), the ping target. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | HQ-RTR | `(config)#` | HQ-RTR opens first. Exclude the first ten branch addresses. |  |
| 2 | HQ-RTR | `(dhcp-config)#` via `ip dhcp pool BRANCH` | Build the branch pool: network, default router and DNS server. |  |
| 3 | HQ-RTR | `(config)#` | Add a static route to the branch LAN via BR-RTR (10.0.12.1), so HQ-RTR can answer. | `ping 192.168.20.1` |
| 4 | BR-RTR | `(config-if)#` via `interface g0/0` | Click BR-RTR. On the LAN port facing the PCs, point DHCP relay at HQ-RTR with ip helper-address. |  |
| 5 | BR-PC1 | `C:\>` | Click BR-PC1 and BR-PC2 and lease an address on each. | `ipconfig /dhcp` |
| 6 | BR-PC1 | `C:\>` | Ping HQ-PC from BR-PC1, then check the leases on HQ-RTR with show ip dhcp binding. | `ping 192.168.10.50` |

Objectives:

- HQ-RTR has a pool for 192.168.20.0/24 with default router 192.168.20.1 and DNS 192.168.10.53
- Addresses 192.168.20.1 to 192.168.20.10 are excluded from leasing
- HQ-RTR can reach the branch LAN (ping 192.168.20.1 from HQ-RTR works)
- BR-RTR Gi0/0 relays DHCP requests to HQ-RTR with ip helper-address
- BR-PC1 and BR-PC2 both lease a branch address from HQ-RTR (ipconfig /dhcp)
- BR-PC1 can ping HQ-PC at 192.168.10.50

## 15. Put the Branch on the NOC's Radar

A new branch went live, but the network operations centre cannot see it: logs never arrive, the clocks drift so timestamps are useless, and the router still answers SNMP on the factory 'public' community with write access. Nobody even recorded which access switch is in the closet. Use CDP to identify the switch behind BR-EDGE and label the port, point both devices at the NOC server 10.10.10.50 for NTP, send BR-EDGE's syslog there, replace the SNMP community with a read-only one, stop CDP leaking details to the provider, and turn on LLDP for the new multi-vendor phones.

Console that opens first: **BR-EDGE**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| BR-EDGE | Router | Gi0/1 → PROVIDER-PE Gi0/0<br>Gi0/0 → ACCESS-SW Gi0/1 | BR-EDGE, the branch router you put on the NOC's radar. |
| PROVIDER-PE | Router | Gi0/0 → BR-EDGE Gi0/1<br>Gi0/1 → NOC-SRV Eth0 | PROVIDER-PE, the service provider's router. CDP must not leak toward it. Nothing to configure. |
| ACCESS-SW | Switch | Gi0/1 → BR-EDGE Gi0/0<br>Fa0/1 → BR-PC Eth0 | ACCESS-SW in the closet. Discover it with CDP, then add NTP and LLDP. |
| BR-PC | PC | Eth0 → ACCESS-SW Fa0/1 | BR-PC, a branch user. Nothing to configure. |
| NOC-SRV | Server | Eth0 → PROVIDER-PE Gi0/1 | NOC-SRV (10.10.10.50): NTP, syslog and SNMP server. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | BR-EDGE | `#` | BR-EDGE opens first. Find the switch name and port behind Gi0/0. | `show cdp neighbors detail` |
| 2 | BR-EDGE | `(config-if)#` via `interface g0/0` | Write a description naming that switch. Then on Gi0/1 (the provider side) turn CDP off. |  |
| 3 | BR-EDGE | `(config)#` | Point NTP and syslog at 10.10.10.50, set the logging level to warnings and timestamp log messages. |  |
| 4 | BR-EDGE | `(config)#` | Remove the 'public' SNMP community, add the read-only N0c-R3ad community, and turn on LLDP. | `show snmp community` |
| 5 | ACCESS-SW | `(config)#` | Click ACCESS-SW. Point it at the same NTP server and turn on LLDP. | `show ntp status` |
| 6 | ACCESS-SW | `#` | Each device should list the other as an LLDP neighbor. | `show lldp neighbors` |

Objectives:

- BR-EDGE Gi0/0's description names the switch CDP discovers on it
- BR-EDGE and the access switch are both synchronised to NTP server 10.10.10.50
- BR-EDGE sends syslog to 10.10.10.50 at level warnings, with timestamps on its log messages
- SNMP: the read-write 'public' community is gone and the NOC polls with read-only community N0c-R3ad
- CDP is off on the provider-facing Gi0/1 but still runs toward the LAN
- LLDP runs on BR-EDGE and the access switch, and each lists the other as a neighbor

## 16. Lock the Lobby Ports

The public lobby switch has two self-service kiosks and a printer port. This morning the printer was unplugged and an unknown laptop is sitting on Fa0/3, fully on the network. Every other port in the lobby is live too. Lock it down: kiosk ports may only ever talk to the kiosk that is plugged in now (sticky learning), the printer port only accepts the printer's MAC 0060.3E1A.22B4, and every unused port is shut down and parked in a black-hole VLAN.

Console that opens first: **LOBBY-SW**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| GW | Router | Gi0/0 → LOBBY-SW Gi0/1 | GW, the lobby gateway (192.168.40.1). Nothing to configure. |
| LOBBY-SW | Switch | Gi0/1 → GW Gi0/0<br>Fa0/1 → KIOSK-1 Eth0<br>Fa0/2 → KIOSK-2 Eth0<br>Fa0/3 → LAPTOP? Eth0 | LOBBY-SW, the switch you lock down. |
| KIOSK-1 | PC | Eth0 → LOBBY-SW Fa0/1 | KIOSK-1 on Fa0/1. Its MAC should be learned sticky. |
| KIOSK-2 | PC | Eth0 → LOBBY-SW Fa0/2 | KIOSK-2 on Fa0/2. Its MAC should be learned sticky. |
| LAPTOP? | PC | Eth0 → LOBBY-SW Fa0/3 | The unknown laptop on Fa0/3, the printer's port. It must be cut off. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | LOBBY-SW | `(config-if)#` via `interface range fa0/1 - 2` | LOBBY-SW opens first. On both kiosk ports at once: port security, maximum 1 MAC, sticky learning. |  |
| 2 | LOBBY-SW | `(config-if)#` via `interface fa0/3` | On the printer port: port security with only the printer's static MAC and violation mode shutdown. Watch the console: the laptop's port goes err-disabled. | `show port-security interface fa0/3` |
| 3 | LOBBY-SW | `(config-if)#` via `interface range fa0/4 - 24` | Make every unused port an access port in VLAN 999, then shut them down. |  |
| 4 | LOBBY-SW | `#` | Confirm the secure ports and the err-disabled Fa0/3. | `show interfaces status` |
| 5 | KIOSK-1 | `C:\>` | Make sure the kiosks still work. | `ping 192.168.40.1` |

Objectives:

- Fa0/1 and Fa0/2: port security, maximum 1 MAC, sticky learning (each kiosk's MAC is learned)
- Fa0/3: port security that only allows the printer's MAC 0060.3E1A.22B4, violation mode shutdown
- The unknown laptop on Fa0/3 is cut off: the port is err-disabled
- Unused ports Fa0/4 - Fa0/24 are administratively shut down
- Unused ports are access ports in black-hole VLAN 999
- With port security on, both kiosks still reach the gateway 192.168.40.1

## 17. Lock Down the Server Farm

An audit found that the guest Wi-Fi subnet can reach the file server and the staff LAN, and that the core router still allows plain-text Telnet with no passwords at all. Filter traffic with a standard ACL close to the servers and an extended ACL close to the guests, then harden the router: an encrypted enable secret, a console password, and SSH-only remote access with a local admin account.

Console that opens first: **CORE-R**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| CORE-R | Router | Gi0/0 → STAFF-PC Eth0<br>Gi0/1 → GUEST-PC Eth0<br>Gi0/2 → FILE-SRV Eth0 | CORE-R. Gi0/0 is the staff LAN, Gi0/1 the guest Wi-Fi, Gi0/2 the server farm. |
| STAFF-PC | PC | Eth0 → CORE-R Gi0/0 | STAFF-PC (192.168.10.0/24). Must still reach the file server. |
| GUEST-PC | PC | Eth0 → CORE-R Gi0/1 | GUEST-PC (192.168.30.0/24). Must lose access to the server and staff LAN. |
| FILE-SRV | Server | Eth0 → CORE-R Gi0/2 | FILE-SRV (192.168.99.10) in the server farm. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | CORE-R | `(config)#` | CORE-R opens first. Write standard ACL 10: deny the guest subnet, permit everything else. |  |
| 2 | CORE-R | `(config-if)#` via `interface g0/2` | Apply ACL 10 outbound on the server-facing port (standard ACLs go near the destination). |  |
| 3 | CORE-R | `(config)#` | Write extended ACL 110 denying guest to staff LAN, then permit ip any any. Apply it inbound on Gi0/1 (near the source). | `show access-lists` |
| 4 | GUEST-PC | `C:\>` | Test from GUEST-PC (should fail to reach FILE-SRV) and STAFF-PC (should work). | `ping 192.168.99.10` |
| 5 | CORE-R | `(config-line)#` via `line con 0` | Back on CORE-R: set the enable secret and password encryption in global config, then a console password with login. |  |
| 6 | CORE-R | `(config-line)#` via `line vty 0 4` | Prepare SSH in global config (domain name, RSA keys, version 2, local user), then make the VTY lines SSH-only with local login. | `show running-config` |

Objectives:

- Standard ACL 10 denies the guest subnet 192.168.30.0/24 and permits everyone else
- ACL 10 is applied outbound on Gi0/2, the interface closest to the servers
- Extended ACL 110 inbound on Gi0/1 blocks guests from the staff LAN but still lets them reach their gateway
- GUEST-PC cannot reach FILE-SRV, while STAFF-PC still can
- Enable secret is set, service password-encryption is on, and the console needs a password (login)
- SSH is ready: domain name set, RSA keys of 1024 bits or more, SSH version 2, and a local user
- VTY lines accept SSH only and log in with the local user database

## 18. Tighten the DMZ Firewall

The public web server in the DMZ has moved to HTTPS, and customers now get a timeout. Worse, last week's quick fix to the edge router's named ACL DMZ-IN opened Telnet from the whole Internet. Only the remote NOC at 198.51.100.50 should be able to ping the server. Edit DMZ-IN in place using its sequence numbers, without rebuilding it. Then write a second named ACL, STAFF-IN, so the staff LAN can no longer Telnet to the server in clear text, while SSH, web and ping keep working.

Console that opens first: **EDGE**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| EDGE | Router | Gi0/0 → STAFF-PC Eth0<br>Gi0/1 → WEB-DMZ Eth0<br>Gi0/2 → REMOTE-NOC Eth0 | EDGE router. Gi0/0 is the staff LAN, Gi0/1 the DMZ, Gi0/2 the Internet with named ACL DMZ-IN inbound. |
| REMOTE-NOC | PC | Eth0 → EDGE Gi0/2 | REMOTE-NOC (198.51.100.50) on the Internet side. Use it to test what the Internet can reach. |
| STAFF-PC | PC | Eth0 → EDGE Gi0/0 | STAFF-PC on the staff LAN. |
| WEB-DMZ | Server | Eth0 → EDGE Gi0/1 | WEB-DMZ (172.16.1.10), the public web server. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | EDGE | `#` | EDGE opens first. Read DMZ-IN and note its sequence numbers. | `show access-lists` |
| 2 | EDGE | `(config-ext-nacl)#` via `ip access-list extended DMZ-IN` | Delete the Telnet entry by its number, then insert entries by sequence number for HTTPS and for NOC-only ping, ahead of the final deny. |  |
| 3 | REMOTE-NOC | `C:\>` | Click REMOTE-NOC and test HTTPS, Telnet and ping to the server. | `curl https://172.16.1.10` |
| 4 | EDGE | `(config-ext-nacl)#` via `ip access-list extended STAFF-IN` | Back on EDGE, create STAFF-IN: deny Telnet from the staff LAN to the server, permit everything else. |  |
| 5 | EDGE | `(config-if)#` via `interface g0/0` | Apply STAFF-IN inbound on the staff port. |  |
| 6 | STAFF-PC | `C:\>` | From STAFF-PC, confirm SSH still works and Telnet does not. | `ssh -l admin 172.16.1.10` |

Objectives:

- Internet users reach WEB-DMZ over HTTP and HTTPS (TCP 80 and 443), with DMZ-IN still applied inbound on Gi0/2
- Telnet and SSH from the Internet to WEB-DMZ are filtered by DMZ-IN
- Only the NOC host 198.51.100.50 can ping WEB-DMZ from the Internet; other Internet hosts cannot
- Named extended ACL STAFF-IN, inbound on Gi0/0, blocks Telnet from the staff LAN to WEB-DMZ
- With STAFF-IN in place, staff can still SSH to, browse (HTTP and HTTPS) and ping WEB-DMZ

## 19. Ticket #4471: Floor 3 Is Down

Priority ticket: nobody on floor 3 can open the file share in the data centre. Last night's change window touched the floor switch, both routers and one PC, and the engineer who made the changes is on a plane. There are five separate faults. Work up the stack from the PC: addressing, VLANs, interfaces, then routing. Every objective is a symptom, so verify with show commands and ping instead of guessing.

Console that opens first: **FL3-PC1**

| Device | Type | Ports | Role |
| --- | --- | --- | --- |
| FL3-PC1 | PC | Eth0 → FL3-SW Fa0/1 | FL3-PC1. Something is wrong with its own addressing. |
| FL3-PC2 | PC | Eth0 → FL3-SW Fa0/2 | FL3-PC2. Its addressing is correct; compare against it. |
| FL3-SW | Switch | Fa0/1 → FL3-PC1 Eth0<br>Fa0/2 → FL3-PC2 Eth0<br>Gi0/1 → FL3-R Gi0/0 | FL3-SW, floor 3 access switch. Floor 3 PCs belong in VLAN 20. |
| FL3-R | Router | Gi0/0 → FL3-SW Gi0/1<br>Gi0/1 → DC-R Gi0/1 | FL3-R, floor 3 gateway (192.168.20.1) and OSPF neighbor of DC-R. |
| DC-R | Router | Gi0/1 → FL3-R Gi0/1<br>Gi0/0 → FILE-SRV Eth0 | DC-R, the data centre router. |
| FILE-SRV | Server | Eth0 → DC-R Gi0/0 | FILE-SRV (172.16.0.10), the file share nobody can reach. |

| # | Device | Mode | Do this | Verify |
| --- | --- | --- | --- | --- |
| 1 | FL3-PC1 | `C:\>` | FL3-PC1 opens first. Compare its settings with FL3-PC2's and fix the odd one out with ipconfig <ip> <mask> <gateway>. | `ipconfig` |
| 2 | FL3-SW | `#` | Click FL3-SW. Find the PC port that is not in VLAN 20 and fix it in interface config. | `show interfaces status` |
| 3 | FL3-R | `#` | Click FL3-R. Look for an interface that is down or misaddressed and fix it. | `show ip interface brief` |
| 4 | DC-R | `#` | Click DC-R. Compare its OSPF networks and areas with FL3-R's and fix the mismatch under router ospf 1. | `show ip protocols` |
| 5 | FL3-R | `#` | The adjacency should be FULL and 172.16.0.0/24 should be an O route. | `show ip ospf neighbor` |
| 6 | FL3-PC1 | `C:\>` | Ping FILE-SRV from both floor 3 PCs. | `ping 172.16.0.10` |

Objectives:

- FL3-PC1 can ping its gateway 192.168.20.1
- FL3-PC2 can ping its gateway 192.168.20.1
- FL3-R and DC-R form a FULL OSPF adjacency
- FL3-R learns the data centre LAN 172.16.0.0/24 from OSPF
- FL3-PC1 can reach FILE-SRV (172.16.0.10)
- FL3-PC2 can reach FILE-SRV (172.16.0.10)
