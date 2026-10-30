// git 测试夹具：临时仓库、临时 HOME、GIT_CONFIG_GLOBAL=/dev/null、固定 author 与提交时间。返回的 env 交给 Sidecar（startSidecar 的 env），
// Sidecar 与它启动的 git 继承同一环境，不读真实的 ~/.gitconfig。
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const GIT_FIXTURE_AUTHOR = { name: 'Coko Fixture', email: 'fixture@coko.test' } as const
/** 固定的提交时间（author 与 committer）。 */
export const GIT_FIXTURE_DATE = '2026-01-01T00:00:00Z'

export interface GitWorkspace {
  /** 仓库根（真实路径）。 */
  root: string
  /** 临时 HOME。 */
  home: string
  /** 交给 Sidecar 与 git 的环境。 */
  env: Record<string, string>
  /** 在仓库中运行 git，返回 stdout。 */
  git(...args: string[]): Promise<string>
  dispose(): Promise<void>
}

export async function createGitWorkspace(options: { files?: Record<string, string> } = {}): Promise<GitWorkspace> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'coko-git-')))
  const root = join(base, 'repo')
  const home = join(base, 'home')
  await mkdir(root, { recursive: true })
  await mkdir(home, { recursive: true })
  const env: Record<string, string> = {
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: GIT_FIXTURE_AUTHOR.name,
    GIT_AUTHOR_EMAIL: GIT_FIXTURE_AUTHOR.email,
    GIT_COMMITTER_NAME: GIT_FIXTURE_AUTHOR.name,
    GIT_COMMITTER_EMAIL: GIT_FIXTURE_AUTHOR.email,
    GIT_AUTHOR_DATE: GIT_FIXTURE_DATE,
    GIT_COMMITTER_DATE: GIT_FIXTURE_DATE,
    GIT_TERMINAL_PROMPT: '0',
  }
  const git = async (...args: string[]) => (await run('git', args, { cwd: root, env: { PATH: process.env.PATH ?? '', ...env } })).stdout
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.name', GIT_FIXTURE_AUTHOR.name)
  await git('config', 'user.email', GIT_FIXTURE_AUTHOR.email)
  await git('config', 'commit.gpgsign', 'false')
  for (const [path, content] of Object.entries(options.files ?? { 'README.md': '# fixture\n' })) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  await git('add', '-A')
  await git('commit', '-q', '-m', 'initial')
  return { root, home, env, git, dispose: () => rm(base, { recursive: true, force: true }) }
}
