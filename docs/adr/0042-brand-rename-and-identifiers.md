# 改名 试金石 / Assay：标识符随品牌一起改，旧名字不再读取

本项目从 fork 名 `nano-fatebook-agent` 改名为 **试金石 / Assay**。改名通常被当成文案整理，但它在这里同时改到了**契约**：agent 用环境变量证明"我是谁"，CI 用库名连库，宿主页用查询参数与消息字段认这具 iframe。品牌与契约若各留一套，失效时**没有任何报错**——旧名字只是不再被读，症状会表现为"身份没配好"、"库不存在"，把排查引到错误的地方。

**本篇取代以下六篇里关于「标识符命名」的句子**（决策内容一律不变，旧篇正文按"只追加"原则保留原样，只在篇首加一行指针）：

- [ADR-0021](./0021-cli-identity-by-credential.md) 的「邮件地址作为身份键（即现状的 `FATEBOOK_AGENT_USER_EMAIL`）」与 Consequences 第一条里的 `FATEBOOK_AGENT_USER_EMAIL` → `ASSAY_AGENT_USER_EMAIL`。
- [ADR-0023](./0023-interaction-surface-parity.md) 例外清单里「配对码**签发**」那一行括号内的 `FATEBOOK_AGENT_USER_EMAIL` → `ASSAY_AGENT_USER_EMAIL`。
- [ADR-0026](./0026-cli-identity-and-provenance-interface.md) 「身份来源优先级」一条里的 `FATEBOOK_AGENT_API_KEY` / `FATEBOOK_AGENT_USER_EMAIL` → `ASSAY_AGENT_API_KEY` / `ASSAY_AGENT_USER_EMAIL`。
- [ADR-0035](./0035-pairing-code-as-second-door.md) 「实现注记」的开关与签发两条里的 `FATEBOOK_ENABLE_PAIRING_LOGIN` / `FATEBOOK_AGENT_USER_EMAIL` → `ASSAY_ENABLE_PAIRING_LOGIN` / `ASSAY_AGENT_USER_EMAIL`。
- [ADR-0036](./0036-identity-scope-is-the-process.md) 的「重开了一处被否决的替代方案」注、决定里的「凭据文件入口」与 Consequences 第一条里的 `FATEBOOK_AGENT_API_KEY_FILE` / `FATEBOOK_AGENT_API_KEY` → `ASSAY_AGENT_API_KEY_FILE` / `ASSAY_AGENT_API_KEY`。
- [ADR-0040](./0040-per-turn-injection-and-accelerator-boundary.md) 第三点示例里的注入标签 `<fatebook-status>` → `<assay-status>`（开、闭标签同改；注入位置、三态自报与四条硬规则不变）。

（引用按**那一句**定位，不按行号：本篇之外任何人加一行，行号就会失真——这正是本仓库反复踩的那类"指针过期"。）

## Considered Options

- **保留旧名别名（同时读两套）**：升级无痛。否决理由：ADR-0036 的「空串是显式压制」依赖"这个变量**给没给**"这一单值判断，两套名字使它变成多值，且无法判断用户想要哪个；更根本的是两套定义必然漂移，而漂移的表现是"其中一个被静默忽略"。
- **只改 UI 文案与文档，标识符不动**：改动最小。否决理由：界面说 Assay、变量叫 FATEBOOK，正是本篇要防的分裂；而且门禁无法表达"这个词出现是对的、那个出现是错的"。
- **连外部标识符一起改**（Postmark 模板别名、导入 ID 前缀）：看起来彻底。否决理由：模板别名改了邮件发不出去（在别人的服务上，不在本仓库里）；`pb_` / `cs_` 前缀改了，重复导入同一份数据会造出**新题**而不是命中原题。

## 决定

**一、旧名字不做别名。** 不读 `FATEBOOK_AGENT_*`、不读 `FATEBOOK_ENABLE_PAIRING_LOGIN`。代价由升级步骤显式承担（见末节），而不是由代码长期背着一个看不见的第二套定义。

**二、要改的标识符，一次列全**（便于核对，也便于门禁引用）：

| 位置                            | 新值                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| npm 包名 / repository           | `assay`                                                                                              |
| 身份（ADR-0026 的阶梯）         | `ASSAY_AGENT_API_KEY` > `ASSAY_AGENT_API_KEY_FILE` > `ASSAY_AGENT_USER_EMAIL`                        |
| 配对码开关（ADR-0035）          | `ASSAY_ENABLE_PAIRING_LOGIN`                                                                         |
| 本地库（`docker-compose`）      | 角色 `assay`、库 `assay_development`                                                                 |
| 跨 iframe（`lib/web/embed.ts`） | 查询参数 `assay-embed-id`、消息字段 `isAssay`                                                        |
| 注入标签（ADR-0040 第三点）     | `<assay-status>`（开、闭标签同改）                                                                   |
| 邮件列表（外部服务）            | `products: ["试金石"]`、`tags: ["assay-user"]`——**外部标识**，改名后须在远端服务登记同名 product/tag |

**三、不属于品牌的标识符不得改。** Postmark 模板别名 `fatebook-new-activity`（在 Postmark 账户里）、上游仓库与页面链接、导入 ID 前缀 `pb_` / `cs_`。它们看起来像旧名字，但改的是别人那侧的键。

**四、门禁只有一处：`lib/branding.test.ts`。** 它扫描"当前身份文件"：目录 `cli/` / `lib/` / `pages/` / `components/` / `e2e/` / `skills/` / `knowledge/`，外加一份**显式的根文件清单**（`ROOT_FILES`：`package.json`、`.env.example`、`docker-compose.yml`、`startup.sh`、CI 工作流、`README.md`、`CONTEXT.md`、`AGENTS.md`、`docs/uat-pi-agent.md`、`docs/roadmap.md`）。清单是白名单，因此**新增会写品牌名的根级配置文件时，要把它加进 `ROOT_FILES`**——否则门禁看不见它。历史记录（`docs/adr/`、`docs/issues/`、`progress.txt`）不在扫描范围；外部标识符走白名单，且白名单条目须写明"为什么它必须保留旧名"。另有两条结构性断言：改名涉及的旧篇必须仍指向本篇（ADR 只追加的落地），以及 `cli/context.ts` 真的在读新变量名（"看着改了、其实没读"是这类改名的典型结局）。

**五、术语随 [CONTEXT.md](../../CONTEXT.md) 改**（`Compliance Number` → 随口给的数字 等）：术语表的改动**不改** ADR-0010 / 0011 / 0016 / 0024 的决策内容，那些篇里的旧词与术语表现行词指同一概念。

## 代价与升级步骤（照着做，可核对）

- `.env` 里旧的四个变量**不再被读**：CLI 会报"没有可用身份"。按新名字重写（`startup.sh` 也会写 `ASSAY_AGENT_API_KEY`）。
- **已导出 `DATABASE_URL` 的 shell**：`dotenv` 不覆盖进程变量 ⇒ 命令会连到改名前的库并报 `Database "fatebook_development" does not exist`（这个库名在仓库里已经不存在）。用 `env -u DATABASE_URL -u DATABASE_DIRECT_URL` 跑一次，或更新导出。
- **已有 `docker-compose` 数据卷不会因 `POSTGRES_USER` / `POSTGRES_DB` 改变而重建**（Postgres 只在空数据目录时读这两个变量），且 healthcheck 的 `pg_isready -U <角色>` 在角色不存在时**照样通过**。手工对齐：
  ```sql
  CREATE ROLE assay LOGIN SUPERUSER PASSWORD '…';
  ALTER DATABASE assay_development OWNER TO assay;
  ```
  或 `docker compose down -v`（**会丢掉本地库全部数据**）。
- 已嵌入的宿主页 / 旧扩展需改用 `assay-embed-id` 与 `isAssay`。**不提供兼容分支**：按 [ADR-0013](./0013-in-app-only-built-in-delivery.md)，Chrome 扩展不在本仓库交付面内，同时读两个名字会把"旧宿主还在用旧协议"这件事永久隐藏起来。
- **邮件列表的 product / tag 在远端服务里**（`lib/_utils_common.ts` 的 `products: ["试金石"]` / `tags: ["assay-user"]`）。这是本次**唯一静默失败**的一项：调用方 `mailing_list.ts` 只 warn 不抛错，因此未登记时的表现是"注册成功、却不在任何分组里"。核对方式：注册一个新地址后到远端后台看 `assay-user` 这个 tag 下有没有它——看不到就是没登记，不要按"邮件延迟"排查。

## 验证

- `npx jest lib/branding.test.ts` —— 旧标识符残留为 0、包名与标题为新名、外部白名单内的旧名不报错。
- `npm run --silent agent -- whoami` —— 打印当前身份与 `credentialSource`，可确认新变量名真的被读到（而不是"看着改了、其实没读"）。
