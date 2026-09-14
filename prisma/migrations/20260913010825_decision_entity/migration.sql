-- CreateEnum
CREATE TYPE "RubricItemStatus" AS ENUM ('DONE', 'NOT_DONE');

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "decisionId" TEXT;

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "reasoning" TEXT,
    "expectedOutcome" TEXT,
    "knownInfo" TEXT,
    "unknownInfo" TEXT,
    "rubricLockedAt" TIMESTAMP(3),

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionRubricEntry" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "status" "RubricItemStatus" NOT NULL,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionRubricEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Decision_userId_idx" ON "Decision"("userId");

-- CreateIndex
CREATE INDEX "DecisionRubricEntry_decisionId_idx" ON "DecisionRubricEntry"("decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionRubricEntry_decisionId_itemKey_key" ON "DecisionRubricEntry"("decisionId", "itemKey");

-- CreateIndex
CREATE INDEX "Question_decisionId_idx" ON "Question"("decisionId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRubricEntry" ADD CONSTRAINT "DecisionRubricEntry_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
