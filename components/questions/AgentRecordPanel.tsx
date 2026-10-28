"use client"

import { clsx } from "clsx"
import { api } from "../../lib/web/trpc"
import { QuestionWithStandardIncludes } from "../../prisma/additional"

/**
 * 决策记录的"Agent 痕迹"面板（ADR-0007、ADR-0008、ADR-0012、ADR-0004）。
 *
 * 存在的唯一理由：让人工 UI 保持最高权威的输入源地位。没有这块界面，
 * "未背书的样本不进校准" 就退化成一条无法履行的规则——你能看到某个数字没被计入，
 * 却无处把它计入。
 */

const ORACLE_LABELS: Record<string, string> = {
  PUBLIC_FACT: "公共事实",
  AGENT_OBSERVABLE: "Agent 可观测",
  SELF_REPORT: "自我报告",
}

// ADR-0008：录入来源区分「Agent 自主搜集」与「依据人的明确指令」
const PROVENANCE_LABELS: Record<string, string> = {
  HUMAN: "人工录入",
  AGENT: "Agent 录入",
  AGENT_INSTRUCTED: "Agent 录入（人已确认）",
}

const FORECAST_PROVENANCE_LABELS: Record<string, string> = {
  HUMAN: "人工",
  AGENT: "Agent 搜集",
  AGENT_INSTRUCTED: "人已确认",
}

export function AgentRecordPanel({
  question,
}: {
  question: QuestionWithStandardIncludes
}) {
  const utils = api.useContext()

  const revisions = api.agent.listRevisions.useQuery({
    questionId: question.id,
  })
  const proposals = api.agent.listProposals.useQuery({
    status: "PENDING",
    questionId: question.id,
  })

  const endorse = api.agent.endorse.useMutation({
    onSuccess: async () => {
      await utils.question.getQuestion.invalidate()
    },
  })
  const decide = api.agent.decideProposal.useMutation({
    onSuccess: async () => {
      await utils.agent.listProposals.invalidate()
      await utils.question.getQuestion.invalidate()
    },
  })

  const unendorsed = question.forecasts.filter((forecast) => !forecast.endorsed)
  // ADR-0011：未量化是合法状态，且必须**可见**——否则"当初逃避了量化"这件事
  // 就无从被矫正（issue 03 的验收）。
  const quantified = question.forecasts.length > 0
  const pendingProposals = proposals.data ?? []
  const revisionList = revisions.data ?? []
  // 记录来源看 `agentSessionId`：`--stated-by-owner` 只说明**数字**是当事人给的，
  // 记录仍是 agent 写的（`Question.provenance` 记的是数字来源）。两者混用会让
  // 未量化题的「尚未量化」徽章整块消失，而 ADR-0011 要求它必须可见。
  const isAgentRecord =
    question.agentSessionId !== null ||
    question.provenance === "AGENT" ||
    question.provenance === "AGENT_INSTRUCTED"

  if (
    !isAgentRecord &&
    unendorsed.length === 0 &&
    pendingProposals.length === 0 &&
    revisionList.length === 0
  ) {
    return null
  }

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">记录状态</span>
        <span className="badge badge-sm">
          {PROVENANCE_LABELS[question.provenance] ?? question.provenance}
        </span>
        <span className="badge badge-sm">
          {ORACLE_LABELS[question.oracleKind] ?? question.oracleKind}
        </span>
        {!quantified && (
          <span className="badge badge-sm badge-warning">尚未量化</span>
        )}
        {question.scoringAnchor && (
          <span className="badge badge-sm">锚点：{question.scoringAnchor}</span>
        )}
      </div>

      {question.resolutionCriteria && (
        <p className="mb-0 mt-2 text-neutral-600">
          <span className="font-semibold">结算判据：</span>
          {question.resolutionCriteria}
        </p>
      )}

      {question.resolved &&
        (question.resolutionSource || question.resolutionRationale) && (
          <p className="mb-0 mt-2 text-neutral-600">
            <span className="font-semibold">结算证据：</span>
            {question.resolutionSource ?? "（未附来源）"}
            {question.resolutionRationale
              ? ` —— ${question.resolutionRationale}`
              : ""}
          </p>
        )}

      {unendorsed.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3 outline outline-1 outline-amber-200">
          <p className="m-0 font-semibold text-amber-900">
            有 {unendorsed.length} 条预测尚未背书 —— 背书之前它们不计入校准。
          </p>
          <ul className="my-2 list-disc pl-5">
            {unendorsed.map((forecast) => (
              <li key={forecast.id}>
                {Math.round(Number(forecast.forecast) * 100)}%（
                {FORECAST_PROVENANCE_LABELS[forecast.provenance] ??
                  forecast.provenance}
                ）
                <button
                  className={clsx(
                    "btn btn-xs ml-2",
                    endorse.isLoading && "loading",
                  )}
                  disabled={endorse.isLoading}
                  onClick={() => endorse.mutate({ forecastId: forecast.id })}
                >
                  背书
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pendingProposals.length > 0 && (
        <div className="mt-3 rounded-lg bg-sky-50 p-3 outline outline-1 outline-sky-200">
          <p className="m-0 font-semibold">待确认的结算提案</p>
          {pendingProposals.map((proposal) => (
            <div key={proposal.id} className="mt-2">
              <p className="m-0">
                建议结算为 <strong>{proposal.resolution}</strong>
                {proposal.source
                  ? `；来源：${proposal.source}`
                  : "（未附来源）"}
              </p>
              {proposal.rationale && (
                <p className="m-0 text-neutral-600">{proposal.rationale}</p>
              )}
              <div className="mt-1 flex gap-2">
                <button
                  className={clsx(
                    "btn btn-xs btn-primary",
                    decide.isLoading && "loading",
                  )}
                  disabled={decide.isLoading}
                  onClick={() =>
                    decide.mutate({ proposalId: proposal.id, accept: true })
                  }
                >
                  采纳并结算
                </button>
                <button
                  className="btn btn-xs"
                  disabled={decide.isLoading}
                  onClick={() =>
                    decide.mutate({ proposalId: proposal.id, accept: false })
                  }
                >
                  驳回
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {revisionList.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer font-semibold">
            修订历史（{revisionList.length}）
          </summary>
          <ul className="mt-2 list-disc pl-5 text-neutral-600">
            {revisionList.map((revision) => (
              <li key={revision.id}>
                <code>{revision.field}</code>：{revision.oldValue ?? "（空）"} →{" "}
                {revision.newValue ?? "（空）"}
                {revision.reason ? `（${revision.reason}）` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
