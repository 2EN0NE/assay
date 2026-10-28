# 试金石

一个 Agent 原生的决策质量提升系统。它在人与 AI 的日常对话中捕获决策，把隐含的信念显性化为可验证的概率预测，长期记录、校准并复盘，从而把「决策质量」与「结果质量」分开。

## Language

### 身份与归属

**Credential / 凭据**:
一方用来向系统声明「我是谁」的**可轮换**秘密：一串钥匙。它**自足**——不需要先有一次登录，也不依赖邮箱可达；CLI 与 Agent 只按它认身份（[ADR-0021](docs/adr/0021-cli-identity-by-credential.md)）。轮换一把钥匙等于换身份（[ADR-0022](docs/adr/0022-credential-provisioning.md)）。
_Avoid_: 密码（本工程不引入第二类秘密）、token（太泛，分不清是凭据还是网页会话）

**Pairing Code / 配对码**:
由已经持有 **Credential** 的一方签发的、**一次性**的短秘密，用来把一个浏览器会话换到该凭据所对应的身份上（“谁持有钥匙，谁就能为这个身份开门”）。它只在**实例本机**（loopback）可兑换，且该能力由一个**默认关闭**的开关控制；它不是第二条长期凭据，用后即废。
_Avoid_: 一次性密码（暗示它替代长期凭据）、邀请码（那是建号，不是登录到既有身份）

**Identity Selector / 身份选择器**:
一个只在**本机**有效的身份指定（`ASSAY_AGENT_USER_EMAIL`）：它说「以哪个身份做事」，但**不含任何秘密**——同一台机器上谁能设这个变量，谁就能以该身份跑命令。所以它够做业务动作（记决策、结算、背书），但**证明不了「持有」**：需要凭据的动作（例如签发配对码）只认 **Credential**（[ADR-0035](docs/adr/0035-pairing-code-as-second-door.md)）。
_Avoid_: 弱凭据、备用凭据（它根本不是凭据，只是选择器）

**Instance / 实例**:
一套部署（一个库 + 一个对外地址）所承载的 Owner 集合。它可以是单人自用，也可以是一个用户组共用——后者是**目标形态**，不是边界情况（[ADR-0025](docs/adr/0025-multi-owner-is-a-target-scenario.md)）。
_Avoid_: 租户、工作区（都暗示本工程已有对应的管理界面）

**Identity Scope / 身份作用域**:
一份凭据被解释成「哪一个身份」的范围。粒度是**进程**：默认取所在**仓库副本**的凭据，但进程环境变量（或凭据文件）可显式覆盖——因此同一份副本里的多个进程可以是多个身份，不同副本自然也可以是（[ADR-0036](docs/adr/0036-identity-scope-is-the-process.md)）。
_Avoid_: 项目（歧义：既指仓库也指 pi 的 cwd）、机器级身份

**Owner / 归属方**:
一条记录所属的那一方：**Decision 的 Owner** 是做出该决策的人，**Prediction / Forecast 的 Owner** 是持有该信念的人。每条记录恰有一个 Owner。同一个 Owner 名下，人做的判断与代理记下的东西必须能分开读出（见 Delegate 与 Provenance）。早期 ADR 里写的「当事人」，指的就是相关记录的 Owner。
_Avoid_: 当事人（不指明是哪一层）、作者（Question 的作者是另一回事）、账号

**Delegate / 代理**:
以 Owner 身份行动、但不是 Owner 本人的那一方——在本工程里就是 pi 会话中的 Agent。代理与 Owner 共用同一个身份（ADR-0021），因此「谁做的」不能从身份推断，只能从 Provenance 读出。
_Avoid_: 第二个用户、独立账号、bot（都暗示它是另一个身份）

### 决策与信念

**Decision / 决策**:
在信息不完整、结果不确定时，对有限资源（时间、金钱、注意力、健康）做出的一次分配；其结局部分由运气决定。一个 Decision 可拆解为若干 Prediction。
_Avoid_: Choice, pick, call

**Prediction / 预测命题**:
对某个尚未发生、且可被某个结算判据判定真伪的陈述。它是系统可结算的最小单位。
_Avoid_: Guess, call, question

**Action / 决策动作**:
决策对世界做出的那**一件事**，具体到可核对（动词 + 对象 + 量）。主语是**我**，因此它不是 Prediction（Prediction 的主语是世界，且计分）。在决策当时写下（连同承诺时点），属于"当初的记录"：改写须留痕，揭晓后冻结。**可选**——纯判断型决策可以没有动作，必填只会逼出编出来的动作。
_Avoid_: 计划（那是意图，不要求可核对）、任务（那是执行分解）

**Execution / 执行记录**:
"那个动作真的发生了没有、什么时候"的**事实**。只增不改、不参与任何分值，也不受揭晓冻结（多阶段执行可能晚于揭晓）。**明确放弃（ABANDONED）是独立取值**，不是"一直没执行"——否则「放弃」会被永久读成「逾期未做」。
_Avoid_: 结果（那是世界给的）、完成度（那属于清单）

**Resolution Oracle / 结算判据**:
判定一个 Prediction 真伪的信息来源：公共事实（任何人可查证）、Agent 可观测的信号，或该 Prediction 的 **Owner** 自己的报告。
_Avoid_: verifier, judge

**Resolution Drift / 结算漂移**:
结果揭晓后重新解释当初的结算标准，使判定偏向自己期望的方向。判据越靠近该 Prediction 的 Owner，风险越高。
_Avoid_: hindsight bias（那是对已发生事的记忆偏差，不是对判据的重解释）

**Forecast / 预测值**:
赋予某个 Prediction 的具体概率（0–1）。同一 Prediction 可有多次 Forecast，构成随时间更新的序列。
_Avoid_: Confidence（见下）

**Unquantified / 未量化**:
尚未被赋予任何 Forecast 的 Prediction。它是**合法状态**，可复盘、可日后补上概率，但不参与校准。
_Avoid_: draft, empty, blank

**Confidence / 置信度**:
决策者对某个 Prediction 为真的主观概率。它的口语形式（"我大概七成把握"）是 Forecast 的来源。
_Avoid_: Belief, certainty, probability estimate

**Elicitation / 概率显性化**:
把该 Prediction 的 **Owner** 对某个 Prediction 的置信度从模糊口语逼成概率数字的**对话动作**。它**不产生新的量**——只是把该 Owner 已经持有的信念换个表示说出来；因此任何显性化结果都必须能被该 Owner 复述为"这就是我的把握"。回答的**精度本身是信息**：直接说出 91.24% 意味着背后有成体系的分析，而"5 分制里的 4 分"是合法且常见的粗粒度回答——两者都要能落库为 Forecast。该 Owner 给不出数字时，"还没想清楚"是合法终点（见 Unquantified）。
_Avoid_: 诱导（暗示"把数字塞给人"，而把数字塞给人正是随口给的数字的成因）、推断（那是 Agent 自己产出数字，见 Provenance）

**Scale Substitution / 量表替代**:
该 Prediction 的 **Owner** 说不出百分比时，改问一个粗粒度刻度（1–5、1–10、0–100），刻度上的点**等价于**一个概率——它只是同一信念的另一种表示。问的必须是**事件发生**的把握，不是"你对自己判断的信心"（后者是另一个量）。
_Avoid_: 打分（会被读成对推理质量的评分）

**Negation Check / 否定检验**:
就**同一个命题的逻辑否定**再问一次（"明天下雨" ↔ "明天不下雨"），用两者之和是否为 1 校验一致性。矛盾时不得静默挑一个数，必须问出哪一个才是该 Prediction 的 Owner 的把握。**必须用逻辑否定，不能用近义的另一个事件**——"天晴"不是"下雨"的否定，雨 30% 与晴 10% 可以由阴天 60% 补齐，用近义事件当否定会产生**无根据的追问**，而无根据的追问正是随口给的数字的来源。
_Avoid_: 逆向、反向（都暗示只是"换个角度"）

**Concretization / 具体化**:
把概率换成具体情境（转盘、赌注）帮该 Prediction 的 Owner 找到感觉。好处是让抽象概率变得可感——"实例化"本身就能揭示该 Owner 自己都没意识到的把握。但它的输出只是**候选值**：赌局同时量到风险偏好与赌注大小，"我愿意在 65% 下注"不等于"我相信 65%"，因此必须复述给该 Owner 确认（"所以你的把握大约在 65%？"）才成为 Forecast。
_Avoid_: 等价赌局（"等价"是未经验证的假设）

### 生命周期

**Recording / 记录**:
在决策时点把 Decision 及其 Prediction 固化为**可独立结算**的记录（含结算判据、结算标准、锚点与期限）。

**Tracking / 跟踪**:
决策之后独立地监测并结算 Prediction 的过程；不依赖记录时的对话上下文。

**Settlement / 结算**:
把一个 Prediction 的真伪固定下来（YES / NO / AMBIGUOUS），并触发计分——判为 AMBIGUOUS 时除外（见 AMBIGUOUS 与 ADR-0018）。
_Avoid_: resolution（歧义：既指动作也指结果值）

**Outcome Reveal / 揭晓**:
该决策下**任一条** Prediction 被结算的时点。从这一刻起后见之明可用，因此**清单与当初的叙事字段同时冻结**，此后的事后表达只能走进 Reflection。判据是「库里已有结算」，而不是「现实世界已出结果」——两者可以不重合。
_Avoid_: 结算完成（那只说某一条 Prediction）、到期（到期不等于揭晓）

**Freeze / 冻结**:
揭晓之后，该决策的**清单与当初的叙事字段**一并变为只读，空白也不例外——冻结时它还是空白，就永远是空白（那是"当时没记"这个事实本身）。时点**落库**而非推导：撤销结算会让"库里现在有结算"不再成立，而冻结必须单向。解除只能手工改库，因此只适用于纠错。
_Avoid_: 锁定（它只涵盖清单，是冻结的一个后果）

**AMBIGUOUS / 判不出来**:
结算时判据无法判定真伪：事件未发生、证据不足，或判据本身有歧义。它**不是**"预测错了"，也不是"预测对了"——它是"没有信息"，因此不产生校准样本、不计分。把判不出来的题当零损失，等于给它满分。
_Avoid_: unresolved（那是"尚未结算"，与"已结算但判不出来"是两件事）

**Resolution Proposal / 结算提案**:
跟踪 Agent 提交的、附依据的结算建议；在获得确认前不改变 Prediction 的结果。

**Evidence / 结算证据**:
支撑一次结算的可核查来源（链接或可复查的记录）。落库在 `Question.resolutionSource` / `Question.resolutionRationale`。

**Provenance / 录入来源**:
一条记录的产生方式：人类在 UI 上直接操作、依据人的明确指令由 Agent 录入、或 Agent 自主搜集（`RecordProvenance`：`HUMAN` / `AGENT_INSTRUCTED` / `AGENT`）。
_Avoid_: source, origin, author

**Endorsement / 背书**:
**该 Forecast 的 Owner**（只能由他本人，不能由其代理）对一条 Agent 搜集记录中那个数字的明确确认。未获背书的记录不得进入校准。
_Avoid_: approval, sign-off

**Revision / 修订**:
对已冻结字段（结算判据、期限、锚点）的修改，以及对**决策叙事字段**（陈述 / 理由 / 预期后果 / 当时已知 / 当时未知）在**揭晓前**的改写。必须留痕（旧值、新值、时间、理由）；首次 Forecast 之前的改动、以及揭晓前给空白叙事字段**补写**，都不算修订。**揭晓之后**叙事字段连同其空白一并冻结，事后表达不属于修订，而属于 Reflection。
_Avoid_: edit, change

**Reflection / 复盘记录**:
决策**事后**的表达通道：与当初的叙事字段**物理分开**，因此不必读时间戳就知道它是事后的。它不参与任何分值，也不冒充当初的想法——写在这里的每一句都是「现在怎么看」，而不是「当时怎么想」。
_Avoid_: 复盘材料（那包含当初的记录）、修订（那是改写当初的记录）

**Delivery / 触达**:
把一条 Notification 或 Resolution Proposal 送达其 Owner 的动作。

**Delivery Channel / 触达通道**:
触达的承载方式。内置**只提供站内**；其余通道（Telegram、微信等）由 pi 侧的消息插件实现，本工程只预留接口。
_Avoid_: transport, notifier

**Brief / 状态简报**:
一份**现算、不落库**的当前状态快照：未结算预测的到期分布、最近几条、清单从未记录（分"还救得回来"与"已冻结"）、未标领域、未背书数字、没有预测的决策。唯一生产者是一条 procedure，CLI 与 Web 读同一份——因此 agent 说"未结算 38"时，人能在网页上核对同一个 38。
_Avoid_: 提醒（那是要求行动，简报只是状态）、缓存/快照表（落库的读数必然过期）

**Baseline / 基线**:
不依赖任何 agent 运行时也能走完回路的最小载体集合：CLI + 自足的 `AGENTS.md` + skill。
_Avoid_: 默认配置（它说的是取舍，不是完整性）

**Accelerator / 加速器**:
只在某一个 agent 运行时内存在、**只负责"到达"**（把 Brief 按轮注入）的附加物。判据是**删掉它回路仍然完整**——因此它提高的是信息到达率，不是执行率；它失效时必须自报，不得静默消失。
_Avoid_: 插件、扩展（都暗示它是必需的一层）

### 评估

**Calibration / 校准**:
Forecast 的概率与实际发生频率的一致程度。说 70% 的事若约 70% 发生，则校准良好。

**Decision Quality / 决策质量**:
仅就决策时点可得的信息与所采用的推理过程而言的优劣。

**Outcome Quality / 结果质量**:
决策实际结果的好坏。它受运气与隐性信息影响，不等于 Decision Quality。

**Resulting / 结果偏差**:
以 Outcome Quality 反推 Decision Quality 的思维错误。

**Brier Score / 布里尔分数**:
Forecast 准确度的量化损失，越低越好。

**Relative Brier Score / 相对布里尔分数**:
相对同期其他预测者中位数的 Brier Score，用于跨问题、跨时间可比。

**随口给的数字**:
在追问压力下、为尽快结束对话而给出的概率，而非该 Owner 真实的信念。它通过了背书的形式要件，因此比"没有样本"更危险。

**Domain / 领域**:
用户对"这一类决策"的称呼（招聘、投资、产品取舍……），是**用户概念**：它回答"我在这类决策上表现如何"。

**Tag / 标签**:
领域的**机制载体**——现有的 `Tag` 模型（按 user 唯一）。它服务的是校准分桶查询，不是用户语言。说"领域"时指用户概念，说"标签"时指这行数据，两者不可当同义词用。

**Tag Authority / 领域权威**:
一条决策的领域归 `Decision`（用户在此表达一次）；挂接预测时**写时复制**为其 Question 的标签，且**不跟随**后续改动。见 [ADR-0030](docs/adr/0030-domain-authority-on-decision.md)。

### 决策卫生

**Objectivity over Convenience / 客观优先**:
判据只能由系统从原始事实推导，不得被被评者本人影响。可自报的基准率、可手动调整的水平、把过程完成度折算进结果判据——这三类"更便捷"的设计一律拒绝：它们换来的便利，正好是判据失去意义的那个部分。见 [ADR-0032](docs/adr/0032-domain-assessment-by-base-rate-skill.md)。

**Uncertainty Must Be Shown / 不确定性必须呈现**:
每个数值读数都带区间；区间跨 0 时只能说"无法判断方向"。点估计单独出现就是伪精度——它让噪音看起来像结论。见 [ADR-0033](docs/adr/0033-no-total-score-but-intervals.md)。

**Pre-mortem / 事前剖析**:
决策启动前，假设未来已彻底失败，倒推导致失败的具体原因。

**Kill Criteria / 退出条件**:
以「状态 + 日期」形式预承诺的终止条件；触发即执行，不再重新争论。
_出处_: Annie Duke, _Quit: The Power of Knowing When to Walk Away_ (2022), ch.6「Kill Criteria / States and Dates」。

**预先设限**:
在冷静状态下预先设置的机制性限制，用以约束未来热状态下的冲动决策。

**Decision Rubric / 决策清单**:
决策质量的记录方式：一张**可查证的过程清单**（备选方案 ≥ 2 / 事前剖析 / 参考基准率 / 写下"我可能错在哪" / 判据可证伪且已冻结），每条只记做到与否。分值由清单完成度**推导**（分母取该决策所属**决策版本**的条目集合），而不由该 Decision 的 Owner 自评——自评会变成另一个随口给的数字，且不可查证；清单还多出诊断力：它告诉你漏了哪一步。决策下任一 Prediction 结算后清单**只读**（ADR-0020）。
_Avoid_: 量表、评分表

**Decision Version / 决策版本**:
一个 Decision 计分时适用的**清单条目集合**的版本（`Decision.rubricVersion`）。清单条目增删时新建一个决策版本，**既有版本的条目列表不得被改写**——历史决策因此按自己的版本解释：分值不会因为后来删掉一条而变好看，也不会因为后来新增一条而掉下来。
_Avoid_: 修订（那是内容的变更留痕，见 Revision）、清单世代

**Nominal Group Technique（先独立后集中）**:
先让成员独立、异步地提交意见与预测，再集中讨论分歧，而不是追求对齐。
_出处_: Delbecq & Van de Ven, "A Group Process Model for Problem Identification and Program Planning", _Journal of Applied Behavioral Science_ (1971), 7(4)。

**Anchoring Protection / 锁定保护**:
同一条 Prediction 下，其他 Owner 的 Forecast 值在**你提交自己的之前不可见**（提交后即可见）。这是「先独立后集中」的强制形式：先看见别人的数字再下注，就是在重复他的锚，而不是表达你自己的信念。
_Avoid_: 隐藏预测、削峰（都暗示这是为了让人不敢说）

**三人独立咨询**:
三人各自独立判断、再只对照分歧的咨询小组；讨论约定四条：信息共享、只看论据不看人、以求真为先、主动质疑。

**一人拍板**:
对最终决策负责并拍板的单一决策人。

**不透露结果地请教**:
向他人求助时，只描述决策前的状态、刻意隐瞒结果，以获得不被结果污染的反馈。
