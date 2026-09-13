# 01 — CLI 骨架与只读查询

**What to build:** 一条本地命令即可列出"已到期待结算"的预测，并以稳定 JSON 输出。证明 Agent 无需启动 Next.js 服务就能读到与 Web UI 同一份数据。

**Blocked by:** None — can start immediately.

**Status:** implemented (验证记录见 `verification.md`；e2e 待浏览器二进制可用后由本地执行)

- [ ] `npm run agent -- list-due` 在只启动 Postgres 的情况下可运行（不依赖 Next.js）
- [ ] stdout 只输出 JSON，日志一律走 stderr
- [ ] JSON 含 id / title / resolveBy / 判据类型 / 录入来源
- [ ] owner 身份由环境变量指定，未配置时给出可操作的报错
- [ ] 单元测试覆盖参数解析与 JSON 形状
- [ ] e2e（真库）覆盖"建数据 → 跑 CLI → 断言 JSON"
- [ ] README 记录：怎么跑、日志在哪看
