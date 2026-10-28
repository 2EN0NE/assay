# 身份作用域取进程：副本是默认来源，显式覆盖优先

> **此处已变：** 正文里的 `FATEBOOK_AGENT_API_KEY_FILE` / `FATEBOOK_AGENT_API_KEY` 已由 [ADR-0042](./0042-brand-rename-and-identifiers.md) 改为 `ASSAY_AGENT_API_KEY_FILE` / `ASSAY_AGENT_API_KEY`；决策内容不变，正文保留原样。

本 ADR **收窄** [ADR-0021](./0021-cli-identity-by-credential.md) 关于作用域的规定。原句：「作用域取**仓库副本**——不同的 checkout 可以是不同的身份，**同一副本内的所有子目录是同一个身份**。」在本 ADR 下，副本降为**默认来源**，进程可显式覆盖——即「同一副本内的多个进程可以是多个身份」。其余不变。

触发场景：**一台机器上跑多个 pi 进程，各自代表不同的 Owner**（一份代码、多个账户）。这在内网部署（一台主机服务一个用户组）里是常态，不是边界情况。

## Considered Options

- **保持副本作用域**（N 个账户 = N 份 worktree / clone，各带一份 `.env`）：零代码改动，隔离彻底，且 ADR-0021 原文即如此。否决理由：「一份代码、多个进程」是被禁止的自然用法；更糟的是它把身份藏进**看不见的** `.env`——同一个目录里「我以为我是 alice，其实是 bob」正是这么发生的。
- **只认进程**（去掉副本默认）：概念更纯，但破坏现有开箱流程（`startup.sh` 写 `.env`、`npm run agent` 直接可用），等于要求每条命令都显式带凭据。

> **重开了一处被否决的替代方案——必须写明。** [ADR-0021](./0021-cli-identity-by-credential.md) 的替代方案里否决过「**用户级凭据文件**（放在家目录）」，原句：「绕开了仓库，但把身份从『我正在哪个副本里做事』里剥出来，与 pi 自身的项目级配置习惯不一致」。本 ADR 的 `FATEBOOK_AGENT_API_KEY_FILE` 与它**同形**，所以那一处否决在此被重新打开。区别在于：路径由调用方**显式指定**（不是家目录里的固定位置），且它只是「显式覆盖」这一档的实现方式——身份仍然由命令行/服务单元写在那里，不会变成"读一个全机器共享的默认身份"。

## 决定

- **优先级**：显式覆盖（进程环境变量 / 凭据文件）> 所在副本的 `.env`。
- **凭据文件入口**（`FATEBOOK_AGENT_API_KEY_FILE=<path>`）：因为秘密不应出现在命令行——`ps` 可见、shell 历史留痕。文档推荐文件方式；inline 环境变量仍然可用。

## Consequences

- **零代码改动即可用的那半条已经成立**（实测）：`npm run agent` 走 `dotenv -e .env`，而 dotenv **不覆盖**已存在的进程环境变量 ⇒ `FATEBOOK_AGENT_API_KEY=… npm run --silent agent -- …` 今天就能指定身份。本 ADR 把这一既有事实**追认**为规定，而不是新增机制。
- `CONTEXT.md` 的 **Identity Scope / 身份作用域** 已同步改写为「进程（默认来自所在仓库副本）」。
- [ADR-0025](./0025-multi-owner-is-a-target-scenario.md) 的多 Owner 语义不受影响：本 ADR 只改「一个身份从哪儿读出来」，不改「一条 Prediction 下多个 Owner 各自押注」。
- 两个进程共用同一把凭据 ⇒ 同一个身份。这是允许的，不是冲突。
- 本 ADR 不允许「同一进程内切换身份」：身份在一次进程生命周期内固定。
