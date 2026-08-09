-- CreateEnum
CREATE TYPE "PlanBlockKind" AS ENUM ('WORK', 'BREAK', 'MEAL');

-- AlterTable
ALTER TABLE "PlanTask" ADD COLUMN     "endAt" TIMESTAMP(3),
ADD COLUMN     "kind" "PlanBlockKind" NOT NULL DEFAULT 'WORK',
ADD COLUMN     "startAt" TIMESTAMP(3);
