import {
  SESSION_COOKIE_BASE_NAME,
  SESSION_TOKEN_MAX_AGE_SECONDS,
  secureCookiesEnabled,
  sessionCookiePrefix,
  sessionCookieSameSite,
  sessionTokenCookie,
  serializeSessionCookie,
} from "./session_cookie"

/**
 * 会话 cookie 的两个要求来自 ADR-0035：
 *
 * 1. 配对码兑出来的是**同一个会话**（"沿用现有 JWT 会话语义，不引入第二套"）——
 *    所以名字与选项必须与 `pages/api/auth/[...nextauth].ts` 的 `getCookies()` 完全
 *    相同，否则 NextAuth 读不到它，人看起来"登录成功了"，其实仍是未登录状态（**没有报错**）。
 * 2. 生产模式下的 `__Secure-` + `SameSite=None` 是 `getCookies()` 的既有选择
 *    （浏览器只接受 HTTPS 下的这类 cookie）。判据、名字前缀与 `SameSite` 都只有一处
 *    定义——两处各写一遍就会分家，而分家没有症状。
 */
describe("会话 cookie 的定义只有一处", () => {
  it("非生产：普通名字 + SameSite=Lax，不带 Secure", () => {
    expect(sessionTokenCookie(false)).toEqual({
      name: SESSION_COOKIE_BASE_NAME,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    })
  })

  it("生产：__Secure- 前缀 + SameSite=None + Secure", () => {
    expect(sessionTokenCookie(true)).toEqual({
      name: `__Secure-${SESSION_COOKIE_BASE_NAME}`,
      options: {
        httpOnly: true,
        sameSite: "none",
        path: "/",
        secure: true,
      },
    })
  })

  /**
   * 这条守的是 `getCookies()` 里那两格"其余 cookie 共用"的派生：前缀与 `SameSite`
   * 若与名字的来源不是同一处，生产模式会出现"一半 `__Secure-`、一半没有"的混合体，
   * 而浏览器只会安静地丢掉不合规的那些。
   */
  it("名字、前缀、SameSite 三者同源（两种模式）", () => {
    for (const secure of [false, true]) {
      const { name, options } = sessionTokenCookie(secure)
      expect(name).toBe(
        `${sessionCookiePrefix(secure)}${SESSION_COOKIE_BASE_NAME}`,
      )
      expect(options.sameSite).toBe(sessionCookieSameSite(secure))
      expect(options.secure).toBe(secure)
    }
  })
})

describe("序列化 Set-Cookie", () => {
  it("**默认是会话 cookie**：不写 Expires（与邮件门一致）", () => {
    const { name, options } = sessionTokenCookie(false)

    // 关掉浏览器即失效。`SESSION_TOKEN_MAX_AGE_SECONDS` 是 JWT 的寿命，与这里无关：
    // "重启浏览器后还登录着"是没人要求过的属性（ADR-0035），不能顺手加上。
    expect(
      serializeSessionCookie({ name, value: "token-value", options }),
    ).toBe(
      `${SESSION_COOKIE_BASE_NAME}=token-value; Path=/; HttpOnly; SameSite=Lax`,
    )
  })

  it("显式给 expiresAt 才写 Expires——形状逐格钉住", () => {
    const { name, options } = sessionTokenCookie(false)

    expect(
      serializeSessionCookie({
        name,
        value: "token-value",
        options,
        expiresAt: new Date("2026-11-12T00:00:00Z"),
      }),
    ).toBe(
      `${SESSION_COOKIE_BASE_NAME}=token-value; Path=/; Expires=${new Date(
        "2026-11-12T00:00:00Z",
      ).toUTCString()}; HttpOnly; SameSite=Lax`,
    )
  })

  it("生产带上 Secure（否则浏览器会直接丢掉这个 cookie）", () => {
    const { name, options } = sessionTokenCookie(true)

    const header = serializeSessionCookie({
      name,
      value: "token-value",
      options,
    })

    expect(header).toContain("Secure")
    expect(header).toContain("SameSite=None")
    expect(header.startsWith(`__Secure-${SESSION_COOKIE_BASE_NAME}=`)).toBe(
      true,
    )
  })

  it("JWT 寿命与 cookie 寿命是两个概念", () => {
    // 30 天是 `encode({ maxAge })` 用的那个数，不是 Set-Cookie 里的 Expires。
    expect(SESSION_TOKEN_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60)
    const { name, options } = sessionTokenCookie(false)
    expect(serializeSessionCookie({ name, value: "v", options })).not.toContain(
      "Expires",
    )
  })
})

/**
 * 判据本身也只能有一处：`pages/api/auth/[...nextauth].ts` 与配对码兑换都从这里取。
 * 两处各写一遍 `NODE_ENV === "production"` 时，改一处就让 cookie 名分家——而那种
 * 分家**没有报错**（"页面说登录成功、会话却是空的"）。
 */
describe("secureCookiesEnabled —— 只认 NODE_ENV === production", () => {
  it("production ⇒ true；development / test / 未设 ⇒ false", () => {
    expect(secureCookiesEnabled({ NODE_ENV: "production" })).toBe(true)
    expect(secureCookiesEnabled({ NODE_ENV: "development" })).toBe(false)
    expect(secureCookiesEnabled({ NODE_ENV: "test" })).toBe(false)
    expect(secureCookiesEnabled({})).toBe(false)
  })

  it("不掺第二个输入：本地 https 反代（NEXTAUTH_URL 是 https）也仍然是 false", () => {
    // 多一个输入就多一条分家的路。判据只有一个：NODE_ENV。
    expect(
      secureCookiesEnabled({ NEXTAUTH_URL: "https://localhost:3000/api/auth" }),
    ).toBe(false)
  })
})
