import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'
import { createToolRegistry, ToolRegistrationError } from './registry.ts'
import type { CokoTool } from './types.ts'

function echoTool(name: string, text: string, description = 'Echo a fixed text'): CokoTool {
  return {
    name,
    label: name,
    description,
    parameters: Type.Object({ value: Type.String() }),
    execute: async () => ({ content: [{ type: 'text', text }], details: undefined }),
  }
}

async function runText(tool: CokoTool | undefined): Promise<string> {
  if (!tool) throw new Error('tool missing')
  const result = await tool.execute('call-1', { value: 'x' })
  const block = result.content[0]
  return block?.type === 'text' ? block.text : ''
}

describe('工具注册表', () => {
  it('以新名称扩展工具', async () => {
    const registry = createToolRegistry()
    registry.register(echoTool('hello', 'hi'))
    expect(registry.list().map((tool) => tool.name)).toEqual(['hello'])
    expect(await runText(registry.get('hello'))).toBe('hi')
    expect(registry.implementations()).toEqual([{ name: 'hello', source: 'host' }])
  })

  it('未声明覆盖的重名注册报错', () => {
    const registry = createToolRegistry()
    registry.register(echoTool('grep', 'builtin'), { source: 'builtin' })
    expect(() => registry.register(echoTool('grep', 'host'))).toThrow(ToolRegistrationError)
    expect(() => registry.register(echoTool('grep', 'host'))).toThrow(/already registered/)
  })

  it('声明覆盖后生效实现被替换，契约不变', async () => {
    const registry = createToolRegistry()
    const builtin = echoTool('grep', 'builtin')
    registry.register(builtin, { source: 'builtin' })
    registry.register(echoTool('grep', 'host'), { override: true })

    const effective = registry.get('grep')
    expect(await runText(effective)).toBe('host')
    expect(effective?.description).toBe(builtin.description)
    expect(effective?.parameters).toEqual(builtin.parameters)
    expect(registry.list()).toHaveLength(1)
    expect(registry.implementations()).toEqual([{ name: 'grep', source: 'host' }])
  })

  it('覆盖实现的契约与原工具不同则报错', () => {
    const registry = createToolRegistry()
    registry.register(echoTool('grep', 'builtin'), { source: 'builtin' })
    expect(() => registry.register(echoTool('grep', 'host', 'Different description'), { override: true })).toThrow(/contract/)
    const changedSchema = { ...echoTool('grep', 'host'), parameters: Type.Object({ other: Type.Number() }) }
    expect(() => registry.register(changedSchema, { override: true })).toThrow(/contract/)
  })

  it('覆盖不存在的工具报错', () => {
    const registry = createToolRegistry()
    expect(() => registry.register(echoTool('grep', 'host'), { override: true })).toThrow(/nothing to override/)
  })
})
