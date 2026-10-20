# 04 — 两轴评审的收口

**What to build:** 让 01–03 的 `[x]` 与仓库里的代码/文档重新一致——评审发现的三处硬违规、
三处规格缺口、一处静默丢弃，全部修掉。

**Blocked by:** 02、03

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm run test:coverage` / `npx next build`）

- [x] `lib/web/decisions.ts` 头注不再说"叙事事后可以补充"，改为 ADR-0037 的冻结 + 换位置
- [x] `lib/web/revisions.ts` 头注的"空白补写"例外补上「揭晓前」限定
- [x] `docs/roadmap.md` Phase 3：Kill Criteria 改为"检测有落点（`brief.actions.overdue`）、
      主动提醒没有（ADR-0034 §二）"；验收句改为"下一次拉取能看见"，并点名"自动执行退出动作仍未实现"
- [x] `pages/index.tsx` 的 `BriefCard` 补 `actions` 四个计数（逾期在最前，ADR-0041 §四）
      与 `seeAlso` 下钻命令（原样渲染返回值，不手抄）
- [x] `pages/decisions/[id].tsx` 的复盘记录标注每条「写于揭晓之前 / 之后」（派生，不落库）
- [x] 动作区补「发生日期」与「备注」输入，与 CLI 的 `--at` / `--note` 对齐
- [x] `decision.list` 两个过滤 flag 同时给 = **交集**，不再是"后者被静默丢弃"；新增用例
- [x] `docs/uat-pi-agent.md` §7.2 明说加速器**未实现、未验证**

**分类口径**（供下次评审复用）：仓库标准违规是硬伤；Fowler 基线一律是判断性提示；
工具已强制的（`no-console`、prettier、`cli/parity.test.ts`）不重复报。

## 第二轮评审（提交撤回后重检）

**Status:** implemented（验证：`npx tsc --noEmit` / `npm run lint` / `npm run test:coverage` / `npx next build`）

第一轮撤回提交后重跑两轴，发现三处此前没看到的问题，连同"规格缺口"一起修掉：

- [x] **ADR-0038 §五 的提示原本没有地面**：`attachPrediction` 返回的 `rubricSuggestions`
      全仓无人读取（`grep` 只命中产生处）。现在 `attach-prediction` 把每条提示打到
      **stderr**（stdout 仍是数据通道），并给出 `set-rubric` 的具体命令；
      `cli/commands.test.ts` 新增用例断言"说出了口"，而不只是"字段存在"
- [x] `skills/decision-capture/SKILL.md`：挂接之后读一眼 `rubricSuggestions`，看到就问一句，
      **不代填**；冻结时返回空，不必说
- [x] ADR-0041 补两条原本只存在于代码里的语义：`planned` 的定义（含"没说时点"）、
      下钻 flag 叠加 = **交集**（"给了命令却让它悄悄不生效，比不给更坏"）
- [x] `pages/decisions/[id].tsx` 的执行日期默认值由 `toISOString()`（UTC）改为本地日期：
      UTC+8 的清晨会把"今天做的"默认记成昨天

**明确不修**（记录判断）：`DecisionExecution` 上没有库级约束，执行/放弃互斥是
read-then-write 的"尽力而为"；并发双击仍可能落下两条 `ABANDONED`。用户已确认本轮不处理。
