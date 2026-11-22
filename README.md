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
    cisco/                    Cisco IOS emulator (parser, modes, show, ping, OSPF)
  labs/
    ccna/*.ts                 Lab definitions: topology, start state, objectives, hints
  components/lab/             Topology SVG, terminal, workspace, cheat sheet
  lib/
    courses.ts                Course + lab catalog (add new vendors here)
    progression.ts            Mission unlock order and domain badges
    entitlements.ts           Free vs Pro checks
    ranks.ts                  Rank ladder (Cable Crimper -> CCNA Architect)
    supabase/                 Browser, server and service-role clients
  proxy.ts                    Refreshes the session, protects /dashboard and /labs
supabase/migrations/          Database schema, row-level security, XP function
```

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste `supabase/migrations/0001_init.sql`, and run it.
3. Under **Authentication -> URL Configuration**, set the Site URL to your app URL and add `<your-url>/auth/callback` to the redirect URLs.
4. Copy the project URL, anon key and service-role key from **Project Settings -> API**.

### 2. Stripe (start in test mode)

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
| 2 | Sales VLAN Cannot Reach the Gateway | Switching & VLANs | Create VLAN 10, access ports, uplink, keep guest isolated, management SVI |
| 3 | Two Sites, One Network | IP Routing | Address a router, bring up a /30 WAN, OSPF area 0 with router IDs, end-to-end ping |

## Tests

```bash
npm test
```

Engine tests cover parsing, modes, error messages, VLANs, static routes and OSPF. Every lab is also played with a reference solution, which must complete all objectives without a CLI error.

## Adding a lab

Create `src/labs/<course>/<lab>.ts` exporting a `LabDefinition`, register it in `src/labs/index.ts`, add it to the catalog in `src/lib/courses.ts`, and add its reference solution to `src/labs/labs.test.ts`.

## Adding a new vendor course

1. Add an entry to `COURSES` in `src/lib/courses.ts` with its labs.
2. Implement `VendorEngine` from `src/engine/types.ts` for that vendor's CLI (for example `src/engine/f5/`).
3. Write lab definitions that use the new engine.

Auth, billing, progress, the HUD and the workspace UI need no changes.
