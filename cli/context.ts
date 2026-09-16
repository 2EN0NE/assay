import prisma from "../lib/prisma"
import { appRouter } from "../lib/web/app_router"
import { getUserByApiKeyOrThrow } from "../lib/web/question_router"
import type { Context } from "../lib/web/context"
import { CliError } from "./args"

/**
 * 解析身份并构造 tRPC caller（ADR-0015、ADR-0021、ADR-0026）。
 *
 * 刻意走 `createCaller` 而非另写一条 Prisma 直连路径：校验与业务逻辑只有一份，
 * CLI 只是第二个传输层。这要求 `trpc_base` 不依赖 Next.js 的认证适配器——
 * 见 `lib/web/context.ts` 的注释。
 *
 * 身份来源按 ADR-0026 的优先级：`--api-key` > `FATEBOOK_AGENT_API_KEY` >
 * 遗留的 `FATEBOOK_AGENT_USER_EMAIL`。CLI 不在磁盘上记"当前身份"：每条命令自带。
 */
/**
 * 身份来源（ADR-0026）。`none` 只用于"自己解决身份"的命令（如 init）：
 * 那一刻确实还没有身份，不是占位值。
 */
export type CredentialSource =
  | "api-key-flag"
  | "api-key-env"
  | "email-env"
  | "none"

export type AgentSession = {
  agent: ReturnType<typeof appRouter.createCaller>["agent"]
  decision: ReturnType<typeof appRouter.createCaller>["decision"]
  tags: ReturnType<typeof appRouter.createCaller>["tags"]
  userId: string
  email: string
  credentialSource: CredentialSource
}

function callerFor(userId: string | undefined) {
  // CLI 没有 HTTP 请求，因此没有 NextAuth session；所有过程都只读取 `ctx.userId`
  // （见 agent_router 的 ownedProcedure），所以把 session 置 null 是真实语义而非占位。
  // `Context.session` 本就允许 null，这里不需要断言。
  const ctx: Context = { session: null, userId }
  return appRouter.createCaller(ctx)
}

export async function createAgentSession(
  options: { apiKey?: string } = {},
): Promise<AgentSession> {
  const flagKey = options.apiKey
  const apiKey = flagKey ?? process.env.FATEBOOK_AGENT_API_KEY

  if (apiKey) {
    let user
    try {
      user = await getUserByApiKeyOrThrow(apiKey)
    } catch {
      throw new CliError(
        "凭据无效：没有身份持有这把钥匙",
        "用 `whoami` 确认当前身份；需要新身份就用 `init`，需要换钥匙就去 Web 的 /api-setup。",
      )
    }
    const caller = callerFor(user.id)
    return {
      agent: caller.agent,
      decision: caller.decision,
      tags: caller.tags,
      userId: user.id,
      email: user.email,
      credentialSource: flagKey ? "api-key-flag" : "api-key-env",
    }
  }

  const email = process.env.FATEBOOK_AGENT_USER_EMAIL
  if (!email) {
    throw new CliError(
      "没有可用身份：既没给凭据，也没设 FATEBOOK_AGENT_USER_EMAIL",
      "设 FATEBOOK_AGENT_API_KEY=<钥匙>（推荐），或 FATEBOOK_AGENT_USER_EMAIL=<已有账号的邮箱>（遗留）。",
    )
  }

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    throw new CliError(
      `找不到邮箱为 ${email} 的账号`,
      "用 `init` 建一个身份，或把 FATEBOOK_AGENT_USER_EMAIL 改成已存在的邮箱。",
    )
  }

  const caller = callerFor(user.id)
  return {
    agent: caller.agent,
    decision: caller.decision,
    tags: caller.tags,
    userId: user.id,
    email: user.email,
    credentialSource: "email-env",
  }
}

/**
 * 给"自己解决身份"的命令用（目前只有 `init`）：它必须在身份存在之前运行。
 * 身份字段缺席是真实语义而非占位——那一刻确实还没有身份可挂。
 */
export function createAnonymousSession(): Pick<
  AgentSession,
  "agent" | "decision" | "tags"
> {
  const caller = callerFor(undefined)
  return { agent: caller.agent, decision: caller.decision, tags: caller.tags }
}
