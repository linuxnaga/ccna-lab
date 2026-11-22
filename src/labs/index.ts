import type { LabDefinition } from "@/engine/types";
import { routerInterfaceLab } from "./ccna/router-interface";
import { vlanAccessLab } from "./ccna/vlan-access";
import { staticOspfLab } from "./ccna/static-ospf";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLab = LabDefinition<any>;

/** Playable lab definitions, keyed by "course/lab". Must match src/lib/courses.ts. */
export const LABS: Record<string, AnyLab> = {
  "ccna/router-interface": routerInterfaceLab,
  "ccna/vlan-access": vlanAccessLab,
  "ccna/static-ospf": staticOspfLab,
};

export function getLabDefinition(courseId: string, labId: string): AnyLab | undefined {
  return LABS[`${courseId}/${labId}`];
}
