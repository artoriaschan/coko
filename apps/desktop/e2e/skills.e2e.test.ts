// Skills & Commands 分区（票 05）：真实 Electron + 真实 Sidecar（faux）。夹具 tests/fixtures/skills 复制到临时 Workspace、临时 COKO_HOME 与其同级的
// .agents；断言分区列出 Skill 与命令（来源、路径、声明的工具、诊断），停用一个 Skill 后 Sidecar 重启仍停用，且这些文件逐字节不变（ADR 0009）。
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { cokoHomeOf, launchApp, processExists, stubDirectoryPicker, waitConnected, writeCokoHome, type LaunchedApp } from './harness.ts'

const fixtures = fileURLToPath(new URL('../../../tests/fixtures/skills/', import.meta.url))

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

/** 目录树下每个文件的 sha256（相对路径 → 摘要）。 */
async function digests(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    out[path.slice(root.length)] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex')
  }
  return out
}

describe('Skills & Commands 分区', () => {
  it('列出 Skill 与命令（来源、路径、声明的工具、诊断）；停用一个 Skill 后重启 Sidecar 仍停用，用户文件逐字节不变', { timeout: 120_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-skills-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await cp(join(fixtures, 'workspace'), workspace, { recursive: true })
    await cp(join(fixtures, 'coko-home'), cokoHomeOf(root), { recursive: true })
    // 用户级 .agents/skills 是 COKO_HOME 的同级目录。
    await cp(join(fixtures, 'agents-home'), join(root, '.agents'), { recursive: true })
    await writeCokoHome(root, 'commands/hello.md', '---\ndescription: Greet someone\n---\nSay hello to $1.\n')
    const watched = [cokoHomeOf(root), join(root, '.agents'), join(workspace, '.coko'), join(workspace, '.agents')]
    const before = await Promise.all(watched.map(digests))
    await writeFile(join(root, 'faux.json'), JSON.stringify({ responses: [] }))

    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    const { window } = app
    await waitConnected(window)
    await stubDirectoryPicker(app.app, [workspace])
    await window
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    await window.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()

    const openSection = async () => {
      await window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
      const dialog = window.getByRole('dialog')
      await dialog.locator('[data-section="skills"]').click()
      await dialog.locator('[data-skill]').first().waitFor()
      return dialog
    }
    let dialog = await openSection()
    const skills = dialog.locator('[data-list="skills-list"] [data-skill]')
    expect(
      await skills.evaluateAll((items) => items.map((el) => [el.getAttribute('data-skill'), el.getAttribute('data-scope'), el.getAttribute('data-enabled')])),
    ).toEqual([
      ['deploy', 'project', 'true'],
      ['pdf', 'project', 'true'],
      ['notes', 'user', 'true'],
      ['lint', 'user', 'true'],
    ])
    const pdf = dialog.locator('[data-skill="pdf"]')
    await expect.poll(() => pdf.locator('[data-path]').textContent()).toMatch(/workspace\/\.coko\/skills\/pdf\/SKILL\.md$/)
    expect(await pdf.locator('[data-allowed-tools]').getAttribute('data-allowed-tools')).toBe('Bash(*)')
    expect(await pdf.textContent()).toMatch(/(Shown only; no permission is granted|只展示，不授予权限)/)
    expect(await dialog.locator('[data-skill="deploy"]').textContent()).toMatch(/(Only invoked as \/deploy|只能用 \/deploy 调用)/)
    await expect.poll(() => dialog.locator('[data-skill="lint"] [data-path]').textContent()).toMatch(/\.agents\/skills\/lint\/SKILL\.md$/)
    const command = dialog.locator('[data-list="commands-list"] [data-command="hello"]')
    expect(await command.getAttribute('data-source')).toBe('user')
    await expect.poll(() => command.locator('[data-path]').textContent()).toMatch(/coko-home\/commands\/hello\.md$/)
    const diagnostics = dialog.locator('[data-skills-diagnostics] [data-diagnostic]')
    expect(await diagnostics.evaluateAll((items) => items.map((el) => el.getAttribute('data-diagnostic')))).toEqual(['name-mismatch', 'shadowed'])
    await expect.poll(() => diagnostics.first().textContent()).toMatch(/wrong-name\/SKILL\.md/)

    // 停用 notes：行的状态与全局配置随之改变。
    await dialog.locator('[data-skill="notes"]').getByRole('checkbox').click()
    await expect.poll(() => dialog.locator('[data-skill="notes"]').getAttribute('data-enabled')).toBe('false')
    expect(await dialog.locator('[data-skill="notes"]').getByRole('checkbox').getAttribute('data-state')).toBe('unchecked')

    // 重启 Sidecar：停用状态来自库，仍停用。
    await window.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    const [pid] = await app.sidecarPids()
    process.kill(pid!, 'SIGKILL')
    await expect.poll(async () => (await app.sidecarPids()).length, { timeout: 15_000 }).toBe(2)
    expect(processExists(pid!)).toBe(false)
    await expect.poll(() => window.locator('[data-connection]').getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    dialog = await openSection()
    await expect.poll(() => dialog.locator('[data-skill="notes"]').getAttribute('data-enabled'), { timeout: 15_000 }).toBe('false')
    expect(await dialog.locator('[data-skill="pdf"]').getAttribute('data-enabled')).toBe('true')

    // 用户编写的文件不被改写。
    expect(await Promise.all(watched.map(digests))).toEqual(before)
  })
})
