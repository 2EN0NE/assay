# 03 — 文档收口：ADR 关联、skill、AGENTS.md、命令门禁

**What to build:** 不装 skill、不装扩展的人也能只读 `AGENTS.md` 走完主回路；文档里出现的每条命令都真的存在（否则测试变红）。

**Blocked by:** 02

**Status:** implemented（验证：`npm test -- docs_commands`）

- [x] `docs/adr/0041-decision-action-and-execution-events.md`，并写明它补充/修正了 0019、0037、0039 与 `roadmap.md` Phase 3 的哪几句
- [x] `CONTEXT.md`：`Action` / `Execution` 两个词条，「预测的主语是世界，动作的主语是我」
- [x] `AGENTS.md`：跟踪回路改用 `brief`；新增「Agent 主回路（自足）」与「基线与加速器」两节
- [x] `skills/decision-capture`：动作与承诺时点、区间题优于阈值题、未记录≠没做到
- [x] `skills/settlement-tracking`：结算前的最后一问（清单/动作），结算即冻结叙事
- [x] `cli/docs_commands.test.ts`：`AGENTS.md` / `skills/` / `BRIEF_SEE_ALSO` 里的命令名与 flag 必须真实存在
