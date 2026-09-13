# Agent 通过本地 CLI 接入：一条命令、确定性 JSON、不依赖服务常驻

pi 侧读写决策记录的方式是**调用本仓库暴露的本地 CLI**（`E` = ②）。CLI 内部走 tRPC 的 `createCaller`，因此复用服务端**同一套 zod 校验与业务逻辑**，而不是另写一条 Prisma 直连路径。Agent 侧只依赖两条约定：**一条命令**、**结构稳定的 JSON 输出**。

为什么不选"扩展 v0 REST"（①）：项目里其实**已经有两条写路径**——`pages/api/v0/createQuestion.ts` 直连 `prisma`、只复用部分 helper，与 tRPC 的 `question_router` 并行存在。再加一个 HTTP 客户端只会加深这个问题；何况 REST 需要服务常驻，Agent 还得拼 query / body，那是对 LLM 额外且无收益的错误面。

为什么不选 MCP server（③）：MVP 阶段多一层部署与认证面，成本最高；CLI 已足够让 Agent 用一条命令完成一次读写。

最要紧的一条收益是**不依赖服务常驻**：本地只需 Postgres。而现有的定时机制（`vercel.json` 的 cron，带 `?key=` 查询串）**在本地根本不会触发**——跟踪的调度因此必须由 pi 侧驱动（与 ADR-0005 一致），CLI 正是它能落地的形态。

## Considered Options

- **① 扩展 v0 REST API**：需服务常驻，且加深已有的双写路径。
- **③ MCP server**：对 Agent 最"原生"，但 MVP 成本最高。

## Consequences

- 需要定义 CLI 的**用户身份**：在"仅个人"前提下取固定 owner（环境变量指定），而非按用户凭据分发。
- CLI 的输出契约是**对 Agent 的公开接口**，需稳定、可解析、可测试——改动它等于破坏 skill。
- CLI 同时可被"定期巡检"（`N`）复用，成为**调度与写入的共同入口**。
- `createCaller` 在本仓库**尚无先例**；需先确认无服务器调用所需的最小 ctx 构造方式。
