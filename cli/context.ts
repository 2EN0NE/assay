import prisma from "../lib/prisma"
import { appRouter } from "../lib/web/app_router"
import type { Context } from "../lib/web/context"
import { CliError } from "./args"

/**
 * 解析 owner 身份并构造 tRPC caller（ADR-0015）。
 *
 * 刻意走 `createCaller` 而非另写一条 Prisma 直连路径：校验与业务逻辑只有一份，
 * CLI 只是第二个传输层。这要求 `trpc_base` 不依赖 Next.js 的认证适配器——
 * 见 `lib/web/context.ts` 的注释。
 */
export type AgentSession = {
  agent: ReturnType<typeof appRouter.createCaller>["agent"]
  userId: string
  email: string
}

export async function createAgentSession(): Promise<AgentSession> {
  const email = process.env.FATEBOOK_AGENT_USER_EMAIL
  if (!email) {
    throw new CliError(
      "未设置 FATEBOOK_AGENT_USER_EMAIL",
      "在 .env 里加一行 FATEBOOK_AGENT_USER_EMAIL=<你的登录邮箱>。该邮箱必须已存在账号。",
    )
  }

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    throw new CliError(
      `找不到邮箱为 ${email} 的账号`,
      "先在 Web UI 用这个邮箱完成一次登录以创建账号，或把 FATEBOOK_AGENT_USER_EMAIL 改成已存在的邮箱。",
    )
  }

  // CLI 没有 HTTP 请求，因此没有 NextAuth session；所有过程都只读取 `ctx.userId`
  // （见 agent_router 的 ownedProcedure），所以把 session 置 null 是真实语义而非占位。
  // `Context.session` 本就允许 null，这里不需要断言——早先写成 `as unknown as Context`
  // 并配了一条注释说"无法在无请求场景下构造"，那是把「类型不便」说成了「类型不可能」。
  const ctx: Context = { session: null, userId: user.id }
  const caller = appRouter.createCaller(ctx)

  return { agent: caller.agent, userId: user.id, email: user.email }
}
