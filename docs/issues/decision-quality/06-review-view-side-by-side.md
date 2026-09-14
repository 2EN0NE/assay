# 06 — 复盘视图：决策时记录与最终结果并排

**What to build:** 人能在 Web 上看到决策列表（同时显示质量分与结果分）与决策详情（决策时记录与最终结果并排），从而一眼分辨这次是"决策好"还是"运气好"。

**Blocked by:** 04, 05

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` 全部通过 · **`next build` 成功**（两个新页面已入构建）· **`npm run test:e2e` 通过**（本机用系统 Edge 顶替下载不下来的 Playwright chromium）——首次跑通暴露了三条非测试问题，见下）

- [x] 决策列表页显示各决策，并同时给出质量侧与结果侧——**如实说明：结果侧给的是事实（已揭晓 N/共 M），不是聚合的"结果分"**。把多条 Prediction 的分数聚成一个决策级指标是一个新指标，归 ADR-0002 管辖；在其未决前现编一个，等于用没人复核过的数替代可查证的事实
- [x] 详情页把"清单完成度 + 叙事"与"各 Prediction 的结算"**真正两栏并排**呈现（`md:grid-cols-2`）
- [ ] 详情页的各 Prediction 另显示**逐条分数**（User Story 16）：取 `QuestionScore` 已存值，仍不做决策级聚合分
- [x] 没有任何已结算 Prediction 时，结果侧显示"尚未揭晓"，并明说"空不等于 0 分"
- [x] e2e 覆盖：创建决策 → 挂 Prediction → 结算 → 并排可见，且**服务端真的拒绝改写清单**（`set-rubric` 非零退出、stderr 写明「已锁定」），列表页同时给出质量侧与结果侧（`e2e/agent-cli.spec.ts`）

> **首次实跑发现的三条非测试问题**（此前 e2e 从未跑过，因此都没被发现）：
>
> 1. **Question 卡片全崩**（根因，`components/questions/Question.tsx`）：f34df53 往展开区的
>    `<Transition>` 里加了第二个子元素（`AgentRecordPanel`），而 HeadlessUI v2 的 `<Transition>`
>    只接受单子元素、且子元素必须能把 `ref` 落到真实 DOM 节点。两者都触发运行时异常，
>    `ErrorBoundary` 把每个 Question 卡片换成 `Something went wrong`——5 条 e2e 因此全红。
>    详见 [`knowledge/troubleshooting/headlessui-transition-v2-ref.md`](../../../knowledge/troubleshooting/headlessui-transition-v2-ref.md)。
> 2. **修订历史不刷新**（`lib/web/utils.ts`）：`invalidateQuestion` 没同步失效
>    `agent.listRevisions` / `agent.listProposals`，改完期限后「修订历史」要手动刷新页面
>    才出现——而 ADR-0012 要求的正是"改了就看得见"。
> 3. **e2e 定位子陈旧/歧义**：`getByText(title)` 与通知正文同名、`Resolve` 子串命中
>    `Resolves ...`、结算选项的 role 是 `menuitem` 而非 `button`、题目输入框按已改写的
>    placeholder 匹配。均已按语义定位修正。
