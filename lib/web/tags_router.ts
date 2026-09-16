/**
 * 领域标签的过程层（ADR-0030）。
 *
 * 与 `question_router` 里的标签操作不同：**这里每个过程都围绕"决策的领域"**，
 * 因为领域权威在 Decision 上（预测上的领域只是挂接那一刻的写时复制快照）。
 * 造词只有 `addDomain` 一条路——未知领域不会被隐式创建，只会被拒绝。
 */
import { TRPCError } from "@trpc/server"
import { QuestionType, Resolution } from "@prisma/client"
import { z } from "zod"
import { backendAnalyticsEvent } from "../_utils_server"
import prisma from "../prisma"
import {
  assertValidDomainName,
  normalizeDomainName,
  propagateDecisionDomains,
  resolveExistingDomains,
  untaggedDecisionWhere,
} from "./domain_tags"
import { ownedProcedure, publicProcedure, router } from "./trpc_base"
import {
  computeDomainAssessment,
  DomainSample,
  PendingSample,
} from "./domain_stats"
import { countsTowardMetrics } from "./settlement_scope"

export const tagsRouter = router({
  getAll: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.userId) {
      return null
    }

    const tags = await prisma.tag.findMany({
      where: {
        userId: ctx.userId,
      },
      include: {
        _count: {
          select: { questions: true },
        },
      },
    })

    return tags.map((tag) => ({
      ...tag,
      questionCount: tag._count.questions,
      _count: undefined,
    }))
  }),

  getByName: publicProcedure
    .input(
      z.object({
        tagName: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.userId) {
        return null
      }

      const tags = await prisma.tag.findMany({
        where: {
          name: input.tagName,
          userId: ctx.userId,
        },
      })

      if (tags.length === 0) {
        return null
      }

      return tags[0]
    }),

  setQuestionTags: publicProcedure
    .input(
      z.object({
        tags: z.string().array(),
        questionId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to add a tag",
        })
      }

      await prisma.question.update({
        where: {
          id: input.questionId,
        },
        data: {
          tags: {
            set: [],
            connectOrCreate: input.tags.map((name) => ({
              where: {
                nameNormalized_userId: {
                  nameNormalized: normalizeDomainName(name),
                  userId: ctx.userId || "",
                },
              },
              create: {
                name,
                nameNormalized: normalizeDomainName(name),
                user: {
                  connect: {
                    id: ctx.userId,
                  },
                },
              },
            })),
          },
        },
      })

      // delete any now unused tags
      await prisma.tag.deleteMany({
        where: {
          userId: ctx.userId,
          questions: {
            none: {},
          },
        },
      })

      await backendAnalyticsEvent("set_tags", {
        user: ctx.userId,
        platform: "web",
      })
    }),

  // ── 领域（ADR-0030）：权威在 Decision，写时复制到 Question ────────────────

  /** 我的领域词表，带引用计数——碎片化（一堆各 1–2 条样本的领域）要能一眼看出来。 */
  listDomains: ownedProcedure.query(async ({ ctx }) => {
    const tags = await prisma.tag.findMany({
      where: { userId: ctx.userId },
      include: { _count: { select: { questions: true, decisions: true } } },
      orderBy: { name: "asc" },
    })
    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      decisionCount: tag._count.decisions,
      questionCount: tag._count.questions,
    }))
  }),

  /**
   * 建立一个新领域。
   *
   * 这是**唯一**能造词的入口（ADR-0030 §七）：写入路径上的未知领域一律大声失败。
   * agent 调它之前必须先取得用户确认——这条约束由行为（skill）保证，因为服务端
   * 无从判断"问过了没有"。接口本身幂等：已存在就返回那一个，不报错也不重复建。
   */
  addDomain: ownedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(({ input, ctx }) => {
      const name = assertValidDomainName(input.name)
      const nameNormalized = normalizeDomainName(name)
      return prisma.tag.upsert({
        where: {
          nameNormalized_userId: { nameNormalized, userId: ctx.userId },
        },
        update: {},
        create: { name, nameNormalized, userId: ctx.userId },
      })
    }),

  /**
   * 改名：一次性重写引用并留痕（ADR-0030 §十五）。
   *
   * 引用是指向 Tag 行的，所以改名只需改这一行——但"动了多少条历史归属"必须
   * 报出来：改名的危险不在于难，而在于它会在无人察觉时改写历史的口径。
   */
  renameDomain: ownedProcedure
    .input(
      z.object({
        from: z.string(),
        to: z.string(),
        reason: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const to = assertValidDomainName(input.to)
      const existing = await prisma.tag.findFirst({
        where: {
          userId: ctx.userId,
          nameNormalized: normalizeDomainName(input.from),
        },
        include: { _count: { select: { questions: true, decisions: true } } },
      })
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `找不到领域：${input.from}`,
        })
      }

      const clash = await prisma.tag.findFirst({
        where: {
          userId: ctx.userId,
          nameNormalized: normalizeDomainName(to),
        },
      })
      if (clash && clash.id !== existing.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `已存在领域「${clash.name}」：合并两个领域不是改名，请先决定保留哪一个`,
        })
      }

      const updated = await prisma.tag.update({
        where: { id: existing.id },
        data: { name: to, nameNormalized: normalizeDomainName(to) },
      })

      const affected = await prisma.decision.findMany({
        where: { tags: { some: { id: existing.id } } },
        select: { id: true },
      })
      for (const decision of affected) {
        await prisma.revision.create({
          data: {
            decisionId: decision.id,
            field: "tags",
            oldValue: existing.name,
            newValue: to,
            reason: input.reason,
          },
        })
      }

      return {
        id: updated.id,
        name: updated.name,
        affectedDecisions: affected.length,
        affectedQuestions: existing._count.questions,
      }
    }),

  /** 删除：只允许零引用的标签（ADR-0030 §十五）——删已引用的是改写历史。 */
  deleteDomain: ownedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tag = await prisma.tag.findFirst({
        where: {
          userId: ctx.userId,
          nameNormalized: normalizeDomainName(input.name),
        },
        include: { _count: { select: { questions: true, decisions: true } } },
      })
      if (!tag) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `找不到领域：${input.name}`,
        })
      }
      if (tag._count.decisions > 0 || tag._count.questions > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            `「${tag.name}」被 ${tag._count.decisions} 条决策、${tag._count.questions} 条预测引用。` +
            "删除它就是静默改写历史归属，因此被拒绝（ADR-0030 §十五）。",
        })
      }
      await prisma.tag.delete({ where: { id: tag.id } })
      return { deleted: tag.name }
    }),

  /**
   * 领域读数（ADR-0032 / ADR-0033）：样本数、悬空计数、校准、分辨率、技能分与区间。
   *
   * 数据侧只做三件事，剩下的全在纯函数里：
   *
   * 1. 取该前缀下**已结算的二元题**（前缀命中包含后代，ADR-0030 §十一）。
   *    MCQ 暂不进这个读数：选项级结果与题级发生率不是同一个量，把两者当一样算
   *    会得到一个没人能复算的数。这是已知缺口，不是遗漏。
   * 2. 每条题一个样本 = 该用户**已背书**预测的均值（与 `_scoring.ts` 对同一条题
   *    取均值的口径一致，所以两者不会给出不同的 Brier）。
   * 3. 用 ADR-0031 §六 判每条样本是否悬空：悬空进分母、**不进**判据。
   *
   * 基准率由 `computeDomainAssessment` 从这些样本自己算（ADR-0032 §二）：这条路径上
   * 没有任何地方能传进一个自报的参照值。
   */
  domainReport: ownedProcedure
    .input(
      z.object({
        /** 前缀即领域，粗细由用户选（ADR-0030 §十三）。 */
        prefix: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const prefix = normalizeDomainName(input.prefix)
      const questions = await prisma.question.findMany({
        where: {
          resolved: true,
          type: QuestionType.BINARY,
          resolution: { in: [Resolution.YES, Resolution.NO] },
          tags: {
            some: {
              userId: ctx.userId,
              // 折叠大小写地比前缀，与领域判重同一把尺子（ADR-0030 §十二）
              OR: [
                { nameNormalized: prefix },
                { nameNormalized: { startsWith: `${prefix}/` } },
              ],
            },
          },
          forecasts: { some: { userId: ctx.userId } },
        },
        select: {
          id: true,
          // 判据需要 `resolved`（ADR-0031 §六 的公式里那一项）：查询已经过滤了它，
          // 但 select 不带就得在类型上再补一次——不然计量的入参是不完整的。
          resolved: true,
          resolution: true,
          resolutionSource: true,
          confirmedByUserId: true,
          forecasts: {
            where: { userId: ctx.userId, endorsed: true },
            select: { forecast: true },
          },
        },
      })

      const samples: DomainSample[] = []
      const pending: PendingSample[] = []

      for (const question of questions) {
        if (question.forecasts.length === 0) continue
        const forecast =
          question.forecasts.reduce(
            (sum, entry) => sum + Number(entry.forecast),
            0,
          ) / question.forecasts.length
        const sample: DomainSample = {
          questionId: question.id,
          forecast,
          outcome: question.resolution === Resolution.YES ? 1 : 0,
        }
        if (countsTowardMetrics(question, ctx.userId)) {
          samples.push(sample)
        } else {
          pending.push({ questionId: question.id })
        }
      }

      return computeDomainAssessment(input.prefix, samples, pending)
    }),

  /** 未标领域的决策："没打标签"与"没有这条决策"必须能区分（ADR-0030 §八）。 */
  listUntaggedDecisions: ownedProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(200).default(50),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return prisma.decision.findMany({
        where: untaggedDecisionWhere(ctx.userId),
        select: { id: true, statement: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 50,
      })
    }),

  /**
   * 给决策设定领域（ADR-0030 §二：权威在这里）。
   *
   * 补齐缺失 ≠ 重标（§九）：从未标过 ⇒ 直接写，并补到**已挂**的预测上；
   * 已标过 ⇒ 必须给理由，因为那是在改写历史样本的归属。
   */
  setDecisionDomains: ownedProcedure
    .input(
      z.object({
        decisionId: z.string(),
        domains: z.string().array(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const decision = await prisma.decision.findFirst({
        where: { id: input.decisionId, userId: ctx.userId },
        include: { tags: { select: { id: true, name: true } } },
      })
      if (!decision) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `找不到属于当前 owner 的决策：${input.decisionId}`,
        })
      }

      const tags = await resolveExistingDomains(ctx.userId, input.domains)
      // §九 的全部要点就在这个区分上：**补齐**（此前从未标过）把领域一并写到已挂的
      // 预测上——那是补缺，不是改写；**重标**（改写已标过的）只改决策本身，已挂样本
      // 保持当时的口径（§四），之后新挂的才用新领域。
      const isRetag = decision.tags.length > 0
      const reason = input.reason
      if (isRetag && !reason) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "改写已有领域必须给理由（ADR-0030 §五）：重标改变这条决策「现在」的归属，" +
            "而它的已挂预测仍按当时的领域解释——两个口径从此刻起不一致，这个动作必须被看见。" +
            `当前领域：${decision.tags.map((tag) => tag.name).join("、")}`,
        })
      }

      await prisma.decision.update({
        where: { id: decision.id },
        data: { tags: { set: tags.map((tag) => ({ id: tag.id })) } },
      })

      // §四：重标**不**回溯改写已挂预测。此前这里无条件调了传播——那等于允许
      // “顺手重标”改写历史，而不会有任何用例变红（除非专门写一条守着它的用例，
      // 见 tags_router.test.ts 的两条自证）。一致性不靠运行时不变量，靠这两条用例。
      const touchedQuestions = isRetag
        ? 0
        : await propagateDecisionDomains(decision.id)

      if (isRetag && reason) {
        await prisma.revision.create({
          data: {
            decisionId: decision.id,
            field: "tags",
            oldValue: decision.tags.map((tag) => tag.name).join(","),
            newValue: tags.map((tag) => tag.name).join(","),
            reason,
          },
        })
      }

      return {
        decisionId: decision.id,
        domains: tags.map((tag) => tag.name),
        backfilled: !isRetag,
        touchedQuestions,
      }
    }),
})
