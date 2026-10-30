# 10: 整页设置

**What to build:** 设置从浮层弹窗改为占满窗口的整页，外壳按 Pencil 源稿画面 01：左侧 240px 设置导航（48px 窗口控制安全区、“返回应用”、“搜索设置…”与分类菜单），右侧居中、最宽 800px 的详情区。打开设置时会话侧栏与聊天区隐藏但不卸载；“返回应用”、Escape 与再次按 ⌘, 回到应用；按菜单项名称搜索过滤导航。现有分区内容、分区注册表、离开守卫与“去设置”等入口的行为不变。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md) 2.1（2026-10-30 修订）；视觉：Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 画面 01（外壳几何、颜色与位置；菜单项按规格 2.1 的规则）；界面约定 docs/tech-stack/ui.md 与 ui-design-system.md。

- [x] ⌘,、侧栏设置按钮、Toast“去设置”打开整页设置并定位到指定分区；会话侧栏与聊天区隐藏，返回后 composer 草稿、消息滚动位置保持，进行中的 Run 继续且返回后可见其结果
- [x] “返回应用”、Escape、再次按 ⌘, 回到应用；当前分区有未保存修改时先提示“放弃更改？”，取消则留在设置
- [x] 设置内的弹窗、菜单或确认框打开时，Escape 只关闭它，不离开设置；聊天区“Run 进行中按 Escape 停止”在设置打开时不触发
- [x] “搜索设置…”按菜单项名称过滤导航（当前语言与英文名称，不区分大小写），分类随之隐藏或显示，无匹配时显示空状态；清空后恢复；不搜索分区内设置项
- [x] 菜单分组、未交付项隐藏、关于在底部、空分类不显示标题与现在一致；当前项有选中态（aria-current）
- [x] 外壳几何与源稿一致：导航 240px、安全区 48px、返回行 H36、搜索框 H32/R12、菜单项 H32/R12、详情最宽 800px 居中；只用语义 token，明暗主题正确；窄窗口时导航与详情仍可用
- [x] 焦点管理：打开设置时焦点进入设置导航或详情，返回应用时回到打开前的元素；Tab 顺序与可访问名称完整（设置区域有 landmark 与标题）
- [x] 依赖弹窗角色的浏览器测试与 Electron E2E 改为新的定位方式并全部通过；当前行为文档（permissions、mcp 等）与源码注释中的“设置弹窗”同步改为“设置页”

## Comments

### 票 10 交付（ms/10-full-page-settings）

**覆盖的验收**

- 新增 `apps/desktop/src/renderer/features/settings/settings-page.browser.test.tsx`（9 个用例），逐项覆盖：
  - ⌘, 打开整页（region 占满窗口，不是 dialog）；应用 `invisible` + `inert`，不卸载；返回后 composer 草稿、消息滚动位置（scrollTop 40）、打开前的焦点都保持。
  - 侧栏设置按钮与 `open('models')` 定位到指定分区，当前项 `aria-current`。
  - 再次按 ⌘, 与 Escape 回到应用。
  - 有未保存修改时“返回应用”、Escape、⌘, 都先提示“放弃更改？”；确认框内的 Escape 只关闭确认框。
  - 设置内菜单打开时 Escape 只关菜单；设置打开时 Escape 不停止 Run，回到应用后 Run 仍在并可停止。
  - 搜索：当前语言与英文名称、不区分大小写；分类随之隐藏；无匹配时显示空状态，清空后恢复；不搜索分区内设置项与未交付项。
  - 几何（1440×960）：导航 240px、安全区 48px、返回行 H36、搜索框 H32/R12、菜单项 H32/R12、详情 800px 居中、上边距 72px。
  - 明暗主题；390px 窄窗口；landmark 与标题；Tab 顺序与焦点环。
- “去设置” Toast 入口没有新测试：`main.tsx` 的 `notifyFailure` 回调仍调用 `settingsPage.open('models')`，与侧栏入口走同一个 store 方法。
- 菜单分组、未交付项隐藏、关于在底部：沿用 `sections.browser.test.tsx`，只改了定位方式。
- 视觉：用临时截图对照 Pencil 画面 01，浅色、深色（1440×960）与 390px 窄窗口三张，截图未入库。

**实际运行的命令与结果（基于 model-service 727a605，无新提交需要合入）**

- `pnpm run typecheck`：通过。
- `pnpm exec oxlint apps/desktop packages/i18n`：0 warning，0 error。
- `oxfmt --check`：通过。
- `pnpm run check:docs`：132 个文件，0 个问题。
- `pnpm exec vitest run --project '!desktop-e2e'`：184 个文件，1406 个用例全部通过。与 desktop-e2e 同时运行时，`thinking-levels.browser.test.tsx` 的“连续添加七次”超时失败一次；之后单独运行 3 次、renderer 项目单独运行、全量单独运行都通过，判断为负载导致的超时，本票没有改动该文件的行为。
- `pnpm exec vitest run --project desktop-e2e`：23 个文件，54 个通过，1 个跳过（真实 DeepSeek，无密钥）。

**负向确认（变异后已恢复）**

- 去掉应用容器的 `inert`：打开/返回与可访问性两个用例失败。
- 去掉“设置打开时 Escape 返回应用”：Escape 相关的三个用例失败。
- 去掉返回后的焦点恢复：两个用例失败。
- 搜索只匹配当前语言：搜索用例失败。

**未验证**

- 没有在真实 Electron 窗口中目测 macOS 红绿灯与 48px 安全区的避让。E2E 只证明定位与行为，安全区行带 `data-window-drag`。

**取舍**

- 窄窗口（< 640px）时导航移到详情上方、菜单横排，分类标题只作分组的无障碍名称，沿用原弹窗的窄窗口做法。
- 打开设置时焦点进入导航的当前项（应用已 inert，焦点不能留在其中）。
- 搜索框中的 Escape 同样返回应用，不先清空搜索词。

**改名与共享文件**

- 文件改名：`app/settings-dialog-store.ts` → `settings-page-store.ts`；`features/settings/settings-dialog.tsx` → `settings-page.tsx`。
- API 改名：
  - store：`createSettingsPageStore` / `SettingsPageStore`，状态 `{ visible, section }`，方法 `open(section?)`、`back()`、`toggle()`、`setSection`、`setLeaveGuard`（守卫语义不变）。
  - React：hook `useSettingsPage()`，App prop `settingsPage`，`SettingsProvider` 的 `page`。
- 分区组件只改了 `SettingsCard` / `SettingsRow` 的导入路径；memory 与 permissions 分区另把注释中的“设置弹窗”改为“设置页”；models-section 改用 `useSettingsPage`。分区内容没有改动。
- i18n：删除 `settings.close`；新增 `settings.back`、`settings.search`、`settings.searchLabel`、`settings.searchEmpty`。
- 文档：`docs/subsystems/permissions.md`、`mcp.md` 中“设置弹窗”改为“设置页”；store 与分区源码注释同步。

### 供后续票

- 浏览器测试定位设置：`settingsRegion()`（`apps/desktop/src/renderer/testing/settings-page.ts`），即名为“设置 / Settings”的 region；CSS 选择器用 `[data-settings-page]`。E2E 用 `window.locator('[data-settings-page]')`。设置内的确认框与弹窗仍是独立的 `alertdialog` / `dialog`，在 `page` 上查询。
- 判断设置是否打开用 `settingsPage.getSnapshot().visible`；未打开时 region 不在文档中。
