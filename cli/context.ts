import fs from "node:fs"
import prisma from "../lib/prisma"
import { appRouter } from "../lib/web/app_router"
import { getUserByApiKeyOrThrow } from "../lib/web/question_router"
import type { Authentication, Context } from "../lib/web/context"
import { CliError } from "./args"

/**
 * 解析身份并构造 tRPC caller（ADR-0015、ADR-0021、ADR-0026）。
 *
 * 刻意走 `createCaller` 而非另写一条 Prisma 直连路径：校验与业务逻辑只有一份，
 * CLI 只是第二个传输层。这要求 `trpc_base` 不依赖 Next.js 的认证适配器——
 * 见 `lib/web/context.ts` 的注释。
 *
 * 身份来源按 ADR-0026 的优先级：`--api-key` > `ASSAY_AGENT_API_KEY` >
 * 遗留的 `ASSAY_AGENT_USER_EMAIL`。CLI 不在磁盘上记"当前身份"：每条命令自带。
 */
// 类型与判据都在叶子模块里：这个文件 import prisma，被它拖进来的东西都跑不了
// 纯单测（见 `credential_source.ts` 的注释）。
import type { CredentialSource } from "./credential_source"

export type AgentSession = {
  agent: ReturnType<typeof appRouter.createCaller>["agent"]
  decision: ReturnType<typeof appRouter.createCaller>["decision"]
  tags: ReturnType<typeof appRouter.createCaller>["tags"]
  userId: string
  email: string
  credentialSource: CredentialSource
}

function callerFor(userId: string | undefined, authentication: Authentication) {
  // CLI 没有 HTTP 请求，因此没有 NextAuth session；所有过程都只读取 `ctx.userId`
  // 与 `ctx.authentication`（见 trpc_base 的 ownedProcedure / credentialProcedure），
  // 所以把 session 置 null 是真实语义而非占位。
  // `Context.session` 本就允许 null，这里不需要断言。
  const ctx: Context = { session: null, userId, authentication }
  return appRouter.createCaller(ctx)
}

/**
 * 凭据文件（ADR-0036）：`ASSAY_AGENT_API_KEY_FILE=<路径>`。
 *
 * 加它的理由不是"多一种配置"，而是**秘密不该出现在命令行**：`--api-key` 会进
 * `ps` 与 shell 历史。文件方式让"这台机器上的这个进程是哪个身份"有一个可写进
 * 服务单元（systemd / launchd）的位置。
 *
 * 文件里的空白一律丢掉（末尾换行、编辑器补的空行）：那是格式，不是凭据的一部分。
 * 读不到、或读出来是空的，都**当场失败**——静默回退到别处的身份，正是 ADR-0036
 * 要防的那种"我以为我是 alice，其实是 bob"。
 */
function readApiKeyFile(path: string): string {
  let raw: string
  try {
    raw = fs.readFileSync(path, "utf8")
  } catch {
    throw new CliError(
      `读不到凭据文件：${path}`,
      "检查 ASSAY_AGENT_API_KEY_FILE 指向的路径；文件里应当只有一把钥匙。",
    )
  }

  const key = raw.trim()
  if (key === "") {
    throw new CliError(
      `凭据文件是空的：${path}`,
      "里面应当只有一把钥匙（末尾换行无所谓）。",
    )
  }
  return key
}
/**
 * 凭据解析只做一次（ADR-0026 + ADR-0036）：返回「哪把钥匙」**和**「它从哪来」。
 *
 * 早先这里先算出一个 `apiKey`，再在返回值里按同样的三元链把来源重述一遍——两条
 * 并列的阶梯，改一处就会让 `whoami` 报出来的来源与实际用的钥匙不是同一把，而且
 * 没有任何症状。返回 `null` = 这次没有凭据（走身份选择器）。
 *
 * 优先级：`--api-key` > `ASSAY_AGENT_API_KEY` > `ASSAY_AGENT_API_KEY_FILE`。
 * 用"是否给出"（`!== undefined`）而不是真值判断：**空串是显式压制**——`dotenv`
 * 不覆盖已存在的键，所以 `ASSAY_AGENT_API_KEY=""` 能挡住 `.env` 里的值
 * （e2e 靠这条走邮箱路径），此时也不该再往下找凭据文件。
 *
 * 空白路径 = **没设**，而不是"去读一个叫 '' 的文件"：服务单元（systemd / launchd）
 * 的模板里留空一个可选路径是常事，那不该变成一个看不出原因的「读不到凭据文件：」。
 */
function resolveApiKey(
  flagKey: string | undefined,
): { key: string; source: CredentialSource } | null {
  if (flagKey !== undefined) {
    return flagKey === "" ? null : { key: flagKey, source: "api-key-flag" }
  }

  const envKey = process.env.ASSAY_AGENT_API_KEY
  if (envKey !== undefined) {
    return envKey === "" ? null : { key: envKey, source: "api-key-env" }
  }

  const keyFilePath = (process.env.ASSAY_AGENT_API_KEY_FILE ?? "").trim()
  if (keyFilePath === "") return null
  return { key: readApiKeyFile(keyFilePath), source: "api-key-file" }
}

export async function createAgentSession(
  options: { apiKey?: string } = {},
): Promise<AgentSession> {
  const resolved = resolveApiKey(options.apiKey)

  if (resolved) {
    const { key, source } = resolved
    let user
    try {
      user = await getUserByApiKeyOrThrow(key)
    } catch {
      throw new CliError(
        "凭据无效：没有身份持有这把钥匙",
        "用 `whoami` 确认当前身份；需要新身份就用 `init`，需要换钥匙就去 Web 的 /api-setup。",
      )
    }
    // `credential`：这条路径说明本进程手里真的有钥匙——签发配对码只认这种（ADR-0035）。
    const caller = callerFor(user.id, "credential")
    return {
      agent: caller.agent,
      decision: caller.decision,
      tags: caller.tags,
      userId: user.id,
      email: user.email,
      credentialSource: source,
    }
  }

  const email = process.env.ASSAY_AGENT_USER_EMAIL
  if (!email) {
    throw new CliError(
      "没有可用身份：既没给凭据，也没设 ASSAY_AGENT_USER_EMAIL",
      "设 ASSAY_AGENT_API_KEY=<钥匙>（推荐，或 ASSAY_AGENT_API_KEY_FILE=<路径> 以免进 shell 历史），或 ASSAY_AGENT_USER_EMAIL=<已有账号的邮箱>（遗留）。",
    )
  }

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    throw new CliError(
      `找不到邮箱为 ${email} 的账号`,
      "用 `init` 建一个身份，或把 ASSAY_AGENT_USER_EMAIL 改成已存在的邮箱。",
    )
  }

  // `identity-selector`：这条路径没有任何秘密——只要谁设了这个变量就能以该身份跑
  // 命令（ADR-0021 的本机信任模型）。所以它够做业务动作，但**签不出配对码**（ADR-0035）。
  const caller = callerFor(user.id, "identity-selector")
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
  const caller = callerFor(undefined, "none")
  return { agent: caller.agent, decision: caller.decision, tags: caller.tags }
}
