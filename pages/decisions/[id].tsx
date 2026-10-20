import { NextSeo } from "next-seo"
import Link from "next/link"
import { useRouter } from "next/router"
import { useState } from "react"
import {
  RubricCompletion,
  RubricEntry,
  RubricItem,
  DecisionLock,
  RubricEvidence,
  rubricItemsOf,
  rubricStatusOf,
} from "../../lib/web/decision_rubric"
import { api } from "../../lib/web/trpc"
import type { DecisionActionState } from "../../lib/web/decision_action"
import { unscoredCauses } from "../../lib/web/settlement_scope"

/**
 * 决策详情页（ADR-0001 / ADR-0019 · ticket 01）。
 *
 * 刻意走 tRPC，而不是像 `q/[id]` 那样在 `getServerSideProps` 里直接查库：
 * 属主边界只在 `decision_router` 里写一份。页面自己再查一次，就等于把
 * "只能读自己的"复制到第二处——漏一处就是越权读。
 *
 * 外层导航由 `_app.tsx` 的 `<Layout>` 统一提供，页面不自带。
 */
export default function DecisionPage() {
  const router = useRouter()
  const decisionId = typeof router.query.id === "string" ? router.query.id : ""

  const decision = api.decision.byId.useQuery(
    { decisionId },
    { enabled: decisionId !== "" },
  )

  return (
    <>
      <NextSeo title="决策" />
      <div className="mx-auto max-w-3xl px-4 py-8">
        {decision.isLoading && <span>Loading...</span>}

        {decision.error && (
          <div className="alert alert-warning">
            找不到该决策（或它不属于当前账号）。
          </div>
        )}

        {decision.data && (
          <article>
            <h1 className="text-2xl font-semibold">
              {decision.data.statement}
            </h1>
            <p className="mt-1 text-sm text-neutral-400">
              记录于 {decision.data.createdAt.toLocaleDateString()}
            </p>
            <NarrativeField label="理由" value={decision.data.reasoning} />
            <NarrativeField
              label="预期后果"
              value={decision.data.expectedOutcome}
            />
            <NarrativeField label="当时已知" value={decision.data.knownInfo} />
            <NarrativeField
              label="当时未知"
              value={decision.data.unknownInfo}
            />

            <DomainsSection
              decisionId={decision.data.id}
              domains={decision.data.tags}
            />

            <RevisionsSection revisions={decision.data.revisions} />

            <ActionSection
              decisionId={decision.data.id}
              action={decision.data.action}
              actionDueAt={decision.data.actionDueAt}
              actionState={decision.data.actionState}
              executions={decision.data.executions}
            />

            {/* 复盘视图：决策时记录与最终结果**并排**（ticket 06）。
                两者并列而不合并——把"决策好"与"运气好"揉成一个数，
                正是整个系统要防的错误（Resulting）。 */}
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <RubricSection
                decisionId={decision.data.id}
                items={rubricItemsOf(decision.data.rubricVersion)}
                recorded={decision.data.rubricEntries}
                completion={decision.data.rubric}
                evidence={decision.data.rubricEvidence}
                lock={decision.data.rubricLock}
                recordedAfterOutcomeAt={
                  decision.data.rubricRecordedAfterOutcomeAt
                }
                reflections={decision.data.reflections}
              />

              <PredictionsSection questions={decision.data.questions} />
            </div>
          </article>
        )}
      </div>
    </>
  )
}

/**
 * 领域（ADR-0030）。
 *
 * 与 CLI 同规则：**补齐（原先无领域）自由，重标（改已标过的）需理由**。
 * 理由栏在重标时必填不是界面礼貌，而是这条规则唯一的执行点——决策的领域
 * 决定它与哪些经验可比，“随手改一下”等于让历史归属无声漂移。
 *
 * 未知领域由服务端大声拒绝（这里只把服务端的话原样显示出来），因为“帮你
 * 改成差不多的名字”正是这条 ADR 要防的事。
 */
function DomainsSection({
  decisionId,
  domains,
}: {
  decisionId: string
  domains: { id: string; name: string }[]
}) {
  const utils = api.useContext()
  const vocabulary = api.tags.listDomains.useQuery()
  const [draft, setDraft] = useState("")
  const [reason, setReason] = useState("")

  const addDomain = api.tags.addDomain.useMutation({
    onSuccess: async () => {
      await utils.tags.listDomains.invalidate()
    },
  })

  const setDomains = api.tags.setDecisionDomains.useMutation({
    onSuccess: async () => {
      await utils.decision.byId.invalidate({ decisionId })
      setDraft("")
      setReason("")
    },
  })

  const isRetag = domains.length > 0
  const parsed = draft
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
  // “词表里没有”只是**显示**用的判断（不分大小写地比一下），权威仍在服务端：
  // 真提交一个未知领域会被拒绝。这里先把它显出来，是为了给一个显式的“新建”动作，
  // 而不是让用户对着拒绝信息猜该怎么办。
  const unknown = parsed.find(
    (name) =>
      !(vocabulary.data ?? []).some(
        (tag) => tag.name.toLowerCase() === name.toLowerCase(),
      ),
  )

  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium">领域</h2>

      {isRetag ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {domains.map((tag) => (
            <li key={tag.id} className="badge badge-outline">
              {tag.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-neutral-400">
          还没有领域。领域决定这条决策与哪些经验可比（ADR-0030）。
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="input input-bordered input-sm"
          list="known-domains"
          placeholder="如 投资/宏观（逗号分隔可多个）"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {/* 词表提示：未知领域会被服务端拒绝，先看见已有词就不容易造出"差不多的"新词。 */}
        <datalist id="known-domains">
          {vocabulary.data
            ?.filter((tag) => tag.decisionCount > 0)
            .map((tag) => <option key={tag.id} value={tag.name} />)}
        </datalist>

        {isRetag && (
          <input
            className="input input-bordered input-sm"
            placeholder="重标理由（必填）"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}

        <button
          className="btn btn-sm"
          disabled={
            parsed.length === 0 ||
            (isRetag && reason.trim() === "") ||
            setDomains.isLoading
          }
          onClick={() =>
            setDomains.mutate({
              decisionId,
              domains: parsed,
              reason: reason.trim() === "" ? undefined : reason.trim(),
            })
          }
        >
          {isRetag ? "重标" : "补齐"}
        </button>

        {/* 造词的唯一入口（ADR-0030 §七）：必须是人按下这个按钮，而不是写入路径
            顺手创建——否则“同名不同桶”会静默长出来。 */}
        {unknown !== undefined && (
          <button
            className="btn btn-sm btn-ghost"
            disabled={addDomain.isLoading}
            onClick={() => addDomain.mutate({ name: unknown })}
          >
            新建领域「{unknown}」
          </button>
        )}
      </div>

      {setDomains.error && (
        <div className="alert alert-warning mt-3 text-sm">
          {setDomains.error.message}
        </div>
      )}
    </section>
  )
}

/**
 * 叙事字段的重写留痕（ADR-0012）。
 *
 * 留痕必须在复盘视图里**看得见**，否则留痕没有意义——它的全部价值在于把
 * "无声的改写"变成"看得见的改写"。所以这里把旧值也显示出来，而不只是说
 * "改过一次"。
 */
function RevisionsSection({
  revisions,
}: {
  revisions: {
    id: string
    field: string
    oldValue: string | null
    newValue: string | null
    reason: string | null
    createdAt: Date
  }[]
}) {
  if (revisions.length === 0) {
    return null
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-neutral-500">
        叙事改写记录（{revisions.length}）
      </h2>
      <p className="mt-1 text-xs text-neutral-400">
        给空白字段补写不留记录（那不是改写，而是当初就没记）；改写或清空已填写的内容
        必须给理由，并留在这里（ADR-0012）。
      </p>
      <ul className="mt-2 space-y-3">
        {revisions.map((revision) => (
          <li key={revision.id} className="border-l-2 pl-3 text-sm">
            <div className="text-xs text-neutral-500">
              {revision.field} · {revision.createdAt.toLocaleString()}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-neutral-400 line-through">
              {revision.oldValue ?? "（空）"}
            </div>
            <div className="whitespace-pre-wrap">
              {revision.newValue ?? "（清空）"}
            </div>
            {revision.reason !== null && (
              <div className="mt-1 text-xs text-neutral-500">
                理由：{revision.reason}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 没填的叙事字段不渲染空壳：复盘时"当时没写"与"写了但是空的"不是一回事，
 * 而后者根本不可能出现（归一化已把空串变成 null）。
 */
function NarrativeField({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  if (value === null) {
    return null
  }

  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-neutral-500">{label}</h2>
      <p className="whitespace-pre-wrap">{value}</p>
    </section>
  )
}

/**
 * 决策动作与执行（ADR-0041）。
 *
 * 承诺半边（要做什么、承诺何时）与叙事同规则：揭晓后冻结。事实半边（做没做）
 * **只增不改**：页面上没有"编辑执行记录"，更正靠再写一条。
 *
 * 为什么"明确放弃"要单独一个按钮：否则放弃会被永久读成"逾期未做"，而 CONTEXT
 * 明确写着「放弃同样是美德」。
 */
const ACTION_STATE_LABEL: Record<DecisionActionState, string> = {
  UNRECORDED: "未记录（这条决策没有写下动作）",
  PLANNED: "计划中",
  OVERDUE: "已过承诺时点，既没执行也没放弃",
  EXECUTED: "已执行",
  ABANDONED: "已放弃（明确）",
}

function ActionSection({
  decisionId,
  action,
  actionDueAt,
  actionState,
  executions,
}: {
  decisionId: string
  action: string | null
  actionDueAt: Date | null
  actionState: DecisionActionState
  executions: {
    id: string
    kind: "EXECUTED" | "ABANDONED"
    occurredAt: Date
    note: string | null
  }[]
}) {
  const utils = api.useContext()
  const record = api.decision.recordExecution.useMutation({
    onSuccess: async () => {
      setNote("")
      await utils.decision.byId.invalidate({ decisionId })
    },
  })

  // 先做事、后记录是常态，所以时点可回填（ADR-0041 §三）。CLI 有 `--at`/`--note`，
  // 这里不提供就等于"能做但说不清什么时候做的"——对等性停在了形式上。
  // 本地日期，不是 UTC：`toISOString()` 在 UTC+8 的清晨会比本地日期早一天，
  // 于是"今天做的"被默认记成昨天（同页其它日期都用 toLocaleDateString）。
  const [at, setAt] = useState(() => new Date().toLocaleDateString("sv-SE"))
  const [note, setNote] = useState("")

  const submit = (kind: "EXECUTED" | "ABANDONED") =>
    record.mutate({
      decisionId,
      kind,
      // 只填到日：取当天正午，避免"深夜填的日期被时区挪到前一天"
      occurredAt: at === "" ? undefined : new Date(`${at}T12:00:00`),
      note: note.trim() === "" ? null : note.trim(),
    })

  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-neutral-500">决策动作</h2>

      {action === null ? (
        <p className="mt-2 text-sm text-neutral-500">
          还没有写下动作。动作是「我做了什么」，与预测（「世界会怎样」）是两件事——
          没有它，「没做」与「做了但没用」在复盘时分不开（ADR-0041）。
        </p>
      ) : (
        <p className="mt-2 whitespace-pre-wrap">
          {action}
          {actionDueAt && (
            <span className="ml-2 text-sm text-neutral-500">
              （承诺 {actionDueAt.toLocaleDateString()} 完成）
            </span>
          )}
        </p>
      )}

      <p className="mt-2 text-sm text-neutral-500">
        状态：{ACTION_STATE_LABEL[actionState]}
      </p>

      {executions.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {executions.map((execution) => (
            <li key={execution.id}>
              <span className="text-neutral-400">
                {execution.occurredAt.toLocaleDateString()}
              </span>{" "}
              {execution.kind === "EXECUTED" ? "执行" : "放弃"}
              {execution.note && `：${execution.note}`}
            </li>
          ))}
        </ul>
      )}

      {action !== null && (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-neutral-500">
              发生日期
              <input
                type="date"
                className="input input-bordered input-xs ml-2"
                value={at}
                onChange={(event) => setAt(event.target.value)}
              />
            </label>
            <label className="flex-1 text-xs text-neutral-500">
              备注（可选）
              <input
                className="input input-bordered input-xs mt-1 w-full"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：对方把签字推到 11-02"
              />
            </label>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="btn btn-xs"
              disabled={record.isLoading}
              onClick={() => submit("EXECUTED")}
            >
              标记已执行
            </button>
            <button
              className="btn btn-xs btn-ghost"
              disabled={record.isLoading}
              onClick={() => submit("ABANDONED")}
            >
              明确放弃
            </button>
          </div>
        </>
      )}

      {record.error && (
        <p className="mt-2 text-sm text-error">{record.error.message}</p>
      )}
    </section>
  )
}

/**
 * 清单以"条目 + 做到与否"呈现，而不是只给一个分值（ADR-0016）。
 *
 * 条目取自该决策**所属决策版本**的条目集合（ADR-0020 第四点），而做到与否取自
 * 记录：因此"条目后来被删掉"时，页面不会把一个做过的旧条目显示成没做到——
 * 旧条目还留在那个版本的条目列表里。
 */
function RubricSection({
  decisionId,
  items,
  recorded,
  completion,
  evidence,
  lock,
  recordedAfterOutcomeAt,
  reflections,
}: {
  decisionId: string
  items: readonly RubricItem[]
  recorded: RubricEntry[]
  completion: RubricCompletion
  /** 库里能核到的事实（ADR-0038 第四点）：披露，不计入完成度 */
  evidence: RubricEvidence[]
  lock: DecisionLock
  /** 清单写在结果揭晓之后的时点标记（ADR-0020 第六点） */
  recordedAfterOutcomeAt: Date | null
  reflections: { id: string; body: string; createdAt: Date }[]
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-500">
        决策清单（完成度 {completion.done}/{completion.total}）
      </h2>
      <ul className="mt-2 space-y-2">
        {items.map((item) => {
          const status = rubricStatusOf(recorded, item.key)
          const fact = evidence.find((entry) => entry.itemKey === item.key)
          return (
            <li key={item.key} className="flex items-start gap-2">
              {/*
                ADR-0038：三态。未记录画成「·」而不是「⬜」——后者读作"没做到"，
                而"没记"与"没做"的对策完全不同（一个改记录习惯，一个改做法）。
              */}
              <span aria-hidden>
                {status === "DONE" ? "✅" : status === "NOT_DONE" ? "❌" : "·"}
              </span>
              <span>
                {item.label}
                {status === undefined && (
                  <span className="ml-2 text-xs text-neutral-400">未记录</span>
                )}
                {fact && (
                  <span className="mt-1 block text-xs text-neutral-500">
                    {fact.evidence}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      {(completion.missing.length > 0 || completion.unrecorded.length > 0) && (
        <p className="mt-2 text-sm text-neutral-500">
          {completion.missing.length > 0 && (
            <>记了「没做到」{completion.missing.length} 步；</>
          )}
          {completion.unrecorded.length > 0 && (
            <>从未记录 {completion.unrecorded.length} 步。</>
          )}
          两者对策不同：前者改做法，后者改记录习惯（ADR-0038）。
        </p>
      )}

      {recordedAfterOutcomeAt !== null && (
        <div className="alert alert-warning mt-3 text-sm">
          这份清单是在<b>结果揭晓之后</b>记录的（
          {recordedAfterOutcomeAt.toLocaleDateString()}）： 它后来挂上的那条
          Prediction 当时已经结算，因此写清单时这个决策名下还没有任何
          预测，锁无从生效。标记出来是为了让它不与「决策当时填的」同形（ADR-0020）。
        </div>
      )}

      {lock.locked && (
        <div className="alert alert-info mt-3 text-sm">
          {lock.byPredictionTitle ? (
            <>
              清单与叙事已冻结：「{lock.byPredictionTitle}
              」已结算。清单必须在决策当时填写，叙事也不能再补写（含空白）——
              事后表达请写在下面的复盘记录里（ADR-0037）。
            </>
          ) : (
            // 事实侧已经不在了（结算被撤销，或那条预测被删掉），但冻结不回退：
            // 这时只说"已冻结"会让当事人找不到依据，所以把时点说清楚。
            <>
              清单与叙事已冻结：该决策已于
              {lock.lockedAt?.toLocaleDateString()} 冻结，当时有 Prediction
              已结算；那次结算现已被撤销（或该预测已被删掉），但冻结不回退
              （ADR-0037）。
            </>
          )}
        </div>
      )}

      <ReflectionSection
        decisionId={decisionId}
        reflections={reflections}
        lockedAt={lock.lockedAt}
      />
    </section>
  )
}

/**
 * 一条复盘记录写在揭晓的哪一侧（ADR-0037）。
 *
 * 只显示 `createdAt` 是不够的：**未揭晓时**写的"复盘"与**揭晓后**写的，读者对它的
 * 期待完全不同——前者仍是判断，后者已经知道结果。标注是派生的、不落库：揭晓时点
 * 本来就可能后移，落库会让标注与事实脱节。
 */
function reflectionSideOf(createdAt: Date, lockedAt: Date | null): string {
  if (lockedAt === null) return "写于揭晓之前（该决策尚未揭晓）"
  return createdAt > lockedAt ? "写于揭晓之后" : "写于揭晓之前"
}

/**
 * 事后表达（ADR-0037）：与当初的记录**分栏并列**，每条自带时点。
 *
 * 只增不改：页面上没有"编辑/删除"入口——一条可编辑的复盘字段会把同一个病挪个
 * 位置（后来的复盘盖掉前面的复盘，而覆盖同样无声）。
 */
function ReflectionSection({
  decisionId,
  reflections,
  lockedAt,
}: {
  decisionId: string
  reflections: { id: string; body: string; createdAt: Date }[]
  /** 揭晓（冻结）时点；`null` = 尚未揭晓。用来标注每条记录相对哪一侧（ADR-0037）。 */
  lockedAt: Date | null
}) {
  const utils = api.useContext()
  const [draft, setDraft] = useState("")

  const record = api.decision.recordReflection.useMutation({
    onSuccess: async () => {
      await utils.decision.byId.invalidate({ decisionId })
      setDraft("")
    },
  })

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-neutral-500">
        复盘记录（事后）
      </h2>

      {reflections.length === 0 && (
        <p className="mt-2 text-sm text-neutral-500">
          还没有事后记录。「现在怎么看」写在这里，它不会与当初写下的内容混同。
        </p>
      )}

      <ul className="mt-2 space-y-3">
        {reflections.map((reflection) => (
          <li key={reflection.id}>
            <p className="text-xs text-neutral-400">
              {reflection.createdAt.toLocaleString()} ·{" "}
              {reflectionSideOf(reflection.createdAt, lockedAt)}
            </p>
            <p className="whitespace-pre-wrap">{reflection.body}</p>
          </li>
        ))}
      </ul>

      <textarea
        className="textarea textarea-bordered mt-3 w-full"
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="现在回看，我当时……"
      />
      <button
        className="btn btn-sm mt-2"
        disabled={draft.trim() === "" || record.isLoading}
        onClick={() => record.mutate({ decisionId, body: draft })}
      >
        写一条复盘
      </button>
      {record.error && (
        <p className="mt-2 text-sm text-error">{record.error.message}</p>
      )}
    </section>
  )
}

/**
 * 结果侧：挂在这个决策下的 Prediction 及其结算状态（ADR-0019）。
 *
 * 与清单并列而不是合成一个数——把"决策好"与"运气好"揉成一个分数，
 * 正是整个系统要防的那个错误（Resulting）。
 */
function PredictionsSection({
  questions,
}: {
  questions: {
    id: string
    title: string
    resolved: boolean
    resolution: string | null
    /** ADR-0031：这次结算对这条预测的处境。推导值，不落库（§六 禁止状态表）。 */
    settlementScope: "UNRESOLVED" | "DANGLING" | "EFFECTIVE"
    /** §二/§三 要求的显示名；没有可挂的标签时为 null */
    settlementLabel: string | null
    /** 逐条分数：取已存的 `QuestionScore` 值，`null` = 没有分数行（US16） */
    score: { absolute: number; relative: number | null } | null
  }[]
}) {
  const resolvedCount = questions.filter((question) => question.resolved).length
  // 两种成因分开说（ADR-0031 §二）：计数与理由都在 `unscoredCauses`（有单测守着）。
  const { dangling: danglingUnscored, ambiguous: ambiguousUnscored } =
    unscoredCauses(questions)

  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-500">
        挂着的预测（{questions.length}）
      </h2>

      {questions.length === 0 && (
        <p className="mt-2 text-sm text-neutral-500">
          还没拆出可验证的命题——这也是一种合法状态（ADR-0011）。
        </p>
      )}

      {questions.length > 0 && resolvedCount === 0 && (
        <p className="mt-2 text-sm text-neutral-500">
          尚未揭晓。结果侧现在是空的，而<b>空不等于 0 分</b>
          ——把判不出来的结果当零损失，等于给它满分。
        </p>
      )}

      {danglingUnscored > 0 && (
        <p className="mt-2 text-sm text-neutral-500">
          {danglingUnscored}{" "}
          条已揭晓但没有计入计量：结算是他人确认的，且没有可核查 来源（ADR-0031
          §二）。补录来源后会自动生效（§五）。
        </p>
      )}

      {ambiguousUnscored > 0 && (
        <p className="mt-2 text-sm text-neutral-500">
          {ambiguousUnscored}{" "}
          条已揭晓但没有分数：判据判不出来时不产生分数（ADR-0018）。
          <b>空不等于 0 分</b>——那会给它满分。
        </p>
      )}

      <ul className="mt-2 space-y-1">
        {questions.map((question) => (
          <li key={question.id} className="flex flex-wrap items-center gap-2">
            <span aria-hidden>{question.resolved ? "🏁" : "⏳"}</span>
            <Link href={`/q/${question.id}`} className="link">
              {question.title}
            </Link>
            {question.resolved && question.resolution !== null && (
              <span className="badge badge-sm">{question.resolution}</span>
            )}
            {question.settlementLabel && (
              <span className="badge badge-sm badge-ghost">
                {question.settlementLabel}
              </span>
            )}
            {question.score && (
              <span className="text-xs text-neutral-500">
                Brier {question.score.absolute.toFixed(3)}
                {question.score.relative === null
                  ? " · 无相对分"
                  : ` · 相对 ${question.score.relative.toFixed(3)}`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
