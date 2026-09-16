/* eslint-disable no-console -- 本脚本的对外契约就是往 stdout 打一段可被管道消费的 JSON 摘要，
   换成仓库的 logger 会往同一路流里掺时间戳/前缀，反而把输出弄坏。 */
/**
 * 把 `lib/web/fixtures/domain_samples.ts` 的合成样本灌进**当前 DATABASE_URL 指向的库**。
 *
 * 用途：UAT 走查需要一个"数字可复算"的库（ticket 06）。单元测试用的是同一份 fixture，
 * 所以文档里贴出来的读数与测试里的断言是同一批数字——两边不会各说各话。
 *
 * 用法（务必先确认 DATABASE_URL 指向 UAT 库，而不是开发库）：
 *
 * ```bash
 * SEED_USER_ID=<一个真实存在的 userId> npx tsx scripts/seed-uat-samples.ts
 * ```
 *
 * 为什么需要 `SEED_USER_ID` 而不是自己建用户：样本要挂在**某个 Owner** 名下，而
 * "谁是 Owner"决定了哪些样本计入（ADR-0031 §六）。自己建用户会让走查者与样本的
 * 归属对不上，于是读数看起来"不对"但其实是查错了人。
 */
import { QuestionType, Resolution } from "@prisma/client"
import prisma from "../lib/prisma"
import { DOMAIN_FIXTURE } from "../lib/web/fixtures/domain_samples"
import { normalizeDomainName } from "../lib/web/domain_tags"

/** 悬空样本的"确认者"：一个与走查者不同的标识即可（该列没有外键）。 */
const OTHER_CONFIRMER = "seed-other-confirmer"
const EVIDENCE_SOURCE = "https://example.org/evidence"

async function main(): Promise<void> {
  const userId = process.env.SEED_USER_ID
  if (!userId) {
    throw new Error(
      "需要 SEED_USER_ID（样本归属的那个 Owner）。先跑 `npm run agent -- init` 拿一个。",
    )
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    throw new Error(`找不到 userId=${userId} 的用户`)
  }

  let created = 0
  for (const entry of DOMAIN_FIXTURE) {
    const nameNormalized = normalizeDomainName(entry.domain)
    const tag = await prisma.tag.upsert({
      where: { nameNormalized_userId: { nameNormalized, userId } },
      update: {},
      create: { name: entry.domain, nameNormalized, userId },
    })

    for (const sample of entry.samples) {
      // 计入判据的样本：带可核查来源 ⇒ 对**所有**押过注的人生效（ADR-0031 §一）
      await prisma.question.create({
        data: {
          id: `seed-${sample.questionId}`,
          userId,
          title: `[UAT 合成样本] ${entry.domain} · ${sample.questionId}`,
          type: QuestionType.BINARY,
          resolveBy: new Date("2025-01-01T00:00:00Z"),
          resolved: true,
          resolution: sample.outcome === 1 ? Resolution.YES : Resolution.NO,
          resolvedAt: new Date("2025-02-01T00:00:00Z"),
          resolutionCriteria: "合成样本：由 fixture 给定结果",
          resolutionSource: EVIDENCE_SOURCE,
          // 有可核查来源 ⇒ 这次结算对所有人生效，确认者是作者还是别人都不影响判定
          //（ADR-0031 §六）。这条 sample 因此计入判据（进 n）。
          confirmedByUserId: userId,
          forecasts: {
            create: {
              userId,
              forecast: sample.forecast,
              endorsed: true,
              endorsedAt: new Date("2025-01-01T00:00:00Z"),
              provenance: "HUMAN",
            },
          },
          tags: { connect: { id: tag.id } },
        },
      })
      created++
    }

    for (const pending of entry.pending) {
      // 悬空样本：已结算、**没有**来源、由他人确认 ⇒ 走查者的样本不进判据（进分母）
      await prisma.question.create({
        data: {
          id: `seed-${pending.questionId}`,
          userId,
          title: `[UAT 合成样本] ${entry.domain} · ${pending.questionId}（悬空）`,
          type: QuestionType.BINARY,
          resolveBy: new Date("2025-01-01T00:00:00Z"),
          resolved: true,
          resolution: Resolution.YES,
          resolvedAt: new Date("2025-02-01T00:00:00Z"),
          resolutionCriteria: "合成样本：由 fixture 给定结果",
          resolutionSource: null,
          // 无来源 + 由他人确认 ⇒ 走查者（押注者）在这条题上的样本**悬空**：
          // 进分母（pending）、不进判据（n）（ADR-0031 §六）。这正是 UAT 读数里
          // “n 与 pending 分开报”要能看见的那一类。
          confirmedByUserId: OTHER_CONFIRMER,
          forecasts: {
            create: {
              userId,
              forecast: 0.5,
              endorsed: true,
              endorsedAt: new Date("2025-01-01T00:00:00Z"),
              provenance: "HUMAN",
            },
          },
          tags: { connect: { id: tag.id } },
        },
      })
      created++
    }
  }

  console.log(
    JSON.stringify(
      {
        userId,
        seeded: created,
        domains: DOMAIN_FIXTURE.map((entry) => ({
          domain: entry.domain,
          samples: entry.samples.length,
          pending: entry.pending.length,
        })),
      },
      null,
      2,
    ),
  )
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
