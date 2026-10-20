# nano-fatebook-agent

一个 **Agent 原生的决策质量提升系统**。它在日常对话中捕获决策，把隐含的信念显性化为可结算的概率预测，并长期追踪，从而把**决策质量**与**结果质量**分开。

> 由 [Fatebook](https://fatebook.io)（预测追踪 + 校准）fork 而来。上游的 Slack / Discord / Chrome 扩展 / 锦标赛 / 团队功能均已移除。

## 它是什么，不是什么

- **是**：一个由 AI Agent 在对话中驱动的个人决策日志 + 校准引擎。
- **不是**：待办清单、笔记应用，或团队项目管理工具（多人决策相关的功能在路线图上，当前版本尚未实现）。

## 当前能力

### 预测追踪

- `Question`（可验证命题：标题、类型、`resolveBy`）与 `Forecast`（概率值，带时间戳与可选评论）。
- 一个问题保留**完整的预测时间序列**——你可以修改预测，历史不会被覆盖。
- 评论、标签、问题备注。
- 结算为 `YES` / `NO` / `AMBIGUOUS`，支持撤销。

### 校准与评分

- **Brier 分数**与**相对 Brier 分数**（相对同期其他预测者在同一题上的中位数），以及排名。
- **百分位**：与其他预测者比较。
- **校准图**：把你的预测概率分桶，与实际结果频率对比。
- 由 `TrackRecord` 组件在 `/`、`/stats`、`/user/[id]` 展示。

### 访问与本地开发

- 邮箱 magic link 登录（NextAuth），以及每用户 API key 供程序化访问。
- 一条命令拉起本地环境（Docker Compose：PostgreSQL + Mailpit 邮件捕获）。

### Agent 集成：CLI 是 Agent 的接口

Agent 通过本地 CLI 与系统交互。CLI 用 `createCaller` 调用与网页**同一套** tRPC 过程（ADR-0015），因此不需要 Next.js 服务常驻——只需要 PostgreSQL。

```shell
# owner 身份来自环境
export FATEBOOK_AGENT_USER_EMAIL=you@example.com

npm run --silent agent -- list-due                       # 已到期且未结算
npm run --silent agent -- create-prediction \
  --title "接这个 offer" \
  --resolve-by 2026-06-30 \
  --criteria "邮件中出现正式 offer 链接" \
  --probability 70%                             # 省略即“未量化”（合法状态）
npm run --silent agent -- list-unendorsed                # 尚未计入校准
npm run --silent agent -- endorse --question-id <id>
npm run --silent agent -- settle --question-id <id> --resolution YES --source <url>
npm run --silent agent -- list-proposals                 # 结算提案
npm run --silent agent -- list-deliveries                # 拉取式待触达队列
npm run --silent agent -- report-delivery --notification-id <id> --outcome DELIVERED --channel telegram

# 决策（ADR-0019 / ADR-0020）：一个 Decision 含 0..n 个 Prediction
npm run --silent agent -- create-decision \
  --statement "..." --reasoning "..."     # 叙事字段全部可选
npm run --silent agent -- attach-prediction --decision-id <id> --question-id <id>
npm run --silent agent -- detach-prediction --question-id <id>   # 已结算后拒绝
npm run --silent agent -- set-rubric --decision-id <id> --done alternatives,premortem --not-done baseRate
npm run --silent agent -- update-narrative --decision-id <id> --reasoning "..." --reason "..."
npm run --silent agent -- show-decision --decision-id <id>      # 叙事 + 清单 + 各 Prediction 的分数
```

**契约：** stdout 只放 JSON，一切诊断走 stderr。`npm run --silent agent -- --help` 列出全部命令。**`--silent` 不可省**——不加时 npm 会把自己的横幅写进 stdout，破坏“stdout 只放 JSON”的契约（ADR-0015）；`--help` 也走 stderr，理由相同。

Agent 写入的记录会标注录入来源，并**从未背书**开始——它们可见、可复盘，但在题页上由你背书之前不计入校准（ADR-0008）。`parseDecision`（`lib/web/llm_parse.ts`）是有意**未接线**的：Agent 的接口就是 CLI，自然语言解析由 pi 侧承担。

### 怎么验证

| 层                     | 命令                    | 前置                                                                 |
| ---------------------- | ----------------------- | -------------------------------------------------------------------- |
| 类型                   | `npm run typecheck`     | —                                                                    |
| Lint                   | `npm run lint`          | —                                                                    |
| 单元 / 组件            | `npm test`              | —                                                                    |
| 单元 + 覆盖率门槛      | `npm run test:coverage` | —（**CI 跑的是这条**；`npm test` 不看门槛）                          |
| 端到端（agent → 网页） | `npm run test:e2e`      | `docker compose up -d db mail`，再 `npx playwright install chromium` |
| 生产构建               | `npx next build`        | 一个已迁移的库（`pages/global-stats.tsx` 会在构建期从库里预渲染）    |

> `npx playwright install chromium` 拉不到 `cdn.playwright.dev` 时（公司网络 / 代理常见），改用系统上已装的 Chromium 内核浏览器跑同一套用例：在 gitignored 的 `.scratch/` 下放一份只把 `channel` 换成 `msedge` 的本地配置，再 `npx playwright test --config .scratch/pw-local.config.ts`。用例、断言与 webServer 都不变——“跑不起来”是 e2e 长期没被执行的主要原因。

出问题时看哪里：

- **CLI** —— stdout 是机器可读的 JSON；每一行日志（含 Prisma 查询日志，带 `prisma:` 前缀）都走 stderr。
- **网页** —— 题页会渲染记录状态（录入来源、判据类型、结算标准）、琥珀色的“尚未背书”区块与背书按钮、待处理的结算提案（可接受 / 驳回），以及修订历史。
- **数据库** —— 查 `Forecast.endorsed`、`Question.oracleKind`、`Revision`、`ResolutionProposal`、`Notification.deliveryState`。

> 注意：`tsc --noEmit` 是权威的类型判据。`prisma generate` 之后语言服务器可能持有 `@prisma/client` 的陈旧缓存；两者矛盾时以 `tsc` 为准。

### 质量门禁

- Jest 单元测试覆盖：计分、校准样本过滤、结算（含背书触发的重算）、结算生效范围规则（ADR-0031 §六：无来源且由他人确认的结算，会让另一位预测者的样本悬空）、领域命名与判重、领域读数、修订规划、决策清单 / 决策版本规则、凭据→身份分发、LLM 解析、CLI 参数解析与表单行为。`jest.config.ts` 里逐文件的 `coverageThreshold` 给逻辑最密的模块设了下限（含 `domain_stats` / `domain_tags` / `settlement_scope` / `tags_router`）以及校准图端点。
- `cli/parity.test.ts` 从源码读出两个交互面，某条过程只在一侧可达且未登记理由时变红（AGENTS.md §10 / ADR-0023）。`lib/skills_contract.test.ts` 对技能做同样的事：技能里每条 `agent -- <命令>` 必须真实存在，每个写入示例必须声明录入来源。
- `scripts/verify-migration-upgrade.ts` 升级一个**已有数据**的库（先应用升级前的迁移并插入旧结构数据，再 `migrate deploy`），断言本阶段两条回填——`Tag.nameNormalized = lower(name)` 与 `Question.confirmedByUserId = 作者`——以及新的不区分大小写标签键发生冲突时**大声失败**。空库上的 `migrate deploy` 抓不到其中任何一条。它在 CI 的 e2e 任务里运行。
- Playwright 端到端测试：人登录 → 创建 → 结算的完整旅程；agent 经 CLI 写入 → 人在网页背书 / 确认提案；决策领域 → 预测 → 领域读数；悬空 → 补录来源 → 重算计入。另有真 Postgres 上的 `SetNull` 回归。
- CI 在每次 PR 上运行 lint + typecheck + `test:coverage` + 迁移升级验证 + e2e + `next build`，并上传覆盖率与 Playwright 报告作为产物。

> **必需状态检查：** 只有当 `Test / unit` 与 `Test / e2e` 在仓库的分支保护里被设为必需状态检查时，门禁才会真正拦住合并。该设置存在 GitHub 仓库设置里、不在代码树里，因此无法从源码验证——`.github/workflows/test.yml` 里任务名一旦变化，请重新确认。

## 愿景：Agent 原生的决策卫生

目标是让 Agent 成为主要的**捕获入口**：

1. **捕获**——Agent 在对话中察觉用户正面临一个决策。
2. **拆解**——把决策拆成其中真正**可预估**的部分（可结算命题）。
3. **追问**——向用户索取模糊表述背后的具体置信度数字（“我觉得能成” → “六成还是八成？什么时候前？”）。
4. **记录**——带着明确的结算标准持久化这些预测。
5. **校准**——结果揭晓后进入校准与评分闭环。
6. **矫正**——用决策卫生工具（事前剖析、杀死标准、尤利西斯合同、名义群体、寻真小组）改进**过程**，而不只是分数。

**记录与跟踪是分离的。** 记录 Agent 在对话内工作，只负责把决策与预测写下来——结算判据、结算标准与评分锚点在决策时冻结。跟踪委托给**独立上下文中的另一个 Agent**，因此事后重新解释“当初的意思”无法渗入结算。

### 核心原则

1. **区分决策质量与结果质量。** 好过程也会因运气得到坏结果；克制 `Resulting`（以结果反推决策优劣）。
2. **一切决策都是押注。** 每个选择都在信息不完整下投入稀缺资源。
3. **概率思维与信念标定。** 用概率分布替代“确定”，并对新证据保持开放。
4. **放弃同样是一种美德。** 坚持与放弃是同一决策的两面；新的不利信号使放弃成为义务。
5. **保护“未来的自己”。** 用未来的反馈约束当下的短视（对抗当下偏见）。

阶段计划与待定设计决策见 [`docs/roadmap.md`](./docs/roadmap.md)。

## 快速开始——一条命令

```shell
./startup.sh          # 或：npm run startup
```

它会检查 Docker/Node、生成 `.env`、起 Postgres 与 Mailpit、装依赖、跑迁移、**准备一个身份**（不需要邮箱，ADR-0022）、把 agent 技能安装到 `.agents/skills/`，然后打印下一步。可重复执行。

接下来二选一：

- **打开 Web 页面：**

  ```shell
  npm run dev:e2e      # 明文 http，端口 3000
  ```

  浏览器打开 <http://localhost:3000>，用邮箱 magic link 登录——邮件在 Mailpit 里看：<http://localhost:8025>。不需要 SMTP 账号。

- **在 pi 里与 agent 对话**（把本仓库作为工作目录启动 pi）：

  ```shell
  pi --skill .agents/skills/decision-capture/SKILL.md
  ```

  然后说人话就行：_“我在纠结要不要接这个 offer。”_

也可以整套跑在 Docker 里：`cp .env.example .env && docker compose up`（数据库自动创建，迁移在启动时执行）。

### 用哪种身份——真实邮箱 vs 测试账号

本地身份有两种，**两者都能进网页**，区别只在进法：A 走邮件门（推荐，配好就是一个身份两条渠道），B 走本机的一次性**配对码**（纯 CLI 与自动化测试仍然是它更自然的用法）。

**A. 一个真实邮箱——推荐：一个身份，两条渠道。** 域名**带点**的地址都能用，不必真的拥有它。

1. `npm run dev:e2e`，打开 <http://localhost:3000>，用这个邮箱登录。本地这封登录信**不会进你的真邮箱**，而是被 **Mailpit** 截在 <http://localhost:8025>——所以不需要 SMTP 账号。（真部署时把 `AUTH_EMAIL_SERVER` 指向真实发信服务，链接就会进真收件箱。）
2. 登录后打开 **<http://localhost:3000/api-setup>**，复制 **Your API key**。未登录时那一页只有登录**按钮**：它会直接把 key 给你。
3. 写进 `.env`：`FATEBOOK_AGENT_API_KEY=…`。于是 CLI 与网页是**同一个账号**：agent 记的东西在网页上看得见，也能在网页上背书。不想让钥匙进 shell 历史或 `ps` 的话，改用 `FATEBOOK_AGENT_API_KEY_FILE=<路径>`（文件里只放这一把钥匙，末尾换行无所谓）。
4. **重跑一次 `./startup.sh`**。四个初始领域词是**按用户**存的，新身份要有自己的一套——不重跑时 `create-decision --tags 投资/宏观` 会报“未知领域”。
5. 在 pi 里与 agent 对话（`startup.sh` 已装好两个技能），然后到网页 `/decisions`、`/domains` 复盘。

**B. 测试账号（`<label>@localhost`）**——不需要任何邮箱就能建：

```shell
npm run --silent agent -- init --label my-check --allow-create-user
```

用于纯 CLI 检查、脚本与自动化测试。它的邮箱域名不带点，所以**邮件门进不去**（`error=EmailSignin`）——但不必为此再建一个带点地址的账号：把它的 key 交给 CLI，再用下面那条捷径换一个浏览器会话即可。

> **方向仍然单向：Web → CLI 是常态。** 把**网页**账号的 key 交给 agent 最省事（一个身份两条渠道）。反过来（只有 CLI 身份、却想进网页）走一次配对码即可，不必新建账号。

### 网页的第二扇门：本机配对码登录（默认关闭）

邮件门是**人**的门，这一扇是**已经持有凭据的一方**在**本机**开的捷径（ADR-0035）：CLI 签发一个一次性码，人在浏览器里把它换成**同一个**会话。

```shell
# 1. 打开开关（默认关闭是决策本身，不是疏漏）
echo 'FATEBOOK_ENABLE_PAIRING_LOGIN=1' >> .env
# 2. 重启 Web 服务，然后签发一个码
npm run --silent agent -- issue-pairing-code
# → {"code":"XXXXXXXX","expiresAt":"…","redeemUrl":"https://localhost:3000/pair"}
# 3. 在这台机器上打开 redeemUrl，填码
```

五条限制都在服务端（`pages/api/pairing/redeem.ts`）：**只在本机（loopback）可兑换**、**只收 JSON 请求体**（跨站 `<form>` 发不进来）、**一次有效**、**10 分钟**、**失败限流**。签发那一半要**真凭据**：过程层是 `credentialProcedure`，所以网页会话（邮件门或配对码门）与只设了 `FATEBOOK_AGENT_USER_EMAIL` 的进程都会拿到 `FORBIDDEN`——后者是身份选择器，不含秘密（`CONTEXT.md`）。码本身在库里只存哈希，明文只在签发那一刻打印；换来的 cookie 与邮件门同为**会话 cookie**（关掉浏览器即失效）。

> 开关**不能用 `NODE_ENV` 推断**：在内网主机上跑开发模式时那等于给一台服务家人的机器开后门。要对外提供服务时请走**邮件门**（它一直是保留的那条路），并把发信域配好 SPF/DKIM。

每一步该看什么（完整叙事见 [docs/uat-pi-agent.md](docs/uat-pi-agent.md)）：

| 环节 | 命令                                                         | 期望                                                                                                       |
| ---- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 身份 | `npm run --silent agent -- whoami`                           | 就是你登录用的那个邮箱，`credentialSource: api-key-env`                                                    |
| 词表 | `npm run --silent agent -- list-domains`                     | 四个初始领域词（重跑 `startup.sh` 之后）                                                                   |
| 队列 | `npm run --silent agent -- list-due`                         | 三栏：`settleable`（待办）/ `upcoming`（未到点，仅 `--bucket` 下钻）/ `dangling`（缺可核查来源，先补来源） |
| 读数 | `npm run --silent agent -- domain-report --prefix 投资/宏观` | 少于 5 条只给 `n` + `pending`；5 条起给桶；20 条起给技能分与区间                                           |

### 技能放在哪里

`skills/decision-capture/` 是**源**——可见、与具体 harness 无关，按 [Agent Skills 规范](https://agentskills.io/specification)组织（一个目录 + `SKILL.md`）。`startup.sh` 把它**安装**到 `.agents/skills/`：`.agents/` 是跨 harness 的共享约定，pi 也把它当作项目级技能根（见 pi 安装包里的 `dist/core/trust-manager.js`）。安装目录是生成物，已在 `.gitignore` 里——要改就改源，不要改那一份拷贝。

> pi 只在**项目被信任**之后才加载项目级技能（`.pi/skills/` 与 `.agents/skills/` 都受此约束）。首次启动它会问一次；不想信任就显式传 `--skill`。

### 端到端试一遍

四段剧本（捕获 → 跟踪 → 复盘 → 领域读数），另附边界、常见故障与已知缺口，每一段都写了该看到什么：**[docs/uat-pi-agent.md](docs/uat-pi-agent.md)**。

## 开发

```shell
npm install
npx prisma generate --no-hints
npm run dev          # https://localhost:3000，经 3005 的 SSL 代理
                     #   需要 localhost.pem / localhost-key.pem——本仓库不提供
npm run dev:e2e      # 明文 http，端口 3000——没有那两个证书时用这个
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
