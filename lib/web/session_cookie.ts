/**
 * 会话 cookie 的定义只有一处（ADR-0035：配对码兑出来的必须与邮件登录是**同一个**会话）。
 *
 * 名字或选项写错一个字节的后果是"页面说登录成功、NextAuth 却读不到那个 cookie"，而
 * **不会报错**。所以这里不重复抄一份，而是让 `pages/api/auth/[...nextauth].ts` 与兑换
 * 端点共用。
 *
 * 生产模式下的 `__Secure-` + `SameSite=None` 是那个既有文件的选择（由 NextAuth 的
 * cookie 约定抄来）：这类 cookie 只在 HTTPS 下被浏览器接受（`localhost` 例外）。
 * 这也正是 ADR-0035 拒绝用 `NODE_ENV` 推断配对开关的理由。
 */

export const SESSION_COOKIE_BASE_NAME = "next-auth.session-token"

/**
 * JWT 的有效期——**不是** cookie 的有效期。
 *
 * 两扇门发出的都是**会话 cookie**（不带 `Expires`：浏览器关掉即失效），而 JWT 本身
 * 活这么久。`Expires` 只影响浏览器；agent 手里的 cookie 罐（curl `-c/-b`、
 * Playwright storageState）无论有没有 `Expires` 都会把它带回来。
 */
export const SESSION_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export type SessionCookieOptions = {
  httpOnly: boolean
  sameSite: "lax" | "none"
  path: string
  secure: boolean
}

/**
 * `useSecureCookies` 的判据**也只能有一处**：cookie 的名字与选项都由它派生，
 * 所以本文件同时收敛形状与它的输入（ADR-0035）。
 *
 * 两个调用点（`pages/api/auth/[...nextauth].ts` 与配对码兑换）各写一遍
 * `process.env.NODE_ENV === "production"` 时，改一处就让 cookie 名分家——
 * 表现是"页面说登录成功、NextAuth 读不到 cookie"，而**没有报错**。
 */
export function secureCookiesEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV === "production"
}

/**
 * 名字前缀与 `SameSite` 也由同一个判据派生，且**只在这里派生**：NextAuth 的其余
 * cookie（callback-url / csrf / state / nonce）与会话 cookie 必须同源，否则生产模式下
 * 会得到"一半 `__Secure-`、一半没有"的混合体，而浏览器只会安静地丢掉不合规的那些。
 */
export function sessionCookiePrefix(secure: boolean): string {
  return secure ? "__Secure-" : ""
}

export function sessionCookieSameSite(secure: boolean): "none" | "lax" {
  return secure ? "none" : "lax"
}

export function sessionTokenCookie(secure: boolean): {
  name: string
  options: SessionCookieOptions
} {
  return {
    name: `${sessionCookiePrefix(secure)}${SESSION_COOKIE_BASE_NAME}`,
    options: {
      httpOnly: true,
      sameSite: sessionCookieSameSite(secure),
      path: "/",
      secure,
    },
  }
}

/**
 * `Set-Cookie` 的值。手写而不是借用 NextAuth 内部的 cookie 工具（它没有对外导出）：
 * 形状就这么几格，且被测试逐格钉住——比依赖一个未导出的内部实现稳。
 *
 * **`expiresAt` 不给就是不写 `Expires`**，即会话 cookie（关掉浏览器即失效）。这正是
 * 邮件门的行为（NextAuth 默认不给会话 cookie 设 maxAge），两扇门因此一致；"重启浏览器
 * 后还登录着"是没人要求过的属性，不在这里偷偷加上（ADR-0035）。
 */
export function serializeSessionCookie(input: {
  name: string
  value: string
  options: SessionCookieOptions
  expiresAt?: Date
}): string {
  const { name, value, options, expiresAt } = input
  const parts = [`${name}=${value}`, `Path=${options.path}`]
  if (expiresAt) parts.push(`Expires=${expiresAt.toUTCString()}`)
  if (options.httpOnly) parts.push("HttpOnly")
  parts.push(`SameSite=${options.sameSite === "none" ? "None" : "Lax"}`)
  if (options.secure) parts.push("Secure")
  return parts.join("; ")
}
