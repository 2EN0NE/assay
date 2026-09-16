-- ADR-0031 §三：结算记录上记「谁确认的」（一格）。
ALTER TABLE "Question" ADD COLUMN "confirmedByUserId" TEXT;

-- 回填：在本列出现之前，结算只有一条路径——**题目的作者本人**
-- （Web 的 `getQuestionAssertAuthor`、agent 侧的 `assertOwnedQuestion`，两者都按
-- 作者断言）。所以作者就是当时的确认者，这是**事实**而不是猜测。
--
-- 为什么必须回填而不是留空：留空会让历史结算的确认者为 NULL，于是连作者本人的
-- Forecast 都被判成悬空（§六 的判据两边都不满足），作者的校准里会**静默**少掉
-- 一批样本。那不是「历史按当时的口径解释」，而是把历史读数改掉——正是这套 ADR
-- 要防的事。回填后：作者本人的样本照旧计入；他人样本在无来源时变为悬空（这是
-- §六 想要的判定，且可见、可补录来源解除）。
UPDATE "Question" SET "confirmedByUserId" = "userId"
WHERE "resolved" = true;
