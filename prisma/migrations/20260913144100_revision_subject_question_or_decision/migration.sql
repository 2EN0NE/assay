-- AlterTable
ALTER TABLE "Revision" ADD COLUMN     "decisionId" TEXT,
ALTER COLUMN "questionId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Revision_decisionId_idx" ON "Revision"("decisionId");

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ADR-0012：修订的主体既可能是 Question（冻结字段）也可能是 Decision（叙事字段），
-- 二者**恰有其一**。这条不变量 Prisma schema 表达不了，只能落在 CHECK 上——写在
-- 这里而不是靠应用层自觉：应用层漏一处就会产生一条既不属于预测、也不属于决策的
-- 修订记录，而它在复盘视图里永远不会出现（也就是"留了痕但没人看得见"）。
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_subject_exactly_one"
  CHECK ((("questionId" IS NOT NULL)::int + ("decisionId" IS NOT NULL)::int) = 1);
