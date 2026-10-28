import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Electron 可执行文件；以 ELECTRON_RUN_AS_NODE=1 运行占位 Sidecar。 */
export const electronPath = createRequire(import.meta.url)('electron') as string
export const placeholderSidecarEntry = fileURLToPath(new URL('./fixtures/placeholder-sidecar.ts', import.meta.url))

export interface FixtureEvent {
  readonly pid: number
  readonly event: string
  readonly [key: string]: unknown
}

/** 每个测试独立的临时目录与事件文件。 */
export async function createFixtureDir(): Promise<{ dir: string; eventsPath: string; dispose: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'coko-desktop-'))
  return { dir, eventsPath: join(dir, 'events.jsonl'), dispose: () => rm(dir, { recursive: true, force: true }) }
}

export async function readFixtureEvents(eventsPath: string): Promise<FixtureEvent[]> {
  let text: string
  try {
    text = await readFile(eventsPath, 'utf8')
  } catch {
    return []
  }
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as FixtureEvent)
}

/** 进程是否仍存在（信号 0 只做存在性检查）。 */
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
