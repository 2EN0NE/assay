-- ADR-0037：决策叙事在揭晓后冻结；事后表达走独立的复盘记录。
--
-- 两件事：
--   1) `Decision.rubricLockedAt` → `lockedAt`。同一个判据现在管两样东西（清单只读、
--      叙事冻结），而它写入的是"观察到的锁定时点"，所以叫 lockedAt 才是它在说的事。
--   2) 新增 `DecisionReflection`：只增不改的事后表达通道。
--
-- ⚠️ 第 1 条必须用 RENAME COLUMN，**不得**退化成 DROP + ADD：那会静默丢掉每一行
-- 已有的锁定时点，而 CI 在空库上跑、看不见这个。`scripts/verify-migration-upgrade.ts`
-- 里有一条保值断言守着。
ALTER TABLE "Decision" RENAME COLUMN "rubricLockedAt" TO "lockedAt";

-- CreateTable
CREATE TABLE "DecisionReflection" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionReflection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisionReflection_decisionId_idx" ON "DecisionReflection"("decisionId");

-- AddForeignKey
ALTER TABLE "DecisionReflection" ADD CONSTRAINT "DecisionReflection_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
