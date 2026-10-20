import Link from "next/link"
import { useSession } from "next-auth/react"
import { Questions } from "../components/Questions"
import { TrackRecord } from "../components/TrackRecord"
import { WhyForecastInfo } from "../components/WhyForecastInfo"
import { Predict } from "../components/predict-form/Predict"
import { QuickFeedback } from "../components/ui/QuickFeedback"
import { useUserId } from "../lib/web/utils"
import { api } from "../lib/web/trpc"
import { OnboardingChecklist } from "../components/OnboardingChecklist"
import { PredictProvider } from "../components/predict-form/PredictProvider"

export default function HomePage() {
  const { status: sessionStatus } = useSession()
  const userId = useUserId()

  return (
    <div className="max-md:flex-col gap-8 lg:gap-12 flex justify-center px-4 lg:pt-4 mx-auto max-w-6xl">
      <PredictProvider>
        <div className="prose mx-auto pt-12 lg:w-[650px]">
          {!userId && sessionStatus !== "loading" && (
            <>
              <h3 className="text-neutral-600">
                Track your predictions, make better decisions
              </h3>
            </>
          )}

          <Predict />
          <Questions />

          {sessionStatus !== "loading" && !userId && <WhyForecastInfo />}
        </div>
        <Sidebar />
      </PredictProvider>
    </div>
  )
}

function Sidebar() {
  const userId = useUserId()

  // NB: hidden on mobile, stats.tsx is shown instead
  return (
    <div className="max-md:hidden flex flex-col gap-12 max-w-[400px]">
      <div className="min-h-28">{userId && <OnboardingChecklist />}</div>
      {userId && <BriefCard />}
      <div className="max-w-[320px] flex flex-col gap-12 ml-auto lg:w-[320px]">
        {userId && <TrackRecord trackRecordUserId={userId} />}
        {userId && (
          <QuickFeedback
            type="nano-fatebook-agent feedback"
            placeholder="Give feedback on nano-fatebook-agent..."
            style="textarea"
          />
        )}
      </div>
    </div>
  )
}

/**
 * 状态简报（ADR-0039）：与 agent 每轮看到的是**同一份** `agent.brief`。
 *
 * 它放在这里的目的不是好看，而是"可被人类核对"——agent 说"未结算 38"时，
 * 你能在网页上看见同一个 38。若两者各算一遍，不一致时不会报错，只会让人
 * 不再相信任何一个数字。
 *
 * 读不到时**照写原因**：读不到与"没有待办"必须长得不一样（ADR-0040 第四点）。
 */
function BriefCard() {
  const brief = api.agent.brief.useQuery()

  if (brief.isLoading) {
    return <div className="text-sm text-neutral-500">读取当前状态…</div>
  }

  if (brief.error || !brief.data) {
    return (
      <div className="alert alert-warning text-sm">
        状态不可得：{brief.error?.message ?? "没有返回数据"}
      </div>
    )
  }

  const data = brief.data

  return (
    <div className="rounded-box border border-base-300 p-4 text-sm">
      <h2 className="font-semibold">当前状态</h2>

      <p className="mt-2">
        未结算 {data.due.unsettled}：逾期 {data.due.overdue} / 一周内{" "}
        {data.due.within1w} / 一月内 {data.due.within1m} / 一月以上{" "}
        {data.due.beyond1m}
      </p>

      {data.nearest.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-neutral-600">
          {data.nearest.map((prediction) => (
            <li key={prediction.id}>
              <Link className="link" href={`/q/${prediction.id}`}>
                {prediction.title}
              </Link>
              （{prediction.dueAt.toLocaleDateString()} 到期）
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-neutral-500">
        清单有未记录条目：可救 {data.rubricNeverRecorded.unfrozen} / 已冻结{" "}
        {data.rubricNeverRecorded.frozen}
      </p>
      <p className="text-neutral-500">
        未标领域 {data.untaggedDecisions}｜未背书数字 {data.unendorsedForecasts}
        ｜无预测的决策 {data.decisionsWithoutPredictions}
      </p>

      {/* 动作与预测是两种单位，分开报（ADR-0041 §四）：承诺逾期比"世界该给答案了"
          更该动手，因此逾期排在最前，且不占上面那三条明细位。 */}
      <p className="mt-2 text-neutral-500">
        动作：逾期 {data.actions.overdue}｜计划中 {data.actions.planned}｜已执行{" "}
        {data.actions.executed}｜已放弃 {data.actions.abandoned}
      </p>

      {/* 下钻命令随返回给出，这里原样列出（ADR-0039 第六点）：不在这里手抄命令，
          否则文档一改它就成了假话，而 `docs_commands.test.ts` 守不到手抄的那一份。 */}
      <details className="mt-2 text-xs text-neutral-500">
        <summary className="cursor-pointer">下钻命令</summary>
        <ul className="mt-1 space-y-1 font-mono text-[11px]">
          {Object.entries(data.seeAlso).map(([key, command]) => (
            <li key={key}>{command}</li>
          ))}
        </ul>
      </details>

      <Link className="link mt-2 inline-block text-xs" href="/decisions">
        查看全部决策
      </Link>
    </div>
  )
}
