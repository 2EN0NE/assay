# 用 pi 走一遍：从记录决策到领域读数

这份文档是**基于 pi 会话**的验收剧本，不是命令行手册。命令行只作为**观测工具**出现——
真正的使用方式是：你在对话里说人话，agent 负责落库与跟踪；每一步的观测点都能在仓库里
被一条命令或一个页面路径验证。

## 0. 前置：一条命令

```bash
./startup.sh          # 或 npm run startup
```

它会：检查 Docker/Node → 生成 `.env` → 起 Postgres 与 Mailpit → 装依赖、跑迁移 →
**准备一个身份**（不需要邮箱，ADR-0022）→ 建好四个初始领域词 → 把**两个**技能安装到
`.agents/skills/` → 打印下一步。可以重复执行。

### 用独立库跑 UAT（推荐：不动开发库）

```bash
# 1. 建库
docker compose exec -T db psql -U assay -d postgres -c "CREATE DATABASE assay_uat"

# 2. 把 .env 里的**两个**变量都指过去（只改 DATABASE_URL 不够，见下方说明）
#    DATABASE_URL=postgresql://assay:postgres@localhost:5432/assay_uat
#    DATABASE_DIRECT_URL=（同上）
npx prisma migrate deploy

# 3. 建身份并灌合成样本（40 + 24 + 20 + 3 条已结算 + 4 条悬空）
npm run --silent agent -- init --label uat --allow-create-user     # 记下返回的 userId
SEED_USER_ID=<上一步的 userId> npx tsx scripts/seed-uat-samples.ts
```

> **为什么必须同时改 `DATABASE_DIRECT_URL`**：`prisma/schema.prisma` 里写着
> `directUrl = env("DATABASE_DIRECT_URL")`，而**迁移走的是 directUrl**。只改 `DATABASE_URL`
> 的话，`prisma migrate deploy` 会安静地把迁移应用到开发库，而你以为在给 UAT 库建表
> （实测踩过：`Datasource "db": … "assay_development"` 而命令没有报错）。

> **角色名（`assay`）需要手工存在**：`docker-compose.yml` 里的 `POSTGRES_USER` / `POSTGRES_DB` **只在空数据目录时生效**——用旧卷的机器上 initdb 建的角色仍是 `fatebook`，而
> `pg_isready -U assay` 在角色不存在时照样返回成功，所以上面第 1 步会报
> `FATAL: role "assay" does not exist`。对齐方式：
>
> ```bash
> docker compose exec -T db psql -U fatebook -d postgres \
>   -c "CREATE ROLE assay LOGIN SUPERUSER PASSWORD 'postgres'" \
>   -c "ALTER DATABASE assay_development OWNER TO assay"
> ```
>
> 或 `docker compose down -v`（**会丢掉本地库全部数据**）。同样地，shell 里若**导出**过
> `DATABASE_URL`，`dotenv` 不会覆盖它，命令会连到你导出那个库并报
> `Database "<改名前的库名>" does not exist`——用
> `env -u DATABASE_URL -u DATABASE_DIRECT_URL` 跑一次即可（见 [ADR-0042](adr/0042-brand-rename-and-identifiers.md)）。

### 技能放在哪里，为什么

- **源**在 `skills/`：可见、与具体 harness 无关，按 [Agent Skills 规范](https://agentskills.io/specification)组织
  （一个目录 + `SKILL.md`，frontmatter 的 `name` 必须与目录名一致）。现在有两半：
  `decision-capture`（捕获）与 `settlement-tracking`（跟踪）。
- **安装目标**是 `.agents/skills/`：跨 harness 的共享约定位置，pi 的信任管理器也把它当作项目级技能根。
- `.agents/skills/` 是**生成物**（已在 `.gitignore` 里）；改 `skills/` 下的源，别改那一份。
- 技能里出现的每条 `agent -- <命令>` 都由 `lib/skills_contract.test.ts` 对着 CLI 校验：
  文档里写了一条不存在的命令，`npm test` 会变红。

> ⚠️ **一个仍然存在的门槛**：pi 只在**项目被信任**之后才加载项目级技能。首次启动会问一次；
> 不想信任就显式指定：
> `pi --skill .agents/skills/decision-capture/SKILL.md --skill .agents/skills/settlement-tracking/SKILL.md`

## 1. 四种操作者（先建立这个心智模型）

| 操作者    | 入口                                 | 能做什么                                     |
| --------- | ------------------------------------ | -------------------------------------------- |
| **你**    | 浏览器                               | 看复盘、领域读数、**背书**、**确认结算提案** |
| **你**    | pi 会话                              | 说人话；agent 据此调用 CLI 落库与跟踪        |
| **Agent** | CLI（`npm run --silent agent -- …`） | 记录、查询、提案、回报触达                   |
| **库**    | Postgres                             | 唯一真相                                     |

CLI 与 Web 是同一套能力的两个交互面（AGENTS.md 第 8 节），**不是两个产品**；哪一侧缺入口，
都必须登记为有意例外并写明理由（`cli/parity.test.ts`）。

## 2. 剧本：四段

启动 pi（把本仓库作为工作目录）：

```bash
cd <repo>
pi --skill .agents/skills/decision-capture/SKILL.md \
   --skill .agents/skills/settlement-tracking/SKILL.md
```

### 第一段 · 捕获：把"纠结"变成可结算的预测

你说：

> 我在纠结要不要接这个 offer

**说什么**：人话即可，不需要先想清楚概率。
**跑什么**：agent 应分两层问——**预测捕获**（判据是什么、期限到哪天、大概给多少概率）与
**决策质量清单**（备选方案 / 事前剖析 / 基准率 / "我可能错在哪" / 判据可证伪），
并**在捕获时先跑一次 `list-domains`** 把现有词表摆给你选（ADR-0030 §七/§十四）。
**看到什么**：

```bash
npm run --silent agent -- list-decisions
# 期望：刚记的决策在列表里（说明它真落库了，而不只是在对话里"记下了"）

npm run --silent agent -- list-domains
# 期望：四个初始词 投资/宏观 · 投资/公司业绩 · 投资/估值与价格 · 投资/交易水平
```

### 第二段 · 跟踪：到期拉队列 → 结算 / 提案 / 悬空

你说：

> 有什么该结算了

**跑什么**：

```bash
npm run --silent agent -- list-due
```

**看到什么**：输出的**一个对象三栏**，不要混读（ADR-0031 §二 / ADR-0039）：

| 栏目         | 含义                   | 你要做什么                                                     |
| ------------ | ---------------------- | -------------------------------------------------------------- |
| `settleable` | 到点了，**有人能核实** | 这是待办：带 `--source` 结算                                   |
| `upcoming`   | **还没到点**           | 只有 `--bucket 1w` / `1m` / `1m+` 下钻时才有内容；别去结算     |
| `dangling`   | 到点了，但**没法定论** | 补来源（`record-resolution-source`）或问当事人，**不是**去结算 |

结算的三种返回（同一条 `settle` 命令自己分流，没有单独的"提提案"命令）：

```bash
npm run --silent agent -- settle --question-id <Q> --resolution YES \
  --source "https://data.example.org/cpi/2026-03" --rationale "官方发布 2.4% < 2.5%"
# → {"mode":"settled"}                    带可核查来源 ⇒ 真的结算了

npm run --silent agent -- settle --question-id <Q> --resolution YES
# → {"mode":"proposed","proposalId":"…"}  无来源 / 该判据需他人确认 ⇒ 降级为提案
# → {"mode":"requires-human-report"}      自我报告类且你不是当事人 ⇒ 去通知他

npm run --silent agent -- list-proposals
npm run --silent agent -- decide-proposal --proposal-id <P> --accept
```

### 第三段 · 复盘：当时 vs 结果并排

你说：

> 复盘一下这条决策

**跑什么 / 看什么**：`npm run --silent agent -- show-decision --decision-id <id>`，或页面
`/decisions`（详情页 `/decisions/<id>`）。期望四样：

1. **清单完成度**：做到几项 / 共几项（可查证的过程记录，不是自评分）
2. **锁定状态与原因**：决策下任一预测结算后清单**只读**（ADR-0020），撤销结算也不回退
3. **每条预测各自的分数**（Brier；单人部署下没有相对分，这是正常状态）
4. **叙事与改写留痕**：改写已填写的字段必须给理由，旧值仍在

页面侧：`npm run dev:e2e` → `http://localhost:3000` → `/decisions`（导航栏无入口，需手打 URL）。

### 第四段 · 领域读数：我在这类决策上什么水平

你说：

> 我在投资/宏观上水平如何

**跑什么**：`npm run --silent agent -- domain-report --prefix 投资/宏观`，
或页面 `/domains?prefix=投资/宏观`。

**看到什么**（下面是 2026-09-16 在 `assay_uat` 上灌入合成样本后的**实际输出**，
不是"应当如此"）：

```text
$ domain-report --prefix 投资/宏观
{"domain":"投资/宏观","n":40,"pending":2,"brier":0.09,"brierRef":0.25,
 "skillScore":0.64,"ci":[0.304,0.880],"verdict":"better"}

$ domain-report --prefix 投资/公司业绩
{"domain":"投资/公司业绩","n":24,"pending":1,"brier":0.41,"brierRef":0.25,
 "skillScore":-0.64,"ci":[-1.791,-0.178],"verdict":"worse"}

$ domain-report --prefix 投资/估值与价格
{"domain":"投资/估值与价格","n":20,"pending":0,"brier":0.25,"brierRef":0.25,
 "skillScore":0,"ci":[-0.333,0],"verdict":"inconclusive"}

$ domain-report --prefix 投资/交易水平
{"domain":"投资/交易水平","n":3,"pending":1}
```

四件读数各自回答一个问题（ADR-0032 §三）：`n`/`pending`（这份读数建立在多少条上，含悬空计数）、
校准分桶与 **分辨率**（形状）、**技能分**（唯一带方向的判据）。判据是
`1 − 我的 Brier / 基准率策略的 Brier`，而基准率**由系统**从该领域已结算题的实际发生率算出——
没有任何自报或可配置入口（ADR-0032 §二/§五）。

三条值得逐条核对的观测点：

1. **`投资/估值与价格` 的技能分恰好是 0**：那组样本每条都押领域基准率本身 ⇒ 按构造
   `Brier == Brier_ref`。它不是"接近 0"，是 0。区间 `[-0.333, 0]` 跨 0 ⇒ 文案只能是
   **"无法判断方向"**（ADR-0033 §四），不许说成"略有提升"。
2. **`投资/交易水平` 只给了 `n` 与 `pending`**：n=3 < 5 ⇒ 连桶都不给；5 ≤ n < 20 给桶与分辨率、
   不给技能分（`N_MIN_FOR_BINS` / `N_MIN_FOR_VERDICT` 在 `lib/web/domain_stats.ts`，
   是代码常量，不是用户数据）。
3. **`n` 与 `pending` 是分开的**：悬空样本进分母、不进判据（`投资/宏观` 的 n=40、pending=2）。
   不透明的分母等于伪造的结论（ADR-0032 §六）。

同一份 fixture 的一组数字也被单元测试逐格钉住（`lib/web/domain_stats.test.ts`）——
文档里的数字与测试里的断言来自**同一份** `lib/web/fixtures/domain_samples.ts`，两边不会各说各话。

## 3. 边界（应当被拒绝的四件事）

| 操作                       | 期望                                    | 怎么验                                     |
| -------------------------- | --------------------------------------- | ------------------------------------------ |
| 预测结算后写清单           | 拒绝，并说明"清单已锁定 + 何时因何锁定" | `set-rubric --decision-id <已锁定>`        |
| 改写已填写的叙事但不给理由 | 拒绝（ADR-0012）                        | `update-narrative` 不给 `--reason`         |
| 给空白叙事字段**补写**     | 允许，不需要理由                        | 同上，但只补空白字段                       |
| 摘掉一条已结算的预测       | 拒绝（锁定不可回退）                    | `detach-prediction --question-id <已结算>` |
| 用一个词表里没有的领域     | 大声失败 + 给出词表指引（ADR-0030 §七） | `create-decision --tags 投资/不存在的词`   |

## 4. 常见故障

| 现象                                                                                                  | 原因                                                                                             | 处理                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pi 里 skill 完全不生效                                                                                | 项目未被信任，或技能没安装                                                                       | `./startup.sh` 重装；或 `pi --skill .agents/skills/<名>/SKILL.md`                                                                                                                                                 |
| agent 报"没有可用身份"                                                                                | `.env` 里没有 `ASSAY_AGENT_API_KEY`                                                              | 跑 `./startup.sh`，或 `init` 后把 key 写进 `.env`                                                                                                                                                                 |
| 迁移"成功"但目标库没表                                                                                | 只改了 `DATABASE_URL`，没改 `DATABASE_DIRECT_URL`                                                | 两个都改（见 §0）                                                                                                                                                                                                 |
| `npm run dev` 打不开                                                                                  | 它需要 `localhost.pem`（本仓库未提供）                                                           | 用 `npm run dev:e2e` + `http://localhost:3000`                                                                                                                                                                    |
| Web 登录收不到信                                                                                      | Mailpit 没起                                                                                     | `docker compose up -d mail`，开 `http://localhost:8025`（邮件就在那儿）                                                                                                                                           |
| `/api-setup` 上找不到输入 key 的地方                                                                  | 那一页是“登录后**给你** key”，不是让你粘贴                                                       | 点 “Sign in to set up your API key”（**它是按钮**）→ 去 `http://localhost:8025` 点邮件里的链接 → 回来复制 “Your API key”                                                                                          |
| 想让 agent 与网页是同一个身份                                                                         | 常态是 **Web → CLI**：用网页的 key 喂 agent（反向也可以：把 CLI 身份用配对码带到网页，ADR-0035） | 把 `/api-setup` 上的 key 写进 `.env` 的 `ASSAY_AGENT_API_KEY`；再重跑 `./startup.sh` 给这个身份建词表（见下一行）                                                                                                 |
| 换完 key 后 `list-domains` 空了、建决策报“未知领域”                                                   | 领域词表是**按用户**存的（唯一键 `nameNormalized + userId`）                                     | **重跑 `./startup.sh`**（幂等，会为新身份建那四个词），或手动 `add-domain` 四次                                                                                                                                   |
| 用 `<label>@localhost` 走**邮件门**登录网页报 **The e-mail could not be sent**（`error=EmailSignin`） | **登录邮箱的域名必须带点**——不是收不到信，是信**发不出去**                                       | 邮件门别试这条。要让它进网页就走**配对码**（ADR-0035，默认关）：`ASSAY_ENABLE_PAIRING_LOGIN=1` → `issue-pairing-code` → 本机打开 `/pair` 填码。想换个带点地址建身份也行：`ASSAY_AGENT_USER_EMAIL=you@assay.local` |
| 服务端开关明明开着，`issue-pairing-code` 却说「配对码登录当前是关闭的」                               | 开关只给了 Web 进程（`npm run dev:e2e` 把它写在命令里），**CLI 进程**读的是 `.env`               | 把 `ASSAY_ENABLE_PAIRING_LOGIN=1` 写进 `.env`（两侧就一致），再重启 Web 服务                                                                                                                                      |
| `issue-pairing-code` 报「签发配对码要求持有凭据（API key）」                                          | 当前身份来自 `ASSAY_AGENT_USER_EMAIL`——那是**身份选择器**，不含秘密，签不了码（ADR-0035）        | `whoami` 看 `credentialSource`；换成 `ASSAY_AGENT_API_KEY` 或 `ASSAY_AGENT_API_KEY_FILE` 再签发                                                                                                                   |

## 5. 结论：机制成立 vs 统计是否成立

这两件事必须分开说，否则一次 UAT 会被读成"系统说我在投资上很行"。

**机制成立（本轮已验证）**：

- 捕获 → 落库 → 队列 → 结算/提案/悬空 → 复盘 → 领域读数，整条回路跑通，每一段的观测点
  都可以用上面给的命令复现。
- 结算的生效范围按可核查性分叉：带来源谁确认都算；无来源只有确认者本人计入，其余**悬空**且可见。
- 领域读数的判据由系统算基准率、带 bootstrap 区间、样本不足时**不给**判据；同样的输入两次运行
  逐位相同。

**统计是否成立（未验证，也不该由本次走查回答）**：

- 上面那些 `n = 40 / 24 / 20 / 3` 来自**合成样本**，它们的数字只能证明"算得对"，不能证明
  "你（或任何人）在某个领域真的有水平"。
- 在**真实数据**上，本机开发库目前远低于 20 条阈值 ⇒ `domain-report` 会只给你 `n` 与 `pending`。
  这是设计（ADR-0032 §四：少样本下显示技能分就是显示噪音），不是故障。
- 因此：**"机制成立"不等于"结论成立"**。真实领域结论要等真实样本积累到阈值以上再谈；
  在那之前，读数给出的形状（校准/分辨率）也只在 n ≥ 5 时出现。

## 6. 已知缺口（别当成 bug）

1. **领域读数只算二元题**：选项级结果与题级发生率不是同一个量，混算会得到一个没人能复算的数。
2. **`rename-domain` / `delete-domain` 只有 CLI**：改名会重写历史归属（带理由留痕），删除只允许零引用；
   Web 侧的整理视图与题目页的写入口一起做（票据 09–11）。
3. **`/decisions` 与 `/domains` 没有导航入口**，需要手打 URL。
4. **复核来源补录只在 CLI**（`record-resolution-source`）：悬空是被队列发现的，而队列在 agent 手里；
   Web 侧入口同上随写入口一起做。
5. **开发库上有 23 条历史结算没有可核查来源**：那些题上**他人**的预测按 ADR-0031 §六 变为悬空
   （作者本人的样本照旧计入，因为迁移回填了确认者）。出口是补录来源，不是放宽规则。

## 7. 两条验收路径：基线与加速器（ADR-0040）

「能不能用」的判据是**基线**：删掉任何 harness 专属物之后，回路仍然完整。

### 7.1 基线（不装扩展、不装 skill 也必须全绿）

```bash
npm run --silent agent -- brief | jq .          # 状态可见（含 actions 计数与 seeAlso）
npm run --silent agent -- --help >/dev/null     # stdout 为 0 字节（日志走 stderr）
npm test -- docs_commands                       # 文档里的命令都真实存在
```

再照 `AGENTS.md` 的「Agent 主回路（自足）」走一遍：建决策（带 `--action`）→ 记清单 →
建预测 → 挂接 → 结算 → `record-execution` → `record-reflection`。**任何一步都不需要 pi 扩展。**

### 7.2 加速器（可选，pi 里每轮注入 `brief`）

> **当前状态：未实现，本节三条全部未验证。** 它按 ADR-0040 §六 属于仓库外的独立包，
> 本轮只交付了基线与本节的验收清单。不要把下面这张表当成"已验证的行为"。

装了扩展时，会话开头应当多出一块 `<assay-status state="live">`。三条失败态也必须可见：

| 场景                | 期望                                                         |
| ------------------- | ------------------------------------------------------------ |
| 正常                | `state="live"`，数字与网页首页的简报卡一致                   |
| 扩展命中缓存        | `state="cache"` 且带 `age`——旧状态不得冒充当前状态           |
| DB 未起 / 无 `.env` | `state="unavailable"` 且带 `reason` 与修法，**对话不被阻断** |

扩展不属于本仓库的交付面；删掉它之后 7.1 必须原样通过。
