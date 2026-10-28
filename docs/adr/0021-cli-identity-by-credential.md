# CLI 身份按凭据分发，作用域取仓库副本

> **此处已变：** 正文里的 `FATEBOOK_AGENT_USER_EMAIL` 已由 [ADR-0042](./0042-brand-rename-and-identifiers.md) 改为 `ASSAY_AGENT_USER_EMAIL`；决策内容不变，正文按"只追加"原则保留原样。

取代 [ADR-0015](./0015-local-cli-as-agent-interface.md) 中「在"仅个人"前提下取固定 owner（环境变量指定），而非按用户凭据分发」这一条：CLI 的身份改为**每个身份各自持有一把凭据**，复用本仓库既有的机制（`User.apiKey` 与 `getUserByApiKeyOrThrow`，它本就在 `question_router` 里服务外部 API），作用域取**仓库副本**——不同的 checkout 可以是不同的身份，同一副本内的所有子目录是同一个身份。**本句的「作用域」已被 [ADR-0036](./0036-identity-scope-is-the-process.md) 收窄**：副本仍是**默认来源**，但进程可显式覆盖——即同一副本内的**多个进程**可以是多个身份。原句保留不动，仅此注。

数据模型**不需要改动**：`Decision.userId`、`Forecast.userId`、`QuestionScore.userId` 早已按人归属，同题多预测者与跨人相对分在模型上已经成立。本轮**只留接缝**，不实现可见性、邀请与跨身份读取的语义——那些留待后续 ADR。

## Considered Options

- **邮件地址作为身份键**（即现状的 `FATEBOOK_AGENT_USER_EMAIL`）：人确实是靠邮件认的，但邮件是**登录**凭据的思路，要求 CLI 侧先存在一个已登录的账号；而凭据机制已经实现，且天然适合无浏览器的场景。
- **机器级全局凭据**（一把钥匙服务所有仓库）：实现最省事，但"我在 A 项目以谁出现"与"我在 B 项目以谁出现"无法不同；也与本仓库既有的 worktree 工作流冲突——每个 worktree 都是独立副本，天然应该能承载不同身份。
- **用户级凭据文件**（放在家目录）：绕开了仓库，但把身份从"我正在哪个副本里做事"里剥出来，与 pi 自身的项目级配置习惯不一致。

## Consequences

- `FATEBOOK_AGENT_USER_EMAIL` 不再是身份的唯一来源；迁移与兼容口径**尚未决定**（见下条）。
- CLI 的输出契约需要能表达"我以谁的身份读/写"。这正属于 ADR-0015 所说「改动它等于破坏 skill」的那类变更：**skill 必须与 CLI 同步发布**。
- 凭据的**发放入口**成为必需：目前只有 Web 的 `/api-setup`（`regenerateApiKey`）能生成，且前提是已登录；首个账号与第一把钥匙的来源**尚未决定**。
- `User.apiKey` 从此承载身份语义，不能再被当作"只给外部 REST API 用的附属字段"。**轮换一把钥匙等于换身份。**
- 与 ADR-0008 的背书机制无关：背书区分的是"Agent 搜集 vs 当事人确认"，与身份归属是两个正交的轴。
