# HeadlessUI v2 的 `<Transition>`：单子元素 + ref 必须落到真实 DOM

## 症状

`/q/[id]` 与首页的每一张 Question 卡片都渲染成 `Something went wrong`（`Question.tsx`
外层的 `ErrorBoundary` fallback），Next dev 全屏错误层报其中一条：

- `Passing props on "Fragment"! The current component <Transition.Child /> is rendering a "Fragment"...`
- 修掉上一条之后接着报：`Did you forget to passthrough the ref to the actual DOM node?`

e2e 层面表现为大范围红色，但**根因被误判成测试问题**：最初的判断是"首页两个按钮
模糊匹配触发 strict mode"和"`subscribeToMailingList` 的 unhandledRejection 盖住页面"。
两者确实存在、也确实该修，但都不是 5 条用例全红的根因。

## 根因

依赖是 `@headlessui/react@2.1.2`。v2 的 `<Transition>` 与 v1 有两条硬约束：

1. **只接受一个子元素**。传多个子元素时它内部把子元素包成 Fragment 再挂 `ref`，
   于是抛 `Passing props on "Fragment"`。v1 允许"多个子元素各自过渡"的写法已失效。
2. **子元素必须能把 `ref` 落到真实 DOM 节点上**。v2 自己在 layout effect 里断言
   `ref.current !== null`，否则抛 `Did you forget to passthrough the ref`。
   因此普通函数组件（没有 `forwardRef`）、以及 `return null` 的子元素都不行——
   二者都不会产生 DOM 节点。

`components/questions/Question.tsx` 的展开区同时踩中了这两条：

```tsx
// 坏：两个子元素 → Fragment 错误
<Transition show={...} {...expandTransition}>
  <QuestionDetails ... />   {/* forwardRef，OK */}
  <AgentRecordPanel ... />  {/* 普通函数组件，且无 agent 痕迹时 return null */}
</Transition>
```

## 做法

- 展开区的两个面板各自开一条 `<Transition>`，共享同一份动画参数
  （`expandTransition`），DOM 结构与过渡效果都不变。
- 不能接受 `ref` 的面板外面套一层无样式 `<div>`，保证 `ref` 总有落点：

```tsx
<Transition show={...} {...expandTransition}>
  <QuestionDetails ... />
</Transition>
<Transition show={...} {...expandTransition}>
  <div>
    <AgentRecordPanel question={question} />
  </div>
</Transition>
```

## 排查手法

页面被 `ErrorBoundary` 盖住时，`error-context.md` 的页面快照只有一句
`main: Something went wrong`，定位不到组件。有效路径：

1. Playwright 的 `trace.zip` 里 `*-trace.trace` 含 React 组件栈，grep
   `at De (…transition.js` / `at He (…transition.js` 即可确认是哪一层 Transition；
   再往下的 `at div / at MotionComponent / at ErrorBoundary` 就能认出文件。
2. `@headlessui/react/dist/components/transition/transition.js` 里的 `le()` 是
   "是否需要 ref" 的判据（有 enter/leave 类、或 `as` 不是 Fragment、或子元素恰好一个）；
   报错点在同一文件的 `H(...)` layout effect 里。

## 教训

- **"测试挂了"先别急着改测试**。本次 5 条 e2e 全红时，工作区里已经在改断言
  （signIn 按钮 exact、`getByText` 加 `exact`）——那些改动本身是对的，却把真正的
  应用崩溃掩盖了。先看页面快照里有没有 `Something went wrong` 一类的错误边界痕迹。
- 依赖升级（v1→v2 的 headlessui）留下的写法，只有"页面真的被打开"才能发现；
  这类回归正是链路测试存在的理由，把它跳过等于把回归留到线上。
