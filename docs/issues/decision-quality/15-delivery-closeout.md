# 15 — 交付收尾：把声明改成如实

**What to build:** 把本批切片改动的文档与状态如实回填，使"声明"与"实现"一致——这正是 AGENTS.md「文档声明必须可在仓库里被验证」那一条要求的事。

**Blocked by:** 08, 09, 10, 11, 12, 13, 14

**Status:** implemented（`npm run typecheck` / `npm run lint` / `npm run test:coverage`（**224 个用例**，含覆盖率门槛）/ `npm run test:e2e`（**10 passed**）/ `npx next build` 全绿）

> 本行此前写的是 `npm test`（185 个用例）——它**不含覆盖率门槛**，而 CI 跑的是 `npm run test:coverage`。两者不一致正是同一个 phase 里某个新模块跌破 50% 阈值却无人发现的原因；现在本地与 CI 跑同一条命令，且 `npx next build` 也已进 CI。数字是当时的快照，可重跑的命令才是判据。

- [x] 08–15 各 ticket 的 AC 按实测勾选；没做的留 `[ ]` 并写清为什么
- [x] `docs/issues/decision-quality/00-spec.md` 的接口与不变量描述与实现一致（本轮实现是照它写的；无需再改）
- [x] `README.md` 的 CLI 段含全部决策命令（`create-decision` / `attach-prediction` / `detach-prediction` / `set-rubric` / `update-narrative` / `show-decision`，已与实际命令表逐条比对）
- [x] `npm run typecheck` / `npm run lint` / `npm test` / `npm run test:e2e` 全绿

## 跑绿 e2e 之前修掉的两个前置条件（都不是本批代码的问题）

1. **登录表单的 POST 打不到服务器**：`.env` 的 `NEXTAUTH_URL=https://localhost:3000/api/auth` 会被 NextAuth 直接渲染进登录表单的 `action`，而 e2e 的 `webServer` 跑的是**明文 HTTP 的 3000** ⇒ 浏览器把 https 的 POST 打到只说 http 的端口 ⇒ `ERR_SSL_PROTOCOL_ERROR`，**请求根本没到服务器**（dev 日志里只有 `GET /api/auth/signin`，没有任何 POST）⇒ Mailpit 收不到信 ⇒ 6 个依赖登录的用例以 `No sign-in email received` 失败，而页面看上去完全正常。
   修法：`dev:e2e` 把 `NEXTAUTH_URL` / `HOST_URL` 钉成 `http://localhost:3000`（`dotenv` 不覆盖已存在的环境变量，内联赋值有效）。`e2e/README.md` 已写明为什么不能去掉。
2. **`AUTH_EMAIL_SERVER` / `AUTH_EMAIL_FROM` 没被文档化**：NextAuth 的 Email provider 直接读它们，缺了就没有 SMTP。已补进 `.env.example` 与 `e2e/README.md`。

另外，端口 3000 上曾有一个**不属于本会话**的遗留 `next dev`（PID 372/373，22:50 启动），经作者授权后已停掉。

## 本批改动在真库上的端到端验证（CLI 链，绕过浏览器）

```text
create-decision → create-prediction --decision-id → set-rubric --done alternatives   ✅ 1/5
settle --resolution YES --source …                                                   ✅ exit 0
show-decision → { locked: true, hasLockedAt: true, questions[0].score.absolute: 0.5 }✅ 结算路径真的写下了锁定时点
set-rubric（结算后）                                                                  ❌ CONFLICT「清单已锁定…」
update-narrative --unknown-info（补写空白）                                            ✅ 不需要理由
update-narrative --unknown-info（改写，无 --reason）                                   ❌「必须给出理由（ADR-0012）」
update-narrative --unknown-info --reason …                                            ✅ 成功
show-decision → revisions[]                                                           ✅ 旧值/新值/理由都在复盘读取里可见
detach-prediction（该预测已结算）                                                      ❌「已结算，不能解绑」
```

另：`Revision` 的"主体恰有其一"用真库探针实测——无主体与双主体两种写法都被 PostgreSQL 以 `23514`（check_violation）拒绝。

## 已知不稳定（未修，留给下一轮）

整套 e2e 跑过一次 `修订历史` 用例超时：上一步的 HeadlessUI portal（`#headlessui-portal-root`）残留并拦截点击；单独重跑该用例通过。属时序性 flake，与登录/邮件无关。
