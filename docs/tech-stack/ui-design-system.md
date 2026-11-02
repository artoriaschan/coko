---
kind: technical-spec
description: "设计 token 分层与命名、颜色与主题、字体、圆角档位与嵌套几何、材质、边框与菜单叠加、状态样式，以及样式守卫。"
lifecycle: active
---

# 设计系统规格

项目级技术约定，不代表已有实现或已验证结果；适用范围与变更规则见 [专项导航](README.md)。本页规定 [界面约定](ui.md#设计系统) 中设计原则的具体档位、命名与 Tailwind 写法；交互、反馈、布局和验收仍以界面约定为准。

数值与规则参照 DeepSeek Harness 的 Web 设计系统（圆角档位、发丝线、superellipse 圆角、elevation 材质与菜单几何），由用户于 2026-10-28 确认采用，并改写为 Coko 已选的 Tailwind CSS 4 + shadcn/ui 写法。主题样式表位于 `packages/ui/src/styles/theme.css`，消费方以 `@coko/ui/styles/theme.css` 导入。

## Token 分层

主题样式表位于 `packages/ui`，是颜色、圆角、阴影、字体和动效数值的唯一来源。业务组件通过 Tailwind 工具类消费语义 token。

| 层 | 命名 | 定义位置 | 消费者 |
| --- | --- | --- | --- |
| 原始色板 | `--palette-*` | 主题样式表 | 只供语义 token 引用 |
| 语义 token | shadcn/ui 的 `--background`、`--foreground`、`--primary`、`--muted`、`--border`、`--ring` 等，加 Coko 扩展的 `--link`、`--overlay`、`--menu-fill`、`--card-fill`、`--card-stroke`、`--elevation-stroke`、正文用的 `--success-text` / `--warning-text` 与终端 ANSI 前景色 `--terminal-{red,green,yellow,blue,magenta,cyan,muted}` 等 | 主题样式表的 `:root` 与 `.dark` | 经 `@theme inline` 映射为 Tailwind 工具类 |
| Tailwind theme | `--color-*`、`--radius-*`、`--shadow-*`、`--text-ui-*` | 主题样式表的 `@theme` | 业务组件使用 `bg-background`、`rounded-md`、`shadow-panel`、`text-ui-body` 等类 |
| 组件局部变量 | `--local-*` | 所属组件 | 仅用于该组件的布局，可引用共享 token |

`@theme` 先用 `--color-*: initial` 等写法清空不使用的默认命名空间，再只登记项目 token，使 `bg-red-500` 这类默认色板类不再生成样式。[Tailwind theme 变量](https://tailwindcss.com/docs/theme)。Tailwind 对未登记的类名不报错、只是不输出样式，这类误用由 [样式守卫](#样式守卫) 发现。

修改共享 token 只在主题样式表中进行，业务包消费语义类。新增 token 档位属于共享设计规则变更，按 [界面约定](ui.md#设计系统) 的“局部修复保持局部”检查受影响组件。

## 颜色与主题

- 业务组件只使用语义颜色类。字面量颜色（`#hex`、`rgb()`、`oklch()` 等）只出现在主题样式表的原始色板中；业务组件不引用 `--palette-*`，也不写 `bg-[#…]` 这类任意颜色值。
- 明暗主题由主题样式表中 `.dark` 下的语义 token 取值解决。业务组件不写 `dark:` 变体和主题判断；shadcn/ui 组件源码引入时，把其中的 `dark:` 分支改写为语义 token。
- 文字与背景的组合在明暗两套主题下都需可读。弱化色适合装饰性表面，用于文字前在两套主题下分别核对对比度。`--success` / `--warning` 用于图标、状态点与填充；正文大小的成功与警告文字用 `--success-text` / `--warning-text`，终端输出用 `--terminal-*`，两套主题下对背景都不低于 4.5:1（Jobs tab 的浏览器测试按计算样式核对）。

## 字体与链接

- 字号与行高成对登记为 `text-ui-*`，例如 `--text-ui-body` 与 `--text-ui-body--line-height`。业务组件在已有角色匹配时选用对应档位，不为单个元素新造字号；同一页面的字号种类保持少量。行与明细的常用档位为 13px（`text-ui-body`）；完整档位为 `caption` 11/14、`small` 12/18、`body` 13/20、`body-lg` 14/22、`title` 16/24、`heading` 20/28、`display` 24/32，登记于主题样式表。
- 业务界面字重上限为 500，使用 `font-normal` 与 `font-medium`。Markdown 正文的排版字重由 `MarkdownRenderer` 管理，是唯一例外。
- 可点击的产物链接（Markdown 链接、文件提及、来源链接、产物文件标签）使用 `text-link` 与 `font-medium`，静止时无下划线；hover 与键盘焦点时显示点状下划线，偏移 3px。
- 代码、终端和 diff 中需要保持列对齐的内容不换行，在所属区域内横向滚动，滚动条使用共享样式。

## 圆角

### 档位

H 指设计外框高度（含边框），R 指 `border-radius`。先按组件角色选档，再按尺寸变体选择；宽度、标签长度、偶然换行或内容增高不单独决定更大的圆角。

| 角色 | 典型尺寸与示例 | R | Tailwind 类 |
| --- | --- | --- | --- |
| 细小元素 | H20 以下；键帽、行内代码、微型控件 | 4px | `rounded-xs` |
| 紧凑控件 | H20–28；小按钮、紧凑图标按钮、紧凑菜单项 | 8px | `rounded-sm` |
| 标准控件或单行单元 | H32–40；按钮、输入框、选择器、通用导航行 | 12px | `rounded-md` |
| 侧栏分类列表项 | H32；置顶项目与会话、独立会话、项目及其会话 | 8px | `rounded-sm`；使用下文的圆弧变体 |
| 侧栏底部用户入口 | H36；头像、用户名与设置组成的一行入口 | 8px | `rounded-sm`；使用下文的圆弧变体 |
| 大控件或成组内容 | 大按钮、有意设计的多行单元、嵌套表单组、代码块、diff、预览卡 | 16px | `rounded-lg` |
| 独立内容卡 | 设置卡、消息气泡、引导入口卡 | 20px | `rounded-xl` |
| 主容器面 | 输入区、对话框、主面板与浮动面板 | 28px | `rounded-panel` |

`@theme` 只登记以上六档（`--radius-*: initial` 后重新定义），沿用 shadcn/ui 的 `xs`/`sm`/`md`/`lg`/`xl` 名称并新增 `panel`。`cn()` 的 `extendTailwindMerge` 同时登记 `rounded-panel` 与下文的 `rounded-round`，以便与其他圆角类正确合并。

- 尺寸介于两档之间时，优先采用已有共享尺寸变体。更高的卡片仍是卡片，不因高度超过按钮升为 R28；普通按钮的标签换行后保留按钮变体，有意设计为多行的单元才用 R16。
- Button 的 `sm` 为 H28/R8，`default` 为 H36/R12；filled、outline、ghost、loading 和 disabled 变体保持相同尺寸与圆角。标准 H32 输入框与 H36 选择器使用 R12。固定外框尺寸使用 `box-sizing: border-box`。
- hover、pressed、selected、focus 状态不改变圆角。
- 档位外的组件专属几何写在组件局部变量中，并在守卫例外表中逐文件、逐选择器登记，不整包豁免。由真实内边距推导的 `calc()` 几何不算新档位。

### 侧栏分类列表项

按用户于 2026-11-02 提供的桌面侧栏悬停参考，分类下的列表项使用 H32/R8 圆弧变体：截图中 64px 的行高和 16px 的圆角按 2 倍像素比例换算为 32px 与 8px。该变体复用已有 `--radius-sm`，不新增圆角档位。

- **范围与几何。** 适用于置顶分类中的项目和会话、对话分类中的会话、项目分类中的项目及展开后的所属会话。行高 32px、行间距 2px、圆角 8px，曲线使用 `corner-shape: round`。normal、hover、pressed、selected 与 focus 保持相同外框和圆角；嵌套会话通过内容缩进表达层级，背景仍覆盖完整列表行。
- **悬停表面。** normal 为透明背景；hover 使用 `bg-accent`，移出后恢复原有背景，已有 selected 等业务状态继续保留。不添加中性描边或 elevation 阴影，不改变文字位置、行高、宽度或圆角。背景覆盖行内图标与文字所在的整个可点击表面。
- **实现归属。** 实现时由 `packages/ui` 的共享侧栏列表项变体统一设置 `rounded-sm` 和圆弧曲线，包括实际绘制表面的伪元素；业务页面消费该变体，不自行覆盖圆角曲线。hover 仍遵守下文的输入能力约束，键盘焦点和选中状态独立可见。

### 侧栏底部用户入口

按用户于 2026-11-02 提供的底部用户区域参考，外部区域高 46px，顶部保留 0.5px 分隔线；内部用户行高 36px，左右外留白各 12px，顶部留白 4px、底部留白 6px。头像为直径 22px 的圆形，用户行左内边距 9px，头像与姓名间距 9px；设置图标框为 16px，右内边距 12px。姓名沿用 `text-ui-body` 与 `font-medium`，头像、文字和设置图标垂直居中。上述布局值由用户入口组件的局部几何变量维护。

用户行使用 R8 圆弧变体，normal 为透明背景，hover 使用 `bg-accent`，不添加中性描边或 elevation 阴影；状态变化不改变外框和内容位置。实现时由共享用户入口变体统一维护曲线与材质，头像保持 `rounded-round` 的圆弧。

### 曲线、圆形与胶囊

主题样式表默认对所有元素及其 `::before`、`::after` 设置 `corner-shape: superellipse(1.5)`；该属性不继承，所以伪元素需要显式覆盖。Electron 41 的 Chromium 支持该属性（Chromium 139 起提供）。上文的侧栏分类列表项和底部用户入口使用共享的圆弧变体，圆形与胶囊按下文规则处理；其余组件不另行设置平滑曲线，使填充与轮廓的弧线一致。[MDN 兼容数据](https://github.com/mdn/browser-compat-data/blob/main/css/properties/corner-shape.json)

圆形头像、状态点、显式胶囊和全圆轨道使用主题提供的 `rounded-round` 工具类，它同时输出全圆半径与 `corner-shape: round`，保持圆弧；业务组件不单独使用 `rounded-full` 或 `rounded-[50%]`。小按钮不因高度小而改为胶囊。头像容器及其中的图片都保持圆形，宽高相等。

贴边停靠的表面与相邻单元在共享边上可为 R0。与卡片平齐的标题、页脚或图片只圆化外露的角，内部接缝保持直角。

### 嵌套与 hover

修改子元素圆角前，先区分三种布局：

| 布局 | 规则 | 示例 |
| --- | --- | --- |
| 同心内嵌 | 内 R = max(0, 外 R − 内边距)；两条弧同心 | 外 R16、内边距 4px、内 R12 |
| 填充贴着外容器边缘 | 外容器负责可见圆角，用 `overflow-hidden` 裁剪，子元素用直角或继承匹配的角 | 分体按钮卡片中两个独立的 hover 区域 |
| 另一表面内的独立卡片或表单组 | 选子元素自身的语义档位，不机械减去父级内边距 | R20 设置卡中的 R16 编辑区 |

| 组件 | 外框 | 内边距 | 项与指示器 |
| --- | --- | --- | --- |
| 标准菜单（DropdownMenu、ContextMenu、Select、Command） | R16 | 4px | R12 |
| 紧凑菜单 | R12 | 4px | R8 |
| 分段控件（ToggleGroup 等） | R12 | 4px | R8 |
| 分段标签（Tabs） | R16 | 4px | R12 |

调整内边距时同步检查指示器偏移、宽度计算、子菜单对齐与指针桥接区域。圆角相减是嵌套 superellipse 的名义尺寸规则，对角方向的间隙可能与边上的内边距不同；需要严格等距时改用 `rounded-round` 的圆弧。

单个可点击表面在自身上绘制 hover。贴边的伪元素或覆盖层使用与可见外轮廓相同的圆角和曲线，避免背景与边框之间出现月牙形缝隙。分体卡片把圆角和裁剪放在外层，内部按钮用直角，各自的 hover 色由外层裁剪成同一轮廓；下拉菜单通过 portal 留在被裁剪的子树之外，键盘焦点环保持可见。

## 材质、边框与浮层

- **抬升表面用阴影，不用边框。** 菜单、Popover、HoverCard、对话框、浮动面板、浮动按钮和输入区使用 `border-0`，配合 `shadow-panel`、`shadow-prominent`，输入区使用模糊更大、透明度更低的 `shadow-soft`。这些阴影的第一层是 0.5px 发丝描边，颜色取 `--elevation-stroke`，可按表面或状态重新绑定或取消。中性边框与 elevation 阴影不叠加；shadcn/ui 中 `border` 配 `shadow-md`/`shadow-lg` 的浮层组件引入时按此改写。
- **平面中性线统一为 0.5px。** 按钮、输入框、卡片、行分隔线，以及以填充块绘制的分隔线（菜单分隔线、标题栏接缝、Markdown `hr`、竖向分隔）使用主题登记的 0.5px 发丝线宽（`--hairline`；工具类 `border-hairline`、`border-{t,b,l,r}-hairline`、`h-hairline`、`w-hairline`），在 Retina 屏上绘制为一个设备像素。Tailwind 默认的 `border` 为 1px，中性线不使用。虚线提示与警告、错误等状态色边框保持 1px；加载圈的轨道宽度作为显式例外登记。
- **设置卡材质。** 设置类卡片使用 `rounded-xl`、0.5px 的 `--card-stroke` 描边与 `--card-fill` 背景；selected、warning、error 和 expanded 状态改用已有语义色并保持几何。卡内的嵌套编辑区使用 R16。普通平面卡片不为区分标签页而加阴影。
- **菜单材质。** 下拉、右键、子菜单和选择菜单都通过共享的 Menu 组件渲染，或用共享的菜单表面包裹自定义内容。背景取 `--menu-fill`，亮色主题统一映射为不透明白色；模糊取主题的菜单 backdrop-filter。业务与平台样式不覆盖这两项，也不重新定义它们。backdrop-filter 放在独立的伪元素层上，因为直接加在菜单元素上会使其成为 fixed 定位后代的包含块，嵌套菜单与固定覆盖层会错位。
- **二级菜单叠加。** 上一级菜单保持打开时，所有二级菜单必须以更高的共享浮层层级叠加在上一级菜单前方，并与父菜单表面产生几何重叠。父菜单保留打开状态、选择状态及可识别的上下文；子菜单覆盖相交区域，并沿用共享菜单材质与阴影。通过 portal 和共享层级管理避免父容器裁剪或遮挡子菜单；窗口边缘避让时保持父子关系和必要操作可达。关闭子菜单时先退出当前层并将焦点返回父菜单触发项，父菜单继续显示。分支选择菜单遵循此规则。
- **模态遮罩。** 对话框遮罩使用 `bg-overlay`（统一半透明暗色），不模糊、不滤镜父页面；替换 shadcn/ui 默认的 `bg-black/50`。
- **滚动条与焦点。** 滚动条只由主题样式表管理，组件不写自己的 `::-webkit-scrollbar` 选择器；滚动条与容器边缘保留小间距，不越界、不被圆角裁断。焦点环使用 `ring` token 和共享的 `focus-visible` 样式，不被 `overflow-hidden` 的外层裁掉。

## 状态与输入能力

- Tailwind CSS 4 的 `hover:` 变体只在 `(hover: hover)` 下生效，组件直接使用 `hover:`，不改写该变体。[Tailwind v4 升级说明](https://tailwindcss.com/docs/upgrade-guide)。手写 CSS 中的 `:hover` 放进 `@media (hover: hover)`，与视口宽度无关。
- selected、expanded、pressed 状态使用 `data-[state=…]:`、`aria-selected:`、`aria-expanded:`、`aria-pressed:` 等变体，键盘焦点使用 `focus-visible:`，都不放在 hover 条件内。
- 依赖指针精度的表现使用 `pointer-coarse:`：粗指针下文本输入框字号不低于 16px，精细指针保持紧凑尺寸。
- JS 悬停预览在 `(any-hover: hover)` 下接受鼠标进入，忽略 `pointerType === "touch"` 的事件。
- 动效时长与缓动使用主题登记的值，并提供 `motion-reduce:` 下的替代或关闭。

## 样式守卫

已接入：`packages/ui/src/guards/style-guard.ts` 以 Vitest 静态检查 `packages/ui/src` 与 `apps/desktop/src/renderer` 中的 CSS 文件和 TSX（测试文件除外；TSX 经 TypeScript 语法树解析，忽略注释）。例外按文件、规则与匹配文本登记在同目录的 `style-guard-exceptions.ts`，失效的例外同样使测试失败；修改例外需在评审中说明原因。

| 守卫 | 拒绝的写法 |
| --- | --- |
| 颜色 | 主题样式表以外的字面量颜色、`--palette-*` 引用、任意颜色值、业务组件中的 `dark:` 变体 |
| 圆角 | 六档以外的 `rounded-*`、任意圆角值、未登记的 `--radius-*`、组件 CSS 中 4–99px 的字面圆角 |
| 圆角曲线 | 未使用 `rounded-round` 的全圆写法（`rounded-full`、50%、999px） |
| 材质与边框 | 中性边框与 elevation 阴影叠加；宽于 0.5px 的中性实线（虚线、状态色边框与登记的加载圈轨道除外） |
| 菜单 | 未经共享 Menu 或菜单表面渲染的菜单与 listbox；覆盖菜单背景或模糊；重新定义菜单 token |
| 状态 | 不在 `@media (hover: hover)` 内的手写 `:hover` |
| 滚动条与拖拽区 | 组件自定义滚动条选择器；交互控件落入窗口拖拽区 |
| 文案 | 未经 zh/en 字典的产品文案 |

按 [测试约定](testing.md#测试用例生成与维护)，每个守卫接入时先临时引入违规样例，确认因预期原因失败，再撤销样例。守卫只能拒绝档位外数值和未知 token，不能判断合法 token 是否适合该组件或两个轮廓是否真正对齐；这两点按 [界面约定](ui.md#ui-状态与验收) 在真实渲染中检查。
