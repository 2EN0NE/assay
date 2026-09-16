# 07 — 结算授权按 Forecast 的 Owner

**What to build:** 建题者不能替他人结算；Agent 可观测需该预测 Owner 确认；自我报告只能本人；公共事实带来源时任何身份可结算。

**Blocked by:** None — can start immediately

**Status:** implemented（ADR-0029）

- [x] `agent.settle` 由"按 Question 的 Owner 断言"改为"按判据类型 + Forecast 的 Owner"
- [x] A 建题、B 押注时 A 结算被拒，错误信息说明原因
- [x] **开放项**：可结算但某人未确认的中间态怎么表达

### 实现说明（供后续票据复用）

- 授权矩阵落成**纯函数** `lib/web/settlement_authority.ts::decideSettlement()`，返回 `settle` / `propose` / `requires-human-report` 三态。做成纯函数是因为授权错的方向不会报错：它只让建题者安静地判定他人的信念。
- 矩阵：公共事实 + 来源 ⇒ 任何身份直接结算；公共事实无来源 ⇒ 降级提案；Agent 可观测 ⇒ 一律提案（有无来源相同）；自我报告 + 调用方就是该 Prediction 的 Owner ⇒ 本人报告；否则 ⇒ 要求本人报告。
- `agent.settle` 不再用 `assertOwnedQuestion`（按题主断言）——它因此变成孤儿并被删除（由本次改动导致）。现在按 id 取题，再由矩阵决定。
- **提醒对象修正**：要求本人报告时，提醒发给**该题预测的 Owner**（没人押过时退回建题者，因为那条自我报告说的就是他本人），而不是发给调用方自己。向 A 发"请 B 报告"是没用的。
- `agent.decideProposal` 的确认权从"题主"改为"题主或该题预测的 Owner"，不满足时 `FORBIDDEN` 并说明原因；`listProposals` 也同步放宽，否则 B（押注者）看不到等他确认的那条提案。
- 原始开放项（部分确认的中间态）**已由 ADR-0031 裁决**：生效范围按可核查性分叉，悬空是合法且可见的状态；`confirmedByUserId` 与计量过滤规则落在新票据 `decision-loop/02`。
- 关于 ADR-0031 "实现前须核实 source 是否真的落库"：**已核实** —— `lib/web/resolution.ts:43-44` 写入 `resolutionSource` / `resolutionRationale`，`agent.settle` 把 `{ source, rationale }` 传进来。新票据 02 可以直接依赖这个事实。
- 测试：`lib/web/settlement_authority.test.ts` 5 条（矩阵逐格）+ `agent_router.test.ts` 新增 4 条（建题者不能替他人在自我报告上作结论且提醒发给 Owner；本人可作结论；押注者可确认提案；无关身份被拒）。全量 254 passed。
