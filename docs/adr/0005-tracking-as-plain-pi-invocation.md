# 跟踪通过普通 pi 调用实现，不自建运行时

跟踪不是一项常驻服务，而是**一次普通的 pi agent 调用**。它由 pi harness（配合用户的 agent / workflow 插件，例如 `agent()`）唤起，每个调用天然运行在**独立上下文**中——这正是 ADR-0003 所要求的隔离。

我们不自建调度器、worker 或 serverless cron 来完成结算：那会引入一套需要单独运维、单独鉴权、且在 serverless 超时限制下无法回问用户的基础设施。把跟踪表达为一次 pi 调用，则"独立上下文"由 harness 免费提供，本工程的交付物只剩**一个 skill / workflow 定义 + "读记录 → 判据 → 结算"的逻辑**。

## Considered Options

- **Vercel Cron + API 路由**：项目里已有此模式，但 serverless 超时 / 冷启动 / 无法中途回问用户，不适合带 LLM 的结算。
- **常驻 worker**：需要新增部署与运维单位。
- **混合（云端检测 + 本地结算）**：在纯本地部署下多出一层不必要的队列。

## Consequences

- 跟踪侧的交付物是 _skill / workflow 定义_，不是服务。
- 调度、上下文隔离与并发由 pi harness 负责；本工程只负责结算逻辑与 `Evidence`。
- **`vercel.json` 已删除**。它原有的两条 cron 都不属于本设计：`/api/check_for_message_updates` 指向的路由早已不存在（死引用），`/api/send_batched_emails` 属旧邮件批量通道（ADR-0013 已把 Postmark 通道排除出 MVP）。删除是为了收窄仓库边界：本地不存在 Vercel cron，"何时行动"只能由 pi 侧驱动（见 ADR-0015），而 cron 的查询串里还夹着一个明文凭据。**只删 cron 文件，Postmark 代码本身的去留仍按 ADR-0013 留待后续。**
