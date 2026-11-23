import type { Course } from "./courses";

/**
 * Labs unlock in order: the first is open, each next one needs the previous
 * completed. A lab you already completed stays open, so inserting a new lab
 * earlier in the path never locks a player out of finished work.
 */
export function isUnlocked(course: Course, labId: string, completed: Set<string>): boolean {
  const i = course.labs.findIndex((l) => l.id === labId);
  if (i <= 0) return i === 0;
  return completed.has(labId) || completed.has(course.labs[i - 1].id);
}

export interface Badge {
  domain: string;
  /** Domain has at least one lab yet. */
  available: boolean;
  earned: boolean;
}

/** One badge per exam domain, earned when every lab in that domain is complete. */
export function domainBadges(course: Course, completed: Set<string>): Badge[] {
  return course.domains.map((domain) => {
    const labs = course.labs.filter((l) => l.domain === domain);
    return { domain, available: labs.length > 0, earned: labs.length > 0 && labs.every((l) => completed.has(l.id)) };
  });
}
