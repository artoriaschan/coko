// Session 的模型与 Thinking Level：默认模型、档位校验与有效档位、切换模型、上下文用量接口的模型。
import type { Model } from '@earendil-works/pi-ai'
import { ModelConfigError, resolveModel, selectableThinkingLevels, type ModelRegistry } from '@coko/agent'
import { DEFAULT_MODEL_SETTING, SessionModel as SessionModelSchema, type SessionModel, type ThinkingLevel } from '@coko/protocol'
import type { Session as StoredSession, SessionStore } from '@coko/session'
import { Value } from 'typebox/value'
import { AppError } from './errors.ts'
import { catalogOf } from './providers.ts'
import type { SessionRuntimes } from './session-runtimes.ts'
import { requireSession } from './session-runtimes.ts'

export interface SessionModelsOptions {
  store: SessionStore
  registry: ModelRegistry
  runtimes: SessionRuntimes
  /** 没有设置默认模型时优先使用（faux provider 开启时）。 */
  fallbackModel?: SessionModel
}

export class SessionModels {
  readonly #options: SessionModelsOptions

  constructor(options: SessionModelsOptions) {
    this.#options = options
  }

  /** 保存的档位在当前模型下仍可选时使用它，否则为 off（模型已不可用或目录已不再配置该档位）。 */
  effectiveLevel(session: Pick<StoredSession, 'model' | 'thinkingLevel'>): ThinkingLevel {
    const level = session.thinkingLevel
    if (level === 'off' || !session.model) return 'off'
    const model = this.#options.registry.models.getModel(session.model.providerId, session.model.modelId)
    return model && selectableThinkingLevels(model).includes(level) ? level : 'off'
  }

  /** 给出的档位必须是该模型可选的档位（bad-request）。 */
  #checkLevel(model: Model<any>, level: ThinkingLevel): void {
    if (!selectableThinkingLevels(model).includes(level)) throw new AppError('bad-request', `Model ${model.id} has no thinking level ${level}`)
  }

  resolve(model: SessionModel, code: 'bad-request' | 'model-not-configured'): Model<any> {
    try {
      return resolveModel(this.#options.registry, model.providerId, model.modelId)
    } catch (error) {
      if (error instanceof ModelConfigError) throw new AppError(code, error.message)
      throw error
    }
  }

  /** 新 Session 的模型与档位：给出的模型须可解析，否则取默认模型；非 off 的档位须是该模型可选的。 */
  async initial(input: { model?: SessionModel; thinkingLevel?: ThinkingLevel }): Promise<{ model: SessionModel | undefined; thinkingLevel: ThinkingLevel }> {
    if (input.model) this.resolve(input.model, 'bad-request')
    const model = input.model ?? (await this.defaultModel())
    const thinkingLevel = input.thinkingLevel ?? 'off'
    if (thinkingLevel !== 'off') {
      if (!model) throw new AppError('bad-request', `No model to use thinking level ${thinkingLevel}`)
      this.#checkLevel(this.resolve(model, 'bad-request'), thinkingLevel)
    }
    return { model, thinkingLevel }
  }

  /** 设置 defaultModel → faux（测试）→ 第一个 Provider 的第一个模型；都不可用时为 undefined。 */
  async defaultModel(): Promise<SessionModel | undefined> {
    const setting = await this.#options.store.settings.get(DEFAULT_MODEL_SETTING)
    const candidates: unknown[] = [setting?.value, this.#options.fallbackModel]
    for (const provider of await this.#options.store.providers.list()) {
      const first = catalogOf(provider)[0]
      if (first) candidates.push({ providerId: provider.id, modelId: first.id })
    }
    for (const candidate of candidates) {
      if (!Value.Check(SessionModelSchema, candidate)) continue
      if (this.#options.registry.models.getModel(candidate.providerId, candidate.modelId))
        return { providerId: candidate.providerId, modelId: candidate.modelId }
    }
    return undefined
  }

  /** 上下文用量接口的模型：给定的 Session 模型，否则缺省模型；都不能解析时 undefined。 */
  async contextModel(model: SessionModel | null | undefined): Promise<Model<any> | undefined> {
    const chosen = model ?? (await this.defaultModel())
    if (!chosen) return undefined
    try {
      return resolveModel(this.#options.registry, chosen.providerId, chosen.modelId)
    } catch (error) {
      if (error instanceof ModelConfigError) return undefined
      throw error
    }
  }

  /**
   * 模型与 Thinking Level 一起切换并写入 Session。给出的档位该模型不能选时 bad-request；未给出时保留当前档位，新模型不能选它时
   * 回到 off。Run 进行中 run-in-progress。
   */
  async setModel(sessionId: string, model: SessionModel, thinkingLevel?: ThinkingLevel): Promise<StoredSession> {
    const current = await requireSession(this.#options.store, sessionId)
    const resolved = this.resolve(model, 'bad-request')
    let level: ThinkingLevel
    if (thinkingLevel === undefined) {
      const kept = current.thinkingLevel
      level = selectableThinkingLevels(resolved).includes(kept) ? kept : 'off'
    } else {
      this.#checkLevel(resolved, thinkingLevel)
      level = thinkingLevel
    }
    const runtime = this.#options.runtimes.get(sessionId)
    if (runtime?.isRunning) throw new AppError('run-in-progress', 'A Run is in progress')
    const session = await this.#options.store.sessions.setSessionModel(sessionId, { model, thinkingLevel: level })
    runtime?.setModel(resolved)
    runtime?.setThinkingLevel(level)
    return session
  }
}
