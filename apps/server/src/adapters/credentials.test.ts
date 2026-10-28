import { describe, expect, it } from 'vitest'
import { createEnvSecretProvider } from './credentials.ts'

describe('工具 Secrets 的环境来源', () => {
  const env = {
    COKO_CREDENTIAL_DEEPSEEK: 'sk-provider-a',
    DEEPSEEK_API_KEY: 'sk-provider-b',
    OPENAI_API_KEY: 'sk-provider-c',
    ANTHROPIC_API_KEY: 'sk-provider-d',
    COKO_TEST_SECRET: 'tool-secret',
    GITHUB_TOKEN: 'gh-token',
  }

  it('不返回 Provider Credential（COKO_CREDENTIAL_* 与各 kind 的密钥变量），即使工具声明了这些名字', async () => {
    const provider = createEnvSecretProvider(env)
    for (const name of ['COKO_CREDENTIAL_DEEPSEEK', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'coko_credential_deepseek']) {
      expect({ name, value: await provider.get(name) }).toEqual({ name, value: undefined })
    }
  })

  it('其余声明的名字照常读取', async () => {
    const provider = createEnvSecretProvider(env)
    expect(await provider.get('COKO_TEST_SECRET')).toBe('tool-secret')
    expect(await provider.get('GITHUB_TOKEN')).toBe('gh-token')
  })
})
