import type { NextApiRequest, NextApiResponse } from "next"
import prisma from "../prisma"
import handler from "../../pages/api/pairing/redeem"
import { SESSION_COOKIE_BASE_NAME } from "./session_cookie"

/**
 * 兑换端点的**组合**（ADR-0035）。纯函数各自都有单测（`pairing_code.test.ts`），
 * 但把它们从 handler 里删掉时那些单测仍然全绿——连 `e2e/pairing-login.spec.ts` 也
 * 分不出来，因为 e2e 本来就在 `localhost` 上跑。所以这里直接调用路由本身，守的是
 * "哪几道门真的接在链上"。
 *
 * 按本仓库的规矩（`AGENTS.md`：测试不得放在 `pages/` 下），文件留在领域目录里，
 * 从 `pages/api/pairing/redeem` 导入 handler。
 */

jest.mock("next-auth/jwt", () => ({
  encode: jest.fn(() => Promise.resolve("signed-token")),
}))

jest.mock("./pairing_code_store", () => ({
  issuePairingCode: jest.fn(),
  redeemPairingCode: jest.fn(),
}))

jest.mock("../prisma", () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn() } },
}))

const redeemPairingCode = (
  jest.requireMock("./pairing_code_store") as { redeemPairingCode: jest.Mock }
).redeemPairingCode
const userFindUnique = (
  prisma as unknown as { user: { findUnique: jest.Mock } }
).user.findUnique

type MockRes = {
  statusCode: number
  payload: unknown
  headers: Record<string, string>
  status(code: number): MockRes
  json(payload: unknown): MockRes
  setHeader(name: string, value: string): void
}

function makeRes(): MockRes {
  return {
    statusCode: 0,
    payload: undefined,
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.payload = payload
      return this
    },
    setHeader(name, value) {
      this.headers[name] = value
    },
  }
}

/**
 * 每例换一个**来源地址**：失败限流是模块级状态、按来源记，用同一个 127.0.0.1 会让
 * 断言依赖用例执行顺序。
 */
let sourceIndex = 0
let source = "127.0.0.1"

/** `process.env.NODE_ENV` 在类型上是只读的；生产模式的用例要能改它。 */
const env = process.env as Record<string, string | undefined>

function makeReq(
  overrides: {
    method?: string
    headers?: Record<string, string | undefined>
    body?: unknown
    remoteAddress?: string
  } = {},
): NextApiRequest {
  const {
    method = "POST",
    headers = {},
    body = { code: "ABCD2345" },
    remoteAddress = source,
  } = overrides
  return {
    method,
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      ...headers,
    },
    socket: { remoteAddress },
    body,
  } as unknown as NextApiRequest
}

async function call(
  overrides: Parameters<typeof makeReq>[0] = {},
): Promise<MockRes> {
  const res = makeRes()
  await handler(makeReq(overrides), res as unknown as NextApiResponse)
  return res
}

const savedEnv = {
  flag: process.env.FATEBOOK_ENABLE_PAIRING_LOGIN,
  secret: process.env.SECRET,
  nodeEnv: process.env.NODE_ENV,
}

beforeEach(() => {
  jest.clearAllMocks()
  sourceIndex += 1
  source = `127.0.0.${sourceIndex}`
  process.env.FATEBOOK_ENABLE_PAIRING_LOGIN = "1"
  process.env.SECRET = "test-secret"
  redeemPairingCode.mockResolvedValue(null)
  userFindUnique.mockResolvedValue({
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
  })
})

afterEach(() => {
  for (const [key, value] of [
    ["FATEBOOK_ENABLE_PAIRING_LOGIN", savedEnv.flag],
    ["SECRET", savedEnv.secret],
    ["NODE_ENV", savedEnv.nodeEnv],
  ] as const) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
})

describe("请求形状：只收 POST + JSON", () => {
  it("GET ⇒ 405，且不改 cookie、不领码", async () => {
    const res = await call({ method: "GET" })

    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe("POST")
    expect(redeemPairingCode).not.toHaveBeenCalled()
  })

  it("表单提交（urlencoded）⇒ 415：Next 会把 urlencoded 解析成对象，`body.code` 照样是字符串", async () => {
    const res = await call({
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: { code: "ABCD2345" },
    })

    expect(res.statusCode).toBe(415)
    expect(redeemPairingCode).not.toHaveBeenCalled()
  })

  it("非 JSON 的重复请求**不消耗**失败额度（否则跨站页面能锁死本机用户 10 分钟）", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await call({
        headers: { "content-type": "text/plain" },
        body: "code=ABCD2345",
      })
      expect(res.statusCode).toBe(415)
    }
  })
})

describe("门的顺序：开关 → 回环 → 限流 → 领码", () => {
  it("开关关闭 ⇒ 404，且不领码", async () => {
    delete process.env.FATEBOOK_ENABLE_PAIRING_LOGIN

    const res = await call()

    expect(res.statusCode).toBe(404)
    expect(redeemPairingCode).not.toHaveBeenCalled()
  })

  it("连接不来自回环（另一台机器，Host 却可能是回环）⇒ 403，且不领码", async () => {
    const res = await call({
      headers: { host: "127.0.0.1:3000" },
      remoteAddress: "192.168.1.20",
    })

    expect(res.statusCode).toBe(403)
    expect(redeemPairingCode).not.toHaveBeenCalled()
  })

  it("Host 不是回环（远端经反代后 socket 仍是 127.0.0.1）⇒ 403", async () => {
    const res = await call({ headers: { host: "fatebook.home:3000" } })

    expect(res.statusCode).toBe(403)
    expect(redeemPairingCode).not.toHaveBeenCalled()
  })

  it("缺 Host ⇒ 判不出来就不开门（403）", async () => {
    const res = await call({ headers: { host: undefined } })

    expect(res.statusCode).toBe(403)
  })
})

describe("失败限流真的接在这条链上", () => {
  it("连续 5 次无效码之后 ⇒ 429（第 6 次不再领码）", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await call({ body: { code: "WRONG999" } })
      expect(res.statusCode).toBe(401)
    }
    redeemPairingCode.mockClear()

    const blocked = await call({ body: { code: "WRONG999" } })

    expect(blocked.statusCode).toBe(429)
    expect(redeemPairingCode).not.toHaveBeenCalled()
  })
})

describe("兑换成功：会话 cookie 与邮件登录是同一个", () => {
  it("写入 next-auth.session-token（非生产：Lax、无 Secure），并回报身份", async () => {
    redeemPairingCode.mockResolvedValue("user-1")

    const res = await call()

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ ok: true, email: "owner@example.com" })
    const cookie = res.headers["Set-Cookie"]
    expect(cookie.startsWith(`${SESSION_COOKIE_BASE_NAME}=signed-token;`)).toBe(
      true,
    )
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
    expect(cookie).not.toContain("Secure")
  })

  it("生产模式换成 __Secure- 前缀 + Secure + SameSite=None（与 NextAuth 同一判据）", async () => {
    env.NODE_ENV = "production"
    redeemPairingCode.mockResolvedValue("user-1")

    const res = await call()

    const cookie = res.headers["Set-Cookie"]
    expect(cookie.startsWith(`__Secure-${SESSION_COOKIE_BASE_NAME}=`)).toBe(
      true,
    )
    expect(cookie).toContain("Secure")
    expect(cookie).toContain("SameSite=None")
  })

  it("领到码但身份已不存在 ⇒ 500 且要求重新签发（码已被消耗，不能再试一次）", async () => {
    redeemPairingCode.mockResolvedValue("gone")
    userFindUnique.mockResolvedValue(null)

    const res = await call()

    expect(res.statusCode).toBe(500)
    expect(res.headers["Set-Cookie"]).toBeUndefined()
    expect(String((res.payload as { error: string }).error)).toMatch(/重新签发/)
  })

  it("缺 SECRET ⇒ 500，不写 cookie", async () => {
    delete process.env.SECRET
    redeemPairingCode.mockResolvedValue("user-1")

    const res = await call()

    expect(res.statusCode).toBe(500)
    expect(res.headers["Set-Cookie"]).toBeUndefined()
  })
})
