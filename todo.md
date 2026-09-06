# Todo List

## Task: 将 myfatebook fork 改造为 nano-fatebook-agent（个人私有化决策评估 agent）

### Phase 1: 同步上游 fork 源

- [x] 添加 upstream remote（Sage-Future/fatebook）
- [x] git merge upstream/main（9 个 commit）
- [x] 解决 README.md 冲突（保留本地中文链接 + 上游 Docker 文档）
- [x] 解决 package-lock.json 冲突（取上游，后续改名时重新生成 name）
- [x] 验证：npm install + tsc --noEmit + npm test 通过（补 ts-node devDep）

> build 仅缺 DATABASE_URL 环境（本地未配数据库），非代码错误

### Phase 2: 全量品牌重命名

- [ ] package.json：name + repository
- [ ] 全局代码文案 fatebook/Fatebook/fatebook.io → nano-fatebook-agent
- [ ] README.md / README.zh-CN.md 重写
- [ ] 验证：build 通过，无残留旧品牌文案

### Phase 3: 私有化裁剪

- [x] 移除 Slack 集成（lib/blocks-designs、interactive_handlers、slash_handlers、相关 API）
- [x] 移除 Discord 集成（lib/discord、相关 API/页面）
- [x] 移除 Chrome 扩展（chrome-extension/、@types/chrome）
- [x] 移除公开分享/社区/团队（embed、tournament、userList、public、SharePopover 前端）
- [x] 单用户本地认证（移除 Google OAuth，保留 Email magic link）
- [x] 移除 Vercel/部署依赖（依赖清理，tsconfig types 修复）
- [x] 核心逻辑提取：新建 lib/web/resolution.ts（去 Slack 的 resolve/score/undo/delete）
- [x] 验证：tsc --noEmit = 0 错误 + npm test 8/8 通过

> 剩余（可选深度裁剪）：schema.prisma 的 Tournament/UserList/Workspace/SlackMessage 等 model 删除（涉及数据库迁移）

### Phase 4: agent 化改造（决策评估）

- [ ] 概率校准：预测记录 + 置信度 + 到期结算 + 校准曲线
- [ ] 决策日志：重大决策记录（依据/假设/预期）+ 事后复盘
- [ ] LLM 交互层：自然语言抽取预测/决策
- [ ] 验证：TDD 测试 + 端到端可用

---

## Git Commit Message Suggestions

// 完成各 Phase 后追加
