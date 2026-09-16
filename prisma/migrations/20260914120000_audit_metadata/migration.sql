-- CreateEnum
CREATE TYPE "InitiatorKind" AS ENUM ('HUMAN', 'AGENT');

-- AlterTable
ALTER TABLE "Forecast" ADD COLUMN     "agentSessionId" TEXT,
ADD COLUMN     "initiator" "InitiatorKind" NOT NULL DEFAULT 'HUMAN';

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "agentSessionId" TEXT,
ADD COLUMN     "initiator" "InitiatorKind" NOT NULL DEFAULT 'HUMAN';

