// 插件（ADR 0017；docs/subsystems/plugins.md）的应用服务：安装（本机目录或 git 浅克隆，复制到 <COKO_HOME>/plugins/<name>）、按 digest 批准、
// 启用 / 禁用、按原来源更新、卸载，以及插件消费 seam（PluginContributionsPort）的提供方。
// 状态与 digest 每次从安装目录现读（清单、声明与 engines）：安装后目录被改动时 digest 随之变化，回到 needs-approval；只有 enabled 状态的插件
// 提供贡献。启用、禁用、批准、更新与卸载之后通知订阅者（MCP 据此关闭不再提供的 Server 的连接）；卸载先通知并等待，再删除目录与记录。
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  copyPluginTree,
  emptyPluginContributions,
  listPluginContributions,
  loadPlugin,
  type LoadedPlugin,
  type PluginContributionsPort,
  type PluginContributionsSnapshot,
  type ResourceDiagnostic,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import type { PluginInfo, PluginSource, PluginStatus } from '@coko/protocol'
import type { PluginRecord, SessionStore } from '@coko/session'
import { gitClone, GitCloneError, type GitPort } from '../adapters/git.ts'
import { AppError, errorMessage } from './errors.ts'

const log = getLogger(['application', 'plugins'])

/** 安装目录 <COKO_HOME>/plugins 下的暂存目录前缀（. 开头，不会与插件名冲突）。 */
const STAGING_PREFIX = '.staging-'

export interface PluginServiceOptions {
  store: Pick<SessionStore, 'plugins'>
  /** 用户级资源目录；插件安装在 <cokoHome>/plugins/<name>。 */
  cokoHome: string
  /** --app-version（engines.coko 的比较对象）；缺省视为满足。 */
  appVersion?: string
  /** 宿主 git（git 来源的浅克隆）。 */
  git?: GitPort
  /** 测试构建：额外的贡献（COKO_TEST_PLUGINS 的目录），与已安装插件的贡献合并。 */
  contributions?: PluginContributionsPort
  /** 测试覆盖复制上限。 */
  limits?: { maxFiles: number; maxBytes: number }
}

type Fetched = { dir: string; commit?: string }
type Listener = () => void | Promise<void>

const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** 从 git 地址中分出 #ref；只接受 https:// 与 file://，不接受内嵌凭据。 */
export function parseGitSource(source: { url: string; ref?: string }): { url: string; ref?: string } {
  const hash = source.url.indexOf('#')
  const url = hash >= 0 ? source.url.slice(0, hash) : source.url
  const fragment = hash >= 0 ? source.url.slice(hash + 1) : undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new AppError('bad-request', 'source.url must be an https:// or file:// URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'file:') throw new AppError('bad-request', 'source.url must be an https:// or file:// URL')
  if (parsed.username || parsed.password) throw new AppError('bad-request', 'source.url must not contain credentials')
  const ref = source.ref ?? (fragment ? fragment : undefined)
  if (ref !== undefined && (ref.startsWith('-') || /\s/.test(ref))) throw new AppError('bad-request', 'source.ref is not a valid git ref')
  return { url, ...(ref === undefined ? {} : { ref }) }
}

export class PluginService implements PluginContributionsPort {
  readonly #options: PluginServiceOptions
  readonly #listeners = new Set<Listener>()
  /** 正在卸载的插件：通知订阅者时已不在快照中。 */
  readonly #removing = new Set<string>()
  #queue: Promise<unknown> = Promise.resolve()

  constructor(options: PluginServiceOptions) {
    this.#options = options
  }

  get #root() {
    if (this.#options.cokoHome === '') throw new AppError('bad-request', 'COKO_HOME is not set; plugins cannot be installed')
    return join(this.#options.cokoHome, 'plugins')
  }

  /** 安装、更新、启停、批准与卸载依次执行。 */
  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(fn, fn)
    this.#queue = next.catch(() => undefined)
    return next
  }

  #path(record: Pick<PluginRecord, 'path'>): string {
    return isAbsolute(record.path) ? record.path : resolve(this.#options.cokoHome, record.path)
  }

  #load(record: Pick<PluginRecord, 'path'>): Promise<LoadedPlugin> {
    return loadPlugin(this.#path(record), {
      portableDigest: !isAbsolute(record.path),
      ...(this.#options.appVersion ? { appVersion: this.#options.appVersion } : {}),
    })
  }

  #status(record: PluginRecord, plugin: LoadedPlugin): PluginStatus {
    if (!plugin.valid || plugin.name !== record.name) return 'invalid'
    if (!plugin.compatible) return 'incompatible'
    if (record.approvedDigest !== plugin.digest) return 'needs-approval'
    return record.enabled ? 'enabled' : 'disabled'
  }

  async #describe(record: PluginRecord): Promise<PluginInfo> {
    const plugin = await this.#load(record)
    const contributions = await listPluginContributions(plugin)
    const diagnostics: ResourceDiagnostic[] = [...plugin.diagnostics, ...contributions.diagnostics]
    if (plugin.valid && plugin.name !== record.name)
      diagnostics.push({
        source: 'plugin',
        code: 'invalid-name',
        message: `The manifest name ${plugin.name} does not match the installed plugin`,
        path: this.#path(record),
      })
    return {
      name: record.name,
      version: plugin.version ?? record.version,
      ...(plugin.description === undefined ? {} : { description: plugin.description }),
      source: {
        kind: record.sourceKind,
        location: record.sourceLocation,
        ...(record.sourceRef ? { ref: record.sourceRef } : {}),
        ...(record.commit ? { commit: record.commit } : {}),
      },
      status: this.#status(record, plugin),
      digest: plugin.digest,
      ...(record.approvedDigest ? { approvedDigest: record.approvedDigest } : {}),
      contributions: contributions.names,
      executables: plugin.executables,
      diagnostics,
    }
  }

  async #record(name: string): Promise<PluginRecord> {
    const record = await this.#options.store.plugins.get(name)
    if (!record) throw new AppError('plugin-not-found', `Plugin ${name} is not installed`)
    return record
  }

  /** GET /api/plugins。 */
  async list(): Promise<PluginInfo[]> {
    return Promise.all((await this.#options.store.plugins.list()).map((record) => this.#describe(record)))
  }

  async get(name: string): Promise<PluginInfo> {
    return this.#describe(await this.#record(name))
  }

  /** 取来源到暂存目录（不含 .git）；复制失败映射为 400。 */
  async #fetch(source: PluginSource, staging: string): Promise<Fetched> {
    const dest = join(staging, 'tree')
    let from: string
    let commit: string | undefined
    if (source.kind === 'dir') {
      if (!isAbsolute(source.path)) throw new AppError('bad-request', 'source.path must be an absolute path')
      if (!(await stat(source.path).catch(() => undefined))?.isDirectory()) throw new AppError('plugin-source-unreachable', `${source.path} is not a directory`)
      from = source.path
    } else {
      const git = parseGitSource(source)
      if (!this.#options.git) throw new AppError('plugin-source-unreachable', 'git is not available')
      from = join(staging, 'clone')
      try {
        commit = (await gitClone(this.#options.git, { url: git.url, ...(git.ref ? { ref: git.ref } : {}), dest: from })).commit
      } catch (error) {
        log.warn('plugin clone failed', { error: errorMessage(error) })
        throw new AppError('plugin-source-unreachable', error instanceof GitCloneError ? `git clone failed: ${error.message}` : 'git clone failed')
      }
    }
    const copied = await copyPluginTree(from, dest, this.#options.limits)
    if (!copied.ok && copied.reason === 'too-large')
      throw new AppError('plugin-too-large', 'The plugin exceeds the file count or size limit', { files: copied.files, bytes: copied.bytes })
    if (!copied.ok) {
      const diagnostic: ResourceDiagnostic = {
        source: 'plugin',
        code: 'path-outside-plugin',
        message: `Symbolic link ${copied.path} points outside the plugin (${copied.target})`,
        path: copied.path,
      }
      throw new AppError('plugin-invalid', 'The plugin contains a symbolic link that points outside the plugin', { diagnostics: [diagnostic] })
    }
    return { dir: dest, ...(commit ? { commit } : {}) }
  }

  async #staging(): Promise<string> {
    const root = this.#root
    await mkdir(root, { recursive: true })
    const dir = join(root, STAGING_PREFIX + randomBytes(6).toString('hex'))
    await mkdir(dir)
    return dir
  }

  /** 暂存副本按最终目录展开命令；新相对记录用可移动摘要，旧绝对记录保留原摘要格式。 */
  async #validate(dir: string, finalPath: (name: string) => string, portableDigest = true): Promise<LoadedPlugin> {
    const probe = await loadPlugin(dir)
    if (!probe.valid || probe.name === undefined) throw new AppError('plugin-invalid', 'The plugin manifest is invalid', { diagnostics: probe.diagnostics })
    return loadPlugin(dir, {
      installRoot: finalPath(probe.name),
      portableDigest,
      ...(this.#options.appVersion ? { appVersion: this.#options.appVersion } : {}),
    })
  }

  /** POST /api/plugins → 201（状态 needs-approval；不加载任何资源）。 */
  install(source: PluginSource): Promise<PluginInfo> {
    return this.#serial(async () => {
      const root = this.#root
      const staging = await this.#staging()
      try {
        const fetched = await this.#fetch(source, staging)
        const plugin = await this.#validate(fetched.dir, (name) => join(root, name))
        const name = plugin.name!
        if (await this.#options.store.plugins.get(name)) throw new AppError('plugin-exists', `Plugin ${name} is already installed`)
        const path = join(root, name)
        if (await stat(path).catch(() => undefined)) {
          // 没有记录的残留目录（上次安装中断）：在插件根之内，替换。
          log.warn('stale plugin directory replaced', { plugin: name })
          await rm(path, { recursive: true, force: true })
        }
        await rename(fetched.dir, path)
        const git = source.kind === 'git' ? parseGitSource(source) : undefined
        const record = await this.#options.store.plugins.upsert({
          name,
          version: plugin.version!,
          sourceKind: source.kind,
          sourceLocation: source.kind === 'dir' ? source.path : git!.url,
          sourceRef: git?.ref ?? null,
          commit: fetched.commit ?? null,
          path: relative(this.#options.cokoHome, path),
          digest: plugin.digest,
        })
        log.info('plugin installed', { plugin: name, version: record.version, sourceKind: source.kind })
        return this.#describe(record)
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    })
  }

  /** POST /api/plugins/:name/approve：digest 须为当前的 digest（409 digest-mismatch）；批准即启用。 */
  approve(name: string, digest: string): Promise<PluginInfo> {
    return this.#serial(async () => {
      const record = await this.#record(name)
      const plugin = await this.#load(record)
      if (!plugin.valid || plugin.name !== record.name)
        throw new AppError('plugin-invalid', 'The installed plugin is invalid', { diagnostics: plugin.diagnostics })
      if (plugin.digest !== digest)
        throw new AppError('digest-mismatch', 'The plugin changed; review the current declarations and approve again', { digest: plugin.digest })
      const approved = await this.#options.store.plugins.approve(name, digest)
      log.info('plugin approved', { plugin: name })
      await this.#notify()
      return this.#describe(approved)
    })
  }

  /** PATCH /api/plugins/:name { enabled }。 */
  setEnabled(name: string, enabled: boolean): Promise<PluginInfo> {
    return this.#serial(async () => {
      await this.#record(name)
      const record = await this.#options.store.plugins.setEnabled(name, enabled)
      log.info(enabled ? 'plugin enabled' : 'plugin disabled', { plugin: name })
      await this.#notify()
      return this.#describe(record)
    })
  }

  /** POST /api/plugins/:name/update：按原来源重新取并替换目录；digest 变化时回到 needs-approval。 */
  update(name: string): Promise<PluginInfo> {
    return this.#serial(async () => {
      const record = await this.#record(name)
      const path = await this.#owned(record)
      const source: PluginSource =
        record.sourceKind === 'dir'
          ? { kind: 'dir', path: record.sourceLocation }
          : { kind: 'git', url: record.sourceLocation, ...(record.sourceRef ? { ref: record.sourceRef } : {}) }
      const staging = await this.#staging()
      try {
        const fetched = await this.#fetch(source, staging)
        const plugin = await this.#validate(fetched.dir, () => this.#path(record), !isAbsolute(record.path))
        if (plugin.name !== name)
          throw new AppError('plugin-invalid', `The source now declares plugin ${plugin.name ?? '?'}, not ${name}`, {
            diagnostics: [{ source: 'plugin', code: 'invalid-name', message: 'The plugin name changed', path: plugin.manifestPath }],
          })
        if (path.exists) await rename(path.real, join(staging, 'previous'))
        await rename(fetched.dir, this.#path(record))
        const updated = await this.#options.store.plugins.upsert({
          name,
          version: plugin.version!,
          sourceKind: record.sourceKind,
          sourceLocation: record.sourceLocation,
          sourceRef: record.sourceRef,
          commit: fetched.commit ?? record.commit,
          path: record.path,
          digest: plugin.digest,
        })
        log.info('plugin updated', { plugin: name, version: updated.version, digestChanged: plugin.digest !== record.digest })
        await this.#notify()
        return this.#describe(updated)
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    })
  }

  /**
   * 记录中的安装目录须在 <COKO_HOME>/plugins 之下（字面路径与真实路径都检查）；否则拒绝（403 forbidden），不删除也不替换。
   * 目录已不存在时 exists 为 false。
   */
  async #owned(record: PluginRecord): Promise<{ real: string; exists: boolean }> {
    const root = resolve(this.#root)
    const realRoot = await realpath(root).catch(() => root)
    const path = this.#path(record)
    const refuse = () => {
      log.warn('plugin path outside the plugins directory refused', { plugin: record.name })
      return new AppError('forbidden', `The recorded path of plugin ${record.name} is outside the plugins directory`)
    }
    if (!inside(root, path) && !inside(realRoot, path)) throw refuse()
    const real = await realpath(path).catch(() => undefined)
    if (real === undefined) return { real: path, exists: false }
    if (!inside(realRoot, real)) throw refuse()
    return { real, exists: true }
  }

  /** DELETE /api/plugins/:name → 204：先通知订阅者（MCP 关闭其进程），再删除目录与记录。 */
  uninstall(name: string): Promise<void> {
    return this.#serial(async () => {
      const record = await this.#record(name)
      const path = await this.#owned(record)
      this.#removing.add(name)
      try {
        await this.#notify()
        if (path.exists) await rm(path.real, { recursive: true, force: true })
        await this.#options.store.plugins.delete(name)
        log.info('plugin uninstalled', { plugin: name })
      } finally {
        this.#removing.delete(name)
      }
    })
  }

  /** 已启用插件的贡献（每个 Run 开始时读一次）；plugins.enabled 的判断在读取方。 */
  async snapshot(): Promise<PluginContributionsSnapshot> {
    const snapshot = this.#options.contributions ? await this.#options.contributions.snapshot() : emptyPluginContributions()
    const records = await this.#options.store.plugins.list().catch((error: unknown) => {
      log.warn('plugin records unavailable', { error: errorMessage(error) })
      return [] as PluginRecord[]
    })
    for (const record of records) {
      if (this.#removing.has(record.name) || !record.enabled) continue
      const plugin = await this.#load(record)
      if (this.#status(record, plugin) !== 'enabled') continue
      const owner = record.name
      const roots = (paths: string[]) => paths.map((path) => ({ plugin: owner, path }))
      snapshot.skillRoots.push(...roots(plugin.skillRoots))
      snapshot.commandRoots.push(...roots(plugin.commandRoots))
      snapshot.agentRoots.push(...roots(plugin.agentRoots))
      if (Object.keys(plugin.hooks).length > 0) snapshot.hooks.push({ plugin: owner, root: plugin.root, hooks: plugin.hooks })
      for (const [name, config] of Object.entries(plugin.mcpServers)) snapshot.mcpServers.push({ plugin: owner, name, config })
      for (const [name, config] of Object.entries(plugin.lspServers)) snapshot.lspServers.push({ plugin: owner, name, config })
    }
    return snapshot
  }

  /** 订阅变更；监听器可返回 Promise（卸载等待它，例如 MCP 关闭连接）。 */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    const inner = this.#options.contributions?.onChange(listener)
    return () => {
      this.#listeners.delete(listener)
      inner?.()
    }
  }

  async #notify(): Promise<void> {
    const results = await Promise.allSettled([...this.#listeners].map(async (listener) => (listener as Listener)()))
    for (const result of results) if (result.status === 'rejected') log.warn('plugin change listener failed', { error: errorMessage(result.reason) })
  }

  /** 残留的暂存目录（上次中断的安装）：启动时清理。 */
  async cleanupStaging(): Promise<void> {
    if (this.#options.cokoHome === '') return
    const root = this.#root
    for (const entry of await readdir(root).catch(() => [] as string[]))
      if (entry.startsWith(STAGING_PREFIX)) await rm(join(root, entry), { recursive: true, force: true })
  }
}
