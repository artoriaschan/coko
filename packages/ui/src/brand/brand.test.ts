import { describe, expect, it } from 'vitest'
import { brandOf } from './brands.ts'

describe('品牌识别', () => {
  it.each([
    ['claude-sonnet-4-5', 'claude'],
    ['claude-3-7-sonnet-20250219', 'claude'],
    ['gpt-4o', 'openai'],
    ['gpt-5', 'openai'],
    ['o3-pro', 'openai'],
    ['deepseek-chat', 'deepseek'],
    ['qwen3-max', 'qwen'],
    ['qwq-32b', 'qwen'],
    ['glm-4.6', 'zhipu'],
    ['kimi-k2', 'moonshot'],
    ['grok-4', 'xai'],
    ['gemini-2.5-pro', 'gemini'],
    ['mistral-large-latest', 'mistral'],
    ['llama-3.3-70b', 'meta'],
    ['doubao-seed-1-6', 'doubao'],
    ['hunyuan-turbos', 'tencent'],
    ['ernie-4.5', 'baidu'],
    ['command-r-plus', 'cohere'],
    ['sonar-pro', 'perplexity'],
    ['yi-lightning', 'yi'],
  ])('模型 ID %s 识别为 %s', (modelId, brand) => {
    expect(brandOf({ modelId })).toBe(brand)
  })

  it('模型 ID 只按分隔符边界匹配前缀，不做子串猜测', () => {
    expect(brandOf({ modelId: 'gptx-1' })).toBeNull()
    expect(brandOf({ modelId: 'auction-model' })).toBeNull()
  })

  it.each([
    ['https://api.anthropic.com/v1', 'anthropic'],
    ['https://api.deepseek.com', 'deepseek'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen'],
    ['https://api.moonshot.cn/v1', 'moonshot'],
    ['https://open.bigmodel.cn/api/paas/v4', 'zhipu'],
    ['https://api.x.ai/v1', 'xai'],
    ['https://openrouter.ai/api/v1', 'openrouter'],
    ['https://generativelanguage.googleapis.com/v1beta', 'gemini'],
    ['https://api.openai.com/v1', 'openai'],
  ])('接口地址 %s 识别为 %s', (baseUrl, brand) => {
    expect(brandOf({ baseUrl })).toBe(brand)
  })

  it('省略协议的地址按域名识别', () => {
    expect(brandOf({ baseUrl: 'api.deepseek.com/v1' })).toBe('deepseek')
  })

  it('域名按点分边界匹配，短后缀不会命中近似域名', () => {
    expect(brandOf({ baseUrl: 'https://xyz.ai/v1' })).toBeNull()
    expect(brandOf({ baseUrl: 'https://api.x.ai/v1' })).toBe('xai')
  })

  it.each([
    [{ id: 'openai-main' }, 'openai'],
    [{ id: 'my-anthropic-proxy' }, 'anthropic'],
    [{ name: 'DeepSeek 官方' }, 'deepseek'],
    [{ name: '智谱 GLM' }, 'zhipu'],
    [{ name: '月之暗面 Kimi' }, 'moonshot'],
    [{ name: '阿里通义千问' }, 'qwen'],
    [{ name: '火山引擎豆包' }, 'doubao'],
  ])('供应商 ID 或名称 %o 识别为 %s', (hints, brand) => {
    expect(brandOf(hints)).toBe(brand)
  })

  it('自定义供应商与模型不误判', () => {
    expect(brandOf({ id: 'custom-provider-1', name: '自定义供应商一', baseUrl: 'http://localhost:1234/v1', modelId: 'custom-model-1' })).toBeNull()
    expect(brandOf({})).toBeNull()
  })

  it('模型 ID 比接口地址与名称更具体', () => {
    expect(brandOf({ modelId: 'claude-sonnet-4-5', baseUrl: 'https://api.openai.com/v1', name: 'OpenAI' })).toBe('claude')
  })
})
