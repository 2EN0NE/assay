# agent-capture MVP — 验证记录

> 本文件替代原 `todo.md`（`AGENTS.md` 要求 todo.md 在提交后删除，其有用部分归档于此）。
> `docs/issues/agent-capture-mvp/` 下 8 个 issue 里的"验证记录见 `verification.md`"即指向此处。
>
> **那 8 个 issue 里的 AC 复选框未逐条维护**——勾选落在本文的对照表与各 issue 的 `Status` 行；正文里的 `[x]` / `[ ]` 只反映当时的书写状态。读它们时以本文为准。

## 交付内容

修复代码审查发现的 13 项问题，含 6 项已确认的设计决策：

- **A. `oracleKind` 计分分层**：写侧 + 读侧一起落地（非 `PUBLIC_FACT` 的 `relativeScore` 写 `null`）
- **B. 结算后背书**：允许并触发重算
- **C. Evidence**：给 `Question` 加 `resolutionSource` / `resolutionRationale` 两列
- **D. 非本人问题**：`listRevisions` 返回 `[]`（与 `listProposals` 对齐）
- **E. `Revision.reason`**：强制——变更冻结字段必须给理由
- **F. `provenance`**：加 `AGENT_INSTRUCTED`（依据人的明确指令，默认已背书）

## 已修复清单

### P1

- [x] CLI stdout 契约：文档 / e2e / skill 改用 `npm run --silent agent --`；`--help` 改走 stderr
- [x] ADR-0002 分层计分落地：`isRelativeScored` + `dropRelativeScores` 接入 `scoreQuestion` / `scoreQuestionOptions`

### P2

- [x] `agent.endorse`：已结算问题触发重算（`rescoreResolvedQuestion`）
- [x] `agent.settle` / `decideProposal`：source / rationale 落到 `Question` 两列
- [x] `listRevisions` 非本人问题返回 `[]`
- [x] `editQuestion`：Revision 写入与 update 同事务
- [x] `editQuestion`：变更冻结字段强制 reason（`missingRevisionReason` + `PromptDialog` 采集）
- [x] `cli/args.ts`：`--probability=` / 裸 `%` 报错而非静默变 0
- [x] CI：补 `npm run typecheck`，覆盖率改跑 `test:coverage`

### P3

- [x] `RecordProvenance.AGENT_INSTRUCTED`：schema + 迁移 + CLI + 面板文案
- [x] 待触达队列语义写进 ADR-0017
- [x] 索引：`Revision.questionId` / `ResolutionProposal.(questionId, status)` / `Notification.(userId, deliveryState)`
- [x] `README.zh-CN.md` 同步（CLI 章节 + 测试数量）——该文件其后被删除，README 改为中文单语

### 验证中发现并修复的额外缺陷（不在原审查清单内）

- [x] `lib/web/resolution.ts` / `lib/_utils_server.ts` / `lib/web/notifications.tsx` 的 `console.log` 污染 CLI stdout——`settle` / `endorse` 的 stdout 实测无法 `JSON.parse`。改走 `lib/_log.ts`（stderr），并在 CLI 边界加 `installStdoutGuard()`（非 `emitJson` 写入当场抛错）+ 单测
- [x] `lib/web/question_router.ts` 的 `emailNewlySharedWithUsers` 回调不返回（pi-lens `array-callback-return`）：补 `return await`（行为等价）

## 验证结果

- [x] `npx tsc --noEmit` 退出 0
- [x] `npm run lint` 无告警
- [x] `npm test` / `test:coverage`：**9 套件 82 测试全绿**，覆盖率阈值（`resolution` 52.9% / `_scoring` 89.9% / `llm_parse` 98.1%）全部达标
- [x] `npx prisma migrate status` + `migrate diff`（本地库与 shadow 库）零漂移
- [x] 真库功能验证 **36/36 通过**（脚本 `/tmp/verify-agent-review.sh`、`/tmp/verify-edit-question.ts`）

> 上表两组数字是**记录当时**的状态。此后新增了 `lib/web/agent_router.test.ts`（锁定 ADR-0008 选择 E 的 polarity）等测试，当前为 **10 套件 86 测试**。

## 已知环境问题（非代码问题）

pi-lens 的 TS server 持有 `@prisma/client` 的**陈旧快照**，持续误报 `AGENT_INSTRUCTED` / `resolutionSource` / `_count` 等"不存在"。三点判据均通过（`tsc` 干净 + 文件在 program 内 + 生成产物含该字段），按 `AGENTS.md`「验证规范」**不以改代码迎合**；重启语言服务器即可清除。

## 测试覆盖率自查（逐 issue 对照验收里承诺的测试）

| issue             | 验收承诺的测试                                               | 实际状态                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 CLI 骨架       | 单测覆盖参数解析与 JSON 形状                                 | ✅ `cli/args.test.ts`、`cli/commands.test.ts`                                                                                                                                                                                                                                                                                 |
| 02 schema 扩充    | 现有测试全绿                                                 | ✅ 全量 **100 测试**                                                                                                                                                                                                                                                                                                          |
| 03 CLI 写入       | 单测覆盖三种情形（有概率 / 无概率 / 非法）；Web 标记"未量化" | ✅ 三种情形见 `agent_router.test.ts`；Web 的「尚未量化」标记已补（`AgentRecordPanel`，ADR-0011），e2e 已断言                                                                                                                                                                                                                  |
| 04 未背书不进校准 | 单测"排除 / 背书后计入"                                      | ✅ `resolution.test.ts` 断言未背书样本**不进分数集合、也不被 upsert**；`agent_router.test.ts` 断言背书对**已结算**问题触发 `rescoreResolvedQuestion`（此前零覆盖）。**"背书后校准图变化"以单测锁定**——校准图是图片（`/api/calibration_graph`），e2e 无法断言像素；e2e 改为断言界面与 CLI 队列，标题也随之改掉了原先的过度声明 |
| 05 修订留痕       | 单测覆盖三种情形；e2e 覆盖"改动 → 可见修订历史"              | ✅ 单测 `revisions.test.ts` 全覆盖；e2e 已补（用真实 UI 元素：`Resolves …` 按钮 → `Edit resolution date` 对话框 → `Save` → 理由框）                                                                                                                                                                                           |
| 06 pi skill       | e2e"对话输入 → 落库 → Web 可见"                              | ⚠️ skill 本身（`.pi/skills/decision-capture/`，已从 `.gitignore` 放行）无自动化测试；其**一半**路径（CLI 写入 → Web 可见）由 e2e 覆盖，对话侧的识别/追问/等效折算仍只能靠人工 UAT                                                                                                                                             |
| 07 结算 / 提案    | 单测覆盖三种判据层级的分支                                   | ✅ `agent_router.test.ts` 新增 5 条：SELF_REPORT 拒绝 / AGENT_OBSERVABLE 提案 / PUBLIC_FACT+来源自行结算 / 无来源降级 / 重复结算拒绝                                                                                                                                                                                          |
| 08 调度与触达     | 单测覆盖状态机                                               | ✅ `agent_router.test.ts` 新增 5 条：PENDING 过滤 / DELIVERED 记时间与通道 / 未给通道时 in-app / NOT_NEEDED 清空 / 非本人通知拒绝                                                                                                                                                                                             |

> **e2e 后来已在本机执行**：`npx playwright install chromium` 在本机拉不到 CDN，改用系统 Edge（同为 Chromium 内核）跑通，CI 仍用 chromium（见 README 的 "How to verify" 与 `docs/issues/decision-quality/06-*.md`）。上一版那句"未在本机执行"是记录当时的状态。
>
> **2026-10-17 追加：`[x] README.zh-CN.md 同步` 已无处可指。** 那份文件后来被删除（README 改为中文单语，见 commit `251a23c`），所以这个勾**不对应任何可核对的东西**。此处不改那一行——本文是当时的验收记录，改写它等于改历史；正确的读法是：该勾所承诺的"同步"随文件一起作废。ADR-0035 带来的文档同步（README 的配对码小节、AGENTS.md 的本地身份一节）是**另一次**改动，记在 ADR-0035 的「实现注记」里。
