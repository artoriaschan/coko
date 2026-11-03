# Standards token owner 补充清单

对象 `e7efe155912791f51647b9bcf9f965d0b2362c75`；固定比较 `git diff 6e57ed0a7605996ec96173c897b1546c57ed42aa...HEAD`。仅包含本次 diff 的新增明确数值，不扩展至既有未修改代码、测试或工具已检查的颜色/圆角规则。每项已以最终提交读回行号；f9 后产品源码无变化。

规范：`docs/tech-stack/ui-design-system.md:15` 主题为字体与动效数值唯一来源；`:36` 字号/行高成对登记；`:197` 动效时长与缓动使用主题值。相对继承 `messages.css:419 font-size: 1em` 不列入。主题自身登记的值当然不列违规。

最小修复边界：

- owner 仅为下列八个 CSS 文件、`use-flow-box.ts`、主题 `packages/ui/src/styles/theme.css` 及对应设计系统说明。保留全部已验收的字号、行高、时长、缓动、动画阶段比例和局部字体栈。
- 相同现值优先复用已有 `text-ui-body`、`text-ui-small`、`text-ui-process`、`text-ui-code-small`、`text-ui-terminal` 成对值；需要 14/24、11/19 等独立角色时在主题补齐局部语义 pair。单独 font-size/line-height 的 owner 按当前真实 computed pair 登记，不能换成不同现值只为复用。
- CSS 过渡复用已存在的 `--conversation-process-transition`；shimmer 的 steps 与重复 fallback 数值统一由主题承载。WAAPI 的160ms、50/70ms阶段和缓动从所属元素读取同一组主题 custom properties，仍由该 hook 拥有几何与清理。
- 此清单不建议新增抽象组件、全局改变现有 token、扩大 style-guard、改引用几何或重做交互。最小相关验证是选定 typography/composed 输出与 fold/reduced-motion 路径；只有视觉实值改变才需要失效其他证据。

## [apps/desktop/src/renderer/features/conversation/business-timeline.css](../../../../apps/desktop/src/renderer/features/conversation/business-timeline.css)

字体成对值：

- [4](../../../../apps/desktop/src/renderer/features/conversation/business-timeline.css#L4) `line-height: 20px;`

## [apps/desktop/src/renderer/features/conversation/collaboration-rows.css](../../../../apps/desktop/src/renderer/features/conversation/collaboration-rows.css)

字体成对值：

- [4](../../../../apps/desktop/src/renderer/features/conversation/collaboration-rows.css#L4) `font: 14px/24px var(--font-conversation-sans);`
- [48](../../../../apps/desktop/src/renderer/features/conversation/collaboration-rows.css#L48) `font: 13px/20px var(--font-conversation-sans);`
- [56](../../../../apps/desktop/src/renderer/features/conversation/collaboration-rows.css#L56) `font: 11px/16px var(--font-conversation-mono);`

动效：

- [35](../../../../apps/desktop/src/renderer/features/conversation/collaboration-rows.css#L35) `transition: transform 100ms ease;`

## [apps/desktop/src/renderer/features/conversation/file-tool-details.css](../../../../apps/desktop/src/renderer/features/conversation/file-tool-details.css)

字体成对值：

- [14](../../../../apps/desktop/src/renderer/features/conversation/file-tool-details.css#L14) `font: 11px/18px var(--font-conversation-sans);`
- [55](../../../../apps/desktop/src/renderer/features/conversation/file-tool-details.css#L55) `font: 11px/19px var(--font-conversation-mono);`
- [92](../../../../apps/desktop/src/renderer/features/conversation/file-tool-details.css#L92) `font: 11px/16px var(--font-conversation-mono);`

## [apps/desktop/src/renderer/features/conversation/messages.css](../../../../apps/desktop/src/renderer/features/conversation/messages.css)

字体成对值：

- [68](../../../../apps/desktop/src/renderer/features/conversation/messages.css#L68) `line-height: 24px;`
- [196](../../../../apps/desktop/src/renderer/features/conversation/messages.css#L196) `line-height: 20px;`
- [320](../../../../apps/desktop/src/renderer/features/conversation/messages.css#L320) `line-height: 18px;`
- [355](../../../../apps/desktop/src/renderer/features/conversation/messages.css#L355) `line-height: 19px;`
- [384](../../../../apps/desktop/src/renderer/features/conversation/messages.css#L384) `line-height: 20px;`

动效：

- [71](../../../../apps/desktop/src/renderer/features/conversation/messages.css#L71) `transition: color 100ms ease;`
- [92](../../../../apps/desktop/src/renderer/features/conversation/messages.css#L92) `transition: opacity 100ms ease;`
- [101](../../../../apps/desktop/src/renderer/features/conversation/messages.css#L101) `opacity 100ms ease,`
- [102](../../../../apps/desktop/src/renderer/features/conversation/messages.css#L102) `transform 100ms ease;`
- [141](../../../../apps/desktop/src/renderer/features/conversation/messages.css#L141) `animation: conversation-reasoning-sweep var(--conversation-process-shimmer-duration, 1.5s) steps(48, end) var(--conversation-process-shimmer-delay, 0.3s)`
- [151](../../../../apps/desktop/src/renderer/features/conversation/messages.css#L151) `animation: conversation-reasoning-highlight var(--conversation-process-shimmer-duration, 1.5s) steps(48, end) var(--conversation-process-shimmer-delay, 0.3s)`

## [apps/desktop/src/renderer/features/conversation/process-timeline.css](../../../../apps/desktop/src/renderer/features/conversation/process-timeline.css)

字体成对值：

- [4](../../../../apps/desktop/src/renderer/features/conversation/process-timeline.css#L4) `.conversation-process-group-header { display: flex; align-items: center; max-width: 100%; min-width: 0; gap: 6px; padding: 0; border: 0; background: none; color: var(--conversation-process-muted, var(--muted-foreground)); font-family: var(--font-conversation-sans, var(--font-sans)); font-size: 14px; line-height: 24px; text-align: left; cursor: pointer; transition: color 100ms ease; }`
- [26](../../../../apps/desktop/src/renderer/features/conversation/process-timeline.css#L26) `.conversation-run-process { box-sizing: border-box; display: flex; align-items: center; width: 100%; min-width: 0; height: 33px; margin-top: 12px; padding: 0 0 8px; border: none; border-bottom: .5px solid var(--border); background: none; color: var(--conversation-process-muted, var(--muted-foreground)); font-family: var(--font-conversation-sans, var(--font-sans)); font-size: 14px; line-height: 24px; cursor: pointer; text-align: left; transition: color 100ms ease; }`

动效：

- [4](../../../../apps/desktop/src/renderer/features/conversation/process-timeline.css#L4) `.conversation-process-group-header { display: flex; align-items: center; max-width: 100%; min-width: 0; gap: 6px; padding: 0; border: 0; background: none; color: var(--conversation-process-muted, var(--muted-foreground)); font-family: var(--font-conversation-sans, var(--font-sans)); font-size: 14px; line-height: 24px; text-align: left; cursor: pointer; transition: color 100ms ease; }`
- [8](../../../../apps/desktop/src/renderer/features/conversation/process-timeline.css#L8) `.conversation-process-icon, .conversation-process-chevron { position: absolute; inset: 0; display: inline-flex; align-items: center; justify-content: center; transition: opacity 100ms ease; }`
- [26](../../../../apps/desktop/src/renderer/features/conversation/process-timeline.css#L26) `.conversation-run-process { box-sizing: border-box; display: flex; align-items: center; width: 100%; min-width: 0; height: 33px; margin-top: 12px; padding: 0 0 8px; border: none; border-bottom: .5px solid var(--border); background: none; color: var(--conversation-process-muted, var(--muted-foreground)); font-family: var(--font-conversation-sans, var(--font-sans)); font-size: 14px; line-height: 24px; cursor: pointer; text-align: left; transition: color 100ms ease; }`

## [apps/desktop/src/renderer/features/conversation/structured-tool-details.css](../../../../apps/desktop/src/renderer/features/conversation/structured-tool-details.css)

字体成对值：

- [16](../../../../apps/desktop/src/renderer/features/conversation/structured-tool-details.css#L16) `font: 13px/20px var(--font-conversation-sans);`
- [30](../../../../apps/desktop/src/renderer/features/conversation/structured-tool-details.css#L30) `font: 11px/19px var(--font-conversation-mono);`
- [48](../../../../apps/desktop/src/renderer/features/conversation/structured-tool-details.css#L48) `font: 11px/19px var(--font-conversation-mono);`
- [53](../../../../apps/desktop/src/renderer/features/conversation/structured-tool-details.css#L53) `font: 13px/20px var(--font-conversation-sans);`
- [58](../../../../apps/desktop/src/renderer/features/conversation/structured-tool-details.css#L58) `font-size: 12px;`
- [94](../../../../apps/desktop/src/renderer/features/conversation/structured-tool-details.css#L94) `font: 11px/16px var(--font-conversation-mono);`
- [102](../../../../apps/desktop/src/renderer/features/conversation/structured-tool-details.css#L102) `font: 11px/16px var(--font-conversation-sans);`

## [apps/desktop/src/renderer/features/conversation/tool-image-details.css](../../../../apps/desktop/src/renderer/features/conversation/tool-image-details.css)

字体成对值：

- [50](../../../../apps/desktop/src/renderer/features/conversation/tool-image-details.css#L50) `font-size: 12px;`
- [51](../../../../apps/desktop/src/renderer/features/conversation/tool-image-details.css#L51) `line-height: 18px;`
- [58](../../../../apps/desktop/src/renderer/features/conversation/tool-image-details.css#L58) `font: 11px/16px var(--font-conversation-mono);`

## [apps/desktop/src/renderer/features/conversation/use-flow-box.ts](../../../../apps/desktop/src/renderer/features/conversation/use-flow-box.ts)

动效：

- [69](../../../../apps/desktop/src/renderer/features/conversation/use-flow-box.ts#L69) ``{ height: `${from}px`, marginTop: `${fromMargin}px`, marginBottom: '0px', offset: 50 / 160, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },``
- [70](../../../../apps/desktop/src/renderer/features/conversation/use-flow-box.ts#L70) `{ opacity: 0, offset: 70 / 160 },`
- [75](../../../../apps/desktop/src/renderer/features/conversation/use-flow-box.ts#L75) `{ duration: 160, easing: closing ? 'linear' : 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' },`

## [packages/ui/src/tool-card/tool-row.css](../../../../packages/ui/src/tool-card/tool-row.css)

字体成对值：

- [212](../../../../packages/ui/src/tool-card/tool-row.css#L212) `line-height: 16px;`

动效：

- [95](../../../../packages/ui/src/tool-card/tool-row.css#L95) `animation-timing-function: steps(48, end);`
