/**
 * 文档里的命令必须真的存在（ADR-0040 第五点的机械门禁）。
 *
 * 为什么需要它：`AGENTS.md` 是**自足的基线**——没有扩展、没有 skill 的 harness 也会照它
 * 做事。一句指向不存在的命令不会报错，只会让照着做的人撞墙；而"文档慢慢漂离实现"
 * 是渐进的，评审看不出来。这条测试把漂移变成红色。
 *
 * 检查两件事：**命令名存在**、**用到的 flag 出现在该命令的 `usage` 里**。
 * 覆盖 `AGENTS.md`、`skills/*\/SKILL.md` 与 `BRIEF_SEE_ALSO`（简报里的下钻命令）。
 */
import fs from "node:fs"
import path from "node:path"
import { commands } from "./commands"
import { BRIEF_SEE_ALSO } from "../lib/web/brief"

const REPO_ROOT = path.resolve(__dirname, "..")
const COMMAND_LINE = /npm run --silent agent -- ([a-z][a-z0-9-]*)([^\n]*)/g

/**
 * 截掉散文：文档里的命令后面常跟着 `| jq`、反引号说明或中文注释。
 * 不截的话，「不加 `--silent` 时…」这类说明会被当成命令的 flag。
 */
function commandTail(rest: string): string {
  return rest.split(/[`|#\u4e00-\u9fff]/)[0]
}

function snippetsIn(file: string): { command: string; rest: string }[] {
  const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
  const found: { command: string; rest: string }[] = []
  // 用 exec 循环而不是 `for…of matchAll`：本仓库 target 是 es5，迭代器协议要
  // downlevelIteration，而这条门禁不该为了语法形态去改全局编译选项。
  const pattern = new RegExp(COMMAND_LINE.source, "g")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    found.push({ command: match[1], rest: commandTail(match[2]) })
  }
  return found
}

const skillFiles = fs
  .readdirSync(path.join(REPO_ROOT, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `skills/${entry.name}/SKILL.md`)
  .filter((file) => fs.existsSync(path.join(REPO_ROOT, file)))

const documented = [
  ...snippetsIn("AGENTS.md"),
  ...skillFiles.flatMap((file) => snippetsIn(file)),
  ...Object.values(BRIEF_SEE_ALSO).flatMap((line) => {
    // 与 AGENTS.md 用同一套提取：简报里的 seeAlso 写的就是完整命令前缀。
    const match = new RegExp(COMMAND_LINE.source).exec(line)
    return match ? [{ command: match[1], rest: commandTail(match[2]) }] : []
  }),
]

describe("文档里的命令必须真实存在（ADR-0040）", () => {
  it("每一处 `npm run --silent agent -- <cmd>` 的 cmd 都在 commands 里", () => {
    const known = new Set(commands.map((command) => command.name))
    const missing = documented
      .filter((snippet) => !known.has(snippet.command))
      .map((snippet) => snippet.command)

    expect(missing).toEqual([])
  })

  it("命令里用到的每个 flag 都写在该命令的 usage 里", () => {
    const byName = new Map(commands.map((command) => [command.name, command]))
    const unknownFlags: string[] = []

    for (const snippet of documented) {
      const command = byName.get(snippet.command)
      if (!command) continue

      const flagPattern = /--([a-z][a-z0-9-]*)/g
      let flagMatch: RegExpExecArray | null
      while ((flagMatch = flagPattern.exec(snippet.rest)) !== null) {
        const flag = `--${flagMatch[1]}`
        if (!command.usage.includes(flag)) {
          unknownFlags.push(`${snippet.command} ${flag}`)
        }
      }
    }

    expect(unknownFlags).toEqual([])
  })

  it("自证：把命令名改错一个字母，第一项检查会抓住它", () => {
    const bogus = { command: "list-dues", rest: "" }
    expect(commands.some((command) => command.name === bogus.command)).toBe(
      false,
    )
  })
})
