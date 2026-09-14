# 05 — CLI：Agent 侧的决策录入与读回

**What to build:** Agent 能用一条命令创建一个决策、写清单、把 Prediction 挂上去、并读回完整的复盘材料，全部输出确定性 JSON（沿用 ADR-0015 的契约）。

**Blocked by:** 01, 02, 03

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` / `npm run test:e2e` 全部通过；命令均**真机冒烟**跑过）

- [x] `create-decision`：创建决策并写入叙事字段
- [x] `set-rubric`：写入清单各条的完成情况（`--done a,b --not-done c`），返回重算后的完成度
- [x] `attach-prediction`：把一条 Prediction 挂到决策上
- [x] `show-decision`：读回复盘材料 = 叙事 + 清单完成度 + 锁定态 + 各 Prediction（含结算状态）
- [ ] 各 Prediction 另含**分数**（User Story 16）：直接取 `QuestionScore` 已存值（`relativeScore` 在非公共事实类为 null），不新增计分口径
- [x] 每条命令的 stdout 只有 JSON，日志一律走 stderr（真机验证：`create-decision | jq .` 可解析）
- [x] 参数缺失或非法时非零退出，错误信息在 stderr
- [ ] `update-narrative`：给空白叙事字段补写自由；改写已填写内容必须带 `--reason` 并落一条修订（ADR-0012）
- [ ] `detach-prediction`：与 `attach-prediction` 对称（已结算的 Prediction 仍拒绝解绑）
