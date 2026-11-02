# 19: 图片附件

**What to build:** 附件按钮、粘贴与拖入都可以添加图片；只有当前模型的输入类型包含“图片”时才能添加，不支持时拒绝并说明原因。只有图片、没有文字也能发送，此时新对话的标题为“附件：”加文件名。图片作为内容块进入用户消息条目并发给模型，时间线中的用户消息显示图片；单张图片的上限沿用 read 工具读取图片的上限，超过时拒绝。服务端同样校验模型的输入类型，不依赖 renderer。草稿中的图片存入 IndexedDB，草稿只记引用：切走或重启后恢复，首次发送成功后清空。草稿已有图片时切到不支持图片的模型，发送会被拒绝并说明原因，图片不被静默丢弃。已有对话与新对话都适用。

- 行为依据：[规格](../spec.md) NEW-07、NEW-08（只有附件也可以发送）、CHAT-18 的附件标题、17.3 提交消息、17.4 界面本地状态。

**User stories:** 44（图片部分）

**Blocked by:** 03、11

**Status:** ready-for-agent

**Write scope:** packages/protocol 的提交消息与首次发送请求（图片，文字可为空）；apps/server 的提交与首次发送接受图片、写入条目、模型能力校验，以及只有图片时的标题；packages/agent 把图片块传给模型；renderer 附件处理的图片分支、模型能力检查、草稿图片存储与时间线中用户消息的图片显示；i18n；workbench.md 的附件一节。

**跨票接口：** 附件处理由 03 提供，本票实现图片分支；新对话草稿 store 由 11 提供，本票加图片引用；首次发送请求由本票加图片字段。

- [x] Sidecar 协议：只有图片的消息被接受，条目中有图片内容块，faux requestLog 中实际发给模型的消息带图片；超过上限被拒绝；模型不支持图片输入时被拒绝；只有图片的首次发送，标题为“附件：”加文件名（CW-63）。
- [x] Browser Mode：选择、粘贴与拖入图片；不支持的模型拒绝并说明原因；草稿图片在切换会话与重新挂载后恢复，发送成功后清空；草稿有图片时切到不支持的模型，发送被拒绝且图片保留。
- [x] Electron E2E：在支持图片的模型下只发一张图片，时间线显示该图片；重启后草稿中的图片仍在。
- [x] 文档按 Write scope 更新；`check:docs` 通过。


**Closed: true**

## Comments

### 2026-11-03 实施与验证

基于已交付 03 / 11 的集成点 `defd472` 实施；使用规格第 18 节已批准的真实 Sidecar 协议、Browser Mode 与真实 Electron 接口作为测试 seam。使用 TDD、coko-docs、coko-verify 和 Impeccable，未重新申请测试 seam。

- 首次发送与已有 Session 提交都增加 `images`（文件名、raster MIME、base64），允许只有图片而文字为空；两者都在消息与 Run 产生前由 Sidecar 校验解析后的模型输入能力与图片字节。复用 Agent read 的 `MAX_IMAGE_BYTES` / `detectImageMimeType`，单张 4.5 × 1024 × 1024 字节，协议与 renderer 同步该上限。Agent 已有 RunInput.content 通道负责把图片块送给模型，本票没有另造消息类型。只有图片时标题为“附件：”加文件名；图片与 File Reference 混合时一起用于附件标题。
- renderer 的原选择 / 粘贴 / 拖入入口实现图片分支；不支持的模型明确拒绝添加，已有图片切换到不支持模型时拒绝发送并保留图片。只有图片可用 Enter 或发送按钮提交；原文字 Enter、IME、追加指令与 File Reference 行为保留。当前 Run 进行中仍只接收文字追加指令，带图片时明确提示等待运行结束，附件不丢弃；动作命令带图片拒绝，避免忽略图片。
- 图片草稿 bytes 只进入 IndexedDB `coko.image-drafts`；新对话 store 增加 imageRefs，已有 Session 的 `<draft key>.images` 只保存不透明引用，不把图片嵌入 localStorage 或 EditorState。切换作用域或重新挂载加载所属图片，恢复期间等待完成才允许发送，避免文字先于图片发送。发送失败保持文字和附件；接受后清除本次图片引用与 bytes。时间线按 raster MIME / base64 渲染用户图片。
- 原生桥增加 `readPickedImage`：主窗口主框架校验，且只允许系统选择器本次窗口已经选出的路径，stat 与有界读取均限制 4.5 MB；不开放任意路径读取。浏览器 File 粘贴 / 拖入直接读 File bytes，不要求图片有磁盘路径。真实 Electron 测试同时检查未选择路径拒绝、超大图片反馈、当前构建 preload→main→renderer 路径。
- TDD 红灯：Sidecar image-only firstSend 在实现前因 400 而非 201 失败；Browser 新图片草稿测试在实现前因找不到 pixel.png、旧“图片尚不可用”反馈失败。接入后变绿，随后补齐选择 / 拖入、超限、失败保留和原生重启证据。

实际验证命令与范围：

- `pnpm run test tests/integration/sidecar-images.test.ts apps/server/src/application/providers.test.ts packages/agent/src/tools/builtin/file-tools.test.ts apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：退出 0，5 文件 / 81 用例通过。包含 Sidecar 3 场景：image-only 接受、用户条目图片块与 faux requestLog 实际图片；支持图片模型的非法内容 / 超限拒绝；不支持图片模型在首次发送与已有 Session 都拒绝且不写消息 / Run。
- `pnpm run test apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx`：退出 0，12 用例通过，补充选择、粘贴、拖入、删除、4.5 MB、失败保留和仅引用持久化。
- `pnpm run test tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-images.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts apps/desktop/src/renderer/stores/chat-store-permissions.test.ts apps/desktop/src/renderer/features/conversation/timeline.test.ts packages/agent/src/tools/builtin/read.test.ts packages/protocol/src/providers.test.ts`：退出 0，实际选中 6 文件 / 50 用例。read.test.ts 不存在，因此未选中；read 的真实回归随后通过上面的 file-tools.test.ts 执行，未把未选中路径当通过。
- `pnpm run test apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx packages/ui/src/composer/composer-editor.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：退出 0，5 文件 / 88 用例通过。
- `pnpm run test apps/desktop/e2e/images.e2e.test.ts apps/desktop/e2e/first-send.e2e.test.ts`：退出 0，真实 Electron / 当前构建 2 文件 / 3 用例通过。实际系统选择路径的有界读取；新对话图片草稿重启恢复、image-only 首次发送、标题、时间线图片 naturalWidth=1；已有 Session 图片草稿重启恢复与再次发送、接受后清空；独立首次发送文字 / 权限 / 模型 / 档位原回归。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs`（246 Markdown / 0 问题）、`git diff --check`：退出 0。Impeccable detector `[]`；查看真实 Electron 的 1100px 浅色与 390px 深色截图，缩略图 / 删除按钮 / 工具栏可达，无横向溢出；白色测试图片在浅色中加共享发丝线显示边界。

文档归属与读回：更新 workbench.md 的首次发送、单份草稿、主输入区与附件正文，以及 docs/README.md 的导航摘要。搜索“图片当前”“图片拒绝”“不把文件内容经 IPC”“只有 File Reference”消费者：当前 workbench 说明已同步；其他子系统中对各自图片能力的描述未改动。按 AGENTS → docs/README → workbench.md 读回，路径、语义、权威、引用方向、生命周期、当前入口与历史保留通过，没有正式正文依赖具体任务材料。

未验证真实外部模型、发布构建或 CI；faux 请求观察、Browser Mode 与真实 Electron 的范围分别如上。仅本地提交，不推送。
