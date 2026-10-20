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
- **Explanatory documents** (like README.md) may have bilingual versions — **this repo's `README.md` is Chinese-only** (the `README.zh-CN.md` mirror was deleted)
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

### 10. Interaction-Surface Parity (CLI ⟷ Web)

The CLI and the Web UI are **two interaction surfaces over one set of capabilities — not two products**. For every capability this project defines (Decision, Prediction, rubric and narrative, settlement, delivery), **if one surface has it, the other must have it**. Differences are allowed in _form and habit_ only: the CLI serves agents and scripts (deterministic JSON, one command), the Web serves humans (side-by-side, colour, clickable). A difference in form is not a difference in capability.

- **Scope**: this project's own feature surface. Capabilities inherited from upstream fatebook (Slack, Discord, the Chrome extension, tournaments, blog) are **not** covered — most are already outside the MVP per ADR-0013.
- **Unit of parity**: a tRPC procedure. A procedure reachable on only one surface must be registered as a deliberate exception, **with a reason**.
- **Deliberate exceptions** are listed, never silently tolerated. The first is _sign-in_: the Web signs in by email/OAuth, the CLI by credential — the capability ("prove who I am and obtain a credential") is identical, the form cannot be. Current list: [ADR-0023](docs/adr/0023-interaction-surface-parity.md).
- **Enforcement**: `cli/parity.test.ts` is the gate. It reads each surface's reachability **from source** — the CLI surface from `cli/commands.ts`, the Web surface from `api.<router>.<name>` references under `pages/` and `components/` — then compares every procedure of the `agent`, `decision` and `tags` routers against the exception list: a procedure reachable on only one surface, with no registered reason, is named by the failing test. A stale exception (the other surface has since caught up) turns it red too, prompting the row's removal.

  The price is that the exception list is **maintained inside the test file** (every entry must carry a reason, copied from ADR-0023's "current exception list"): adding a procedure without deciding where it lands on the other surface fails the gate. That is deliberate — a "silent absence" is exactly what this rule exists to prevent.

Rationale, rejected alternatives and the current exception list: [ADR-0023](docs/adr/0023-interaction-surface-parity.md).

#### One backend, three exposures

Business behaviour has **exactly one implementation**: the tRPC procedures in `lib/web/`. A surface is an adapter over those procedures, never a second implementation of the rules.

| Exposure                  | Where                   | How it reaches the backend                                                                                                                                                                |
| ------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI (agents, scripts)     | `cli/`                  | calls `appRouter` **in-process**; touching `prisma` for a _business_ operation is forbidden (identity lookup, connection teardown and pre-flight counts are infrastructure, not business) |
| Web (humans)              | `pages/`, `components/` | calls the same procedures over tRPC                                                                                                                                                       |
| Agent skill (any harness) | `skills/`               | a **projection of the CLI command surface** — instructions and examples only, never behaviour of its own                                                                                  |

Adding a capability therefore has a fixed order: **procedure → CLI command → skill entry → Web entry**. The last one matters only when the capability is user-facing; the parity gate in `cli/parity.test.ts` decides that, and a new capability is not done until both surfaces are settled.

**Which primitive: `ownedProcedure` or `credentialProcedure`** (ADR-0035). Every procedure inherits one of three declared answers to "凭什么" — `ctx.authentication` is `session` (the HTTP path, always), `credential` (a real API key, from `--api-key` / env / key file) or `identity-selector` (`FATEBOOK_AGENT_USER_EMAIL`, which is **not** a secret: anyone on the box who sets it is that identity). `ownedProcedure` accepts all three; `credentialProcedure` accepts only `credential`. Anything a **credential holder alone** may do — issuing a pairing code today — uses `credentialProcedure`, otherwise a web session can do it for itself via `/api/trpc` and the ADR sentence becomes a comment. The mapping lives at the construction sites (`lib/web/context.ts`, `cli/context.ts`) and is asserted in `cli/context.test.ts`.

**Harness neutrality.** A skill must load in any runtime that follows the [Agent Skills specification](https://agentskills.io/specification) — no pi-specific paths or flags may appear in the skill body, and the skill must state provenance **explicitly** instead of relying on the caller's environment (environment markers only supply a default; see ADR-0024). A non-pi agent must record what a pi agent would record.

**Deliverable shape.** Every agent-facing capability ships with an executable acceptance path: what to say, what to run, what to observe. "It should work" is not acceptance — see `docs/uat-pi-agent.md` for the first one.

**No harness-specific artefacts.** This project ships three exposures: the CLI, the Web UI, and Agent Skills. Anything that works only inside one agent runtime — a pi extension, a Claude hook, a cron job, a long-running pusher — is out of scope, however convenient it would be: it re-binds "does this work" to that runtime, which is the thing the skill format exists to avoid. Reminders and tracking are therefore **pull-based**: `AGENTS.md` tells the agent to pull the due queue at the start of a session, and the skill states when to pull. Never a background process.

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
- **Never put a test file under `pages/`**: Next.js turns every `.ts`/`.tsx` file there into a
  route, `*.test.ts` included — `next build` will happily emit `/api/<name>.test` as an
  endpoint that tries to load jest modules in production. A test for a page or API route
  belongs in the domain module it guards (e.g. `lib/web/`) and imports the handler from
  `pages/`.

### 单元 vs e2e 的分工

| 层          | 位置                               | 该放什么                                                                                                                 |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 单元 / 组件 | `**/*.test.ts(x)`（不能放 pages/） | 纯逻辑密集点：计分、状态机、修订判定、CLI 参数与身份分发、清单版本。数据库一律用 `jest.mock` 假客户端，不连真库。        |
| 集成        | e2e 里的真库用例                   | 数据库级行为：`onDelete: SetNull`、CHECK 约束、迁移后果。只有真库能验，不要用单测假装覆盖了它。                          |
| 端到端      | `e2e/*.spec.ts`                    | 用户可感知的完整旅程：CLI 写入 → Web 看见 → 人背书/确认；登录 → 建预测 → 结算。断言 stdout/stderr/exit code 与界面文案。 |

**覆盖率只用于守住不减，不用于证明正确**：`jest.config.ts` 的 `coverageThreshold` 只给
逻辑最密的模块与校准图端点设下限（50–80%，留出余量）。门槛贴着实测值（曾经 49.91% vs 50%）
会让它在换 Node 版本时自己变色——设阈值时留 5pp 以上。

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

**pi-lens 的额外规则不是本仓库的门禁。** 它的格式化器与 Prettier 兼容（实测：它重排过的文件仍过 `prettier --check`），但它另外跑一套仓库不管的规则（Markdown MD060、对 `scripts/` 也报 `no-console`）。判定本仓库是否合格，只看 `tsc` + `next lint` + `jest`（CI 口径见下表）。

**`pi-lens-ignore` 标记只用于真实规则。** 本仓库已有三处（`no-eval` / `no-open-redirect` / `unchecked-throwing-call`）——那是“这条规则我不接受”的声明。**不要用它给工具自身的 bug 打补丁**（例如陈1旧 Prisma 快照导致的 `typescript:2322`）：那种补丁会长期留在源码里，而它真正需要的是重启语言服务器。`.pi-lens.json` 这类本机配置已进 `.gitignore`，不要入库。

### 分层验证命令

| 层                     | 命令                    | 前置                                                               |
| ---------------------- | ----------------------- | ------------------------------------------------------------------ |
| 类型                   | `npm run typecheck`     | 无                                                                 |
| Lint                   | `npm run lint`          | 无                                                                 |
| 单元 / 组件            | `npm test`              | 无                                                                 |
| 单元 + 覆盖率门槛      | `npm run test:coverage` | 无（**CI 跑的是这条**；本地只跑 `npm test` 会看不到门槛）          |
| 端到端（agent → Web）  | `npm run test:e2e`      | `docker compose up -d db mail` + `npx playwright install chromium` |
| 生产构建（客户端打包） | `npx next build`        | 无（**在 `pages/` 下新增或被导入的模块必须跑这条**，见下）         |

> **本地要跑与 CI 完全一致的那条**：`.github/workflows/test.yml` 的门禁是 `test:coverage`（`jest.config.ts` 的 `coverageThreshold` 只在它下面生效）。历史上交付记录里写的都是 `npm test`，于是某个新模块跌破阈值时**本地全绿、CI 全红**，谁都没看见。`.husky/pre-push` 现在跑的就是 `test:coverage`。

> **`pages/` 下的模块必须能被浏览器打包**：页面即便只在 `getServerSideProps` 里用某个
> 服务端模块，Next 也会把它打进**客户端**那一份 bundle。一个 `import crypto from "node:crypto"`
> 就足以让整页变成 "Build Error"（实测：`UnhandledSchemeError: Reading from "node:crypto"
is not handled by plugins`），而 `tsc` / `eslint` / 单测全绿——**只有 `npx next build`
> 或 e2e 看得见**。做法是把浏览器要用的部分拆到一个零 `node:` 依赖的叶子模块里
> （`lib/web/pairing_flag.ts` 就是为此存在，`pairing_flag.test.ts` 用源码断言守住这条）。

### 改动数据库里**已有的**数据之前，先跑 `scripts/verify-migration-upgrade.ts`

**这是什么时候的事。** 库里已经存着真实数据（题、预测、结算记录……）。有时候改动不只是“加一张新表”，而是**要动那些已经存在的老行**。两种情况最常见：

1. **回填**：新加一列（例如“这条结算是谁确认的”），同时**替历史上已经结算过的老题把这一列补上**。补什么值是**你替过去的用户做的一个决定**。
2. **收紧规矩**：例如“领域名不允出现只差大小写的两个”。库里若真有 `CPI` 和 `cpi` 两行，迁移会**失败**——这是**想要的**（得有人来决定合并哪一个），但你得提前知道。

**为什么不能只靠 CI。** CI 里的 `prisma migrate deploy` 每次都在一个**全新的空库**上跑。空库上没有老行，回填等于什么也没做，所以**写错也照样绿**。它只证明了“迁移能跑起来”，没证明“你库里的几百行会被改成什么样”。而回填写错的后果是**不报错的**：样本静静地少一批或多一批，数字变了而你不知道。

**它能帮上什么忙。** 它开一个独立的小库（**不碰你的开发库**），先把这次改动**之前**的迁移都应用上去，塞进一批符合老结构的数据，再跑完整迁移，然后检查三件事：

1. 该补的有没有补上（老行现在有值了吗？值对不对？）；
2. 不该动的有没有被动（例：没结算的题不该被写上确认者）；
3. **该失败的地方有没有失败**（有大小写冲突时必须大声报错，而不是悄悄丢掉一行）。

跑法：`npx tsx scripts/verify-migration-upgrade.ts --keep`（`--keep` 把那个样本库留下，可以自己进去看）。CI 每次会替你跑一遍。

**⚠️ 它只认识写死的那几条迁移，不会自动跟上你新写的。** 所以新增迁移时：

- 只是加新表 / 加一个**允许为空**的新列（不回填）/ 只加索引 / 改注释 → **不用管它**；
- 要**回填老数据**或**收紧约束** → **必须在这个脚本里补上检查**（把新迁移加进顶部的 `UPGRADE_MIGRATIONS`，并在同一脚本里加断言）。否则 CI 的绿灯与这次的改动无关——**比没有门禁更糟**：没有门禁时你知道自己在裸奔，有骗人的绿灯时你以为有人守着。

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

## 文档声明必须可在仓库里被验证

**任何"已实现 / 已完成"的陈述都要能在当前仓库里被检验**：AC 勾选、`Status` 行、CLI 命令的 `summary`、README 的步骤、文档里的字段名，一律如此。做不到就只有两条路——**实现它**，或**把陈述改成如实并注明推迟**；不要留许愿式文档。

判据是可核对的：说"已完成"就要能指出**在哪里可跑、在哪一行可读**；指不出来就不是已完成。这条并非洁癖——一次评审从同一种毛病里抓出多处：数据模型文档写着 `note`（可选补充）而全仓无人写、无人显示；`show-decision` 的 `summary` 称返回"分数"而实现只回标量；ticket 的 AC 勾着"叙事仍可补充"，而那个写入口没有任何调用方；多处 `[x]` 与其实现不符（含一条**假 `[x]`**：称某个词条已修正，而实际只改了正文、没改标题）。**声明与实现不一致时，后来的人会按声明行事，而错的是声明。**

同理适用于**数字快照**："全量 N 个测试通过"这类数字一交付就陈旧，因此**优先给可重跑的命令**（`npm test` / `npm run test:e2e`）；确实要记数字，就必须标明它是**当时快照**——`docs/issues/agent-capture-mvp/verification.md` 是正例：正文给数字，紧跟一句"上表两组数字是记录当时的状态"。

---

## ADR 只追加，但必须写明它改掉了哪一句

ADR **只追加、不回改**：历史决策保持原样，新结论写进新的一篇。代价是**同一件事会在多篇里留下多个"最新版本"**，而读者无从判断哪个作数。一次针对 `docs/adr/` 的评审就从这条漏洞里抓出成组的矛盾：ADR-0007 用"有没有明确指令"定义 provenance，而 ADR-0008 明确说判据取"数字的来源"、两者会分歧，0007 的正文至今没改；ADR-0020 定的清单锁定不可回退，与 ADR-0012"已冻结字段可改、留痕即可"并存；ADR-0006 立下"必选"的保证，而 ADR-0005 / 0015 / 0017 把唯一的兑现者（时机）整体移出本仓库。

因此：**每篇新 ADR 必须显式写出它修正了谁**——哪一篇、哪一句、原来怎么规定、现在改成什么。两种改法分别这样写：

- **取代**：`本 ADR 取代 ADR-00XX 关于「…」的规定（原句见该篇第 N 节）。`
- **收窄 / 补充**：`ADR-00XX 的「…」在本 ADR 下收窄为「…」，其余不变。`

没有改动就不必写。判据是可核对的：**读那篇旧 ADR 时，能顺着指回新 ADR 的那句话知道"此处已变"**；做不到就会出现两篇都是最新版的局面——那不是保留历史，而是两套规则并行，且没人知道自己读的是哪一套。

---

## 概率显性化（对话层）

本节管"当事人嘴里的说法"如何变成一个 `Forecast` 的概率数字。术语见 `CONTEXT.md` 的 `Elicitation / 概率显性化`，问法见 `.pi/skills/decision-capture/SKILL.md` 第 3 步。

- **基准：模糊的正确优于精确的错误。** 不要为了形式整齐拒绝一个粗粒度回答（"满分 10 分里的 8 分"），也不要因为一个数字"太精确"就改写它——精度本身携带信息。
- **口语与量表回答必须折算为概率。** "七成"→0.7、10 分制的 8 分→0.8、转盘上 65% 才肯下注→候选 0.65。它们是**同一信念的不同表示**，不是另一个量；`Forecast` 只存概率。
- **判据是"换算是否无损"。** 无损（换表示）→ 可直接落库；有损（需额外假设）→ 必须**复述给当事人确认**后再落库。
- **否定检验只能用命题的逻辑否定。** "明天不下雨"是"明天下雨"的否定；"天晴"不是——雨 30% 与晴 10% 可由阴天 60% 补齐，因此二者**不构成矛盾**。用近义事件当否定会产生无根据的追问，而无根据的追问正是 `Compliance Number` 的来源。
- **具体化量到的是偏好，不是信念。** 赌局同时测出风险偏好与赌注大小，其输出只是候选值，必须经当事人确认；**不得由 agent 按"风险中性"自行折算**。
- **折算结果的录入来源（ADR-0008 / ADR-0024）：** 直接说出的百分比、量表折算结果、经确认的具体化候选值，都算"数字由当事人给出"（已背书）；只有 agent 自己产生、当事人从未说过的数字才是 `--agent-collected`（未背书，须背书后才计入校准）。**默认方向按调用上下文决定**：agent 代跑（环境里有 `AI_AGENT` / `PI_CODING_AGENT`）时默认未背书，人自己在终端里敲时默认已背书；`--stated-by-owner` 与 `--agent-collected` 是显式声明，永远压过默认。旧值 `AGENT_INSTRUCTED` 已不再产生（历史行仍在库里）。

---

## 跟踪回路：会话开始时拉一次状态简报

skills 有两半：`decision-capture`（捕获）与 `settlement-tracking`（跟踪）。**只有捕获没有
跟踪时，队列会积一堆永远不结算的题**，而“永远不结算”不会报错——它只是让所有读数慢慢
失效（ADR-0034）。

**会话开始时先拉一次简报**（对话涉及决策 / 复盘 / 到期时也先拉）：

```bash
npm run --silent agent -- brief
```

`brief` 是**现算**的当前状态（ADR-0039：不落库、只有一个生产者）：未结算总数与到期分布
（逾期 / 一周内 / 一月内 / 一月以上）、最近 3 条、清单有未记录条目（可救 / 已冻结）、未标领域、
未背书数字、无预测的决策、**承诺到期却没执行也没放弃的动作数**。每一栏都带 `seeAlso`
下钻命令——直接照抄它，不要自己拼。

- **三栏各归各位**（在 `list-due` 里；`brief` 只报到期分布 `due`）：`settleable` 是待办；
  `upcoming` 是“还没到点”（见下一条）；`dangling` 是“没法定论”（只有他人的无来源确认，
  ADR-0031）——后者需要的是补来源或问当事人，不是你去结算。
- **`settleable` 与 `dangling` 不要混**：混在一起会让人把“没法定论”读成“我还没去结算”，
  于是去替别人签字。
- **`--bucket` 下钻到未来分桶时，待办栏是空的**：`1w` / `1m` / `1m+` 的项还没到点，落在
  `upcoming` 栏。把 `upcoming` 当待办去结算，会把“一周内”读成“现在就该结”——而三栏的
  名字不同，正是为了让这种误读不可能发生（ADR-0039）。
- **提醒上限**：报**计数 + 分布**，明细最多 **3 条**，然后停下。不阻塞对话、不在每次
  回复里重复（ADR-0034 §四 / ADR-0039）。一条被忽略的提醒和不存在没有区别。
- **未标领域、未背书、清单未记录即使为零也要各报一行**——它们依附的是“拉过一次”，
  不是“数字非零”（ADR-0030 §八 / ADR-0038）。
- **动作逾期优先**：`actions.overdue > 0` 时先说它，再说到期预测——“你承诺要做而没做”
  比“世界该给答案了”更该动手（ADR-0041）。下钻：`list-decisions --action-overdue`。
- **默认不主动结算**：结算不可回退（ADR-0020 的锁定单向性）。先说清要结哪几条、依据是
  什么，等用户点头。
- 悬空那一栏的出口是**补录可核查来源**（`record-resolution-source`），但来源必须是真的：
  问用户，不要编一个链接填空——那比悬空更糟。

## Agent 主回路（自足，ADR-0040 的基线）

不装任何 skill 时，按这个顺序也能把一件决策走完。参数细节在 skill 里，这里只给**不变量**。

```bash
# 1) 捕获：先写下动作与承诺时点（ADR-0041），再记清单，再拆预测
npm run --silent agent -- create-decision --statement "…" --action "…" --action-due 2026-11-01
npm run --silent agent -- set-rubric --decision-id ID --done a,b --not-done c,d,e
npm run --silent agent -- create-prediction --title "…" --resolve-by 2026-11-15 --criteria "…" --probability 0.7 --stated-by-owner
npm run --silent agent -- attach-prediction --decision-id ID --question-id QID

# 2) 结算：带来源直接结算；无来源先提提案等确认（ADR-0004 / ADR-0031）
npm run --silent agent -- settle --question-id QID --resolution YES --source "…"

# 3) 执行事实：只增不改；放弃用 --abandoned（ADR-0041）
npm run --silent agent -- record-execution --decision-id ID

# 4) 事后表达：揭晓后写复盘记录，不要再改叙事字段（ADR-0037）
npm run --silent agent -- record-reflection --decision-id ID --text "现在回看…"
```

三条硬规矩：**写入只走 CLI**（不要直连数据库）；**不要替用户编概率**（宁可未量化，
ADR-0011）；**清单“未记录”不等于“没做到”**（ADR-0038）。

## 基线与加速器（ADR-0040）

- **基线**：CLI（`brief` + 下钻）+ 本节与上面的主回路 + `skills/`。任何 harness 都能跑。
- **加速器**：pi 扩展，在 `before_agent_start` 把 `brief` 按轮注入。它只负责“到达”，
  **删掉它回路仍然完整**；失效时必须自报 `state="unavailable"`，不得静默消失。

**不做**：cron、常驻守护进程、外部推送通道、任何**承载正确性**的 harness 专属物。
只在一个运行时里能用、且删掉就做不成事的东西，会把“这套流程能不能用”重新绑回那里，
而**失效时不会有任何报错**（ADR-0034 §二，按 ADR-0040 收窄）。

## 日志体系

日志只有一个出口（`lib/_log.ts`），stdout 只归数据。这条契约的破坏方式是**静默的**：一行 `console.log` 会让下游 `JSON.parse` 崩在一个离案发现场很远的地方。

| 出口               | 位置          | 通道       | 放什么                                                                                                   |
| ------------------ | ------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `emitJson()`       | `cli/args.ts` | **stdout** | CLI 的**数据**。唯一合法写入者，由 `installStdoutGuard()` 守卫——非 `emitJson` 的 stdout 写入**当场抛错** |
| `log()` / `warn()` | `lib/_log.ts` | **stderr** | 其它一切：诊断、警告、CLI 的用户可见输出、Prisma 事件、`--help` 文本                                     |

- **项目代码不要直接调用 `console.*`**，用 `lib/_log.ts` 的 `log` / `warn`。ESLint 的 `no-console` 就是这条契约的执行者（`.eslintrc.json`；`lib/_log.ts` 自身与测试文件豁免）。`npm run lint` 的范围已含 `cli/` 与 `e2e/`（`package.json`），所以 CLI 里误用 `console.log` 会被 CI 拦住。
- **`log` 用 `console.error`、`warn` 用 `console.warn`，这是刻意的**：Node 里**只有这两个方法写 stderr**，`console.log` / `console.info` 写的是 stdout。浏览器里它们仍是普通 console 方法，行为不变。
- **需要上下文时把来源写进消息本身**（例如 `prisma:info …`），不靠前缀约定。早先 CLI 有一套自己的 `log` 实现与 `[agent]` 前缀，已删除——**两套实现比少一个前缀糟得多**。`lib/prisma.ts` 的 event 订阅、`--help` 文本、CLI 的用户可见输出现在都经同一个出口。
- **新增任何会写输出的库之前，先确认它的输出去哪儿。** Prisma 默认把 `info` 写到 stdout（足以让下游 `JSON.parse` 崩掉），现由 `lib/prisma.ts` 的 event 模式接住并统一改道。
- **验证（两条，缺一不可）**：
  - `npm run --silent agent -- list-due | jq .` —— stdout 必须**可解析**。不加 `--silent` 时 npm 会把自己的横幅写进 stdout，同样破坏契约。
  - `npm run --silent agent -- --help >/dev/null` —— `--help` 必须走 stderr（stdout 字节数为 0）。

## 本地身份的两种用法（正式 vs 验证账号）

**先选身份，再动手**：两种身份的可用范围不同（见下表）。

|          | 正式身份（推荐）                                                                               | 验证账号                                                                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 怎么来   | 网页用**带点域名的邮箱**登录 → `/api-setup` 复制 key → 写进 `.env` 的 `FATEBOOK_AGENT_API_KEY` | `npm run --silent agent -- init --label <名> --allow-create-user`（建出 `<名>@localhost`）                                                                                                               |
| 能上网页 | ✅ 一个身份两条渠道（agent 写的，网页看得见、可背书）                                          | ✅ 可，走**配对码**：`FATEBOOK_ENABLE_PAIRING_LOGIN=1` 后 `issue-pairing-code` → 本机打开 `/pair` 填码（ADR-0035）。❌ 邮件门仍然进不去：域名不带点的地址在 NextAuth 发信前就被拒（`error=EmailSignin`） |
| 适合     | 走完整回路、UAT、任何"人要看到数据"的场景                                                      | 纯 CLI 检查、脚本、迁移验证、e2e                                                                                                                                                                         |

**规则（按踩坑顺序）**

1. **把网页账号的 key 交给 agent**（Web → CLI 是常态）。不要用 `init` 建的 `<label>@localhost` 去走**邮件门**（发信前就被拒）；它要进网页就走配对码（默认关闭，见上表）。
2. **换身份后重跑 `./startup.sh`**。领域词表**按用户**存（`@@unique([nameNormalized, userId])`）；不重跑时 `create-decision --tags 投资/宏观` 会报“未知领域”。
3. **本地 magic link 只会到 Mailpit**（<http://localhost:8025>），不进真邮箱。只要域名带点，填一个你并不拥有的地址也能登录。
4. **想造"两面都能用"的本地身份**：用带点的地址（`FATEBOOK_AGENT_USER_EMAIL=you@fatebook.local`）最省事；已经建好的 `<label>@localhost` 也可以是两面的——用配对码进网页，不必重建。
5. **签发配对码要求真凭据**（ADR-0035）：`issue-pairing-code` 在 `FATEBOOK_AGENT_USER_EMAIL` 那条路径上**会被拒**——那是**身份选择器**（不含秘密，谁设了都能以该身份跑命令），过程层是 `credentialProcedure`，只认 `ctx.authentication === "credential"`。要签发就把 key 放进环境变量或 `FATEBOOK_AGENT_API_KEY_FILE`；`whoami` 会告诉你当前是哪一档。
6. **身份作用域是进程，不是目录**（ADR-0036）：优先级 `--api-key` > `FATEBOOK_AGENT_API_KEY` > `FATEBOOK_AGENT_API_KEY_FILE`（文件里只放一把钥匙，从头到尾不留 shell 历史）> `FATEBOOK_AGENT_USER_EMAIL`。所在副本的 `.env` 只是**默认来源**：同一个目录里跑两个进程、各自带一把钥匙，就是两个身份；同一把钥匙被两个进程用，则两边是同一个身份（允许）。**一个进程内不换身份。**
7. **判据（排查登录问题时用，别靠猜）**：
   - 打一次登录接口看是哪种结局：`curl -s -c /tmp/cj http://localhost:3000/api/auth/csrf` 取 token，再 `POST /api/auth/signin/email`（带 `csrfToken` / `email` / `callbackUrl`）——落在 `verify-request` 是**发信成功**，落在 `error=EmailSignin` 是**地址被拒**。
   - 想知道是"邮件层"还是"应用层"：直接对 Mailpit（`smtp://localhost:1025`）试投同一个地址。**Mailpit 收得下而应用报错 ⇒ 问题在地址校验，不在邮件服务。**
