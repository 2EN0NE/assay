import { NextSeo } from "next-seo"
import Link from "next/link"
import { useRouter } from "next/router"
import { DomainAssessment } from "../lib/web/domain_stats"
import { api } from "../lib/web/trpc"

/**
 * 领域读数页（ADR-0032 / ADR-0033 · ticket 03；对等要求见 AGENTS.md §10）。
 *
 * 这里呈现与 CLI `domain-report` **同一份**读数（同一个过程、同一个纯函数）。
 * 页面不做任何自己的统计——一旦在页面里"顺手算一下"，两侧的数字迟早会不一致，
 * 而读数的分歧不会有任何报错。
 *
 * 前缀走查询串而不是路径段：领域名里有 `/`（`投资/宏观`），放进路径段会被
 * 拆成两级路由，编码后的 `%2F` 又会在各层被解码一次。
 */
export default function DomainPage() {
  const router = useRouter()
  const prefix =
    typeof router.query.prefix === "string" ? router.query.prefix : ""

  const domains = api.tags.listDomains.useQuery()
  const report = api.tags.domainReport.useQuery(
    { prefix },
    { enabled: prefix !== "" },
  )

  return (
    <>
      <NextSeo title="领域读数" />
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold">领域读数</h1>

        <div className="mt-3 flex flex-wrap gap-2">
          {domains.data?.map((domain) => (
            <Link
              key={domain.id}
              href={`/domains?prefix=${encodeURIComponent(domain.name)}`}
              className={
                domain.name === prefix
                  ? "badge badge-primary"
                  : "badge badge-outline"
              }
            >
              {domain.name}
            </Link>
          ))}
        </div>

        {prefix === "" && (
          <p className="mt-4 text-sm text-neutral-500">
            选一个领域（或直接给 `?prefix=投资/宏观`）。
          </p>
        )}

        {report.error && (
          <div className="alert alert-warning mt-4">{report.error.message}</div>
        )}

        {report.data && <Report report={report.data} />}
      </div>
    </>
  )
}

type ReportData = DomainAssessment

function Report({ report }: { report: ReportData }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-medium">{report.domain}</h2>
      {/* ADR-0030 §十三：宽口径不许被误读成细分口径 */}
      <p className="text-sm text-neutral-500">
        此读数包含其子标签的条目（例如查「投资/宏观」会含「投资/宏观/CPI」）。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="badge badge-outline">n = {report.n}</span>
        <span className="badge badge-outline">
          悬空未计入 = {report.pending}
        </span>
      </div>

      {/* ADR-0032 §四 / ADR-0033 §六：样本不足时**不给**判据字段，页面也就无从显示 */}
      {report.skillScore === undefined && (
        <p className="mt-4 text-sm text-neutral-500">
          {report.n < 5
            ? `样本数 ${report.n} 太少，连分桶都不给——少样本下的形状全是噪音。`
            : `样本数 ${report.n} 不足 20：只给形状（校准与分辨率），不给技能分——少样本下技能分的方差大于它包含的信息量。`}
        </p>
      )}

      {report.skillScore !== undefined && report.ci && (
        <div className="mt-4 rounded-box border border-base-300 p-4">
          {/* ADR-0033 §五：量级必须可解释——三个数一起给 */}
          <div className="text-2xl font-semibold">
            技能分 {report.skillScore.toFixed(3)}
            <span className="ml-2 text-base text-neutral-500">
              95% 区间 [{report.ci[0].toFixed(3)}, {report.ci[1].toFixed(3)}]
            </span>
          </div>
          <p className="mt-1 text-sm">
            <Verdict verdict={report.verdict} />
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            我的 Brier {report.brier?.toFixed(3)}（越低越好）· 基准率策略的
            Brier {report.brierRef?.toFixed(3)} · 技能分 = 1 − 我的/基准率
          </p>
        </div>
      )}

      {report.bins && (
        <table className="mt-4 table table-sm">
          <thead>
            <tr>
              <th>分桶</th>
              <th>我的平均预测</th>
              <th>实际发生率</th>
              <th>条数</th>
            </tr>
          </thead>
          <tbody>
            {report.bins
              .filter((bin) => bin.count > 0)
              .map((bin) => (
                <tr key={bin.binCenter}>
                  <td>{(bin.binCenter * 100).toFixed(0)}%</td>
                  <td>{bin.meanPrediction.toFixed(2)}</td>
                  <td>{bin.meanOutcome.toFixed(2)}</td>
                  <td>{bin.count}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {report.resolution !== undefined && (
        <p className="mt-2 text-sm text-neutral-500">
          分辨率 {report.resolution.toFixed(3)}
          ——概率有没有把结果区分开。「永远押 0.4」的人校准完美、分辨率是 0。
        </p>
      )}
    </section>
  )
}

/**
 * 区间相对 0 的三种表述（ADR-0033 §四）。
 *
 * 跨 0 时**只允许**说"无法判断方向"：把 +0.03 说成"略有提升"是把噪声讲成结论，
 * 而那是这套读数最容易被误用的地方。
 */
function Verdict({ verdict }: { verdict: ReportData["verdict"] }) {
  if (verdict === "better") return <span>显著优于基准（区间不跨 0）</span>
  if (verdict === "worse") return <span>显著劣于基准（区间不跨 0）</span>
  return <span>无法判断方向（区间跨 0）</span>
}
