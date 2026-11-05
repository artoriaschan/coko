import '../../styles.css'
import { expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { TooltipProvider } from '@coko/ui'
import type { Artifact } from '@coko/protocol'
import { I18nProvider } from '../../app/i18n.tsx'
import { ArtifactsTab } from './artifacts-tab.tsx'
import { visibleRightPanelTabs } from './tabs.ts'

it('Artifacts shows empty outputs, refreshes the tree and resolves paths before native actions', async () => {
  let artifacts: Artifact[] = []
  const requests: string[] = []
  const actions: string[] = []
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    requests.push(input)
    if (input.endsWith('/resolve')) {
      const path = JSON.parse(String(init?.body)).path
      return Response.json({ path: '/session/outputs/' + path })
    }
    return Response.json({ artifacts })
  })
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  const bridge = Object.getOwnPropertyDescriptor(window, 'coko')
  Object.defineProperty(window, 'coko', {
    configurable: true,
    value: {
      openFile: async (path: string) => {
        actions.push('open:' + path)
        return true
      },
      revealFile: async (path: string) => {
        actions.push('reveal:' + path)
        return true
      },
    },
  })
  onTestFinished(() => {
    if (bridge) Object.defineProperty(window, 'coko', bridge)
    else Reflect.deleteProperty(window, 'coko')
  })
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (path) => {
    actions.push('copy:' + path)
  })
  onTestFinished(() => copy.mockRestore())
  const screen = await render(
    <I18nProvider locale="en">
      <TooltipProvider>
        <div style={{ width: 390, height: 500, display: 'flex' }}>
          <ArtifactsTab sessionId="standalone" />
        </div>
      </TooltipProvider>
    </I18nProvider>,
  )
  await expect.element(screen.getByText('No delivery files yet. Files in outputs/ appear here.')).toBeVisible()
  artifacts = [
    { path: 'chapters', name: 'chapters', kind: 'directory', size: 0, modifiedAt: 1 },
    { path: 'chapters/report.txt', name: 'report.txt', kind: 'file', size: 12, modifiedAt: 1 },
  ]
  await userEvent.click(screen.getByRole('button', { name: 'Refresh artifacts' }))
  await expect.element(screen.getByRole('button', { name: 'Open report.txt' })).toBeVisible()
  await expect.element(screen.getByText('chapters/report.txt', { exact: true })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Open report.txt' }))
  await userEvent.click(screen.getByRole('button', { name: 'Show report.txt in Finder' }))
  await userEvent.click(screen.getByRole('button', { name: 'Copy path of report.txt' }))
  await expect
    .poll(() => actions)
    .toEqual(['open:/session/outputs/chapters/report.txt', 'reveal:/session/outputs/chapters/report.txt', 'copy:/session/outputs/chapters/report.txt'])
  expect(requests.filter((path) => path.endsWith('/resolve'))).toHaveLength(3)
  artifacts = []
  await expect.element(screen.getByText('No delivery files yet. Files in outputs/ appear here.')).toBeVisible()
  await screen.unmount()
})

it('Artifacts is offered only when the current Session supports its directory', () => {
  expect(visibleRightPanelTabs(undefined, false).map((tab) => tab.id)).not.toContain('artifacts')
  expect(visibleRightPanelTabs(undefined, false, true).map((tab) => tab.id)).toContain('artifacts')
})

it('retains current files on a scan error and allows an explicit retry without overflowing a narrow panel', async () => {
  let failed = false
  const name = 'A'.repeat(100) + '.txt'
  vi.stubGlobal('fetch', async () =>
    failed
      ? Response.json({ error: { code: 'storage-unavailable', message: 'disk unavailable' } }, { status: 503 })
      : Response.json({ artifacts: [{ path: name, name, kind: 'file', size: 33554432, modifiedAt: 1 }] }),
  )
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  const screen = await render(
    <I18nProvider locale="en">
      <TooltipProvider>
        <div data-panel style={{ width: 300, height: 500, display: 'flex' }}>
          <ArtifactsTab sessionId="standalone" />
        </div>
      </TooltipProvider>
    </I18nProvider>,
  )
  await expect.element(screen.getByRole('button', { name: 'Open ' + name })).toBeVisible()
  failed = true
  await userEvent.click(screen.getByRole('button', { name: 'Refresh artifacts' }))
  await expect.element(screen.getByRole('status')).toHaveTextContent('Could not load delivery files. Refresh to try again.')
  await expect.element(screen.getByRole('button', { name: 'Open ' + name })).toBeVisible()
  const panel = screen.container.querySelector('[data-panel]')!
  expect(panel.scrollWidth).toBeLessThanOrEqual(300)
  failed = false
  await userEvent.click(screen.getByRole('button', { name: 'Refresh artifacts' }))
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
  await screen.unmount()
})

it('aborts the prior scan on Session changes and stops scans when the panel unmounts', async () => {
  let finishOld: ((value: Response) => void) | undefined
  let firstSignal: AbortSignal | undefined
  let currentSignal: AbortSignal | undefined
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    if (input.includes('/old/')) {
      firstSignal = init?.signal ?? undefined
      return new Promise<Response>((resolve) => {
        finishOld = resolve
      })
    }
    currentSignal = init?.signal ?? undefined
    return Response.json({ artifacts: [{ path: 'current.txt', name: 'current.txt', kind: 'file', size: 1, modifiedAt: 1 }] })
  })
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  const Host = ({ id }: { id: string }) => (
    <I18nProvider locale="en">
      <TooltipProvider>
        <ArtifactsTab sessionId={id} />
      </TooltipProvider>
    </I18nProvider>
  )
  const screen = await render(<Host id="old" />)
  await expect.poll(() => !!firstSignal).toBe(true)
  await screen.rerender(<Host id="current" />)
  await expect.element(screen.getByRole('button', { name: 'Open current.txt' })).toBeVisible()
  expect(firstSignal?.aborted).toBe(true)
  finishOld!(Response.json({ artifacts: [] }))
  await screen.unmount()
  expect(currentSignal?.aborted).toBe(true)
})
