import { NextSeo } from "next-seo"
import Link from "next/link"
import { api } from "../../lib/web/trpc"

/**
 * 决策列表（ADR-0001 · ticket 06）。
 *
 * 每条同时给出**质量侧**（清单完成度）与**结果侧**（几条已揭晓），但两者
 * 不揉成一个分数——把"决策好"与"运气好"合并正是 Resulting 的来源。
 *
 * 结果侧刻意只给事实（已揭晓/共几条），不给"决策结果分"：把多条 Prediction
 * 的分数聚合成一个决策级指标是一个新指标，归 ADR-0002 管辖。在它未决之前
 * 现编一个出来，等于用一个没人复核过的数替代可查证的事实。
 */
export default function DecisionsPage() {
  const decisions = api.decision.list.useQuery({})

  return (
    <>
      <NextSeo title="决策" />
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold">决策</h1>

        {decisions.isLoading && <span>Loading...</span>}

        {decisions.error && (
          <div className="alert alert-warning mt-4">读取失败。</div>
        )}

        {decisions.data?.length === 0 && (
          <p className="mt-4 text-sm text-neutral-500">
            还没有记录过决策。可以在对话里让 agent 记，也可以用 CLI 的
            create-decision。
          </p>
        )}

        <ul className="mt-4 space-y-3">
          {decisions.data?.map((decision) => (
            <li key={decision.id} className="card border border-base-300">
              <div className="card-body py-3">
                <Link
                  href={`/decisions/${decision.id}`}
                  className="link font-medium"
                >
                  {decision.statement}
                </Link>
                <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
                  <span className="badge badge-sm">
                    清单 {decision.rubric.done}/{decision.rubric.total}
                  </span>
                  <span className="badge badge-sm">
                    已揭晓 {decision.predictions.resolved}/
                    {decision.predictions.total}
                  </span>
                  {decision.rubricLock.locked && (
                    <span className="badge badge-sm badge-info">
                      清单已锁定
                    </span>
                  )}
                  <span>{decision.createdAt.toLocaleDateString()}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
