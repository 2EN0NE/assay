# nano-fatebook-agent

[English](./README.md) | [中文](./README.zh-CN.md)

一个 **Agent 原生的决策质量提升系统**。它在日常对话中捕获决策，把隐含的信念显性化为可结算的概率预测，并长期追踪，从而把**决策质量**与**结果质量**分开。

> 由 [Fatebook](https://fatebook.io)（预测追踪 + 校准）fork 而来。上游的 Slack / Discord / Chrome 扩展 / 锦标赛 / 团队功能均已移除。

## 它是什么，不是什么

- **是**：一个由 AI Agent 在对话中驱动的个人决策日志 + 校准引擎。
- **不是**：待办清单、笔记应用，或团队项目管理工具（团队决策卫生功能在路线图上，当前版本尚未实现）。

## 当前能力

### 预测追踪

- `Question`（可验证命题：标题、类型、`resolveBy`）与 `Forecast`（概率值，带时间戳与可选评论）。
- 一个问题保留**完整的预测时间序列**——你可以修改预测，历史不会被覆盖。
- 评论、标签、问题备注。
- 结算为 `YES` / `NO` / `AMBIGUOUS`，支持撤销。

### 校准与评分

- **Brier 分数**与**相对 Brier 分数**（相对同期其他预测者的中位数），以及排名。
- **百分位**：与其他预测者比较。
- **校准图**：把你的预测概率分桶，与实际结果频率对比。
- 由 `TrackRecord` 组件在 `/`、`/stats`、`/user/[id]` 展示。

### 访问与本地开发

- Email magic-link 登录（NextAuth），以及每用户 API key 供程序化访问。
- 一条命令拉起本地环境（Docker Compose：PostgreSQL + Mailpit 邮件捕获）。

### Agent 集成：CLI 是 Agent 的接口

Agent 通过本地 CLI 读写决策记录，CLI 内部走 tRPC 的 `createCaller`，因此复用服务端同一套 zod 校验与业务逻辑（ADR-0015）。

```shell
export FATEBOOK_AGENT_USER_EMAIL=you@example.com

npm run --silent agent -- list-due                       # 已到期且未结算
npm run --silent agent -- create-prediction \
  --title "接这个 offer" --resolve-by 2026-04-01 \
  --criteria "邮件中出现正式 offer 链接" --probability 70%
npm run --silent agent -- list-unendorsed                # 尚未计入校准
npm run --silent agent -- endorse --question-id <id>
npm run --silent agent -- settle --question-id <id> --resolution YES --source <url>
npm run --silent agent -- list-proposals                 # 结算提案
npm run --silent agent -- list-deliveries                # 拉取式待触达队列
npm run --silent agent -- report-delivery --notification-id <id> --outcome DELIVERED --channel telegram
```

- `--silent` 不可省：不加时 npm 会把自己的横幅写进 stdout，破坏"stdout 只放 JSON"的契约；`--help` 也走 stderr，理由相同。
- Agent 写入的记录会标注录入来源，且 `AGENT`（自主搜集）默认**未背书**，须在界面背书后才计入校准（ADR-0008）。
- `--instructed` 用于"数字是当事人自己给的"这类录入，它天然已背书。
- `parseDecision`（`lib/web/llm_parse.ts`，Kimi）是有意**未接线**的：Agent 的接口就是 CLI，自然语言解析由 pi 侧承担。

### 质量门禁

- Jest 单元测试：计分（含"非公共事实类不进相对分"）、校准样本过滤、结算生效范围（ADR-0031 §六：无来源且由他人确认的结算，对被代签者是悬空样本）、领域命名与判重、领域读数、结算状态机、修订规划与理由校验、LLM 解析、CLI 参数解析、表单行为。逻辑最密的几支在 `jest.config.ts` 里有逐文件覆盖率下限（含 `domain_stats` / `domain_tags` / `settlement_scope` / `tags_router`）。
- `cli/parity.test.ts` 从源码读出两个交互面，某过程只在一侧可达且未登记理由时变红（AGENTS.md §10 / ADR-0023）；`lib/skills_contract.test.ts` 对技能做同样的事：技能里每条 `agent -- <命令>` 必须真实存在，写入示例必须声明来源。
- `scripts/verify-migration-upgrade.ts` 升级一个**已有数据**的库（先应用升级前的迁移并插入旧数据，再 `migrate deploy`），断言本阶段两条回填（`Tag.nameNormalized = lower(name)`、`Question.confirmedByUserId = 作者`）以及大小写冲突时**大声失败**——这些都是空库上的 `migrate deploy` 抓不到的。
- Playwright 端到端测试：人登录 → 创建 → 结算；agent 经 CLI 写入 → 人在 Web 背书 / 确认提案；决策领域 → 预测 → 领域读数；悬空 → 补录来源 → 重算计入。另有真 Postgres 上的 `SetNull` 回归。
- CI 在每次 PR 上运行 lint + typecheck + 单元测试（带覆盖率阈值）+ 迁移升级验证 + e2e + 生产构建。

## 愿景：Agent 原生的决策卫生

目标是让 Agent 成为主要的**捕获入口**：

1. **捕获**——Agent 在对话中察觉用户正面临一个决策。
2. **拆解**——把决策拆成其中真正**可预估**的部分（可结算命题）。
3. **追问**——向用户索取模糊表述背后的具体置信度数字（"我觉得能成" → "六成还是八成？什么时候前？"）。
4. **记录**——带着明确的结算标准持久化这些预测。
5. **校准**——结果揭晓后进入校准与评分闭环。
6. **矫正**——用决策卫生工具（事前剖析、杀死标准、尤利西斯合同、名义群体、寻真小组）改进**过程**，而不只是分数。

**记录与跟踪是分离的。** 记录 Agent 在对话内工作，只负责把决策与预测写下来——结算判据、结算标准与评分锚点在决策时冻结。跟踪委托给**独立上下文中的另一个 Agent**，因此事后重新解释"当初的意思"无法渗入结算。

### 核心原则

1. **区分决策质量与结果质量。** 好过程也会因运气得到坏结果；克制 `Resulting`（以结果反推决策优劣）。
2. **一切决策都是押注。** 每个选择都在信息不完整下投入稀缺资源。
3. **概率思维与信念标定。** 用概率分布替代"确定"，并对新证据保持开放。
4. **放弃同样是一种美德。** 坚持与放弃是同一决策的两面；新的不利信号使放弃成为义务。
5. **保护"未来的自己"。** 用未来的反馈约束当下的短视（对抗当下偏见）。

阶段计划与待定设计决策见 [`docs/roadmap.md`](./docs/roadmap.md)。

## 快速开始——一条命令

```shell
./startup.sh          # 或：npm run startup
```

它会检查 Docker/Node、生成 `.env`、起 Postgres 与 Mailpit、装依赖、跑迁移、**准备一个身份**
（不需要邮箱，ADR-0022）、把 agent 技能安装到 `.agents/skills/`，然后打印下一步。可重复执行。

接下来二选一：

- **打开 Web 页面：**

  ```shell
  npm run dev:e2e      # 明文 http，端口 3000
  ```

  浏览器打开 <http://localhost:3000>，用邮箱 magic link 登录——邮件在 Mailpit 里看：
  <http://localhost:8025>。不需要 SMTP 账号。

- **在 pi 里与 agent 对话**（把本仓库作为工作目录启动 pi）：

  ```shell
  pi --skill .agents/skills/decision-capture/SKILL.md
  ```

  然后说人话就行：_“我在纠结要不要接这个 offer。”_

也可以整套跑在 Docker 里：`cp .env.example .env && docker compose up`（数据库自动创建，
迁移在启动时执行）。

### 技能放在哪里

`skills/decision-capture/` 是**源**——可见、与具体 harness 无关，按
[Agent Skills 规范](https://agentskills.io/specification)组织（一个目录 + `SKILL.md`）。
`startup.sh` 把它**安装**到 `.agents/skills/`：`.agents/` 是跨 harness 的共享约定，pi 也把它
当作项目级技能根（见 pi 安装包里的 `dist/core/trust-manager.js`）。安装目录是生成物，已在
`.gitignore` 里——要改就改源，不要改那一份拷贝。

> pi 只在**项目被信任**之后才加载项目级技能（`.pi/skills/` 与 `.agents/skills/` 都受此约束）。
> 首次启动它会问一次；不想信任就显式传 `--skill`。

### 端到端试一遍

六个场景，从记录一条决策到复盘，每一步都写了该看到什么：
**[docs/uat-pi-agent.md](docs/uat-pi-agent.md)**。

## 开发

```shell
npm install
npx prisma generate --no-hints
npm run dev          # https://localhost:3000，经 3005 的 SSL 代理
                     #   需要 localhost.pem / localhost-key.pem——本仓库不提供
npm run dev:e2e      # 明文 http，端口 3000——没有那两个证书时用这个
npm test             # Jest 单元测试
npm run dev          # 开发服务器（3005，SSL 代理 → 3000）
npm test             # Jest 单元测试
npm run test:coverage
npm run lint         # ESLint
npm run format       # Prettier
npm run studio       # Prisma Studio
```

端到端测试（需要 Docker 提供 Postgres + Mailpit）：

```shell
docker compose up -d db mail
cp .env.example .env
npx playwright install chromium
npm run test:e2e
```

`npx playwright install chromium` 拉不到 `cdn.playwright.dev` 时（公司网络 / 代理常见），
改用系统上已装的 Chromium 内核浏览器跑同一套用例：在 gitignored 的 `.scratch/` 下放一份只把
`channel` 换成 `msedge` 的本地配置，再 `npx playwright test --config .scratch/pw-local.config.ts`。
用例、断言与 webServer 都不变——"跑不起来"是 e2e 长期没被执行的主要原因。

## 项目文档

| 文档                                   | 内容                           |
| -------------------------------------- | ------------------------------ |
| [`CONTEXT.md`](./CONTEXT.md)           | 统一语言 / 术语表              |
| [`docs/roadmap.md`](./docs/roadmap.md) | 阶段计划 + 待定决策            |
| [`docs/adr/`](./docs/adr/)             | 架构决策记录                   |
| [`knowledge/`](./knowledge/)           | 工程笔记（部分为 fork 前遗留） |
| [`AGENTS.md`](./AGENTS.md)             | AI Agent 工作约定              |

## License

MIT
