# 03 — `init` 自举建号

**What to build:** 不依赖邮件就能在库里创建一个身份并打印它的凭据。

**Blocked by:** 02

**Status:** implemented（验证：`npm run test:coverage` 全绿——护栏与凭据形状由 `cli/init.test.ts`（6 例）锁定，"凭据不进日志"与"钥匙优先于邮箱"由 `e2e/agent-cli.spec.ts` 的真库用例锁定）

- [x] 空库可直接建号；非空库必须显式 `--allow-create-user`（护栏已验证：退出码 1）
- [x] 打印的凭据立刻可用于 02 的 `whoami`
- [x] `User.email` 用占位标识（`<label>@localhost`），身份可以没有真实邮箱
- [x] 凭据不进日志（只走 stdout 的 JSON）

## 验证记录（可重跑）

| AC           | 命令                              | 判据                                                                                |
| ------------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| 护栏         | `npm test -- cli/init.test.ts`    | 非空库且无 flag 时拒绝，且不落库                                                    |
| 凭据即身份   | `npm run test:e2e -- -g 自举建号` | `whoami --api-key <刚打印的钥匙>` 返回 `api-key-flag`；邮箱指向不存在的账号也不影响 |
| 凭据不进日志 | 同上                              | 断言 `stderr` **不含**该凭据（它是身份本身，进了日志等于被抄走）                    |
