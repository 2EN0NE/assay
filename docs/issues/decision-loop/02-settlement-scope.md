# 02 — 结算生效范围按可核查性分叉

**What to build:** 结算只约束签字的那个人之外该约束的范围——带可核查来源的公共事实人人计入；无来源的自我报告只对确认者本人生效，其他人的预测显示为"悬空未结算"，不进度量、不被代签。

**Blocked by:** 07-settlement-by-forecast-owner（该票据把结算授权从"出题人"改成"Forecast 的 Owner"，本票据改的是它之后的生效范围）

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` 全绿——**283 个用例**（新增结算范围 7 + 计分入口 4）；迁移 `20260914200000_settlement_confirmed_by` 已在本机库应用，回填后用真库探针确认：51 条已结算题**全部**有确认者、0 条遗漏）

**核实结论（AC 第一条）**：直接结算路径**确实把 `source` 落库**——`lib/web/resolution.ts` 的 `dbResolveQuestion` 写入 `resolutionSource` / `resolutionRationale`，`agent.settle` 把 `{ source, rationale }` 传进来（票据 07 已核实过；本轮再次确认，并发现 **Web 的 `resolveQuestion` 路径从不传 evidence**，因此历史结算普遍没有来源——见下）。

### 实现说明

- `lib/web/settlement_scope.ts`：判据做成**纯函数**（`settlementScopeOf` → `UNRESOLVED` / `DANGLING` / `EFFECTIVE`），悬空是**推导**出来的，没有 (question, user) 状态表。
- schema：`Question.confirmedByUserId`（一格，无外键——与 `agentSessionId` 同为审计标识）。
- 写入路径三条全部记确认者：`agent.settle`、`agent.decideProposal`（接受时）、Web/API 的 `resolveQuestion`。
- 过滤落在**计量入口**：`resolution.ts` 的 `meteredForecasts`（= 已背书 + 结算生效）与 `pages/api/calibration_graph.ts`。呈现层不动。
- 新增 `agent.recordResolutionSource` + CLI `record-resolution-source`（§五 的出口）：写来源后**重算**，使补录真的让样本计入；不触碰 `resolved`/`resolvedAt`/锁定时点，所以不是「撤销结算」。对等性例外表新增一条（待补：Web 入口随题目页写入口一起做，理由在表里）。
- `agent.listDue` 改为 `{ settleable, dangling }`：悬空项各自带 `reason`（成因只有一种：来源缺失）。

### 一个必须写明的后果（不是 bug，是 §六 的判定）

本机库里有 **23 条已结算题没有可核查来源**。回填让作者本人的品牌照旧计入，但**他人在这 23 条题上的预测从此刻起变为悬空**（不计入计量，仍在复盘与队列里可见）。这是 ADR-0031 §六 想要的结果——原先那种「别人替你签字」正是它要防的事。出口是 §五：补录来源即计入（`record-resolution-source`）。

### 一个实现陷阱（供后续复用）

非互斥多选题在**最后一个选项**结算时先给选项打分，而那一刻 question 行还没写 `resolved`。直接套 §六 公式会把该路径的全部样本排除——所以计分入口多了一个「正在结算的那一次」参数（`settlementRecordOf(question, pending)`），而不是从行上读。

- [x] 实现前先核实：直接结算路径**是否真的把 `source` 落库**；若没有，先补上（ADR-0031 的判据依赖它），并把核实结论写进票据
      — 已落库（`dbResolveQuestion`）；但 Web 路径从不传 evidence，所以历史来源普遍为空 ⇒ 迁移里回填确认者以保住历史读数
- [x] 结算记录落库"谁确认的"
      — `Question.confirmedByUserId` + 三条写入路径；真库探针：51/51 已结算题有确认者
- [x] 无来源 + 他人确认 ⇒ 被代签者的 Forecast **不进入**校准（自证用例：去掉过滤即变红）
      — `settlement_scope.test.ts` 的守门用例 + `resolution.test.ts` 的计量入口用例（去掉 `meteredForecasts` 的过滤即变红）
- [x] 带来源 + 他人确认 ⇒ 计入；无来源 + 本人确认 ⇒ 计入
      — 四类用例逐格钉在 `settlement_scope.test.ts`
- [x] 复盘与该条相关的队列输出能区分"未结算"与"悬空未结算"，并给出成因（来源缺失）
      — 两半都做了：队列侧 `listDue` 返回 `{ settleable, dangling }`（`reason` 只有一处；`danglingReason`）；复盘侧由 `decision.byId` 给出 `settlementScope` / `settlementLabel`，Web 与 CLI 共用同一份措辞
- [x] 后来补录可核查来源 ⇒ 该题所有预测计入，且不触发任何锁定回退（ADR-0020）
      — `recordResolutionSource` 写来源后 `rescoreResolvedQuestion`；不碰 `resolvedAt` 与 `rubricLockedAt`
- [x] 不引入 (question, user) 维度的确认状态表——悬空状态由过滤规则推导
      — 没有新表；判据是纯函数，状态是推导的

### 复查（2026-09-16）：悬空在复盘的可见性 —— 三件补做

复查（两轴 code review）指出 §二/§三 的呈现要求没有消费者，追下去发现比"缺标签"更细：

1. **写入路径本身是对的。** `scoreQuestion` 早就在用
   `meteredForecasts(settlementRecordOf(...), question.forecasts)` 过滤（`resolution.ts`），
   并有自证用例（`resolution.test.ts`「无来源 + 他人确认 ⇒ 被代签者的预测不进计量（去掉守卫即变红）」）。
   所以不是"持续泄漏"。
2. **真库上有 2 行陈旧数据**（改动之前写入的 `QuestionScore`，其 (题,人) 按 §六 已是悬空）。
   已重算受影响的那条题（走同一套过滤）⇒ 复查 SQL「违反 §二 的残留行数」= **0**。
   这一步是运维动作，不是迁移：将来若再有人改写判据，同样要重算，而不是靠读路径兜。
3. **两个显示名补上了**，措辞放在判据旁边（`settlement_scope.ts` 的 `DANGLING_LABEL` /
   `CONFIRMED_BY_OTHER_LABEL` / `settlementLabelOf`），`decision.byId` 一并返回，
   Web 复盘页与 CLI `show-decision` 共用一份 ⇒ 措辞不会两边各写一遍。
   复盘页还把"已揭晓却没有分数"**拆成两个成因**（悬空 vs ADR-0018），
   计数逻辑提为纯函数 `unscoredCauses` 并有单测。

**诚实标注**：`pages/decisions/[id].tsx` 的**渲染**没有独立测试（曾尝试页面级渲染测试，
该页依赖的 `completion` 形状使 fixture 成本过高，遂作罢并删掉那份测试）。
呈现层被钉住的是：措辞与判定（`settlement_scope.test.ts`）、拆桶算术（同文件）、
数据出口（`decision_router.test.ts`）；剩下的 JSX 是薄消费者。
