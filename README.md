# PacketQuest

A gamified, browser-based lab simulator for network certifications. CCNA (Cisco 200-301) is the first course; F5 and Palo Alto tracks will plug into the same platform.

> "PacketQuest" is a placeholder name. Change it in `src/lib/site.ts`.

## Stack

- **Next.js 16** (App Router) + **Tailwind CSS 4** + **lucide-react**
- **Supabase** for sign-in (email + password) and the database (profiles, XP, lab progress, subscriptions)
- **Stripe** for the Pro subscription (Checkout + Billing Portal + webhook)
- Deploys to **Vercel**

## How access works

| Plan | What it unlocks |
| --- | --- |
| Free | Labs marked `free: true` in `src/lib/courses.ts` (the first lab of each course) |
| Pro (monthly subscription) | Every lab in every course |

The paywall is checked on the server (`src/lib/entitlements.ts`) when a lab page loads and when progress is saved. XP is calculated on the server from the course catalog, and the database only lets the server write XP and subscriptions, so players can't edit them from the browser.

## Project layout

```
src/
  app/
    page.tsx                  Landing page
    login/                    Sign in / sign up (server actions)
    auth/callback, signout    Supabase email-link and sign-out handlers
    dashboard/                Rank, XP bar, courses and lab list
    pricing/                  Free vs Pro, Stripe checkout
    labs/[course]/[lab]/      Lab workspace (Pro and mission-order gated on the server)
    api/stripe/checkout       Starts a Stripe Checkout session
    api/stripe/portal         Opens the Stripe Billing Portal
    api/stripe/webhook        Mirrors Stripe subscriptions into Supabase
    api/progress              Records a completed lab and awards XP once
  engine/
    types.ts                  Vendor-neutral engine + lab contracts
    cisco/                    Cisco IOS emulator (parser, modes, show, ping, OSPF, STP, DTP, ACLs, NAT, DHCP, HSRP, IPv6, NTP/CDP/LLDP)
  labs/
    ccna/*.ts                 Lab definitions: topology, start state, objectives, hints
    guides.ts                 Lab Guide walkthroughs, device roles, UI glossary
  components/lab/             Topology SVG, terminal, workspace, cheat sheet, lab guide
  lib/
    courses.ts                Course + lab catalog (add new vendors here)
    progression.ts            Mission unlock order and domain badges
    entitlements.ts           Free vs Pro checks
    ranks.ts                  Rank ladder (Cable Crimper -> CCNA Architect)
    supabase/                 Browser, server and service-role clients
  proxy.ts                    Refreshes the session, protects /dashboard and /labs
supabase/migrations/          Database schema, row-level security, XP function
```

## Payments mode

Set `PAYMENTS_MODE` to choose how Pro works:

| Value | What happens | Needs |
| --- | --- | --- |
| `off` | "Unlock Pro (free)" gives the signed-in user Pro straight away, no checkout | Supabase only |
| `stripe` | "Upgrade to Pro" opens Stripe Checkout for the monthly subscription | Supabase + Stripe |

If `PAYMENTS_MODE` is not set, the app uses `stripe` when `STRIPE_SECRET_KEY` is set and `off` otherwise. Users unlocked in `off` mode keep Pro after you switch to `stripe` (their subscription row has an ID starting with `free-unlock-`); remove those rows in Supabase if you want them to pay.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste `supabase/migrations/0001_init.sql`, and run it.
3. Under **Authentication -> URL Configuration**, set the Site URL to your app URL and add `<your-url>/auth/callback` to the redirect URLs.
4. Copy the project URL, anon key and service-role key from **Project Settings -> API**.

### 2. Stripe (start in test mode; skip this whole step with `PAYMENTS_MODE=off`)

1. Create a product "Pro" with a **recurring monthly price**. Copy its price ID (`price_...`).
2. Turn on the **Customer portal** under Settings -> Billing -> Customer portal.
3. Add a webhook endpoint at `<your-url>/api/stripe/webhook` with these events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy its signing secret (`whsec_...`).
   For local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

### 3. Environment

```bash
cp .env.example .env.local   # then fill in the values
npm install
npm run dev
```

### 4. Deploy to Vercel

Import the GitHub repo in Vercel, add the same environment variables (with `NEXT_PUBLIC_SITE_URL` set to the production URL), and deploy.

## Labs

| # | Lab | Domain | What the student does |
| --- | --- | --- | --- |
| 1 | Branch Router Bring-up (free) | Network Fundamentals | Hostname, interface IP, `no shutdown`, ping, save config |
| 2 | Carve Up the /24 | Network Fundamentals | VLSM a /24 into /25, /26 and /27 subnets, address the router and PCs |
| 3 | Sales VLAN Cannot Reach the Gateway | Switching & VLANs | Create VLAN 10, access ports, uplink, keep guest isolated, management SVI |
| 4 | Route Between the VLANs | Switching & VLANs | Router-on-a-stick: trunk the uplink, 802.1Q subinterfaces as VLAN gateways |
| 5 | The Wrong Root Bridge | Switching & STP | Restore a VLAN and trunk, make the core the STP root, Rapid PVST+, PortFast and BPDU Guard |
| 6 | Double the Uplink | Switching & STP | LACP EtherChannel with interface range, trunk the port-channel, STP sees one link |
| 7 | Seal the Trunk | Switching & VLANs | Fix a DTP/access mismatch, static trunk with nonegotiate, unused native VLAN, allowed VLAN list |
| 8 | Two Sites, One Network | IP Routing | Address a router, bring up a /30 WAN, OSPF area 0 with router IDs, end-to-end ping |
| 9 | Elect the Right DR | IP Routing | OSPF DR/BDR election with interface priority, passive interfaces, `default-information originate` |
| 10 | Backup Link Failover | IP Routing | Static and default routes with floating statics (AD 10) over a backup path |
| 11 | IPv6 Comes to the Branch | IP Routing | IPv6 unicast routing, addressing, SLAAC with EUI-64, IPv6 static and default routes |
| 12 | The Gateway That Never Dies | IP Routing | HSRP virtual gateway, priority and preempt, proven failover |
| 13 | Branch Internet Edge | IP Services | DHCP server with exclusions, PAT (NAT overload) and static NAT for a web server |
| 14 | The Branch Gets No Lease | IP Services | Central DHCP pool, `ip helper-address` relay, the return route the server needs |
| 15 | Put the Branch on the NOC's Radar | IP Services | CDP discovery, NTP, syslog level and timestamps, read-only SNMP, CDP off at the edge, LLDP |
| 16 | Lock the Lobby Ports | Security | Port security with sticky and static MACs, err-disable a rogue laptop, black-hole VLAN |
| 17 | Lock Down the Server Farm | Security | Standard and extended ACLs, enable secret, console password, SSH-only VTY |
| 18 | Tighten the DMZ Firewall | Security | Edit a named ACL by sequence number, TCP port filters (HTTP/HTTPS/Telnet/SSH), tested with curl and telnet |
| 19 | Ticket #4471: Floor 3 Is Down | Troubleshooting | Find five planted faults: gateway, VLAN, shutdown, mask and OSPF area mismatches |

Labs unlock in order. A lab a player already completed stays open even if a new lab is inserted before it.

## Running a lab

1. Sign in and open the **dashboard**. Pick the next open mission on the mission map; missions unlock in order.
2. Read the **incident briefing** at the top of the lab, then open **Lab Guide** for that lab's step-by-step walkthrough.
3. **Click a device** on the topology to open its console. Network gear starts at the `>` prompt: `enable` (`en`) gets you to `#`, `configure terminal` (`conf t`) to `(config)#`, and from there `interface g0/0`, `router ospf 1`, `vlan 10`, `ip dhcp pool X`, `line vty 0 4` or `ip access-list extended X` enter their sub-modes. `exit` goes up one level, `end` (or Ctrl+Z) back to `#`. PCs have no modes: use `ipconfig`, `ipconfig /dhcp`, `ping`, `curl`, `telnet` and `ssh`.
4. **Verify** with `show` commands and `ping`. Objectives tick themselves off as soon as the network is right, in any order.
5. Tick every objective to see the victory screen, earn XP and unlock the next mission. Stuck? **Request Tier-2 Support** reveals the next hint (with exact commands) for a small XP cost. **Reset Lab** starts over.

Per-lab walkthroughs (devices, ports, roles and steps for all 19 labs) are in [docs/LABS.md](docs/LABS.md), which mirrors `src/labs/guides.ts`.

## What each component does

### In the network

| Component | What it does |
| --- | --- |
| Router | Layer 3: routes packets between IP networks using connected, static and OSPF routes. Each interface is its own subnet. Ports start shut down. |
| Switch | Layer 2: forwards frames inside a VLAN by MAC address. Access ports carry one VLAN, trunks carry many with 802.1Q tags. Ports start enabled in VLAN 1. |
| PC | End host: set or lease an address with `ipconfig`, test with `ping`, `curl`, `telnet`, `ssh`. |
| Server | End host offering a service (file, web, NTP/syslog). Usually a test target. |
| Gi0/x (GigabitEthernet) | 1 Gbit/s router ports and switch uplinks. `Gi0/0.10` is a subinterface for VLAN 10. |
| Fa0/x (FastEthernet) | 100 Mbit/s switch access ports for PCs. |
| Eth0 | A PC's or server's network card. |
| Vlan10 (SVI) | A switch's virtual interface, used for its management address. |
| Po1 (Port-channel) | An EtherChannel bundle of physical links acting as one. |
| Link lights | Green: up and forwarding. Amber: up but blocked by spanning tree. Red: down. A dashed grey line is not up at both ends. |

### In the app

| Part | What it does |
| --- | --- |
| HUD | Rank and level, XP bar to the next rank, streak of consecutive valid commands, one badge per exam domain. |
| Mission map | Dashboard skill tree of the five CCNA domains and their missions. Crown = Pro, lock = finish the previous mission. |
| How to run a lab | Collapsible dashboard panel with the play loop and this table. |
| Incident briefing | The scenario and what done looks like. |
| Topology panel | SVG network diagram; click a device to switch the console to it. |
| CLI terminal | Simulated Cisco IOS: modes, abbreviations, Tab completion, `?` help, Up/Down history, IOS error messages. |
| Objectives | Live checklist driven by the simulated network state. |
| Request Tier-2 Support | Progressive hints, each costing XP. |
| Lab Guide | Per-lab walkthrough, device roles and ports, IOS modes, and this workspace glossary. |
| Cheat Sheet | Command quick reference by topic. |
| Reset Lab | Restores the starting config. |
| Victory screen | XP earned, best streak, commands used, link to the next mission. |

## Tests

```bash
npm test
```

Engine tests cover parsing, modes, error messages, VLANs, DTP and trunk settings, STP, EtherChannel, port security, router-on-a-stick, static and floating static routes, OSPF (including DR election), HSRP, IPv6, standard, extended and named ACLs, NAT, DHCP and DHCP relay, NTP, CDP and LLDP. Every lab is also played with a reference solution, which must complete all objectives without a CLI error, and every Lab Guide step is checked against the topology, with its verify command run through the CLI.

## Adding a lab

Create `src/labs/<course>/<lab>.ts` exporting a `LabDefinition`, register it in `src/labs/index.ts`, add its walkthrough and device roles to `src/labs/guides.ts`, add it to the catalog in `src/lib/courses.ts`, and add its reference solution to `src/labs/labs.test.ts`.

## Adding a new vendor course

1. Add an entry to `COURSES` in `src/lib/courses.ts` with its labs.
2. Implement `VendorEngine` from `src/engine/types.ts` for that vendor's CLI (for example `src/engine/f5/`).
3. Write lab definitions that use the new engine.

Auth, billing, progress, the HUD and the workspace UI need no changes.
