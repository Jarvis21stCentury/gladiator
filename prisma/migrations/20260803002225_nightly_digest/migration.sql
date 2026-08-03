-- CreateEnum
CREATE TYPE "DigestSourceKind" AS ENUM ('CANVAS_MODULE_ITEM', 'CANVAS_ANNOUNCEMENT', 'TEXTBOOK_IMAGE', 'TEXTBOOK_PDF');

-- CreateEnum
CREATE TYPE "LessonNoteSourceType" AS ENUM ('CANVAS', 'TEXTBOOK', 'MIXED');

-- CreateTable
CREATE TABLE "DigestSource" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "courseId" TEXT NOT NULL,
    "kind" "DigestSourceKind" NOT NULL,
    "externalId" TEXT,
    "label" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "includeInDigest" BOOLEAN NOT NULL DEFAULT true,
    "lessonNoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonNote" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "courseId" TEXT NOT NULL,
    "sourceType" "LessonNoteSourceType" NOT NULL,
    "rawInputRef" TEXT,
    "keyPoints" TEXT[],
    "generatedSummary" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigestSource_externalId_key" ON "DigestSource"("externalId");

-- CreateIndex
CREATE INDEX "DigestSource_courseId_date_idx" ON "DigestSource"("courseId", "date");

-- CreateIndex
CREATE INDEX "DigestSource_lessonNoteId_idx" ON "DigestSource"("lessonNoteId");

-- CreateIndex
CREATE INDEX "LessonNote_date_idx" ON "LessonNote"("date");

-- CreateIndex
CREATE UNIQUE INDEX "LessonNote_courseId_date_key" ON "LessonNote"("courseId", "date");

-- AddForeignKey
ALTER TABLE "DigestSource" ADD CONSTRAINT "DigestSource_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestSource" ADD CONSTRAINT "DigestSource_lessonNoteId_fkey" FOREIGN KEY ("lessonNoteId") REFERENCES "LessonNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonNote" ADD CONSTRAINT "LessonNote_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
