import fs from "node:fs"
import path from "node:path"
import { agentRouter } from "../lib/web/agent_router"
import { decisionRouter } from "../lib/web/decision_router"
import { tagsRouter } from "../lib/web/tags_router"

/**
 * 交互面对等守门测试（AGENTS.md 第 8 节 / [ADR-0023](../../docs/adr/0023-interaction-surface-parity.md)）。
 *
 * 规则：**CLI 与 Web 是同一套能力的两个交互面**。一条 tRPC procedure 只在一侧可达，
 * 就必须登记为有意例外并写明理由；"沉默的缺失"不被容忍。
 *
 * 为什么要有这道门：本工程的失配方式是**静默的**——某个能力只在 CLI 上做出来，
 * 于是"换个入口就做不成事"，而没有任何东西会变红。此前这条规则只靠人工评审
 * （AGENTS.md 原话：`cli/parity.test.ts` does not exist yet）。
 *
 * 两侧可达性都是从**源码**读出来的，不是手抄的清单：新增一条 procedure 而没决定
 * 它在另一侧的去处，测试会直接报出它。
 */

jest.mock("trpc-transformer", () => ({ __esModule: true, default: undefined }))
// tags_router 直接引 _utils_server（内含 ESM 的 node-fetch，jsdom 下拉不起来）。
// 这道门只枚举过程名、不执行它们，把分析事件打成空壳即可。
jest.mock("../lib/_utils_server", () => ({
  __esModule: true,
  backendAnalyticsEvent: jest.fn(),
}))
jest.mock("../lib/web/resolution", () => ({
  handleQuestionResolution: jest.fn(),
  rescoreResolvedQuestion: jest.fn(),
}))
jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    question: {},
    forecast: {},
    decision: {},
    notification: {},
    resolutionProposal: {},
    revision: {},
  },
}))

const PROJECT_ROOT = path.resolve(__dirname, "..")

/**
 * 例外表：每条都必须带**理由**，理由取自 ADR-0023 的「现状例外清单」。
 *
 * 一旦某条能力在另一侧补上，这里对应的行就过期了 —— 测试会要求删掉它
 * （这正是 `docs/issues/attribution-and-parity/01-parity-gate-test.md` 的验收方式）。
 */
const DELIBERATE_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  // —— 明确只能在一侧：配对码由**持有凭据者**签发，而网页侧持有的是会话（ADR-0035）
  [
    "agent.issuePairingCode",
    "只可能在一侧：签发是**持有凭据者**的动作，网页侧拿到的是会话、不持有凭据（ADR-0035）。兑换那一半在 Web——`/pair` 页面 + `pages/api/pairing/redeem`（不是 tRPC 过程，因此不进这张表）",
  ],
  // —— 能力在 Web 上以界面形态存在，对等物不经 agent.* 命名空间（形态不同 ≠ 能力缺失）
  [
    "agent.createPrediction",
    "Web 侧经首页表单 / `questionRouter.create` 创建预测（ADR-0023：形态不同不等于能力缺失）",
  ],
  [
    "agent.settle",
    "Web 侧经题页 Resolve 菜单 / `questionRouter.resolveQuestion` 结算；无来源时降级为提案两侧一致（ADR-0004）",
  ],
  [
    "agent.listUnendorsed",
    "Web 侧以题页的 amber「尚未背书」块呈现同一信息（ADR-0007 / ADR-0008 的可见性要求）",
  ],
  [
    "agent.listAuditRecords",
    "审计筛选是库主对全库的复查动作（不是单条问题的视图），而审计字段在他人读路径上的可见性尚未裁决（ADR-0027 Consequences 明写“尚未裁决”）——登记为例外，不静默缺失",
  ],
  // —— 待议：需判断 Web 是否已有等价能力（ADR-0023 例外表「待议」一行）
  [
    "agent.listDue",
    "待议：跟踪侧的拉取接口，Web 尚无对应物（ADR-0023 例外表）",
  ],
  ["agent.listOpen", "待议：同上（ADR-0023 例外表）"],
  [
    "agent.listPendingDeliveries",
    "待议：触达状态机的拉取接口，Web 尚无对应物（ADR-0017 / ADR-0023 例外表）",
  ],
  [
    "agent.recordResolutionSource",
    "待补：悬空是被队列（listDue.dangling）发现的，而队列在 agent 手里；Web 侧入口随题目页写入口一起做（见 09–11）。在它补上之前，被代签的那一方只能从 CLI/agent 侧补来源（ADR-0031 §五）",
  ],
  [
    "agent.reportDelivery",
    "待议：触达回报接口，Web 尚无对应物（ADR-0017 / ADR-0023 例外表）",
  ],
  // —— 待补：Web 侧缺写入口，ADR-0007 要求保留（ADR-0023 例外表明列）
  [
    "decision.create",
    "待补：Web 侧缺创建决策的写入口（ADR-0007 要求人类可写；见 attribution-and-parity 09）",
  ],
  [
    "decision.setRubric",
    "待补：Web 侧缺写清单的入口（ADR-0020 的锁定与版本语义只在 CLI 可达；见 10）",
  ],
  [
    "decision.updateNarrative",
    "待补：Web 侧缺改叙事的入口（ADR-0012 的留痕要求已在服务端；见 09）",
  ],
  [
    "decision.attachPrediction",
    "待补：Web 侧缺把预测挂到决策上的入口（见 11）",
  ],
  ["decision.detachPrediction", "待补：Web 侧缺解绑入口（见 11）"],
  // —— 领域（ADR-0030）：题目标签是既有能力，其入口一直只在 Web 上（不是本次新增的缺口）
  [
    "tags.getAll",
    "既有能力的入口只在 Web：TagsSelect 的候选列表（对决策领域无 CLI 用途）",
  ],
  [
    "tags.getByName",
    "既有能力的入口只在 Web：题页 /tag/[tag] 按名字看该标签下的题",
  ],
  [
    "tags.setQuestionTags",
    "既有能力的入口只在 Web：题页 QuestionDetails 改题目标签；本次给决策加的领域是另一回事（ADR-0030 §三）",
  ],
  [
    "tags.renameDomain",
    "待补：改名会重写历史归属（带理由留痕），需要专门的领域整理视图而不是顺手一改的按钮；暂以 CLI 为唯一入口（ADR-0030 §十四）",
  ],
  [
    "tags.deleteDomain",
    "待补：删词是破坏性动作（只允许零引用），适合与改名同居一个整理视图；暂以 CLI 为唯一入口（ADR-0030 §十五）",
  ],
])

/** 去掉注释再扫描：注释里写一句 `api.decision.create` 不该被当成"已实现"。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      // 逐处找 `//`：`https://…` 里的那处前面是 `:`，跳过它继续往后找；
      // 找到就截断。若一遇 `:` 就整行返回，行尾注释里的调用会被当成真实可达。
      for (let from = 0; ; ) {
        const index = line.indexOf("//", from)
        if (index === -1) return line
        if (index > 0 && line[index - 1] === ":") {
          from = index + 2
          continue
        }
        return line.slice(0, index)
      }
    })
    .join("\n")
}

function listSourceFiles(relativeDir: string): string[] {
  const root = path.join(PROJECT_ROOT, relativeDir)
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
      out.push(full)
    }
  }
  walk(root)
  return out
}

/**
 * CLI 面的可达性：`cli/commands.ts` 里真的调用了这些过程。
 *
 * 限定接收者（`(?<!prisma\.)`）：否则任何以 `decision.` / `agent.` 结尾的调用都算
 * "CLI 可达"，将来有人在 CLI 里绕过 tRPC 直写 `prisma.decision.create(...)`，会被判成
 * "已接线"——守门反而给出虚假绿灯，正是它要防的"沉默的缺失"。
 */
export function cliProceduresInSource(source: string): Set<string> {
  const found = stripComments(source).matchAll(
    /(?<!prisma\.)\b(agent|decision|tags)\.([A-Za-z][A-Za-z0-9]*)\s*\(/g,
  )
  return new Set(
    Array.from(found).map(([, router, name]) => `${router}.${name}`),
  )
}

function cliSurface(): Set<string> {
  return cliProceduresInSource(
    fs.readFileSync(path.join(PROJECT_ROOT, "cli/commands.ts"), "utf8"),
  )
}

/** Web 面的可达性：页面 / 组件里真的引用了 `api.<router>.<name>`。 */
function webSurface(): Set<string> {
  const surfaces = new Set<string>()
  for (const relativeDir of ["pages", "components"]) {
    for (const file of listSourceFiles(relativeDir)) {
      const source = stripComments(fs.readFileSync(file, "utf8"))
      const found = source.matchAll(
        /\bapi\.(agent|decision|tags)\.([A-Za-z][A-Za-z0-9]*)/g,
      )
      for (const [, router, name] of Array.from(found)) {
        surfaces.add(`${router}.${name}`)
      }
    }
  }
  return surfaces
}

/** tRPC v10 把嵌套路由摊平成 `_def.procedures` 的 dotted key。 */
function procedureNames(router: unknown): string[] {
  const def = (router as { _def?: { procedures?: Record<string, unknown> } })
    ._def
  return Object.keys(def?.procedures ?? {})
}

/**
 * 守门判定本身（纯函数，便于用合成数据验证它真的会变红）。
 *
 * AGENTS.md §8 的规则是"**一面有的能力，另一面必须有**"，等价说法：一条 procedure
 * **只有两侧都可达**才算对等；缺任意一侧都必须登记理由。
 *
 * 注意"缺任意一侧"包含**两侧都缺**（声明了却没有任何入口能到达它）——这不是
 * 对称差，早期实现写成 `cli.has !== web.has` 会把它漏掉（实测漏过一条探针）。
 */
export function findUnregisteredSurfaceGaps(
  all: readonly string[],
  cli: ReadonlySet<string>,
  web: ReadonlySet<string>,
  exceptions: ReadonlyMap<string, string>,
): string[] {
  return all
    .filter((procedure) => !(cli.has(procedure) && web.has(procedure)))
    .filter((procedure) => {
      const reason = exceptions.get(procedure)
      return reason === undefined || reason.trim() === ""
    })
    .sort()
}

/** 例外表里已经不再成立的条目：procedure 没了，或另一侧已经补上了。 */
export function findStaleExceptions(
  all: readonly string[],
  cli: ReadonlySet<string>,
  web: ReadonlySet<string>,
  exceptions: ReadonlyMap<string, string>,
): string[] {
  return Array.from(exceptions.keys())
    .filter(
      (procedure) =>
        !all.includes(procedure) || (cli.has(procedure) && web.has(procedure)),
    )
    .sort()
}

const ALL_PROCEDURES = [
  ...procedureNames(agentRouter).map((name) => `agent.${name}`),
  ...procedureNames(decisionRouter).map((name) => `decision.${name}`),
  ...procedureNames(tagsRouter).map((name) => `tags.${name}`),
].sort()

describe("对等性守门（AGENTS.md §8 / ADR-0023）", () => {
  it("两侧的 procedure 都能被发现（否则这道门是在守一个空集合）", () => {
    expect(ALL_PROCEDURES.length).toBeGreaterThanOrEqual(18)
    expect(cliSurface().size).toBeGreaterThanOrEqual(15)
    expect(webSurface().size).toBeGreaterThan(0)
  })

  it("验证可达性扫描：直写 `prisma.decision.create` 不算 CLI 接线", () => {
    const source = [
      "await session.decision.create({})",
      "prisma.decision.create({ data })",
      "await prisma.agent.endorse({})",
    ].join("\n")

    expect(Array.from(cliProceduresInSource(source))).toEqual([
      "decision.create",
    ])
  })

  it("只在一侧可达的 procedure 必须登记为有意例外", () => {
    expect(
      findUnregisteredSurfaceGaps(
        ALL_PROCEDURES,
        cliSurface(),
        webSurface(),
        DELIBERATE_EXCEPTIONS,
      ),
    ).toEqual([])
  })

  it("例外表里每条都带理由，且没有过期条目（另一侧补上了就该删行）", () => {
    for (const procedure of Array.from(DELIBERATE_EXCEPTIONS.keys())) {
      expect(DELIBERATE_EXCEPTIONS.get(procedure)?.trim()).not.toBe("")
      expect(procedure).toMatch(/^(agent|decision|tags)\./)
    }

    expect(
      findStaleExceptions(
        ALL_PROCEDURES,
        cliSurface(),
        webSurface(),
        DELIBERATE_EXCEPTIONS,
      ),
    ).toEqual([])
  })

  it("验证守门本身：新加一条未登记的单侧 procedure 会变红", () => {
    const all = ["agent.listDue", "agent.brandNew", "decision.list"]
    const cli = new Set(["agent.listDue", "agent.brandNew", "decision.list"])
    const web = new Set(["decision.list"])
    const exceptions = new Map([["agent.listDue", "待议：已有登记"]])

    expect(findUnregisteredSurfaceGaps(all, cli, web, exceptions)).toEqual([
      "agent.brandNew",
    ])
  })

  it("验证守门本身：两侧都没接线的 procedure 同样会变红", () => {
    // 实测过：早期实现用对称差（`cli.has !== web.has`）时，这种"声明了却没人
    // 能到达它"的过程会静默通过——它同样是"能力缺失"，只是缺在两侧。
    const all = ["decision.list", "decision.orphan"]
    const cli = new Set(["decision.list"])
    const web = new Set(["decision.list"])

    expect(findUnregisteredSurfaceGaps(all, cli, web, new Map())).toEqual([
      "decision.orphan",
    ])
  })

  it("验证过期判定：另一侧补上后，原来那行必须删掉", () => {
    const all = ["agent.listDue"]
    const exceptions = new Map([["agent.listDue", "待议"]])

    expect(
      findStaleExceptions(
        all,
        new Set(["agent.listDue"]),
        new Set(),
        exceptions,
      ),
    ).toEqual([])
    expect(
      findStaleExceptions(
        all,
        new Set(["agent.listDue"]),
        new Set(["agent.listDue"]),
        exceptions,
      ),
    ).toEqual(["agent.listDue"])
  })
})
