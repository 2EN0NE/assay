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
import type { CredentialSource } from "./context"

/**
 * 只用类型导入：测试可以注入假 caller，不触发 appRouter 的运行时依赖链。
 *
 * 这里刻意从 `appRouter` 而不是 `agentRouter` 提取类型——tRPC 的嵌套 caller
 * 在挂载到父路由时会重新装饰，两者类型实例不等价（TS2719）。从实际调用点
 * 提取才能保证类型同一。
 */
export type AgentApi = ReturnType<typeof appRouter.createCaller>["agent"]
export type DecisionApi = ReturnType<typeof appRouter.createCaller>["decision"]

export type CommandContext = {
  agent: AgentApi
  decision: DecisionApi
  userId: string
  email: string
  credentialSource: CredentialSource
}

export type Command = {
  name: string
  summary: string
  usage: string
  /** 该命令自己解决身份（目前只有 init）：在身份存在之前运行。 */
  withoutIdentity?: boolean
  run: (args: Args, ctx: CommandContext) => unknown | Promise<unknown>
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

/**
 * `--done a,b --not-done c` → 清单条目数组。
 *
 * 用逗号分隔而不是可重复的 `--item`：清单条目是个位数量级的固定集合，一次传完
 * 更贴近"决策当时一次问完"的实际用法，也不需要新增参数解析原语。
 */
function parseRubricEntries(
  args: Args,
): { itemKey: string; status: "DONE" | "NOT_DONE" }[] {
  const split = (value: string | undefined): string[] =>
    (value ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key !== "")

  const done = split(optionalString(args, "done")).map((itemKey) => ({
    itemKey,
    status: "DONE" as const,
  }))
  const notDone = split(optionalString(args, "not-done")).map((itemKey) => ({
    itemKey,
    status: "NOT_DONE" as const,
  }))

  return [...done, ...notDone]
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
      "create-prediction --title T --resolve-by <ISO> --criteria C [--oracle-kind K] [--anchor A] [--probability P] [--note N] [--decision-id ID] [--agent-collected]",
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
        // 过程层支持"创建时就归属决策"（ADR-0019），CLI 这一层必须同样暴露——
        // 否则 Agent 走 CLI 只能"先建后挂"，而未知 flag 会被静默忽略。
        decisionId: optionalString(args, "decision-id"),
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
  {
    name: "create-decision",
    summary: "创建一个决策：承载决策时点的推理过程（ADR-0001 / 0019）",
    usage:
      "create-decision --statement <陈述> [--reasoning <理由>] [--expected-outcome <预期>] [--known-info <当时已知>] [--unknown-info <当时未知>]",
    run: (args, { decision }) =>
      decision.create({
        statement: requireString(args, "statement"),
        reasoning: optionalString(args, "reasoning"),
        expectedOutcome: optionalString(args, "expected-outcome"),
        knownInfo: optionalString(args, "known-info"),
        unknownInfo: optionalString(args, "unknown-info"),
      }),
  },
  {
    name: "attach-prediction",
    summary: "把一条预测挂到决策上（一条预测至多属一个决策）",
    usage: "attach-prediction --decision-id ID --question-id ID",
    run: (args, { decision }) =>
      decision.attachPrediction({
        decisionId: requireString(args, "decision-id"),
        questionId: requireString(args, "question-id"),
      }),
  },
  {
    name: "set-rubric",
    summary: "写入清单条目的完成情况（ADR-0016），返回重算后的完成度",
    usage:
      "set-rubric --decision-id ID [--done 键1,键2] [--not-done 键3]（条目键用 show-decision 查）",
    run: (args, { decision }) =>
      decision.setRubric({
        decisionId: requireString(args, "decision-id"),
        entries: parseRubricEntries(args),
      }),
  },
  {
    name: "update-narrative",
    summary:
      "补充/修改决策叙事：补写空白字段自由，改写已填写内容须带 --reason（ADR-0012）",
    usage:
      "update-narrative --decision-id ID [--statement S] [--reasoning R] [--expected-outcome E] [--known-info K] [--unknown-info U] [--reason REASON]",
    run: (args, { decision }) =>
      decision.updateNarrative({
        decisionId: requireString(args, "decision-id"),
        statement: optionalString(args, "statement"),
        reasoning: optionalString(args, "reasoning"),
        expectedOutcome: optionalString(args, "expected-outcome"),
        knownInfo: optionalString(args, "known-info"),
        unknownInfo: optionalString(args, "unknown-info"),
        reason: optionalString(args, "reason"),
      }),
  },
  {
    name: "detach-prediction",
    summary: "把一条预测从它所属的决策上解绑（已结算的仍拒绝：锁定不可回退）",
    usage: "detach-prediction --question-id ID",
    run: (args, { decision }) =>
      decision.detachPrediction({
        questionId: requireString(args, "question-id"),
      }),
  },
  {
    name: "show-decision",
    summary: "读回复盘材料：叙事 + 清单完成度 + 各预测的结算与分数",
    usage: "show-decision --decision-id ID",
    run: (args, { decision }) =>
      decision.byId({ decisionId: requireString(args, "decision-id") }),
  },
  {
    name: "list-decisions",
    summary: "列出全部决策（与 Web 的 /decisions 同口径）",
    usage: "list-decisions [--limit N]",
    run: (args, { decision }) =>
      decision.list({ limit: optionalNumber(args, "limit") }),
  },
  {
    name: "whoami",
    summary: "打印当前身份与凭据来源（Agent 自检用）",
    usage: "whoami",
    run: (_args, { userId, email, credentialSource }) => ({
      userId,
      email,
      credentialSource,
    }),
  },
  {
    name: "init",
    summary: "建一个新身份并打印其凭据（不需要邮件；ADR-0022）",
    usage: "init [--label NAME] [--allow-create-user]",
    withoutIdentity: true,
    // 动态 import：本文件顶层必须保持"只用类型导入"，否则注入假 caller 的测试
    // 会被拽进 appRouter 的运行时依赖链（见文件顶部注释）。init 需要 prisma，
    // 所以只在真跑这条命令时加载它。
    run: async (args) => {
      const { initOwner } = await import("./init")
      return initOwner({
        label: optionalString(args, "label") ?? "owner",
        allowCreateUser: hasFlag(args, "allow-create-user"),
      })
    },
  },
]

export function findCommand(name: string): Command | undefined {
  return commands.find((command) => command.name === name)
}
