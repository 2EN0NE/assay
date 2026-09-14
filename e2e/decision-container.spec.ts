import { expect, test } from "@playwright/test"
import prisma from "../lib/prisma"

/**
 * ADR-0019 的删除语义是**数据库级行为**，只能在真库上验。
 *
 * 它此前只有"一次性脚本对开发库实测"的记录——也就是说，把迁移里的 `SetNull` 改成
 * `Cascade`（删决策连带删掉已冻结、可能已计入校准的 Prediction）不会被任何测试发现。
 * 这条用例就是那个回归点，跑在 CI 的 e2e job 里（那里有真 Postgres）。
 */
test("删除决策容器不删预测：外键置空（ADR-0019 的 SetNull）", async () => {
  const email = `e2e-decision-fk+${Date.now()}@example.com`
  const user = await prisma.user.create({ data: { email } })

  try {
    const decision = await prisma.decision.create({
      data: { userId: user.id, statement: "E2E 容器删除回归" },
    })
    const question = await prisma.question.create({
      data: {
        userId: user.id,
        title: "被容器牵连的预测",
        resolveBy: new Date("2030-01-01T00:00:00Z"),
        decisionId: decision.id,
      },
    })

    await prisma.decision.delete({ where: { id: decision.id } })

    const survivor = await prisma.question.findUnique({
      where: { id: question.id },
      select: { id: true, decisionId: true },
    })

    // 预测比容器活得久——删容器不该让已产生的校准样本消失
    expect(survivor).not.toBeNull()
    expect(survivor?.decisionId).toBeNull()

    await prisma.question.delete({ where: { id: question.id } })
  } finally {
    await prisma.user.delete({ where: { id: user.id } })
  }
})

test.afterAll(async () => {
  await prisma.$disconnect()
})
