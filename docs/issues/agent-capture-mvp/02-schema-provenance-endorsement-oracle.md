# 02 — schema 扩充：来源、背书、判据类型

**What to build:** 让"谁录的""有没有被当事人背书""这条预测靠什么结算"三件事可存可取，且对现有数据与 UI 完全无影响（纯 additive）。

**Blocked by:** None — can start immediately.

**Status:** implemented (验证记录见 `verification.md`；e2e 待浏览器二进制可用后由本地执行)

- [ ] `Question` 增加判据类型与录入来源，默认值使旧数据合法
- [ ] `Forecast` 增加录入来源与背书状态，默认使旧数据仍计入校准
- [ ] `Revision` 表落地（字段：目标预测、字段名、旧值、新值、时间、理由）
- [ ] 迁移可正向执行；现有测试全绿；现有页面无回归
