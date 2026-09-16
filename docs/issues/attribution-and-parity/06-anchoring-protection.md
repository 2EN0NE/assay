# 06 — 共享题的锚定保护

**What to build:** 同题其他 Owner 的 Forecast 值，在我提交自己的之前不可见（CLI 与 Web 一致）。

**Blocked by:** None — can start immediately（演示需要第二个 Owner，可用 03 造）

**Status:** implemented

- [x] 提交前读不到他人的值；提交后可见
- [x] 复盘期可见（相对分与校准不受影响）
- [x] CLI 与 Web 两面都成立

### 实现说明（供后续票据复用）

- **实现在 `lib/_utils_common.ts` 的 `forecastsAreHidden()` 里**——那是 CLI 与 Web 共用的模块，所以“一面有、另一面无”在结构上就不可能出现。三条读路径（`question.getQuestion`、题单、`pages/api/v0/getQuestion`）都已经在调 `scrubHiddenForecastsAndSensitiveDetailsFromQuestion()`，它们直接继承这条规则。
- 规则：**未结算 + 存在多个不同预测者 + 我还没押 ⇒ 隐藏他人的值**。已结算在最前面就返回 `false`（复盘期一律可见）。未登录访客不受影响（沿用上游公开行为）。
- 上游本来就有 `hideForecastsUntilPrediction` 开关，但那是**每题手动打开**的（默认 `false`）。本票据把它变成多人题上的**默认**：忘记打开开关不会报错，而它只会造成“第二个人在押注前看到第一个人的数字”——恰好是唯一要防的那件事。
- 副作用（有意为之）：通知链路（`question_router.ts:1028`）在遮蔽时直接不通知，所以共享题上“某人押了 X” 的推送不会被发送——推送里带着那个数字，发出去等于锚定。
- CLI 面：`agent_router` 的 `toPredictionView()` 改为只取**我自己的** forecasts。之前它取“全场最近一条”，一条共享题上别人刚押的数字会被当成该题的读数报给我。
- `forecastHiddenReasonText()` 的“无显式开关”分支原来返回空字符串（界面只说“隐藏了”不说“怎么才能看到”），改为返回 `until you make a prediction`。
- 测试：`lib/_utils_common.test.ts` 8 条（多人题未押/已押、单人题、已结算、多选题两个位置、未登录访客、既有开关未被取代）+ `agent_router.test.ts` 2 条 CLI 面守卫。
- **发现的死代码（未删，仅提及）**：`agent_router.ts` 里 `toPredictionView` 之外没有其它 CLI 侧读取他人问题的路径，因此 CLI 面此前不存在“读到他人值”的入口；本票据把该函数的语义钉死，供将来出现共享题读路径时直接继承。
