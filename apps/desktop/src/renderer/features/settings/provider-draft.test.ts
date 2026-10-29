// 供应商表单草稿：目录行参与未保存修改的判断、提交前校验与一次提交的内容。
import type { Provider } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { emptyModelRow } from './catalog-draft.ts'
import { draftOf, emptyDraft, isDirty, toProviderDraft, validateDraft, type FormDraft } from './provider-draft.ts'

const provider: Provider = {
  id: 'custom-provider-1',
  name: '自定义供应商一',
  api: 'openai-completions',
  baseUrl: 'https://gateway.example/v1',
  models: [{ id: 'custom-model-1', name: '自定义模型一', contextWindow: 1_000_000, maxTokens: 128_000, input: ['text'], reasoning: false, thinkingLevels: [] }],
  credential: { hint: '1111' },
  createdAt: 1,
  updatedAt: 1,
}

const valid = (draft: FormDraft): FormDraft => ({ ...draft, providerId: 'custom-provider-2', name: 'n', baseUrl: 'https://gateway.example/v1', secret: 'sk-2' })

describe('未保存修改', () => {
  it('同一 Provider 的两份初始草稿相同（行身份不参与比较）', () => {
    expect(isDirty(draftOf(provider), draftOf(provider))).toBe(false)
    expect(isDirty(emptyDraft(), emptyDraft())).toBe(false)
  })

  it('添加、修改或删除模型行算作修改；删掉刚加的行后恢复为未修改', () => {
    const initial = draftOf(provider)
    const added = { ...initial, models: [...initial.models, emptyModelRow()] }
    expect(isDirty(added, initial)).toBe(true)
    expect(isDirty({ ...added, models: added.models.slice(0, 1) }, initial)).toBe(false)
    expect(isDirty({ ...initial, models: [{ ...initial.models[0]!, maxTokens: '64K' }] }, initial)).toBe(true)
    expect(isDirty({ ...initial, models: [{ ...initial.models[0]!, input: ['text', 'image'] }] }, initial)).toBe(true)
    expect(isDirty({ ...initial, models: [] }, initial)).toBe(true)
  })
})

describe('提交前校验', () => {
  it('空目录报在目录上；有问题的行报在对应行', () => {
    expect(validateDraft(valid(emptyDraft()), { isNew: true, takenIds: [] })).toEqual({ models: 'providers.modelsRequired' })
    const blank = emptyModelRow()
    const draft = { ...valid(emptyDraft()), models: [{ ...emptyModelRow(), id: 'custom-model-1' }, blank] }
    expect(validateDraft(draft, { isNew: true, takenIds: [] })).toEqual({ catalog: { [blank.key]: { id: 'providers.catalog.idRequired' } } })
  })
})

describe('一次提交', () => {
  it('编辑：目录按行提交，已有模型的容量不变，新增行用默认值', () => {
    const initial = draftOf(provider)
    const draft = { ...initial, models: [...initial.models, { ...emptyModelRow(), id: 'custom-model-2' }] }
    expect(toProviderDraft(draft, provider).models).toEqual([
      provider.models[0],
      { id: 'custom-model-2', name: '', contextWindow: 128_000, maxTokens: 16_000, input: ['text'], reasoning: false, thinkingLevels: [] },
    ])
  })
})
