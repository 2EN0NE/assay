import {
  missingRevisionReason,
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
