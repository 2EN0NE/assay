import { TRPCError } from "@trpc/server"
import type { Prisma } from "@prisma/client"
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
  decisionLockOf,
  derivableRubricEvidence,
  rubricWrittenAfterOutcome,
  validateRubricEntries,
} from "./decision_rubric"
import { ownedProcedure, router } from "./trpc_base"
import {
  propagateDecisionDomainsToQuestion,
  resolveExistingDomains,
} from "./domain_tags"
import {
  actionStateOf,
  executionConflict,
  normalizeActionText,
} from "./decision_action"
import {
  missingRevisionReason,
  planActionRevisions,
  planNarrativeRevisions,
} from "./revisions"
import { settlementLabelOf, settlementScopeOf } from "./settlement_scope"

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
    .input(
      narrativeInput.extend({
        domains: z.string().array().optional(),
        // ADR-0041：动作是"当初的记录"的一半，与叙事同时写下。
        action: z.string().nullish(),
        actionDueAt: z.date().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // 先把校验/归一化跑完再落库：非法叙事不该留下任何痕迹。
      const narrative = toNarrative(input)
      const action = normalizeActionText(input.action)
      const actionDueAt = input.actionDueAt ?? null
      if (actionDueAt !== null && action === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "给了承诺时点却没有动作：--action-due 必须与 --action 一起给出（ADR-0041）",
        })
      }
      // ADR-0030 §七：未知领域大声失败（由此处解析），绝不静默造词。
      const domains = input.domains?.length
        ? await resolveExistingDomains(ctx.userId, input.domains)
        : []
      // 注意用 unchecked 变体：原写法给的是 `userId` 标量，checked 变体只认
      // `user: { connect }`——注解选错变体会把一次纯新增变成一个改形状的重构。
      const data: Prisma.DecisionUncheckedCreateInput = {
        userId: ctx.userId,
        ...narrative,
        action,
        actionDueAt,
        // ADR-0020 第四点：新建的决策记下它属于哪个决策版本。之后条目集合演进
        // （新增 / 删除条目）不会改写它的分。
        rubricVersion: CURRENT_RUBRIC_VERSION,
      }
      if (domains.length > 0) {
        data.tags = { connect: domains.map((tag) => ({ id: tag.id })) }
      }
      const created = await prisma.decision.create({ data })
      return created
    }),

  list: ownedProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(100).optional(),
        /**
         * 只列「清单从未记录」的决策（ADR-0038 的读数，`list-decisions --rubric-missing`
         * 的下钻）。它与简报那一栏用**同一个派生**，否则两个地方会说两套话。
         */
        rubricMissing: z.boolean().optional(),
        /**
         * 只列"承诺到期却没执行也没放弃"的决策（ADR-0041 的下钻）。
         * 判定用 `actionStateOf`，与简报同一处派生。
         */
        actionOverdue: z.boolean().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const now = new Date()
      const filteredInMemory = input.rubricMissing || input.actionOverdue

      const decisions = await prisma.decision.findMany({
        where: { userId: ctx.userId },
        orderBy: { createdAt: "desc" },
        // 过滤要在内存里做：判定依赖每个决策**自己的** `rubricVersion`（代码常量）
        // 与动作状态的"现在已经过了吗"，Prisma 都没有可比较的列。因此过滤时不先截断。
        take: filteredInMemory ? undefined : input.limit ?? 20,
        include: {
          rubricEntries: true,
          questions: { select: { id: true, title: true, resolved: true } },
          executions: { select: { kind: true, occurredAt: true } },
        },
      })

      const items = decisions.map((decision) => ({
        id: decision.id,
        statement: decision.statement,
        createdAt: decision.createdAt,
        // 该决策计分时适用的条目集合版本（ADR-0020 第四点）
        rubricVersion: decision.rubricVersion,
        rubric: deriveRubricCompletion(
          decision.rubricEntries,
          decision.rubricVersion,
        ),
        rubricLock: decisionLockOf(decision.questions, decision.lockedAt),
        // ADR-0041：动作与它的派生状态（未记录 / 计划中 / 逾期 / 已执行 / 已放弃）
        action: decision.action,
        actionDueAt: decision.actionDueAt,
        actionState: actionStateOf(decision, now),
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

      // 两个 flag 同时给 = **交集**。用三元表达式会让后一个被静默丢弃，
      // 而"静默"正是本仓库最不能容忍的失败方式（ADR-0039 §六）。
      const filtered = items
        .filter(
          (item) => !input.rubricMissing || item.rubric.unrecorded.length > 0,
        )
        .filter(
          (item) => !input.actionOverdue || item.actionState === "OVERDUE",
        )
      return input.limit ? filtered.slice(0, input.limit) : filtered
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
          // ADR-0030：领域权威在 Decision，复盘时当然要看得到它。
          tags: true,
          // 叙事改写的留痕必须在**复盘视图**里看得见，否则留痕没有意义
          // （ADR-0012 的 Consequences）。
          revisions: { orderBy: { createdAt: "asc" } },
          // ADR-0037：事后表达与当初的记录**并列**呈现，两栏不合并
          reflections: { orderBy: { createdAt: "asc" } },
          // ADR-0041：执行事实只增不改，因此按发生顺序列出即可
          executions: { orderBy: { occurredAt: "asc" } },
          questions: {
            include: { questionScores: { where: { userId: ctx.userId } } },
          },
        },
      })
      if (!decision) {
        throw new TRPCError({ code: "NOT_FOUND", message: NOT_FOUND_MESSAGE })
      }

      // ADR-0038 第四点：判据的修订记录挂在 **Question** 上（`Revision.questionId`），
      // 而 `resolutionCriteria` 从不以 `decisionId` 落库。查错表不会报错——它只会让
      // “未被修订”这道守卫永远成立，于是证据行说出一句与库相反的话。
      const criteriaRevisions = await prisma.revision.findMany({
        where: {
          questionId: { in: decision.questions.map((question) => question.id) },
          field: "resolutionCriteria",
        },
        select: { field: true },
      })

      return {
        ...decision,
        questions: decision.questions.map((question) => {
          const { questionScores, ...rest } = question
          return {
            ...rest,
            score: scoreOf(questionScores),
            // ADR-0031 §二/§三：悬空必须**看得出来**，否则“没有计量”与“没有这条
            // 预测”在复盘时不可区分。判定仍然只有 `settlementScopeOf` 一处。
            settlementScope: settlementScopeOf(question, ctx.userId),
            settlementLabel: settlementLabelOf(question, ctx.userId),
          }
        }),
        // 完成度是推导值，不落库（ADR-0020）：落库的分值必然过期。
        // 分母取该决策**所属版本**的条目集合，而不是当前代码版本的——后者会让
        // "条目集合演进"静默改写历史分，而 ADR-0020 要的正是它不被改写。
        rubric: deriveRubricCompletion(
          decision.rubricEntries,
          decision.rubricVersion,
        ),
        rubricLock: decisionLockOf(decision.questions, decision.lockedAt),
        // ADR-0041：动作状态是推导值（不落库）
        actionState: actionStateOf(decision, new Date()),
        // ADR-0038 第四点：库里能核到的事实——**披露，不计分**。
        rubricEvidence: derivableRubricEvidence(
          decision.questions,
          criteriaRevisions,
        ),
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
          resolutionCriteria: true,
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

      // ADR-0030 §三：**写时复制**——挂接那一刻该决策的领域被复制到这条预测上。
      // §四：此后不再回头改它。历史样本按当时的归属解释，就像清单按当时的版本
      // 解释（ADR-0020）一样——允许“顺手重标”就等于允许历史被无声改写。
      await propagateDecisionDomainsToQuestion(decision.id, question.id)

      if (question.resolved) {
        // ADR-0020 第五点：挂上一条已结算的 Prediction 时立刻记下锁定时点，避免出现
        // "锁已生效（判据来自事实）而时点为空"的状态——复盘要用这个时点。
        if (decision.lockedAt === null) {
          await prisma.decision.update({
            where: { id: decision.id },
            data: { lockedAt: new Date() },
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

      // ADR-0038 第五点：能核到的事实出现时**提示而不代填**——分值的唯一写手仍是
      // 记录本身，推导只提供一句"要不要记下来"。已冻结时清单只读，不提示。
      //
      // 冻结判据只有一处实现（`decisionLockOf`）：不能只看刚挂上的这一条——该决策下
      // 另一条预测早已结算、而 `lockedAt` 还没写入的存量行会让这里判成"未冻结"，
      // 于是提示一条注定被 `setRubric` 以 CONFLICT 拒绝的命令。
      const lock = decisionLockOf(
        await prisma.question.findMany({
          where: { decisionId: decision.id },
          select: { id: true, title: true, resolved: true },
        }),
        decision.lockedAt,
      )
      const rubricSuggestions = lock.locked
        ? []
        : derivableRubricEvidence(
            [{ resolutionCriteria: question.resolutionCriteria }],
            // 判据的修订记录挂在 Question 上（`Revision.questionId`）——按 decisionId
            // 查只会永远查不到，于是“未被修订”变成一句无人核验的断言。
            await prisma.revision.findMany({
              where: {
                questionId: question.id,
                field: "resolutionCriteria",
              },
              select: { field: true },
            }),
          )

      return { ...updated, rubricSuggestions }
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
   * 补充/修改叙事（ADR-0012 × ADR-0037）。
   *
   * **揭晓后冻结**：与清单同一个判据、同一个函数（`decisionLockOf`）。冻结时连空白
   * 一并冻结——冻结时是空白，就永远是空白，因为"当时没记"本身就是一条记录。
   * 事后表达走 `recordReflection`：它独立成栏、带时点，不必读时间戳就知道那是
   * 「现在怎么看」而不是「当时怎么想」。
   *
   * 揭晓前仍是"可改、必留痕"（ADR-0012）：**改写（或清空）已填写的内容必须带理由
   * 并留一条修订**；给**空白**字段补写不受限——那不是改写，而是当初就没记。
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
        // ADR-0041：动作属于"当初的记录"，与叙事共用这一条写入路径与留痕规则
        action: z.string().nullish(),
        actionDueAt: z.date().nullish(),
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

      // ADR-0041：动作只纳入"这次真正提到的字段"，与叙事局部更新同一语义。
      const actionPatch: { action?: string | null; actionDueAt?: Date | null } =
        {}
      if (patchInput.action !== undefined) {
        actionPatch.action = normalizeActionText(patchInput.action)
      }
      if (patchInput.actionDueAt !== undefined) {
        actionPatch.actionDueAt = patchInput.actionDueAt ?? null
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

        // ADR-0037：揭晓后叙事连同空白一并冻结。判据与清单**同一个函数**——两处
        // 各写一遍"算不算揭晓"，迟早会给出两个答案。
        const predictions = await tx.question.findMany({
          where: { decisionId },
          select: { id: true, title: true, resolved: true },
        })
        const lock = decisionLockOf(predictions, before.lockedAt)
        const narrativeChanges = Object.entries(patch).some(
          ([key, value]) => value !== (before as Record<string, unknown>)[key],
        )
        const actionChanges =
          (actionPatch.action !== undefined &&
            actionPatch.action !== before.action) ||
          (actionPatch.actionDueAt !== undefined &&
            (actionPatch.actionDueAt?.getTime() ?? null) !==
              (before.actionDueAt?.getTime() ?? null))
        const hasChanges = narrativeChanges || actionChanges
        if (lock.locked && hasChanges) {
          throw new TRPCError({
            code: "CONFLICT",
            message: lock.byPredictionTitle
              ? `叙事已冻结：「${lock.byPredictionTitle}」已结算。揭晓后的事后表达请用 record-reflection——它独立成栏、带时点，不会与当初写下的内容同形（ADR-0037）。`
              : // 只剩时点成立：导致冻结的那条 Prediction 已不在（撤销了结算或被删）。
                // 这时更要说清依据，否则当事人看到"已冻结"却找不到是哪次结算关的门。
                `叙事已冻结：该决策的清单与叙事已于 ${lock.lockedAt?.toISOString()} 冻结，当时有 Prediction 已结算；那次结算现已被撤销（或该预测已被删掉），但冻结不回退（ADR-0037）。事后表达请用 record-reflection。`,
          })
        }

        // 承诺时点不能脱离动作存在（ADR-0041）：否则库里会出现"有个期限但没说做什么"。
        // 三态：`undefined` = 这次没提；`null` = 显式清空；string = 新值。用 `??` 会把
        // "显式清空"并进"没提"，于是清空动作时守卫看的是旧动作——库里留下"有期限没动作"。
        const actionAfterPatch =
          actionPatch.action !== undefined ? actionPatch.action : before.action
        const dueAfterPatch =
          actionPatch.actionDueAt !== undefined
            ? actionPatch.actionDueAt
            : before.actionDueAt
        if (dueAfterPatch !== null && actionAfterPatch === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              '给了承诺时点却没有动作：清空动作时也必须清空 actionDueAt（ADR-0041）。CLI 写法：--action "" --action-due ""',
          })
        }

        const revisions = [
          ...planNarrativeRevisions(before, patch),
          ...planActionRevisions(before, actionPatch),
        ]
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

        return tx.decision.update({
          where: { id: decisionId },
          data: { ...patch, ...actionPatch },
        })
      })
    }),

  /**
   * 事后表达（ADR-0037）：只增不改，且**不设时机门槛**。
   *
   * 为什么没有门槛：ADR-0011 允许"0 条预测"的决策，而放弃一个决策正是最该复盘的
   * 时刻；若要求"揭晓后才能写"，那种决策永远无法复盘。它也不必靠门槛防冒充——
   * 它永远不冒充"当初"：每条自带 `createdAt`，渲染时与当初的记录**分栏并列**。
   *
   * 为什么只增不改：一条可编辑的复盘字段会把同一个病挪个位置——后来的复盘盖掉
   * 前面的复盘，而覆盖同样无声（ADR-0012 的立论）。
   */
  recordReflection: ownedProcedure
    .input(z.object({ decisionId: z.string(), body: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const body = input.body.trim()
      if (body.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "复盘内容不能为空",
        })
      }

      await assertOwnedDecision(input.decisionId, ctx.userId)

      return prisma.decisionReflection.create({
        data: { decisionId: input.decisionId, body },
      })
    }),

  /**
   * 记录一次执行事实（ADR-0041）：**只增不改**，且不设时机门槛。
   *
   * 为什么允许在揭晓后写：多阶段决策里揭晓可能早于最后一次执行（"分三期建仓"，
   * 首期后就有预测结算）。这与承诺半边正好相反——冻结防的是"改写承诺"，
   * 只增防的是"改写事实"。
   */
  recordExecution: ownedProcedure
    .input(
      z.object({
        decisionId: z.string(),
        kind: z.enum(["EXECUTED", "ABANDONED"]),
        /** 事实发生的时点；省略 = 现在。可回填——先做事后记录是常态。 */
        occurredAt: z.date().optional(),
        note: z.string().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const decision = await assertOwnedDecision(input.decisionId, ctx.userId)

      const executions = await prisma.decisionExecution.findMany({
        where: { decisionId: decision.id },
        select: { kind: true, occurredAt: true },
      })

      const conflict = executionConflict(input.kind, {
        ...decision,
        executions,
      })
      if (conflict) {
        throw new TRPCError({ code: "BAD_REQUEST", message: conflict })
      }

      return prisma.decisionExecution.create({
        data: {
          decisionId: decision.id,
          kind: input.kind,
          occurredAt: input.occurredAt ?? new Date(),
          note: input.note?.trim() || null,
        },
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
      const lock = decisionLockOf(predictions, decision.lockedAt)
      if (lock.locked) {
        // 顺带记下锁定时点。只写一次、永不回退：结算不可逆，所以锁也是单向的。
        // 先写再抛：写入被拒与"何时开始拒"是两件事，后者对复盘有用。
        if (decision.lockedAt === null) {
          await prisma.decision.update({
            where: { id: decision.id },
            data: { lockedAt: new Date() },
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
