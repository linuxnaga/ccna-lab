/**
 * Course catalog. Each vendor track is a course; each course has labs.
 * New vendors (F5, Palo Alto, ...) are added here and get their own CLI
 * engine in step 2 without touching auth, billing or progress code.
 */
/** XP deducted per hint ("Request Tier-2 Support"). */
export const HINT_COST = 25;

export type CourseStatus = "available" | "coming-soon";

export interface LabSummary {
  id: string;
  title: string;
  domain: string;
  /** Free labs are playable without a subscription. */
  free: boolean;
  xp: number;
}

export interface Course {
  id: string;
  vendor: string;
  title: string;
  exam: string;
  status: CourseStatus;
  accent: "cyan" | "emerald" | "amber" | "rose";
  description: string;
  domains: string[];
  labs: LabSummary[];
}

export const COURSES: Course[] = [
  {
    id: "ccna",
    vendor: "Cisco",
    title: "CCNA Lab Simulator",
    exam: "200-301",
    status: "available",
    accent: "cyan",
    description:
      "Hands-on Cisco IOS labs: subnetting, VLANs, routing, IP services and security.",
    domains: [
      "Network Fundamentals & Subnetting",
      "Switching, VLANs & STP",
      "IP Routing (Static & OSPF)",
      "IP Services (NAT, DHCP, ACLs)",
      "Security & Troubleshooting",
    ],
    labs: [
      { id: "router-interface", title: "Branch Router Bring-up", domain: "Network Fundamentals & Subnetting", free: true, xp: 150 },
      { id: "vlan-access", title: "Sales VLAN Cannot Reach the Gateway", domain: "Switching, VLANs & STP", free: false, xp: 250 },
      { id: "static-ospf", title: "Two Sites, One Network", domain: "IP Routing (Static & OSPF)", free: false, xp: 350 },
    ],
  },
  {
    id: "f5",
    vendor: "F5",
    title: "F5 BIG-IP Labs",
    exam: "F5-CA",
    status: "coming-soon",
    accent: "rose",
    description: "Virtual servers, pools, monitors and iRules on a simulated BIG-IP.",
    domains: [],
    labs: [],
  },
  {
    id: "paloalto",
    vendor: "Palo Alto Networks",
    title: "PAN-OS Firewall Labs",
    exam: "PCNSA",
    status: "coming-soon",
    accent: "amber",
    description: "Zones, security policies and NAT on a simulated PAN-OS firewall.",
    domains: [],
    labs: [],
  },
];

export function getCourse(id: string): Course | undefined {
  return COURSES.find((c) => c.id === id);
}

export function getLab(courseId: string, labId: string): LabSummary | undefined {
  return getCourse(courseId)?.labs.find((l) => l.id === labId);
}
