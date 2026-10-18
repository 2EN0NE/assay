import { CreateNextContextOptions } from "@trpc/server/adapters/next"
import type { Session } from "next-auth"
import { getServerSession } from "next-auth"
import { authOptions } from "../../pages/api/auth/[...nextauth]"

/**
 * 调用方是**谁、凭什么**（ADR-0035）。
 *
 * 这一格存在的唯一理由：把「持有凭据」与「有会话」「只是选了身份」分开。签发配对码
 * 只认第一种，而网页会话与 `FATEBOOK_AGENT_USER_EMAIL` 都不是凭据——不分开，那句
 * 「只有已经持有该身份凭据的一方可签发」就只是一句注释。
 *
 * - `session`：网页会话。邮件门与配对码门**等价**（配对码换来的就是它），所以配对码
 *   兑换出来的会话也不能再签发——否则那扇门能把自己续成新的长期 token。
 * - `credential`：CLI 进程里解析出的 API key（`--api-key` / 环境变量 / 凭据文件）。
 * - `identity-selector`：只有 `FATEBOOK_AGENT_USER_EMAIL`。它不含秘密，谁设了都能以
 *   该身份跑命令（ADR-0021 的本机信任模型），因此它证明得了身份，证明不了「持有」。
 * - `none`：身份还不存在——`init` 自己解决身份的那一刻。
 */
export type Authentication =
  | "session"
  | "credential"
  | "identity-selector"
  | "none"

/**
 * Web 端（Next.js）的 tRPC 上下文。
 *
 * 刻意与 `trpc_base.ts` 分离：procedure 的定义不应硬依赖 Next.js 的认证适配器。
 * 否则任何非 Next 的调用方——例如 agent CLI（见 ADR-0015）——在 import 阶段
 * 就会因为加载 `pages/api/auth/[...nextauth]` 而直接崩溃，根本走不到 `createCaller`。
 *
 * 形状写成显式类型而不是从下面的函数推导：HTTP 路径只会产出 `authentication:
 * "session"`，而 `Context` 必须容得下 CLI 构造的那三种，推导出来的字面量类型会把
 * CLI 挡在门外。
 */
export type Context = {
  session: Session | null
  userId: string | undefined
  authentication: Authentication
}

export const createContext = async (
  opts: CreateNextContextOptions,
): Promise<Context> => {
  const session = await getServerSession(opts.req, opts.res, authOptions)

  // 走 HTTP 就只可能是会话。这一行是整个「凭据 vs 会话」区分的落脚点：没有它，
  // 任何能带 cookie 的客户端都能声称自己是持凭据者。
  return { session, userId: session?.user?.id, authentication: "session" }
}
