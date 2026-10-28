# CLI 的身份与来源接口：按凭据解析身份，来源用正向声明

> **此处已变：** 「身份来源优先级」一条里的 `FATEBOOK_AGENT_API_KEY` / `FATEBOOK_AGENT_USER_EMAIL` 已由 [ADR-0042](./0042-brand-rename-and-identifiers.md) 改为 `ASSAY_AGENT_API_KEY` / `ASSAY_AGENT_USER_EMAIL`（阶梯与顺序不变，正文保留原样）。

CLI 的每条命令都**自带身份与来源**，不引入会话级状态：

- **身份来源优先级**：`--api-key`（单条覆盖，仅用于测试与自动化）> `FATEBOOK_AGENT_API_KEY`（项目级，与 [ADR-0021](./0021-cli-identity-by-credential.md) 的"仓库副本"作用域一致）> `FATEBOOK_AGENT_USER_EMAIL`（遗留回退）。
- 新增 **`whoami`**（打印身份与凭据来源，供 Agent 自检与排查）与 **`init`**（[ADR-0022](./0022-credential-provisioning.md)）。
- **不在磁盘上记"当前身份"**：与 [ADR-0015](./0015-local-cli-as-agent-interface.md) 的"确定性、无隐藏状态"一致。同一个 pi 会话里替不同 Owner 记录时，显式传凭据即可。
- **来源用正向声明**：`--agent-collected` 改为 `--stated-by-owner`，默认落在"待背书"一侧（[ADR-0024](./0024-provenance-default-by-context.md)）。`AI_AGENT` 标记仍自动检测，只决定默认方向与审计。

## Considered Options

- **只认环境变量**（每副本一把钥匙）：简单，但无法在同一个会话里替两个 Owner 记录。
- **引入会话级"当前身份"状态**：与"无隐藏状态"冲突，而且 Agent 极易忘记切换，把 B 的记录写进 A 名下——那是一类很难事后发现的错。
- **把凭据作为常规命令行参数**：会进 shell history 与 `ps`。

## Consequences

- 改动落在 `cli/context.ts`（身份解析，复用既有的 `getUserByApiKeyOrThrow`）与 `cli/commands.ts`（两条新命令、一个 flag 改名）；**procedure 与 Web 不用动**——CLI 本来就自造 ctx。
- skill 需同步：来源声明由反向变正向；代理代当事人记录时要么显式声明来源，要么让当事人事后背书。
- `whoami` 成为可观测点：Agent 可以自检"我以谁的身份、凭哪份凭据在做事"。
