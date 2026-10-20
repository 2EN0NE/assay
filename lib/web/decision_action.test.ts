import {
  actionStateOf,
  executionConflict,
  normalizeActionText,
} from "./decision_action"

const NOW = new Date("2026-10-19T00:00:00Z")
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000)

const base = {
  action: "以 8.37 卖出 000592",
  actionDueAt: day(1),
  executions: [],
}

describe("actionStateOf（ADR-0041：五态，且「未记录」不是「没做到」）", () => {
  it("没有动作 ⇒ 未记录（缺失，不是否定）", () => {
    expect(
      actionStateOf({ action: null, actionDueAt: null, executions: [] }, NOW),
    ).toBe("UNRECORDED")
    expect(
      actionStateOf({ action: "   ", actionDueAt: null, executions: [] }, NOW),
    ).toBe("UNRECORDED")
  })

  it("有动作、还没到承诺时点 ⇒ 计划中", () => {
    expect(actionStateOf(base, NOW)).toBe("PLANNED")
  })

  it("承诺时点已过、既没执行也没放弃 ⇒ 逾期（这是 brief 要提醒的那一栏）", () => {
    expect(actionStateOf({ ...base, actionDueAt: day(-1) }, NOW)).toBe(
      "OVERDUE",
    )
  })

  it("没有承诺时点的动作永远不逾期——不能拿它当欠账", () => {
    expect(actionStateOf({ ...base, actionDueAt: null }, NOW)).toBe("PLANNED")
  })

  it("有执行事件 ⇒ 已执行", () => {
    expect(
      actionStateOf(
        { ...base, executions: [{ kind: "EXECUTED", occurredAt: day(0) }] },
        NOW,
      ),
    ).toBe("EXECUTED")
  })

  it("放弃是终态：不再报「逾期未做」，否则人会不敢放弃", () => {
    expect(
      actionStateOf(
        {
          ...base,
          actionDueAt: day(-30),
          executions: [{ kind: "ABANDONED", occurredAt: day(-1) }],
        },
        NOW,
      ),
    ).toBe("ABANDONED")
  })

  it("事实优先于声明：手工改库造出「执行 + 放弃」并存时，报已执行", () => {
    expect(
      actionStateOf(
        {
          ...base,
          executions: [
            { kind: "ABANDONED", occurredAt: day(-1) },
            { kind: "EXECUTED", occurredAt: day(0) },
          ],
        },
        NOW,
      ),
    ).toBe("EXECUTED")
  })
})

describe("executionConflict（ADR-0041：事实要保持可解释）", () => {
  it("动作从未写下 ⇒ 拒绝记录执行：无法解释「执行了什么」", () => {
    expect(
      executionConflict("EXECUTED", {
        action: null,
        actionDueAt: null,
        executions: [],
      }),
    ).toMatch(/还没有写下动作/)
  })

  it("已执行 ⇒ 不能再声明放弃", () => {
    expect(
      executionConflict("ABANDONED", {
        ...base,
        executions: [{ kind: "EXECUTED", occurredAt: day(0) }],
      }),
    ).toMatch(/执行与放弃互斥/)
  })

  it("已放弃 ⇒ 不能再记录执行", () => {
    expect(
      executionConflict("EXECUTED", {
        ...base,
        executions: [{ kind: "ABANDONED", occurredAt: day(0) }],
      }),
    ).toMatch(/执行与放弃互斥/)
  })

  it("多阶段执行允许再写一条执行事件（表而不是时点字段的理由）", () => {
    expect(
      executionConflict("EXECUTED", {
        ...base,
        executions: [{ kind: "EXECUTED", occurredAt: day(0) }],
      }),
    ).toBeNull()
  })
})

describe("normalizeActionText", () => {
  it("空白归一为 null：库里不存「填了个空格」这种伪填写", () => {
    expect(normalizeActionText("  ")).toBeNull()
    expect(normalizeActionText(undefined)).toBeNull()
    expect(normalizeActionText("  卖出  ")).toBe("卖出")
  })
})
