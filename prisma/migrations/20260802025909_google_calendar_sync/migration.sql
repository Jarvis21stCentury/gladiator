-- AlterEnum
ALTER TYPE "SyncMode" ADD VALUE 'GOOGLE_CALENDAR';

-- AlterTable
ALTER TABLE "CalendarBlock" ADD COLUMN     "deletedInGoogle" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "googleCalendarId" TEXT,
ADD COLUMN     "lastPushedAt" TIMESTAMP(3),
ADD COLUMN     "userModified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN     "eventsCreated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "eventsSkipped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "eventsUpdated" INTEGER NOT NULL DEFAULT 0;
