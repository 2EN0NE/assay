# 04 — 来源默认极性倒过来

**What to build:** 从 pi 会话发出的写入默认落"待背书"；人自己在终端里敲的默认已背书；`--stated-by-owner` 显式声明来源；skill 同步更新。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent（ADR-0024）

- [ ] `create-prediction` 的默认由"已背书"改为"待背书"，`--agent-collected` 换成 `--stated-by-owner`
- [ ] 依 `AI_AGENT` / `PI_CODING_AGENT` 标记决定默认方向
- [ ] skill 与 CLI 帮助文本同步
