import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { createFixtureDir, electronPath, placeholderSidecarEntry, processExists, readFixtureEvents } from '../tests/sidecar-fixture.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
/** 与 electron-forge start 一致：以包目录启动，package.json 的 main 指向 dist/electron/main.cjs。 */
export const mainEntry = desktopRoot
/** globalSetup 构建的真实 Sidecar（apps/server）产物。 */
export const realSidecarEntry = join(desktopRoot, 'dist', 'sidecar', 'index.mjs')

export interface LaunchOptions {
  /** real：随应用构建的真实 Sidecar（默认）；placeholder：可观测认证细节的占位 Sidecar（只用于壳层测试）。 */
  sidecar?: 'real' | 'placeholder'
  /** 复用已有的测试目录（重启场景）；由创建它的一方负责清理。 */
  dir?: string
}

export interface LaunchedApp {
  readonly app: ElectronApplication
  readonly window: Page
  readonly dir: string
  readonly eventsPath: string
  readonly env: Record<string, string>
  /** 占位 sidecar 写下的事件。 */
  events(): ReturnType<typeof readFixtureEvents>
  /** 已 spawn 的 sidecar 进程号。 */
  sidecarPids(): Promise<number[]>
  /** 关闭应用并确认 Electron 与 sidecar 进程都已退出；超时则强制结束。不删除复用的目录。 */
  dispose(): Promise<void>
}

/** 宿主可能带有的真实模型凭据；测试只用 faux provider，不向应用传递它们。 */
const CREDENTIAL_ENV =
  /^(?:COKO_CREDENTIAL_|DEEPSEEK_API_KEY$|OPENAI_API_KEY$|ANTHROPIC_API_KEY$|COKO_SIDECAR_ENTRY$|COKO_RIPGREP_PATH$|COKO_FAUX_SCRIPT$|COKO_HOME$|ELECTRON_RUN_AS_NODE$)/

/** 测试目录下的临时用户级资源目录（经 COKO_HOME 传给 Sidecar；测试不读写真实的 ~/.coko）。 */
export const cokoHomeOf = (dir: string) => join(dir, 'coko-home')

/** 在测试目录的 COKO_HOME 下写文件（相对路径，父目录按需创建），返回绝对路径。 */
export async function writeCokoHome(dir: string, relative: string, content: string): Promise<string> {
  const path = join(cokoHomeOf(dir), relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
  return path
}

/**
 * 后台模式（main 的 e2e-background.ts）：窗口不激活、不抢焦点、不显示 Dock 图标，仍在真实 Electron 中渲染。
 * 本地调试需要看到窗口时设置 COKO_E2E_VISIBLE=1（宿主环境原样传给应用）。
 */
export const BACKGROUND_ENV = { COKO_E2E_BACKGROUND: '1' } as const

/** 测试环境：去掉 ELECTRON_RUN_AS_NODE 与凭据变量，使用独立 userData 与临时 COKO_HOME，默认后台模式。 */
function testEnv(extra: Record<string, string>, dir: string, eventsPath: string, sidecar: 'real' | 'placeholder'): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !CREDENTIAL_ENV.test(key)) env[key] = value
  return {
    ...env,
    ...BACKGROUND_ENV,
    COKO_USER_DATA_DIR: join(dir, 'user-data'),
    COKO_HOME: cokoHomeOf(dir),
    ...(sidecar === 'placeholder' ? { COKO_SIDECAR_ENTRY: placeholderSidecarEntry, COKO_FIXTURE_EVENTS: eventsPath } : {}),
    ...extra,
  }
}

/** 真实 Sidecar 是 Electron 进程以 ELECTRON_RUN_AS_NODE 启动的子进程，按父进程与入口识别。 */
function childSidecarPids(parentPid: number): number[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
  return out
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && Number(m[2]) === parentPid && m[3]!.includes(realSidecarEntry))
    .map((m) => Number(m[1]))
}

export async function launchApp(extra: Record<string, string> = {}, options: LaunchOptions = {}): Promise<LaunchedApp> {
  const sidecar = options.sidecar ?? 'real'
  const fixture =
    options.dir === undefined ? await createFixtureDir() : { dir: options.dir, eventsPath: join(options.dir, 'events.jsonl'), dispose: async () => {} }
  const env = testEnv(extra, fixture.dir, fixture.eventsPath, sidecar)
  const app = await _electron.launch({ executablePath: electronPath, args: [mainEntry], env })
  // 应用关闭后 process() 不再可用，启动时记录。
  const electronPid = app.process().pid
  const seen = new Set<number>()
  const sidecarPids = async () => {
    if (sidecar === 'placeholder') return (await readFixtureEvents(fixture.eventsPath)).filter((e) => e.event === 'spawned').map((e) => e.pid)
    if (electronPid !== undefined && processExists(electronPid)) for (const pid of childSidecarPids(electronPid)) seen.add(pid)
    return [...seen]
  }
  let disposed = false
  const launched: LaunchedApp = {
    app,
    window: await app.firstWindow(),
    dir: fixture.dir,
    eventsPath: fixture.eventsPath,
    env,
    events: () => readFixtureEvents(fixture.eventsPath),
    sidecarPids,
    dispose: async () => {
      if (disposed) return
      disposed = true
      await sidecarPids().catch(() => [])
      const closed = await Promise.race([
        app.close().then(
          () => true,
          () => true,
        ),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 20_000)),
      ])
      if (!closed && electronPid !== undefined && processExists(electronPid)) process.kill(electronPid, 'SIGKILL')
      for (const pid of await sidecarPids()) if (processExists(pid)) process.kill(pid, 'SIGKILL')
      await waitFor(async () => (await sidecarPids()).every((pid) => !processExists(pid)), 10_000, 'sidecar exit').catch(() => undefined)
      await fixture.dispose()
    },
  }
  return launched
}

/** main 的桌面日志（COKO_USER_DATA_DIR 下的 logs/desktop.jsonl）。 */
export const desktopLogPath = (dir: string) => join(dir, 'user-data', 'logs', 'desktop.jsonl')

/** 测试构建不弹出桌面通知，只记日志 notification shown；返回这些记录的属性（kind、sessionId、title），按写入顺序。 */
export async function notificationsShown(dir: string): Promise<{ kind?: string; sessionId?: string; title?: string }[]> {
  const text = await readFile(desktopLogPath(dir), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as { message?: string; properties?: Record<string, string> }]
      } catch {
        return []
      }
    })
    .filter((record) => record.message === 'notification shown')
    .map((record) => ({ ...record.properties }))
}

/** 等待条件成立；只限制上限，不以固定 sleep 代表完成。 */
export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 15_000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** 以相同环境再启动一个 Electron 进程（单实例锁测试），返回其退出码。 */
export function launchSecondInstance(env: Record<string, string>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [mainEntry], { env, stdio: 'ignore' })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Second instance did not exit'))
    }, 20_000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

/** 等待 renderer 报告 Sidecar 已连接。 */
export async function waitConnected(window: Page): Promise<void> {
  await waitFor(async () => (await window.locator('[role="status"]').getAttribute('data-connection')) === 'connected', 30_000, 'sidecar connected')
}

/** 替换目录选择对话框：依次返回给定路径。 */
export async function stubDirectoryPicker(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, picks) => {
    const queue = [...picks]
    dialog.showOpenDialog = (async () => {
      const next = queue.shift()
      return next === undefined ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [next] }
    }) as typeof dialog.showOpenDialog
  }, paths)
}

export { processExists }
