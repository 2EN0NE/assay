-- ADR-0030 §十二：标签判重折叠大小写（`CPI` 与 `cpi` 是同一个领域），但显示保留原样。
--
-- Prisma 生成的原始语句是 `ADD COLUMN "nameNormalized" TEXT NOT NULL` —— 本机 Tag 表
-- 恰好为空所以会"成功"，但任何**已有标签**的库都会直接失败（或更糟：一旦带了默认值，
-- 就把全部历史标签悄悄改写成同一个值）。因此这里拆成三步：加可空列 → 回填 → 置 NOT NULL。
ALTER TABLE "Tag" ADD COLUMN "nameNormalized" TEXT;
UPDATE "Tag" SET "nameNormalized" = lower("name");
ALTER TABLE "Tag" ALTER COLUMN "nameNormalized" SET NOT NULL;

-- 唯一约束从 (name, userId) 换成 (nameNormalized, userId)。
-- 若库里已存在把大小写当两个标签的行（如 CPI 与 cpi），这条创建会**失败**——
-- 那是想要的行为：这种情况需要人来决定合并成哪一个，而不是由迁移替你选。
DROP INDEX "Tag_name_userId_key";
CREATE UNIQUE INDEX "Tag_nameNormalized_userId_key" ON "Tag"("nameNormalized", "userId");

-- ADR-0030：领域权威在 Decision（用户在此表达一次），挂接预测时写时复制到 Question。
CREATE TABLE "_DecisionToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_DecisionToTag_AB_unique" ON "_DecisionToTag"("A", "B");
CREATE INDEX "_DecisionToTag_B_index" ON "_DecisionToTag"("B");

ALTER TABLE "_DecisionToTag" ADD CONSTRAINT "_DecisionToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_DecisionToTag" ADD CONSTRAINT "_DecisionToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
