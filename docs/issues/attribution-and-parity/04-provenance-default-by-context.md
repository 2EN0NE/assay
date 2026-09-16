# 04 — 来源默认极性倒过来

**What to build:** 从 pi 会话发出的写入默认落"待背书"；人自己在终端里敲的默认已背书；`--stated-by-owner` 显式声明来源；skill 同步更新。

**Blocked by:** None — can start immediately

**Status:** implemented

- [x] `create-prediction` 的默认由"已背书"改为"待背书"，`--agent-collected` 换成 `--stated-by-owner`
- [x] 依 `AI_AGENT` / `PI_CODING_AGENT` 标记决定默认方向
- [x] skill 与 CLI 帮助文本同步

### 实现说明（供后续票据复用）

- 默认方向在 **CLI 层**决定（`cli/args.ts` 的 `invokedByAgent()` + `cli/commands.ts` 的 `create-prediction`）：agent 代跑 ⇒ 默认待背书；人自己在终端里敲 ⇒ 默认已背书。
- 路由层（`agent.createPrediction`）**不给默认值**：`statedByOwner` 是必填，猜错的方向恰好是最危险的那个。
- 两个 flag 同时给出 ⇒ 拒绝（`CliError`，"互斥"）。`--agent-collected` 保留为显式反向声明："我是当事人，但这个数字是 agent 取得的"。
- `AGENT_INSTRUCTED` 不再产生（历史行仍在库里）；`HUMAN` 是"数字由当事人给出"的新值。
- **e2e 里凡是依赖"默认已背书"的用例都补了 `--stated-by-owner`**：否则 e2e 的结果会取决于跑测试的人是不是 agent（本仓库的测试经常正是被 pi 起来的）。
- 真库验收：`AI_AGENT=pi … create-prediction`（无 flag）⇒ `provenance: "AGENT"` 且进 `list-unendorsed`；加 `--stated-by-owner` ⇒ `"HUMAN"` 且不进。
