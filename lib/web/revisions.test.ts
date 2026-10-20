import {
  missingRevisionReason,
  planActionRevisions,
  planNarrativeRevisions,
  planRevisions,
  RevisionSnapshot,
} from "./revisions"

const before: RevisionSnapshot = {
  resolveBy: new Date("2026-01-01T00:00:00Z"),
  resolutionCriteria: "邮件中出现正式 offer",
  scoringAnchor: null,
}

describe("planRevisions（ADR-0012）", () => {
  it("首次 Forecast 之前的改动不算修订——那时还没有信念可被污染", () => {
    expect(
      planRevisions(before, { resolveBy: new Date("2027-01-01T00:00:00Z") }, 0),
    ).toEqual([])
  })

  it("已有 Forecast 之后改期限会被记录，且旧值可回溯", () => {
    const drafts = planRevisions(
      before,
      { resolveBy: new Date("2027-01-01T00:00:00Z") },
      1,
    )
    expect(drafts).toEqual([
      {
        field: "resolveBy",
        oldValue: "2026-01-01T00:00:00.000Z",
        newValue: "2027-01-01T00:00:00.000Z",
      },
    ])
  })

  it("改判据会被记录；判据是 drift 风险最高的字段", () => {
    const drafts = planRevisions(before, { resolutionCriteria: "我说了算" }, 2)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      field: "resolutionCriteria",
      oldValue: "邮件中出现正式 offer",
      newValue: "我说了算",
    })
  })

  it("可以为 null 的字段（评分锚点）也能从空到有地留痕", () => {
    const drafts = planRevisions(before, { scoringAnchor: "5 分=明确达标" }, 1)
    expect(drafts).toEqual([
      { field: "scoringAnchor", oldValue: null, newValue: "5 分=明确达标" },
    ])
  })

  it("没传的字段不参与比较；没有实际变化则不产生记录", () => {
    expect(planRevisions(before, {}, 1)).toEqual([])
    expect(
      planRevisions(before, { resolveBy: new Date("2026-01-01T00:00:00Z") }, 1),
    ).toEqual([])
    expect(
      planRevisions(before, { resolutionCriteria: "邮件中出现正式 offer" }, 1),
    ).toEqual([])
  })

  it("同一次改动里多个字段各自成条", () => {
    const drafts = planRevisions(
      before,
      {
        resolveBy: new Date("2027-01-01T00:00:00Z"),
        resolutionCriteria: "改成我说了算",
        scoringAnchor: "7 分=达标",
      },
      3,
    )
    expect(drafts.map((d) => d.field).sort()).toEqual([
      "resolutionCriteria",
      "resolveBy",
      "scoringAnchor",
    ])
  })
})

describe("missingRevisionReason（ADR-0012：变更冻结字段必须给理由）", () => {
  const drafts = [
    {
      field: "resolutionCriteria" as const,
      oldValue: "邮件中出现正式 offer",
      newValue: "口头确认也算",
    },
  ]

  it("没有实际变更时不要求理由（没有留痕，就没有理由可言）", () => {
    expect(missingRevisionReason([], undefined)).toBeNull()
  })

  it("缺理由 / 空字符串 / 纯空白一律拒绝，并指出涉及哪些字段", () => {
    const message = missingRevisionReason(drafts, undefined)
    expect(message).toMatch(/resolutionCriteria/)
    expect(message).toMatch(/ADR-0012/)
    expect(missingRevisionReason(drafts, "")).not.toBeNull()
    expect(missingRevisionReason(drafts, "   ")).not.toBeNull()
  })

  it("给出实质理由即通过", () => {
    expect(
      missingRevisionReason(drafts, "判据写错了，改回可证伪的版本"),
    ).toBeNull()
  })
})

describe("planNarrativeRevisions（ADR-0012 × ADR-0020：补写自由，改写必留痕）", () => {
  const narrative = {
    statement: "接这个 offer",
    reasoning: "当时觉得团队靠谱",
    expectedOutcome: "半年内上手",
    knownInfo: null,
    unknownInfo: null,
  }

  it("没提到的字段不算改动——局部更新不会把别处抹掉", () => {
    expect(planNarrativeRevisions(narrative, {})).toEqual([])
  })

  it("给空白字段补写不算改写：那不是改写，而是当初就没记", () => {
    expect(
      planNarrativeRevisions(narrative, {
        knownInfo: "赛道里有一个直接竞品",
        unknownInfo: "会不会被收购",
      }),
    ).toEqual([])
  })

  it("值与原来相同 ⇒ 无可留痕", () => {
    expect(
      planNarrativeRevisions(narrative, { reasoning: "当时觉得团队靠谱" }),
    ).toEqual([])
  })

  it("改写已填写的内容 ⇒ 一条修订，旧值新值都在", () => {
    expect(
      planNarrativeRevisions(narrative, { reasoning: "当时觉得团队一般" }),
    ).toEqual([
      {
        field: "reasoning",
        oldValue: "当时觉得团队靠谱",
        newValue: "当时觉得团队一般",
      },
    ])
  })

  it("清空已填写的内容也算改写（新值为 null）", () => {
    expect(
      planNarrativeRevisions(narrative, { expectedOutcome: null }),
    ).toEqual([
      { field: "expectedOutcome", oldValue: "半年内上手", newValue: null },
    ])
  })

  it("一次改多处 ⇒ 每个被改的字段各一条（补写的那个不在此列）", () => {
    expect(
      planNarrativeRevisions(narrative, {
        unknownInfo: "会不会被收购",
        statement: "换个说法",
      }),
    ).toEqual([
      { field: "statement", oldValue: "接这个 offer", newValue: "换个说法" },
    ])
  })

  it("同一条「改了就必须给理由」的规则也管叙事（共用 missingRevisionReason）", () => {
    const drafts = planNarrativeRevisions(narrative, { reasoning: "改了" })

    expect(missingRevisionReason(drafts, undefined)).toMatch(/必须给出理由/)
    expect(missingRevisionReason(drafts, "因为当初写错了")).toBeNull()
  })
})

describe("planActionRevisions（ADR-0041：与叙事同一条留痕规则）", () => {
  const action = {
    action: "在 10-31 前签字",
    actionDueAt: new Date("2026-10-31T00:00:00Z"),
  }

  it("没提到的字段不算改动——局部更新不会把别处抹掉", () => {
    expect(planActionRevisions(action, {})).toEqual([])
  })

  it("给空白动作补写不算改写：当初就没记，补记不产生漂移", () => {
    expect(
      planActionRevisions(
        { action: null, actionDueAt: null },
        { action: "在 10-31 前签字", actionDueAt: new Date("2026-10-31") },
      ),
    ).toEqual([])
  })

  it("值与原来相同 ⇒ 无可留痕", () => {
    expect(
      planActionRevisions(action, {
        action: "在 10-31 前签字",
        actionDueAt: new Date("2026-10-31T00:00:00Z"),
      }),
    ).toEqual([])
  })

  it("改写已填写的动作 ⇒ 一条修订，旧值新值都在", () => {
    expect(
      planActionRevisions(action, { action: "改成 11-01 前签字" }),
    ).toEqual([
      {
        field: "action",
        oldValue: "在 10-31 前签字",
        newValue: "改成 11-01 前签字",
      },
    ])
  })

  it("清空已填写的动作也算改写（新值为 null）", () => {
    expect(planActionRevisions(action, { action: null })).toEqual([
      { field: "action", oldValue: "在 10-31 前签字", newValue: null },
    ])
  })

  it("改承诺时点同样留痕，且序列化成 ISO（旧值可回溯）", () => {
    expect(
      planActionRevisions(action, {
        actionDueAt: new Date("2026-11-01T00:00:00Z"),
      }),
    ).toEqual([
      {
        field: "actionDueAt",
        oldValue: "2026-10-31T00:00:00.000Z",
        newValue: "2026-11-01T00:00:00.000Z",
      },
    ])
  })

  it("同一条「改了就必须给理由」的规则也管动作（共用 missingRevisionReason）", () => {
    const drafts = planActionRevisions(action, { action: "改了" })

    expect(missingRevisionReason(drafts, undefined)).toMatch(/必须给出理由/)
    expect(missingRevisionReason(drafts, "当初写错了")).toBeNull()
  })
})
