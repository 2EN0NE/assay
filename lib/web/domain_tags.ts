import { TRPCError } from "@trpc/server"
import prisma from "../prisma"

/**
 * 领域标签的核心规则（ADR-0030）。放在这里而不是 router 里，因为三处都要用它：
 * 写入口（CLI / Web / agent）、挂接预测时的写时复制、以及改名/删除的引用检查。
 */

/** 判重用的规范化名字：折叠大小写（ADR-0030 §十二）。显示仍保留原样。 */
export function normalizeDomainName(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * 书写规则沿用 Obsidian（ADR-0030 §十二）：允许字母、数字、`_`、`-`、`/` 与
 * Unicode（含中文）；**不允许空格**；必须含至少一个非数字字符。
 *
 * 做成会在非法输入上抛错的函数，而不是"顺手清洗"：把 `投资 宏观` 悄悄变成
 * `投资宏观` 会让用户以为他标的是另一个领域，而这种错误不会报错。
 */
export function assertValidDomainName(raw: string): string {
  const name = raw.trim()
  if (name.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "领域名不能为空" })
  }
  if (/\s/.test(name)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `领域名不能包含空格："${name}"。用 / 分层或 -/_ 连接词（ADR-0030）`,
    })
  }
  if (!/[^\d/]/.test(name)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `领域名必须含至少一个非数字字符："${name}"`,
    })
  }
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `领域名的层级不能以 / 开头/结尾或有空层："${name}"`,
    })
  }
  return name
}

/**
 * 把领域名解析成**已存在**的标签行。
 *
 * 未知名字 ⇒ 大声失败（ADR-0030 §七）：agent 不得因为顺手而造词，否则一个月后
 * 会得到一堆各 1–2 条样本的领域，分桶曲线永远拟合不出来，而且这个失败是静默的。
 * 新词只有一个入口：用户确认后的 `addDomain`。
 */
export async function resolveExistingDomains(
  userId: string,
  names: string[],
): Promise<{ id: string; name: string }[]> {
  const normalized = Array.from(new Set(names.map(normalizeDomainName)))
  const found = await prisma.tag.findMany({
    where: { userId, nameNormalized: { in: normalized } },
    select: { id: true, name: true, nameNormalized: true },
  })
  const missing = normalized.filter(
    (name) => !found.some((tag) => tag.nameNormalized === name),
  )
  if (missing.length > 0) {
    const known = await prisma.tag.findMany({
      where: { userId },
      select: { name: true },
      orderBy: { name: "asc" },
    })
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        `未知领域：${missing.join("、")}。` +
        (known.length > 0
          ? `现有领域：${known.map((tag) => tag.name).join("、")}。`
          : "当前还没有任何领域。") +
        "如果确实要新建，先问用户确认，再用 addDomain 建立它（ADR-0030 §七）。",
    })
  }
  return found.map((tag) => ({ id: tag.id, name: tag.name }))
}

/**
 * 写时复制（ADR-0030 §三）：把该决策**此刻**的领域复制到一条预测上。
 *
 * 只做并集，不做替换：预测本可以有自己的标签（例如上游的按题标签），
 * 领域是叠加在它上面的一层，不是覆盖它。
 */
export async function propagateDecisionDomainsToQuestion(
  decisionId: string,
  questionId: string,
): Promise<number> {
  const decision = await prisma.decision.findUnique({
    where: { id: decisionId },
    select: { tags: { select: { id: true } } },
  })
  if (!decision || decision.tags.length === 0) {
    return 0
  }

  await prisma.question.update({
    where: { id: questionId },
    data: {
      tags: { connect: decision.tags.map((tag) => ({ id: tag.id })) },
    },
  })
  return decision.tags.length
}

/** 对一条决策下**全部**预测做写时复制（显式改标时用，ADR-0030 §五/§九）。 */
export async function propagateDecisionDomains(
  decisionId: string,
): Promise<number> {
  const questions = await prisma.question.findMany({
    where: { decisionId },
    select: { id: true },
  })
  let touched = 0
  for (const question of questions) {
    const count = await propagateDecisionDomainsToQuestion(
      decisionId,
      question.id,
    )
    if (count > 0) {
      touched += 1
    }
  }
  return touched
}

/**
 * "未标领域"的判据（ADR-0030 §八）。抽出来是因为要它的地方不止一处：
 * 列表（`tagsRouter.listUntaggedDecisions`）与到期提醒里那一行计数
 * （`agentRouter.listDue`）必须用同一个判据，否则两处迟早各说各话。
 *
 * 返回结构就地写出来而不是引入 `Prisma` 类型：空对象在这个 `where` 里的含义
 * 就是"没有任何标签"，它不需要类型系统再解释一遍。
 */
export function untaggedDecisionWhere(userId: string): {
  userId: string
  tags: { none: Record<string, never> }
} {
  return { userId, tags: { none: {} } }
}
