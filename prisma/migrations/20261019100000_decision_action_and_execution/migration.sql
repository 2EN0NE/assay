-- ADR-0041：决策动作（承诺半边）+ 执行事实（只增不改的事件流）。
--
-- 只有新增：两条允许为空的新列、一张新表、一个枚举。
-- **没有回填、没有收紧既有约束**，因此按 AGENTS.md 的规则不需要在
-- `scripts/verify-migration-upgrade.ts` 里补检查（那个脚本只覆盖"动老数据"的迁移）。
ALTER TABLE "Decision" ADD COLUMN "action" TEXT;
ALTER TABLE "Decision" ADD COLUMN "actionDueAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "ExecutionKind" AS ENUM ('EXECUTED', 'ABANDONED');

-- CreateTable
CREATE TABLE "DecisionExecution" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "kind" "ExecutionKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisionExecution_decisionId_idx" ON "DecisionExecution"("decisionId");

-- AddForeignKey
ALTER TABLE "DecisionExecution" ADD CONSTRAINT "DecisionExecution_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
