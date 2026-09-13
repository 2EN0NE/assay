import { initTRPC } from "@trpc/server"
import { OpenApiMeta } from "trpc-openapi"
import transformer from "trpc-transformer"
import type { Context } from "./context"

export type { Context }

const t = initTRPC.meta<OpenApiMeta>().context<Context>().create({
  transformer,
})

export const router = t.router
export const publicProcedure = t.procedure
