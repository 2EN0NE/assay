import { Forecast, Question } from "@prisma/client"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import prisma from "../prisma"
import { assertOwnedDecision } from "./decision_router"
import type { Prisma } from "@prisma/client"
import { propagateDecisionDomainsToQuestion } from "./domain_tags"
import { decideSettlement } from "./settlement_authority"
import {
  BRIEF_BUCKETS,
  BRIEF_SEE_ALSO,
  BriefBucket,
  bucketRangeOf,
  nearestDue,
  summarizeDue,
} from "./brief"
import { actionStateOf } from "./decision_action"
import { decisionLockOf, deriveRubricCompletion } from "./decision_rubric"
import { danglingReason, isDangling } from "./settlement_scope"
import { untaggedDecisionWhere } from "./domain_tags"
import { handleQuestionResolution, rescoreResolvedQuestion } from "./resolution"
import { credentialProcedure, ownedProcedure, router } from "./trpc_base"
import { issuePairingCode } from "./pairing_code_store"
import { PAIRING_LOGIN_ENV, isPairingLoginEnabled } from "./pairing_flag"

/**
 * Agent 面向的过程（见 ADR-0015）。
 *
 * 这一层同时服务两个调用方：agent CLI（`createCaller`）与 Web UI（tRPC）。
 * 因此它不是"只给 agent 用的私有 API"，而是"决策记录语义"的规范入口——
 * 校验规则只有一份，两个入口都必须遵守。
 *
 * 刻意不复用 `questionRouter.create`：那条路径承载的是人工录入的关注点
 * （分享、标签、邮件）。强制合并会需要在每个分支上加开关。这里只共享真正
 * 有逻辑密度的部分——结算走 `handleQuestionResolution`，计分走既有管道。
 */

const oracleKindSchema = z.enum([
  "PUBLIC_FACT",
  "AGENT_OBSERVABLE",
  "SELF_REPORT",
])
const resolutionSchema = z.enum(["YES", "NO", "AMBIGUOUS"])

export type PredictionView = {
  id: string
  title: string
  resolveBy: Date
  resolved: boolean
  oracleKind: string
  provenance: string
  resolutionCriteria: string | null
  scoringAnchor: string | null
  /** ADR-0011：没有 Forecast 是合法状态 */
  quantified: boolean
  latestForecast: { id: number; forecast: number; endorsed: boolean } | null
}

function toPredictionView(
  question: Question & { forecasts: Forecast[] },
  viewerId: string,
): PredictionView {
  // 报给调用方的必须是**我的**读数，不是全场最近的一条：
  // 共享题上别人刚押的数字既不该被当成这条题的读数，也不该在我提交前被我看到
  // （ADR-0028）。单人自用时两者等价，所以这不改变既有行为。
  const mine = question.forecasts.filter((f) => f.userId === viewerId)
  const latest = [...mine].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0]
  return {
    id: question.id,
    title: question.title,
    resolveBy: question.resolveBy,
    resolved: question.resolved,
    oracleKind: question.oracleKind,
    provenance: question.provenance,
    resolutionCriteria: question.resolutionCriteria,
    scoringAnchor: question.scoringAnchor,
    quantified: mine.length > 0,
    latestForecast: latest
      ? {
          id: latest.id,
          forecast: Number(latest.forecast),
          endorsed: latest.endorsed,
        }
      : null,
  }
}

function notify(
  userId: string,
  title: string,
  content: string,
  url: string | null,
  questionId: string | null,
  tags: string[],
) {
  return prisma.notification.create({
    data: {
      userId,
      title,
      content,
      url,
      questionId,
      tags,
      deliveryState: "PENDING",
    },
  })
}

/**
 * 通知该说什么，由两个正交事实决定：是否量化（ADR-0011）× 数字来源（ADR-0008）。
 * 单点判定：标题与标签必须永远一致，否则“待背书”的标签会配上一个“已确认”的标题。
 */
function notificationFor(
  quantified: boolean,
  unendorsed: boolean,
): { title: string; tags: string[] } {
  if (!quantified) {
    return { title: "新增未量化命题", tags: ["unquantified"] }
  }
  if (unendorsed) {
    return { title: "新增待背书预测", tags: ["unendorsed"] }
  }
  return { title: "新增已确认预测", tags: ["quantified"] }
}

export const agentRouter = router({
  /** 已到期且未结算——跟踪调用的主输入。 */
  listDue: ownedProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(200).default(50),
          now: z.date().optional(),
          /**
           * 分桶下钻（ADR-0039）：`list-due --bucket overdue|1w|1m|1m+`。
           *
           * 区间来自 `bucketRangeOf`——与简报的 `bucketOf` 互为逆运算。两处各写一遍
           * 边界，一条恰好落在一周整的预测就会同时出现在两个桶里或两个都不出现。
           */
          bucket: z
            .enum(BRIEF_BUCKETS as unknown as [BriefBucket, ...BriefBucket[]])
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50
      const now = input?.now ?? new Date()
      const [due, danglingCandidates, untaggedDecisions] = await Promise.all([
        prisma.question.findMany({
          where: {
            userId: ctx.userId,
            resolved: false,
            resolveBy: input?.bucket
              ? bucketRangeOf(input.bucket, now)
              : { lte: now },
          },
          orderBy: { resolveBy: "asc" },
          take: limit,
          include: { forecasts: true },
        }),
        // 悬空未结算（ADR-0031 §二）：**已结算**，但那次结算对我不生效（无来源且不是
        // 本人确认）。它必须可见——让「没有计量」与「没有这条预测」在复盘时不可区分，
        // 才是真问题。这里不按 owner 过滤：悬空的是**我押过的**题。
        prisma.question.findMany({
          where: {
            resolved: true,
            resolutionSource: null,
            forecasts: { some: { userId: ctx.userId } },
          },
          orderBy: { resolvedAt: "desc" },
          take: limit,
          include: { forecasts: true },
        }),
        // ADR-0030 §八：未标领域必须可见。计数与列表共用同一个判据
        // （`untaggedDecisionWhere`），否则两处各说各话。
        prisma.decision.count({ where: untaggedDecisionWhere(ctx.userId) }),
      ])
      // 分桶下钻可能落在**未来**（1w / 1m / 1m+）：那些预测还没到期，不能进
      // `settleable`——那一栏的定义是"到点了，而且有人能核实 ⇒ 这是待办"。
      // 把未到期项塞进去，会让"一周内 8 条"被读成"8 条现在就该结算"。
      const dueNow = due.filter(
        (question) => question.resolveBy.getTime() <= now.getTime(),
      )
      const upcoming = due.filter(
        (question) => question.resolveBy.getTime() > now.getTime(),
      )

      return {
        /** 本次下钻的分桶；`null` = 未分桶（等价于 overdue）。 */
        bucket: input?.bucket ?? null,
        settleable: dueNow.map((q) => toPredictionView(q, ctx.userId)),
        /** 落在未来分桶里的项：**还没到点**，不是待办。 */
        upcoming: upcoming.map((q) => toPredictionView(q, ctx.userId)),
        // ADR-0030 §八：未标领域必须可见，且**没有到期项时也要报**——这一行依附的是
        // “队列被拉过一次”，不是“队列非空”；只在有到期项时顺带提，那句要求就落不了地。
        untaggedDecisions,
        // 判据只有一处（`settlementScopeOf`）：这里不重写一遍「什么算悬空」。
        dangling: danglingCandidates
          .filter((q) => isDangling(q, ctx.userId))
          .map((q) => ({
            ...toPredictionView(q, ctx.userId),
            reason: danglingReason(q),
          })),
      }
    }),

  /**
   * 状态简报（ADR-0039）：一份**现算**的当前状态快照。
   *
   * 不落库、不缓存进库：落库的读数必然过期，而一旦过期，人会按过期的状态做决定
   * （与 ADR-0020 第三点同一条理由）。CLI、Web 首页与每轮注入读的都是这一个过程。
   *
   * 单位是 **Prediction**：只有它有 `resolveBy`。按决策计会给出第二套数字，而
   * "简报说 8、list-due 说 12"这种不一致**不会报错**，只会让人不再相信任何一个。
   */
  brief: ownedProcedure
    .input(z.object({ now: z.date().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const now = input?.now ?? new Date()
      const [unsettled, decisions, untaggedDecisions, unendorsedForecasts] =
        await Promise.all([
          prisma.question.findMany({
            where: { userId: ctx.userId, resolved: false },
            select: {
              id: true,
              title: true,
              resolveBy: true,
              decisionId: true,
            },
            orderBy: { resolveBy: "asc" },
          }),
          prisma.decision.findMany({
            where: { userId: ctx.userId },
            select: {
              id: true,
              rubricVersion: true,
              lockedAt: true,
              action: true,
              actionDueAt: true,
              executions: { select: { kind: true, occurredAt: true } },
              rubricEntries: { select: { itemKey: true, status: true } },
              questions: { select: { resolved: true } },
            },
          }),
          prisma.decision.count({ where: untaggedDecisionWhere(ctx.userId) }),
          prisma.forecast.count({
            where: { userId: ctx.userId, endorsed: false },
          }),
        ])

      // 「清单从未记录」拆成"还救得回来"与"已披露"（ADR-0039 第一点）：前者是可执行
      // 的动作，后者只是事实。混成一个数字，就把"待办"与"没法定论"混成了一件事。
      let unfrozen = 0
      let frozen = 0
      let decisionsWithoutPredictions = 0
      // ADR-0041：动作读数与清单读数互不影响，所以先算动作，再决定是否数清单。
      const actions = { planned: 0, overdue: 0, executed: 0, abandoned: 0 }
      for (const decision of decisions) {
        if (decision.questions.length === 0) decisionsWithoutPredictions += 1

        const actionState = actionStateOf(decision, now)
        if (actionState === "PLANNED") actions.planned += 1
        if (actionState === "OVERDUE") actions.overdue += 1
        if (actionState === "EXECUTED") actions.executed += 1
        if (actionState === "ABANDONED") actions.abandoned += 1

        const completion = deriveRubricCompletion(
          decision.rubricEntries,
          decision.rubricVersion,
        )
        if (completion.unrecorded.length === 0) continue

        // 冻结判据只有一处实现：把仓库里的 questions 映射成它的入参，而不是在
        // 这里重写一遍"算不算已揭晓"。
        const lock = decisionLockOf(
          decision.questions.map((question, index) => ({
            id: String(index),
            title: "",
            resolved: question.resolved,
          })),
          decision.lockedAt,
        )
        if (lock.locked) frozen += 1
        else unfrozen += 1
      }

      return {
        generatedAt: now,
        due: summarizeDue(unsettled, now),
        nearest: nearestDue(unsettled, now).map((prediction) => ({
          id: prediction.id,
          title: prediction.title,
          dueAt: prediction.resolveBy,
          decisionId: prediction.decisionId,
        })),
        rubricNeverRecorded: { unfrozen, frozen },
        actions,
        untaggedDecisions,
        unendorsedForecasts,
        decisionsWithoutPredictions,
        // 下钻命令随返回给出（ADR-0039 第六点）：只许指向真实存在的命令，
        // 由 `docs_commands.test.ts` 守着。
        seeAlso: BRIEF_SEE_ALSO,
      }
    }),

  /**
   * 补录可核查来源（ADR-0031 §五）。
   *
   * 存在理由：悬空是合法状态，但不能是**死路**。后来出现了可核查来源 ⇒ 把来源补上
   * ⇒ 该题上所有预测计入。这不是「撤销结算」：`resolved`/`resolvedAt`/分数以外的东西
   * 都不动，因此不触碰 ADR-0020 的锁定单向性（也不回退锁定时点）。
   *
   * 谁可以补：题目作者或在该题上押过注的 Owner——即被这次判定**影响到的当事方**。
   * 不开放给无关身份：补来源会改变别人的计量。
   *
   * 为什么放在 agent 侧：悬空是被**队列**（`listDue.dangling`）发现的，而那条队列正是
   * agent 手里的；Web 侧的入口随题目页写入口一起做（见 ticket 09–11）。
   */
  recordResolutionSource: ownedProcedure
    .input(
      z.object({
        questionId: z.string(),
        source: z.string().min(1),
        rationale: z.string().optional(),
        /** 改写**已有**来源时必须给理由（那是改历史口径，不是补缺）。 */
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const question = await prisma.question.findUnique({
        where: { id: input.questionId },
        select: {
          id: true,
          resolved: true,
          resolutionSource: true,
          userId: true,
          forecasts: { select: { userId: true } },
        },
      })
      if (!question) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到这条预测" })
      }
      if (!question.resolved) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "这条题还没结算。来源是随结算一并写入的，先结算（带 --source）才有东西可补。",
        })
      }

      const isAffected =
        question.userId === ctx.userId ||
        question.forecasts.some((f) => f.userId === ctx.userId)
      if (!isAffected) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "你不是建题者，也没在这条题上押过注：补来源会改变别人的计量，只有被影响的当事方可以补（ADR-0031 §五）。",
        })
      }

      const hadSource = question.resolutionSource !== null
      if (hadSource && !input.reason) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "这条题已经有来源了。改写已有来源是改历史口径，必须给理由（--reason）。",
        })
      }

      await prisma.question.update({
        where: { id: question.id },
        data: {
          resolutionSource: input.source,
          // Prisma 把 undefined 当「不动这个字段」，所以没给理由时保留原有理由
          resolutionRationale: input.rationale,
        },
      })

      // 重算：不重算的话，ADR-0031 §五 承诺的「补录后全部计入」只会停在数据上，
      // 分数不补——与 ADR-0008 的背书重算是同一条理由。
      await rescoreResolvedQuestion(question.id)

      return {
        questionId: question.id,
        source: input.source,
        rewritten: hadSource,
      }
    }),

  /** 全部未结算（含未到期）——供定期巡检发现"判据已经可以判了"。 */
  listOpen: ownedProcedure
    .input(
      z
        .object({ limit: z.number().int().positive().max(200).default(50) })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const open = await prisma.question.findMany({
        where: { userId: ctx.userId, resolved: false },
        orderBy: { resolveBy: "asc" },
        take: input?.limit ?? 50,
        include: { forecasts: true },
      })
      return open.map((q) => toPredictionView(q, ctx.userId))
    }),

  /**
   * 创建一条预测。`probability` 可省略——ADR-0011 允许"还没想清楚"的
   * 未量化命题存在，此时不写 Forecast。
   */
  createPrediction: ownedProcedure
    .input(
      z.object({
        title: z.string().min(1, "命题不能为空"),
        resolveBy: z.date(),
        resolutionCriteria: z
          .string()
          .min(1, "结算判据不能为空：判据必须可证伪（ADR-0002）"),
        oracleKind: oracleKindSchema.default("PUBLIC_FACT"),
        scoringAnchor: z.string().min(1).optional(),
        probability: z.number().min(0).max(1).optional(),
        note: z.string().optional(),
        /**
         * ADR-0008：数字**由当事人给出**即已背书，零操作。
         * 只有 Agent **自己取得**这个数字（不是当事人说的）时才置 true——
         * 此时记录进未背书队列，由当事人在 Web 上背书后才计入校准。
         */
        // ADR-0024：路由层**没有默认值**，调用方必须显式声明来源。
        // 两边都不猜：猜错的代价是“把 agent 的数字当成当事人的”，而这件事
        // 不会报错、只会让当事人的校准数据静默变脏。
        statedByOwner: z.boolean(),
        /**
         * ADR-0019：这条 Prediction 属于哪个 Decision。
         * 必须是自己的决策——挂到别人的决策上等于越权写。
         */
        decisionId: z.string().optional(),
        // 审计线索（ADR-0027）。`initiator` 必填：路由层不给默认值，猜错的方向
        // 恰好是"把 agent 发起的记录当成人的"，而那正是要能对质的那一类。
        initiator: z.enum(["HUMAN", "AGENT"]),
        agentSessionId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.oracleKind === "SELF_REPORT" && !input.scoringAnchor) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "自我报告类预测必须同时冻结评分锚点（ADR-0002）：否则事后无法判断几分算几分。",
        })
      }

      const provenance = input.statedByOwner ? "HUMAN" : "AGENT"

      let decisionId: string | null = null
      if (input.decisionId !== undefined) {
        // 属主边界只有一份实现（`decision_router`）：挂到别人的决策上等于越权写，
        // 而这里与 `attachPrediction` 问的是同一个问题。
        const decision = await assertOwnedDecision(input.decisionId, ctx.userId)
        decisionId = decision.id
      }

      const question = await prisma.question.create({
        data: {
          userId: ctx.userId,
          title: input.title,
          resolveBy: input.resolveBy,
          type: "BINARY",
          oracleKind: input.oracleKind,
          resolutionCriteria: input.resolutionCriteria,
          scoringAnchor: input.scoringAnchor,
          notes: input.note,
          provenance,
          decisionId,
          initiator: input.initiator,
          agentSessionId: input.agentSessionId ?? null,
        },
      })

      // ADR-0030 §三：**创建时就归属决策**这条路径与 `attachPrediction` 是同一次“挂接”，
      // 所以领域必须同样写时复制过来。
      //
      // 少了这一步不会有任何症状：题照常建、复盘照常看，只是这条 Prediction 永远不带
      // 领域，于是它**不进任何领域读数**——读数的 n 少了一批，而没有任何东西会变红
      // （这条缺口正是链路测试 `e2e/domain-tracking.spec.ts` 发现并钉住的）。
      if (decisionId !== null) {
        await propagateDecisionDomainsToQuestion(decisionId, question.id)
      }

      let forecastId: number | null = null
      if (input.probability !== undefined) {
        const forecast = await prisma.forecast.create({
          data: {
            questionId: question.id,
            userId: ctx.userId,
            forecast: input.probability,
            provenance,
            // ADR-0008：Agent 自己取得的数字须经当事人背书才计入校准；
            // 数字由当事人给出的天然已背书。
            endorsed: input.statedByOwner,
            endorsedAt: input.statedByOwner ? new Date() : null,
            initiator: input.initiator,
            agentSessionId: input.agentSessionId ?? null,
          },
        })
        forecastId = forecast.id
      }

      const percent =
        input.probability === undefined
          ? null
          : Math.round(input.probability * 100)
      const notification = notificationFor(
        forecastId !== null,
        !input.statedByOwner,
      )

      await notify(
        ctx.userId,
        notification.title,
        `${input.title}（${percent === null ? "尚未给出概率" : `${percent}%`}）`,
        `/q/${question.id}`,
        question.id,
        notification.tags,
      )

      return {
        questionId: question.id,
        forecastId,
        quantified: forecastId !== null,
        provenance,
      }
    }),

  /** 背书一个预测值：此后它才进入校准（ADR-0008）。 */
  endorse: ownedProcedure
    .input(
      z.object({
        forecastId: z.number().int().optional(),
        questionId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.forecastId === undefined && input.questionId === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "需要 forecastId 或 questionId 之一",
        })
      }

      const where =
        input.forecastId !== undefined
          ? { id: input.forecastId }
          : { questionId: input.questionId }

      const forecasts = await prisma.forecast.findMany({
        where: { ...where, userId: ctx.userId, endorsed: false },
      })
      if (forecasts.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "没有找到属于当前 owner 且未背书的预测值",
        })
      }

      await prisma.forecast.updateMany({
        where: { id: { in: forecasts.map((f) => f.id) } },
        data: { endorsed: true, endorsedAt: new Date() },
      })

      // ADR-0008：背书必须真的改变校准。问题已结算时分数已经写过，不重算就会
      // 静默落空——界面上的「尚未背书」消失，校准里却永远没有这一笔。
      const questionIds = Array.from(
        new Set(forecasts.map((f) => f.questionId)),
      )
      const resolved = await prisma.question.findMany({
        where: { id: { in: questionIds }, resolved: true },
        select: { id: true },
      })
      for (const question of resolved) {
        await rescoreResolvedQuestion(question.id)
      }

      return {
        endorsed: forecasts.map((f) => f.id),
        rescored: resolved.map((question) => question.id),
      }
    }),

  /** 未背书样本清单——"我逃避了量化/背书"这件事本身要可见（ADR-0008、ADR-0011）。 */
  listUnendorsed: ownedProcedure.query(async ({ ctx }) => {
    const forecasts = await prisma.forecast.findMany({
      where: { userId: ctx.userId, endorsed: false },
      include: { question: true },
      orderBy: { createdAt: "desc" },
    })
    return forecasts.map((f) => ({
      forecastId: f.id,
      forecast: Number(f.forecast),
      questionId: f.questionId,
      title: f.question.title,
      createdAt: f.createdAt,
    }))
  }),

  /**
   * 审计线索清单（ADR-0027）：把 `initiator` 与 `provenance` 摆在一起，
   * 使"来自 pi 会话、却声明数字由当事人给出"的记录**可以被筛出来复查**。
   *
   * 它不是"可疑名单"：当事人在 agent 会话里亲口给出数字是完全正常的路径
   * （ADR-0024 允许且要求显式声明）。这个清单存在的意义只是让那次声明**可对质**
   * ——否则默认方向就成了一次不可复查的自我申报。
   */
  listAuditRecords: ownedProcedure
    .input(
      z.object({
        onlyAgentSessionOwnerClaims: z.boolean().default(false),
        limit: z.number().int().positive().max(500).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      // 过滤条件写成显式的 if，而不是条件空对象展开：这条规则的两种形状在日志与
      // 类型推导上都更清楚，而审计筛选最怕的就是“看起来滤了、其实没滤”。
      const where: Prisma.ForecastWhereInput = { userId: ctx.userId }
      if (input.onlyAgentSessionOwnerClaims) {
        where.initiator = "AGENT"
        where.provenance = "HUMAN"
      }

      const forecasts = await prisma.forecast.findMany({
        where,
        include: { question: { select: { title: true } } },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      })

      return forecasts.map((f) => ({
        forecastId: f.id,
        questionId: f.questionId,
        title: f.question.title,
        forecast: Number(f.forecast),
        provenance: f.provenance,
        endorsed: f.endorsed,
        initiator: f.initiator,
        agentSessionId: f.agentSessionId,
        createdAt: f.createdAt,
        /** 供人一眼看出的那条组合，而不是让读者自己对照两列。 */
        ownerClaimFromSession:
          f.initiator === "AGENT" && f.provenance === "HUMAN",
      }))
    }),

  listRevisions: ownedProcedure
    .input(z.object({ questionId: z.string() }))
    .query(async ({ ctx, input }) => {
      // 非本人（共享或他人公开）的问题返回空数组：与 listProposals 行为一致，
      // 也避免面板在正常浏览时因 NOT_FOUND 弹出错误提示。
      const owned = await prisma.question.findFirst({
        where: { id: input.questionId, userId: ctx.userId },
        select: { id: true },
      })
      if (!owned) return []
      return prisma.revision.findMany({
        where: { questionId: input.questionId },
        orderBy: { createdAt: "desc" },
      })
    }),

  /**
   * 按判据层级结算或提案（ADR-0004）：
   * - 公共事实 + 来源 → 直接结算；**无来源则降级为提案**
   * - Agent 可观测 → 提案 + 确认
   * - 自我报告 → 只能请求本人报告，agent 不得代为判定
   */
  settle: ownedProcedure
    .input(
      z.object({
        questionId: z.string(),
        resolution: resolutionSchema,
        source: z.string().min(1).optional(),
        rationale: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // ADR-0029：不再用“属于当前 owner 才看得到”的断言——建题者的身份不带来任何
      // 结算特权，因此先按 id 取题，再由授权矩阵决定这次调用能做什么。
      const question = await prisma.question.findFirst({
        where: { id: input.questionId },
        include: { forecasts: true },
      })
      if (!question) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `找不到这条预测：${input.questionId}`,
        })
      }
      if (question.resolved) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该预测已结算",
        })
      }

      const decision = decideSettlement({
        oracleKind: question.oracleKind,
        hasSource: input.source !== undefined,
        callerOwnsForecast: question.forecasts.some(
          (f) => f.userId === ctx.userId,
        ),
      })

      if (decision.mode === "requires-human-report") {
        // 问的对象是**预测的 Owner**（没人押过时退回建题者，因为那条自我报告说的
        // 就是他本人）。向调用方自己发一条“请你报告”的提醒是没用的。
        const toNotify =
          question.forecasts.length > 0
            ? Array.from(new Set(question.forecasts.map((f) => f.userId)))
            : [question.userId]
        for (const ownerId of toNotify) {
          await notify(
            ownerId,
            "需要你本人报告结论",
            `「${question.title}」属于自我报告类，只能由你本人给出结论。判据：${question.resolutionCriteria ?? "（未记录）"}`,
            `/q/${question.id}`,
            question.id,
            ["needs-self-report"],
          )
        }
        return { mode: "requires-human-report" as const }
      }

      if (decision.mode === "settle") {
        await handleQuestionResolution(
          question.id,
          input.resolution,
          question.type,
          undefined,
          // ADR-0004：自行结算必须携带可核查来源，因此来源要落库而非只进通知正文
          {
            source: input.source,
            rationale: input.rationale,
            // ADR-0031 §三：确认者是调用者本人（授权矩阵已在上面判定过）
            confirmedByUserId: ctx.userId,
          },
        )
        await notify(
          ctx.userId,
          "预测已自动结算",
          `「${question.title}」结算为 ${input.resolution}。来源：${input.source ?? "（本人报告）"}`,
          `/q/${question.id}`,
          question.id,
          ["auto-resolved"],
        )
        return { mode: "settled" as const }
      }

      const proposal = await prisma.resolutionProposal.create({
        data: {
          questionId: question.id,
          resolution: input.resolution,
          source: input.source,
          rationale: input.rationale,
          proposedBy: "agent",
        },
      })
      await notify(
        ctx.userId,
        decision.downgraded ? "结算提案（缺少来源）" : "结算提案待确认",
        decision.downgraded
          ? `「${question.title}」建议结算为 ${input.resolution}，但未附来源，已降级为提案（ADR-0004）。`
          : `「${question.title}」建议结算为 ${input.resolution}，等待你确认。`,
        `/q/${question.id}`,
        question.id,
        decision.downgraded ? ["proposal", "missing-source"] : ["proposal"],
      )
      return {
        mode: "proposed" as const,
        proposalId: proposal.id,
        downgraded: decision.downgraded,
      }
    }),

  listProposals: ownedProcedure
    .input(
      z
        .object({
          status: z
            .enum(["PENDING", "ACCEPTED", "REJECTED"])
            .default("PENDING"),
          questionId: z.string().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return prisma.resolutionProposal.findMany({
        where: {
          status: input?.status ?? "PENDING",
          ...(input?.questionId ? { questionId: input.questionId } : {}),
          // ADR-0029：待我确认的提案包括**我押过注的**题——只按建题者过滤会让
          // B（押注者）看不到等他确认的那条提案。
          question: {
            OR: [
              { userId: ctx.userId },
              { forecasts: { some: { userId: ctx.userId } } },
            ],
          },
        },
        include: { question: true },
        orderBy: { createdAt: "desc" },
      })
    }),

  /** 当事人对提案拍板：接受即真正结算（这一步是 Web 上的确认入口）。 */
  decideProposal: ownedProcedure
    .input(z.object({ proposalId: z.string(), accept: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await prisma.resolutionProposal.findFirst({
        where: { id: input.proposalId },
        include: { question: { include: { forecasts: true } } },
      })
      if (!proposal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到该提案" })
      }
      if (proposal.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该提案已被处理" })
      }
      // ADR-0029：确认权属于**该预测的 Owner**，不属于建题者。
      // A 建题、B 押注时，A 不能替 B 判定 B 的信念——这正是 ADR-0008 要防的事。
      const isQuestionOwner = proposal.question.userId === ctx.userId
      const ownsForecast = proposal.question.forecasts.some(
        (f) => f.userId === ctx.userId,
      )
      if (!isQuestionOwner && !ownsForecast) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "你不是这条预测的 Owner，也不是建题者：确认结算的权利属于在该题上押过注的人（ADR-0029）。",
        })
      }

      if (input.accept && !proposal.question.resolved) {
        await handleQuestionResolution(
          proposal.questionId,
          proposal.resolution,
          proposal.question.type,
          undefined,
          // 提案里的证据随采纳一并成为结算证据
          {
            source: proposal.source,
            rationale: proposal.rationale,
            // ADR-0031 §三：确认这次结算的是接受提案的人
            confirmedByUserId: ctx.userId,
          },
        )
      }

      return prisma.resolutionProposal.update({
        where: { id: proposal.id },
        data: {
          status: input.accept ? "ACCEPTED" : "REJECTED",
          decidedAt: new Date(),
        },
      })
    }),

  /** 待触达项（拉取式，ADR-0017）。 */
  listPendingDeliveries: ownedProcedure
    .input(
      z
        .object({ limit: z.number().int().positive().max(200).default(50) })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return prisma.notification.findMany({
        where: { userId: ctx.userId, deliveryState: "PENDING" },
        orderBy: { createdAt: "asc" },
        take: input?.limit ?? 50,
      })
    }),

  /**
   * 回报触达结果。发送成功 → DELIVERED；确认无需外发 → NOT_NEEDED。
   * 外部通道失败应**保持 PENDING**（站内始终是兜底，见 ADR-0013）。
   */
  reportDelivery: ownedProcedure
    .input(
      z.object({
        notificationId: z.string(),
        outcome: z.enum(["DELIVERED", "NOT_NEEDED"]),
        channel: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.notification.findFirst({
        where: { id: input.notificationId, userId: ctx.userId },
      })
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到该通知" })
      }
      return prisma.notification.update({
        where: { id: existing.id },
        data: {
          deliveryState: input.outcome,
          deliveredAt: input.outcome === "DELIVERED" ? new Date() : null,
          deliveredVia:
            input.channel ?? (input.outcome === "DELIVERED" ? "in-app" : null),
        },
      })
    }),

  /**
  /**
   * 签发一次性配对码（ADR-0035）：把"我已经持有这个身份的凭据"换成"这个浏览器也能
   * 用这个身份"。界面上只有 CLI，但 `/api/trpc` 把同一批过程也暴露给网页会话——
   * 所以「只有持有凭据者能签发」由 `credentialProcedure`（凭据 vs 会话 vs 身份选择器）
   * 在过程层落实，而不是靠"网页没调用它"。开关再判一次：关着签出来的码兑不了。
   * 这是登记在 ADR-0023 的有意例外（`cli/parity.test.ts` 的例外表）。
   */
  issuePairingCode: credentialProcedure.mutation(({ ctx }) => {
    if (!isPairingLoginEnabled(process.env)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `配对码登录当前是关闭的（${PAIRING_LOGIN_ENV}=1 并重启 Web 服务才开；ADR-0035）`,
      })
    }
    return issuePairingCode(ctx.userId)
  }),
})
