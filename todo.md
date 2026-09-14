# Todo List

## Task: 修复自动化测试审查发现（基座 / CI 门禁 / 用例缺口）

来源：一次针对「当前所有代码变更」的测试保障审查。发现 17 条（1×P0、8×P1、4×P2、3×P3），本轮逐条处置。

### P0

- [x] `init` 的两条 ACL 无任何自动化测试 → `cli/init.test.ts`（6 例）+ e2e「CLI 自举建号」用例（断言 `stderr` 不含凭据、护栏退出码 1）

### P1

- [x] `resolution.ts` 覆盖率跌破 50% 门槛（49.91%，CI 门禁红）→ 补 `rescoreResolvedQuestion`（3 例）与 `handleQuestionResolution`（2 例）测试，实测 **84.14%**
- [x] `rescoreResolvedQuestion` 0% 覆盖（ADR-0008「背书后真的改变校准」只断言 mock 被调用）→ 真实函数三条路径各有断言（未结算 / 二元 / 选项）
- [x] 本地与 CI 不是同一条命令（`npm test` vs `test:coverage`）→ AGENTS.md 验证表与 README 都列出 `test:coverage`，`.husky/pre-push` 改为跑它
- [x] CLI 身份分发与 API-key 路径零覆盖（ADR-0021/0026）→ `cli/context.test.ts`（9 例）+ e2e 真库往返（钥匙优先于邮箱、无效钥匙不回退）
- [x] 校准图端点 0% 覆盖、`必须在 calibration.ts 一处定义`无守门 → `lib/web/calibration_graph.test.ts`（9 例，断言查询带 `endorsed: true` 与 `AMBIGUOUS` 被排除）+ 新增覆盖率阈值
- [x] 交互面对等（AGENTS.md §10 / ADR-0023）只有人工评审 → `cli/parity.test.ts`（从源码读两侧可达性 + 12 条例外各带理由 + 过期即变红 + 自证会变红）
  - [x] 额外发现并修掉自己写的门的一个洞：早期用对称差（`cli.has !== web.has`），**两侧都没接线的 procedure 会静默通过**；改成"只有两侧都可达才算对等"后，用真探针验证过会变红
- [x] 分支保护 / required status check 无法在仓库内验证 → README 记录需确认的检查清单（**仍需仓库管理员确认**）

### P2

- [x] 已知 e2e 时序 flake + `retries: 0` → 该用例显式等待对话框关闭；重试只挂在该用例自己的 `describe` 上（CI 1 / 本地 0），全局保持 0
- [x] `.husky/pre-push` 未纳入版本库 → 内容已改为与 CI 一致（**待 `git add`**，见下方提交建议）
- [x] 复盘视图两处界面展示无断言（ticket 11 / 12 自认）→ e2e 新增「逐条分数 + 结果揭晓后记录」用例
- [x] 无 `next build` 门禁 → CI 的 e2e job 末尾加「Build (production)」（复用已迁移的库，因 `global-stats` prerender 读库）

### P3

- [x] AGENTS.md 关于 lint 覆盖范围的陈述过期（说 `cli/` 不在其中）→ 更正
- [x] `resolution.test.ts` 用 `Math.random()` 造 id → 改递增计数器
- [x] 覆盖率 / 失败用例报告未存档 → unit job 上传 `coverage-report` 构件

### 验证

- [x] `npm run typecheck` — 通过
- [x] `npm run lint` — 通过
- [x] `npm run test:coverage` — **224 passed / 18 suites，exit 0**（修复前 185 例且 exit 1）
- [x] `npm run test:e2e`（系统 Edge 顶替下载不到的 chromium）— **10 passed**
- [x] `npx next build` — 通过

### 额外发现（做上述修复时踩到的，已一并处理）

- [x] **Next.js 会把 `pages/` 下的 `*.test.ts` 当成路由**：实测 `next build` 产出
      `/api/calibration_graph.test`，即测试文件变成了生产端点。校准图测试已移到
      `lib/web/calibration_graph.test.ts`，并把这条约束写进 AGENTS.md 的 Testing Guidelines
      （否则下一个人还会踩）。

---

## Git Commit Message Suggestions

建议按「一类改动一个提交」拆开（原子提交）。真实影响最大的几条在前面。

```text
fix(test): 结算与背书的真实重算路径补测，覆盖率门槛转绿

`resolution.ts` 的 `rescoreResolvedQuestion`（ADR-0008：背书可发生在
结算之后）此前被 `agent_router.test.ts` 整模块 mock 掉，只断言了
"mock 被调用"；该文件覆盖率 49.91%，低于 jest.config.ts 的 50% 门槛，
而 CI 跑的正是 `test:coverage`，单元门禁因此是红的。

补 5 例：未结算不写分数、已结算二元题重算、已结算选项题重算、
二元题结算写 resolved 与决策锁定时点、选项题未全部结算时不提前结算。
resolution.ts 覆盖率 49.91% → 84.14%。
```

```text
test(cli): 凭据生命周期补测——身份分发、init 护栏与"凭据不进日志"

- cli/context.test.ts：`--api-key` > `FATEBOOK_AGENT_API_KEY` >
  `FATEBOOK_AGENT_USER_EMAIL` 的三档优先级、无效钥匙不回退到邮箱、
  caller 的 ctx.session 为 null（ADR-0021 / ADR-0026）
- cli/init.test.ts：非空库拒绝静默建号、显式放行才建号、
  占位邮箱冲突、打印的凭据与落库的是同一把（ADR-0022）
- e2e：真库跑 init → whoami --api-key 回同一身份，并断言 **stderr
  不含该凭据**（ADR-0022「输出不得进入日志」此前无任何断言）
```

```text
test(cli): 新增交互面对等守门测试 cli/parity.test.ts

AGENTS.md §10 此前自认「`cli/parity.test.ts` does not exist yet」，
对等性只靠人工评审。新测试从源码读两侧可达性（CLI 扫 cli/commands.ts，
Web 扫 pages/ + components/ 的 api.<router>.<name>），与 12 条带理由的
例外比对：未登记的单侧 procedure 变红，已过期（另一侧补上）的例外也变红。
```

```text
test(calibration): 校准图端点补测，锁住"未背书样本不进图"

ADR-0008 的违反在这里没有症状——图照常画，只是多算了不该算的样本。
断言查询本身（题级 / include / 选项三处 `endorsed: true`）、10 桶分桶与
同分钟改预测的去重；并为该文件加 60% 覆盖率下限。
```

```text
ci: 覆盖门禁与本地一致，补 build 门禁与构件归档

- .husky/pre-push 改跑 `npm run test:coverage`（与 CI 同一条命令）
- unit job 上传 coverage-report 构件
- e2e job 末尾加 `next build`（复用已迁移的库；tsc/lint 不覆盖
  构建期检查）
- README / AGENTS.md 记录 required status checks 需人工确认
```

```text
docs(test): 刷新票据与验证记录，使其可在仓库内核对

ticket 01/02/03/08/11/12/15 的验证行改为指向可重跑的测试；
AGENTS.md 更正 lint 覆盖范围（cli/ 已在其中）、补 test:coverage。
```

```text
fix(e2e): 缓解已知 portal 残留 flake，重试只挂在该用例上

「修订历史」用例在 Save 后显式等待对话框关闭；重试收敛到该用例自己的
`describe.configure`（CI 1 / 本地 0），全局保持 0——避免新引入的
不稳定用例被重试盖成绿色。根因未除，已在 e2e/README 写明再出现时
按真问题查。
```

---

## Task: 修复第二轮审查发现（测试断言 / e2e 隔离 / 门禁收敛）

来源：对当前未提交变更的代码审查，7 条发现（4×P2、3×P3）。

- [x] [P2] e2e 身份隔离只清 shell 变量，`npm run agent` 里的 `dotenv -e .env` 仍会
      把 `.env` 的 `FATEBOOK_AGENT_API_KEY` 注回 → 改传空串（dotenv 不覆盖已存在的键，
      且 `context.ts` 视空串为 falsy）
- [x] [P2] `init` 护栏 e2e 依赖"别的用例先建过账号"，文档给的 `-g 自举建号` 在空库上必失败
      → 用例先用 `--allow-create-user` 建一个 seed 身份，自造非空库
- [x] [P2] 校准图 `AMBIGUOUS` 断言 `toBeLessThanOrEqual(1)` 恒真（单条样本下两种结果都过）
      → 删掉该断言，改为断言查询层 `where.AND[0]` 只认 YES/NO（JS 分桶不做这层过滤）
- [ ] [P2] `.husky/pre-push` 未跟踪，但 AGENTS.md:803 已声称它存在
      → **未做：需要 `git add .husky/pre-push`**（等作者显式指令）
- [x] [P3] 验证记录数字过期：parity 5→6 例、`test:coverage` 223/225→224、票据验证行仍写 `npm test`
- [x] [P3] 全局 `retries: 1` 会掩盖新 flake → 收敛到已知 flake 用例的 `describe.configure`
- [x] [P3] `stripComments` 在含 URL 的行上漏剥行尾注释 → 逐处跳过 `://` 再截断

### 验证（本轮实跑）

- [x] `npm run typecheck` — 通过
- [x] `npm run lint` — 通过
- [x] `npm run test:coverage` — **224 passed / 18 suites，exit 0**
- [x] `npx prettier --check`（改动文件）— 通过
- [x] `npx playwright test e2e/agent-cli.spec.ts`（系统 Edge）— **8 passed**

## Git Commit Message Suggestions（第二轮）

```text
fix(e2e): 身份隔离改用空串堵住 dotenv 注入，init 用例自建非空库

- runCli 传 `FATEBOOK_AGENT_API_KEY: ""`：`undefined` 会被 `dotenv -e .env`
  重新补上，邮箱路径仍可能静默换身份；空串既拦注入又是 falsy
- init 护栏用例先自建一个 seed 身份，不再依赖"前面的用例刚建过账号"——
  票据里写的 `npm run test:e2e -- -g 自举建号` 在空库上不再必然失败
```

```text
test(calibration): 用查询层断言替掉恒真的 AMBIGUOUS 分桶断言

`toBeLessThanOrEqual(1)` 在单条样本下两种结果都通过，无法发现它命名的那条
回归；改为断言 `where.AND[0]` 只认 YES/NO（JS 分桶不做这层过滤）。
```

```text
ci(e2e): 重试收敛到已知 flake 用例，全局保持 0

全局 `retries` 会把**新引入的**不稳定用例也盖成绿色；改为在「修订历史」
用例的 describe 上 configure（CI 1 / 本地 0），并同步 e2e/README。
```

```text
test(parity): stripComments 不再漏剥含 URL 行的行尾注释

一遇 `:` 就整行返回，会让同一行 `https://…` 之后的注释里的调用被计入
可达面；改为逐处跳过 `://` 再截断。
```

```text
docs: 校正验证记录（测试例数 / 命令）

parity 5→6 例、test:coverage 223/225→224；ticket 01/03 的验证行从
`npm test` 改为 `npm run test:coverage`；todo.md 的校准图测试路径改到
`lib/web/`。
```

> 注意：`.husky/pre-push` 目前仍是未跟踪文件（上一轮刻意留在工作区外）。本轮改了它的内容，
> 若要这道本地门禁生效，需要 `git add .husky/pre-push` 一并提交。

---

## Task: 复审发现项处置（第三轮，来自最新一次代码审查）

审查结论：correct（无阻塞项）；1×P2 + 3×P3。

### 已修复

- [x] [P3] `cli/parity.test.ts` CLI 可达性正则不限接收者 → `prisma.decision.create(...)` 会被误判为「已接线」→ 加负向断言 `(?<!prisma\.)`；并抽 `cliProceduresInSource()` 为可测纯函数，新增「直写 prisma 不算接线」自证用例（实测旧正则会产出 3 条、新正则 1 条）
- [x] [P3] `resolution.test.ts` 选项题重算用例标题夸大（声称验「排他性取字段值」，但 rescore 丢弃返回值，排他分支根本无法观测）→ 标题改为据实，断言改为落在选项级（`where.userQuestionComboId === "good-o1"`，与二元路径的 `good-q1` 区分）；排他性本身由 `scoreQuestionOptions` 那组测试守住
- [x] [P3] `AGENTS.md` §10 英文小节里混入中文（违反 §4「权威文档单语言」）→ `Enforcement` 两条整段改写为英文

### 已推迟

- [ ] [P2] `.husky/pre-push` 未纳入版本库 → 需 `git add .husky/pre-push`（改变 git 状态，按项目规范须用户明确指示；未获指示故不动）

### 验证

- [x] `npm run typecheck` — 通过
- [x] `npm run lint` — 通过
- [x] `npm run test:coverage` — **225 passed / 18 suites，exit 0**（新增 1 例自证用例）
- [x] `npx prettier --check`（改动文件）— 通过

### 第四轮复核（同一份审查总结被再次下发，无新发现项）

本轮无代码/文档改动：3×P3 已在上轮落地，逐条复核仍在位并通过验证。

- [x] [P3] 守门正则有效性复核：同一源码串下旧正则产出 `[decision.create, decision.create, decision.create, agent.endorse, agent.endorse]`（含 2 条 `prisma.` 误报），新正则产出 `[decision.create, decision.create, agent.endorse]`
- [x] [P3] 选项路径断言确实可判别：`lib/web/resolution.ts:242` 用 `${id}-${option.id}`（`good-o1`）、`:292` 用 `${id}-${question.id}`（`good-q1`），故 `where.userQuestionComboId === "good-o1"` 会在走错路径时变红
- [x] [P3] 排他性覆盖确认：`scoreQuestionOptions` 组内 `exclusive=true → 0.04`（`resolution.test.ts:248-252`）、`false → 0.02`（`:233-238`）
- [x] `npx jest cli/parity.test.ts lib/web/resolution.test.ts` — 24 passed / 2 suites
- [x] `npm run typecheck` / `npm run lint` / `npx prettier --check` — 通过
- [x] `npm run test:coverage` — **225 passed / 18 suites，exit 0**
- [ ] [P2] `.husky/pre-push` 仍未纳入版本库 → 仍待授权 `git add .husky/pre-push`（仅暂存、不提交）

---

## Task: 第五轮 —— 清单收口 + 修复过程中实测到的门禁 flake

本轮按审查总结的修复队列收口，并在执行「跑相关测试」时**实测到一条此前未被发现的 P0 级缺陷**（CI 门禁随机变红）。

### 已修复

- [x] [P2] `.husky/pre-push` 未纳入版本库 → 经用户明确授权后 `git add .husky/pre-push`（**仅暂存，未提交**；HEAD 未动）。`AGENTS.md:803` 的声明从此在仓库内可验证，新克隆能拿到这道本地门禁（`git ls-files .husky/` 已含 `pre-push`）
- [x] **[新发现·P0] `generateApiKey()` 生成的钥匙长度不固定 → 断言它的用例随机变红**
  - 症状：`npm run test:coverage` 偶发 `FAIL cli/init.test.ts`，`expect(result.apiKey.length).toBeGreaterThan(20)` 收到 `20`
  - 根因：旧实现是两次 `Math.random().toString(36).slice(2, 15)` 拼接。`toString(36)` 的**位数随取到的值浮动**，截断后长度落在 18–25（实测 20 万次：18→0.01%、19→0.43%、20→7.96%、21→36.95%、22→51.08%、23→3.42%、24→0.15%），故 `P(<= 20) = 8.41%`
  - 附带问题：ADR-0021 要求 CLI 与 Web 生成「同一种形状」，但变长意味着这个前提**只是通常成立**
  - 修法：`lib/api_key.ts` 改为按 `API_KEY_LENGTH = 26` 逐字符抽取，长度由生成侧保证；形状常量成为唯一定义处，两处断言改为读它（`cli/init.test.ts`、`e2e/agent-cli.spec.ts`）
  - 自证：把 `api_key.ts` 临时换回旧实现，新增的 `lib/api_key.test.ts` **立刻变红**（`Expected length: 26 / Received length: 22`）；换回后 sha 一致
- [x] 新增 `lib/api_key.test.ts`（2 例：长度恒定 500 份样本、字符集 base-36）

### 已推迟 / 未处理（附原因）

- [ ] **`generateApiKey` 用 `Math.random()` 而非 CSPRNG** → 不属本次审查发现项，且属凭据强度的独立决策（ADR-0021 把钥匙定义为身份本身），本轮不动、只记录，建议下一轮或独立 ADR 处置
- [ ] `lib/_scoring.test.ts:11` 造 id 用 `Math.random()` → 与上轮在 `resolution.test.ts` 修掉的是同一类「测试输入应可复现」，但实测 `lib/_scoring.ts` **完全不读 `forecast.id`**，该字段是惰性的，既不产生 flake 也不影响结果，故按「只改必须改的」不动，仅记录
- [x] 3×P3（上两轮）：本轮逐条复核仍在位

### 验证（本轮实跑）

- [x] `npm run test:coverage` × **6 连跑** — 每次 **227 passed / 19 suites，exit 0**（修复前 225/18，且约 1/12 概率红）
- [x] 单用例连跑 60 次（`cli/init.test.ts` + `lib/api_key.test.ts`）— **0 次失败**（修复前按 8.41%/次，60 次全绿的概率仅约 0.5%）
- [x] 守门自证 — 旧实现下 `lib/api_key.test.ts` 变红
- [x] `npm run typecheck` — 通过
- [x] `npm run lint` — 通过（`✔ No ESLint warnings or errors`）
- [x] `npx prettier --check`（本轮改动文件）— 通过
- [x] `npm run test:e2e` — **10 passed**（本机下不到 Playwright 二进制，按 README 记录的方式用 `.scratch/pw-local.config.ts` 切 `channel: msedge`；该配置文件在 gitignore 的 `.scratch/` 下，不进版本库）
- [x] 未跑 `npx next build`：本轮改动未触及构建路径（`lib/api_key.ts` 为纯函数、无新依赖）

### 本轮踩到的坑（可供下次复用）

- `npm run test:coverage` 的**偶发红不是噪声**：本项目 `retries: 0`、覆盖率门槛是硬门禁，随机红的门禁等于没有门禁。凡「断言随机输入的形状」，都必须先核实生成侧是否真的保证了那个形状。
- Playwright 把配置里的相对路径按**配置文件所在目录**解析：把本地配置放进 `.scratch/` 时，`testDir` 与 `webServer.cwd` 都要显式指回仓库根，否则报 `No tests found`。
