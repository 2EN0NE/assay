import {
  CURRENT_RUBRIC_VERSION,
  RUBRIC_VERSIONS,
  RubricEntry,
  completionOfItems,
  deriveRubricCompletion,
  findLockingPrediction,
  rubricItemsOf,
  rubricLockOf,
  rubricStatusOf,
  rubricWrittenAfterOutcome,
  validateRubricEntries,
} from "./decision_rubric"

/**
 * 版本表被**整张钉住**：这一条是 ADR-0020 第四点的结构保证，而不是一句约定。
 *
 * 想删/改一条既有条目时，这里会红——那正是提醒"要新建一个版本"，而不是去改
 * 历史：历史决策按自己的版本解释，改表等于把它们的分数静默重算一遍。
 */
describe("RUBRIC_VERSIONS（ADR-0020 第四点：表只增不改）", () => {
  it("既有版本的条目列表逐字钉住（改一行就红）", () => {
    expect(RUBRIC_VERSIONS).toEqual([
      {
        version: 1,
        items: [
          { key: "alternatives", label: "备选方案 ≥ 2" },
          { key: "premortem", label: "事前剖析" },
          { key: "baseRate", label: "参考基准率" },
          { key: "whatIfWrong", label: "写下「我可能错在哪」" },
          { key: "falsifiableCriteria", label: "判据可证伪且已冻结" },
        ],
      },
    ])
  })

  it("当前版本是表尾——新建的决策记它", () => {
    expect(CURRENT_RUBRIC_VERSION).toBe(
      RUBRIC_VERSIONS[RUBRIC_VERSIONS.length - 1].version,
    )
  })

  it("未知版本抛错，而不是回退到当前版本（静默改写历史语义正是要防的事）", () => {
    expect(() => rubricItemsOf(999)).toThrow(/未知的决策版本/)
  })
})

describe("validateRubricEntries（ADR-0020：只认该决策版本的条目，只有二值）", () => {
  it("未知条目被拒——不能往库里写一个不存在的清单项", () => {
    expect(() =>
      validateRubricEntries(
        [{ itemKey: "notAThing", status: "DONE" }],
        CURRENT_RUBRIC_VERSION,
      ),
    ).toThrow(/未知清单条目/)
  })

  it("报错信息带上决策版本：拒绝的理由是「不属于这个版本」，不只是「不认识」", () => {
    expect(() =>
      validateRubricEntries([{ itemKey: "notAThing", status: "DONE" }], 1),
    ).toThrow(/决策版本 1/)
  })

  it("合法的二值组合原样通过", () => {
    const entries: RubricEntry[] = [
      { itemKey: "alternatives", status: "DONE" },
      { itemKey: "premortem", status: "NOT_DONE" },
    ]

    expect(validateRubricEntries(entries, CURRENT_RUBRIC_VERSION)).toEqual(
      entries,
    )
  })
})

describe("rubricStatusOf（同一条目以最后一次记录为准）", () => {
  it("没记录过的条目返回 undefined，而不是当成没做到", () => {
    expect(rubricStatusOf([], "premortem")).toBeUndefined()
  })

  it("重复记录时取最后一次——路由与页面因此不会各判一个答案", () => {
    expect(
      rubricStatusOf(
        [
          { itemKey: "premortem", status: "NOT_DONE" },
          { itemKey: "premortem", status: "DONE" },
        ],
        "premortem",
      ),
    ).toBe("DONE")
  })
})

describe("completionOfItems（ADR-0016：分值由完成度推导）", () => {
  const currentItems = rubricItemsOf(CURRENT_RUBRIC_VERSION)

  it("5 项做到 3 项 ⇒ 完成度 3/5，并指出漏了哪两条", () => {
    const completion = completionOfItems(
      [
        { itemKey: "alternatives", status: "DONE" },
        { itemKey: "premortem", status: "DONE" },
        { itemKey: "baseRate", status: "DONE" },
        { itemKey: "whatIfWrong", status: "NOT_DONE" },
        { itemKey: "falsifiableCriteria", status: "NOT_DONE" },
      ],
      currentItems,
    )

    expect(completion).toEqual({
      done: 3,
      total: 5,
      missing: ["whatIfWrong", "falsifiableCriteria"],
    })
  })

  it("诊断力：没记录的条目算作漏掉的那一步，而不是从分母里消失", () => {
    const completion = completionOfItems(
      [{ itemKey: "alternatives", status: "DONE" }],
      currentItems,
    )

    expect(completion.done).toBe(1)
    expect(completion.total).toBe(5)
    expect(completion.missing).toEqual([
      "premortem",
      "baseRate",
      "whatIfWrong",
      "falsifiableCriteria",
    ])
  })

  it("分母完全由传入的条目集合决定——所以调用方必须传决策**自己的**版本", () => {
    // 同一个决策的记录，换成另一个版本的条目集合，分数就会变。
    // 这正是为什么 deriveRubricCompletion 强制要求 rubricVersion：
    // 只要调用方传对了版本，"删掉一条不会让历史分变好看"就是结构事实。
    const entries: RubricEntry[] = [
      { itemKey: "alternatives", status: "DONE" },
      { itemKey: "legacyItemRemovedInV2", status: "NOT_DONE" },
    ]
    const v1Items = [
      { key: "alternatives", label: "备选方案 ≥ 2" },
      { key: "legacyItemRemovedInV2", label: "后来被删掉的条目" },
    ]
    const v2Items = [{ key: "alternatives", label: "备选方案 ≥ 2" }]

    expect(completionOfItems(entries, v1Items)).toEqual({
      done: 1,
      total: 2,
      missing: ["legacyItemRemovedInV2"],
    })
    expect(completionOfItems(entries, v2Items)).toEqual({
      done: 1,
      total: 1,
      missing: [],
    })
  })
})

describe("deriveRubricCompletion（按决策所属版本计分）", () => {
  it("等于按该版本条目集合算出的完成度", () => {
    const entries: RubricEntry[] = [{ itemKey: "alternatives", status: "DONE" }]

    expect(deriveRubricCompletion(entries, CURRENT_RUBRIC_VERSION)).toEqual(
      completionOfItems(entries, rubricItemsOf(CURRENT_RUBRIC_VERSION)),
    )
  })

  it("版本未知即抛错——不做任何回退猜测", () => {
    expect(() => deriveRubricCompletion([], 999)).toThrow(/未知的决策版本/)
  })
})

describe("rubricLockOf（ADR-0020：锁定态只有一个算法）", () => {
  const unresolved = { id: "q1", title: "还没结算", resolved: false }
  const resolved = { id: "q2", title: "6 月底前收到 offer", resolved: true }
  const lockedAt = new Date("2026-01-01T00:00:00Z")

  it("事实与时点都不成立 ⇒ 不锁定，且没有可指名的预测", () => {
    expect(rubricLockOf([unresolved], null)).toEqual({
      locked: false,
      byPredictionId: null,
      byPredictionTitle: null,
      lockedAt: null,
    })
  })

  it("任一结算 ⇒ 锁定，并指名是哪条关上了门", () => {
    expect(rubricLockOf([unresolved, resolved], null)).toEqual({
      locked: true,
      byPredictionId: "q2",
      byPredictionTitle: "6 月底前收到 offer",
      lockedAt: null,
    })
  })

  it("事实侧消失（撤销结算）但时点还在 ⇒ 仍然锁定，只是没有可指名的预测", () => {
    // `undoQuestionResolution` 把 resolved 置回 false。只看事实的实现会在这里
    // 把门重新打开——这正是加进 rubricLockedAt 的理由。
    expect(rubricLockOf([unresolved], lockedAt)).toEqual({
      locked: true,
      byPredictionId: null,
      byPredictionTitle: null,
      lockedAt,
    })
  })
})

describe("rubricWrittenAfterOutcome（ADR-0020 第六点：披露「结果揭晓后才写」）", () => {
  const outcomeAt = new Date("2026-01-02T00:00:00Z")

  it("清单写在结算之前 ⇒ 不披露：那确实是决策当时写的", () => {
    expect(
      rubricWrittenAfterOutcome(
        [
          {
            itemKey: "premortem",
            recordedAt: new Date("2026-01-01T00:00:00Z"),
          },
        ],
        outcomeAt,
      ),
    ).toBeNull()
  })

  it("有写在结算之后的 ⇒ 披露最早的那条时点", () => {
    expect(
      rubricWrittenAfterOutcome(
        [
          {
            itemKey: "premortem",
            recordedAt: new Date("2026-01-01T00:00:00Z"),
          },
          { itemKey: "baseRate", recordedAt: new Date("2026-01-05T00:00:00Z") },
          {
            itemKey: "whatIfWrong",
            recordedAt: new Date("2026-01-03T00:00:00Z"),
          },
        ],
        outcomeAt,
      ),
    ).toEqual(new Date("2026-01-03T00:00:00Z"))
  })

  it("揭晓时点未知 ⇒ 一律披露（误披露比漏披露安全）", () => {
    const entries = [
      { itemKey: "premortem", recordedAt: new Date("2026-01-05T00:00:00Z") },
      { itemKey: "baseRate", recordedAt: new Date("2026-01-09T00:00:00Z") },
    ]

    expect(rubricWrittenAfterOutcome(entries, null)).toEqual(
      new Date("2026-01-05T00:00:00Z"),
    )
  })

  it("一条清单都没写 ⇒ 没什么可披露的", () => {
    expect(rubricWrittenAfterOutcome([], outcomeAt)).toBeNull()
  })
})

/**
 * ADR-0020 的第一条不变量：决策质量分**只**依赖清单完成情况，不读任何结算结果，
 * 也不进任何排行榜。
 *
 * 它不用测试表达：断言源码文本会命中注释（误报）、又会漏掉经 barrel 的 re-export，
 * 而且它本身就是 S1–S4 之外的新 seam。改用 ESLint 的 `no-restricted-imports`
 * （AST 语义、已被既有门禁覆盖），见 `.eslintrc.json` 的 overrides。
 */
describe("findLockingPrediction（ADR-0020：结算即锁）", () => {
  const unresolved = { id: "q1", title: "还没结算", resolved: false }
  const resolved = { id: "q2", title: "6 月底前收到 offer", resolved: true }

  it("一条都没结算 ⇒ 不锁定，清单还能改", () => {
    expect(findLockingPrediction([unresolved])).toBeNull()
    expect(findLockingPrediction([])).toBeNull()
  })

  it("任一结算 ⇒ 锁定，并指出是哪条关上了这扇门", () => {
    expect(findLockingPrediction([unresolved, resolved])).toEqual(resolved)
  })
})
