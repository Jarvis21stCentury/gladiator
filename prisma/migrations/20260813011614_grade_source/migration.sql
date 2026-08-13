-- CreateEnum
CREATE TYPE "GradeSource" AS ENUM ('CANVAS', 'HAC', 'MANUAL');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "gradeSource" "GradeSource";
