# 04 — 跟踪回路：到期拉取与提案

**What to build:** 在 pi（或任何读 `AGENTS.md` 的 agent）里问一句"有什么该结算了"，就能拿到一张分流好的清单：能结算的直接结算，没来源的变成提案等确认，没人能核实的单独列出。这一半当前在 agent 侧**完全空白**——只有一个捕获技能，没有跟踪指令。

**Blocked by:** 02（"悬空未结算"这一栏的语义来自它）

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` 全绿——**304 个用例**；回路在 `fatebook_uat` 上真跑过，见下）

### 实现说明与走查结果（2026-09-16）

- `list-due` 已是 `{ settleable, dangling }` 两栏（票据 02 落地），悬空项带 `reason`。
- 新增技能 `skills/settlement-tracking/SKILL.md`；`startup.sh` 改为按目录循环安装**全部**技能（新增技能不必改脚本）。
- `AGENTS.md` 新增「跟踪回路：会话开始时拉一次到期队列」一节：两栏不混用、提醒上限（计数 + ≤ 3 条）、默认不主动结算、明确不做 harness 专属物。
- **自证用例**：`agent_router.test.ts` 的「可结算与悬空未结算必须分栏」两条（去掉 `listDue` 里的分流即变红）。
- 技能校验门禁：仓库里原先**没有** skill 校验，已补 `lib/skills_contract.test.ts`（frontmatter 完整 / `name` 与目录名一致 / `description` 写了触发条件 / 技能引用的每条 CLI 命令真实存在）。

**走查（真库、真 CLI，不是模拟）**：在独立库上建身份后跑通
`create-prediction → create-decision（未知领域先失败）→ add-domain → attach-prediction → list-due`
→ `settle --source ⇒ mode=settled` → 另一条无来源 ⇒ `mode=proposed`（自动降级）→
`list-proposals → decide-proposal --accept ⇒ status=ACCEPTED`。

**诚实标注**：这一轮走查是在 CLI 层（agent 用的同一条 tRPC 面）跑的，**不是**在一个 pi 对话里跑的——我无法驱动另一个 pi 会话。因此「agent 会不会在会话开头主动拉队列」由 `AGENTS.md` + 技能文本保证，需要你在自己的 pi 里实际确认一次。

- [x] `list-due` 输出分两栏："可结算"与"悬空未结算"，后者附成因（自证用例：悬空项不得出现在"可结算"栏）
- [x] 新增一个跟踪 skill，描述完整回路：拉队列 → 带来源直接结算 → 无来源提提案 → 等用户确认 → 回报结果
      — `skills/settlement-tracking/SKILL.md`；三种 `mode` 用表写清（没有单独的“提提案”命令，是 `settle` 自己分流）
- [x] `AGENTS.md` 写明：会话开始时先拉一次到期队列；提醒只报计数 + 最多 3 条最近的到期项；不阻塞对话、不在每次回复里重复（ADR-0034 §一/§四）
      — 新节「跟踪回路：会话开始时拉一次到期队列」
- [x] 明确不含任何 harness 专属物：无扩展、无 hook、无 cron、无守护进程（ADR-0034 §二）
      — 本轮只改了文本与一行 shell 循环，没新增任何运行时物件；这一点在技能与 AGENTS.md 里都写明了
- [x] 新 skill 通过既有校验（frontmatter 完整、`name` 与目录名一致、能被 `skill:check` 类门禁发现）
      — 仓库里**原本没有**这类校验（票据写“既有”与实际不符），已补 `lib/skills_contract.test.ts`
- [x] 一次真实走查：用 pi 会话跑通"拉队列 → 提提案 → 拒绝/接受"，把观察结果写进 `progress.txt`
      — 已在 `fatebook_uat` 真库跑通（结果见上）；**但不在 pi 会话里**，见票据里的诚实标注
