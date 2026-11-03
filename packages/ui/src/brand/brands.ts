import type * as React from 'react'
import AnthropicMono from '@lobehub/icons/es/Anthropic/components/Mono.js'
import AzureColor from '@lobehub/icons/es/Azure/components/Color.js'
import AzureMono from '@lobehub/icons/es/Azure/components/Mono.js'
import BaichuanColor from '@lobehub/icons/es/Baichuan/components/Color.js'
import BaichuanMono from '@lobehub/icons/es/Baichuan/components/Mono.js'
import BaiduColor from '@lobehub/icons/es/Baidu/components/Color.js'
import BaiduMono from '@lobehub/icons/es/Baidu/components/Mono.js'
import BedrockColor from '@lobehub/icons/es/Bedrock/components/Color.js'
import BedrockMono from '@lobehub/icons/es/Bedrock/components/Mono.js'
import ClaudeColor from '@lobehub/icons/es/Claude/components/Color.js'
import ClaudeMono from '@lobehub/icons/es/Claude/components/Mono.js'
import CohereColor from '@lobehub/icons/es/Cohere/components/Color.js'
import CohereMono from '@lobehub/icons/es/Cohere/components/Mono.js'
import DeepSeekColor from '@lobehub/icons/es/DeepSeek/components/Color.js'
import DeepSeekMono from '@lobehub/icons/es/DeepSeek/components/Mono.js'
import DoubaoColor from '@lobehub/icons/es/Doubao/components/Color.js'
import DoubaoMono from '@lobehub/icons/es/Doubao/components/Mono.js'
import GeminiColor from '@lobehub/icons/es/Gemini/components/Color.js'
import GeminiMono from '@lobehub/icons/es/Gemini/components/Mono.js'
import GoogleColor from '@lobehub/icons/es/Google/components/Color.js'
import GoogleMono from '@lobehub/icons/es/Google/components/Mono.js'
import GroqMono from '@lobehub/icons/es/Groq/components/Mono.js'
import LmStudioMono from '@lobehub/icons/es/LmStudio/components/Mono.js'
import MetaColor from '@lobehub/icons/es/Meta/components/Color.js'
import MetaMono from '@lobehub/icons/es/Meta/components/Mono.js'
import MicrosoftColor from '@lobehub/icons/es/Microsoft/components/Color.js'
import MicrosoftMono from '@lobehub/icons/es/Microsoft/components/Mono.js'
import MiniMaxColor from '@lobehub/icons/es/MiniMax/components/Color.js'
import MiniMaxMono from '@lobehub/icons/es/MiniMax/components/Mono.js'
import MistralColor from '@lobehub/icons/es/Mistral/components/Color.js'
import MistralMono from '@lobehub/icons/es/Mistral/components/Mono.js'
import MoonshotMono from '@lobehub/icons/es/Moonshot/components/Mono.js'
import OllamaMono from '@lobehub/icons/es/Ollama/components/Mono.js'
import OpenAIMono from '@lobehub/icons/es/OpenAI/components/Mono.js'
import OpenRouterColor from '@lobehub/icons/es/OpenRouter/components/Color.js'
import OpenRouterMono from '@lobehub/icons/es/OpenRouter/components/Mono.js'
import PerplexityColor from '@lobehub/icons/es/Perplexity/components/Color.js'
import PerplexityMono from '@lobehub/icons/es/Perplexity/components/Mono.js'
import QwenColor from '@lobehub/icons/es/Qwen/components/Color.js'
import QwenMono from '@lobehub/icons/es/Qwen/components/Mono.js'
import SiliconCloudColor from '@lobehub/icons/es/SiliconCloud/components/Color.js'
import SiliconCloudMono from '@lobehub/icons/es/SiliconCloud/components/Mono.js'
import TencentColor from '@lobehub/icons/es/Tencent/components/Color.js'
import TencentMono from '@lobehub/icons/es/Tencent/components/Mono.js'
import VllmColor from '@lobehub/icons/es/Vllm/components/Color.js'
import VllmMono from '@lobehub/icons/es/Vllm/components/Mono.js'
import XAIMono from '@lobehub/icons/es/XAI/components/Mono.js'
import YiColor from '@lobehub/icons/es/Yi/components/Color.js'
import YiMono from '@lobehub/icons/es/Yi/components/Mono.js'
import ZhipuColor from '@lobehub/icons/es/Zhipu/components/Color.js'
import ZhipuMono from '@lobehub/icons/es/Zhipu/components/Mono.js'

/** 一个品牌可用的图标：单色版本跟随文字颜色，彩色版本使用品牌色。 */
interface BrandGlyphs {
  readonly mono: React.ElementType
  readonly color?: React.ElementType
}

/** 共享品牌图标覆盖的模型与供应商；未列出的品牌回退为通用图标。 */
const GLYPHS = {
  anthropic: { mono: AnthropicMono },
  azure: { mono: AzureMono, color: AzureColor },
  baichuan: { mono: BaichuanMono, color: BaichuanColor },
  baidu: { mono: BaiduMono, color: BaiduColor },
  bedrock: { mono: BedrockMono, color: BedrockColor },
  claude: { mono: ClaudeMono, color: ClaudeColor },
  cohere: { mono: CohereMono, color: CohereColor },
  deepseek: { mono: DeepSeekMono, color: DeepSeekColor },
  doubao: { mono: DoubaoMono, color: DoubaoColor },
  gemini: { mono: GeminiMono, color: GeminiColor },
  google: { mono: GoogleMono, color: GoogleColor },
  groq: { mono: GroqMono },
  lmstudio: { mono: LmStudioMono },
  meta: { mono: MetaMono, color: MetaColor },
  microsoft: { mono: MicrosoftMono, color: MicrosoftColor },
  minimax: { mono: MiniMaxMono, color: MiniMaxColor },
  mistral: { mono: MistralMono, color: MistralColor },
  moonshot: { mono: MoonshotMono },
  ollama: { mono: OllamaMono },
  openai: { mono: OpenAIMono },
  openrouter: { mono: OpenRouterMono, color: OpenRouterColor },
  perplexity: { mono: PerplexityMono, color: PerplexityColor },
  qwen: { mono: QwenMono, color: QwenColor },
  siliconcloud: { mono: SiliconCloudMono, color: SiliconCloudColor },
  tencent: { mono: TencentMono, color: TencentColor },
  vllm: { mono: VllmMono, color: VllmColor },
  xai: { mono: XAIMono },
  yi: { mono: YiMono, color: YiColor },
  zhipu: { mono: ZhipuMono, color: ZhipuColor },
} satisfies Record<string, BrandGlyphs>

export type BrandId = keyof typeof GLYPHS

export const BRAND_GLYPHS: Readonly<Record<BrandId, BrandGlyphs>> = GLYPHS

/** 接口地址的域名后缀；匹配时要求完整域名或点分边界，避免短后缀误命中。 */
const HOST_BRANDS: ReadonlyArray<readonly [host: string, brand: BrandId]> = [
  ['anthropic.com', 'anthropic'],
  ['claude.ai', 'claude'],
  ['openai.com', 'openai'],
  ['openai.azure.com', 'azure'],
  ['azure.com', 'azure'],
  ['googleapis.com', 'gemini'],
  ['google.com', 'google'],
  ['deepseek.com', 'deepseek'],
  ['aliyuncs.com', 'qwen'],
  ['moonshot.cn', 'moonshot'],
  ['moonshot.ai', 'moonshot'],
  ['bigmodel.cn', 'zhipu'],
  ['z.ai', 'zhipu'],
  ['x.ai', 'xai'],
  ['mistral.ai', 'mistral'],
  ['groq.com', 'groq'],
  ['openrouter.ai', 'openrouter'],
  ['ollama.com', 'ollama'],
  ['amazonaws.com', 'bedrock'],
  ['volces.com', 'doubao'],
  ['volcengineapi.com', 'doubao'],
  ['baidubce.com', 'baidu'],
  ['tencentcloudapi.com', 'tencent'],
  ['tencent.com', 'tencent'],
  ['minimaxi.com', 'minimax'],
  ['minimax.io', 'minimax'],
  ['lingyiwanwu.com', 'yi'],
  ['baichuan-ai.com', 'baichuan'],
  ['siliconflow.cn', 'siliconcloud'],
  ['siliconflow.com', 'siliconcloud'],
  ['perplexity.ai', 'perplexity'],
  ['lmstudio.ai', 'lmstudio'],
  ['vllm.ai', 'vllm'],
  ['cohere.ai', 'cohere'],
  ['cohere.com', 'cohere'],
  ['microsoft.com', 'microsoft'],
]

/** 供应商 ID 与名称中的英文词元；大小写不敏感，按分隔符切分后精确匹配。 */
const TOKEN_NAMES: ReadonlyArray<readonly [brand: BrandId, names: readonly string[]]> = [
  ['anthropic', ['anthropic']],
  ['claude', ['claude']],
  ['openai', ['openai', 'chatgpt']],
  ['azure', ['azure']],
  ['gemini', ['gemini']],
  ['google', ['google', 'vertex', 'vertexai']],
  ['deepseek', ['deepseek']],
  ['qwen', ['qwen', 'alibaba', 'dashscope', 'tongyi']],
  ['moonshot', ['moonshot', 'kimi']],
  ['zhipu', ['zhipu', 'glm', 'bigmodel', 'chatglm']],
  ['xai', ['xai', 'grok']],
  ['mistral', ['mistral']],
  ['groq', ['groq']],
  ['openrouter', ['openrouter']],
  ['ollama', ['ollama']],
  ['bedrock', ['bedrock', 'aws', 'amazon']],
  ['doubao', ['doubao', 'volcengine', 'volces']],
  ['baidu', ['baidu', 'qianfan', 'ernie', 'wenxin']],
  ['tencent', ['tencent', 'hunyuan']],
  ['minimax', ['minimax']],
  ['yi', ['yi', '01ai', 'lingyiwanwu', 'zeroone']],
  ['baichuan', ['baichuan']],
  ['siliconcloud', ['siliconflow', 'siliconcloud']],
  ['perplexity', ['perplexity']],
  ['lmstudio', ['lmstudio']],
  ['vllm', ['vllm']],
  ['meta', ['meta', 'llama']],
  ['cohere', ['cohere']],
  ['microsoft', ['microsoft', 'phi']],
]

/** 供应商名称中的中文别名；中文不使用分隔符，按子串匹配。 */
const CJK_NAMES: ReadonlyArray<readonly [brand: BrandId, names: readonly string[]]> = [
  ['deepseek', ['深度求索']],
  ['qwen', ['通义', '千问']],
  ['moonshot', ['月之暗面']],
  ['zhipu', ['智谱', '清言']],
  ['doubao', ['豆包', '火山']],
  ['tencent', ['腾讯', '混元']],
  ['baidu', ['百度', '文心']],
  ['baichuan', ['百川']],
  ['yi', ['零一万物']],
  ['siliconcloud', ['硅基流动']],
]

/** 模型 ID 前缀；按长度降序匹配，要求前缀后是分隔符或结尾。 */
const MODEL_BRANDS: ReadonlyArray<readonly [prefix: string, brand: BrandId]> = [
  ['claude', 'claude'],
  ['gpt', 'openai'],
  ['chatgpt', 'openai'],
  ['o1', 'openai'],
  ['o3', 'openai'],
  ['o4', 'openai'],
  ['gemini', 'gemini'],
  ['learnlm', 'gemini'],
  ['deepseek', 'deepseek'],
  ['qwen', 'qwen'],
  ['qwq', 'qwen'],
  ['glm', 'zhipu'],
  ['chatglm', 'zhipu'],
  ['kimi', 'moonshot'],
  ['moonshot', 'moonshot'],
  ['grok', 'xai'],
  ['mistral', 'mistral'],
  ['mixtral', 'mistral'],
  ['codestral', 'mistral'],
  ['devstral', 'mistral'],
  ['magistral', 'mistral'],
  ['pixtral', 'mistral'],
  ['llama', 'meta'],
  ['doubao', 'doubao'],
  ['ernie', 'baidu'],
  ['hunyuan', 'tencent'],
  ['minimax', 'minimax'],
  ['abab', 'minimax'],
  ['yi', 'yi'],
  ['baichuan', 'baichuan'],
  ['command', 'cohere'],
  ['sonar', 'perplexity'],
  ['phi', 'microsoft'],
]

const MODEL_BRANDS_BY_LENGTH = [...MODEL_BRANDS].sort(([a], [b]) => b.length - a.length)

export interface BrandHints {
  /** 供应商 ID。 */
  id?: string | undefined
  /** 供应商名称。 */
  name?: string | undefined
  /** 供应商接口地址；可以是完整 URL 或省略协议的域名。 */
  baseUrl?: string | undefined
  /** 模型 ID。 */
  modelId?: string | undefined
}

/**
 * 识别模型或供应商品牌：模型 ID 最具体，其次接口地址，最后是供应商 ID 与名称。
 * 只有已收录的品牌会命中，其余返回 null。
 */
export function brandOf({ id, name, baseUrl, modelId }: BrandHints): BrandId | null {
  return (
    (modelId !== undefined ? brandOfModelId(modelId) : null) ??
    (baseUrl !== undefined ? brandOfHost(baseUrl) : null) ??
    brandOfText(id) ??
    brandOfText(name) ??
    null
  )
}

function brandOfModelId(modelId: string): BrandId | null {
  const id = modelId.toLowerCase()
  for (const [prefix, brand] of MODEL_BRANDS_BY_LENGTH) {
    // 前缀后必须是分隔符、版本号或结尾：qwen3-max、llama3.1 与 claude-sonnet 都算，gptx 不算。
    const next = id.charAt(prefix.length)
    if (id.startsWith(prefix) && (id.length === prefix.length || /^[-./:]$/.test(next) || /^[0-9]$/.test(next))) return brand
  }
  return null
}

function brandOfHost(baseUrl: string): BrandId | null {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`
  let host: string
  try {
    host = new URL(withProtocol).hostname.toLowerCase()
  } catch {
    return null
  }
  for (const [suffix, brand] of HOST_BRANDS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return brand
  }
  return null
}

function brandOfText(text: string | undefined): BrandId | null {
  if (text === undefined || text.trim() === '') return null
  const lower = text.toLowerCase()
  for (const [brand, names] of CJK_NAMES) {
    if (names.some((name) => lower.includes(name))) return brand
  }
  const tokens = lower.split(/[^a-z0-9]+/).filter((token) => token !== '')
  for (const [brand, names] of TOKEN_NAMES) {
    if (names.some((name) => tokens.includes(name))) return brand
  }
  return null
}
