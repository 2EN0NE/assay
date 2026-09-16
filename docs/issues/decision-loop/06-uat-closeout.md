# 06 — 端到端 UAT 走查与验收文档

**What to build:** 一份可以照着走的验收文档，覆盖"捕获 → 跟踪 → 复盘 → 领域读数"四段，每段写明说什么、跑什么、看到什么；并在独立数据库上真跑一遍，把**实际观察结果**写进文档。

**Blocked by:** 03、04、05

**Status:** implemented（2026-09-16 在独立库 `fatebook_uat` 上按文档走了一遍，实际输出已贴进文档）

### 走查方式与证据

- 建库 → **两个** `DATABASE_*` 变量都指向 UAT 库 → `prisma migrate deploy`（92 个迁移、32 张表）。
- `init` 建一个走查身份，`scripts/seed-uat-samples.ts` 灌入合成样本：
  40 / 24 / 20 / 3 条已结算 + 4 条悬空（与单元测试同一份 fixture）。
- 四段读数在真库上的输出与 `domain_stats.test.ts` 的断言**逐位一致**（0.64 / −0.64 / 恰好 0 / 样本不足）。
- 回路另外跑了：未知领域失败 → `add-domain` → 建决策 → 挂接 → `list-due`（悬空 4 条带成因）→
  `settle --source ⇒ settled` → 无来源 ⇒ `proposed` → `decide-proposal --accept ⇒ ACCEPTED`。
- 初始词表路径：四个词逐个 `add-domain`（幂等，第二次走“已有”分支）。

### 走查中发现的非显见陷阱（已写进文档 §0 与故障表）

**只改 `DATABASE_URL` 不够**：`prisma/schema.prisma` 里还有 `directUrl = env("DATABASE_DIRECT_URL")`，
而**迁移走 directUrl**。只改前者时 `prisma migrate deploy` 会把“无待应用迁移”报得干干净净，
而你其实一直在操作开发库（实测：`Datasource "db": … "fatebook_development"` 且无任何报错）。

### 与 ADR 的关系

ADR-0032 §四 的读法已由业主裁定为 **R1**（“曲线”=图形呈现，“桶”=数字表，二者本就不同；n≥5 给桶、n≥20 给技能分），并已给 ADR 追加一句澄清。
ADR 是**只追加**的（AGENTS.md），所以我没有改动它的文字——是否补一句澄清交给你定。

- [x] `docs/uat-pi-agent.md` 更新为最终版：四段各自的操作、期望观测点、以及已知缺口（今天的 N<20 会显示什么）
- [x] 在独立库 `fatebook_uat` 上按文档走一遍（含合成样本），把实际输出贴进文档，而不是写"应当如此"
- [x] 文档里每一条观测点都能在仓库里被验证（一条命令或一个页面路径），不出现无法验证的声明
- [x] 结论段落明确区分"机制成立"与"统计是否成立"——样本不足时不得暗示结论
      — 文档 §5 两节分开：机制已验，真实数据上的结论未验（开发库目前远低于阈值 ⇒ 只给 n 与 pending）
- [x] `startup.sh` 在独立库上的路径被验证（`DATABASE_URL` 覆盖 + 初始词表已建），并在文档里给出该命令
      — 已验；并补上了“必须同时改 `DATABASE_DIRECT_URL`”这一条（否则迁移静默落到开发库）
- [x] 走查中发现的与 ADR 冲突之处，回到 ADR 修正或开新票据，不留悬空
      — ADR-0032 §四 的读法：业主裁定为 R1（桶 ≠ 曲线），并已给 ADR 追加同义澄清句（见下）
