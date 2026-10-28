/** @jest-environment node */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * 身份门禁（ADR 无关，纯改名契约）。
 *
 * 改名最危险的失败形态不是编译错误，而是**漏改**：旧名字残留在某个页面、
 * 某个 CI 变量或某份 UAT 文档里，没有任何测试会红。这个测试就是那条门禁：
 * 它只认"当前身份文件"，历史记录（ADR / issues / progress.txt）走白名单。
 */
const ROOT = process.cwd()

const SCAN_DIRS = [
  "cli",
  "lib",
  "pages",
  "components",
  "e2e",
  "skills",
  "knowledge",
]

const ROOT_FILES = [
  "package.json",
  ".env.example",
  "docker-compose.yml",
  "startup.sh",
  ".github/workflows/test.yml",
  "README.md",
  "CONTEXT.md",
  "AGENTS.md",
  "docs/uat-pi-agent.md",
  "docs/roadmap.md",
]

/** 旧身份必须消失的标记。 */
const FORBIDDEN = [
  "nano-fatebook-agent",
  "FATEBOOK_AGENT_",
  "FATEBOOK_ENABLE_PAIRING_LOGIN",
  "fatebook_development",
  "fatebook_uat",
  "fatebook_migration_verify",
  "fatebook@localhost",
  // 跨 iframe 的协议名与查询参数（lib/web/embed.ts）：大写清单扫不到驼峰与连字符形态，
  // 而漏改这两个正是"宿主页静默失效"的成因。
  "isFatebook",
  "fatebook-embed-id",
  "fatebook-status",
  // 运营方表述：本实例是个人自用部署，没有运营主体（ADR-0042 只改标识符，
  // 这条是"不可再写回上游那套"的守卫——复制一个页面回来就会命中）。
  "hello@sage-future.org",
  "Sage Future Inc",
]

/**
 * 外部标识符：看起来像旧名字，但改的是**别人那侧的键**。
 * 它们必须原地保留，因此不进 FORBIDDEN，而是单独断言——「顺手统一改掉」会变红。
 */
const EXTERNAL_IDENTIFIERS: { file: string; token: string; reason: string }[] =
  [
    {
      file: "lib/web/notifications.tsx",
      token: "fatebook-new-activity",
      reason: "Postmark 模板别名，模板建在 Postmark 账户里，改了就发不出信",
    },
    {
      file: "lib/web/utils.ts",
      token: '"pb_"',
      reason: "PredictionBook 导入 ID 前缀，改了会让重复导入造出新题",
    },
    {
      file: "lib/web/utils.ts",
      token: '"cs_"',
      reason: "CSV 导入 ID 前缀，同上",
    },
    {
      file: "components/Footer.tsx",
      token: "sage-future/fatebook",
      reason: "上游仓库链接，指的不是本仓库",
    },
  ]

/** 这个文件本身是规则的定义处，不能扫自己。 */
const SELF = "lib/branding.test.ts"

function textFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "coverage", ".git"].includes(entry.name)) {
        continue
      }
      out.push(...textFiles(full))
      continue
    }
    if (/\.(ts|tsx|js|jsx|md|json|ya?ml|sh)$/.test(entry.name)) out.push(full)
  }
  return out
}

function identityFiles(): string[] {
  const files = SCAN_DIRS.flatMap((dir) => textFiles(join(ROOT, dir)))
  files.push(...ROOT_FILES.map((file) => join(ROOT, file)))
  return files.filter((file) => relative(ROOT, file) !== SELF)
}

describe("身份：试金石 / Assay", () => {
  it("包名是 assay，且不再有 Chrome 扩展的 zip 脚本（ADR-0013）", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
    expect(pkg.name).toBe("assay")
    expect(pkg.scripts.zip).toBeUndefined()
  })

  it("README 与 CONTEXT 的一级标题是新名字", () => {
    for (const file of ["README.md", "CONTEXT.md"]) {
      const firstLine = readFileSync(join(ROOT, file), "utf8").split("\n")[0]
      expect({ file, firstLine }).toEqual({
        file,
        firstLine: expect.stringContaining("试金石"),
      })
    }
  })

  it("README 仍保留 Fatebook 的 fork 归属", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8")
    expect(readme).toContain("由 [Fatebook](https://fatebook.io)")
  })

  it("当前身份文件里没有旧标识残留", () => {
    const hits: string[] = []
    for (const file of identityFiles()) {
      const text = readFileSync(file, "utf8")
      for (const token of FORBIDDEN) {
        if (text.includes(token)) {
          hits.push(`${relative(ROOT, file)}: ${token}`)
        }
      }
    }
    expect(hits).toEqual([])
  })

  it("新环境变量名已被实现读取", () => {
    const context = readFileSync(join(ROOT, "cli/context.ts"), "utf8")
    expect(context).toContain("ASSAY_AGENT_API_KEY")
    expect(context).toContain("ASSAY_AGENT_USER_EMAIL")
  })
  /**
   * ADR 只追加：改名不去回改旧篇，而靠**篇首的一行指针**让读者知道"此处已变"。
   * 指针被删掉时没有任何症状——读者只会照着旧变量名配置，然后得到"没有可用身份"。
   * 这条用例就是那行指针的门禁（ADR-0042 的「改掉了哪一句」清单）。
   */
  it("改名涉及的 ADR 仍指向 ADR-0042", () => {
    const adrDir = join(ROOT, "docs/adr")
    const files = readdirSync(adrDir)
    for (const number of ["0021", "0023", "0026", "0035", "0036", "0040"]) {
      const file = files.find((name) => name.startsWith(`${number}-`))
      expect({ number, found: file !== undefined }).toEqual({
        number,
        found: true,
      })
      if (!file) continue
      const text = readFileSync(join(adrDir, file), "utf8")
      expect({
        number,
        pointsToNewAdr: text.includes("0042-brand-rename-and-identifiers.md"),
      }).toEqual({
        number,
        pointsToNewAdr: true,
      })
    }
  })
  it("外部标识符必须原地保留（改的是品牌，不是别人那侧的键）", () => {
    for (const { file, token, reason } of EXTERNAL_IDENTIFIERS) {
      const text = readFileSync(join(ROOT, file), "utf8")
      expect({ file, token, reason, kept: text.includes(token) }).toEqual({
        file,
        token,
        reason,
        kept: true,
      })
    }
  })
})
