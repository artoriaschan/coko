// 前台应用采样（只在 macOS）：运行给定命令（默认全量 desktop E2E，含产物 smoke），期间每 500ms 用 lsappinfo 记录前台应用，
// 断言本仓库启动的 Electron / Coko 从未成为前台应用。lsappinfo 不需要辅助功能权限。
//
//   node apps/desktop/e2e/foreground-watch.ts [--out <summary.json>] [-- <command...>]
//
// "本仓库的应用"按 bundle 路径判定（node_modules/electron 与 apps/desktop/out 都在仓库根下），不按名字：并行运行的其他
// 检出（另一个 worktree 的 E2E）也叫 Electron，它们成为前台时记为 foreign，不算违规。退出码：命令失败时为命令的退出码，
// 命令成功但出现违规时为 3。
import { execFile, spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const INTERVAL_MS = 500
const APP_NAME = /^(?:Electron|Coko)$/i

interface Sample {
  at: number
  name: string | null
  pid: number | null
  bundlePath: string | null
}

async function frontApp(): Promise<Sample> {
  const at = Date.now()
  try {
    const asn = (await run('lsappinfo', ['front'], { encoding: 'utf8' })).stdout.trim()
    const info = (await run('lsappinfo', ['info', '-only', 'name,pid,bundlepath', asn], { encoding: 'utf8' })).stdout
    const field = (key: string) => new RegExp(`"${key}"="([^"]*)"`).exec(info)?.[1] ?? null
    const pid = /"pid"=(\d+)/.exec(info)?.[1]
    return { at, name: field('LSDisplayName'), pid: pid === undefined ? null : Number(pid), bundlePath: field('LSBundlePath') }
  } catch {
    return { at, name: null, pid: null, bundlePath: null }
  }
}

const ours = (sample: Sample) => sample.bundlePath !== null && (sample.bundlePath + sep).startsWith(repoRoot + sep)

function parseArgs(argv: string[]): { out: string | undefined; command: string[] } {
  const split = argv.indexOf('--')
  const options = split === -1 ? argv : argv.slice(0, split)
  const command = split === -1 ? ['pnpm', 'exec', 'vitest', 'run', '--project', 'desktop-e2e'] : argv.slice(split + 1)
  const outIndex = options.indexOf('--out')
  return { out: outIndex === -1 ? undefined : resolve(options[outIndex + 1]!), command }
}

if (process.platform !== 'darwin') {
  console.error('foreground-watch: lsappinfo is only available on macOS')
  process.exit(2)
}

const { out, command } = parseArgs(process.argv.slice(2))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const samples: Sample[] = []
let sampling: Promise<void> = Promise.resolve()
const timer = setInterval(() => {
  sampling = sampling.then(async () => void samples.push(await frontApp()))
}, INTERVAL_MS)
const startedAt = Date.now()
const child = spawn(command[0]!, command.slice(1), { cwd: repoRoot, env, stdio: 'inherit' })
const exitCode = await new Promise<number>((done) => child.once('exit', (code, signal) => done(code ?? (signal === null ? 1 : 128))))
clearInterval(timer)
await sampling

const counts: Record<string, number> = {}
for (const sample of samples) counts[sample.name ?? '(none)'] = (counts[sample.name ?? '(none)'] ?? 0) + 1
const violations = samples.filter(ours)
const foreign = samples.filter((sample) => !ours(sample) && sample.name !== null && APP_NAME.test(sample.name))
const summary = {
  command: command.join(' '),
  repoRoot,
  exitCode,
  durationMs: Date.now() - startedAt,
  intervalMs: INTERVAL_MS,
  samples: samples.length,
  frontApps: counts,
  violations,
  foreignElectron: { count: foreign.length, bundlePaths: [...new Set(foreign.map((sample) => sample.bundlePath))] },
}
const text = JSON.stringify(summary, null, 2)
if (out !== undefined) {
  await writeFile(out, text + '\n')
  await writeFile(resolve(dirname(out), 'foreground-samples.jsonl'), samples.map((sample) => JSON.stringify(sample)).join('\n') + '\n')
}
console.log('foreground-watch summary:\n' + text)
process.exit(exitCode !== 0 ? exitCode : violations.length > 0 ? 3 : 0)
