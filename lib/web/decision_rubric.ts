/**
 * 决策清单（Decision Rubric）——ADR-0016 定"记成可查证的过程清单"，ADR-0020 定怎么存。
 *
 * 为什么不是自评量表：本系统刚为防 `Compliance Number` 给追问设了显式出口
 * （ADR-0010 / ADR-0011），而一个 1–5 分的自评**恰恰就是一个新的敷衍数字**，
 * 且不可查证——3 分与 4 分的区别无人能复核。清单的每一条都是可查证的事实
 * （"有没有写下备选方案"），而且**诊断力更强**：它告诉你漏了哪一步。
 *
 * 因此：
 * - 条目集合是**代码常量**（产品语义，不是用户数据），按**版本**演进、被测试覆盖；
 * - 取值只有二值，没有"不适用"——那会立刻变成自我开脱的口子；
 * - 完成度是**推导值**，因此结构上不可能读取任何结算结果（Decision Quality
 *   与 Outcome Quality 的脱钩不靠约定，靠没有那条数据通路）。
 */

export type RubricItem = { key: string; label: string }

export type RubricVersion = { version: number; items: readonly RubricItem[] }

/**
 * 条目集合的**版本**表（ADR-0020 第四点）。
 *
 * 条目增删**必须新建一个版本**，既有版本的条目列表**不得改写**：历史决策按自己的
 * 版本解释，因此"后来删掉一条"不会让历史分变好看，"后来新增一条"也不会让它掉下来。
 * 表只增不改——这件事由结构保证，不靠自觉：`decision_rubric.test.ts` 把整张表钉住了，
 * 改动任何既有版本都会让它变红。
 */
export const RUBRIC_VERSIONS: readonly RubricVersion[] = [
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
]

/** 当前版本：新建的决策记它。取表尾而不是另写一个常量，免得两处各改一次。 */
export const CURRENT_RUBRIC_VERSION =
  RUBRIC_VERSIONS[RUBRIC_VERSIONS.length - 1].version

/**
 * 某版本的条目集合。
 *
 * 未知版本**抛错而不是回退到当前版本**：回退会把"由更新的代码写下的决策"静悄悄
 * 按旧条目集合解释——正是 ADR-0020 要防的那种历史语义改写。版本只增不删，所以
 * 这个分支只会在代码回滚到旧版本时出现；那时应当当场看见，而不是显示一个错的分数。
 */
export function rubricItemsOf(version: number): readonly RubricItem[] {
  for (const entry of RUBRIC_VERSIONS) {
    if (entry.version === version) {
      return entry.items
    }
  }
  throw new Error(
    `未知的决策版本：${version}（ADR-0020：既有版本的条目列表不得删除，版本只增不减）`,
  )
}

/** 与 Prisma 的 `RubricItemStatus` 枚举一一对应。 */
export type RubricStatus = "DONE" | "NOT_DONE"

/**
 * 一条记录。`itemKey` 是 `string` 而不是某个版本的键联合：读取历史时可能遇到
 * "记录当时属于该决策版本、而当前代码版本已删掉"的条目，它必须仍能被解释
 * （ADR-0020）。
 */
export type RubricEntry = { itemKey: string; status: RubricStatus }

export type RubricCompletion = {
  done: number
  total: number
  /** 漏掉的步骤。这是清单相对一个分值唯一多出来的东西。 */
  missing: string[]
}

function rubricItemKeysOf(version: number): ReadonlySet<string> {
  return new Set(rubricItemsOf(version).map((item) => item.key))
}

/**
 * 写入侧校验：拒绝不属于**该决策版本**的条目。
 *
 * 校验按决策自己的版本做，而不是按当前版本：一个 v1 的决策不该被写进 v2 才有的
 * 条目——它的分数是按 v1 算的，多写一条只会让记录与分数对不上。
 *
 * 读取侧**不能**用这个函数——历史记录里可能有该版本内的条目，那不是错误。
 */
export function validateRubricEntries(
  entries: RubricEntry[],
  version: number,
): RubricEntry[] {
  const known = rubricItemKeysOf(version)
  for (const entry of entries) {
    if (!known.has(entry.itemKey)) {
      throw new Error(
        `未知清单条目：${entry.itemKey}（该决策属于决策版本 ${version}）`,
      )
    }
  }
  return entries
}

/**
 * 某条目最后一次记录的完成状态。
 *
 * 路由重算完成度与页面渲染都要问这个问题，因此只有这一份实现——两处各写一遍
 * 就会在两处各漏一种边界（比如"同一条目被记了两次"）。
 */
export function rubricStatusOf(
  entries: RubricEntry[],
  key: string,
): RubricStatus | undefined {
  let latest: RubricStatus | undefined
  for (const entry of entries) {
    if (entry.itemKey === key) {
      latest = entry.status
    }
  }
  return latest
}

/**
 * 完成度（ADR-0016：分值由清单完成度推导，不落库）。
 *
 * 分母就是给定条目集合，不做任何"并集补偿"：版本已经保证了历史决策按自己的
 * 条目集合解释（删掉一条属于**新**版本的事，旧版本的集合原样留在表里），
 * 再叠一层并集只会掩盖"记录里出现了该版本不该有的键"这种真问题。
 */
export function completionOfItems(
  entries: RubricEntry[],
  items: readonly RubricItem[],
): RubricCompletion {
  const keys = items.map((item) => item.key)
  const missing = keys.filter((key) => rubricStatusOf(entries, key) !== "DONE")

  return { done: keys.length - missing.length, total: keys.length, missing }
}

/**
 * 按该决策**所属版本**算完成度。调用方必须给出决策的 `rubricVersion`——
 * 正是这个参数让"历史分不随条目集合演进被改写"成为结构事实。
 */
export function deriveRubricCompletion(
  entries: RubricEntry[],
  version: number,
): RubricCompletion {
  return completionOfItems(entries, rubricItemsOf(version))
}

/** 带记录时点的一条记录。只有这里的函数需要它。 */
export type TimedRubricEntry = { itemKey: string; recordedAt: Date }

/**
 * 清单里有没有"结果揭晓**之后**才写下"的条目（ADR-0020 第六点）。
 *
 * 返回最早的那条的记录时点。没有则 `null`。
 *
 * 为什么需要它：清单的锁靠"该决策下有已结算的 Prediction"这个事实，而"先建决策 →
 * 补满清单 → 再把它挂上一条已经结算的 Prediction"这条路径上，写清单时该决策名下
 * 空无一物，因此锁无从生效。标记不能让那条路径消失，但能让它**不再与当初填的
 * 同形**——复盘时看得见，就用得着。
 *
 * `outcomeAt` 为 `null`（老数据里揭晓时点缺失）时**一律视为之后**：揭晓时点缺失时
 * 无法证明清单写在前，而标记的作用就是披露，误披露比漏披露安全。
 */
export function rubricWrittenAfterOutcome(
  entries: TimedRubricEntry[],
  outcomeAt: Date | null,
): Date | null {
  let earliest: Date | null = null
  for (const entry of entries) {
    // 揭晓时点未知（`null`，或手工构造的对象里整个缺失）⇒ 一律当作"之后"：
    // 标记的作用是披露，误披露比漏披露安全。
    if (outcomeAt && entry.recordedAt.getTime() <= outcomeAt.getTime()) {
      continue
    }
    if (earliest === null || entry.recordedAt.getTime() < earliest.getTime()) {
      earliest = entry.recordedAt
    }
  }
  return earliest
}

export type LockablePrediction = {
  id: string
  title: string
  resolved: boolean
}

/**
 * 事实侧：该决策下**任一** Prediction 已结算（ADR-0020）。
 *
 * 返回"是哪个预测导致的"，因为拒绝写入时告诉当事人原因比一句"已锁定"有用
 * 得多——他会立刻明白是哪次结算关上了这扇门。
 *
 * 它是锁定判据的**一半**：另一半是已记录的 `rubricLockedAt`（见 `rubricLockOf`）。
 * 两者各补对方的洞——只看事实，撤销结算（`undoQuestionResolution` 把 `resolved`
 * 置回 `false`）就能把门重新打开；只看时点，"结算已发生、时点还没写上"的那
 * 一瞬间会漏。
 */
export function findLockingPrediction(
  predictions: LockablePrediction[],
): LockablePrediction | null {
  for (const prediction of predictions) {
    if (prediction.resolved) {
      return prediction
    }
  }
  return null
}

/**
 * 锁定态。`byPrediction*` 为 null 表示锁不是由"现在还挂着的那条已结算预测"给出的
 * （它被撤销结算或被删了）；`lockedAt` 是已记录的第一个锁定时点。
 *
 * 加进 `lockedAt` 之后，锁在**结构上**不可回退：清单的写入口问的都是这一个函数，
 * 而它一旦记住时就永远记住。
 */
export type RubricLock = {
  locked: boolean
  byPredictionId: string | null
  byPredictionTitle: string | null
  lockedAt: Date | null
}

/**
 * 锁定态 = 事实 ∨ 已记录的时点，只有一个算法——路由写清单、路由返回锁定态、
 * 页面渲染锁定提示，问的都是同一个问题。
 */
export function rubricLockOf(
  predictions: LockablePrediction[],
  recordedLockAt: Date | null,
): RubricLock {
  const locking = findLockingPrediction(predictions)
  // `?? null`：Prisma 给的是 `null`，但手工构造的 Decision 对象（测试、fixture）
  // 可能整个没有这个键。`undefined !== null` 会被读成"锁过"，于是一个从未锁过的
  // 决策会拒绝写入——两个方向的错都不该发生，所以在入口归一到 `null`。
  const lockedAt = recordedLockAt ?? null

  return {
    locked: locking !== null || lockedAt !== null,
    byPredictionId: locking?.id ?? null,
    byPredictionTitle: locking?.title ?? null,
    lockedAt,
  }
}
