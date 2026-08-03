-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('CANVAS', 'SYLLABUS', 'MANUAL');

-- CreateEnum
CREATE TYPE "StruggleType" AS ENUM ('MISSED_CLUSTER', 'GRADE_SLIDE', 'SUBMISSION_SILENCE', 'WORKLOAD_SPIKE', 'OVERDUE_PILEUP');

-- CreateEnum
CREATE TYPE "GradeCategorySource" AS ENUM ('SYLLABUS', 'MANUAL');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "gradeCategoryId" TEXT,
ADD COLUMN     "source" "AssignmentSource" NOT NULL DEFAULT 'CANVAS',
ALTER COLUMN "canvasId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StruggleFlag" (
    "id" TEXT NOT NULL,
    "type" "StruggleType" NOT NULL,
    "courseId" TEXT,
    "severity" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT[],
    "signature" TEXT NOT NULL,
    "explainedBy" TEXT NOT NULL DEFAULT 'rules',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "StruggleFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyRetro" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "summaryText" TEXT NOT NULL,
    "wins" TEXT[],
    "struggles" TEXT[],
    "adjustments" TEXT[],
    "assignmentsCompleted" INTEGER NOT NULL DEFAULT 0,
    "assignmentsMissed" INTEGER NOT NULL DEFAULT 0,
    "minutesLogged" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyRetro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeCategory" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightPercent" DOUBLE PRECISION NOT NULL,
    "source" "GradeCategorySource" NOT NULL DEFAULT 'SYLLABUS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyllabusImport" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "datesFound" INTEGER NOT NULL DEFAULT 0,
    "categoriesFound" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT[],
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyllabusImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StruggleFlag_signature_key" ON "StruggleFlag"("signature");

-- CreateIndex
CREATE INDEX "StruggleFlag_resolved_severity_idx" ON "StruggleFlag"("resolved", "severity");

-- CreateIndex
CREATE INDEX "StruggleFlag_courseId_idx" ON "StruggleFlag"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyRetro_weekStart_key" ON "WeeklyRetro"("weekStart");

-- CreateIndex
CREATE INDEX "GradeCategory_courseId_idx" ON "GradeCategory"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeCategory_courseId_name_key" ON "GradeCategory"("courseId", "name");

-- CreateIndex
CREATE INDEX "SyllabusImport_courseId_createdAt_idx" ON "SyllabusImport"("courseId", "createdAt");

-- CreateIndex
CREATE INDEX "Assignment_gradeCategoryId_idx" ON "Assignment"("gradeCategoryId");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_gradeCategoryId_fkey" FOREIGN KEY ("gradeCategoryId") REFERENCES "GradeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StruggleFlag" ADD CONSTRAINT "StruggleFlag_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeCategory" ADD CONSTRAINT "GradeCategory_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusImport" ADD CONSTRAINT "SyllabusImport_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
