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

| Layer                    | Command             | Requires                                                               |
| ------------------------ | ------------------- | ---------------------------------------------------------------------- |
| Types                    | `npm run typecheck` | —                                                                      |
| Lint                     | `npm run lint`      | —                                                                      |
| Unit / component         | `npm test`          | —                                                                      |
| End-to-end (agent → web) | `npm run test:e2e`  | `docker compose up -d db mail`, then `npx playwright install chromium` |

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

- Jest unit tests covering scoring, calibration-sample filtering, resolution,
  revision planning, LLM parsing, CLI argument parsing, and form behavior.
- Playwright end-to-end tests: the human sign-in → create → resolve journey, and
  the agent CLI → web endorse / proposal-confirm journey.
- CI runs lint + typecheck + unit tests + e2e on every pull request.

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

## Quick start (Docker)

```shell
cp .env.example .env
docker compose up
```

The app is available at <http://localhost:3000>. The database is created and
migrations run automatically on startup.

**Signing in:** use the email magic-link option. Docker Compose includes
[Mailpit](https://mailpit.axllent.org/) as a local mail catcher — open
<http://localhost:8025> to read the sign-in email. No SMTP account needed.

## Development

```shell
npm install
npx prisma generate --no-hints
npm run dev          # dev server (port 3005, SSL proxy → 3000)
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
