import { readFile } from 'node:fs/promises'

/** True while a process with this pid exists (zombies included until reaped). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Poll until `predicate` holds or the deadline passes; resolves with the last value. */
export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000, intervalMs = 20): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return predicate()
}

/** Read whitespace-separated pids a test command wrote to `file`; empty until written. */
export async function readPids(file: string): Promise<number[]> {
  try {
    return (await readFile(file, 'utf-8')).split(/\s+/).filter(Boolean).map(Number)
  } catch {
    return []
  }
}
