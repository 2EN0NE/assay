import { appRouter } from "../lib/web/app_router"
import { getUserByApiKeyOrThrow } from "../lib/web/question_router"
import prisma from "../lib/prisma"
import { CliError } from "./args"
import { createAgentSession, createAnonymousSession } from "./context"

/**
 * 身份分发（ADR-0015 / ADR-0021 / ADR-0026）。
 *
 * 优先级 `--api-key` > `FATEBOOK_AGENT_API_KEY` > `FATEBOOK_AGENT_USER_EMAIL`
 * 只写在 `cli/context.ts` 一处；它决定了"这条命令以谁的身份落库"，而测试此前
 * 只走过邮箱那条回退路径（e2e 的 `FATEBOOK_AGENT_USER_EMAIL`），
 * 也就是说钥匙这条路错到什么程度都不会红。
 */

jest.mock("../lib/web/app_router", () => ({
  __esModule: true,
  // CLI 没有 HTTP 请求，也就没有 NextAuth session；过程只读 `ctx.userId`。
  // 这里把 caller 换成一个可断言的信标，好检查传进去的 ctx。
  appRouter: {
    createCaller: jest.fn(() => ({
      agent: "AGENT_API",
      decision: "DECISION_API",
    })),
  },
}))

jest.mock("../lib/web/question_router", () => ({
  __esModule: true,
  getUserByApiKeyOrThrow: jest.fn(),
}))

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn() } },
}))

const createCaller = jest.mocked(appRouter.createCaller)
const lookupByApiKey = jest.mocked(getUserByApiKeyOrThrow)
const userFindUnique = jest.mocked(prisma.user.findUnique)

const OWNER = { id: "user-1", email: "owner@example.com" }

/** 把 rejection 收成一个值，好让每个用例都是同一种 async 风格。 */
async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return undefined
  } catch (error: unknown) {
    return error
  }
}

beforeEach(() => {
  delete process.env.FATEBOOK_AGENT_API_KEY
  delete process.env.FATEBOOK_AGENT_USER_EMAIL
  lookupByApiKey.mockResolvedValue(OWNER as never)
  userFindUnique.mockResolvedValue(OWNER as never)
})

afterEach(() => {
  delete process.env.FATEBOOK_AGENT_API_KEY
  delete process.env.FATEBOOK_AGENT_USER_EMAIL
})

describe("createAgentSession —— 身份来源优先级（ADR-0026）", () => {
  it("--api-key 覆盖环境变量的钥匙（单条覆盖，用于测试与自动化）", async () => {
    process.env.FATEBOOK_AGENT_API_KEY = "env-key"
    process.env.FATEBOOK_AGENT_USER_EMAIL = "owner@example.com"

    const session = await createAgentSession({ apiKey: "flag-key" })

    expect(lookupByApiKey).toHaveBeenCalledWith("flag-key")
    expect(session.credentialSource).toBe("api-key-flag")
  })

  it("没有 flag 时用 FATEBOOK_AGENT_API_KEY（项目级作用域的钥匙）", async () => {
    process.env.FATEBOOK_AGENT_API_KEY = "env-key"

    const session = await createAgentSession()

    expect(lookupByApiKey).toHaveBeenCalledWith("env-key")
    expect(session.credentialSource).toBe("api-key-env")
  })

  it("两把钥匙都没有时回退到邮箱（遗留路径仍然可用）", async () => {
    process.env.FATEBOOK_AGENT_USER_EMAIL = "owner@example.com"

    const session = await createAgentSession()

    expect(userFindUnique).toHaveBeenCalledWith({
      where: { email: "owner@example.com" },
    })
    expect(lookupByApiKey).not.toHaveBeenCalled()
    expect(session.credentialSource).toBe("email-env")
  })

  it("凭据的归属决定身份：userId / email 取自持钥匙的那个账号", async () => {
    lookupByApiKey.mockResolvedValue({
      id: "credential-owner",
      email: "credential@example.com",
    } as never)

    const session = await createAgentSession({ apiKey: "flag-key" })

    expect(session.userId).toBe("credential-owner")
    expect(session.email).toBe("credential@example.com")
  })

  it("caller 的 ctx 里 session 必须是 null，而不是伪造一个登录态", async () => {
    await createAgentSession({ apiKey: "flag-key" })

    expect(createCaller).toHaveBeenCalledWith({
      session: null,
      userId: "user-1",
    })
  })
})

describe("createAgentSession —— 身份不可用时当场失败（不猜、不回退）", () => {
  it("没有任何来源 ⇒ 报错，且不碰数据库、不构造 caller", async () => {
    const error = await captureError(() => createAgentSession())

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toMatch(/没有可用身份/)
    expect(userFindUnique).not.toHaveBeenCalled()
    expect(createCaller).not.toHaveBeenCalled()
  })

  it("钥匙无效 ⇒ 报错，**不**静默回退到邮箱（错误钥匙不能变成另一个人的身份）", async () => {
    process.env.FATEBOOK_AGENT_USER_EMAIL = "owner@example.com"
    lookupByApiKey.mockRejectedValue(new Error("no such key"))

    const error = await captureError(() =>
      createAgentSession({ apiKey: "typo" }),
    )

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toMatch(/凭据无效/)
    expect(userFindUnique).not.toHaveBeenCalled()
    expect(createCaller).not.toHaveBeenCalled()
  })

  it("邮箱找不到账号 ⇒ 报错并指向 init /api-setup", async () => {
    process.env.FATEBOOK_AGENT_USER_EMAIL = "ghost@example.com"
    userFindUnique.mockResolvedValue(null)

    const error = await captureError(() => createAgentSession())

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toMatch(/找不到邮箱/)
    expect(createCaller).not.toHaveBeenCalled()
  })
})

describe("createAnonymousSession —— 只给「自己解决身份」的命令（init）", () => {
  it("userId 缺席是真实语义：那一刻确实还没有身份", () => {
    const session = createAnonymousSession()

    expect(session.agent).toBe("AGENT_API")
    expect(session.decision).toBe("DECISION_API")
    expect(createCaller).toHaveBeenCalledWith({
      session: null,
      userId: undefined,
    })
  })
})
