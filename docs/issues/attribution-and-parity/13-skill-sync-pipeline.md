# 13 — skill 契约与 CLI 同步发布

**What to build:** `skill:build` 从 `cli/commands.ts` 生成 skill 的契约段（命令、参数），判断段仍由人写；`skill:check` 在 CI 守门；生成物头部标哈希。

**Blocked by:** 02, 04, 08

**Status:** ready-for-agent

- [ ] 故意改一条命令的 usage ⇒ check 变红
- [ ] 源码一致时 check 绿
- [ ] AGENTS.md / README 写明规程（改契约改代码、改判断改模板、不要手改生成物）
