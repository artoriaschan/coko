---
kind: evidence
description: "工具图片图库、实时结算、子 Session、位图来源约束与全屏预览的真实 App / Electron 验证。"
lifecycle: active
---

# 07 工具图片与预览验证

## 验证对象

- [规格](../spec.md)：AC-10、AC-11、AC-12、AC-24；[实施票](../issues/07-tool-images-and-preview.md)。
- 初始基线 `7610b5d0da2c2b1d0f7896b6c10cd1a58158cd7e`；首个实现 `55f60d4`；合入搜索详情 `694b27ed8fe56817fe821865676d742dc3f0da4e` 的本票合并提交 `adde7d9`。最终过程焦点锁集成与验证正在进行，本记录此时不表示票已关闭。
- 参考仓库 `/Users/artorias_chan/Workspaces/agent/deepseek-harness`，锁定提交 `8bd073392eef6f54e921a093b95076248eb08cbb`；未修改参考源，状态仍仅有既存未跟踪 `codebase-guide/`。
- macOS arm64；Node `26.10.0`、pnpm `12.15.0`、Vitest `5.0.3`、Electron `41.0.3`、agent-browser `0.38.2`。Browser Mode 真实无头 Chromium；手动 Electron 后台 CDP，显式 DPR 1；中文/英文、亮/暗主题、390px 与正常主内容。

## 来源与实现

参考使用真实 `ui-tool/src/client/tool/components/ToolRow.tsx` 的图片 slot、`ui-attachment/src/MessageImage.tsx` 的 `ImageGallery` / `MessageImage` 与 `ui-primitives/src/ImageLightbox.tsx`；原 CSS、图标 sprite、主题与字典保持原样。外部调用夹具位于 `/tmp/coko-conversation-detail/reference-gallery-07/`，图片是明确生成的 640 × 400 RGB PNG。Gallery 的授权加载回调由调用夹具提供；截图证明原始组件消费者的图廊/大图几何，不声称启动了参考完整 Host/Gateway 或执行了其 Run 生命周期。

真实来源规则：单图最长边 240px，比例 clamp 0.25—4、至少 44px 命中区；多图 64px 方块、10px gap、R20；元信息 11px/16px 代码字体，图廊下 4px。原图 layer 留 40px，原图最大宽 1600px，关闭控件 36px、距上/右 20px。图片描边亮色黑 10% / 暗色白 6%，原图/关闭控件底色亮白 / 暗 rgb(44 44 46)。Coko 缺少路径/原始尺寸/字节元数据时不补造，实际解码尺寸使用明确文案。

`ToolResultView.content` 只在 renderer 显示模型保留原始结果，不改变协议或持久化；主/子 Session 读取各自工具的结果。实时 partialResult、实时终态和已提交内容匹配同一调用；已提交空内容也有权威性。图片按规范化 data URL 与同源出现次序关联，新增文本不改变图片身份。没有新建 Blob URL，也没有分配/撤销 object URL 的生命周期；图片移除和组件卸载由 React 释放 data URL 引用、预览与交互锁。

## 执行记录

| 命令或步骤 | 实际范围与数量 | 结果 |
| --- | --- | --- |
| `rtk pnpm install --frozen-lockfile` | 本票隔离工作树依赖 | exit 0；Electron binary 未由安装步骤下载，单独修复见下 |
| `rtk pnpm run test apps/desktop/src/renderer/features/conversation/tool-card-images.browser.test.tsx`（首次） | 1 个 App 回归：partial 图片 | 1 failed，真实图库为空；实现后通过 |
| 同一图片测试，加入多图间距 | 3 tests | 2 failed：caption 把64px格子撑出 71px/34px 间距；移到图库下方后 3 passed |
| 同一图片测试，加入子 Session | 4 tests | 1 failed：主 Session 查询拿不到子图片；原始内容归属修复后通过 |
| 同一图片测试，加入精确视口边界 | 7 tests | 4 failed；实际 Electron 读回也暴露居中 translate/zoom 问题；局部高优先级、无进入缩放修复后 7 passed |
| `rtk pnpm run test apps/desktop/src/renderer/features/conversation/tool-card-images.browser.test.tsx apps/desktop/src/renderer/features/conversation/timeline.test.ts apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx apps/desktop/src/renderer/features/right-panel/agents-tab.browser.test.tsx packages/ui/src/guards/style-guard.test.ts` | 5 files / 72 tests | exit 0，72 passed（合06之前；最终变更另记） |
| `rtk pnpm run test apps/desktop/e2e/mcp-browser.e2e.test.ts` | 1 file / 1 test；真实 Electron、真实 Sidecar、仓库 stdio MCP 与 faux 模型 | exit 0，1 passed；160px 位图实际解码、Enter/Escape、关闭后焦点回到缩略图；New chat 以就绪 heading 等待，创建 Session 后才断言 ConnectionStatus |
| `rtk pnpm run test apps/desktop/src/renderer/features/conversation/tool-card-images.browser.test.tsx apps/desktop/src/renderer/features/conversation/structured-tool-details.browser.test.tsx apps/desktop/src/renderer/features/conversation/tool-rows.browser.test.tsx` | 合06后 3 files / 22 tests | exit 0，22 passed |
| `rtk pnpm run test packages/i18n/src/index.test.ts packages/i18n/src/domains.test.ts` | 2 files / 14 tests | exit 0，14 passed |
| `rtk pnpm run typecheck` | 全 workspace TypeScript 项目 | exit 0（合06后） |
| `rtk pnpm run check:docs` | 268 Markdown | exit 0，0问题（正式正文变更后；最终证据另记） |
| `rtk pnpm run build:desktop` | main/preload/Sidecar/renderer | 首次失败：Electron 安装缺 binary；`rtk proxy /Users/artorias_chan/.nvm/versions/node/v24.15.0/bin/node node_modules/electron/install.js` exit0 后构建 exit0；有既存大于500kB chunk提示 |

浏览器测试只替换协议外端的内存后端，真实 App、Chat Store、投影、工具卡、Radix modal、图片解码和布局均运行。覆盖：重复位图、不同数组对象、已提交前新增文本、同一 DOM image/preview、输入选区、空最终结果清除旧图、损坏 PNG、SVG、字符串 URL 与 URL 字段拒绝、四种主题/语言组合在390px、自然160×100的单图和只读子 Session。最终 Run 完成时的 scoped focus lock 检查等待03集成。

## 视觉、交互与清理

- 命名会话 `coko-gallery-reference-07` 用真实源组件；初步8张参考PNG和4份CSS几何记录在上述外部 harness。参考服务监听实际分配的52203端口，agent-browser close exit0，服务 Ctrl-C exit130、`lsof` 无监听；无参考源改动。
- 命名会话 `coko-gallery-electron-07` 经真实 Electron / Sidecar / 自有 stdio MCP 夹具返回两张640×400 PNG；主应用创建 Session 后 Connected、审批一次后工具完成。手动 Enter/Escape/关闭按钮和焦点恢复通过。初步截图因发现预览位移已作废，最终截图待重建后重拍。
- 初次手动实例在 E2E 重构建产物期间触发旧动态chunk找不到：这是同时覆盖dist造成的验证环境失效，不作产品失败/通过证据。关闭后在固定产物上重启。已关闭手动实例与对应 CDP 会话；`ps` 未发现本票 Electron、Sidecar、MCP 或参考服务器残留。最终实例将单独记录PID与退出证据。
- 仅静默CDP交互；没有占用前台、真实鼠标、拖拽导出或原生标题栏验证。

## 文档影响

| 内容 | 唯一正文与同步 | 读回 |
| --- | --- | --- |
| 工具图片来源、图库、尺寸、失败与预览 | `docs/subsystems/mcp.md` 原段落原地更新；`workbench.md` 加模块与MCP入口 | AGENTS → docs/README → 两正文可达；无正式到scratch反向依赖 |
| 局部描边/表面token与全屏几何 | `docs/tech-stack/ui-design-system.md` | 只登记对话图片消费者，不改变其他modal |
| tracker实施与验证 | 本证据与07 Comments | 最终交付后更新，仅本地提交；不代替集成、CI或发布 |

按 [生命周期流程](../../../docs/DOCUMENT_LIFECYCLE.md) 已读回：导航与生命周期保持active，正文权威归属不变；无替代/归档行为；相关术语、业务授权、用户消息附件与持久化格式保持原义。搜索词“工具结果中的图片 / 工具图片 / 图片预览 / mcp.image.open”命中原MCP正文、工作台、规格/07/13任务入口及真实消费者；正式引用继续有效，不迁移任务材料。

## 结论与限制

本票仍在最终03集成与截图复验阶段，尚不关闭。所有已列通过均为本地证据；没有真实模型、真实外部 Playwright MCP 服务、CI、推送、PR、发布或原生指针验证。参考是实际源组件消费者baseline，不冒称完整参考应用验收。
