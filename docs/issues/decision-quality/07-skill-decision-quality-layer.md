# 07 — skill 的决策质量层

**What to build:** `decision-capture` skill 增加一段**独立于预测捕获层**的清单问答脚本，在决策当时把 ADR-0016 的清单问出并通过 CLI **落库**——不是只问不存。

**Blocked by:** 05

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` / `npm run test:e2e` 全部通过；skill 的实际对话效果靠人工 UAT，无自动化）

- [x] 清单问答与"概率 / 期限 / 判据"问答明确分层，不混成一套问法（skill 里单独立为"决策质量层"一节，并写明为何分层）
- [x] 清单问答的产出经 CLI 落库（`create-decision` / `set-rubric` / `attach-prediction`），因此有诊断价值
- [x] 决策质量层在 Phase 2 能力可用时才进入 skill（本次交付，阶段与本 ADR 的"同时交付"要求一致）
- [ ] 文档一致性：`CONTEXT.md` 的 `Decision Rubric` 词条标题已由"决策量表"改为"决策清单"（**此前这条被提前勾上**：正文早已正确，改的只是标题，本轮才改完），并新增 `Decision Version / 决策版本` 词条

> 未覆盖：skill 的**对话识别质量**（"能不能从『我在纠结要不要接这个 offer』里正确识别为决策"）无自动化测试，只能人工 UAT。这是对话型能力的固有限制，不是遗漏。
