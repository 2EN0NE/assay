import { CreateNextContextOptions } from "@trpc/server/adapters/next"
import { getServerSession } from "next-auth"
import { authOptions } from "../../pages/api/auth/[...nextauth]"

/**
 * Web 端（Next.js）的 tRPC 上下文。
 *
 * 刻意与 `trpc_base.ts` 分离：procedure 的定义不应硬依赖 Next.js 的认证适配器。
 * 否则任何非 Next 的调用方——例如 agent CLI（见 ADR-0015）——在 import 阶段
 * 就会因为加载 `pages/api/auth/[...nextauth]` 而直接崩溃，根本走不到 `createCaller`。
 */
export const createContext = async (opts: CreateNextContextOptions) => {
  const session = await getServerSession(opts.req, opts.res, authOptions)

  return {
    session,
    userId: session?.user?.id,
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>
