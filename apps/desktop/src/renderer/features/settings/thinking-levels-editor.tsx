import type { ThinkingLevelConfig } from '@coko/protocol'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@coko/ui'
import { ChevronDownIcon, CircleHelpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { addLevel, changeLevel, levelChoices, nextLevel, removeLevel, setLevelValue } from './thinking-levels.ts'

/**
 * 模型选项中的推理设置（规格 4.5）：“推理等级”开关决定会话是否使用档位配置；档位按添加顺序列出，各有档位选择、
 * API 参数值与删除。开关关闭时档位仍可编辑并随草稿保存。档位名是协议值，按原文显示。
 */
export function ThinkingLevelsEditor({
  id,
  reasoning,
  levels,
  onChange,
}: {
  id: string
  reasoning: boolean
  levels: ThinkingLevelConfig[]
  onChange: (patch: { reasoning?: boolean; thinkingLevels?: ThinkingLevelConfig[] }) => void
}) {
  const { t } = useI18n()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const focusAfter = React.useRef<'last' | 'add' | null>(null)
  const titleId = `${id}-title`
  const levelHeader = `${id}-level`
  const valueHeader = `${id}-value`
  const full = nextLevel(levels) === undefined
  // 行身份与档位分开：修改某行档位时该行不重新挂载，焦点留在其选择器上。
  const keys = React.useRef<string[]>([])
  const keySeq = React.useRef(0)
  if (keys.current.length !== levels.length) keys.current = levels.map(() => `level-${++keySeq.current}`)

  // 添加后聚焦新档位的选择器（七档齐全时按钮禁用，焦点不落到 body）；删除后聚焦“添加档位”。
  React.useEffect(() => {
    const target = focusAfter.current
    if (!target) return
    focusAfter.current = null
    const selector = target === 'add' ? '[data-thinking-add]' : '[data-thinking-level]:last-child [data-thinking-select]'
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus()
  })

  const update = (thinkingLevels: ThinkingLevelConfig[], nextKeys = keys.current) => {
    keys.current = nextKeys
    onChange({ thinkingLevels })
  }

  return (
    <div ref={rootRef} role="group" aria-labelledby={titleId} className="flex flex-col gap-2">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span id={titleId} className="text-ui-body font-medium">
            {t('providers.thinking.title')}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label={t('providers.thinking.help')} className="inline-flex rounded-xs text-muted-foreground focus-ring">
                <CircleHelpIcon aria-hidden className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{t('providers.thinking.help')}</TooltipContent>
          </Tooltip>
        </div>
        <Switch name="reasoning" aria-labelledby={titleId} checked={reasoning} onCheckedChange={(next) => onChange({ reasoning: next })} />
      </div>
      {levels.length > 0 && (
        <>
          <div aria-hidden className="flex gap-2 text-ui-small text-muted-foreground">
            <span id={levelHeader} className="flex-1">
              {t('providers.thinking.level')}
            </span>
            <span id={valueHeader} className="flex-1">
              {t('providers.thinking.value')}
            </span>
            <span className="w-7 shrink-0" />
          </div>
          <ul className="flex flex-col gap-1.5">
            {levels.map((configured, index) => (
              <li key={keys.current[index]} data-thinking-level={configured.level} className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      data-thinking-select
                      type="button"
                      variant="outline"
                      aria-label={t('providers.thinking.level')}
                      className="min-w-0 flex-1 justify-between px-3 font-normal"
                    >
                      <span className="font-mono">{configured.level}</span>
                      <ChevronDownIcon className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
                    <DropdownMenuRadioGroup
                      value={configured.level}
                      onValueChange={(level) => update(changeLevel(levels, index, level as ThinkingLevelConfig['level']))}
                    >
                      {levelChoices(levels, index).map((level) => (
                        <DropdownMenuRadioItem key={level} value={level} data-thinking-choice={level} className="font-mono">
                          {level}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                {configured.level === 'off' ? (
                  // off 按协议的默认关闭方式请求，没有可自定义的参数。
                  <Input
                    name="thinkingValue"
                    aria-label={t('providers.thinking.value')}
                    disabled
                    placeholder={t('providers.thinking.offValue')}
                    className="flex-1 bg-muted"
                  />
                ) : (
                  <Input
                    name="thinkingValue"
                    aria-label={t('providers.thinking.value')}
                    value={configured.value}
                    placeholder={configured.level}
                    onChange={(e) => update(setLevelValue(levels, index, e.target.value))}
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 font-mono"
                  />
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={t('providers.thinking.remove')}
                      onClick={() => {
                        focusAfter.current = 'add'
                        update(
                          removeLevel(levels, index),
                          keys.current.filter((_, i) => i !== index),
                        )
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('providers.thinking.remove')}</TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        </>
      )}
      <div>
        <Button
          data-thinking-add
          type="button"
          variant="outline"
          size="sm"
          disabled={full}
          onClick={() => {
            focusAfter.current = 'last'
            update(addLevel(levels), [...keys.current, `level-${++keySeq.current}`])
          }}
        >
          <PlusIcon />
          {t('providers.thinking.add')}
        </Button>
      </div>
    </div>
  )
}
