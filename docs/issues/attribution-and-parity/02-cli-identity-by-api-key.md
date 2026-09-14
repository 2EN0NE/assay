# 02 — CLI 身份按凭据解析 + `whoami`

**What to build:** `FATEBOOK_AGENT_API_KEY`（或 `--api-key` 单条覆盖）让 CLI 以该凭据的 Owner 身份读写；遗留的 `FATEBOOK_AGENT_USER_EMAIL` 仍可用；`whoami` 打印身份与凭据来源。

**Blocked by:** None — can start immediately

**Status:** implemented（`npm run typecheck` / `lint` / `test:coverage` 全绿；身份分发出 `cli/context.test.ts`（9 例）锁定，真库往返见 `e2e/agent-cli.spec.ts` 的「CLI 自举建号」用例）

- [x] 凭据优先于遗留 email，`--api-key` 优先于环境变量
- [x] 无效凭据非零退出、stderr 有信息、stdout 保持空
- [x] `whoami` 报出 userId / email / credentialSource
- [x] e2e 断言（真库：`init --allow-create-user` 建号 → `whoami --api-key` 回同一 userId/email，且邮箱指向不存在的账号也不回退；无效钥匙非零退出）

> 多 Owner 的**往返**（A 写、B 读不到）仍未实现——ADR-0025 把它定为目标场景，可见性语义另议。本条只锁身份解析与分发。
