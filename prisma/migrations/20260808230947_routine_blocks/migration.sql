-- CreateEnum
CREATE TYPE "RoutineKind" AS ENUM ('SLEEP', 'SCHOOL', 'ACTIVITY', 'PERSONAL');

-- CreateTable
CREATE TABLE "RoutineBlock" (
    "id" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "kind" "RoutineKind" NOT NULL DEFAULT 'ACTIVITY',
    "label" TEXT NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutineBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutineBlock_dayOfWeek_idx" ON "RoutineBlock"("dayOfWeek");
