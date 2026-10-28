# 依赖安装与运行可行性验证（本机实测）

## 结论摘要

1. 26 个指定包全部能从公司 Artifactory 解析和下载（共 734 个包，约 20 s），不需要 `NODE_TLS_REJECT_UNAUTHORIZED=0`。
2. 第一次 `pnpm install` 退出码为 1，报错 `ERR_PNPM_IGNORED_BUILDS`：pnpm 12 默认 `strictDepBuilds: true`，以下 4 个包的构建脚本未经审核：electron、koffi、protobufjs、@google/genai。
3. 只放行 `electron`、显式拒绝另外 3 个之后，安装退出码为 0。`node_modules/electron/dist/Electron.app` 生成成功，`--frozen-lockfile` 安装也是 0。
4. Electron 二进制直接从 GitHub Releases 下载（116 MB，约 68 s），本机不需要配置镜像。公司镜像 `mirrors.ops.ctripcorp.com` 上没有 electron，只有 `nodejs.org/dist`。`https://npmmirror.com/mirrors/electron/` 实测可以作为备用镜像。
5. 用 `ELECTRON_RUN_AS_NODE=1 <Electron> -e` 实测：`process.versions.node` 为 **24.14.0**，SQLite 为 3.51.2。`node:sqlite` 的 `:memory:` 建表、插入、查询都正常。会打印 `ExperimentalWarning`。
6. 两个进程同时对同一个文件 DB（WAL）执行 `BEGIN IMMEDIATE`：等待方 `timeout: 0` 时立即抛错（errcode 5，`database is locked`）；`timeout: 5000` 时等待约 2 s，持有方提交后获得锁。这个机制可以用来实现单写者互斥。
7. koffi 不需要运行安装脚本，它从 optional 依赖 `@koromix/koffi-darwin-arm64` 加载预编译的 `.node`，在 Electron-as-Node 和宿主 Node 下都能调用 `getpid()`。
8. @vscode/ripgrep 1.18.0 不再从 GitHub 下载二进制，没有 install 脚本。二进制由 optional 依赖 `@vscode/ripgrep-darwin-arm64` 通过 registry 提供（ripgrep 15.0.0，Mach-O arm64），不需要额外的环境变量或镜像。
9. Playwright 1.64.0 的 `playwright install chromium` 退出码为 0，从 `cdn.playwright.dev` 下载。Chromium 156.0.8078.4 能启动，`_electron.launch` 能拉起 Electron 41.0.3 窗口。如果环境里继承了 `ELECTRON_RUN_AS_NODE=1`，Electron 会启动失败。
10. 需要处理的问题：`allowBuilds` 要写 4 条；当前 Agent 宿主环境自带 `ELECTRON_RUN_AS_NODE=1`，安装和 GUI/E2E 测试前必须 unset；pnpm 12.11+ 会提示 `@logtape/logtape` 附带的 Agent skills 待审批（不阻塞安装）；tailwindcss 4 自身没有 CLI bin。

---

## 1. 环境与方法

| 项 | 值 | 来源 |
| --- | --- | --- |
| OS / 架构 | macOS 26.4 (25E246), arm64 | `sw_vers`、`uname -m` |
| 宿主 Node | v24.15.0（`~/.nvm/versions/node/v24.15.0/bin/node`），SQLite 3.51.3 | `node -v`、`process.versions.sqlite` |
| pnpm | 12.15.0（nvm 全局安装，非 corepack） | `pnpm -v` |
| registry | `https://artifactory.release.ctripcorp.com/artifactory/api/npm/trip-npm-prod/`，`strict-ssl=false`，`disturl=http://mirrors.ops.ctripcorp.com/nodejs.org/dist` | `~/.npmrc`（认证字段已脱敏，未记录） |
| `~/.npmrc` 里的 electron_mirror | **没有** | 同上 |
| pnpm store | `/Users/chenzheng/Library/pnpm/store/v11` | install 输出 |
| 继承的环境变量 | `ELECTRON_RUN_AS_NODE=1`（来自当前 Agent 宿主进程） | `env` |
| 临时目录 | `/tmp/coko-depcheck.U68R9F`（解析为 `/private/tmp/...`），验证后已删除 | `mktemp -d`、`pwd -P` |

测试在仓库外的临时目录进行。`package.json` 用精确版本列出题目给的 26 个依赖。`pnpm-workspace.yaml` 沿用仓库现有设置（`nodeLinker: hoisted`、`autoInstallPeers: false`、`saveExact: true`，以及 pi/typebox overrides，见 `/Users/chenzheng/Desktop/Work/person/coko/pnpm-workspace.yaml`）。为了确认是否真的发生下载，Electron 和 Playwright 的缓存被重定向到临时目录：

```bash
unset ELECTRON_RUN_AS_NODE
export electron_config_cache=$T/.electron-cache PLAYWRIGHT_BROWSERS_PATH=$T/.pw-browsers
```

> 注：仓库根目录已有 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 和 `node_modules`（`/Users/chenzheng/Desktop/Work/person/coko/package.json`，只有 devDependencies：typescript、vite、vitest 等），所以仓库已经不止有文档。本次测试没有改动这些文件。

## 2. 安装结果

### 2.1 命令与退出码

| # | 命令 | 退出码 | 耗时 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | `pnpm install --reporter=append-only`（不写 allowBuilds） | **1** | 19.6 s | 26 个直接依赖全部解析，共 734 个包；报错 `ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: @google/genai@2.21.0, electron@41.0.3, koffi@3.3.1, protobufjs@7.6.6` |
| 2 | 同上，加上 §4 的 `allowBuilds` | **0** | 68.6 s | `node_modules/electron postinstall$ node install.js … Done` |
| 3 | `pnpm install --frozen-lockfile` | **0** | 55 ms | `Lockfile is up to date` |
| 4 | `pnpm peers check` | — | — | 缺 peer `vite`（@tailwindcss/vite 4.3.3 要求 `^5.2.0 \|\| ^6 \|\| ^7 \|\| ^8`）和 `vitest 5.0.3`（@vitest/browser-playwright、@vitest/browser、@vitest/ui 要求）。临时项目没有声明这两个包，所以缺失是预期结果；正式工程在 `autoInstallPeers: false` 下必须显式声明 |

`NODE_TLS_REJECT_UNAUTHORIZED=0` 没有用到。安装期间只出现一条警告：`Request took 10052ms: …/trip-npm-prod/playwright`（metadata 请求慢，但没有失败）。另有一条弃用提示：`boolean@3.2.0, node-domexception@1.0.0`（都是传递依赖）。

### 2.2 逐包结果

| 包 | 版本 | 解析 | 安装/运行验证 |
| --- | --- | --- | --- |
| electron | 41.0.3 | ✅ | 需要 postinstall 下载二进制，§3 |
| @electron-forge/cli | 8.0.1 | ✅ | `pnpm exec electron-forge --version` → `8.0.1`，exit 0 |
| @electron-forge/plugin-fuses | 8.0.1 | ✅ | ESM import 成功 |
| @electron/fuses | 2.1.3 | ✅ | ESM import 成功 |
| tsdown | 0.22.2 | ✅ | `tsdown/0.22.2 darwin-arm64 node-v24.15.0`，exit 0；原生绑定 `@rolldown/binding-darwin-arm64@1.1.5` 来自 optional 依赖 |
| @earendil-works/pi-agent-core | 1.4.0 | ✅ | 在 Electron-as-Node 下 import 成功 |
| @earendil-works/pi-ai | 1.4.0 | ✅ | 同上；它带入了 `@google/genai@2.21.0` 和 `protobufjs@7.6.6`（`pnpm why`） |
| @earendil-works/pi-mcp | 1.4.0 | ✅ | 同上 |
| typebox | 1.3.27 | ✅ | 同上 |
| hono / @hono/node-server / ws | 4.13.12 / 2.1.5 / 8.22.0 | ✅ | 同上 |
| effect | 4.0.2 | ✅ | 同上（tarball 8.97 MB） |
| react / react-dom | 19.3.0 | ✅ | 同上 |
| tailwindcss / @tailwindcss/vite | 4.3.3 | ✅ | ESM import 成功；`@tailwindcss/oxide-darwin-arm64` 来自 optional 依赖，`Scanner` 可以加载。`pnpm exec tailwindcss` 失败（`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`），因为 v4 的主包没有 bin。项目走 Vite 插件，不受影响 |
| lexical | 0.52.0 | ✅ | ESM import 成功 |
| streamdown | 2.7.1 | ✅ | ESM import 成功；只提供 ESM exports，`require.resolve` 会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`，属于正常行为 |
| zustand | 5.0.15 | ✅ | 在 Electron-as-Node 下 import 成功 |
| @logtape/logtape | 2.4.2 | ✅ | import 成功；pnpm 提示 “Agent skills awaiting approval”，§4.2 |
| @vscode/ripgrep | 1.18.0 | ✅ | §5 |
| koffi | 3.3.1 | ✅ | §6 |
| shadcn | 4.21.4 | ✅ | `--version` → `4.21.4`；`https://ui.shadcn.com/r/index.json` 返回 HTTP 200 |
| @vitest/browser-playwright | 5.0.3 | ✅ | 只装上了包；peer `vitest` 没声明，所以没有运行 |
| playwright | 1.64.0 | ✅ | `Version 1.64.0`；浏览器安装见 §7 |

没有解析失败的包。

## 3. Electron 二进制下载

| 检查 | 结果 |
| --- | --- |
| `node_modules/electron/dist` | 存在：`Electron.app`、`LICENSE`、`LICENSES.chromium.html`、`version`；`path.txt` = `Electron.app/Contents/MacOS/Electron` |
| 下载器 | `electron/install.js` 调用 `@electron/get`（实测 5.1.0）的 `downloadArtifact`。`install.js:14` 设置 `ELECTRON_SKIP_BINARY_DOWNLOAD` 时跳过下载；`install.js:47` 默认用包内 `checksums.json` 校验，设置 `electron_use_remote_checksums` 时改用远端校验 |
| 默认源 | `@electron/get/dist/artifact-utils.js:2`：`BASE_URL = 'https://github.com/electron/electron/releases/download/'` |
| 实际源 | 缓存目录名 `fef4e930…c83f` 等于 `sha256("https://github.com/electron/electron/releases/download/v41.0.3")`（本机 `shasum -a 256` 复算一致），说明是从 GitHub 下载的。zip 大小 116,186,316 B |
| GitHub 可达性 | `curl -L …/v41.0.3/SHASUMS256.txt` → 200，跳转到 `release-assets.githubusercontent.com`，1.77 s |
| 公司镜像 | `http://mirrors.ops.ctripcorp.com/`：首页 200，但目录里没有 electron；`electron/41.0.3/…`、`electron/`、`npm/electron/…`、`github/electron/` 全部 404；只有 `nodejs.org/dist/v24.14.0/` 返回 200 |
| 备用镜像 | `https://npmmirror.com/mirrors/electron/41.0.3/SHASUMS256.txt` → 200（跳转到 `cdn.npmmirror.com`）。直接调用 `downloadArtifact({version:'41.0.3', platform:'darwin', arch:'arm64', checksums: require('electron/checksums.json'), mirrorOptions:{mirror:'https://npmmirror.com/mirrors/electron/'}})` → **OK，60.9 s**，下载内容通过了包内校验和 |

结论：本机不需要 `ELECTRON_MIRROR`。如果 CI 或其他机器访问不了 GitHub，可以用：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install
```

包内 `checksums.json` 照样会校验下载内容。它是外部公共镜像，是否允许使用需要公司确认。

## 4. pnpm 构建与权限设置

### 4.1 `allowBuilds`（pnpm-workspace.yaml）

依据是 pnpm 文档：`strictDepBuilds` 默认为 `true`，有未审核的构建脚本时安装以非零码退出；`allowBuilds` 用 `true`/`false` 显式放行或拒绝（[pnpm build settings](https://pnpm.io/settings/build)）。

| 包 | 脚本（tarball `package.json`） | 作用 | 建议 |
| --- | --- | --- | --- |
| electron@41.0.3 | `postinstall: node install.js` | 下载 Electron 二进制 | **true**（必须） |
| koffi@3.3.1 | `install: node ./cnoke.cjs -P . -D src/koffi --prebuild --release` | 预编译/源码构建；实际加载走 optional 依赖 `@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node` | **false**（已验证不需要，§6） |
| protobufjs@7.6.6 | `postinstall: node scripts/postinstall` | 只检查依赖方的 `versionScheme` 并打印警告（`scripts/postinstall.js`） | **false** |
| @google/genai@2.21.0 | `preinstall: echo 'preinstall: no-op'` | 空操作 | **false** |

```yaml
allowBuilds:
  electron: true
  koffi: false
  protobufjs: false
  '@google/genai': false
```

用这份配置后安装和 `--frozen-lockfile` 的退出码都是 0。注意：这只覆盖本次 26 个包形成的依赖图。加入 Vite 8.3.1、Vitest 5.0.3、Forge makers、`@electron-forge/plugin-auto-unpack-natives`、oxlint 等剩余依赖后，可能出现新的构建脚本，到时 `strictDepBuilds` 会让安装失败并列出这些包，再按同样方法逐个判断。

### 4.2 Agent skills 提示

每次安装都会输出 `Agent skills awaiting approval: @logtape/logtape. Run "pnpm approve" to review them.`，退出码不受影响。按 pnpm 文档，这是 v12.11.0 新增的 `permissions.<pkg>.skills` 和 `skills.dirs`：批准后，pnpm 会把包里附带的 skills 链接到项目的 Agent skill 目录；`false` 表示记录拒绝，以后不再询问（[pnpm build settings › permissions](https://pnpm.io/settings/build)）。项目需要决定是否接受第三方包向 `.agents/` 等目录注入 skills，例如：

```yaml
permissions:
  '@logtape/logtape':
    skills: false
```

文档还说明：文件里已经有 `permissions` 设置时，`pnpm approve` 会把构建决定写进 `permissions`，而不是 `allowBuilds`，而且同一个包的 `permissions` 优先级高于 `allowBuilds`。两种写法应只选一种。

## 5. @vscode/ripgrep

| 检查 | 结果 |
| --- | --- |
| 安装脚本 | 1.18.0 的 `package.json` **没有** install/postinstall |
| 二进制来源 | `optionalDependencies` 列出 12 个平台包（`@vscode/ripgrep-darwin-arm64` 等，都是 1.18.0），本机只装了 `@vscode/ripgrep-darwin-arm64`，通过 Artifactory 获取 |
| 路径解析 | `@vscode/ripgrep/lib/index.js`：`` platformPkg = `@vscode/ripgrep-${process.platform}-${arch}` ``，其中 `arch = process.env.npm_config_arch \|\| process.arch`，再 `require.resolve(${platformPkg}/bin/rg)`；找不到时抛出 `Could not find …` |
| `rgPath` | `node_modules/@vscode/ripgrep-darwin-arm64/bin/rg`（Mach-O 64-bit arm64） |
| 运行 | `rg --version` → `ripgrep 15.0.0 (rev 3a612f88b8)`，+pcre2，NEON；`rg -c dependencies package.json` → 1，exit 0 |
| 需要的环境/镜像 | 无。不访问 GitHub，所以不需要 `GITHUB_TOKEN` 或下载镜像 |

注意：`npm_config_arch` 会影响 `rgPath` 的解析。打包 universal 或 x64 版本时，需要让对应的平台包被安装（pnpm `supportedArchitectures`）。这一点没有实测。

## 6. koffi

| 检查 | 结果 |
| --- | --- |
| 构建脚本 | 在 `allowBuilds: false` 下没有运行 |
| 预编译文件 | `node_modules/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node`（optional 依赖） |
| 宿主 Node 24.15.0 | `koffi.load('libc.dylib').func('int getpid()')() === process.pid` → `true`，`koffi.version` = 3.3.1 |
| Electron-as-Node（Node 24.14.0，ABI `modules: 145`） | 同上，`true` |

没有测试：asar 打包后由 `plugin-auto-unpack-natives` 解包加载，以及在 Electron main（非 RunAsNode）进程中加载。

## 7. Playwright 浏览器

| 检查 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 浏览器清单 | `playwright-core/browsers.json` | — | chromium rev 1248 / 156.0.8078.4，chromium-headless-shell 1248，ffmpeg 1013 |
| 安装 | `PLAYWRIGHT_BROWSERS_PATH=$T/.pw-browsers pnpm exec playwright install chromium` | **0** | 2 m 50 s；从 `https://cdn.playwright.dev/builds/cft/156.0.8078.4/mac-arm64/…` 下载；生成 `chromium-1248`、`chromium_headless_shell-1248`、`ffmpeg-1013`，共 573 MB |
| Chromium 启动 | `chromium.launch()` → `setContent` → `textContent` | **0** | `ok`，`156.0.8078.4` |
| Electron 启动 | `_electron.launch({args:['e-main.cjs'], executablePath: require('electron')})` | **0** | `firstWindow().title()` = `coko-ok`，`process.versions.electron` = `41.0.3` |
| 继承 `ELECTRON_RUN_AS_NODE=1` 后启动 Electron | 同上 | **1** | `Error: Process failed to launch!` |

可选的下载源变量：playwright-core 代码里有 `PLAYWRIGHT_DOWNLOAD_HOST`（`playwright-core/lib/coreBundle.js:35019`），本机不需要。全局缓存 `~/Library/Caches/ms-playwright` 里已经有 `chromium_headless_shell-1248` 和 `ffmpeg-1013`（之前安装留下的，可复用）。

## 8. node:sqlite（Electron 41.0.3 内置 Node）

Electron 可执行文件：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`

| 测试 | 命令 | 退出码 | 输出 |
| --- | --- | --- | --- |
| 版本 | `ELECTRON_RUN_AS_NODE=1 $E sqlite-mem.mjs` | 0 | `{"node":"24.14.0","electron":"41.0.3","sqlite":"3.51.2","v8":"14.6.650202-electron.0","modules":"145"}` |
| `:memory:` | 同上：`new DatabaseSync(':memory:')` → `CREATE TABLE` → `prepare().run()` → `all()` | 0 | `[{"id":1,"v":"hello"}]` |
| `-e` 形式 | `ELECTRON_RUN_AS_NODE=1 $E -e "const {DatabaseSync}=require('node:sqlite'); … console.log(process.versions.node, …get())"` | 0 | `24.14.0 {"x":42}` |
| 两进程互斥，等待方 timeout 0 | 持有方 `BEGIN IMMEDIATE` 后保持 3 s；1 s 后启动等待方 `new DatabaseSync(file,{timeout:0})` → `BEGIN IMMEDIATE` | 0/0 | 等待方：`code: ERR_SQLITE_ERROR, errcode: 5, errstr: "database is locked"`，`waitedMs: 0` |
| 两进程互斥，等待方 timeout 5000 | 同上，等待方 `{timeout:5000}` | 0/0 | 持有方 commit 后，等待方 `acquired: true, waitedMs: 2024` |
| 结果核对 | 第三个进程 `SELECT * FROM lock` | 0 | 3 行，分别是两个持有方和成功的等待方；失败的等待方没有写入 |

两个进程都在打开连接后执行 `PRAGMA journal_mode=WAL`。每个进程都向 stderr 输出一次 `ExperimentalWarning: SQLite is an experimental feature`，sidecar 日志需要考虑过滤或接受这条输出。锁冲突的错误码是 `ERR_SQLITE_ERROR`，判断条件应使用 `errcode === 5`（SQLITE_BUSY）。

宿主 Node 24.15.0 的 SQLite 是 3.51.3，与 Electron 内的 3.51.2 不同。如果测试直接在宿主 Node 下跑 `node:sqlite`，结果不能代表产品运行时，这与 `/Users/chenzheng/Desktop/Work/person/coko/docs/tech-stack/architecture.md:107` 要求用 `ELECTRON_RUN_AS_NODE` 启动真实 sidecar 的约定一致。

## 9. 风险与对现有文档的影响

| 发现 | 影响 | 涉及文档 |
| --- | --- | --- |
| 当前 Agent 宿主进程注入了 `ELECTRON_RUN_AS_NODE=1` | 不 unset 时，Playwright 启动 Electron 会失败；`electron-forge start` 很可能也会受影响（未测）。测试 harness 和脚本应在启动 GUI Electron 时显式删除该变量，只在 sidecar 子进程上设置 | `docs/tech-stack/testing.md`（未读，建议补充） |
| 必须写 4 条 `allowBuilds` | `TECH_STACK.md:173` 只举了 electron 一个例子；其余 3 条要显式写 `false`，否则在 `strictDepBuilds` 下安装失败 | `/Users/chenzheng/Desktop/Work/person/coko/docs/TECH_STACK.md:173` |
| `@google/genai` 和 `protobufjs` 由 pi-ai 1.4.0 带入 | 增加约 40 个以上的传递依赖，体积也随之增加；需要时可以评估是否只按需加载 provider | `/Users/chenzheng/Desktop/Work/person/coko/docs/TECH_STACK.md:36` |
| ripgrep 1.18.0 使用平台 optional 包 | 目前的写法正确，`TECH_STACK.md:46` 已经写了 `@vscode/ripgrep-darwin-arm64 1.18.0`；不需要 GitHub 下载配置 | `/Users/chenzheng/Desktop/Work/person/coko/docs/TECH_STACK.md:46` |
| koffi 不需要放行构建 | 原生依赖不依赖本机编译工具链 | `/Users/chenzheng/Desktop/Work/person/coko/docs/TECH_STACK.md:101` |
| Electron 内置 Node 版本 | 实测 24.14.0，与 `TECH_STACK.md:25,70` 一致 | `/Users/chenzheng/Desktop/Work/person/coko/docs/TECH_STACK.md:25` |
| pnpm Agent skills 审批 | 需要决定 `permissions.<pkg>.skills` 的策略，避免第三方 skills 被链接进 `.agents/` | 新事项 |
| 磁盘 | node_modules 669 MB；Electron zip 缓存 112 MB/份；Playwright 浏览器 573 MB | — |

### 未验证的范围

`electron-forge package/make`、Fuses 翻转、tsdown/Vite 实际构建、Vitest Browser Mode 运行（缺 vitest/vite peer）、asar 中的原生模块、x64/universal 架构、Windows/Linux。

## 10. 资料来源

- 本机实测：临时目录 `/tmp/coko-depcheck.U68R9F` 中的 tarball 文件（包内相对路径见正文：`electron/install.js`、`@electron/get/dist/artifact-utils.js`、`@vscode/ripgrep/lib/index.js`、`protobufjs/scripts/postinstall.js`、`playwright-core/browsers.json`、`playwright-core/lib/coreBundle.js`）。验证后目录已删除，可以用 §1 的命令重现。
- pnpm 构建设置：<https://pnpm.io/settings/build>（`strictDepBuilds`、`allowBuilds`、`permissions`、`skills.dirs`、`dangerouslyAllowAllBuilds`）
- 项目约定：`/Users/chenzheng/Desktop/Work/person/coko/docs/TECH_STACK.md`、`/Users/chenzheng/Desktop/Work/person/coko/docs/tech-stack/architecture.md`、`/Users/chenzheng/Desktop/Work/person/coko/docs/tech-stack/agent-runtime.md`、`/Users/chenzheng/Desktop/Work/person/coko/pnpm-workspace.yaml`
