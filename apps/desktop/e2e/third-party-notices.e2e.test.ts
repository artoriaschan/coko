import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('the current packaged app includes the complete DeepSeek Harness MIT notice in Resources', async () => {
  const desktop = fileURLToPath(new URL('..', import.meta.url))
  const output = join(desktop, 'out', `Coko-${process.platform}-${process.arch}`)
  const resources = process.platform === 'darwin' ? join(output, 'Coko.app', 'Contents', 'Resources') : join(output, 'resources')
  const source = await readFile(new URL('../../../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8')
  const bundled = await readFile(join(resources, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  expect(bundled).toBe(source)
  expect(bundled).toContain('Copyright (c) 2026 DeepSeek')
  expect(bundled).toContain('Permission is hereby granted, free of charge')
  expect(bundled).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
  expect(bundled.trimEnd()).toMatch(/SOFTWARE\.$/)
})
