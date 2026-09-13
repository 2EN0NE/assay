import { log, warn } from "./_log"
import { PrismaClient } from "@prisma/client"

// Single instance across `next dev` reloads.
// Source: https://www.prisma.io/docs/guides/other/troubleshooting-orm/help-articles/nextjs-prisma-client-dev-practices#solution
// SAFETY: `global` 在开发模式下跨 HMR 复用模块，类型上无法表达"这里挂着一个
// PrismaClient"。赋值点紧跟在本文件下方，因此该断言的不变式由本文件自行维持。
const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * 诊断一律走 stderr。
 *
 * Prisma 默认把 `info` 写到 **stdout**。对 Web 无所谓，但对 agent CLI 是致命的：
 * CLI 的 stdout 是数据通道（"只放 JSON"是对 Agent 的公开契约，见 ADR-0015），
 * 一行 `prisma:info ...` 就足以让下游的 `JSON.parse` 崩掉。
 *
 * 改用 event 模式把"日志去哪儿"的决定权从库手里收回来。订阅必须写在创建处——
 * 一旦把参数标注成 `PrismaClient`，log 定义的泛型就丢了，`$on` 会退化成 `never`。
 */
function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { emit: "event", level: "info" },
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ],
  })

  client.$on("info", (event) => log(`prisma:info ${event.message}`))
  client.$on("warn", (event) => warn(`prisma:warn ${event.message}`))
  client.$on("error", (event) => log(`prisma:error ${event.message}`))

  return client
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient()

export default prisma
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
