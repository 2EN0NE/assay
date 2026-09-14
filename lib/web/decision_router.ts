import { TRPCError } from "@trpc/server"
import { z } from "zod"
import prisma from "../prisma"
import {
  DecisionNarrative,
  DecisionNarrativeInput,
  normalizeDecisionNarrative,
  normalizeNarrativePatch,
} from "./decisions"
import {
  CURRENT_RUBRIC_VERSION,
  RubricEntry,
  deriveRubricCompletion,
  findLockingPrediction,
  rubricLockOf,
  rubricWrittenAfterOutcome,
  validateRubricEntries,
} from "./decision_rubric"
import { ownedProcedure, router } from "./trpc_base"
import { missingRevisionReason, planNarrativeRevisions } from "./revisions"

/**
 * 决策的过程（ADR-0001 / ADR-0019）。
 *
 * 与 `agent_router` 同为"决策记录语义"的规范入口：校验规则只有一份，
 * agent CLI（`createCaller`）与 Web UI 都必须遵守。
 *
 * 本层刻意很薄——叙事的校验与归一化全在 `decisions.ts` 的纯函数里，
 * 这里只负责属主边界与落库。逻辑密度高的部分（清单完成度、锁定判定）
 * 同样会留在纯函数侧。
 */

const narrativeInput = z.object({
  statement: z.string(),
  reasoning: z.string().nullish(),
  expectedOutcome: z.string().nullish(),
  knownInfo: z.string().nullish(),
  unknownInfo: z.string().nullish(),
})

const rubricEntryInput = z.object({
  itemKey: z.string(),
  status: z.enum(["DONE", "NOT_DONE"]),
})

const NOT_FOUND_MESSAGE = "找不到该决策"

/**
 * 逐条分数（User Story 16）：**只取 `QuestionScore` 已存的值**，一个数都不新造。
 *
 * `absolute` 恒有；`relative` 为 `null` 表示这条预测不参与相对分（非公共事实类，
 * 写入侧已按 ADR-0002 把它写成 NULL）。整个返回 `null` 表示连分数行都没有——
 * 还没结算，或判据判不出来（ADR-0018：AMBIGUOUS 不产生任何 `QuestionScore`）。
 * **空不等于 0 分**：把判不出来的结果当零损失，等于给它满分。
 */
function scoreOf(
  scores: {
    absoluteScore: { toNumber: () => number }
    relativeScore: { toNumber: () => number } | null
  }[],
): { absolute: number; relative: number | null } | null {
  const score = scores[0]
  if (!score) {
    return null
  }
  return {
    absolute: score.absoluteScore.toNumber(),
    relative:
      score.relativeScore === null ? null : score.relativeScore.toNumber(),
  }
}

/**
 * 属主边界写进查询条件，而不是取回后再判——后者容易在后续分支里漏掉。
 *
 * 导出给 `agent_router`：创建 Prediction 时指定 `decisionId` 是同一条边界，
 * 各写一份就会在两个入口上有两套失败方式。
 */
export async function assertOwnedDecision(decisionId: string, userId: string) {
  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, userId },
  })
  if (!decision) {
    // 别人的决策与不存在的决策给同一个答案，不泄露存在性
    throw new TRPCError({ code: "NOT_FOUND", message: NOT_FOUND_MESSAGE })
  }
  return decision
}

/**
 * 把纯函数抛出的校验错误转成 BAD_REQUEST。
 * 不转换的话 tRPC 会把它当成 INTERNAL_SERVER_ERROR——调用方会把"填错了"
 * 读成"服务坏了"。
 */
function toNarrative(input: DecisionNarrativeInput): DecisionNarrative {
  try {
    return normalizeDecisionNarrative(input)
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "叙事字段非法",
    })
  }
}

export const decisionRouter = router({
  create: ownedProcedure
    .input(narrativeInput)
    .mutation(async ({ input, ctx }) => {
      // 先把校验/归一化跑完再落库：非法叙事不该留下任何痕迹。
      const narrative = toNarrative(input)
      const created = await prisma.decision.create({
        data: {
          userId: ctx.userId,
          ...narrative,
          // ADR-0020 第四点：新建的决策记下它属于哪个决策版本。之后条目集合演进
          // （新增 / 删除条目）不会改写它的分。
          rubricVersion: CURRENT_RUBRIC_VERSION,
        },
      })
      return created
    }),

  list: ownedProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(100).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const decisions = await prisma.decision.findMany({
        where: { userId: ctx.userId },
        orderBy: { createdAt: "desc" },
        take: input.limit ?? 20,
        include: {
          rubricEntries: true,
          questions: { select: { id: true, title: true, resolved: true } },
        },
      })

      return decisions.map((decision) => ({
        id: decision.id,
        statement: decision.statement,
        createdAt: decision.createdAt,
        // 该决策计分时适用的条目集合版本（ADR-0020 第四点）
        rubricVersion: decision.rubricVersion,
        rubric: deriveRubricCompletion(
          decision.rubricEntries,
          decision.rubricVersion,
        ),
        rubricLock: rubricLockOf(decision.questions, decision.rubricLockedAt),
        /**
         * 结果侧只给**事实**（已揭晓 / 共几条），不给一个聚合分数。
         * 把多条 Prediction 的分数聚成一个"决策结果分"是一个新指标，
         * 归 ADR-0002 管辖；在它未决之前，我不在现场发明一个。
         */
        predictions: {
          total: decision.questions.length,
          resolved: decision.questions.filter((question) => question.resolved)
            .length,
        },
      }))
    }),

  byId: ownedProcedure
    .input(z.object({ decisionId: z.string() }))
    .query(async ({ input, ctx }) => {
      const decision = await prisma.decision.findFirst({
        where: { id: input.decisionId, userId: ctx.userId },
        // 复盘要的"结果侧"就是这组 Prediction（ADR-0019）。分数只取**本人**的
        // `QuestionScore`：同一条题可能有多个预测者，而复盘是当事人自己看的。
        include: {
          rubricEntries: true,
          // 叙事改写的留痕必须在**复盘视图**里看得见，否则留痕没有意义
          // （ADR-0012 的 Consequences）。
          revisions: { orderBy: { createdAt: "asc" } },
          questions: {
            include: { questionScores: { where: { userId: ctx.userId } } },
          },
        },
      })
      if (!decision) {
        throw new TRPCError({ code: "NOT_FOUND", message: NOT_FOUND_MESSAGE })
      }

      return {
        ...decision,
        questions: decision.questions.map((question) => {
          const { questionScores, ...rest } = question
          return { ...rest, score: scoreOf(questionScores) }
        }),
        // 完成度是推导值，不落库（ADR-0020）：落库的分值必然过期。
        // 分母取该决策**所属版本**的条目集合，而不是当前代码版本的——后者会让
        // "条目集合演进"静默改写历史分，而 ADR-0020 要的正是它不被改写。
        rubric: deriveRubricCompletion(
          decision.rubricEntries,
          decision.rubricVersion,
        ),
        rubricLock: rubricLockOf(decision.questions, decision.rubricLockedAt),
      }
    }),

  /**
   * 把一条 Prediction 挂到决策上（ADR-0019）。
   *
   * 一条 Prediction 至多属一个 Decision：重复挂会被拒，而不是默默改挂——
   * 后者会让"这条预测到底为哪个决策下的注"变得不可判定，复盘时两边都算它。
   *
   * 挂上一条**已结算**的预测会立刻锁住清单并记下时点（ADR-0020）。否则会出现
   * "该决策下有已结算的预测，但锁定时点为空"的状态——锁是生效的（判据来自事实），
   * 只是没人记下它何时开始生效，而复盘要用这个时点。
   */
  attachPrediction: ownedProcedure
    .input(z.object({ decisionId: z.string(), questionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const decision = await assertOwnedDecision(input.decisionId, ctx.userId)

      const question = await prisma.question.findFirst({
        where: { id: input.questionId, userId: ctx.userId },
        select: {
          id: true,
          decisionId: true,
          resolved: true,
          resolvedAt: true,
        },
      })
      if (!question) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到该预测" })
      }
      if (question.decisionId && question.decisionId !== decision.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "该预测已归属另一个决策——一条 Prediction 至多属一个 Decision",
        })
      }

      const updated = await prisma.question.update({
        where: { id: question.id },
        data: { decisionId: decision.id },
      })

      if (question.resolved) {
        // ADR-0020 第五点：挂上一条已结算的 Prediction 时立刻记下锁定时点，避免出现
        // "锁已生效（判据来自事实）而时点为空"的状态——复盘要用这个时点。
        if (decision.rubricLockedAt === null) {
          await prisma.decision.update({
            where: { id: decision.id },
            data: { rubricLockedAt: new Date() },
          })
        }

        // ADR-0020 第六点：这条路径——先建决策 → 补满清单 → 再挂上一条**已结算**的
        // Prediction——是唯一能绕过锁定的绕道：写清单时该决策名下空无一物，锁无从生效。
        // 标记不能让绕道消失，但能让它不再与"当初填的"同形。只写一次：第一次披露
        // 已经足够说明问题，重复覆盖只会把最早的时点洗掉。
        if (decision.rubricRecordedAfterOutcomeAt === null) {
          const entries = await prisma.decisionRubricEntry.findMany({
            where: { decisionId: decision.id },
            select: { itemKey: true, recordedAt: true },
          })
          const late = rubricWrittenAfterOutcome(entries, question.resolvedAt)
          if (late !== null) {
            await prisma.decision.update({
              where: { id: decision.id },
              data: { rubricRecordedAfterOutcomeAt: late },
            })
          }
        }
      }

      return updated
    }),

  /**
   * 解绑（ADR-0019 的"可逆"那一半）。
   *
   * 但**已结算的预测不允许解绑**：锁定的判据之一是"该决策下任一 Prediction 已结算"
   * （`findLockingPrediction` 只看事实），所以把那条已结算的预测解绑，等于把已经
   * 关上的门重新打开——清单又能被事后改写，而 ADR-0020 的整个理由是"锁单向、
   * 不回退"。宁愿少一条解绑路径，也不要一个可被自证的锁定。
   *
   * 未结算的预测则允许解绑，即使所在决策已锁定：锁由已记录的时点保持，不靠
   * "还挂着哪条预测"。
   */
  detachPrediction: ownedProcedure
    .input(z.object({ questionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const question = await prisma.question.findFirst({
        where: { id: input.questionId, userId: ctx.userId },
        select: { id: true, title: true, decisionId: true, resolved: true },
      })
      if (!question) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到该预测" })
      }
      if (question.decisionId !== null && question.resolved) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `「${question.title}」已结算，不能解绑：解绑会让该决策的清单重新变成可写（ADR-0020 的锁定不可回退）。`,
        })
      }

      return prisma.question.update({
        where: { id: question.id },
        data: { decisionId: null },
      })
    }),

  /**
   * 补充/修改叙事（ADR-0012 × ADR-0020）。
   *
   * 刻意**不**检查清单锁定：锁定只作用于清单。叙事不进任何分值，所以事后补充它
   * 不产生"把当初说圆"的激励扭曲；而"现在回看，我当时低估了什么"恰恰是
   * 复盘最该被记下来的东西。
   *
   * 但它不是无痕的：**改写（或清空）已填写的内容必须带理由并留一条修订**
   * （ADR-0012）；给**空白**字段补写不受限——那不是改写，而是当初就没记。
   *
   * 局部更新：没提到的字段保持原值。快照 → 留痕 → 更新必须同事务（ADR-0012），
   * 否则更新失败会留下并未发生的修订。
   */
  updateNarrative: ownedProcedure
    .input(
      z.object({
        decisionId: z.string(),
        statement: z.string().nullish(),
        reasoning: z.string().nullish(),
        expectedOutcome: z.string().nullish(),
        knownInfo: z.string().nullish(),
        unknownInfo: z.string().nullish(),
        reason: z.string().nullish(),
      }),
    )
    // 不加 `async`：回调里没有直接的 `await`（只 `return` 一个 promise），而
    // `require-await` 会把它当成错误——语义上也不需要。
    .mutation(({ input, ctx }) => {
      const { decisionId, reason, ...patchInput } = input

      let patch: Partial<DecisionNarrative>
      try {
        patch = normalizeNarrativePatch(patchInput)
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "叙事字段非法",
        })
      }

      return prisma.$transaction(async (tx) => {
        // 属主条件写进查询条件（与 `assertOwnedDecision` 是同一条边界），但这里
        // 必须在**事务里**读快照：快照 → 留痕 → 更新同事务（ADR-0012）。
        const before = await tx.decision.findFirst({
          where: { id: decisionId, userId: ctx.userId },
        })
        if (!before) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: NOT_FOUND_MESSAGE,
          })
        }

        const revisions = planNarrativeRevisions(before, patch)
        const missingReason = missingRevisionReason(
          revisions,
          reason ?? undefined,
        )
        if (missingReason) {
          throw new TRPCError({ code: "BAD_REQUEST", message: missingReason })
        }

        if (revisions.length > 0) {
          await tx.revision.createMany({
            data: revisions.map((revision) => ({
              decisionId,
              field: revision.field,
              oldValue: revision.oldValue,
              newValue: revision.newValue,
              reason,
            })),
          })
        }

        return tx.decision.update({ where: { id: decisionId }, data: patch })
      })
    }),

  /**
   * 写入清单部分条目的完成情况（允许只报变动的几条），返回重算后的完成度。
   *
   * 返回整个决策的完成度而不是本次提交的结果：调用方（Agent 或界面）真正要知道的
   * 是"这次决策现在漏了哪几步"。
   */
  setRubric: ownedProcedure
    .input(
      z.object({
        decisionId: z.string(),
        entries: z.array(rubricEntryInput),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const decision = await assertOwnedDecision(input.decisionId, ctx.userId)

      const predictions = await prisma.question.findMany({
        where: { decisionId: decision.id },
        select: { id: true, title: true, resolved: true },
      })

      const locking = findLockingPrediction(predictions)
      const lock = rubricLockOf(predictions, decision.rubricLockedAt)
      if (lock.locked) {
        // 顺带记下锁定时点。只写一次、永不回退：结算不可逆，所以锁也是单向的。
        // 先写再抛：写入被拒与"何时开始拒"是两件事，后者对复盘有用。
        if (decision.rubricLockedAt === null) {
          await prisma.decision.update({
            where: { id: decision.id },
            data: { rubricLockedAt: new Date() },
          })
        }

        throw new TRPCError({
          code: "CONFLICT",
          message: locking
            ? `清单已锁定：「${locking.title}」已结算。清单必须在决策当时填写，结果揭晓后就不再可改（ADR-0020）。`
            : // 只剩时点成立：当时导致锁定的那条 Prediction 已经不在了（撤销了结算
              // 或被删掉）。这时更要说明白——否则当事人看到"已锁定"却找不到依据。
              `清单已锁定：该决策的清单已在 ${lock.lockedAt?.toISOString()} 锁定，当时有 Prediction 已结算；那次结算现已被撤销（或该预测已被删掉），但锁定不回退（ADR-0020）。`,
        })
      }

      let entries: RubricEntry[]
      try {
        entries = validateRubricEntries(input.entries, decision.rubricVersion)
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "清单条目非法",
        })
      }

      for (const entry of entries) {
        await prisma.decisionRubricEntry.upsert({
          where: {
            decisionId_itemKey: {
              decisionId: decision.id,
              itemKey: entry.itemKey,
            },
          },
          create: {
            decisionId: decision.id,
            itemKey: entry.itemKey,
            status: entry.status,
          },
          update: { status: entry.status },
        })
      }

      const all = await prisma.decisionRubricEntry.findMany({
        where: { decisionId: decision.id },
      })

      return deriveRubricCompletion(all, decision.rubricVersion)
    }),
})
