/*
  Warnings:

  - You are about to drop the column `note` on the `DecisionRubricEntry` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Decision" ADD COLUMN "rubricVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "DecisionRubricEntry" DROP COLUMN "note";
