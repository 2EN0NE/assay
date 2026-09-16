import fs from "node:fs"
import path from "node:path"
import { commands } from "../cli/commands"

/**
 * 技能契约门禁。
 *
 * 为什么需要它：技能是**给 agent 看的接口文档**，而文档与实现漂移时**没有任何症状**
 * ——agent 照着技能里的命令敲下去，得到一个"未知命令"，然后它很可能自己编一个替代
 * 路径继续往下走。本仓库已经把"文档里的命令不存在"当成一类缺陷：写跟踪技能时我就
 * 顺手写了一个 `propose-resolution`，而那条命令**不存在**（提案是 `settle` 自动降级
 * 出来的）。这条门禁就是为了让下一个人不必靠人眼发现（ADR-0034 §Consequences）。
 *
 * 它查三件事：
 * 1. 每个技能目录下的 SKILL.md 都有完整 frontmatter，且 `name` 与目录名一致；
 * 2. `description` 里写了触发条件（agent 只能靠它决定何时该用这个技能）；
 * 3. 技能里出现的每一条 `agent -- <命令>` 都是 CLI 真有的命令。
 */

const SKILLS_DIR = path.resolve(__dirname, "..", "skills")

function skillDirs(): string[] {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function readSkill(dir: string): string {
  return fs.readFileSync(path.join(SKILLS_DIR, dir, "SKILL.md"), "utf8")
}

/** 只解析我们实际用到的字段；不做通用 YAML——通用解析会引入依赖，也会掩盖格式错误。 */
function parseFrontmatter(source: string): Record<string, string> | undefined {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match) return undefined
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":")
    if (separator === -1) continue
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return fields
}

/** 技能里引用的 CLI 命令（`npm run --silent agent -- <name> …`）。 */
export function cliCommandsInSkill(source: string): string[] {
  const found = source.matchAll(/agent\s+--\s+([a-z][a-z-]*)/g)
  return Array.from(new Set(Array.from(found).map(([, name]) => name))).sort()
}

/** 技能里的 bash 代码块（示例命令都在这里，正文解释不算）。 */
export function bashBlocks(source: string): string[] {
  return Array.from(source.matchAll(/```bash\n([\s\S]*?)```/g)).map(
    ([, body]) => body,
  )
}

describe("技能契约门禁", () => {
  const dirs = skillDirs()
  const cliNames = new Set(commands.map((command) => command.name))

  it("两个半边都在：捕获与跟踪（只有捕获时，队列那半无人负责）", () => {
    expect(dirs).toContain("decision-capture")
    expect(dirs).toContain("settlement-tracking")
  })

  it.each(dirs)("%s：frontmatter 完整、name 与目录名一致", (dir) => {
    const fields = parseFrontmatter(readSkill(dir))

    expect(fields).toBeDefined()
    expect(fields?.name).toBe(dir)
    // description 是 agent 决定"何时用这个技能"的唯一依据，不能是空话
    expect((fields?.description ?? "").length).toBeGreaterThan(30)
    expect(fields?.description).toMatch(/当|时使用|使用$/)
  })

  it.each(dirs)("%s：引用的 CLI 命令都真实存在（防文档漂移）", (dir) => {
    const referenced = cliCommandsInSkill(readSkill(dir))

    expect(referenced.length).toBeGreaterThan(0)
    for (const name of referenced) {
      // 失败时把 CLI 里真实存在的命令列出来，省下"到底是哪个名字"的一次来回
      expect({ referenced: name, exists: cliNames.has(name) }).toEqual({
        referenced: name,
        exists: true,
      })
    }
  })

  it("扫得出技能里引用的命令（否则这道门是在守一个空集合）", () => {
    const names = cliCommandsInSkill(readSkill("settlement-tracking"))

    expect(names).toEqual(
      expect.arrayContaining([
        "decide-proposal",
        "list-due",
        "list-proposals",
        "record-resolution-source",
        "settle",
      ]),
    )
  })

  /**
   * 写入命令必须显式声明来源（ADR-0024）。
   *
   * 为什么值得做成门禁：省略来源的后果是**落一条“待背书”记录**——可展示、可复盘，
   * 但不进校准。它不会报错，只会让当事人以为自己的判断已经进了校准。而技能里的示例
   * 正是 agent 会照抄的东西，所以示例必须带头。
   *
   * “哪些命令支持声明来源”从 CLI 自己推导（usage 里写了旗标的那些），不手写清单：
   * 手写清单会在新增命令时静默过期。
   */
  const provenanceCommands = new Set(
    commands
      .filter((command) => command.usage.includes("--stated-by-owner"))
      .map((command) => command.name),
  )

  it("至少有一个写入命令支持来源声明（否则下面那条断言是空跑）", () => {
    expect(provenanceCommands.size).toBeGreaterThan(0)
  })

  it.each(dirs)("%s：携带来源声明的命令，示例里都写死了来源", (dir) => {
    const blocks = bashBlocks(readSkill(dir)).filter((block) =>
      Array.from(provenanceCommands).some((name) =>
        block.includes(`agent -- ${name}`),
      ),
    )

    // 技能里没给这类示例时，这条断言是空真的（例如跟踪技能用的是 `settle`）。
    // “门禁不能空跑”由下面那条独立断言负责。
    for (const block of blocks) {
      expect({
        block,
        declaresSource: /--stated-by-owner|--agent-collected/.test(block),
      }).toEqual({ block, declaresSource: true })
    }
  })

  it("至少有一条示例走了来源声明（否则上面那条断言是空跑）", () => {
    const blocks = dirs.flatMap((dir) => bashBlocks(readSkill(dir)))

    expect(
      blocks.some((block) => /--stated-by-owner|--agent-collected/.test(block)),
    ).toBe(true)
  })
})
