-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('CANVAS_API', 'ICAL_FALLBACK');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "CalendarBlockType" AS ENUM ('ASSIGNMENT', 'TEST', 'PROJECT', 'STUDY', 'PERSONAL');

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "canvasId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "term" TEXT,
    "currentGradePercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "canvasId" INTEGER NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "pointsPossible" DOUBLE PRECISION,
    "submitted" BOOLEAN NOT NULL DEFAULT false,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeSnapshot" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "gradePercent" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarBlock" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "type" "CalendarBlockType" NOT NULL,
    "googleEventId" TEXT,
    "linkedAssignmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "canvasId" INTEGER NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "postedAt" TIMESTAMP(3),
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "mode" "SyncMode" NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "coursesSynced" INTEGER NOT NULL DEFAULT 0,
    "assignmentsSynced" INTEGER NOT NULL DEFAULT 0,
    "announcementsSynced" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Course_canvasId_key" ON "Course"("canvasId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_canvasId_key" ON "Assignment"("canvasId");

-- CreateIndex
CREATE INDEX "Assignment_courseId_idx" ON "Assignment"("courseId");

-- CreateIndex
CREATE INDEX "Assignment_dueAt_idx" ON "Assignment"("dueAt");

-- CreateIndex
CREATE INDEX "GradeSnapshot_courseId_date_idx" ON "GradeSnapshot"("courseId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GradeSnapshot_courseId_date_key" ON "GradeSnapshot"("courseId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarBlock_googleEventId_key" ON "CalendarBlock"("googleEventId");

-- CreateIndex
CREATE INDEX "CalendarBlock_start_idx" ON "CalendarBlock"("start");

-- CreateIndex
CREATE INDEX "CalendarBlock_linkedAssignmentId_idx" ON "CalendarBlock"("linkedAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Announcement_canvasId_key" ON "Announcement"("canvasId");

-- CreateIndex
CREATE INDEX "Announcement_courseId_postedAt_idx" ON "Announcement"("courseId", "postedAt");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeSnapshot" ADD CONSTRAINT "GradeSnapshot_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarBlock" ADD CONSTRAINT "CalendarBlock_linkedAssignmentId_fkey" FOREIGN KEY ("linkedAssignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
