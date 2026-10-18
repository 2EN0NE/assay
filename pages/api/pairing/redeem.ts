import type { NextApiRequest, NextApiResponse } from "next"
import { encode } from "next-auth/jwt"
import { log } from "../../../lib/_log"
import prisma from "../../../lib/prisma"
import {
  createFailureLimiter,
  isLocalRequest,
} from "../../../lib/web/pairing_code"
import { isPairingLoginEnabled } from "../../../lib/web/pairing_flag"
import { redeemPairingCode } from "../../../lib/web/pairing_code_store"
import {
  SESSION_TOKEN_MAX_AGE_SECONDS,
  secureCookiesEnabled,
  serializeSessionCookie,
  sessionTokenCookie,
} from "../../../lib/web/session_cookie"

/**
 * 把一次性配对码换成网页会话（ADR-0035）。
 *
 * 这是"网页的第二扇门"：邮件门是**人**的门（保留），这一扇是**已经持有凭据的一方**
 * 在本机开的捷径。四道限制都在这里落实，缺任何一道都不会有症状：
 *
 * - 开关**默认关闭**，且必须显式（不得由 `NODE_ENV` 推断，见 ADR-0035 的专节）；
 * - 只在**实例本机**可兑换（`isLocalRequest`：连接与 Host 都必须是回环）；
 * - 码**一次有效 + 短时效**（由 `redeemPairingCode` 的带条件更新保证）；
 * - 失败**限流**（只记内存、按来源分）。
 *
 * 会话本身沿用现有 JWT 语义：`next-auth/jwt` 的 `encode` + 与邮件登录**同一个**
 * cookie（`lib/web/session_cookie.ts`，两处共用一份定义）。
 */

const MAX_FAILURES = 5
const FAILURE_WINDOW_MS = 10 * 60 * 1000

/**
 * 进程内、按来源计的失败计数。`next dev` 的 HMR 会重置它——这是刻意的取舍：
 * 本机场景下它挡的是"脚本猛试"，重启服务本身就意味着操作者坐在那台机器前。
 */
const pairingFailures = createFailureLimiter(MAX_FAILURES, FAILURE_WINDOW_MS)

function fail(res: NextApiResponse, status: number, error: string): void {
  res.status(status).json({ error })
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return fail(res, 405, "配对码只能用 POST 兑换。")
  }

  if (!isPairingLoginEnabled(process.env)) {
    return fail(res, 404, "配对码登录未启用（默认关闭，ADR-0035）。")
  }

  if (!isLocalRequest(req)) {
    log("pairing:redeem 拒绝：请求不来自实例本机（loopback）")
    return fail(res, 403, "配对码只能在这台机器上兑换（ADR-0035）。")
  }

  const now = new Date()
  const source = req.socket.remoteAddress ?? "unknown"
  if (pairingFailures.isBlocked(source, now)) {
    return fail(res, 429, "尝试次数过多，请稍后再试。")
  }

  // 只接受 JSON 请求体——**这不是装饰**。跨站的 `<form>` 提交发的是 urlencoded，
  // 而 Next 的默认 body 解析对 urlencoded 走 `querystring.decode`，得到的是对象，
  // `body.code` 照样是字符串（「表单解析出来是字符串、到不了这里」是错的）。所以
  // 必须显式拒绝：强制 JSON 之后，浏览器要发这类请求就得先过 CORS 预检，而本端点
  // 不提供 CORS 头，实际 POST 不会发出。
  //
  // 拒绝时**不记失败**：一个能被别人网页触发的请求不该消耗本机用户的尝试额度——
  // 否则那 5 次额度本身就是一把 10 分钟的锁。
  const contentType = String(req.headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase()
  if (contentType !== "application/json") {
    return fail(res, 415, "配对码只能用 JSON 请求体兑换。")
  }

  const code = typeof req.body?.code === "string" ? req.body.code : ""
  const userId = code === "" ? null : await redeemPairingCode(code, now)

  if (userId === null) {
    pairingFailures.recordFailure(source, now)
    log("pairing:redeem 失败：码无效 / 已被用过 / 已过期")
    return fail(res, 401, "配对码无效或已过期。请重新签发一个。")
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  })
  const secret = process.env.SECRET
  if (!user || !secret) {
    // 码已经被领用了，所以这里必须说"重新签发"而不是"再试一次"。
    log(
      `pairing:redeem 领用后无法建会话：${user ? "缺少 SECRET" : "身份已不存在"}`,
    )
    return fail(res, 500, "这次兑换没能建立会话，请重新签发一个配对码。")
  }

  const token = await encode({
    token: { id: user.id, email: user.email, name: user.name ?? undefined },
    secret,
    maxAge: SESSION_TOKEN_MAX_AGE_SECONDS,
  })

  const { name, options } = sessionTokenCookie(secureCookiesEnabled())
  res.setHeader(
    "Set-Cookie",
    serializeSessionCookie({
      name,
      value: token,
      options,
    }),
  )

  // 日志只说"谁换到了会话"，绝不落码本身（它是凭据，进日志等于被抄走）。
  log(`pairing:redeem 成功 userId=${user.id}`)
  res.status(200).json({ ok: true, email: user.email })
}
