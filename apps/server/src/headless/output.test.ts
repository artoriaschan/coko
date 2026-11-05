import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'
import { createOutput, EMPTY_USAGE } from './output.ts'

it.each([
  [
    'incremental_tools_rejected',
    '\nIf this service doesn\'t support it, turn off "Keep the prompt cache when loading tools" in the provider settings and retry.',
  ],
  ['model_error', ''],
])('text output renders %s without changing the raw provider error', async (code, hint) => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let text = ''
  stderr.setEncoding('utf8').on('data', (chunk) => {
    text += chunk
  })
  try {
    const output = createOutput('text', stdout, stderr)
    output.result({
      type: 'result',
      status: 'error',
      sessionId: 's1',
      runId: 'r1',
      text: '',
      usage: EMPTY_USAGE,
      durationMs: 1,
      error: { code, message: '400 fixture rejection' },
    })
    await output.flush()
    expect(text).toBe(`coko headless: error: ${code}: 400 fixture rejection${hint}\n`)
  } finally {
    stdout.destroy()
    stderr.destroy()
  }
})
