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
import { interVlanLab } from "./ccna/inter-vlan";
import { etherchannelLab } from "./ccna/etherchannel";
import { ipv6RoutingLab } from "./ccna/ipv6-routing";
import { hsrpLab } from "./ccna/hsrp";
import { portSecurityLab } from "./ccna/port-security";
import { trunkSecurityLab } from "./ccna/trunk-security";
import { ospfDrLab } from "./ccna/ospf-dr";
import { dhcpRelayLab } from "./ccna/dhcp-relay";
import { deviceMgmtLab } from "./ccna/device-mgmt";
import { namedAclLab } from "./ccna/named-acl";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLab = LabDefinition<any>;

/** Playable lab definitions, keyed by "course/lab". Must match src/lib/courses.ts. */
export const LABS: Record<string, AnyLab> = {
  "ccna/router-interface": routerInterfaceLab,
  "ccna/subnet-vlsm": subnetVlsmLab,
  "ccna/vlan-access": vlanAccessLab,
  "ccna/inter-vlan": interVlanLab,
  "ccna/stp-root": stpRootLab,
  "ccna/etherchannel": etherchannelLab,
  "ccna/trunk-security": trunkSecurityLab,
  "ccna/static-ospf": staticOspfLab,
  "ccna/ospf-dr": ospfDrLab,
  "ccna/floating-static": floatingStaticLab,
  "ccna/ipv6-routing": ipv6RoutingLab,
  "ccna/hsrp": hsrpLab,
  "ccna/dhcp-nat": dhcpNatLab,
  "ccna/dhcp-relay": dhcpRelayLab,
  "ccna/device-mgmt": deviceMgmtLab,
  "ccna/port-security": portSecurityLab,
  "ccna/acl-hardening": aclHardeningLab,
  "ccna/named-acl": namedAclLab,
  "ccna/troubleshoot": troubleshootLab,
};

export function getLabDefinition(courseId: string, labId: string): AnyLab | undefined {
  return LABS[`${courseId}/${labId}`];
}
