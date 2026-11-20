import type { CommandInfo, CommandSource } from '@coko/protocol'
import { ComposerTypeahead, type ComposerTypeaheadItem } from '@coko/ui'
import * as React from 'react'
import { useStore } from 'zustand'
import { useI18n } from '../../app/i18n.tsx'
import { commandsStore as defaultStore, targetKey, type CommandTarget, type CommandsStore } from '../../stores/commands-store.ts'

/** 菜单分组：五个来源，加上插件贡献的命令与 Skill 所在的“插件”组（Skill 之后、MCP 之前）。 */
const GROUPS: readonly (CommandSource | 'plugin')[] = ['builtin', 'project', 'user', 'skill', 'plugin', 'mcp']
const groupOf = (command: CommandInfo) => (command.plugin === undefined ? command.source : 'plugin')

/** 菜单顺序（也是 ↑↓ 的顺序）：按分组；“插件”组内按名字，其余各组保持目录顺序。 */
const menuOrder = (commands: readonly CommandInfo[]): CommandInfo[] =>
  commands.toSorted((a, b) => {
    const byGroup = GROUPS.indexOf(groupOf(a)) - GROUPS.indexOf(groupOf(b))
    if (byGroup !== 0 || a.plugin === undefined) return byGroup
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })

/** 前缀匹配在前，其余包含查询的随后；都保持传入的顺序。停用的命令不出现。 */
export function matchCommands(commands: readonly CommandInfo[], query: string): CommandInfo[] {
  const q = query.toLowerCase()
  const enabled = commands.filter((c) => c.enabled)
  const prefix = enabled.filter((c) => c.name.toLowerCase().startsWith(q))
  const rest = enabled.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))
  return [...prefix, ...rest]
}

export interface CommandMenuProps {
  target: CommandTarget
  /** 测试注入；缺省应用内共用的 store。 */
  store?: CommandsStore
}

/**
 * composer 的 / 命令菜单：只在草稿开头触发，按来源分组（带插件名的条目归入“插件”组），显示 argument-hint 与描述，选中插入 "/name "（不做 chip）。
 * 作用域变化与编辑区获得焦点时刷新目录，使新建或修改的命令文件在下一次输入 / 时出现。
 */
export function CommandMenu({ target, store = defaultStore }: CommandMenuProps) {
  const { t } = useI18n()
  const key = targetKey(target)
  const catalog = useStore(store, (s) => (s.key === key ? s.commands : EMPTY))
  const commands = React.useMemo(() => menuOrder(catalog), [catalog])
  const targetRef = React.useRef(target)
  targetRef.current = target
  React.useEffect(() => {
    void store.getState().load(targetRef.current)
  }, [store, key])
  const groups = React.useMemo(() => GROUPS.map((id) => ({ id, label: id === 'plugin' ? t('commands.pluginGroup') : t(`commands.source.${id}`) })), [t])
  const getItems = React.useCallback(
    (query: string): ComposerTypeaheadItem[] =>
      matchCommands(commands, query).map((c) => ({
        key: c.name,
        label: `/${c.name}`,
        ...(c.argumentHint ? { hint: c.argumentHint } : {}),
        ...(c.description ? { description: c.description } : {}),
        group: groupOf(c),
      })),
    [commands],
  )
  const onSelect = React.useCallback((item: ComposerTypeaheadItem) => `/${item.key} `, [])
  return (
    <ComposerTypeahead
      trigger="/"
      position="start"
      getItems={getItems}
      groups={groups}
      onSelect={onSelect}
      onFocus={() => void store.getState().load(targetRef.current)}
      label={t('commands.menuLabel')}
    />
  )
}

const EMPTY: CommandInfo[] = []
