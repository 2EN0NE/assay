import { NextSeo } from "next-seo"
import Link from "next/link"
import { useRouter } from "next/router"
import {
  RubricCompletion,
  RubricEntry,
  RubricItem,
  RubricLock,
  rubricItemsOf,
  rubricStatusOf,
} from "../../lib/web/decision_rubric"
import { api } from "../../lib/web/trpc"

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

            <RevisionsSection revisions={decision.data.revisions} />

            {/* 复盘视图：决策时记录与最终结果**并排**（ticket 06）。
                两者并列而不合并——把"决策好"与"运气好"揉成一个数，
                正是整个系统要防的错误（Resulting）。 */}
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <RubricSection
                items={rubricItemsOf(decision.data.rubricVersion)}
                recorded={decision.data.rubricEntries}
                completion={decision.data.rubric}
                lock={decision.data.rubricLock}
                recordedAfterOutcomeAt={
                  decision.data.rubricRecordedAfterOutcomeAt
                }
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
 * 清单以"条目 + 做到与否"呈现，而不是只给一个分值（ADR-0016）。
 *
 * 条目取自该决策**所属决策版本**的条目集合（ADR-0020 第四点），而做到与否取自
 * 记录：因此"条目后来被删掉"时，页面不会把一个做过的旧条目显示成没做到——
 * 旧条目还留在那个版本的条目列表里。
 */
function RubricSection({
  items,
  recorded,
  completion,
  lock,
  recordedAfterOutcomeAt,
}: {
  items: readonly RubricItem[]
  recorded: RubricEntry[]
  completion: RubricCompletion
  lock: RubricLock
  /** 清单写在结果揭晓之后的时点标记（ADR-0020 第六点） */
  recordedAfterOutcomeAt: Date | null
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-500">
        决策清单（完成度 {completion.done}/{completion.total}）
      </h2>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            <span aria-hidden>
              {rubricStatusOf(recorded, item.key) === "DONE" ? "✅" : "⬜"}
            </span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
      {completion.missing.length > 0 && (
        <p className="mt-2 text-sm text-neutral-500">
          漏了 {completion.missing.length}{" "}
          步——清单的意义就在于告诉你漏了哪一步。
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
              清单已锁定：「{lock.byPredictionTitle}
              」已结算。清单必须在决策当时填写，
              结果揭晓后不再可改（ADR-0020）——否则复盘材料就能被事后美化。
            </>
          ) : (
            // 事实侧已经不在了（结算被撤销，或那条预测被删掉），但锁不回退：
            // 这时只说"已锁定"会让当事人找不到依据，所以把时点说清楚。
            <>
              清单已锁定：该清单已于
              {lock.lockedAt?.toLocaleDateString()} 锁定，当时有 Prediction
              已结算；那次结算现已被撤销（或该预测已被删掉），但锁定不回退
              （ADR-0020）。
            </>
          )}
        </div>
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
    /** 逐条分数：取已存的 `QuestionScore` 值，`null` = 没有分数行（US16） */
    score: { absolute: number; relative: number | null } | null
  }[]
}) {
  const resolvedCount = questions.filter((question) => question.resolved).length
  // 已揭晓但**没有分数行**：判据判不出来（ADR-0018：AMBIGUOUS 不产生任何分数）。
  // 它跟"未揭晓"必须显示得不一样，否则会被读成零损失 = 满分。
  const unscored = questions.filter(
    (question) => question.resolved && question.score === null,
  ).length

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

      {unscored > 0 && (
        <p className="mt-2 text-sm text-neutral-500">
          {unscored} 条已揭晓但没有分数：判据判不出来时不产生分数（ADR-0018）。
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
