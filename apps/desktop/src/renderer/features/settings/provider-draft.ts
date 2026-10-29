import type { MessageKey } from '@coko/i18n'
import { isHttpUrl, PROVIDER_ID_PATTERN, type ModelProtocol, type Provider } from '@coko/protocol'
import type { ProviderDraft } from '../../stores/settings-store.ts'
import { rowsOf, toCatalog, validateCatalog, type CatalogErrors, type ModelRowDraft } from './catalog-draft.ts'

/** 供应商表单的草稿：各输入框的原文；提交时才整理为 store 的 ProviderDraft。 */
export interface FormDraft {
  providerId: string
  name: string
  api: ModelProtocol
  baseUrl: string
  /** 模型目录的行草稿，按界面顺序。 */
  models: ModelRowDraft[]
  /** 编辑时为空表示保留原 Credential。 */
  secret: string
}

/** 有校验错误的字段；协议是单选，没有错误。models 的错误指空目录，行的错误在 catalog 中。 */
export type DraftField = Exclude<keyof FormDraft, 'api'>
export type DraftErrors = Partial<Record<DraftField, MessageKey>> & { catalog?: CatalogErrors }

const PROVIDER_ID = new RegExp(PROVIDER_ID_PATTERN)

/** 新建表单：默认协议 OpenAI Chat Completions。 */
export const emptyDraft = (): FormDraft => ({ providerId: '', name: '', api: 'openai-completions', baseUrl: '', models: [], secret: '' })

/** 编辑表单的初始草稿：Key 输入框为空，不回填已保存的密钥（ADR 0004）。 */
export const draftOf = (provider: Provider): FormDraft => ({
  providerId: provider.id,
  name: provider.name,
  api: provider.api,
  baseUrl: provider.baseUrl,
  models: rowsOf(provider.models),
  secret: '',
})

/** 目录的可比较内容：不含界面上的行身份 key。 */
const catalogContent = (rows: readonly ModelRowDraft[]) => JSON.stringify(rows.map(({ key: _key, ...content }) => content))

/** 草稿与初始值不同即有未保存修改；目录按行内容比较，删掉刚加的行后恢复为未修改。 */
export const isDirty = (draft: FormDraft, initial: FormDraft) =>
  (Object.keys(initial) as (keyof FormDraft)[]).some((key) =>
    key === 'models' ? catalogContent(draft.models) !== catalogContent(initial.models) : draft[key] !== initial[key],
  )

/** 提交前的字段校验（规格 4.2–4.5）：ID 格式与重复只在新建时检查；新建必须带 Key；目录不能为空，行的错误标在对应行。 */
export function validateDraft(draft: FormDraft, { isNew, takenIds }: { isNew: boolean; takenIds: readonly string[] }): DraftErrors {
  const errors: DraftErrors = {}
  if (isNew && !PROVIDER_ID.test(draft.providerId)) errors.providerId = 'providers.idInvalid'
  else if (isNew && takenIds.includes(draft.providerId)) errors.providerId = 'providers.idTaken'
  if (draft.name.trim() === '') errors.name = 'providers.nameRequired'
  if (!isHttpUrl(draft.baseUrl.trim())) errors.baseUrl = 'providers.baseUrlInvalid'
  if (isNew && draft.secret.trim() === '') errors.secret = 'providers.credentialRequired'
  if (draft.models.length === 0) errors.models = 'providers.modelsRequired'
  const catalog = validateCatalog(draft.models)
  if (Object.keys(catalog).length > 0) errors.catalog = catalog
  return errors
}

/** 一次提交的内容：连接信息、目录与可选的 Key。 */
export function toProviderDraft(draft: FormDraft, provider?: Provider): ProviderDraft {
  return {
    id: provider?.id ?? draft.providerId,
    isNew: provider === undefined,
    name: draft.name.trim(),
    api: draft.api,
    baseUrl: draft.baseUrl.trim(),
    models: toCatalog(draft.models),
    secret: draft.secret.trim(),
  }
}
