import prisma from "../lib/prisma"
import { log } from "../lib/_log"
import {
  CliError,
  emitJson,
  installStdoutGuard,
  optionalString,
  parseArgs,
} from "./args"
import { commands, findCommand } from "./commands"
import { createAgentSession, createAnonymousSession } from "./context"

function printHelp(): void {
  const lines = [
    "nano-fatebook-agent CLI —— Agent 读写决策记录的入口（ADR-0015）",
    "",
    "用法：npm run --silent agent -- <command> [flags]",
    "",
    "命令：",
    ...commands.map(
      (command) => `  ${command.usage.padEnd(62)} ${command.summary}`,
    ),
    "",
    "约定：stdout 只输出 JSON（可直接管道给 jq）；日志一律走 stderr。",
    "身份来源（ADR-0026）：--api-key > FATEBOOK_AGENT_API_KEY > FATEBOOK_AGENT_USER_EMAIL。",
    "没有身份时：`init` 建一个（不需要邮件），用 `whoami` 看当前身份。",
    "",
    "注：不加 --silent 时 npm 会把自己的横幅写进 stdout，破坏上述约定。",
  ]
  // 帮助文本也走 stderr：stdout 是对 Agent 的数据通道（ADR-0015），不能混入非 JSON。
  log(lines.join("\n"))
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2)

  if (!name || name === "help" || name === "--help" || name === "-h") {
    printHelp()
    return
  }

  const command = findCommand(name)
  if (!command) {
    throw new CliError(
      `未知命令：${name}`,
      "运行 `npm run agent -- --help` 查看全部命令。",
    )
  }

  const args = parseArgs(rest)
  // 身份在每一条命令里自带（ADR-0026）：不从磁盘读"当前身份"。
  // `init` 例外——它必须在身份存在之前运行。
  const session = command.withoutIdentity
    ? {
        ...createAnonymousSession(),
        userId: "",
        email: "",
        credentialSource: "none" as const,
      }
    : await createAgentSession({ apiKey: optionalString(args, "api-key") })
  log(
    session.email
      ? `owner=${session.email} command=${command.name}`
      : `command=${command.name}`,
  )

  const result = await command.run(args, {
    agent: session.agent,
    decision: session.decision,
    tags: session.tags,
    userId: session.userId,
    email: session.email,
    credentialSource: session.credentialSource,
  })
  emitJson(result)
}

async function run(): Promise<void> {
  // stdout 是对 Agent 的数据通道（ADR-0015）：非 JSON 写入必须当场暴露，
  // 而不是变成下游 JSON.parse 的莫名其妙失败。
  installStdoutGuard()
  try {
    await main()
  } catch (error: unknown) {
    if (error instanceof CliError) {
      log(`❌ ${error.message}`)
      if (error.hint) log(`   ${error.hint}`)
    } else {
      log(`❌ ${error instanceof Error ? error.message : String(error)}`)
    }
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

void run()
