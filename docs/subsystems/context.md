---
kind: reference
description: "当前的上下文管理契约：@ File Reference 的语法、展开与上限、Read 拒绝规则、文件候选接口、@ 文件菜单与引用 chip，以及输入区草稿的持久化。修改引用展开、文件候选、composer 的引用节点或草稿存储前查阅。"
lifecycle: active
---

# 上下文管理

本文说明 Coko 当前如何把用户显式引用的文件放进模型上下文，以及输入区草稿如何保存。目前覆盖 [File Reference](../../GLOSSARY.md) 与草稿持久化。命令展开排在 File Reference 之前，见 [命令](commands.md)；规则的判定见 [权限判定与审批](permissions.md)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/context/references/parse.ts` | `parseFileReferences`、`formatFileReferenceToken`：`@path` / `@"path"` 的语法 |
| `packages/agent/src/context/references/expand.ts` | `expandFileReferences`：读取、截断、上限与说明文本，生成 `<file_reference>` 块 |
| `packages/agent/src/context/references/search.ts` | `searchWorkspaceFiles`：@ 菜单的候选（复用 `tools/builtin/walk.ts`） |
| `packages/protocol/src/files.ts` | 块的开标签（`formatFileReferenceOpen`、识别函数 `fileReferencePath`）、`WorkspaceFilesResponse`、`filePaths` |
| `apps/server/src/application/context/references.ts` | 引用贡献的 `expandInput`（读取 `ContextScope.permissionRules`） |
| `apps/server/src/http/routes/files.ts` | `GET /api/workspaces/:id/files` |
| `packages/ui/src/composer/file-reference-node.ts` | composer 的 File Reference 节点 |
| `apps/desktop/src/renderer/features/conversation/file-menu.tsx` | @ 文件菜单 |
| `apps/desktop/src/renderer/stores/draft-store.ts`、`features/conversation/composer.tsx` | 草稿的存储与载入 |
| `apps/desktop/src/renderer/features/conversation/timeline.ts`、`timeline-view.tsx` | 用户消息的引用 chip |

## File Reference

### 语法

- `@path` 或 `@"path with space"`。`@` 必须在开头或空白之后，所以 `user@example.com`、`(@a.ts)`、`看看@a.ts` 都不是引用。
- 未加引号的路径在空白或中文全角标点（，。；：！？、）】」』》）处结束，结尾的 `. , ; : ! ? ' " ) ] } >` 不属于路径。加引号的路径原样保留。
- 路径相对 Workspace；也接受绝对路径与 `~/`。以 `/` 结尾或指向目录时按目录处理。
- 不存在的路径不产生块，`@someone` 这类提及原样留在文本中。同一个文件（按真实路径）只附一次。

### 展开

提交的文本与 Run 进行中的追加指令经上下文装配展开，顺序是命令、File Reference，所以模板展开后的文本中的引用同样生效。每个引用在同一条 user message 中追加一个文本块，块以 `<file_reference path="…">` 开头、`</file_reference>` 结尾；第一个块是原文。没有引用时 user message 只有原文。块不是独立的条目 kind。

| 情形 | 块的内容 |
| --- | --- |
| Workspace 内的文件 | 文件内容，按 read 截断：2000 行或 50KB，截断时注明显示的行与 `offset` |
| Workspace 内的目录 | ls 式列表：按名字排序、目录带 `/`，最多 200 项（注明未显示的数量）；被拒绝的项不列出并注明数量 |
| Read 拒绝规则覆盖 | `[Not attached: denied by permission rules.]` |
| Workspace 外（含经符号链接指向外部） | `[Not attached: the path is outside the Workspace.]` |
| 二进制（开头 8000 字节中有 NUL） | `[Not attached: binary file.]` |
| 第 11 个及之后的引用 | `[Not attached: at most 10 file references per message.]` |
| 合计内容已达 200KB | `[Not attached: file references in this message exceed 200KB in total.]`；接近上限的那个文件按剩余额度截断 |

开标签的 path：Workspace 内为相对路径（`/` 分隔，目录以 `/` 结尾），其外为输入的原文；按 XML 属性转义 `& " < >`。

### 权限

用户显式引用视为对该文件的读取授权：询问规则与模式不适用，Read 拒绝规则仍生效。生效的规则与运行时判定相同（Session、全局、Workspace 与 project 作用域），在展开时取用，由 SessionService 经 `ContextScope.permissionRules` 给出。不带内容的 Read 拒绝规则拒绝全部引用；带内容的按路径模式，对解析后的路径与真实路径都判定。

### 日志

Sidecar 记 `file references attached`：引用数、各状态的数量与截断数，不记路径与内容。

## 文件候选接口

`GET /api/workspaces/:id/files?query=&limit=` → `{ files: { path, kind: 'file' | 'directory' }[] }`。

- 遍历与内置 find / grep 相同：遵守 `.gitignore`、`.ignore`、`.rgignore`（含祖先目录直到仓库根），不含 `.git`，不跟随符号链接；只看前 20 000 项。
- 匹配不区分大小写，档位依次为路径前缀、文件名前缀、包含、子序列；同档按深度、再按路径排序。空查询按深度列出。以 `/` 结尾的查询列出该目录之下的项，不含目录本身。
- `limit` 为 1–50，缺省 50；不合法时 400，Workspace 不存在时 404。结果不按 Read 拒绝规则过滤（引用时才判定）。

## 界面

- **@ 文件菜单**：在词首（开头或空白之后）输入 `@` 时打开，查询为 `@` 之后、光标之前的非空白文本。每次查询变化向 Sidecar 请求候选，新结果到达前先显示上一次结果中按子序列匹配的项。Enter 或指针选择插入 File Reference 节点并跟一个空格；目录上按 Tab 把 token 替换为 `@目录/` 并继续列出其中的项。键盘、Esc、输入法与定位规则与 / 命令菜单相同（见 [命令](commands.md#界面)）。
- **File Reference 节点**：token 模式的文本节点，以小号链接色 chip 显示，作为整体选中与删除，不能在其中输入。文本即序列化形式 `@path`（含空白、全角标点或会被当作结尾标点的字符时为 `@"path"`），因此提交的文本就是 Sidecar 解析的语法。
- **引用 chip**：时间线中，用户消息的 `<file_reference>` 块不进入气泡文本，按出现顺序显示为气泡下方的文件或目录 chip；文件内容只发给模型。

## 草稿

- composer 的内容以 Lexical EditorState JSON 存 renderer 的 `localStorage`：会话为 `coko.draft.<sessionId>`，还没有会话的 Workspace 草稿为 `coko.draft.workspace.<workspaceId>`。用户编辑后 300 ms 防抖写入；切换会话与窗口关闭（`pagehide` / `beforeunload`）前立即写入；内容为空时删除该键。
- 切换会话或草稿时载入目标的草稿，撤销历史随之清空。读出的值不是 JSON、不是 EditorState 形状或含未知节点（例如 File Reference 节点没有 path）时删除该键、记 renderer warn `draft discarded`，输入区为空。
- 提交被接受后编辑区清空，草稿随之删除。提交等待期间切换到新会话（草稿发送时创建会话）时，编辑区内容不被替换，随作用域带到新键；提交被接受后提交时所属的键也被删除。
- composer 是纯文本编辑器，File Reference 是其中唯一的非文本节点，因此不需要 Markdown 导入导出。

## 验证

- `packages/agent/src/context/references/parse.test.ts`、`expand.test.ts`、`search.test.ts`：语法（引号、标点、邮箱等不误判）；截断、目录上限、10 个 / 200KB、拒绝规则、Workspace 外与二进制的说明；候选的忽略规则、排序与上限。
- `tests/integration/sidecar-references.test.ts`：真实 Sidecar 上的 user message 块与 faux requestLog、project 作用域的 Read 拒绝规则、命令与引用的顺序、`GET /api/workspaces/:id/files`。
- `packages/ui/src/composer/file-reference-node.browser.test.tsx`：节点的插入与整体删除、序列化、EditorState JSON 往返与拒绝、目录 Tab、onDraftChange。
- `apps/desktop/src/renderer/stores/draft-store.test.ts`、`features/conversation/timeline.test.ts`：草稿的键、防抖与损坏处理；引用 chip 的派生。
- `apps/desktop/e2e/references-drafts.e2e.test.ts`：Electron 中的 @ 菜单与 chip、草稿在切换会话与重启后保留、提交后清除、损坏的草稿。

## 延伸阅读

- [命令](commands.md)：输入展开的前一步与 typeahead 的通用规则。
- [权限判定与审批](permissions.md)：Read 拒绝规则与作用域。
- [界面约定](../tech-stack/ui.md)：composer 与草稿的技术约定。
