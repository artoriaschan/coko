// Real App + Sidecar + command execution. The file barrier controls output; no timing sleeps.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, processExists } from './harness.ts'

it('terminal command input, continuous output, error, raw copy and real Background Job entry work through Electron', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-terminal-details-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const script =
    "const fs=require('fs'); const watcher=fs.watch('.',()=>{if(fs.existsSync('release')){watcher.close(); console.log('second output'); process.exit(7)}}); process.stdout.write('\\u001b[31mfirst output\\u001b[0m\\n'); fs.writeFileSync('ready','1')"
  const command = `node -e ${JSON.stringify(script)}`
  const background = `node -e "console.log('background-real')"`
  const faux = join(root, 'faux.json')
  await writeFile(
    faux,
    JSON.stringify({
      responses: [
        { content: [{ type: 'toolCall', name: 'bash', id: 'foreground', arguments: { command } }] },
        { content: 'Foreground ended.' },
        { content: [{ type: 'toolCall', name: 'bash', id: 'background', arguments: { command: background, run_in_background: true } }] },
        { content: 'Background started.' },
      ],
    }),
  )
  const app = await launchApp({ COKO_FAUX_SCRIPT: faux }, { dir: root })
  const electronPid = app.app.process().pid!
  onTestFinished(async () => {
    const sidecars = await app.sidecarPids()
    await app.dispose()
    await expect.poll(() => processExists(electronPid)).toBe(false)
    for (const pid of sidecars) await expect.poll(() => processExists(pid)).toBe(false)
  })
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  await createProjectDraft(app, workspace)
  await app.window.locator('[data-permission-mode]').click()
  await app.window.locator('[role="menuitemradio"][data-mode="full-access"]').click()
  await app.window.getByRole('button', { name: /^(Turn on anyway|仍要开启)$/ }).click()
  await expect.poll(() => app.window.locator('[data-permission-mode]').getAttribute('data-permission-mode')).toBe('full-access')
  const composer = app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await composer.fill('run foreground')
  await composer.press('Enter')
  const row = app.window.locator('[data-slot="tool-card"][data-tool="bash"]').first()
  await row.locator('button').first().click()
  const output = row.locator('[data-terminal-output]')
  await expect.poll(() => output.textContent()).toBe('first output\n')
  expect(await row.locator('[data-command-text]').allTextContents()).toEqual([command])
  expect(await output.locator('.text-terminal-red').textContent()).toBe('first output')
  const cdp = await app.window.context().newCDPSession(app.window)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  expect(await app.window.evaluate(() => document.hasFocus())).toBe(true)

  const before = await app.app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await row.locator('.conversation-terminal-copy').click()
    await expect.poll(() => app.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('\u001b[31mfirst output\u001b[0m\n')
    expect(await row.locator('.conversation-terminal-copy').textContent()).toMatch(/Copied|复制成功/)
    expect(
      await app.window.evaluate(async () => {
        try {
          await navigator.clipboard.readText()
          return 'allowed'
        } catch (error) {
          return error instanceof DOMException ? error.name : String(error)
        }
      }),
    ).toBe('NotAllowedError')
  } finally {
    await app.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), before)
  }
  await writeFile(join(workspace, 'release'), '1')
  await expect.poll(() => app.window.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30_000 }).toBe('Foreground ended.')
  expect(await output.textContent()).toContain('second output')
  expect(await output.textContent()).toContain('Command exited with code 7')
  expect(await row.getAttribute('data-status')).toBe('error')
  expect(await row.locator('[data-terminal]').count()).toBe(1)
  expect(await row.locator('[aria-expanded="true"]').count()).toBe(1)
  await composer.fill('start background')
  await composer.press('Enter')
  await expect.poll(() => app.window.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30_000 }).toBe('Background started.')
  const backgroundRow = app.window.locator('[data-slot="tool-card"][data-tool="bash"]').last()
  await backgroundRow.locator('button').first().click()
  const chip = backgroundRow.locator('[data-slot="job-chip"]')
  const jobId = await chip.getAttribute('data-job-id')
  expect(jobId).toMatch(/^job_[0-9a-f]+$/)
  await chip.click()
  await expect.poll(() => app.window.locator('[role="tab"][data-tab="jobs"]').getAttribute('aria-selected')).toBe('true')
  await expect.poll(() => app.window.locator('[data-slot="job-detail"]').getAttribute('data-job-id')).toBe(jobId)
  await expect.poll(() => app.window.locator('[data-slot="job-output"]').textContent()).toBe('background-real\n')
  await expect.poll(() => app.window.locator('[data-slot="job-detail"]').getAttribute('data-status')).toBe('completed')
})
