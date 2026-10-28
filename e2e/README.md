# E2E Tests

End-to-end tests using Playwright, covering the core flow: sign in → create a prediction.

## Prerequisites

```bash
# 1. Start the database and local mail catcher (Mailpit)
docker compose up -d db mail

# 2. Configure the environment
cp .env.example .env
# Edit .env: DATABASE_URL / DATABASE_DIRECT_URL point to localhost:5432
#
# `AUTH_EMAIL_SERVER` / `AUTH_EMAIL_FROM` are also required — NextAuth's Email
# provider reads them directly. Without them the provider has no SMTP, so no mail
# reaches Mailpit and every sign-in test fails with "No sign-in email received".
# They are already in `.env.example` (pointing at Mailpit's SMTP on 1025).

# 3. Install the Playwright browser (needs network access)
npx playwright install chromium
```

### 为什么 `dev:e2e` 要钉住 `http://localhost:3000`

`.env` 里的 `NEXTAUTH_URL` / `HOST_URL` 是给**文档里那套开发流程**用的（`https://localhost:3000`，经 3005 的 SSL 反代）。而 e2e 的 `webServer` 跑的是 `npm run dev:e2e`，那是**明文 HTTP 的 3000**。NextAuth 会把 `NEXTAUTH_URL` 直接渲染进登录表单：

```html
<form
  action="https://localhost:3000/api/auth/signin/email"
  method="post"
></form>
```

于是浏览器把一个 https 的 POST 打到一个只会说明文的端口上 ⇒ `ERR_SSL_PROTOCOL_ERROR`，**请求根本没到服务器**（dev 日志里只有 `GET /api/auth/signin`，没有任何 POST）⇒ Mailpit 收不到信 ⇒ 测试报 `No sign-in email received`，而页面长得完全正常。

所以 `dev:e2e` 把两个变量钉成 `http://localhost:3000`（`dotenv` 不覆盖已存在的环境变量，因此内联赋值有效）。改 `dev:e2e` 时不要把它去掉。

同一个 `dev:e2e` 还**显式打开**了 `ASSAY_ENABLE_PAIRING_LOGIN=1`（默认关闭，ADR-0035）。`e2e/pairing-login.spec.ts` 测的就是那扇门：CLI 签发一次性码 → 浏览器兑换 → `/api/auth/session` 能读出这个身份。它的 CLI 一侧也自带这个变量——**两侧都开**才算通过，只开一侧的表现是"页面说登录成功、会话却是空的"或"页面根本不显示表单"。

> **已知不稳定（缓解与排查入口见文末 Notes）**：整套跑时曾出现一次 `修订历史` 用例超时。

## Run

```bash
npx playwright test
```

The `webServer` in `playwright.config.ts` starts the Next.js dev server
automatically (reusing an existing server if one is running).

## How the magic-link login works in tests

The app signs in via NextAuth's Email provider. The verification email is
caught by [Mailpit](https://mailpit.axllent.org/) (the `mail` compose service,
SMTP on 1025, web/API on 8025). The test polls `http://localhost:8025/api/v1`
for the latest sign-in email and follows the magic link.

## Notes

- **已知 flake（已缓解，未除根）**：整套跑时曾出现一次 `修订历史` 用例超时——原因是上一步的
  HeadlessUI portal（`#headlessui-portal-root`）残留并拦截点击；单独重跑该用例通过。
  现在两道缓解：该用例在 Save 之后显式等待对话框关闭（`expect(...placeholder).toBeHidden()`），
  且 **该用例自己的 describe**（`已知 flake：HeadlessUI portal 残留`）在 CI 上 `retries: 1`
  （本地保持 0）。重试刻意不挂在全局配置上——全局重试会把**新引入的**不稳定用例也盖成绿色。
  **根因（portal 为何残留）仍未查明**——再出现时要按真问题查，不要靠重试盖掉。
- If the browser install fails due to network restrictions, run
  `npx playwright install chromium` on a machine with network access first.
- Unit tests (jest) run separately via `npm test` and do not require a database.
