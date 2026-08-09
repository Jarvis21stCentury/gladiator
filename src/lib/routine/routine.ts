import "server-only";

import { prisma } from "@/lib/prisma";

import type { RoutineBlockRecord } from "./model";

/**
 * Reading the stored routine. The logic that turns it into free time is pure
 * and lives in `model.ts`, so the editor can share it — see the note there.
 */

/** Every block, ordered for display: by day, then by time. */
export async function getRoutine(): Promise<RoutineBlockRecord[]> {
  return prisma.routineBlock.findMany({
    orderBy: [{ dayOfWeek: "asc" }, { startMinutes: "asc" }],
  });
}
