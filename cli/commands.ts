import type { appRouter } from "../lib/web/app_router"
import { log } from "../lib/_log"
import {
  Args,
  auditContext,
  CliError,
  hasFlag,
  invokedByAgent,
  optionalNumber,
  optionalProbability,
  optionalString,
  requireDate,
  requireString,
} from "./args"
import { isCredentialSource } from "./credential_source"
import type { CredentialSource } from "./credential_source"
// 唯一的例外：一个**没有副作用**的叶子模块（只 import node:crypto）。配对开关的
// 判定必须与 Web 侧共用同一处定义，而它不碰 prisma / next，所以不会把
// appRouter 的运行时依赖链拽进来。
import {
  PAIRING_LOGIN_ENV,
  isPairingLoginEnabled,
} from "../lib/web/pairing_flag"

/**
 * 运行时导入只有一个**无副作用的叶子模块**（`lib/web/pairing_flag`，见下方注释）：
 * 其余一律类型导入，测试才能注入假 caller 而不触发 appRouter 的运行时依赖链。
 *
 * 这里刻意从 `appRouter` 而不是 `agentRouter` 提取类型——tRPC 的嵌套 caller
 * 在挂载到父路由时会重新装饰，两者类型实例不等价（TS2719）。从实际调用点
 * 提取才能保证类型同一。
 */
export type AgentApi = ReturnType<typeof appRouter.createCaller>["agent"]
export type DecisionApi = ReturnType<typeof appRouter.createCaller>["decision"]
export type TagsApi = ReturnType<typeof appRouter.createCaller>["tags"]

export type CommandContext = {
  agent: AgentApi
  decision: DecisionApi
  tags: TagsApi
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

/** `--bucket` 暴露给人/agent 的写法 → 简报里的分桶名（ADR-0039）。 */
const BUCKET_FLAGS = {
  overdue: "overdue",
  "1w": "within1w",
  "1m": "within1m",
  "1m+": "beyond1m",
} as const

function optionalBriefBucket(
  args: Args,
): (typeof BUCKET_FLAGS)[keyof typeof BUCKET_FLAGS] | undefined {
  const raw = optionalString(args, "bucket")
  if (raw === undefined) return undefined
  const bucket = BUCKET_FLAGS[raw as keyof typeof BUCKET_FLAGS]
  if (bucket === undefined) {
    throw new CliError(
      `--bucket 只能是 ${Object.keys(BUCKET_FLAGS).join(" / ")} 之一，收到：${raw}`,
    )
  }
  return bucket
}

/**
 * `--tags a,b` → 领域名数组（ADR-0030）。
 *
 * 旗标名沿用 ADR-0030 §七 的说法（它讲的就是"`--tags` 里出现库里没有的词"）。
 * 只去掉外层空白，**不做任何其它清洗**：带空格、纯数字、空层级这些非法名字
 * 由服务端的领域规则拒绝。"帮你改成差不多的名字"正是这条 ADR 要防的事。
 */
function parseDomains(args: Args): string[] {
  return (optionalString(args, "tags") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
}

export const commands: Command[] = [
  {
    name: "brief",
    summary:
      "状态简报（ADR-0039）：未结算总数与到期分布、最近 3 条、清单有未记录条目（可救/已冻结）、未标领域、未背书、无预测的决策，每栏带下钻命令",
    usage: "brief [--now <ISO>]",
    run: (args, { agent }) =>
      agent.brief({
        now:
          optionalString(args, "now") === undefined
            ? undefined
            : requireDate(args, "now"),
      }),
  },
  {
    name: "list-due",
    summary:
      "到期队列：可结算 / 悬空未结算两栏 + 未标领域计数；--bucket 下钻到未来分桶时，未到期的项在 upcoming 栏",
    usage: "list-due [--limit N] [--now <ISO>] [--bucket overdue|1w|1m|1m+]",
    run: (args, { agent }) =>
      agent.listDue({
        limit: optionalNumber(args, "limit"),
        // 分桶下钻（ADR-0039）：与简报 seeAlso 里的 --bucket 写法一一对应。
        bucket: optionalBriefBucket(args),
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
      "create-prediction --title T --resolve-by <ISO> --criteria C [--oracle-kind K] [--anchor A] [--probability P] [--note N] [--decision-id ID] [--stated-by-owner | --agent-collected]",
    run: (args, { agent }) => {
      const oracleKind =
        oneOf(
          optionalString(args, "oracle-kind"),
          ORACLE_KINDS,
          "oracle-kind",
        ) ?? "PUBLIC_FACT"
      // ADR-0024：来源的**默认方向按调用上下文**——agent 代跑时默认“待背书”
      // （数字可能是它自己取得的），人自己在终端里敲时默认“数字由当事人给出”、
      // 天然已背书。两个 flag 是显式声明，永远是权威；同时给出则拒绝，
      // 因为那说明调用方自己没想清楚这个数字是谁说的。
      const saysOwner = hasFlag(args, "stated-by-owner")
      const saysAgent = hasFlag(args, "agent-collected")
      if (saysOwner && saysAgent) {
        throw new CliError(
          "--stated-by-owner 与 --agent-collected 互斥：这个数字只可能有一个来源",
        )
      }
      let statedByOwner = !invokedByAgent()
      if (saysOwner) {
        statedByOwner = true
      }
      if (saysAgent) {
        statedByOwner = false
      }
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
        statedByOwner,
        // 审计线索（ADR-0027）：发起方类别与会话标识分开存，"来自会话却自称数字
        // 由当事人给出"才能被筛出来对质。
        ...auditContext(),
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
    name: "list-audit-records",
    summary: "列出记录及其调用上下文（ADR-0027），用于对质来源声明",
    usage:
      "list-audit-records [--only-owner-claims] [--limit N]\n  --only-owner-claims：只看“来自 agent 会话、却声明数字由当事人给出”的那些",
    run: (args, { agent }) =>
      agent.listAuditRecords({
        onlyAgentSessionOwnerClaims: hasFlag(args, "only-owner-claims"),
        limit: optionalNumber(args, "limit") ?? 50,
      }),
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
      "create-decision --statement <陈述> [--action <做什么>] [--action-due <ISO>] [--reasoning <理由>] [--expected-outcome <预期>] [--known-info <当时已知>] [--unknown-info <当时未知>] [--tags 投资/宏观,投资/公司业绩-Q3]",
    run: (args, { decision }) =>
      decision.create({
        statement: requireString(args, "statement"),
        // ADR-0041：动作与承诺时点必须在决策当时写下
        action: optionalString(args, "action"),
        actionDueAt:
          optionalString(args, "action-due") === undefined
            ? undefined
            : requireDate(args, "action-due"),
        reasoning: optionalString(args, "reasoning"),
        expectedOutcome: optionalString(args, "expected-outcome"),
        knownInfo: optionalString(args, "known-info"),
        unknownInfo: optionalString(args, "unknown-info"),
        domains: parseDomains(args),
      }),
  },
  {
    name: "attach-prediction",
    summary: "把一条预测挂到决策上（一条预测至多属一个决策）",
    usage: "attach-prediction --decision-id ID --question-id ID",
    /**
     * 挂接后把可核到的清单事实**说出来**（ADR-0038 第五点）。
     *
     * 接口原本就返回了 `rubricSuggestions`，但没有任何一处读它——那个字段等于没有。
     * 提示走 stderr、只问不填：分值的唯一写手仍是 `set-rubric`。
     */
    run: async (args, { decision }) => {
      // 决策 id 从参数取，不从返回值取：`attachPrediction` 返回的是**这条预测**
      // （`prisma.question.update` 的结果），它的 `id` 是 question id。拿它去拼
      // `--decision-id` 会让提示里的命令必然报“找不到该决策”。
      const decisionId = requireString(args, "decision-id")
      const attached = await decision.attachPrediction({
        decisionId,
        questionId: requireString(args, "question-id"),
      })

      for (const suggestion of attached.rubricSuggestions ?? []) {
        log(
          `提示：清单条目「${suggestion.itemKey}」看起来在库里已成立（${suggestion.evidence}）。` +
            `要记下来吗？→ set-rubric --decision-id ${decisionId} --done ${suggestion.itemKey}`,
        )
      }

      return attached
    },
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
      "补充/修改决策叙事（揭晓前）：补写空白字段自由，改写已填写内容须带 --reason（ADR-0012）；揭晓后一律拒绝，事后表达用 record-reflection（ADR-0037）",
    usage:
      'update-narrative --decision-id ID [--action A|""] [--action-due D|""] [--statement S] [--reasoning R] [--expected-outcome E] [--known-info K] [--unknown-info U] [--reason REASON]（空串 = 清空该字段）',
    run: (args, { decision }) =>
      decision.updateNarrative({
        decisionId: requireString(args, "decision-id"),
        // ADR-0041：动作是"当初的记录"的一半，与叙事同一条留痕/冻结规则
        action: optionalString(args, "action"),
        // `--action-due ""` = 显式清空（撤销承诺时点）。没有这个写法时，"清空动作"
        // 会被守卫要求同时清空时点，而那在 CLI 里做不到——一条照着做做不到的指引。
        actionDueAt: (() => {
          const raw = optionalString(args, "action-due")
          if (raw === undefined) return undefined
          return raw === "" ? null : requireDate(args, "action-due")
        })(),
        statement: optionalString(args, "statement"),
        reasoning: optionalString(args, "reasoning"),
        expectedOutcome: optionalString(args, "expected-outcome"),
        knownInfo: optionalString(args, "known-info"),
        unknownInfo: optionalString(args, "unknown-info"),
        reason: optionalString(args, "reason"),
      }),
  },
  {
    name: "record-execution",
    summary:
      "记录执行事实（ADR-0041）：只增不改；--abandoned 表示明确放弃（不是「一直没做」）",
    usage:
      "record-execution --decision-id ID [--abandoned] [--at <ISO>] [--note 备注]",
    run: (args, { decision }) =>
      decision.recordExecution({
        decisionId: requireString(args, "decision-id"),
        kind: hasFlag(args, "abandoned") ? "ABANDONED" : "EXECUTED",
        occurredAt:
          optionalString(args, "at") === undefined
            ? undefined
            : requireDate(args, "at"),
        note: optionalString(args, "note"),
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
    name: "record-reflection",
    summary:
      "写一条复盘记录（ADR-0037）：只增不改、独立成栏；结算后写事后想法用它，不要改叙事字段",
    usage: "record-reflection --decision-id ID --text 内容",
    run: (args, { decision }) =>
      decision.recordReflection({
        decisionId: requireString(args, "decision-id"),
        body: requireString(args, "text"),
      }),
  },
  {
    name: "list-decisions",
    summary:
      "列出全部决策（与 Web 的 /decisions 同口径）；--rubric-missing 只列清单有未记录条目的；--action-overdue 只列承诺到期未执行的",
    usage: "list-decisions [--limit N] [--rubric-missing] [--action-overdue]",
    run: (args, { decision }) =>
      decision.list({
        limit: optionalNumber(args, "limit"),
        rubricMissing: hasFlag(args, "rubric-missing") || undefined,
        actionOverdue: hasFlag(args, "action-overdue") || undefined,
      }),
  },
  {
    name: "add-domain",
    summary:
      "新增一个领域词（幂等。这是唯一的造词入口——未知领域不会被静默创建，ADR-0030 §七）",
    usage: "add-domain --name <领域名>",
    run: (args, { tags }) =>
      tags.addDomain({ name: requireString(args, "name") }),
  },
  {
    name: "list-domains",
    summary: "列出领域词表与各自引用数（补齐未标的依据）",
    usage: "list-domains",
    run: (_args, { tags }) => tags.listDomains(),
  },
  {
    name: "domain-report",
    summary:
      "领域读数（ADR-0032/0033）：样本数、悬空计数、校准、分辨率、技能分与区间；N<5 只给前两项，5≤N<20 加校准与分辨率，N≥20 才给技能分与区间",
    usage: "domain-report --prefix 投资/宏观",
    run: (args, { tags }) =>
      tags.domainReport({ prefix: requireString(args, "prefix") }),
  },
  {
    name: "retag-decision",
    summary:
      "改一条决策的领域：补齐（原先没领域）自由，重标（改已标过的）必须带 --reason（ADR-0030 §三）",
    usage: "retag-decision --decision-id ID --tags a,b [--reason REASON]",
    run: (args, { tags }) =>
      tags.setDecisionDomains({
        decisionId: requireString(args, "decision-id"),
        domains: parseDomains(args),
        reason: optionalString(args, "reason"),
      }),
  },
  {
    name: "list-untagged-decisions",
    summary: "列出尚无领域的决策（新→旧，供补齐时选择）",
    usage: "list-untagged-decisions [--limit N]",
    run: (args, { tags }) =>
      tags.listUntaggedDecisions({ limit: optionalNumber(args, "limit") }),
  },
  {
    name: "rename-domain",
    summary: "改领域名（必须给 --reason 留痕），并报出受影响的决策数与预测数",
    usage: "rename-domain --from <旧名> --to <新名> --reason <理由>",
    run: (args, { tags }) =>
      tags.renameDomain({
        from: requireString(args, "from"),
        to: requireString(args, "to"),
        reason: requireString(args, "reason"),
      }),
  },
  {
    name: "delete-domain",
    summary: "删除一个零引用的领域词（有引用即拒绝：删已引用的等于改写历史）",
    usage: "delete-domain --name <领域名>",
    run: (args, { tags }) =>
      tags.deleteDomain({ name: requireString(args, "name") }),
  },
  {
    name: "record-resolution-source",
    summary:
      "给一条**已结算但悬空**的题补录可核查来源，使该题所有预测计入（ADR-0031 §五）",
    usage:
      "record-resolution-source --question-id ID --source <来源> [--rationale 理由] [--reason 改口径的理由]",
    run: (args, { agent }) =>
      agent.recordResolutionSource({
        questionId: requireString(args, "question-id"),
        source: requireString(args, "source"),
        rationale: optionalString(args, "rationale"),
        reason: optionalString(args, "reason"),
      }),
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
    name: "issue-pairing-code",
    summary:
      "签发一次性配对码：在本机浏览器把它换成该身份的网页会话（ADR-0035；默认关闭）",
    usage: "issue-pairing-code",
    // 三道检查，每一道都有理由：
    // 1. **凭据**（ADR-0035）：签发是"持有凭据者"的动作。`ASSAY_AGENT_USER_EMAIL`
    //    只是身份选择器（不含秘密，谁设了都能以该身份跑命令），签不了码。过程层的
    //    `credentialProcedure` 是真正的门禁；这里这一次只为给出可读的提示。
    // 2. **开关**：关着的时候签出来的码兑不了，而人要到浏览器里才发现。
    // 3. 过程层还会再判一次同两个判据——那一层是为 `/api/trpc`（网页会话也能打）准备的。
    // 各层共用同一份定义（`lib/web/{pairing_flag,context}`），不各自猜。
    run: async (_args, { agent, credentialSource }) => {
      if (!isCredentialSource(credentialSource)) {
        throw new CliError(
          "签发配对码要求持有凭据（API key）",
          "ASSAY_AGENT_USER_EMAIL 只是身份选择器，不含秘密，证明不了「持有」（ADR-0021 / ADR-0035）。用 `whoami` 看当前来源；改成 ASSAY_AGENT_API_KEY 或 ASSAY_AGENT_API_KEY_FILE 再签发。",
        )
      }
      if (!isPairingLoginEnabled(process.env)) {
        throw new CliError(
          "配对码登录当前是关闭的",
          `在 .env 里设 ${PAIRING_LOGIN_ENV}=1 并重启 Web 服务。它默认关闭是刻意的（ADR-0035）：不能由 NODE_ENV 推断。`,
        )
      }
      const issued = await agent.issuePairingCode()
      return { ...issued, redeemUrl: pairingRedeemUrl(process.env) }
    },
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

/**
 * 兑换页的地址——人下一步要打开的那一页。基址取 `HOST_URL`（仓库里既有的"网页基址"），
 * 本地默认 `http://localhost:3000`。**不**回退到 `NEXTAUTH_URL`：它指向 `/api/auth`，
 * 不是站点根，拼出来的链接会 404。
 */
export function pairingRedeemUrl(
  env: Record<string, string | undefined>,
): string {
  const base = env.HOST_URL?.trim() || "http://localhost:3000"
  return `${base.replace(/\/+$/, "")}/pair`
}
