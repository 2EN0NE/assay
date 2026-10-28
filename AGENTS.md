# AGENTS.md — 试金石 开发指南

本文件只写本仓库特有的约定与硬约束；通用编码原则不在此重复。

## 核心原则

### 1. 动手前先澄清

- 不确定就问；先问"做什么"，再问"怎么做"，不要一上来钻进细节。

### 2. 测试先行

- 写代码前先设计测试用例；没有就设计好并与用户确认，完成后跑测试回归。

### 3. 经验沉淀

- 把可复用的排查经验记到 `knowledge/`；优先归类合并，重要经验同步进本文件。

### 4. 文档语言约定

- **权威文档**（如 AGENTS.md）只用单一语言
- **说明性文档**（如 README.md）可有双语版本——**本仓库的 `README.md` 只用中文**（`README.zh-CN.md` 镜像已删除）
- AI agent 的工作语言：跟随用户偏好

### 5. 用 todo.md 跟踪任务

- 开工前在根目录建 `todo.md` 拆子任务，完成一项勾一项；全部完成后可删除。**它是本机工作记录，已 gitignore，不进版本历史。**

### 6. 用 progress.txt 记录进度

- 每轮会话结束把已完成、关键决策、教训与下一步写进 `progress.txt`；每次迭代都写，新上下文开始时先读。**同 `todo.md`：本机工作记录，已 gitignore，不进版本历史。**

### 7. 战略规划参考

- 工程知识存放在 `knowledge/` 目录
- 战略规划文档是 `docs/roadmap.md`——回答"接下来该做什么？"（基于当前目标与状态）
- 项目根目录的 **todo.md**：本次会话的战术任务拆解
- **docs/roadmap.md**：战略阶段的规划与取舍

当被问到"基于当前战略规划，接下来该做什么？"时，查阅 `docs/roadmap.md`，给出可执行的选项并说明理由。

---

### 8. 交互面对等（CLI ⟷ Web）

CLI 与 Web UI 是**一套能力之上的两个交互面——不是两个产品**。本项目定义的每一项能力（决策、预测、清单与叙事、结算、触达），**只要一面有，另一面就必须有**。差异只允许存在于*形式与习惯*：CLI 服务 agent 与脚本（确定性 JSON、一条命令），Web 服务人（并排、颜色、可点击）。形式的差异不是能力的差异。

- **范围**：本项目自身的功能面。从上游 fatebook 继承的能力（Slack、Discord、Chrome 扩展、锦标赛、博客）**不在**此列——按 ADR-0013，它们大多已在 MVP 之外。
- **对等单元**：一个 tRPC procedure。只能在单面触达的 procedure 必须登记为**有意例外**，并**写明理由**。
- **有意例外**要列出来，绝不静默容忍。第一个是*登录*：Web 用邮箱/OAuth 登录，CLI 用凭据——能力（"证明我是谁并取得凭据"）相同，形式无法相同。当前清单：[ADR-0023](docs/adr/0023-interaction-surface-parity.md)。
- **强制手段**：`cli/parity.test.ts` 是门禁。它**从源码**读取每一面的可达性——CLI 面读 `cli/commands.ts`，Web 面读 `pages/` 与 `components/` 下的 `api.<router>.<name>` 引用——再把 `agent`、`decision`、`tags` 三个路由的每个 procedure 与例外清单比对：只能在单面触达、又没有登记理由的 procedure，会被失败的测试点名。过期的例外（另一面已经追上）同样会变红，促使删除该行。

  代价是例外清单**维护在测试文件里**（每条都必须带理由，抄自 ADR-0023 的"当前例外清单"）：新增 procedure 却没决定它在另一面落在哪里，门禁就会失败。这是刻意的——"静默缺失"正是这条规则要防的东西。

理由、被否决的方案与当前例外清单：[ADR-0023](docs/adr/0023-interaction-surface-parity.md)。

#### 一个后端，三种暴露面

业务行为**只有一份实现**：`lib/web/` 里的 tRPC procedures。交互面只是这些 procedure 之上的适配器，绝不是第二套规则实现。

| 暴露面                     | 位置                    | 如何到达后端                                                                                                             |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| CLI（agent、脚本）         | `cli/`                  | **进程内**调用 `appRouter`；为*业务*操作直接碰 `prisma` 是被禁止的（身份查询、连接关闭与预检计数属于基础设施，不是业务） |
| Web（人）                  | `pages/`、`components/` | 经 tRPC 调用同一批 procedure                                                                                             |
| Agent 技能（任意 harness） | `skills/`               | CLI 命令面的**投影**——只有说明与示例，绝无自己的行为                                                                     |

因此新增能力的顺序是固定的：**procedure → CLI 命令 → 技能条目 → Web 入口**。最后一项只在该能力面向用户时才需要；`cli/parity.test.ts` 的对等门禁会判定这一点，两面都安置好之前，新能力不算完成。

**用哪个基元：`ownedProcedure` 还是 `credentialProcedure`**（ADR-0035）。每个 procedure 都继承三种"凭什么"之一——`ctx.authentication` 为 `session`（HTTP 路径，永远如此）、`credential`（真 API key，来自 `--api-key` / 环境变量 / 钥匙文件）或 `identity-selector`（`ASSAY_AGENT_USER_EMAIL`，它**不是**秘密：机器上谁设了它，谁就是该身份）。`ownedProcedure` 三者都接受；`credentialProcedure` 只接受 `credential`。只有**凭据持有者本人**才能做的事——今天就是签发配对码——必须用 `credentialProcedure`；否则网页会话可以自己通过 `/api/trpc` 做，ADR 那句话就成了一句注释。映射写在构造处（`lib/web/context.ts`、`cli/context.ts`），并由 `cli/context.test.ts` 断言。

**Harness 中立。** 技能必须能在任何遵循 [Agent Skills 规范](https://agentskills.io/specification) 的运行时加载——技能正文里不得出现 pi 专属路径或参数；技能必须**显式**声明录入来源，而不是依赖调用方环境（环境标记只提供默认值；见 ADR-0024）。非 pi 的 agent 必须记下 pi agent 会记的内容。

**交付物形态。** 每一项面向 agent 的能力都要带一条可执行的验收路径：说什么、跑什么、观察到什么。"应该能用"不算验收——第一个例子见 `docs/uat-pi-agent.md`。

**不造 harness 专属物。** 本项目交付三种暴露面：CLI、Web UI、Agent Skills。凡是只在某一个 agent 运行时里才成立的东西——pi 扩展、Claude hook、cron、常驻推送进程——一律出局，无论多方便：它把"这能不能用"重新绑回那个运行时，而技能格式存在的意义正是避免这件事。因此提醒与跟踪都是**拉取式**的：`AGENTS.md` 让 agent 在会话开始时拉一次到期队列，技能说明什么时候拉。绝不用后台进程。

---

## 验证规范（agent 记录层）

本节是"agent 化改造"新增能力的**验证契约**。改动这一层之前先读它——这里的每一条都对应一个已定 ADR，破坏它们等于静默推翻决策。

### 权威判据是 `tsc`，不是语言服务器

**`npx tsc --noEmit`（或 `npm run typecheck`）是唯一权威的类型判据。**

本仓库存在一个反复出现的环境陷阱：`prisma generate` 之后，tsserver 仍持有 `@prisma/client` 的**陈旧缓存**，于是 IDE / pi-lens 会报出一批 `Property 'oracleKind' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'` 之类的错误——注意那个 `never`，它是**生成前的 stub 类型**的特征。

分辨方法（三条缺一不可，成本极低）：

1. `npx tsc --noEmit --listFiles | grep <文件>` —— 确认文件**真的在 tsc 的 program 里**，否则 exit 0 不能作为证据；
2. `npx tsc --noEmit` —— 独立进程，新鲜解析；
3. `grep -c <字段> node_modules/.prisma/client/index.d.ts` —— 确认生成产物里确实有该字段。

判据是"文件在 program 内 + tsc 干净 + 字段存在于生成产物"。三条同时成立即为陈旧缓存，重跑 `prisma generate` 或重启语言服务器即可，**不要改代码去迎合它**。

**pi-lens 的额外规则不是本仓库的门禁。** 它的格式化器与 Prettier 兼容（实测：它重排过的文件仍过 `prettier --check`），但它另外跑一套仓库不管的规则（Markdown MD060、对 `scripts/` 也报 `no-console`）。判定本仓库是否合格，只看 `tsc` + `next lint` + `jest`（CI 口径见下表）。

**`pi-lens-ignore` 标记只用于真实规则。** 本仓库已有三处（`no-eval` / `no-open-redirect` / `unchecked-throwing-call`）——那是“这条规则我不接受”的声明。**不要用它给工具自身的 bug 打补丁**（例如陈1旧 Prisma 快照导致的 `typescript:2322`）：那种补丁会长期留在源码里，而它真正需要的是重启语言服务器。`.pi-lens.json` 这类本机配置已进 `.gitignore`，不要入库。

### 分层验证命令

| 层                     | 命令                    | 前置                                                               |
| ---------------------- | ----------------------- | ------------------------------------------------------------------ |
| 类型                   | `npm run typecheck`     | 无                                                                 |
| Lint                   | `npm run lint`          | 无                                                                 |
| 单元 / 组件            | `npm test`              | 无                                                                 |
| 单元 + 覆盖率门槛      | `npm run test:coverage` | 无（**CI 跑的是这条**；本地只跑 `npm test` 会看不到门槛）          |
| 端到端（agent → Web）  | `npm run test:e2e`      | `docker compose up -d db mail` + `npx playwright install chromium` |
| 生产构建（客户端打包） | `npx next build`        | 无（**在 `pages/` 下新增或被导入的模块必须跑这条**，见下）         |

> **本地要跑与 CI 完全一致的那条**：`.github/workflows/test.yml` 的门禁是 `test:coverage`（`jest.config.ts` 的 `coverageThreshold` 只在它下面生效）。历史上交付记录里写的都是 `npm test`，于是某个新模块跌破阈值时**本地全绿、CI 全红**，谁都没看见。`.husky/pre-push` 现在跑的就是 `test:coverage`。

> **`pages/` 下的模块必须能被浏览器打包**：页面即便只在 `getServerSideProps` 里用某个
> 服务端模块，Next 也会把它打进**客户端**那一份 bundle。一个 `import crypto from "node:crypto"`
> 就足以让整页变成 "Build Error"（实测：`UnhandledSchemeError: Reading from "node:crypto"
is not handled by plugins`），而 `tsc` / `eslint` / 单测全绿——**只有 `npx next build`
> 或 e2e 看得见**。做法是把浏览器要用的部分拆到一个零 `node:` 依赖的叶子模块里
> （`lib/web/pairing_flag.ts` 就是为此存在，`pairing_flag.test.ts` 用源码断言守住这条）。

### 改动数据库里**已有的**数据之前，先跑 `scripts/verify-migration-upgrade.ts`

**这是什么时候的事。** 库里已经存着真实数据（题、预测、结算记录……）。有时候改动不只是“加一张新表”，而是**要动那些已经存在的老行**。两种情况最常见：

1. **回填**：新加一列（例如“这条结算是谁确认的”），同时**替历史上已经结算过的老题把这一列补上**。补什么值是**你替过去的用户做的一个决定**。
2. **收紧规矩**：例如“领域名不允出现只差大小写的两个”。库里若真有 `CPI` 和 `cpi` 两行，迁移会**失败**——这是**想要的**（得有人来决定合并哪一个），但你得提前知道。

**为什么不能只靠 CI。** CI 里的 `prisma migrate deploy` 每次都在一个**全新的空库**上跑。空库上没有老行，回填等于什么也没做，所以**写错也照样绿**。它只证明了“迁移能跑起来”，没证明“你库里的几百行会被改成什么样”。而回填写错的后果是**不报错的**：样本静静地少一批或多一批，数字变了而你不知道。

**它能帮上什么忙。** 它开一个独立的小库（**不碰你的开发库**），先把这次改动**之前**的迁移都应用上去，塞进一批符合老结构的数据，再跑完整迁移，然后检查三件事：

1. 该补的有没有补上（老行现在有值了吗？值对不对？）；
2. 不该动的有没有被动（例：没结算的题不该被写上确认者）；
3. **该失败的地方有没有失败**（有大小写冲突时必须大声报错，而不是悄悄丢掉一行）。

跑法：`npx tsx scripts/verify-migration-upgrade.ts --keep`（`--keep` 把那个样本库留下，可以自己进去看）。CI 每次会替你跑一遍。

**⚠️ 它只认识写死的那几条迁移，不会自动跟上你新写的。** 所以新增迁移时：

- 只是加新表 / 加一个**允许为空**的新列（不回填）/ 只加索引 / 改注释 → **不用管它**；
- 要**回填老数据**或**收紧约束** → **必须在这个脚本里补上检查**（把新迁移加进顶部的 `UPGRADE_MIGRATIONS`，并在同一脚本里加断言）。否则 CI 的绿灯与这次的改动无关——**比没有门禁更糟**：没有门禁时你知道自己在裸奔，有骗人的绿灯时你以为有人守着。

### 可观测性契约

- **CLI 的 stdout 是数据通道，只放 JSON；一切日志走 stderr。** 这是对 Agent 的公开契约（ADR-0015）。Prisma 默认把 `info` 写到 stdout，足以让下游 `JSON.parse` 崩掉——因此 `lib/prisma.ts` 用 event 模式接管输出，统一改道 stderr。**新增任何会写 stdout 的库之前，先确认它的输出去哪儿。**
- **调用 CLI 必须用 `npm run --silent agent -- …`**。不加 `--silent` 时 npm 会把自己的横幅（`> agent` / `> dotenv …`）写进 stdout，实测直接破坏上面那条契约；`--help` 同理走 stderr。
- **CLI 可达的代码用 `lib/_log.ts` 的 `log`（走 stderr），不要用 `console.log`**。`lib/web/resolution.ts`、`lib/_utils_server.ts`、`lib/web/notifications.tsx` 的 `console.log` 已全部改道（`settle` / `endorse` 会走计分路径，实测曾把 stdout 污染成不可解析）。CLI 边界另有一道守卫（`cli/args.ts` 的 `installStdoutGuard`）：非 `emitJson` 的 stdout 写入会**当场抛错**，而不是留给下游 `JSON.parse`。
- **校准排除只有一个定义处**：`lib/web/calibration.ts`。任何读取 forecast 做计分或画校准图的地方都必须经过它（ADR-0008）。新增计分入口时若不经过它，未背书样本会静默污染校准曲线，且**没有任何症状**。
- **相对分资格同在 `lib/web/calibration.ts`**（ADR-0002 的 `isRelativeScored`）：非公共事实类由**写入侧**把 `relativeScore` 写成 `null`（`lib/_scoring.ts` 的 `dropRelativeScores`），**读侧一律把 null 当"不参与相对分"**（`AVG` 忽略 null、聚合处 `!== null` 过滤）。新增计分或排行榜聚合时不要自行判断 `oracleKind`，也不要把 null 当成 0。
  - **「不参与相对分」只有 `null` 一个表示**（ADR-0002 的落地面）。单预测者与 非公共事实类 都归到它。**`undefined` 会被 Prisma 当作"跳过该字段"**——create 看着对（列默认 NULL），update 却把旧的相对分留在库里，因此 `ScoreTuple.relativeBrierScore` 的类型是 `number | null`，不是 `number | undefined`。
  - `RELATIVE_SCORED_ONLY` 是同一规则的 Prisma `where` 形式，**当前没有消费者**（过滤发生在写入侧）。**不要为了"用上它"而新增查询侧过滤。**
- **修订留痕的判定是纯函数**：`lib/web/revisions.ts` 的 `planRevisions` 与 `missingRevisionReason`。写入路径（`question_router.editQuestion`）只负责取快照、校验理由与同事务落库。新增"已冻结字段"时改这个常量数组，而不是散落地加 if。

### 端到端测试保护的是哪条路径

`e2e/agent-cli.spec.ts` 覆盖的**唯一**值得保护的路径：**agent 经 CLI 写入 → 人在 Web 上看到 → 人背书 / 确认**。

- 先跑 CLI 再开页面，是为了证明 CLI **不依赖 Next.js 服务**（ADR-0015 的核心承诺）。
- 断言"未背书"标记与背书按钮，是为了让 ADR-0007（人工 UI 是最高权威输入源）不沦为空话——**如果 agent 写下的东西在界面上看不见、无法背书，"未背书不进校准"就是一条无法履行的规则。**
- 断言"无来源的公共事实结算降级为提案"，是 ADR-0004 的行为锁。

### 本地环境注意

- 迁移可在**无数据库**时离线生成：`npx prisma migrate diff --from-schema-datamodel <旧> --to-schema-datamodel prisma/schema.prisma --script`。
- 本地 CLI 与 e2e 都依赖 `.env`（被测仓库不含该文件，从 `.env.example` 复制）。CLI 的 owner 身份来自 `ASSAY_AGENT_USER_EMAIL`，**该邮箱必须已存在账号**（先在 Web 用 magic link 登录一次即可创建）。
- **改名后（ADR-0042）的两处本地陷阱**，症状都指向错误的地方：
  - shell 里**导出过** `DATABASE_URL` 时，`dotenv` 不覆盖它 ⇒ 命令连到改名前的库并报 `Database "<旧库名>" does not exist`。用 `env -u DATABASE_URL -u DATABASE_DIRECT_URL` 跑。
  - 已有 `docker-compose` 数据卷上 `POSTGRES_USER` / `POSTGRES_DB` **不生效**（只在空数据目录时读），而 `pg_isready -U assay` 在角色不存在时照样通过 ⇒ 报 `FATAL: role "assay" does not exist`。手工 `CREATE ROLE assay …` + `ALTER DATABASE … OWNER TO assay`，或 `down -v`（**丢数据**）。完整步骤见 `docs/adr/0042-brand-rename-and-identifiers.md`。
- macOS 无 `timeout` 命令；`sed -i` 需要空参数 `sed -i ''`。

---

## 文档声明必须可在仓库里被验证

**任何"已实现 / 已完成"的陈述都要能在当前仓库里被检验**：AC 勾选、`Status` 行、CLI 命令的 `summary`、README 的步骤、文档里的字段名，一律如此。做不到就只有两条路——**实现它**，或**把陈述改成如实并注明推迟**；不要留许愿式文档。

判据是可核对的：说"已完成"就要能指出**在哪里可跑、在哪一行可读**；指不出来就不是已完成。这条并非洁癖——一次评审从同一种毛病里抓出多处：数据模型文档写着 `note`（可选补充）而全仓无人写、无人显示；`show-decision` 的 `summary` 称返回"分数"而实现只回标量；ticket 的 AC 勾着"叙事仍可补充"，而那个写入口没有任何调用方；多处 `[x]` 与其实现不符（含一条**假 `[x]`**：称某个词条已修正，而实际只改了正文、没改标题）。**声明与实现不一致时，后来的人会按声明行事，而错的是声明。**

同理适用于**数字快照**："全量 N 个测试通过"这类数字一交付就陈旧，因此**优先给可重跑的命令**（`npm test` / `npm run test:e2e`）；确实要记数字，就必须标明它是**当时快照**——`docs/issues/agent-capture-mvp/verification.md` 是正例：正文给数字，紧跟一句"上表两组数字是记录当时的状态"。

**借用外部术语必须在首次出现处给出处。** 术语首次出现处写清来源（作者、文献、年份、章节），中文译名以 [`CONTEXT.md`](CONTEXT.md) 为准；本工程自造的术语不要用「English / 中文」的双语格式包装——那会让读者以为有外部出处，去查却查不到。

---

## ADR 只追加，但必须写明它改掉了哪一句

ADR **只追加、不回改**：历史决策保持原样，新结论写进新的一篇。代价是**同一件事会在多篇里留下多个"最新版本"**，而读者无从判断哪个作数。一次针对 `docs/adr/` 的评审就从这条漏洞里抓出成组的矛盾：ADR-0007 用"有没有明确指令"定义 provenance，而 ADR-0008 明确说判据取"数字的来源"、两者会分歧，0007 的正文至今没改；ADR-0020 定的清单锁定不可回退，与 ADR-0012"已冻结字段可改、留痕即可"并存；ADR-0006 立下"必选"的保证，而 ADR-0005 / 0015 / 0017 把唯一的兑现者（时机）整体移出本仓库。

因此：**每篇新 ADR 必须显式写出它修正了谁**——哪一篇、哪一句、原来怎么规定、现在改成什么。两种改法分别这样写：

- **取代**：`本 ADR 取代 ADR-00XX 关于「…」的规定（原句见该篇第 N 节）。`
- **收窄 / 补充**：`ADR-00XX 的「…」在本 ADR 下收窄为「…」，其余不变。`

没有改动就不必写。判据是可核对的：**读那篇旧 ADR 时，能顺着指回新 ADR 的那句话知道"此处已变"**；做不到就会出现两篇都是最新版的局面——那不是保留历史，而是两套规则并行，且没人知道自己读的是哪一套。

---

## 概率显性化（对话层）

本节管"当事人嘴里的说法"如何变成一个 `Forecast` 的概率数字。术语见 `CONTEXT.md` 的 `Elicitation / 概率显性化`，问法见 `skills/decision-capture/SKILL.md` 第 3 步。

- **基准：模糊的正确优于精确的错误。** 不要为了形式整齐拒绝一个粗粒度回答（"满分 10 分里的 8 分"），也不要因为一个数字"太精确"就改写它——精度本身携带信息。
- **口语与量表回答必须折算为概率。** "七成"→0.7、10 分制的 8 分→0.8、转盘上 65% 才肯下注→候选 0.65。它们是**同一信念的不同表示**，不是另一个量；`Forecast` 只存概率。
- **判据是"换算是否无损"。** 无损（换表示）→ 可直接落库；有损（需额外假设）→ 必须**复述给当事人确认**后再落库。
- **否定检验只能用命题的逻辑否定。** "明天不下雨"是"明天下雨"的否定；"天晴"不是——雨 30% 与晴 10% 可由阴天 60% 补齐，因此二者**不构成矛盾**。用近义事件当否定会产生无根据的追问，而无根据的追问正是「随口给的数字」的来源。
- **具体化量到的是偏好，不是信念。** 赌局同时测出风险偏好与赌注大小，其输出只是候选值，必须经当事人确认；**不得由 agent 按"风险中性"自行折算**。
- **折算结果的录入来源（ADR-0008 / ADR-0024）：** 直接说出的百分比、量表折算结果、经确认的具体化候选值，都算"数字由当事人给出"（已背书）；只有 agent 自己产生、当事人从未说过的数字才是 `--agent-collected`（未背书，须背书后才计入校准）。**默认方向按调用上下文决定**：agent 代跑（环境里有 `AI_AGENT` / `PI_CODING_AGENT`）时默认未背书，人自己在终端里敲时默认已背书；`--stated-by-owner` 与 `--agent-collected` 是显式声明，永远压过默认。旧值 `AGENT_INSTRUCTED` 已不再产生（历史行仍在库里）。

---

## 跟踪回路：会话开始时拉一次状态简报

skills 有两半：`decision-capture`（捕获）与 `settlement-tracking`（跟踪）。**只有捕获没有
跟踪时，队列会积一堆永远不结算的题**，而“永远不结算”不会报错——它只是让所有读数慢慢
失效（ADR-0034）。

**会话开始时先拉一次简报**（对话涉及决策 / 复盘 / 到期时也先拉）：

```bash
npm run --silent agent -- brief
```

`brief` 是**现算**的当前状态（ADR-0039：不落库、只有一个生产者）：未结算总数与到期分布
（逾期 / 一周内 / 一月内 / 一月以上）、最近 3 条、清单有未记录条目（可救 / 已冻结）、未标领域、
未背书数字、无预测的决策、**承诺到期却没执行也没放弃的动作数**。每一栏都带 `seeAlso`
下钻命令——直接照抄它，不要自己拼。

- **三栏各归各位**（在 `list-due` 里；`brief` 只报到期分布 `due`）：`settleable` 是待办；
  `upcoming` 是“还没到点”（见下一条）；`dangling` 是“没法定论”（只有他人的无来源确认，
  ADR-0031）——后者需要的是补来源或问当事人，不是你去结算。
- **`settleable` 与 `dangling` 不要混**：混在一起会让人把“没法定论”读成“我还没去结算”，
  于是去替别人签字。
- **`--bucket` 下钻到未来分桶时，待办栏是空的**：`1w` / `1m` / `1m+` 的项还没到点，落在
  `upcoming` 栏。把 `upcoming` 当待办去结算，会把“一周内”读成“现在就该结”——而三栏的
  名字不同，正是为了让这种误读不可能发生（ADR-0039）。
- **提醒上限**：报**计数 + 分布**，明细最多 **3 条**，然后停下。不阻塞对话、不在每次
  回复里重复（ADR-0034 §四 / ADR-0039）。一条被忽略的提醒和不存在没有区别。
- **未标领域、未背书、清单未记录即使为零也要各报一行**——它们依附的是“拉过一次”，
  不是“数字非零”（ADR-0030 §八 / ADR-0038）。
- **动作逾期优先**：`actions.overdue > 0` 时先说它，再说到期预测——“你承诺要做而没做”
  比“世界该给答案了”更该动手（ADR-0041）。下钻：`list-decisions --action-overdue`。
- **默认不主动结算**：结算不可回退（ADR-0020 的锁定单向性）。先说清要结哪几条、依据是
  什么，等用户点头。
- 悬空那一栏的出口是**补录可核查来源**（`record-resolution-source`），但来源必须是真的：
  问用户，不要编一个链接填空——那比悬空更糟。

## Agent 主回路（自足，ADR-0040 的基线）

不装任何 skill 时，按这个顺序也能把一件决策走完。参数细节在 skill 里，这里只给**不变量**。

```bash
# 1) 捕获：先写下动作与承诺时点（ADR-0041），再记清单，再拆预测
npm run --silent agent -- create-decision --statement "…" --action "…" --action-due 2026-11-01
npm run --silent agent -- set-rubric --decision-id ID --done a,b --not-done c,d,e
npm run --silent agent -- create-prediction --title "…" --resolve-by 2026-11-15 --criteria "…" --probability 0.7 --stated-by-owner
npm run --silent agent -- attach-prediction --decision-id ID --question-id QID

# 2) 结算：带来源直接结算；无来源先提提案等确认（ADR-0004 / ADR-0031）
npm run --silent agent -- settle --question-id QID --resolution YES --source "…"

# 3) 执行事实：只增不改；放弃用 --abandoned（ADR-0041）
npm run --silent agent -- record-execution --decision-id ID

# 4) 事后表达：揭晓后写复盘记录，不要再改叙事字段（ADR-0037）
npm run --silent agent -- record-reflection --decision-id ID --text "现在回看…"
```

三条硬规矩：**写入只走 CLI**（不要直连数据库）；**不要替用户编概率**（宁可未量化，
ADR-0011）；**清单“未记录”不等于“没做到”**（ADR-0038）。

## 基线与加速器（ADR-0040）

- **基线**：CLI（`brief` + 下钻）+ 本节与上面的主回路 + `skills/`。任何 harness 都能跑。
- **加速器**：pi 扩展，在 `before_agent_start` 把 `brief` 按轮注入。它只负责“到达”，
  **删掉它回路仍然完整**；失效时必须自报 `state="unavailable"`，不得静默消失。

**不做**：cron、常驻守护进程、外部推送通道、任何**承载正确性**的 harness 专属物。
只在一个运行时里能用、且删掉就做不成事的东西，会把“这套流程能不能用”重新绑回那里，
而**失效时不会有任何报错**（ADR-0034 §二，按 ADR-0040 收窄）。

## 日志体系

日志只有一个出口（`lib/_log.ts`），stdout 只归数据。这条契约的破坏方式是**静默的**：一行 `console.log` 会让下游 `JSON.parse` 崩在一个离案发现场很远的地方。

| 出口               | 位置          | 通道       | 放什么                                                                                                   |
| ------------------ | ------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `emitJson()`       | `cli/args.ts` | **stdout** | CLI 的**数据**。唯一合法写入者，由 `installStdoutGuard()` 守卫——非 `emitJson` 的 stdout 写入**当场抛错** |
| `log()` / `warn()` | `lib/_log.ts` | **stderr** | 其它一切：诊断、警告、CLI 的用户可见输出、Prisma 事件、`--help` 文本                                     |

- **项目代码不要直接调用 `console.*`**，用 `lib/_log.ts` 的 `log` / `warn`。ESLint 的 `no-console` 就是这条契约的执行者（`.eslintrc.json`；`lib/_log.ts` 自身与测试文件豁免）。`npm run lint` 的范围已含 `cli/` 与 `e2e/`（`package.json`），所以 CLI 里误用 `console.log` 会被 CI 拦住。
- **`log` 用 `console.error`、`warn` 用 `console.warn`，这是刻意的**：Node 里**只有这两个方法写 stderr**，`console.log` / `console.info` 写的是 stdout。浏览器里它们仍是普通 console 方法，行为不变。
- **需要上下文时把来源写进消息本身**（例如 `prisma:info …`），不靠前缀约定。早先 CLI 有一套自己的 `log` 实现与 `[agent]` 前缀，已删除——**两套实现比少一个前缀糟得多**。`lib/prisma.ts` 的 event 订阅、`--help` 文本、CLI 的用户可见输出现在都经同一个出口。
- **新增任何会写输出的库之前，先确认它的输出去哪儿。** Prisma 默认把 `info` 写到 stdout（足以让下游 `JSON.parse` 崩掉），现由 `lib/prisma.ts` 的 event 模式接住并统一改道。
- **验证（两条，缺一不可）**：
  - `npm run --silent agent -- list-due | jq .` —— stdout 必须**可解析**。不加 `--silent` 时 npm 会把自己的横幅写进 stdout，同样破坏契约。
  - `npm run --silent agent -- --help >/dev/null` —— `--help` 必须走 stderr（stdout 字节数为 0）。

## 本地身份的两种用法（正式 vs 验证账号）

**先选身份，再动手**：两种身份的可用范围不同（见下表）。

|          | 正式身份（推荐）                                                                            | 验证账号                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 怎么来   | 网页用**带点域名的邮箱**登录 → `/api-setup` 复制 key → 写进 `.env` 的 `ASSAY_AGENT_API_KEY` | `npm run --silent agent -- init --label <名> --allow-create-user`（建出 `<名>@localhost`）                                                                                                            |
| 能上网页 | ✅ 一个身份两条渠道（agent 写的，网页看得见、可背书）                                       | ✅ 可，走**配对码**：`ASSAY_ENABLE_PAIRING_LOGIN=1` 后 `issue-pairing-code` → 本机打开 `/pair` 填码（ADR-0035）。❌ 邮件门仍然进不去：域名不带点的地址在 NextAuth 发信前就被拒（`error=EmailSignin`） |
| 适合     | 走完整回路、UAT、任何"人要看到数据"的场景                                                   | 纯 CLI 检查、脚本、迁移验证、e2e                                                                                                                                                                      |

**规则（按踩坑顺序）**

1. **把网页账号的 key 交给 agent**（Web → CLI 是常态）。不要用 `init` 建的 `<label>@localhost` 去走**邮件门**（发信前就被拒）；它要进网页就走配对码（默认关闭，见上表）。
2. **换身份后重跑 `./startup.sh`**。领域词表**按用户**存（`@@unique([nameNormalized, userId])`）；不重跑时 `create-decision --tags 投资/宏观` 会报“未知领域”。
3. **本地 magic link 只会到 Mailpit**（<http://localhost:8025>），不进真邮箱。只要域名带点，填一个你并不拥有的地址也能登录。
4. **想造"两面都能用"的本地身份**：用带点的地址（`ASSAY_AGENT_USER_EMAIL=you@assay.local`）最省事；已经建好的 `<label>@localhost` 也可以是两面的——用配对码进网页，不必重建。
5. **签发配对码要求真凭据**（ADR-0035）：`issue-pairing-code` 在 `ASSAY_AGENT_USER_EMAIL` 那条路径上**会被拒**——那是**身份选择器**（不含秘密，谁设了都能以该身份跑命令），过程层是 `credentialProcedure`，只认 `ctx.authentication === "credential"`。要签发就把 key 放进环境变量或 `ASSAY_AGENT_API_KEY_FILE`；`whoami` 会告诉你当前是哪一档。
6. **身份作用域是进程，不是目录**（ADR-0036）：优先级 `--api-key` > `ASSAY_AGENT_API_KEY` > `ASSAY_AGENT_API_KEY_FILE`（文件里只放一把钥匙，从头到尾不留 shell 历史）> `ASSAY_AGENT_USER_EMAIL`。所在副本的 `.env` 只是**默认来源**：同一个目录里跑两个进程、各自带一把钥匙，就是两个身份；同一把钥匙被两个进程用，则两边是同一个身份（允许）。**一个进程内不换身份。**
7. **判据（排查登录问题时用，别靠猜）**：
   - 打一次登录接口看是哪种结局：`curl -s -c /tmp/cj http://localhost:3000/api/auth/csrf` 取 token，再 `POST /api/auth/signin/email`（带 `csrfToken` / `email` / `callbackUrl`）——落在 `verify-request` 是**发信成功**，落在 `error=EmailSignin` 是**地址被拒**。
   - 想知道是"邮件层"还是"应用层"：直接对 Mailpit（`smtp://localhost:1025`）试投同一个地址。**Mailpit 收得下而应用报错 ⇒ 问题在地址校验，不在邮件服务。**
