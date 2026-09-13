import type { appRouter } from "../lib/web/app_router"
import {
  Args,
  CliError,
  hasFlag,
  optionalNumber,
  optionalProbability,
  optionalString,
  requireDate,
  requireString,
} from "./args"

/**
 * 只用类型导入：测试可以注入假 caller，不触发 appRouter 的运行时依赖链。
 *
 * 这里刻意从 `appRouter` 而不是 `agentRouter` 提取类型——tRPC 的嵌套 caller
 * 在挂载到父路由时会重新装饰，两者类型实例不等价（TS2719）。从实际调用点
 * 提取才能保证类型同一。
 */
export type AgentApi = ReturnType<typeof appRouter.createCaller>["agent"]

export type CommandContext = {
  agent: AgentApi
  userId: string
  email: string
}

export type Command = {
  name: string
  summary: string
  usage: string
  run: (args: Args, ctx: CommandContext) => Promise<unknown>
}

const ORACLE_KINDS = ["PUBLIC_FACT", "AGENT_OBSERVABLE", "SELF_REPORT"] as const
const RESOLUTIONS = ["YES", "NO", "AMBIGUOUS"] as const
const PROPOSAL_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"] as const

function oneOf<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  key: string,
): T[number] | undefined {
  if (value === undefined) return undefined
  if (!allowed.includes(value)) {
    throw new CliError(
      `--${key} 只能是 ${allowed.join(" / ")} 之一，收到：${value}`,
    )
  }
  return value as T[number]
}

export const commands: Command[] = [
  {
    name: "list-due",
    summary: "列出已到期且未结算的预测（跟踪调用的主输入）",
    usage: "list-due [--limit N] [--now <ISO>]",
    run: (args, { agent }) =>
      agent.listDue({
        limit: optionalNumber(args, "limit"),
        now:
          optionalString(args, "now") === undefined
            ? undefined
            : requireDate(args, "now"),
      }),
  },
  {
    name: "list-open",
    summary: "列出全部未结算预测（含未到期；供定期巡检）",
    usage: "list-open [--limit N]",
    run: (args, { agent }) =>
      agent.listOpen({ limit: optionalNumber(args, "limit") }),
  },
  {
    name: "create-prediction",
    summary: "创建一条预测（可不给概率 = 尚未量化）",
    usage:
      "create-prediction --title T --resolve-by <ISO> --criteria C [--oracle-kind K] [--anchor A] [--probability P] [--note N] [--agent-collected]",
    run: (args, { agent }) => {
      const oracleKind =
        oneOf(
          optionalString(args, "oracle-kind"),
          ORACLE_KINDS,
          "oracle-kind",
        ) ?? "PUBLIC_FACT"
      return agent.createPrediction({
        title: requireString(args, "title"),
        resolveBy: requireDate(args, "resolve-by"),
        resolutionCriteria: requireString(args, "criteria"),
        oracleKind,
        scoringAnchor: optionalString(args, "anchor"),
        probability: optionalProbability(args, "probability"),
        note: optionalString(args, "note"),
        // ADR-0008：--agent-collected 表示这个数字是 Agent **自己取得**的，
        // 不是当事人说的；因此默认未背书，须经当事人背书才计入校准。
        // 不给这个 flag（默认）即「数字由当事人给出」——天然已背书。
        agentCollected: hasFlag(args, "agent-collected"),
      })
    },
  },
  {
    name: "endorse",
    summary: "背书一个预测值：此后才进入校准（ADR-0008）",
    usage: "endorse (--forecast-id ID | --question-id ID)",
    run: (args, { agent }) => {
      const forecastId = optionalNumber(args, "forecast-id")
      const questionId = optionalString(args, "question-id")
      if (forecastId === undefined && questionId === undefined) {
        throw new CliError("需要 --forecast-id 或 --question-id 之一")
      }
      return agent.endorse({ forecastId, questionId })
    },
  },
  {
    name: "list-unendorsed",
    summary: "列出未背书的预测值",
    usage: "list-unendorsed",
    run: (_args, { agent }) => agent.listUnendorsed(),
  },
  {
    name: "list-revisions",
    summary: "列出某条预测的判据 / 期限修订历史（ADR-0012）",
    usage: "list-revisions --question-id ID",
    run: (args, { agent }) =>
      agent.listRevisions({ questionId: requireString(args, "question-id") }),
  },
  {
    name: "settle",
    summary: "按判据层级结算或提出提案（ADR-0004）",
    usage:
      "settle --question-id ID --resolution YES|NO|AMBIGUOUS [--source S] [--rationale R]",
    run: (args, { agent }) => {
      const resolution = oneOf(
        requireString(args, "resolution"),
        RESOLUTIONS,
        "resolution",
      )
      return agent.settle({
        questionId: requireString(args, "question-id"),
        resolution: resolution!,
        source: optionalString(args, "source"),
        rationale: optionalString(args, "rationale"),
      })
    },
  },
  {
    name: "list-proposals",
    summary: "列出结算提案",
    usage: "list-proposals [--status PENDING|ACCEPTED|REJECTED]",
    run: (args, { agent }) => {
      const status =
        oneOf(optionalString(args, "status"), PROPOSAL_STATUSES, "status") ??
        "PENDING"
      return agent.listProposals({ status })
    },
  },
  {
    name: "decide-proposal",
    summary: "对提案拍板（接受即真正结算）",
    usage: "decide-proposal --proposal-id ID (--accept | --reject)",
    run: (args, { agent }) => {
      const accept = hasFlag(args, "accept")
      const reject = hasFlag(args, "reject")
      if (accept === reject) {
        throw new CliError("必须且只能给出 --accept 或 --reject 之一")
      }
      return agent.decideProposal({
        proposalId: requireString(args, "proposal-id"),
        accept,
      })
    },
  },
  {
    name: "list-deliveries",
    summary: "列出待触达项（拉取式，ADR-0017）",
    usage: "list-deliveries [--limit N]",
    run: (args, { agent }) =>
      agent.listPendingDeliveries({ limit: optionalNumber(args, "limit") }),
  },
  {
    name: "report-delivery",
    summary: "回报触达结果；发送失败请保持 PENDING（站内始终兜底）",
    usage:
      "report-delivery --notification-id ID --outcome DELIVERED|NOT_NEEDED [--channel C]",
    run: (args, { agent }) => {
      const outcome = oneOf(
        requireString(args, "outcome"),
        ["DELIVERED", "NOT_NEEDED"] as const,
        "outcome",
      )
      return agent.reportDelivery({
        notificationId: requireString(args, "notification-id"),
        outcome: outcome!,
        channel: optionalString(args, "channel"),
      })
    },
  },
]

export function findCommand(name: string): Command | undefined {
  return commands.find((command) => command.name === name)
}
