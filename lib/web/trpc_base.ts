import { initTRPC, TRPCError } from "@trpc/server"
import { OpenApiMeta } from "trpc-openapi"
import transformer from "trpc-transformer"
import type { Context } from "./context"

export type { Context }

const t = initTRPC.meta<OpenApiMeta>().context<Context>().create({
  transformer,
})

export const router = t.router
export const publicProcedure = t.procedure

/**
 * 要求已解析出 owner，且只能碰自己的数据（ADR-0015）。
 *
 * 这一层同时服务 agent CLI（`createCaller`）与 Web UI：校验规则只有一份，
 * 两个入口都必须遵守，所以它属于 procedure 原语，而不属于某一个 router。
 */
export const ownedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "未解析到 owner 用户。请设置 FATEBOOK_AGENT_USER_EMAIL 指向已存在的账号。",
    })
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})
