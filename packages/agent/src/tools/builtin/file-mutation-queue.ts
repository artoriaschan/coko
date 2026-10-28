// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

const queues = new Map<string, Promise<void>>()
let registration = Promise.resolve()

async function queueKey(filePath: string): Promise<string> {
  const resolved = resolve(filePath)
  try {
    return await realpath(resolved)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return resolved
    throw error
  }
}

/**
 * Serialize mutations of the same file (by realpath). Different files still run in parallel, so
 * write-like tools do not need `executionMode: "sequential"`, which would serialize the whole batch.
 */
export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const registered = registration.then(async () => {
    const key = await queueKey(filePath)
    const current = queues.get(key) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((resolveNext) => {
      release = resolveNext
    })
    const chained = current.then(() => next)
    queues.set(key, chained)
    return { key, current, chained, release }
  })
  registration = registered.then(
    () => undefined,
    () => undefined,
  )
  const { key, current, chained, release } = await registered
  await current
  try {
    return await fn()
  } finally {
    release()
    if (queues.get(key) === chained) queues.delete(key)
  }
}
