# nano-fatebook-agent

[English](./README.md) | [中文](./README.zh-CN.md)

An **agent-native decision-quality system**. It captures decisions from everyday
conversation, makes implicit beliefs explicit as settleable probabilistic
predictions, and tracks them over time so that **decision quality** can be told
apart from **outcome quality**.

> Forked from [Fatebook](https://fatebook.io) (prediction tracking +
> calibration). The upstream Slack / Discord / Chrome-extension / tournament /
> team integrations have been removed.

## What it is — and what it is not

- **Is**: a personal decision log with a calibration engine, driven primarily by
  an AI agent during normal conversation.
- **Is not**: a todo app, a note-taking app, or a team project-management tool
  (team decision hygiene features are on the roadmap, not in the current build).

## Current capabilities

### Prediction tracking

- `Question` (a verifiable proposition: title, type, `resolveBy`) and
  `Forecast` (a probability, with timestamp and optional comment).
- A question keeps the **full forecast time series** — you can revise a
  prediction and the history is preserved.
- Comments, tags, and per-question notes.
- Resolution to `YES` / `NO` / `AMBIGUOUS`, with undo.

### Calibration & scoring

- **Brier score** and **relative Brier score** (relative to the median of other
  forecasters on each question), plus rank.
- **Percentile** against other forecasters.
- **Calibration chart**: buckets your stated probabilities and compares them
  with the observed outcome frequency.
- Surfaced by the `TrackRecord` component on `/`, `/stats`, and `/user/[id]`.

### Access & local development

- Email magic-link sign-in (NextAuth), plus a per-user API key for programmatic
  access.
- One-command local stack via Docker Compose (PostgreSQL + Mailpit mail catcher).

### Agent integration — the CLI is the agent's interface

The agent talks to the app through a local CLI, which calls the same tRPC
procedures as the web UI via `createCaller` (ADR-0015). No Next.js server is
required — only PostgreSQL.

```bash
# owner identity comes from the environment
export FATEBOOK_AGENT_USER_EMAIL=you@example.com

npm run --silent agent -- list-due                       # due & unsettled
npm run --silent agent -- create-prediction \
  --title "offer arrives before June" \
  --resolve-by 2026-06-30 \
  --criteria "the words 'formal offer' appear in an email" \
  --probability 70%                             # omit = unquantified (legal)
npm run --silent agent -- list-unendorsed                # not yet counted toward calibration
npm run --silent agent -- endorse --question-id <id>
npm run --silent agent -- settle --question-id <id> --resolution YES --source <url>
npm run --silent agent -- list-proposals                 # settlement proposals
npm run --silent agent -- list-deliveries                # pull-based delivery queue
npm run --silent agent -- report-delivery --notification-id <id> --outcome DELIVERED --channel telegram

# decisions (ADR-0019 / ADR-0020): a Decision contains 0..n Predictions
npm run --silent agent -- create-decision \
  --statement "..." --reasoning "..."     # narrative fields are all optional
npm run --silent agent -- attach-prediction --decision-id <id> --question-id <id>
npm run --silent agent -- detach-prediction --question-id <id>   # refused once settled
npm run --silent agent -- set-rubric --decision-id <id> --done alternatives,premortem --not-done baseRate
npm run --silent agent -- update-narrative --decision-id <id> --reasoning "..." --reason "..."
npm run --silent agent -- show-decision --decision-id <id>      # narrative + rubric + each Prediction's score
```

**Contract:** stdout carries JSON only; every diagnostic goes to stderr.
`npm run --silent agent -- --help` lists all commands. `--silent` is not
optional: without it npm prefixes stdout with its own banner, which breaks the
"stdout is JSON" contract (ADR-0015). `--help` writes to stderr for the same
reason.

Agent-written records are tagged as such and start **unendorsed** — they are
visible and reviewable, but excluded from calibration until you endorse them on
the question page (ADR-0008). `parseDecision` (`lib/web/llm_parse.ts`) is
deliberately left unwired: with the CLI as the agent's interface, natural
language parsing happens on the pi side.

### How to verify

| Layer                    | Command                 | Requires                                                               |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------- |
| Types                    | `npm run typecheck`     | —                                                                      |
| Lint                     | `npm run lint`          | —                                                                      |
| Unit / component         | `npm test`              | —                                                                      |
| Unit + coverage gates    | `npm run test:coverage` | — (**this is the one CI runs**; `npm test` skips the thresholds)       |
| End-to-end (agent → web) | `npm run test:e2e`      | `docker compose up -d db mail`, then `npx playwright install chromium` |
| Production build         | `npx next build`        | a migrated database (`pages/global-stats.tsx` prerenders from it)      |

> If `npx playwright install chromium` cannot reach `cdn.playwright.dev` (common on
> corporate networks / behind a proxy), run the same suite against an already-installed
> Chromium-based browser: drop a local config under the gitignored `.scratch/` that only
> changes `channel` to `msedge`, then
> `npx playwright test --config .scratch/pw-local.config.ts`. Tests, assertions and the
> webServer are unchanged — "it doesn't run here" is the main reason e2e went unexecuted.

Where to look when something looks wrong:

- **CLI** — stdout is machine-readable JSON; every log line (including Prisma
  query logs, prefixed `prisma:`) goes to stderr.
- **Web** — a question page renders 记录状态 (provenance, oracle kind, criteria),
  an amber 尚未背书 block with an endorse button, pending settlement proposals
  with accept/reject, and the revision history.
- **Database** — inspect `Forecast.endorsed`, `Question.oracleKind`,
  `Revision`, `ResolutionProposal`, `Notification.deliveryState`.

> Heads-up: `tsc --noEmit` is the authoritative type check. The language server
> can hold a stale cache of `@prisma/client` after `prisma generate`; when the
> two disagree, trust `tsc`.

### Quality gates

- Jest unit tests covering scoring, calibration-sample filtering, resolution
  (including the endorsement-triggered rescore), the settlement-scope rule
  (ADR-0031 §六: a sourceless settlement confirmed by someone else leaves the
  other forecaster's sample dangling), domain naming/dedup and the domain
  readout, revision planning, decision rubric/version rules, credential→identity
  dispatch, LLM parsing, CLI argument parsing, and form behavior. Per-file
  `coverageThreshold` entries in `jest.config.ts` gate the logic-dense modules
  (including `domain_stats` / `domain_tags` / `settlement_scope` / `tags_router`)
  and the calibration endpoint.
- `cli/parity.test.ts` reads both interaction surfaces from source and fails when
  a procedure is reachable on only one of them without a registered reason
  (AGENTS.md §10 / ADR-0023). `lib/skills_contract.test.ts` does the same for the
  agent skills: every `agent -- <command>` in a skill must exist in the CLI, and
  every write example must declare its provenance.
- `scripts/verify-migration-upgrade.ts` upgrades a **database that already has
  data** (pre-upgrade migrations + old-schema rows, then `migrate deploy`) and
  asserts the two backfills this phase added — `Tag.nameNormalized = lower(name)`
  and `Question.confirmedByUserId = author` — plus the loud failure when the new
  case-insensitive tag key would collide. A `migrate deploy` against an empty
  database cannot catch any of that. Runs in CI's e2e job.
- Playwright end-to-end tests: the human sign-in → create → resolve journey, the
  agent CLI → web endorse / proposal-confirm journey, the decision-domain →
  prediction → domain-readout loop, and the dangling → record-source → rescore
  loop. Plus the database-level `SetNull` regression on a real Postgres.
- CI runs lint + typecheck + `test:coverage` + migration-upgrade verification +
  e2e + `next build` on every pull request, and uploads the coverage and
  Playwright reports as artifacts.

> **Required status checks:** the gate only blocks a merge if `Test / unit` and
> `Test / e2e` are configured as required status checks in the repository's
> branch protection. That setting lives in GitHub's repository settings, not in
> the checkout, so it cannot be verified from the source tree — re-confirm it
> whenever job names change in `.github/workflows/test.yml`.

## Vision: agent-native decision hygiene

The goal is to make the agent the primary _capture_ surface:

1. **Capture** — the agent notices, mid-conversation, that the user is facing a
   decision.
2. **Decompose** — it separates the decision into the parts that are actually
   _estimable_ (settleable predictions).
3. **Grill** — it asks the user for the concrete confidence numbers behind vague
   language ("I think it'll work" → "60%? 80%? by when?").
4. **Record** — predictions are persisted with explicit resolution criteria.
5. **Calibrate** — once resolved, results feed calibration and scoring.
6. **Correct** — using decision-hygiene tools (pre-mortem, kill criteria,
   Ulysses contracts, nominal groups, truth-seeking groups) to improve the
   _process_, not just the score.

**Recording and tracking are separate.** The recording agent runs inside your
conversation and only writes decisions and predictions down — with resolution
criteria, oracle type, and anchors frozen at decision time. Tracking is
delegated to a **separate agent in an independent context**, so post-hoc
reinterpretation of what you "meant" cannot leak into settlement.

### Principles

1. **Separate decision quality from outcome quality.** Good processes yield bad
   outcomes under luck; resist `Resulting`.
2. **All decisions are wagers.** Every choice commits scarce resources under
   incomplete information.
3. **Probabilistic thinking & belief calibration.** Replace certainty with a
   probability distribution, and keep it open to new evidence.
4. **Quitting is a virtue.** Persisting and quitting are two sides of one
   decision; new adverse signals make quitting an obligation.
5. **Protect your future self.** Counter present bias by letting your future
   self constrain today's choices.

See [`docs/roadmap.md`](./docs/roadmap.md) for the phased plan and the open
design decisions.

## Quick start — one command

```shell
./startup.sh          # or: npm run startup
```

It checks Docker/Node, creates `.env`, starts Postgres and Mailpit, installs dependencies, runs
migrations, **prepares an identity** (no email needed — ADR-0022), installs the agent skill into
`.agents/skills/`, then prints what to do next. Safe to re-run.

Then either:

- **Open the web UI:**

  ```shell
  npm run dev:e2e      # plain http on :3000
  ```

  Open <http://localhost:3000> and sign in with the email magic link — the mail lands in Mailpit
  at <http://localhost:8025>. No SMTP account needed.

- **Talk to the agent in pi** (run it with this repo as the working directory):

  ```shell
  pi --skill .agents/skills/decision-capture/SKILL.md
  ```

  Then just talk: _"I'm torn about whether to take this offer."_

Or run the whole app in Docker instead: `cp .env.example .env && docker compose up` (the database
is created and migrations run automatically on startup).

### Where the skills live

`skills/decision-capture/` is the **source** — visible, harness-agnostic, laid out per the
[Agent Skills specification](https://agentskills.io/specification) (one directory with a
`SKILL.md`). `startup.sh` **installs** it into `.agents/skills/`, the shared `.agents/`
convention that pi also reads as a project-level skill root (see `dist/core/trust-manager.js`
in the pi package). That install directory is generated and gitignored — edit the source, not
the copy.

> pi only loads project-level skills **after the project is trusted** (true for both `.pi/skills/`
> and `.agents/skills/`). It asks once on first start; otherwise pass `--skill` explicitly.

### Try it end to end

Six scenes, from recording a decision to reviewing it, each with what you should observe:
**[docs/uat-pi-agent.md](docs/uat-pi-agent.md)**.

## Development

```shell
npm install
npx prisma generate --no-hints
npm run dev          # https://localhost:3000, via an SSL proxy on 3005
                     #   needs localhost.pem / localhost-key.pem — this repo does not ship them
npm run dev:e2e      # plain http on :3000 — use this when you don't have those certs
npm test             # Jest unit tests
npm run test:coverage
npm run lint         # ESLint
npm run format       # Prettier
npm run studio       # Prisma Studio
```

End-to-end tests (requires Docker for Postgres + Mailpit):

```shell
docker compose up -d db mail
cp .env.example .env
npx playwright install chromium
npm run test:e2e
```

## Project documentation

| Document                               | Contents                            |
| -------------------------------------- | ----------------------------------- |
| [`CONTEXT.md`](./CONTEXT.md)           | Ubiquitous language / glossary      |
| [`docs/roadmap.md`](./docs/roadmap.md) | Phased plan + open decisions        |
| [`docs/adr/`](./docs/adr/)             | Architecture decision records       |
| [`knowledge/`](./knowledge/)           | Engineering notes (partly pre-fork) |
| [`AGENTS.md`](./AGENTS.md)             | Working conventions for AI agents   |

## License

MIT
