import type { LabDefinition } from "@/engine/types";
import { routerInterfaceLab } from "./ccna/router-interface";
import { vlanAccessLab } from "./ccna/vlan-access";
import { staticOspfLab } from "./ccna/static-ospf";
import { subnetVlsmLab } from "./ccna/subnet-vlsm";
import { stpRootLab } from "./ccna/stp-root";
import { floatingStaticLab } from "./ccna/floating-static";
import { dhcpNatLab } from "./ccna/dhcp-nat";
import { aclHardeningLab } from "./ccna/acl-hardening";
import { troubleshootLab } from "./ccna/troubleshoot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLab = LabDefinition<any>;

/** Playable lab definitions, keyed by "course/lab". Must match src/lib/courses.ts. */
export const LABS: Record<string, AnyLab> = {
  "ccna/router-interface": routerInterfaceLab,
  "ccna/subnet-vlsm": subnetVlsmLab,
  "ccna/vlan-access": vlanAccessLab,
  "ccna/stp-root": stpRootLab,
  "ccna/static-ospf": staticOspfLab,
  "ccna/floating-static": floatingStaticLab,
  "ccna/dhcp-nat": dhcpNatLab,
  "ccna/acl-hardening": aclHardeningLab,
  "ccna/troubleshoot": troubleshootLab,
};

export function getLabDefinition(courseId: string, labId: string): AnyLab | undefined {
  return LABS[`${courseId}/${labId}`];
}
