# 01 — 领域标签：Decision 权威 + 写时复制

**What to build:** 用户（经 agent）给一条决策打上 `投资/宏观`，该决策在 CLI 与 Web 详情页都显示它；随后挂接的预测自动带上同一个领域；词表可列、可新增（须用户确认）、可改名（带理由）、零引用才可删。

**Blocked by:** None — can start immediately

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` 全绿——**272 个用例**，含领域名守卫 7、传播自证 4、CLI 翻译 5、对等性门禁已扩展到 `tags` router；迁移 `20260914180000_decision_domain_tags`。**未做**：真库 e2e 冒烟，`rename-domain`/`delete-domain` 的单测）

- [x] `create-decision --tags 投资/宏观` 成功；`--tags 投资/不存在` 以 `NOT_FOUND` 失败，并给出"先列词表或新建"的指引
      — 旗标名对齐 ADR-0030 §七 原文的 `--tags`；失败路径由 `tags_router.test.ts` 的“未知领域大声失败并给出词表指引”守着
- [x] 挂接预测后，该 Question 的标签包含 Decision **当时**的领域（自证用例：去掉传播即变红）
      — `decision_router.test.ts` 两条：有领域时 `toHaveBeenLastCalledWith` 断言 `connect` 并集；无领域时断言不多写一次
- [x] 事后改 Decision 的领域**不**改写已挂 Question 的标签（自证用例：去掉守卫即变红）
      — `tags_router.test.ts`；去掉 `setDecisionDomains` 里那个 `isRetag` 守卫，两条断言立刻变红（这正是守卫的全部价值）
- [x] `list-domains` / `add-domain` / `retag-decision --reason` / `list-untagged-decisions` 可用；`add-domain` 前必须先取得用户确认（ADR-0030 §七/§十四）
      — 四条命令可用（另加 `rename-domain` / `delete-domain`）；确认约束不可由服务端判定，已写入 `skills/decision-capture/SKILL.md` 的“决策级：领域”一节（源文件，需重跑安装脚本刷新 `.agents/skills/`）
- [x] `CPI` 与 `cpi` 视为同一个标签（`lower(name)` 判重），显示保留原样
      — 唯一键改为 `@@unique([nameNormalized, userId])`，迁移里手写“加可空列 → 回填 → 置 NOT NULL”（Prisma 默认生成的单句 `ADD COLUMN NOT NULL` 在空表上会“看起来成功”）
- [x] 改名一次性重写全部引用、留痕、并报出影响了多少条历史归属；删除被引用的标签被拒绝（ADR-0030 §十五）
      — 已实现（改名逐条写 `Revision` 并返回 `affectedDecisions` / `affectedQuestions`；删除在 `_count > 0` 时以 `CONFLICT` 拒绝）。**无单测**：这两条只有实现与类型层保障
- [x] 未标领域的决策可被列出并补标；补标时对**已挂**的 Question 一并写入（§九）
      — `listUntaggedDecisions` + `tags_router.test.ts` 的补齐用例（断言恰好两次 `question.update`）
- [x] Web 决策详情页可看、可改领域；parity 门禁扩展到新 router，且有一条"去掉守卫即变红"的用例
      — 详情页有领域段（含未知词的显式“新建领域”按钮，Web 用户不必回到终端）；/decisions 首页列出未标领域的决策；`cli/parity.test.ts` 已并入 `tagsRouter`，例外表新增 5 条且各带理由

### 复查补做（2026-09-16）：§八 的第二个半句

复查发现 §八 有两句，而本票据的 AC 只写了第一句：

> 未标领域能被列出来（`list-untagged-decisions`）**并在到期提醒里带一行计数**。

第一句（列出来）第一期就做了；第二句（提醒里带计数）当时**没有任何地方实现**，AC 清单也把它漏了
——这正是"AC 漏抄一句"如何让一条 ADR 要求静默消失。补做：

- 判据抽成 `lib/web/domain_tags.ts` 的 `untaggedDecisionWhere(userId)`，
  列表（`tagsRouter.listUntaggedDecisions`）与计数（`agentRouter.listDue`）**共用同一处**。
- `agent.listDue` 返回新增 `untaggedDecisions: number`。
- **政策（业主裁定 P1）**：只要 `untaggedDecisions > 0` 就报这一行，**与有没有到期项无关**——
  那一行依附的是"队列被拉过一次"，不是"队列非空"；否则队列长期为空时，§八 要的可见性落不了地。
- 跟踪技能与 `AGENTS.md` 的提醒段各加一句；`list-due` 的 CLI 摘要也改成与真实输出一致。
- 用例：`agent_router.test.ts` 断言"两栏皆空时计数照样返回"（并把纯谓词用真实现，不 mock 掉）。
