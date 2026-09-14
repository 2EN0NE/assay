import { Forecast, Question } from "@prisma/client"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import prisma from "../prisma"
import { assertOwnedDecision } from "./decision_router"
import { handleQuestionResolution, rescoreResolvedQuestion } from "./resolution"
import { ownedProcedure, router } from "./trpc_base"

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
): PredictionView {
  const latest = [...question.forecasts].sort(
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
    quantified: question.forecasts.length > 0,
    latestForecast: latest
      ? {
          id: latest.id,
          forecast: Number(latest.forecast),
          endorsed: latest.endorsed,
        }
      : null,
  }
}

async function assertOwnedQuestion(userId: string, questionId: string) {
  const question = await prisma.question.findFirst({
    where: { id: questionId, userId },
    include: { forecasts: true },
  })
  if (!question) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `找不到属于当前 owner 的预测：${questionId}`,
    })
  }
  return question
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
  agentCollected: boolean,
): { title: string; tags: string[] } {
  if (!quantified) {
    return { title: "新增未量化命题", tags: ["unquantified"] }
  }
  if (agentCollected) {
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
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const due = await prisma.question.findMany({
        where: {
          userId: ctx.userId,
          resolved: false,
          resolveBy: { lte: input?.now ?? new Date() },
        },
        orderBy: { resolveBy: "asc" },
        take: input?.limit ?? 50,
        include: { forecasts: true },
      })
      return due.map(toPredictionView)
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
      return open.map(toPredictionView)
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
        agentCollected: z.boolean().default(false),
        /**
         * ADR-0019：这条 Prediction 属于哪个 Decision。
         * 必须是自己的决策——挂到别人的决策上等于越权写。
         */
        decisionId: z.string().optional(),
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

      const provenance = input.agentCollected ? "AGENT" : "AGENT_INSTRUCTED"

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
        },
      })

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
            endorsed: !input.agentCollected,
            endorsedAt: input.agentCollected ? null : new Date(),
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
        input.agentCollected,
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
      const question = await assertOwnedQuestion(ctx.userId, input.questionId)
      if (question.resolved) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该预测已结算",
        })
      }

      if (question.oracleKind === "SELF_REPORT") {
        await notify(
          ctx.userId,
          "需要你本人报告结论",
          `「${question.title}」属于自我报告类，只能由你本人给出结论。判据：${question.resolutionCriteria ?? "（未记录）"}`,
          `/q/${question.id}`,
          question.id,
          ["needs-self-report"],
        )
        return { mode: "requires-human-report" as const }
      }

      const canSelfSettle =
        question.oracleKind === "PUBLIC_FACT" && input.source !== undefined

      if (canSelfSettle) {
        await handleQuestionResolution(
          question.id,
          input.resolution,
          question.type,
          undefined,
          // ADR-0004：自行结算必须携带可核查来源，因此来源要落库而非只进通知正文
          { source: input.source, rationale: input.rationale },
        )
        await notify(
          ctx.userId,
          "预测已自动结算",
          `「${question.title}」结算为 ${input.resolution}。来源：${input.source}`,
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
      const downgraded = question.oracleKind === "PUBLIC_FACT"
      await notify(
        ctx.userId,
        downgraded ? "结算提案（缺少来源）" : "结算提案待确认",
        downgraded
          ? `「${question.title}」建议结算为 ${input.resolution}，但未附来源，已降级为提案（ADR-0004）。`
          : `「${question.title}」建议结算为 ${input.resolution}，等待你确认。`,
        `/q/${question.id}`,
        question.id,
        downgraded ? ["proposal", "missing-source"] : ["proposal"],
      )
      return { mode: "proposed" as const, proposalId: proposal.id, downgraded }
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
          question: { userId: ctx.userId },
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
        where: { id: input.proposalId, question: { userId: ctx.userId } },
        include: { question: true },
      })
      if (!proposal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到该提案" })
      }
      if (proposal.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该提案已被处理" })
      }

      if (input.accept && !proposal.question.resolved) {
        await handleQuestionResolution(
          proposal.questionId,
          proposal.resolution,
          proposal.question.type,
          undefined,
          // 提案里的证据随采纳一并成为结算证据
          { source: proposal.source, rationale: proposal.rationale },
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
})
