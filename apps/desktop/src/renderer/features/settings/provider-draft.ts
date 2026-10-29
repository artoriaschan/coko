import type { MessageKey } from '@coko/i18n'
import { MODEL_CATALOG_DEFAULTS, PROVIDER_ID_PATTERN, type CatalogModel, type ModelProtocol, type Provider } from '@coko/protocol'
import type { ProviderDraft } from '../../stores/settings-store.ts'

/** 供应商表单的草稿：各输入框的原文；提交时才整理为 store 的 ProviderDraft。 */
export interface FormDraft {
  providerId: string
  name: string
  api: ModelProtocol
  baseUrl: string
  /** 模型目录的过渡输入：逗号分隔的模型 ID，之后改为逐行编辑。 */
  modelText: string
  /** 编辑时为空表示保留原 Credential。 */
  secret: string
}

/** 有校验错误的字段；协议是单选，没有错误。 */
export type DraftField = Exclude<keyof FormDraft, 'api'>
export type DraftErrors = Partial<Record<DraftField, MessageKey>>

const PROVIDER_ID = new RegExp(PROVIDER_ID_PATTERN)

/** 新建表单：默认协议 OpenAI Chat Completions。 */
export const emptyDraft = (): FormDraft => ({ providerId: '', name: '', api: 'openai-completions', baseUrl: '', modelText: '', secret: '' })

/** 编辑表单的初始草稿：Key 输入框为空，不回填已保存的密钥（ADR 0004）。 */
export const draftOf = (provider: Provider): FormDraft => ({
  providerId: provider.id,
  name: provider.name,
  api: provider.api,
  baseUrl: provider.baseUrl,
  modelText: provider.models.map((m) => m.id).join(', '),
  secret: '',
})

export const isDirty = (draft: FormDraft, initial: FormDraft) => (Object.keys(initial) as (keyof FormDraft)[]).some((key) => draft[key] !== initial[key])

const parseModelIds = (text: string) => [...new Set(text.split(/[\s,]+/).filter(Boolean))]

const isHttpUrl = (text: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol)
  } catch {
    return false
  }
}

/** 提交前的字段校验（规格 4.2、4.3）：ID 格式与重复只在新建时检查；新建必须带 Key。 */
export function validateDraft(draft: FormDraft, { isNew, takenIds }: { isNew: boolean; takenIds: readonly string[] }): DraftErrors {
  const errors: DraftErrors = {}
  if (isNew && !PROVIDER_ID.test(draft.providerId)) errors.providerId = 'providers.idInvalid'
  else if (isNew && takenIds.includes(draft.providerId)) errors.providerId = 'providers.idTaken'
  if (draft.name.trim() === '') errors.name = 'providers.nameRequired'
  if (!isHttpUrl(draft.baseUrl.trim())) errors.baseUrl = 'providers.baseUrlInvalid'
  if (isNew && draft.secret.trim() === '') errors.secret = 'providers.credentialRequired'
  if (parseModelIds(draft.modelText).length === 0) errors.modelText = 'providers.modelsRequired'
  return errors
}

/** 由模型 ID 得到目录：已有模型保留其能力配置，新模型使用默认值。 */
const toCatalog = (ids: string[], existing: readonly CatalogModel[]): CatalogModel[] =>
  ids.map((id) => existing.find((m) => m.id === id) ?? { id, name: '', ...MODEL_CATALOG_DEFAULTS, input: ['text'], reasoning: false, thinkingLevels: [] })

/** 一次提交的内容：连接信息、目录与可选的 Key。 */
export function toProviderDraft(draft: FormDraft, provider?: Provider): ProviderDraft {
  return {
    id: provider?.id ?? draft.providerId,
    isNew: provider === undefined,
    name: draft.name.trim(),
    api: draft.api,
    baseUrl: draft.baseUrl.trim(),
    models: toCatalog(parseModelIds(draft.modelText), provider?.models ?? []),
    secret: draft.secret.trim(),
  }
}
