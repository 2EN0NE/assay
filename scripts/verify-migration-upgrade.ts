/* eslint-disable no-console -- 本脚本的对外契约是往 stdout 打一段人可读的验证过程与
   PASS/FAIL，换成仓库的 logger 会往同一路流里掺时间戳/前缀，反而把输出弄坏。 */
/**
 * 迁移升级路径验证（ADR-0030 §十二 / ADR-0031 §三）。
 *
 * ## 为什么需要它
 *
 * `CI` 里已有的 `prisma migrate deploy` 跑在**空库**上，只证明"迁移能被应用"，不证明
 * "**已有数据**的库升级后数据是对的"。而本次三条迁移各自带一条回填或一条约束收紧，
 * 它们的失败方向都是**静默改写历史**：
 *
 * - `20260914200000_settlement_confirmed_by`：`UPDATE … SET "confirmedByUserId" = "userId"
 *   WHERE resolved`。写错口径 ⇒ 历史结算的确认者错位 ⇒ 用户的校准里**静默**少一批或
 *   多一批样本（迁移注释自己写了这个后果）。
 * - `20260914180000_decision_domain_tags`：`name` → `nameNormalized` 的唯一键收窄。
 *   若库里已有把大小写当两个标签的行（`CPI` 与 `cpi`），创建唯一索引会失败——那是
 *   **想要的行为**（需要人来决定合并哪一个），本脚本把"它会失败"钉住。
 *
 * ## 做法
 *
 * 取 `prisma/migrations/` 里除本次三条以外的全部迁移（= 升级前的 schema），应用到一个
 * **独立库**上，插入符合旧 schema 的数据，再对同一个库跑完整的 `migrate deploy`，最后
 * 断言回填结果。第二个场景专门造大小写冲突，断言迁移**大声失败**。
 *
 * 边界：本脚本覆盖的是这三条迁移升级路径。将来新增迁移应自带同类验证——这里不自动
 * 跟随（自动跟随会让"旧库"的定义随 HEAD 漂移，验证就不再是确定的）。
 *
 * 新增迁移时的做法（AGENTS.md「改动数据库里已有的数据之前」有白话版）：
 * 要**回填老数据**或**收紧约束**的，把迁移名加进下面的 `UPGRADE_MIGRATIONS`，
 * 并在同一脚本里补上对应的断言；只加表 / 加允许为空的新列 / 只加索引的，不用管。
 *
 * 用法：`npx tsx scripts/verify-migration-upgrade.ts [--keep]`
 * 需要本地 `docker compose` 起的 Postgres（CI 的 e2e job 里本来就有）。
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

// 本包是 ESM（package.json 的 "type": "module"），所以没有 __dirname。
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const MIGRATIONS_DIR = path.join(REPO_ROOT, "prisma", "migrations")
const VERIFY_DB = "fatebook_migration_verify"
const VERIFY_URL = `postgresql://fatebook:postgres@localhost:5432/${VERIFY_DB}`

/** 本次要验证的三条（升级前 = 目录里排除它们之后的全部）。 */
const UPGRADE_MIGRATIONS = [
  "20260914120000_audit_metadata",
  "20260914180000_decision_domain_tags",
  "20260914200000_settlement_confirmed_by",
]

const keepFlag = process.argv.includes("--keep")

function sql(query: string): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "fatebook",
      "-d",
      VERIFY_DB,
      "-tAc",
      query,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim()
}

function psqlAsAdmin(query: string): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "fatebook",
      "-d",
      "postgres",
      "-tAc",
      query,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim()
}

function migrateDeploy(schemaPath: string): string {
  return execFileSync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", schemaPath],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: VERIFY_URL,
        // schema 里 `directUrl` 走的是这个变量；迁移用的是 directUrl。
        // 只设 DATABASE_URL 会让它静默作用到别的库上（踩过）。
        DATABASE_DIRECT_URL: VERIFY_URL,
      },
    },
  )
}

let failures = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? "  ✅" : "  ❌"} ${label}`)
  if (!ok) {
    console.log(`       期望: ${String(expected)}`)
    console.log(`       实际: ${String(actual)}`)
  }
}

function resetDatabase(): void {
  psqlAsAdmin(`DROP DATABASE IF EXISTS ${VERIFY_DB}`)
  psqlAsAdmin(`CREATE DATABASE ${VERIFY_DB}`)
}

/**
 * 把"升级前"的迁移复制成一个独立的 schema 目录：`migrate deploy --schema <dir>/schema.prisma`
 * 只认识 `<dir>/migrations/`，所以这样就能把库停在指定的历史时点。
 */
function buildPreUpgradeSchemaDir(tmpRoot: string): string {
  for (const name of UPGRADE_MIGRATIONS) {
    if (!fs.existsSync(path.join(MIGRATIONS_DIR, name))) {
      throw new Error(
        `找不到要验证的迁移 ${name}：它的名字变了而本脚本没跟着改，验证会静默失效。`,
      )
    }
  }

  const dir = path.join(tmpRoot, "pre-upgrade")
  fs.mkdirSync(path.join(dir, "migrations"), { recursive: true })
  fs.copyFileSync(
    path.join(REPO_ROOT, "prisma", "schema.prisma"),
    path.join(dir, "schema.prisma"),
  )
  fs.cpSync(MIGRATIONS_DIR, path.join(dir, "migrations"), {
    recursive: true,
    filter: (source) =>
      !UPGRADE_MIGRATIONS.some((name) =>
        source.startsWith(path.join(MIGRATIONS_DIR, name)),
      ),
  })
  return dir
}

/** 旧 schema 上的一条已结算二元题 + 一个**他人**的预测。 */
const OLD_DATA_SQL = `
INSERT INTO "User" (id, email) VALUES
  ('mig-u1', 'mig-u1@example.com'),
  ('mig-u2', 'mig-u2@example.com');
INSERT INTO "Tag" (id, name, "userId") VALUES
  ('mig-t1', 'CPI', 'mig-u1'),
  ('mig-t2', '投资/宏观', 'mig-u1');
INSERT INTO "Question" (id, title, "resolveBy", "userId", resolved, resolution, "resolvedAt", "resolutionSource") VALUES
  ('mig-q1', '旧库里的已结算题', '2025-01-01T00:00:00Z', 'mig-u1', true, 'YES'::"Resolution", '2025-02-01T00:00:00Z', NULL);
INSERT INTO "Forecast" (forecast, "questionId", "userId") VALUES
  (0.6, 'mig-q1', 'mig-u2');
`.trim()

function scenarioUpgradeWithData(preUpgradeDir: string): void {
  console.log("\n[场景 1] 有数据的旧库升级到本次三条迁移")
  resetDatabase()
  migrateDeploy(path.join(preUpgradeDir, "schema.prisma"))
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "fatebook",
      "-d",
      VERIFY_DB,
      "-c",
      OLD_DATA_SQL,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  )

  // 升级前：旧库确实没有新列（否则这个场景什么都没验证）
  check(
    "升级前 nameNormalized 不存在",
    sql(
      `SELECT count(*) FROM information_schema.columns WHERE table_name='Tag' AND column_name='nameNormalized'`,
    ),
    "0",
  )
  check(
    "升级前 confirmedByUserId 不存在",
    sql(
      `SELECT count(*) FROM information_schema.columns WHERE table_name='Question' AND column_name='confirmedByUserId'`,
    ),
    "0",
  )

  migrateDeploy(path.join(REPO_ROOT, "prisma", "schema.prisma"))

  // §十二：判重折叠大小写，显示保留原样
  check(
    "回填 nameNormalized = lower(name)（CPI → cpi）",
    sql(`SELECT "nameNormalized" FROM "Tag" WHERE id='mig-t1'`),
    "cpi",
  )
  check(
    "显示名保留原样（CPI）",
    sql(`SELECT name FROM "Tag" WHERE id='mig-t1'`),
    "CPI",
  )
  check(
    "非 ASCII 标签同样被回填（投资/宏观）",
    sql(`SELECT "nameNormalized" FROM "Tag" WHERE id='mig-t2'`),
    "投资/宏观",
  )
  check(
    "唯一键换成 (nameNormalized, userId)",
    sql(
      `SELECT indexname FROM pg_indexes WHERE tablename='Tag' AND indexname='Tag_nameNormalized_userId_key'`,
    ),
    "Tag_nameNormalized_userId_key",
  )

  // §三：历史结算的确认者 = 当时的作者（那时只有作者能结算，这是事实而非猜测）
  check(
    "回填 confirmedByUserId = 作者",
    sql(`SELECT "confirmedByUserId" FROM "Question" WHERE id='mig-q1'`),
    "mig-u1",
  )
  // §六：无来源 + 他人确认 ⇒ 他人（mig-u2）的预测悬空；作者自己的仍计入。
  // 这一条正是"回填不是可选项"的理由：留空会让作者本人的样本一起变悬空。
  check(
    "他人预测的悬空判据成立（无来源 + 确认者≠押注者）",
    sql(`SELECT (q."resolutionSource" IS NULL AND q."confirmedByUserId" IS NOT NULL AND q."confirmedByUserId" <> f."userId")
         FROM "Question" q JOIN "Forecast" f ON f."questionId" = q.id
         WHERE q.id='mig-q1' AND f."userId"='mig-u2'`),
    "t",
  )

  // 审计线索的两列也随迁移出现，且默认值不把历史数据标成 agent 发起
  check(
    "审计列存在且历史行默认 HUMAN",
    sql(
      `SELECT initiator FROM "Forecast" WHERE "questionId"='mig-q1' AND "userId"='mig-u2'`,
    ),
    "HUMAN",
  )
}

function scenarioCaseCollision(preUpgradeDir: string): void {
  console.log("\n[场景 2] 同一用户名下 CPI 与 cpi 并存 ⇒ 迁移必须大声失败")
  resetDatabase()
  migrateDeploy(path.join(preUpgradeDir, "schema.prisma"))
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "fatebook",
      "-d",
      VERIFY_DB,
      "-c",
      `INSERT INTO "User" (id, email) VALUES ('mig-u1', 'mig-u1@example.com');
       INSERT INTO "Tag" (id, name, "userId") VALUES
         ('mig-c1', 'CPI', 'mig-u1'),
         ('mig-c2', 'cpi', 'mig-u1');`,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  )

  let failedLoudly = false
  let message = ""
  try {
    migrateDeploy(path.join(REPO_ROOT, "prisma", "schema.prisma"))
  } catch (error) {
    failedLoudly = true
    message = String((error as { stderr?: string }).stderr ?? error)
  }

  check("迁移失败（而不是悄悄合并或悄悄丢数据）", failedLoudly, true)
  check(
    "失败信息指向唯一索引（人知道该去合并哪一个）",
    message.includes("Tag_nameNormalized_userId_key"),
    true,
  )
}

function main(): void {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`找不到迁移目录：${MIGRATIONS_DIR}`)
  }
  const tmpRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "fatebook-migration-verify-"),
  )
  try {
    const preUpgradeDir = buildPreUpgradeSchemaDir(tmpRoot)
    console.log(`升级前 schema 目录：${preUpgradeDir}`)
    scenarioUpgradeWithData(preUpgradeDir)
    scenarioCaseCollision(preUpgradeDir)
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    if (!keepFlag) {
      psqlAsAdmin(`DROP DATABASE IF EXISTS ${VERIFY_DB}`)
    } else {
      console.log(`\n（--keep）验证库保留在 ${VERIFY_DB}，供人工检查`)
    }
  }

  if (failures > 0) {
    console.log(`\n❌ 迁移升级路径验证失败：${failures} 条断言不成立`)
    process.exit(1)
  }
  console.log("\n✅ 迁移升级路径验证通过（回填正确 + 大小写冲突大声失败）")
}

main()
