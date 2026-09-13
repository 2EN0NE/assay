# AGENTS.md - Fatebook Development Guide

This file provides context for AI agents operating in the Fatebook codebase.

## Core Principles

### 1. Clarify Requirements Before Acting

- Ask clarifying questions when uncertain, confirm with user
- **Important**: Don't dive into details immediately; explore from decisive high-level to details
- Ask "what to do" first, then "how to do"

### 2. TDD Approach - Test First

- Design test cases before writing code
- Before starting work, check if corresponding test cases exist
- If no test cases exist, design them and confirm with user
- Run test regression after completing code

### 3. Experience Accumulation

- Summarize and collect effective experiences during work
- Document cases in `knowledge/` directory for accumulation
- Prefer categorization and consolidation over excessive unrelated content
- Important experiences can also sync to AGENTS.md

### 4. Documentation Language Convention

- **Authoritative documents** (like AGENTS.md) keep single language only
- **Explanatory documents** (like README.md) may have bilingual versions
- AI agent working language: follow user preference

### 5. Task Tracking with todo.md

- Before starting any task, create a `todo.md` file in the project root
- Break down the task into atomic subtasks
- Check off each subtask as it is completed with `[x]`
- After all tasks are complete, append git commit message suggestions at the end of `todo.md`
- Delete the `todo.md` file after committing (or keep for reference if needed)

```markdown
# Todo List

## Task: [Task Description]

- [ ] Subtask 1
- [ ] Subtask 2
- [ ] Subtask 3

---

## Git Commit Message Suggestions

// ... commit message suggestions here ...
```

### 6. Progress Tracking with progress.txt

- Create `progress.txt` in project root to prevent context rot
- Record completed work state and lessons learned after each session
- **Write to file on each iteration**, read at start of new context
- Format: timestamp, completed tasks, key decisions, lessons learned, next steps

```markdown
# Progress Record

## Session: [Date/Time]

### Completed

- [Task 1]
- [Task 2]

### Key Decisions

- Decision: [What was decided]
- Rationale: [Why]

### Lessons Learned

- [Lesson 1]
- [Lesson 2]

### Next Steps

- [Next task]
```

### 7. Strategic Planning Reference

- Engineering knowledge is stored in `knowledge/` directory
- Strategic planning document is in `knowledge/planning.md` - answers "what should we do next?" based on project goals and current state
- **todo.md** in project root: tactical task breakdown for current session
- **knowledge/planning.md**: strategic phase planning for project direction

When asked "what should we do next based on current strategic planning?", consult the planning document and provide actionable options with reasoning.

### 8. Docker Sandbox Isolation (Running OpenCode)

Running OpenCode inside a Docker container is a critical security measure. It prevents AI from accidentally deleting host files or executing dangerous commands during automated iterations.

#### Why This Matters

- **Host Protection**: Isolates AI operations from the host filesystem
- **Damage Control**: Even if AI goes rogue, it only affects the container
- **Clean Environment**: Each task starts with a fresh, predictable environment

#### Docker Configuration

Create `docker-compose.yml` in project root:

```yaml
services:
  opencode-sandbox:
    image: node:18-bullseye
    volumes:
      - .:/workspace
    working_dir: /workspace
    user: node
    command: tail -f /dev/null
```

#### Security Best Practices

| Setting   | Recommendation                  | Purpose                     |
| --------- | ------------------------------- | --------------------------- |
| User      | Run as non-root (`user: node`)  | Limit container privileges  |
| Read-only | Use `:ro` for sensitive dirs    | Prevent accidental writes   |
| Network   | `network_mode: none` if offline | Prevent data exfiltration   |
| Resources | `--memory=2g --cpus=1.5`        | Prevent resource exhaustion |

#### Verification

```bash
# Confirm running inside container
ls /.dockerenv

# Check current user
whoami
```

#### Alternative: OrbStack

If using OrbStack (macOS), configure Docker sandbox through its settings for easier management.

---

### 9. Parallel Development with Worktrees

Single-threaded AI coding cannot meet demands for parallel feature development. Use Git worktrees to create isolated "containers within containers" - each worktree runs a dedicated OpenCode instance for independent, parallel development.

#### Core Principles

- **Isolated Execution**: Each worktree operates independently with its own branch, port, and database
- **Parallel Progress**: Multiple features can be developed simultaneously without interference
- **Sequential Integration**: Features merge one-by-one to main after passing tests and rebasing

#### Worktree Setup for Parallel Development

```bash
# Create worktree with dedicated branch
git worktree add -b task/xxx ../fatebook-worktrees/task-xxx

# Create isolated data directory
mkdir -p ../fatebook-worktrees/task-xxx/data

# Symlink shared configuration (NOT progress.txt - each worktree has its own)
ln -s ../../fatebook/data/dev-tasks.json ../fatebook-worktrees/task-xxx/data/
ln -s ../../fatebook/api-key.json ../fatebook-worktrees/task-xxx/data/

# Symlink node_modules for faster startup
ln -s ../fatebook/node_modules ../fatebook-worktrees/task-xxx/

# Dedicated port: base 3005 + task_index
# task-001 → 3005, task-002 → 3006, etc.
```

#### Conflict Resolution Principles

When multiple worktrees modify the same files, conflicts are inevitable. Follow these principles:

##### Rebase Failure Handling

```
If "unstaged changes" error:
  → Commit or stash current changes first

If merge conflicts:
  1. View conflicting files: git status
  2. Read conflict markers to understand both sides' intent
  3. Manually resolve (keep correct code, reject incompatible changes)
  4. git add <resolved-files>
  5. git rebase --continue
  6. Repeat until rebase completes
```

##### Test Failure Handling

```
When tests fail:
  1. Run: npm test
  2. Analyze error messages - identify root cause
  3. Fix the bug in your code
  4. Re-run tests until all pass
  5. Commit fix: git commit -m "fix: ..."
```

**Critical Rule**: Never give up. When rebase or tests fail, you MUST resolve before proceeding. Do not mark task as failed to bypass issues.

##### Conflict Prevention Strategies

- **Assign clear file ownership**: Different worktrees should modify different modules when possible
- **Coordinate before starting**: Check dev-tasks.json to understand what others are working on
- **Communicate intent**: If you must modify shared files (e.g., AGENTS.md, shared types), coordinate with other agents

##### Worktree Cleanup Best Practices

> **Note**: The `worktree-cleanup` skill is now installed globally. Use it for automated cleanup.

- **Clean up immediately** after task completion to avoid stale worktrees
- **Never leave uncommitted changes** in worktrees - always commit before cleanup
- **Use `--force` when needed** - safe if all changes were committed
- **Verify with `git worktree list`** - confirm only main worktree remains
- **If session crashes** - manually clean up in next session using the commands above

---

## Task Lifecycle (Automated)

This section describes the automated task lifecycle for AI agents. When properly configured, the agent can automatically pick up tasks, implement them in isolated workspaces, commit changes, and merge to main.

### Task Data Structure (`data/dev-tasks.json`)

Create `data/dev-tasks.json` in project root to manage tasks:

```json
[
  {
    "id": "task-001",
    "title": "Add user profile feature",
    "description": "Implement user profile page with avatar upload",
    "status": "pending",
    "priority": "high",
    "assignee": "agent",
    "createdAt": "2026-02-01T00:00:00Z"
  }
]
```

### Workflow Steps

#### Step 1: Pick Up Task

Atomic operation - read from `data/dev-tasks.json` and select a task with `status: "pending"`. Mark it as `in_progress` before starting.

#### Step 2: Create Isolated Workspace

Follow the worktree setup instructions in **Section 8: Parallel Development with Worktrees** above. Each task gets its own isolated Git worktree with dedicated branch and port.

#### Step 3: Implement Feature

In the isolated worktree:

- Create `todo.md` for task breakdown
- Implement the feature following TDD approach
- Run tests locally before proceeding

#### Step 4: Commit Changes

```bash
git add .
git commit -m "<type>(<scope>): <subject>"
```

Follow [Conventional Commits](#git-commit-guidelines) format.

#### Step 5: Merge + Test

```bash
# Fetch and merge latest main
git fetch origin
git merge origin/main

# Run tests
npm test

# If any step fails, rollback to Step 3 and fix
```

#### Step 6: Auto-Merge to Main

```bash
# Rebase onto main
git fetch origin main
git rebase origin/main

# If rebase fails: resolve conflicts, then continue
# If rebase succeeds: merge to main
git merge main task-xxx
git push origin main

# If any step fails: rollback to Step 5
```

#### Step 7: Mark Complete

**CRITICAL**: Update `data/dev-tasks.json` to mark task as `completed` BEFORE cleanup. This prevents task status loss if process is killed.

```json
{
  "id": "task-xxx",
  "status": "completed",
  "completedAt": "2026-02-19T00:00:00Z"
}
```

#### Step 8: Cleanup

```bash
# Check for uncommitted changes first
git status

# If there are uncommitted changes, either commit or force remove
git worktree remove --force ../fatebook-worktrees/task-xxx

# Remove local branch
git branch -D task/xxx

# Delete remote task branch
git push origin --delete task/xxx
```

> **Tip**: Use the `worktree-cleanup` skill for automated cleanup (installed globally).

**Manual Cleanup Commands (backup):**

```bash
# Check for uncommitted changes first
git status

# If there are uncommitted changes, either commit or force remove
git worktree remove --force ../fatebook-worktrees/task-xxx

# Remove local branch
git branch -D task/xxx

# Delete remote task branch
git push origin --delete task/xxx
```

**Important Cleanup Notes:**

- **Always cleanup after task completion** - Stale worktrees cause confusion and potential conflicts
- **Use `--force` if needed** - If worktree has untracked files, force remove is safe since changes were committed
- **Verify cleanup** - Run `git worktree list` to confirm only main worktree remains
- **Session interrupted?** - If OpenCode session ends unexpectedly, manually cleanup in next session

#### Step 9: Experience Accumulation (Optional)

Record lessons learned in `progress.txt`:

```markdown
## Session: [Date/Time]

### Completed

- [Task description]

### Key Decisions

- Decision: [What was decided]
- Rationale: [Why]

### Lessons Learned

- [Lesson 1]
```

This step is optional - if the process is killed, task status in `dev-tasks.json` is preserved.

---

## Knowledge Management

Engineering knowledge documents are stored in `knowledge/` directory for future reference and reuse.

### Directory Structure

```
knowledge/
├── patterns/          # Reusable code patterns and solutions
├── decisions/         # Architecture and design decisions (ADRs)
├── planning.md        # Strategic phase planning document
├── troubleshooting/   # Common issues and resolutions
└── guides/            # How-to guides and tutorials
```

### Document Guidelines

- Each document should focus on a specific topic
- Include context: why this approach was chosen, trade-offs considered
- Reference related code files when possible
- Update documents when patterns change

### Experience Accumulation

During each work session:

- Summarize and collect effective experiences promptly
- Document cases in `knowledge/` directory for accumulation
- Prefer categorization and consolidation over excessive content
- Important experiences can also sync to AGENTS.md

---

## Project Overview

Fatebook (fatebook.io) is a prediction tracking platform with Slack/Discord integrations and a Chrome extension. Built with Next.js, tRPC, Prisma, and Tailwind CSS.

## Tech Stack

- **Framework**: Next.js 14 (Pages Router)
- **API**: tRPC + Zod validation
- **Database**: PostgreSQL + Prisma ORM
- **Styling**: Tailwind CSS + DaisyUI
- **Testing**: Jest + React Testing Library
- **Auth**: NextAuth.js (Google OAuth)
- **Integrations**: Slack API, Discord API

---

## Commands

### Development

```bash
npm run dev          # Start dev server on https://localhost:3005
npm run build        # Production build
npm run start        # Start production server
npm run studio       # Open Prisma Studio
```

### Linting & Formatting

```bash
npm run lint         # ESLint on lib/, pages/, components/
npm run format       # Prettier write all files
```

### Testing

```bash
npm run test                           # Run all tests
npm run test -- --coverage             # Run with coverage report
npm run test -- path/to/test.tsx      # Run single test file
npm run test -- --testPathPattern=foo  # Run tests matching pattern
```

---

## Code Style Guidelines

### TypeScript

- **Strict mode enabled** - No `any` types, no `@ts-ignore`
- **Strict null checks enabled** - Always handle null/undefined
- **Always await async functions** - `require-await` rule enforced

### Naming Conventions

| Element          | Format                          | Example                      |
| ---------------- | ------------------------------- | ---------------------------- |
| Variables        | camelCase                       | `userId`, `isActive`         |
| Constants        | UPPER_CASE                      | `MAX_RETRY_COUNT`            |
| Functions        | camelCase                       | `getUserById()`              |
| React Components | PascalCase                      | `Navbar.tsx`, `QuestionCard` |
| Interfaces       | PascalCase                      | `UserProfile`, `Question`    |
| Types            | PascalCase                      | `ForecastResult`             |
| Enums            | PascalCase (members UPPER_CASE) | `QuestionStatus`             |
| Type Parameters  | PascalCase                      | `T extends string`           |

### Imports

- **Order**: External libs → Internal libs → Components/UI → Styles
- **Use path aliases**: Avoid relative paths crossing directories
- **React imports**: Use `import { useState } from "react"` (not default)

```typescript
// Good
import { useState } from "react"
import { api } from "../lib/web/trpc"
import clsx from "clsx"
import Navbar from "../components/Navbar"

// Avoid
import React, { useState } from "react" // React not needed in React 18+
import { useState } from "../../../lib/utils" // Deep relative paths
```

### Error Handling

- **Never suppress errors** - No `as any`, `@ts-ignore`, `@ts-expect-error`
- **Handle promises properly** - Use `await` or `.catch()`, never float promises
- **Use Zod for validation** - All API inputs validated with Zod schemas

```typescript
// Good
const user = await getUser(id)
if (!user) throw new Error("User not found")

// Bad
const user = getUser(id) // Floating promise
const result = data as any // Type suppression
```

### Component Patterns

- Use **functional components** with hooks
- **Export named components**: `export function Navbar() {...}`
- **Co-locate tests**: `QuestionCard.test.tsx` next to `QuestionCard.tsx`
- **Co-locate types**: Define types in same file or `lib/types.ts`

### Tailwind CSS

- Use **DaisyUI components** when available (buttons, modals, dropdowns)
- Use semantic class names with DaisyUI tokens:
  - `btn btn-primary`, `btn btn-sm`
  - `modal`, `dropdown`, `card`
- Use `clsx` or `cva` for conditional classes

```tsx
<button className={clsx("btn btn-primary", isLoading && "loading")}>
  Submit
</button>
```

---

## Project Structure

```
fatebook/
├── components/          # React components
│   └── ui/             # Reusable UI components
├── lib/
│   ├── web/            # tRPC routers and web utilities
│   ├── blocks-designs/ # Slack block kit designs
│   └── interactive_handlers/  # Slack interaction handlers
├── pages/              # Next.js pages (API routes + pages)
│   ├── api/            # API endpoints
│   └── *.tsx          # Page routes
├── chrome-extension/   # Chrome extension source
└── prisma/            # Database schema
```

---

## Database

- **Prisma** for ORM - schema in `prisma/schema.prisma`
- Run `npx prisma generate` after schema changes
- Use `npx prisma studio` to explore data

---

## Testing Guidelines

- Tests go in `*.test.tsx` or `*.test.ts` files
- Import `@testing-library/jest-dom` for custom matchers
- Use `jest.useFakeTimers()` for time-dependent tests

```typescript
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { MyComponent } from "../MyComponent"

describe("MyComponent", () => {
  it("renders correctly", () => {
    render(<MyComponent />)
    expect(screen.getByText("Hello")).toBeInTheDocument()
  })
})
```

---

## VS Code / Debugging

- Use the **"Next.js: debug fatebook full stack"** launch config for debugging
- Set breakpoints in both frontend and API routes
- Works in Cursor and VS Code

---

## Common Patterns

### tRPC Router

```typescript
// lib/web/question_router.ts
import { z } from "zod"
import { router, protectedProcedure } from "./trpc"

export const questionRouter = router({
  create: protectedProcedure
    .input(z.object({ question: z.string(), resolutionDate: z.date() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.prisma.question.create({ ... })
    }),
})
```

### React Component with tRPC

```typescript
import { api } from "../lib/web/trpc"

export function MyComponent() {
  const questions = api.question.list.useQuery()

  if (questions.isLoading) return <span>Loading...</span>

  return (
    <ul>
      {questions.data?.map(q => <li key={q.id}>{q.text}</li>)}
    </ul>
  )
}
```

---

## Git Commit Guidelines

### Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/) standard format:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Type

| Type       | Description                               |
| ---------- | ----------------------------------------- |
| `feat`     | New feature                               |
| `fix`      | Bug fix                                   |
| `docs`     | Documentation only                        |
| `style`    | Code style changes (no functionality)     |
| `refactor` | Code refactoring (not new feature or fix) |
| `test`     | Adding or updating tests                  |
| `chore`    | Build process, tooling changes            |

### Examples

```
feat(auth): add Google OAuth login support
fix(api): resolve null pointer in question router
docs(readme): update installation instructions
refactor(components): extract shared Button component
```

### Important

**At the end of each conversation, provide git commit message suggestions for the current work.**

Suggestions should include:

- Commit message in the above format
- If multiple types of changes, provide multiple commit message suggestions

### Atomic Commits Principle

**Encourage small, atomic commits after each successful fix or implementation step.** This principle helps with:

- **Rollback safety**: Easy to revert specific changes without affecting others
- **Quality tracking**: Each commit represents a verified, working state
- **Code review**: Reviewers can focus on one logical change at a time
- **Debugging**: `git bisect` becomes much more effective

#### What Makes a Commit Atomic

An atomic commit should be:

1. **Focused** - One logical change per commit (e.g., "fix login bug" NOT "fix login and update styles")
2. **Complete** - The change is fully implemented, not half-done
3. **Buildable** - All tests pass after the commit
4. **Independent** - Can be understood without other commits

#### When to Commit

Commit after each successful:

- Bug fix (even a small one)
- Small feature implementation
- Refactoring that improves code
- Adding a test case
- Documentation update

#### Examples

```bash
# Good - Atomic commits
git commit -m "fix(auth): resolve null pointer in token validation"
git commit -m "feat(ui): add loading spinner to submit button"
git commit -m "test(api): add unit test for question router"
git commit -m "docs(readme): update installation instructions"

# Bad - Non-atomic commits
git commit -m "fix various bugs"           # Too vague, multiple fixes
git commit -m "wip"                         # Work in progress
git commit -m "update"                     # What was updated?
git commit -m "fix and refactor"           # Mixed concerns
```

#### Workflow Integration

During task implementation:

1. Complete a small, working change
2. Run tests to verify
3. Commit immediately with descriptive message
4. Continue to next step

If you make a mistake later, you can always use `git revert` or `git reset` to fix it.

---

## Notes

- This is a **Next.js Pages Router** project (not App Router)
- The dev server runs on **port 3005** with SSL proxy to port 3000
- ESLint is configured to require explicit return types on complex functions
- Prettier uses **no semicolons**

---

## 验证规范（agent 记录层）

本节是"agent 化改造"新增能力的**验证契约**。改动这一层之前先读它——这里的每一条都对应一个已定 ADR，破坏它们等于静默推翻决策。

### 权威判据是 `tsc`，不是语言服务器

**`npx tsc --noEmit`（或 `npm run typecheck`）是唯一权威的类型判据。**

本仓库存在一个反复出现的环境陷阱：`prisma generate` 之后，tsserver 仍持有 `@prisma/client` 的**陈旧缓存**，于是 IDE / pi-lens 会报出一批 `Property 'oracleKind' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'` 之类的错误——注意那个 `never`，它是**生成前的 stub 类型**的特征。

分辨方法（三条缺一不可，成本极低）：

1. `npx tsc --noEmit --listFiles | grep <文件>` —— 确认文件**真的在 tsc 的 program 里**，否则 exit 0 不能作为证据；
2. `npx tsc --noEmit` —— 独立进程，新鲜解析；
3. `grep -c <字段> node_modules/.prisma/client/index.d.ts` —— 确认生成产物里确实有该字段。

判据是"文件在 program 内 + tsc 干净 + 字段存在于生成产物"。三条同时成立即为陈旧缓存，重跑 `prisma generate` 或重启语言服务器即可，**不要改代码去迎合它**。

### 分层验证命令

| 层                    | 命令                | 前置                                                               |
| --------------------- | ------------------- | ------------------------------------------------------------------ |
| 类型                  | `npm run typecheck` | 无                                                                 |
| Lint                  | `npm run lint`      | 无                                                                 |
| 单元 / 组件           | `npm test`          | 无                                                                 |
| 端到端（agent → Web） | `npm run test:e2e`  | `docker compose up -d db mail` + `npx playwright install chromium` |

### 可观测性契约

- **CLI 的 stdout 是数据通道，只放 JSON；一切日志走 stderr。** 这是对 Agent 的公开契约（ADR-0015）。Prisma 默认把 `info` 写到 stdout，足以让下游 `JSON.parse` 崩掉——因此 `lib/prisma.ts` 用 event 模式接管输出，统一改道 stderr。**新增任何会写 stdout 的库之前，先确认它的输出去哪儿。**
- **调用 CLI 必须用 `npm run --silent agent -- …`**。不加 `--silent` 时 npm 会把自己的横幅（`> agent` / `> dotenv …`）写进 stdout，实测直接破坏上面那条契约；`--help` 同理走 stderr。
- **CLI 可达的代码用 `lib/_log.ts` 的 `log`（走 stderr），不要用 `console.log`**。`lib/web/resolution.ts`、`lib/_utils_server.ts`、`lib/web/notifications.tsx` 的 `console.log` 已全部改道（`settle` / `endorse` 会走计分路径，实测曾把 stdout 污染成不可解析）。CLI 边界另有一道守卫（`cli/args.ts` 的 `installStdoutGuard`）：非 `emitJson` 的 stdout 写入会**当场抛错**，而不是留给下游 `JSON.parse`。
- **校准排除只有一个定义处**：`lib/web/calibration.ts`。任何读取 forecast 做计分或画校准图的地方都必须经过它（ADR-0008）。新增计分入口时若不经过它，未背书样本会静默污染校准曲线，且**没有任何症状**。
- **相对分资格同在 `lib/web/calibration.ts`**（ADR-0002 的 `isRelativeScored`）：非公共事实类由**写入侧**把 `relativeScore` 写成 `null`（`lib/_scoring.ts` 的 `dropRelativeScores`），**读侧一律把 null 当"不参与相对分"**（`AVG` 忽略 null、聚合处 `!== null` 过滤）。新增计分或排行榜聚合时不要自行判断 `oracleKind`，也不要把 null 当成 0。
  - **「不参与相对分」只有 `null` 一个表示**（ADR-0002 的落地面）。单预测者与 非公共事实类 都归到它。**`undefined` 会被 Prisma 当作"跳过该字段"**——create 看着对（列默认 NULL），update 却把旧的相对分留在库里，因此 `ScoreTuple.relativeBrierScore` 的类型是 `number | null`，不是 `number | undefined`。
  - `RELATIVE_SCORED_ONLY` 是同一规则的 Prisma `where` 形式，**当前没有消费者**（过滤发生在写入侧）。**不要为了"用上它"而新增查询侧过滤。**
- **修订留痕的判定是纯函数**：`lib/web/revisions.ts` 的 `planRevisions` 与 `missingRevisionReason`。写入路径（`question_router.editQuestion`）只负责取快照、校验理由与同事务落库。新增"已冻结字段"时改这个常量数组，而不是散落地加 if。

### 端到端测试保护的是哪条路径

`e2e/agent-cli.spec.ts` 覆盖的**唯一**值得保护的路径：**agent 经 CLI 写入 → 人在 Web 上看到 → 人背书 / 确认**。

- 先跑 CLI 再开页面，是为了证明 CLI **不依赖 Next.js 服务**（ADR-0015 的核心承诺）。
- 断言"未背书"标记与背书按钮，是为了让 ADR-0007（人工 UI 是最高权威输入源）不沦为空话——**如果 agent 写下的东西在界面上看不见、无法背书，"未背书不进校准"就是一条无法履行的规则。**
- 断言"无来源的公共事实结算降级为提案"，是 ADR-0004 的行为锁。

### 本地环境注意

- 迁移可在**无数据库**时离线生成：`npx prisma migrate diff --from-schema-datamodel <旧> --to-schema-datamodel prisma/schema.prisma --script`。
- 本地 CLI 与 e2e 都依赖 `.env`（被测仓库不含该文件，从 `.env.example` 复制）。CLI 的 owner 身份来自 `FATEBOOK_AGENT_USER_EMAIL`，**该邮箱必须已存在账号**（先在 Web 用 magic link 登录一次即可创建）。
- macOS 无 `timeout` 命令；`sed -i` 需要空参数 `sed -i ''`。

---

## 概率显性化（对话层）

本节管"当事人嘴里的说法"如何变成一个 `Forecast` 的概率数字。术语见 `CONTEXT.md` 的 `Elicitation / 概率显性化`，问法见 `.pi/skills/decision-capture/SKILL.md` 第 3 步。

- **基准：模糊的正确优于精确的错误。** 不要为了形式整齐拒绝一个粗粒度回答（"满分 10 分里的 8 分"），也不要因为一个数字"太精确"就改写它——精度本身携带信息。
- **口语与量表回答必须折算为概率。** "七成"→0.7、10 分制的 8 分→0.8、转盘上 65% 才肯下注→候选 0.65。它们是**同一信念的不同表示**，不是另一个量；`Forecast` 只存概率。
- **判据是"换算是否无损"。** 无损（换表示）→ 可直接落库；有损（需额外假设）→ 必须**复述给当事人确认**后再落库。
- **否定检验只能用命题的逻辑否定。** "明天不下雨"是"明天下雨"的否定；"天晴"不是——雨 30% 与晴 10% 可由阴天 60% 补齐，因此二者**不构成矛盾**。用近义事件当否定会产生无根据的追问，而无根据的追问正是 `Compliance Number` 的来源。
- **具体化量到的是偏好，不是信念。** 赌局同时测出风险偏好与赌注大小，其输出只是候选值，必须经当事人确认；**不得由 agent 按"风险中性"自行折算**。
- **折算结果的录入来源（ADR-0008）：** 直接说出的百分比、量表折算结果、经确认的具体化候选值，都算"数字由当事人给出"（`AGENT_INSTRUCTED`，默认已背书）；只有 agent 自己产生、当事人从未说过的数字才是 `--agent-collected`。

---

## 日志体系

日志只有一个出口（`lib/_log.ts`），stdout 只归数据。这条契约的破坏方式是**静默的**：一行 `console.log` 会让下游 `JSON.parse` 崩在一个离案发现场很远的地方。

| 出口               | 位置          | 通道       | 放什么                                                                                                   |
| ------------------ | ------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `emitJson()`       | `cli/args.ts` | **stdout** | CLI 的**数据**。唯一合法写入者，由 `installStdoutGuard()` 守卫——非 `emitJson` 的 stdout 写入**当场抛错** |
| `log()` / `warn()` | `lib/_log.ts` | **stderr** | 其它一切：诊断、警告、CLI 的用户可见输出、Prisma 事件、`--help` 文本                                     |

- **项目代码不要直接调用 `console.*`**，用 `lib/_log.ts` 的 `log` / `warn`。ESLint 的 `no-console` 就是这条契约的执行者（`.eslintrc.json`；`lib/_log.ts` 自身与测试文件豁免）。注意现有 `lint` 脚本只覆盖 `lib/ pages/ components/`——**`cli/` 不在其中**，改了 CLI 要自己看一眼。
- **`log` 用 `console.error`、`warn` 用 `console.warn`，这是刻意的**：Node 里**只有这两个方法写 stderr**，`console.log` / `console.info` 写的是 stdout。浏览器里它们仍是普通 console 方法，行为不变。
- **需要上下文时把来源写进消息本身**（例如 `prisma:info …`），不靠前缀约定。早先 CLI 有一套自己的 `log` 实现与 `[agent]` 前缀，已删除——**两套实现比少一个前缀糟得多**。`lib/prisma.ts` 的 event 订阅、`--help` 文本、CLI 的用户可见输出现在都经同一个出口。
- **新增任何会写输出的库之前，先确认它的输出去哪儿。** Prisma 默认把 `info` 写到 stdout（足以让下游 `JSON.parse` 崩掉），现由 `lib/prisma.ts` 的 event 模式接住并统一改道。
- **验证（两条，缺一不可）**：
  - `npm run --silent agent -- list-due | jq .` —— stdout 必须**可解析**。不加 `--silent` 时 npm 会把自己的横幅写进 stdout，同样破坏契约。
  - `npm run --silent agent -- --help >/dev/null` —— `--help` 必须走 stderr（stdout 字节数为 0）。
