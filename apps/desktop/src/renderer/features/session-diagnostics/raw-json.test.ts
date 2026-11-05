// Adapted from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
/** Raw details retain shared values while terminating cyclic live object references. */

import { expect, it } from 'vitest'
import { diagnosticJson } from './raw-json.ts'

it('marks self-referencing objects, maps, and sets without modifying them', () => {
  const object: Record<string, unknown> = {}
  object.self = object
  const map = new Map<string, unknown>()
  map.set('self', map)
  const set = new Set<unknown>()
  set.add(set)
  expect(diagnosticJson({ object, map, set })).toEqual({
    failed: false,
    text: JSON.stringify(
      {
        object: { self: '[Circular]' },
        map: { self: '[Circular]' },
        set: ['[Circular]'],
      },
      null,
      2,
    ),
  })
  expect(object.self).toBe(object)
  expect(map.get('self')).toBe(map)
  expect(set.has(set)).toBe(true)
})

it('expands shared non-circular values separately in each branch', () => {
  const shared = { value: 1 }
  const map = new Map([['value', shared]])
  expect(diagnosticJson({ left: shared, right: shared, first: map, second: map })).toEqual({
    failed: false,
    text: JSON.stringify({ left: shared, right: shared, first: { value: shared }, second: { value: shared } }, null, 2),
  })
})

it('keeps bigint values readable and contains serialization errors', () => {
  expect(diagnosticJson({ count: 123n })).toEqual({ text: '{\n  "count": "123n"\n}', failed: false })
  expect(diagnosticJson(undefined)).toEqual({ text: '', failed: false })
  expect(
    diagnosticJson({
      toJSON() {
        throw new Error('unavailable value')
      },
    }),
  ).toEqual({ text: 'unavailable value', failed: true })
  expect(
    diagnosticJson({
      toJSON() {
        throw 'unavailable text'
      },
    }),
  ).toEqual({ text: 'unavailable text', failed: true })
})
