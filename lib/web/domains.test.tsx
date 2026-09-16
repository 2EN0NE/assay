import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import DomainPage from "../../pages/domains"
import { api } from "./trpc"

/**
 * 领域读数页（ADR-0032 / ADR-0033 · ticket 03）。
 *
 * 页面本身不算数（它只调用 `tags.domainReport`），但它承载了三条**只存在于呈现层**
 * 的硬约束，而它们错了都不会报错：
 *
 * 1. 区间跨 0 时**只允许**说"无法判断方向"——把点估计 +0.03 讲成"略有提升"是把噪声
 *    当结论（ADR-0033 §四）；
 * 2. 阈值以下**不渲染**判据字段（§六：不得隐藏不确定性，也不得伪造精度）；
 * 3. 分母必须与判据一起出现（§六）：只给技能分不给 `n`/悬空计数就是伪造的结论。
 */

const mockRouterQuery: { prefix?: string } = { prefix: "投资/宏观" }

jest.mock("next/router", () => ({
  useRouter: () => ({ query: mockRouterQuery }),
}))

jest.mock("./trpc", () => ({
  api: {
    tags: {
      listDomains: { useQuery: jest.fn() },
      domainReport: { useQuery: jest.fn() },
    },
  },
}))

const listDomains = api.tags.listDomains.useQuery as unknown as jest.Mock
const domainReport = api.tags.domainReport.useQuery as unknown as jest.Mock

const report = (over: Record<string, unknown> = {}) => ({
  domain: "投资/宏观",
  n: 40,
  pending: 2,
  includesDescendants: true,
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockRouterQuery.prefix = "投资/宏观"
  listDomains.mockReturnValue({ data: [] })
  domainReport.mockReturnValue({ data: undefined, error: null })
})

describe("领域读数页：判据的呈现规则（ADR-0033）", () => {
  it("技能分、区间与三个量级一起给，verdict 由区间决定", () => {
    domainReport.mockReturnValue({
      data: report({
        brier: 0.09,
        brierRef: 0.25,
        skillScore: 0.64,
        ci: [0.304, 0.88],
        verdict: "better",
      }),
      error: null,
    })

    render(<DomainPage />)

    expect(screen.getByText(/技能分 0\.640/)).toBeInTheDocument()
    expect(screen.getByText(/95% 区间 \[0\.304, 0\.880\]/)).toBeInTheDocument()
    expect(screen.getByText("显著优于基准（区间不跨 0）")).toBeInTheDocument()
    // §五：量级必须可解释——基准率策略的 Brier 要一起给，否则“技能分 0.64”无从复算
    expect(screen.getByText(/基准率策略的 Brier 0\.250/)).toBeInTheDocument()
  })

  it("区间跨 0 ⇒ 只许说「无法判断方向」，任何趋势性措辞都变红（去掉守卫即变红）", () => {
    domainReport.mockReturnValue({
      data: report({
        brier: 0.25,
        brierRef: 0.25,
        // 点估计恰好 0，区间跨 0：构造上就是“没有方向”
        skillScore: 0,
        ci: [-0.333, 0],
        verdict: "inconclusive",
      }),
      error: null,
    })

    render(<DomainPage />)

    expect(screen.getByText("无法判断方向（区间跨 0）")).toBeInTheDocument()
    // 这条就是 ADR-0033 §四 的执行点：跨 0 时把 +0.03 说成“略有提升”不会有任何报错
    expect(screen.queryByText(/显著优于基准/)).not.toBeInTheDocument()
    expect(screen.queryByText(/显著劣于基准/)).not.toBeInTheDocument()
    expect(screen.queryByText(/略有提升/)).not.toBeInTheDocument()
  })

  it("区间落在负侧 ⇒ 说“显著劣于基准”，不说成无法判断", () => {
    domainReport.mockReturnValue({
      data: report({
        brier: 0.41,
        brierRef: 0.25,
        skillScore: -0.64,
        ci: [-1.791, -0.178],
        verdict: "worse",
      }),
      error: null,
    })

    render(<DomainPage />)

    expect(screen.getByText(/技能分 -0\.640/)).toBeInTheDocument()
    expect(screen.getByText("显著劣于基准（区间不跨 0）")).toBeInTheDocument()
  })

  it("n < 5 ⇒ 连桶都不给，并解释原因（不伪造精度）", () => {
    domainReport.mockReturnValue({
      data: report({ n: 3, pending: 1 }),
      error: null,
    })

    render(<DomainPage />)

    expect(screen.getByText(/样本数 3 太少/)).toBeInTheDocument()
    // §六：判据字段根本不出现，页面也就无从显示（“技能分”三个字只允许出现在解释里）
    expect(screen.queryByText(/技能分 -?\d/)).not.toBeInTheDocument()
    expect(screen.queryByText(/分辨率/)).not.toBeInTheDocument()
  })

  it("5 ≤ n < 20 ⇒ 给形状但不给技能分，并说清为什么", () => {
    domainReport.mockReturnValue({
      data: report({
        n: 12,
        pending: 0,
        bins: [
          {
            binCenter: 0.35,
            meanPrediction: 0.3,
            meanOutcome: 0.25,
            count: 4,
          },
        ],
        resolution: 0.05,
        brier: 0.2,
        brierRef: 0.25,
      }),
      error: null,
    })

    render(<DomainPage />)

    expect(screen.getByText(/不足 20/)).toBeInTheDocument()
    expect(screen.getByText(/分辨率 0\.050/)).toBeInTheDocument()
    // 形状给，判据不给：明细块（技能分 + 区间 + Brier 对照）整体不渲染
    expect(screen.queryByText(/技能分 -?\d/)).not.toBeInTheDocument()
    expect(screen.queryByText(/基准率策略的 Brier/)).not.toBeInTheDocument()
  })

  it("分母透明：n 与悬空计数分开显示，并声明口径包含子标签", () => {
    domainReport.mockReturnValue({ data: report(), error: null })

    render(<DomainPage />)

    expect(screen.getByText(/n = 40/)).toBeInTheDocument()
    expect(screen.getByText(/悬空未计入 = 2/)).toBeInTheDocument()
    // ADR-0030 §十三：宽口径不许被误读成细分口径
    expect(screen.getByText(/包含其子标签/)).toBeInTheDocument()
  })

  it("没选领域时给出可行动提示，且不请求读数（enabled: false）", () => {
    mockRouterQuery.prefix = undefined

    render(<DomainPage />)

    expect(screen.getByText(/选一个领域/)).toBeInTheDocument()
    expect(domainReport).toHaveBeenCalledWith(
      { prefix: "" },
      { enabled: false },
    )
  })

  it("读数出错时把服务端的话原样显示，而不是白屏", () => {
    domainReport.mockReturnValue({
      data: undefined,
      error: { message: "找不到领域" },
    })

    render(<DomainPage />)

    expect(screen.getByText("找不到领域")).toBeInTheDocument()
  })
})
