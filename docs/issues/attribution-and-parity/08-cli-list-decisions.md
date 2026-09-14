# 08 — CLI 补 `list-decisions`

**What to build:** CLI 能列出全部决策，与 Web 的 `/decisions` 同口径。

**Blocked by:** 01（验收是"01 的表里对应行消失"）

**Status:** implemented（`cli/parity.test.ts` 已把 `decision.list` 判为**双侧可达**，因此它不在例外表里）

- [x] 命令存在、可用 `--limit`、输出与 Web 列表同源
- [x] 01 的例外表里对应行消失（01 的测试现在会主动报出"已完成对等的例外行"）
