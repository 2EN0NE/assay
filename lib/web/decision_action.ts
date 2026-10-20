/**
 * 决策动作与执行（ADR-0041）。
 *
 * 三个概念必须分开，否则"没做"与"做了但没用"会重新变成同一件事：
 *
 * - **Prediction**：主语是世界（"它会跌回 8.31"），计分；
 * - **Action**：主语是我，在决策当时写下（"今天以 8.37 卖出"），**承诺半边**，
 *   与叙事同一条留痕/冻结规则；
 * - **Execution**：事后记录的事实（做没做、何时做），**只增不改**，不进校准。
 *
 * 本模块只放纯函数：状态推导与归一化。写库留在路由层。
 */

export type ExecutionKind = "EXECUTED" | "ABANDONED"

export type ExecutionRecord = { kind: ExecutionKind; occurredAt: Date }

export type DecisionActionState =
  /** 动作从未写下（与"没做到"不同形：那是缺失，不是否定） */
  | "UNRECORDED"
  /** 写下了，还在承诺期限内，没执行也没放弃 */
  | "PLANNED"
  /** 承诺时点已过，仍没执行也没放弃 */
  | "OVERDUE"
  | "EXECUTED"
  | "ABANDONED"

export type ActionSnapshot = {
  action: string | null
  actionDueAt: Date | null
  executions: ExecutionRecord[]
}

/** 空串与纯空白统一归一为 `null`：库里不存"填了个空格"这种伪填写。 */
export function normalizeActionText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

/**
 * 动作状态的推导（不落库，与 ADR-0020 第三点同一条理由：落库的状态必然过期）。
 *
 * 优先级有讲究：
 * 1. 有 `EXECUTED` ⇒ 已执行。即使同时也有一条 `ABANDONED`（服务端拒绝这种组合，
 *    但手工改库可能造出来），**事实优先于声明**——做过就是做过。
 * 2. 只有 `ABANDONED` ⇒ 已放弃。放弃是**终态**，不再报"逾期未做"：CONTEXT 明确
 *    写着「放弃同样是美德」，把它读成"欠着"会让人不敢放弃。
 * 3. 动作是空白 ⇒ 未记录。**不是"没做到"**（ADR-0038 的同一区分）。
 * 4. 有承诺时点且已过 ⇒ 逾期；否则计划中。
 */
export function actionStateOf(
  snapshot: ActionSnapshot,
  now: Date,
): DecisionActionState {
  // `?? []`：Prisma 会给数组，但手工构造的 fixture 可能整个没有这个键。
  // `undefined.some` 会当场抛错，而"这条决策有没有执行过"不该因为 fixture 缺字段而崩。
  const executions = snapshot.executions ?? []

  if (executions.some((execution) => execution.kind === "EXECUTED")) {
    return "EXECUTED"
  }
  if (executions.some((execution) => execution.kind === "ABANDONED")) {
    return "ABANDONED"
  }
  if (normalizeActionText(snapshot.action) === null) {
    return "UNRECORDED"
  }
  if (
    snapshot.actionDueAt !== null &&
    snapshot.actionDueAt.getTime() < now.getTime()
  ) {
    return "OVERDUE"
  }
  return "PLANNED"
}

/**
 * 一条执行事件能否写入。
 *
 * 返回 `null` 表示可以。三条规则，都是"让事实保持可解释"：
 *
 * 1. **必须先有动作**：动作从未写下时，一条"执行了"无法解释成"执行了什么"。
 * 2. **执行与放弃互斥**：两种声明会互相取消；允许并存等于让状态永远取决于读取顺序。
 * 3. **不设时机门槛**：执行记录可以在揭晓之后写（多阶段执行），这是它与承诺半边
 *    最大的不同（ADR-0041 第三点）。
 */
export function executionConflict(
  nextKind: ExecutionKind,
  snapshot: ActionSnapshot,
): string | null {
  if (normalizeActionText(snapshot.action) === null) {
    return "这条决策还没有写下动作：先写清「做什么」并给一个承诺时点，再记录执行——否则这条执行记录无法解释成「执行了什么」（ADR-0041）"
  }

  const executed = snapshot.executions.some(
    (execution) => execution.kind === "EXECUTED",
  )
  const abandoned = snapshot.executions.some(
    (execution) => execution.kind === "ABANDONED",
  )

  if (nextKind === "ABANDONED" && executed) {
    return "这条决策已经记录过执行，不能再声明放弃：执行与放弃互斥（ADR-0041）。若那次执行记录本身是错的，请再写一条说明，而不是改写事实"
  }
  if (nextKind === "EXECUTED" && abandoned) {
    return "这条决策已经声明放弃，不能再记录执行：执行与放弃互斥（ADR-0041）。若确实做过，请再写一条说明这两件事的关系"
  }
  return null
}
