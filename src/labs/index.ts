import type { LabDefinition } from "@/engine/types";
import { routerInterfaceLab } from "./ccna/router-interface";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLab = LabDefinition<any>;

/** Playable lab definitions, keyed by "course/lab". Must match src/lib/courses.ts. */
export const LABS: Record<string, AnyLab> = {
  "ccna/router-interface": routerInterfaceLab,
};

export function getLabDefinition(courseId: string, labId: string): AnyLab | undefined {
  return LABS[`${courseId}/${labId}`];
}
