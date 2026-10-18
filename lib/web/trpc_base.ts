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

/**
 * 要求调用方**持有凭据**（ADR-0035）：CLI 进程里解析出的 API key 才算。
 *
 * 与 `ownedProcedure` 只差一格——谁认证的。两种调用方被挡在门外：
 *
 * - **网页会话**：`/api/trpc` 对任何已登录会话都开放，所以"网页里没有这个入口"
 *   挡不住它。放行等于让一个会话把自己续成新的长期 token，ADR-0035 的
 *   「只有持有该身份凭据的一方可签发」就只是注释。
 * - **`FATEBOOK_AGENT_USER_EMAIL`**：那是**身份选择器**（ADR-0021），不是秘密；
 *   本机任何进程设了这个变量都能以该身份跑命令。它证明得了身份，证明不了持有。
 *
 * 判据放在原语层而不是某个 procedure 的 body 里：这是一个会再次出现的区别
 * （"只有持凭据者能做"），定义一次比每次重判便宜。
 */
export const credentialProcedure = ownedProcedure.use(({ ctx, next }) => {
  if (ctx.authentication !== "credential") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "该动作要求持有凭据（API key）：网页会话证明的是登录状态，FATEBOOK_AGENT_USER_EMAIL 证明的是身份，两者都不是凭据（ADR-0021 / ADR-0035）。",
    })
  }
  return next()
})
