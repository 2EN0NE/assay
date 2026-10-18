# 网页的第二扇门：用一次性配对码把凭据换成会话

本 ADR 补充 [ADR-0023](./0023-interaction-surface-parity.md) 的例外清单中「登录 / 取得凭据」一行（原句：「Web 邮件登录；CLI 凭据」——现在 Web 侧不再只有邮件一条路）。**本文不改动 [ADR-0021](./0021-cli-identity-by-credential.md) 与 [ADR-0036](./0036-identity-scope-is-the-process.md) 的任何规定**：签发仍只在 CLI 侧，身份仍由进程持有，凭据仍只有一种。配对码不是第二类凭据，它只是把同一身份带到另一处会话。

网页今天只有一扇门：邮件魔法链接。`pages/api/auth/[...nextauth].ts` 的 `authOptions.providers` 只注册了 `EmailProvider`；`.env.example` 里那对 `GOOGLE_CLIENT_ID/SECRET` 是**上游残留**——全仓库没有 `GoogleProvider`，也没有 `signIn("google")`。这扇门的代价是「能否进入」永远绑在「邮件可达」上：本地把邮件换成了 Mailpit，于是地址一旦不合规（域名不带点，例如 `init` 建出的 `<label>@localhost`）就彻底进不去（`error=EmailSignin`），而且这个失败发生在**发信之前**，看起来像权限坏了。

决定：**保留邮件门作为「人」的门**，另加一扇门——**由已经持有凭据的一方签发的一次性配对码，在实例本机把它换成网页会话**。该能力由**显式开关**控制，**默认关闭**。

## Considered Options

- **只留邮件门（现状）**：改动为零。但它逼着每个身份都要有一个**能收信**的邮箱地址，而「有没有邮箱」与「是不是这个身份」在本工程里是两件事（ADR-0022 已明写「身份可以没有真实邮箱」）。
- **邮箱 + 密码**：新增第二类秘密，与 `CONTEXT.md` 的 `_Avoid_: 密码（本工程不引入第二类秘密）` 冲突。更关键的是**忘记密码仍然要靠邮件重置**——邮件依赖没有消失，只是从「每次登录」挪到「某天忘了」，失败概率更低但更难排查。而「多一条会腐烂的凭据链」正是 [ADR-0013](./0013-in-app-only-built-in-delivery.md) 拒绝 Postmark 的判据。
- **直接把凭据当网页密码**（不加一次性码）：零新概念，实现最小。否决理由：**两个信任域的暴露面不该取并集**——凭据住在 `.env`（脚本、CI、日志、终端历史会碰到），会话住在浏览器（XSS、共享电脑、浏览器同步）。同一条秘密既当 bearer 又当登录口令，任何一边泄漏都等于两边泄漏。一次性码不是长期秘密。
- **只留配对码（去掉邮件门）**：家里非技术成员要理解「钥匙/配对码」是什么，而邮件门对人是更自然的入口；且与 ADR-0023 已登记的「永久例外：能力相同，形态必然不同」语义不符。

## 决定

- **签发**：只有**已经持有该身份凭据**的一方可签发（CLI / Agent 侧）。网页侧**不提供签发**。
- **兑换**：只在**实例本机**（loopback）可兑换；**一次有效**；短时效（10 分钟）；失败限流。
- **开关**：显式环境变量，**默认关闭**。
- **会话**：沿用现有 JWT 会话语义（默认时长不变），不引入第二套。签发出来的**是会话 cookie**（不带 `Expires`，关掉浏览器即失效）——邮件门本来就如此，两扇门因此产生同一种会话；30 天是 JWT 的寿命，不是 cookie 的。

## 开关为什么不能靠 `NODE_ENV` 推断

`getCookies()` 在生产模式下把会话 cookie 设成 `__Secure-` 前缀 + `SameSite=None` + `secure: true`。这类 cookie 只在 HTTPS 下被浏览器接受（`localhost` 例外）。因此在一台内网主机（例如 Mac mini）上跑 `next dev` 服务家人时，`NODE_ENV` 是 `development`——**用 `NODE_ENV` 推断开关，等于给一个内网服务开后门**。判据必须是显式的。

## Consequences

- 实现时须在 ADR-0023 的登记表里**据实**更新「登录 / 取得凭据」一行的现状，并新增一行「配对码签发（仅 CLI）」的例外登记，理由：签发是**持有凭据者**的动作，网页侧不持有凭据——这不是「一处缺入口」，而是形态上只能在一侧。`cli/parity.test.ts` 的清单是门禁，须同步。
- 术语已登记：`CONTEXT.md` 的 **Pairing Code / 配对码**。
- 与 [ADR-0036](./0036-identity-scope-is-the-process.md) 咬合：同一台机器上多个进程各自持有自己的凭据 ⇒ **网页那扇门开给谁，取决于哪把凭据签发的**。
- 邮件门保留 ⇒ 部署时仍然需要真实 SMTP，且发信域要过 SPF/DKIM。**这条依赖不会因为本 ADR 消失**，只是不再挡在「本机能进去」这条路上。
- **会让两处既有文档变成假话**：`README.md` 的「用哪种身份」一节与 `AGENTS.md` 的「本地身份的两种用法」都写着 `init` 建出的 `<label>@localhost` **永远**登不进网页。本 ADR 实现后那句话不再成立（本机可凭配对码进入），两处必须同步改写。

## 实现注记（2026-10-13）

本 ADR 已落地。上面几处只定了性质、没定名字，这里把实现事实记下来，读者不必去翻源码：

- **开关**：`FATEBOOK_ENABLE_PAIRING_LOGIN`（`1` / `true` 为开），默认关。
- **签发**：过程 `agent.issuePairingCode` → CLI 命令 `issue-pairing-code`，输出 `{ code, expiresAt, redeemUrl }`。界面只有 CLI（已登记进上面那两处例外），但 `/api/trpc` 把同一批过程也暴露给网页会话——所以「只有持有凭据者能签发」不靠「网页没调用它」，而是靠过程层的一道门：`credentialProcedure`（`lib/web/trpc_base.ts`）只放行 `ctx.authentication === "credential"`。这一格由上下文构造点声明（`lib/web/context.ts` 的 HTTP 路径恒为 `session`；`cli/context.ts` 按来源映射），因此**网页会话**（邮件门或配对码门，两者等价）与**只设了 `FATEBOOK_AGENT_USER_EMAIL` 的进程**都被 `FORBIDDEN` 挡住——后者不含秘密，是**身份选择器**而不是凭据（ADR-0021）。开关仍单独判一次：关着签出来的码兑不了。守这条性质的是 `lib/web/agent_router.test.ts` 的两条用例（session / identity-selector 各一），以及 `cli/commands.test.ts` 的「只有邮箱 ⇒ 拒绝签发」。
- **兑换**：`/pair` 页面 → `pages/api/pairing/redeem.ts`。它是 **Next.js API 端点而不是 tRPC 过程**，因此不进 ADR-0023 的"过程级"登记表。保护它的是两层：`lib/web/pairing_redeem_handler.test.ts`（直接调 handler，删掉任何一道门都会红——e2e 在 localhost 上跑，删掉回环检查它分不出来）与 `e2e/pairing-login.spec.ts`（CLI 签发 → 浏览器兑换 → NextAuth 读得出会话）。
- **请求体只收 JSON**：Next 的默认 body 解析会把 `application/x-www-form-urlencoded` 解析成对象（`querystring.decode`），`body.code` 照样是字符串——所以「跨站表单到不了这里」是错的，必须显式拒（415），且**不记失败**（否则一个能被别人网页触发的请求就能把 5 次额度用光，成为一把 10 分钟的锁）。
- **「只在实例本机」判得比字面更严**：连接来自回环地址 **且** 浏览器访问的 `Host` 也是回环主机名。只看前者时，任何反向代理都会让远端来客以 `127.0.0.1` 出现——本仓库 `npm run dev` 自己就挂了一个 `local-ssl-proxy`，所以这不是假想情况。
- **库里的形状**：`PairingCode` 只存 `codeHash`（sha256）；一次有效由带条件的 `updateMany`（`usedAt: null` 且未过期）保证，而不是"先查再改"；时效 10 分钟；失败按来源限流 5 次 / 10 分钟（进程内存，`next dev` 的热重载会重置它）。签发时会清掉**该身份自己已过期**的行（不限 `usedAt`——只删未用的那批等于每次签发都留一条永久记录）。
- **对既有文档的同步已做完**（判据是可重跑的）：`grep -rn "永远登不进\|永远不能登录" README.md AGENTS.md` 现在没有任何命中——那两处「`<label>@localhost` 永远登不进网页」的说法已按上面最后一条改写。README 的单语化（删 `README.zh-CN.md`）是**独立的一次改动**，与这扇门无关，不属于本文的同步范围。
