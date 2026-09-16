/**
 * CLI 的参数解析与输出约定。
 *
 * 约定（对 Agent 是公开契约）：**stdout 只放数据（JSON），日志一律走 stderr**。
 * 这样 `agent list-due | jq` 之类的管道永远可用，不会被日志污染。
 */

export class CliError extends Error {
  readonly hint?: string

  constructor(message: string, hint?: string) {
    super(message)
    this.name = "CliError"
    this.hint = hint
  }
}

export type Args = {
  positional: string[]
  flags: Record<string, string | boolean>
}

export function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith("--")) {
      positional.push(token)
      continue
    }
    const body = token.slice(2)
    const eq = body.indexOf("=")
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith("--")) {
      flags[body] = next
      i++
    } else {
      flags[body] = true
    }
  }

  return { positional, flags }
}

export function requireString(args: Args, key: string): string {
  const value = args.flags[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new CliError(`缺少必填参数 --${key}`)
  }
  return value
}

export function optionalString(args: Args, key: string): string | undefined {
  const value = args.flags[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new CliError(`--${key} 需要一个值`)
  return value
}

export function optionalNumber(args: Args, key: string): number | undefined {
  const raw = optionalString(args, key)
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new CliError(`--${key} 需要一个数字，收到：${raw}`)
  }
  return parsed
}

export function hasFlag(args: Args, key: string): boolean {
  return args.flags[key] === true
}

/** 接受 ISO 字符串或 `YYYY-MM-DD`。 */
export function requireDate(args: Args, key: string): Date {
  const raw = requireString(args, key)
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    throw new CliError(
      `--${key} 不是合法日期：${raw}`,
      "用 ISO 8601（例如 2026-03-01T00:00:00Z）或 YYYY-MM-DD。",
    )
  }
  return parsed
}

/**
 * 概率既接受 0–1 的小数，也接受 `70%` 这种写法。
 * 超过 1 的裸数字直接报错——`0.7` 与 `70` 混淆过一次就够贵了。
 */
export function optionalProbability(
  args: Args,
  key: string,
): number | undefined {
  const raw = optionalString(args, key)
  if (raw === undefined) return undefined

  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new CliError(`--${key} 需要一个概率，收到空值`)
  }

  const percentNotation = trimmed.endsWith("%")
  const digits = percentNotation ? trimmed.slice(0, -1).trim() : trimmed
  // 注意：不能直接用 Number("")——它等于 0，会把空值/裸 "%" 变成「0% 几乎确定不发生」。
  if (digits.length === 0) {
    throw new CliError(`--${key} 需要一个概率，收到：${raw}`)
  }

  const value = percentNotation ? Number(digits) / 100 : Number(digits)

  if (!Number.isFinite(value)) {
    throw new CliError(`--${key} 需要一个概率，收到：${raw}`)
  }
  if (value < 0 || value > 1) {
    throw new CliError(
      `--${key} 必须在 0–1 之间（或用百分比写法如 70%），收到：${raw}`,
      "本系统内部一律用 0–1 的小数表示概率。",
    )
  }
  return value
}

let emittingJson = false

/**
 * 在 CLI 边界装一道 stdout 守卫：**除 `emitJson` 外的任何写入都当场报错**。
 *
 * stdout 是 Agent 的数据通道（ADR-0015）。没有这道守卫时，污染会以"下游
 * `JSON.parse` 神秘失败"的形式出现在很远的地方——npm 的横幅与 `console.log`
 * 都这样漏过一次。CLI 可达的代码请用 `lib/_log.ts` 的 `log`（走 stderr）。
 */
export function installStdoutGuard(): void {
  const rawWrite = process.stdout.write.bind(process.stdout) as (
    chunk: unknown,
    ...rest: unknown[]
  ) => boolean

  // SAFETY: `process.stdout.write` 的官方签名是重载的 `(chunk, encoding?, cb?)`，
  // 无法用单一非重载函数表达。这里把守卫声明成 `(chunk, ...rest)` 并原样转发给
  // 绑定后的原函数，运行时行为与签名一致——TS 无法验证的只是这层等价。
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (!emittingJson) {
      throw new Error(
        `CLI 的 stdout 只允许 emitJson 写入，却收到非数据内容（ADR-0015）：${String(
          chunk,
        ).slice(0, 200)}`,
      )
    }
    return rawWrite(chunk, ...rest)
  }) as unknown as typeof process.stdout.write
}

export function emitJson(data: unknown): void {
  emittingJson = true
  try {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
  } finally {
    emittingJson = false
  }
}

/**
 * 调用上下文是不是"agent 在代跑"（ADR-0024）。
 *
 * 标记由 agent 运行时注入子进程环境（pi 设 `AI_AGENT` 与 `PI_CODING_AGENT`），
 * 子进程继承。它只决定来源的**默认方向**，不构成权威——权威是命令里的显式声明
 * （`--stated-by-owner` / `--agent-collected`）。脚本与 cron 不设标记，因此默认按
 * "人在终端里敲"处理。
 *
 * 刻意不做更聪明的推断（例如"stdin 不是 tty 就当成 agent"）：推断错的方向恰好是
 * "把 agent 的数字当成当事人的"，而那正是这道判据要防的事。
 */
export function invokedByAgent(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.AI_AGENT || env.PI_CODING_AGENT)
}

/** 审计线索（ADR-0027）：发起方类别 + 会话标识。 */
export type AuditContext = {
  initiator: "HUMAN" | "AGENT"
  agentSessionId?: string
}

/**
 * 取本次调用的审计线索。**只取标识，绝不取会话正文**——正文在 pi 的会话文件里
 * （`PI_SESSION_FILE`），一旦复制进库，容量、隐私与清理责任会一起进来，而审计
 * 只需要能定位到那个会话。
 *
 * 它存在的理由：让"这条记录自称是人给的"事后**可对质**。没有它，ADR-0024 的
 * 默认方向就只是一次不可复查的自我申报。
 */
export function auditContext(
  env: Record<string, string | undefined> = process.env,
): AuditContext {
  return {
    initiator: invokedByAgent(env) ? "AGENT" : "HUMAN",
    agentSessionId: env.PI_SESSION_ID,
  }
}
