import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import { appRouter } from "../lib/web/app_router"
import { getUserByApiKeyOrThrow } from "../lib/web/question_router"
import prisma from "../lib/prisma"
import { CliError } from "./args"
import { createAgentSession, createAnonymousSession } from "./context"

/**
 * 身份分发（ADR-0015 / ADR-0021 / ADR-0026）。
 *
 * 优先级 `--api-key` > `ASSAY_AGENT_API_KEY` > `ASSAY_AGENT_USER_EMAIL`
 * 只写在 `cli/context.ts` 一处；它决定了"这条命令以谁的身份落库"，而测试此前
 * 只走过邮箱那条回退路径（e2e 的 `ASSAY_AGENT_USER_EMAIL`），
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
  delete process.env.ASSAY_AGENT_API_KEY
  delete process.env.ASSAY_AGENT_API_KEY_FILE
  delete process.env.ASSAY_AGENT_USER_EMAIL
  lookupByApiKey.mockResolvedValue(OWNER as never)
  userFindUnique.mockResolvedValue(OWNER as never)
})

afterEach(() => {
  delete process.env.ASSAY_AGENT_API_KEY
  delete process.env.ASSAY_AGENT_API_KEY_FILE
  delete process.env.ASSAY_AGENT_USER_EMAIL
})

describe("createAgentSession —— 身份来源优先级（ADR-0026）", () => {
  it("--api-key 覆盖环境变量的钥匙（单条覆盖，用于测试与自动化）", async () => {
    process.env.ASSAY_AGENT_API_KEY = "env-key"
    process.env.ASSAY_AGENT_USER_EMAIL = "owner@example.com"

    const session = await createAgentSession({ apiKey: "flag-key" })

    expect(lookupByApiKey).toHaveBeenCalledWith("flag-key")
    expect(session.credentialSource).toBe("api-key-flag")
  })

  it("没有 flag 时用 ASSAY_AGENT_API_KEY（项目级作用域的钥匙）", async () => {
    process.env.ASSAY_AGENT_API_KEY = "env-key"

    const session = await createAgentSession()

    expect(lookupByApiKey).toHaveBeenCalledWith("env-key")
    expect(session.credentialSource).toBe("api-key-env")
  })

  it("两把钥匙都没有时回退到邮箱（遗留路径仍然可用）", async () => {
    process.env.ASSAY_AGENT_USER_EMAIL = "owner@example.com"

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
      authentication: "credential",
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
    process.env.ASSAY_AGENT_USER_EMAIL = "owner@example.com"
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
    process.env.ASSAY_AGENT_USER_EMAIL = "ghost@example.com"
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
      authentication: "none",
    })
  })
})

describe("凭据文件 ASSAY_AGENT_API_KEY_FILE（ADR-0036）", () => {
  const keyFile = path.join(os.tmpdir(), `assay-agent-key-${process.pid}.txt`)

  afterEach(() => {
    fs.rmSync(keyFile, { force: true })
  })

  it("从文件读出的钥匙立即可用，且末尾换行不算凭据的一部分", async () => {
    fs.writeFileSync(keyFile, "file-key\n")
    process.env.ASSAY_AGENT_API_KEY_FILE = keyFile

    const session = await createAgentSession()

    expect(lookupByApiKey).toHaveBeenCalledWith("file-key")
    expect(session.credentialSource).toBe("api-key-file")
  })

  it("进程环境变量里的钥匙压过文件（显式覆盖优先，同 ADR-0036 的优先级）", async () => {
    fs.writeFileSync(keyFile, "file-key\n")
    process.env.ASSAY_AGENT_API_KEY_FILE = keyFile
    process.env.ASSAY_AGENT_API_KEY = "env-key"

    const session = await createAgentSession()

    expect(lookupByApiKey).toHaveBeenCalledWith("env-key")
    expect(session.credentialSource).toBe("api-key-env")
  })

  it("空串的 ASSAY_AGENT_API_KEY 是**显式压制**：此时不再去看文件、回退到邮箱", async () => {
    // e2e 的邮箱用例正是靠这一条（dotenv 不覆盖已存在的键，空串能挡住 `.env` 里的值）。
    fs.writeFileSync(keyFile, "file-key\n")
    process.env.ASSAY_AGENT_API_KEY_FILE = keyFile
    process.env.ASSAY_AGENT_API_KEY = ""
    process.env.ASSAY_AGENT_USER_EMAIL = "owner@example.com"

    const session = await createAgentSession()

    expect(lookupByApiKey).not.toHaveBeenCalled()
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { email: "owner@example.com" },
    })
    expect(session.credentialSource).toBe("email-env")
  })

  it("文件读不到 ⇒ 当场报错，**不**静默回退到邮箱（那会变成另一个身份）", async () => {
    process.env.ASSAY_AGENT_API_KEY_FILE = path.join(
      os.tmpdir(),
      "definitely-missing-key-file.txt",
    )
    process.env.ASSAY_AGENT_USER_EMAIL = "owner@example.com"

    const error = await captureError(() => createAgentSession())

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toMatch(/读不到凭据文件/)
    expect(userFindUnique).not.toHaveBeenCalled()
    expect(createCaller).not.toHaveBeenCalled()
  })

  it("文件是空的（只有空白）⇒ 同样是硬失败，不当成「没设」", async () => {
    fs.writeFileSync(keyFile, "   \n")
    process.env.ASSAY_AGENT_API_KEY_FILE = keyFile

    const error = await captureError(() => createAgentSession())

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toMatch(/凭据文件是空的/)
    expect(lookupByApiKey).not.toHaveBeenCalled()
  })

  it("路径是空白 ⇒ 与 `ASSAY_AGENT_API_KEY=\"\"` 同语义（显式压制），不是「去读一个叫 '' 的文件」", async () => {
    // 服务单元模板里留空一个可选路径是常事；那不该变成一个看不出原因的错误。
    process.env.ASSAY_AGENT_API_KEY_FILE = "   "
    process.env.ASSAY_AGENT_USER_EMAIL = "owner@example.com"
    userFindUnique.mockResolvedValue(OWNER as never)

    const session = await createAgentSession()

    expect(session.credentialSource).toBe("email-env")
    expect(lookupByApiKey).not.toHaveBeenCalled()
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { email: "owner@example.com" },
    })
  })
})

/**
 * 调用方认证种类（ADR-0035）：`ctx.authentication` 决定"这条命令有没有凭据"。
 *
 * 签发配对码只认 `credential`。把这条映射放错的后果**没有症状**：一条只设了邮箱的
 * 进程会安静地拿到签发权，而 ADR 里「只有持有凭据的一方可签发」变成一句注释。
 */
describe("createAgentSession —— 调用方认证种类（ADR-0035）", () => {
  it("持钥匙 ⇒ credential（三种来源都是）", async () => {
    process.env.ASSAY_AGENT_API_KEY = "env-key"

    await createAgentSession()

    expect(createCaller).toHaveBeenCalledWith(
      expect.objectContaining({ authentication: "credential" }),
    )
  })

  it("只有邮箱 ⇒ identity-selector：它证明身份，不证明持有", async () => {
    process.env.ASSAY_AGENT_USER_EMAIL = "owner@example.com"

    await createAgentSession()

    expect(createCaller).toHaveBeenCalledWith(
      expect.objectContaining({ authentication: "identity-selector" }),
    )
  })

  it("匿名（init）⇒ none：那一刻确实还没有身份", () => {
    createAnonymousSession()

    expect(createCaller).toHaveBeenCalledWith(
      expect.objectContaining({ authentication: "none" }),
    )
  })
})
