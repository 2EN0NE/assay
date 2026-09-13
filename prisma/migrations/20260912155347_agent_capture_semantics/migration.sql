-- CreateEnum
CREATE TYPE "PredictionOracleKind" AS ENUM ('PUBLIC_FACT', 'AGENT_OBSERVABLE', 'SELF_REPORT');

-- CreateEnum
CREATE TYPE "RecordProvenance" AS ENUM ('HUMAN', 'AGENT', 'AGENT_INSTRUCTED');

-- CreateEnum
CREATE TYPE "DeliveryState" AS ENUM ('PENDING', 'DELIVERED', 'NOT_NEEDED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "Forecast" ADD COLUMN     "endorsed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "endorsedAt" TIMESTAMP(3),
ADD COLUMN     "provenance" "RecordProvenance" NOT NULL DEFAULT 'HUMAN';

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "oracleKind" "PredictionOracleKind" NOT NULL DEFAULT 'PUBLIC_FACT',
ADD COLUMN     "provenance" "RecordProvenance" NOT NULL DEFAULT 'HUMAN',
ADD COLUMN     "resolutionCriteria" TEXT,
ADD COLUMN     "scoringAnchor" TEXT,
ADD COLUMN     "resolutionSource" TEXT,
ADD COLUMN     "resolutionRationale" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveredVia" TEXT,
ADD COLUMN     "deliveryState" "DeliveryState" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Notification_userId_deliveryState_idx" ON "Notification"("userId", "deliveryState");

-- CreateTable
CREATE TABLE "Revision" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "questionId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,

    CONSTRAINT "Revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResolutionProposal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "questionId" TEXT NOT NULL,
    "resolution" "Resolution" NOT NULL,
    "source" TEXT,
    "rationale" TEXT,
    "proposedBy" TEXT NOT NULL DEFAULT 'agent',
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ResolutionProposal_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Revision_questionId_idx" ON "Revision"("questionId");

-- CreateIndex
CREATE INDEX "ResolutionProposal_questionId_idx" ON "ResolutionProposal"("questionId");

-- CreateIndex
CREATE INDEX "ResolutionProposal_status_idx" ON "ResolutionProposal"("status");

