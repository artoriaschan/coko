import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { createFixtureDir, electronPath, placeholderSidecarEntry, processExists, readFixtureEvents } from '../tests/sidecar-fixture.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
/** 与 electron-forge start 一致：以包目录启动，package.json 的 main 指向 dist/electron/main.cjs。 */
export const mainEntry = desktopRoot

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
  /** 关闭应用并确认 Electron 与 sidecar 进程都已退出；超时则强制结束。 */
  dispose(): Promise<void>
}

/** 测试环境：去掉宿主带来的 ELECTRON_RUN_AS_NODE，使用独立 userData 与占位 sidecar。 */
function testEnv(extra: Record<string, string>, dir: string, eventsPath: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  return {
    ...env,
    COKO_USER_DATA_DIR: join(dir, 'user-data'),
    COKO_SIDECAR_ENTRY: placeholderSidecarEntry,
    COKO_FIXTURE_EVENTS: eventsPath,
    ...extra,
  }
}

export async function launchApp(extra: Record<string, string> = {}): Promise<LaunchedApp> {
  const fixture = await createFixtureDir()
  const env = testEnv(extra, fixture.dir, fixture.eventsPath)
  const app = await _electron.launch({ executablePath: electronPath, args: [mainEntry], env })
  // 应用关闭后 process() 不再可用，启动时记录。
  const electronPid = app.process().pid
  const sidecarPids = async () => (await readFixtureEvents(fixture.eventsPath)).filter((e) => e.event === 'spawned').map((e) => e.pid)
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
      const closed = await Promise.race([
        app.close().then(
          () => true,
          () => true,
        ),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 20_000)),
      ])
      if (!closed && electronPid !== undefined && processExists(electronPid)) process.kill(electronPid, 'SIGKILL')
      for (const pid of await sidecarPids()) if (processExists(pid)) process.kill(pid, 'SIGKILL')
      await fixture.dispose()
    },
  }
  return launched
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

export { processExists }
