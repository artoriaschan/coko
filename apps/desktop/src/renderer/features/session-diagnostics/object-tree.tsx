// Adapted from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import type { GroupingModel, ObjectReference } from './grouping-model.ts'
import { InspectorObjectValue, type InspectorObjectEntry } from './object-value.ts'

interface BranchProps {
  value: unknown
  name: string
  path: string
  ancestors: ReadonlyMap<object, string>
  model: GroupingModel
  navigate: (reference: ObjectReference) => void
  root?: boolean
  accessor?: boolean
  absent?: boolean
}
const PAGE_SIZE = 50
function ObjectBranch({ value, name, path, ancestors, root, accessor, absent, model, navigate }: BranchProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = React.useState(root === true)
  const [limit, setLimit] = React.useState(PAGE_SIZE)
  const content = React.useMemo(() => {
    try {
      const reference = !root && value !== null && typeof value === 'object' ? model.objects.get(value) : undefined
      const circular = value !== null && typeof value === 'object' ? ancestors.get(value) : undefined
      const display = reference === undefined && circular === undefined && !accessor ? new InspectorObjectValue(value) : undefined
      const entries: InspectorObjectEntry[] = []
      if (expanded && display?.expandable)
        for (const entry of display.entries()) {
          entries.push(entry)
          if (entries.length > limit) break
        }
      return { reference, circular, display, entries, failed: false }
    } catch {
      return { failed: true }
    }
  }, [value, root, model, ancestors, accessor, expanded, limit])
  const children = React.useMemo(() => {
    const next = new Map(ancestors)
    if (value !== null && typeof value === 'object') next.set(value, path)
    return next
  }, [ancestors, value, path])
  const field = <span className="text-muted-foreground">{name}: </span>
  if (absent)
    return (
      <li>
        {field}
        {t('diagnostics.objectAbsent')}
      </li>
    )
  if (accessor)
    return (
      <li>
        {field}
        {t('diagnostics.objectAccessor')}
      </li>
    )
  if (content.failed)
    return (
      <li role="alert">
        {field}
        {t('diagnostics.objectFailed')}
      </li>
    )
  if (content.circular !== undefined)
    return (
      <li>
        {field}↩ {content.circular}
      </li>
    )
  if (content.reference)
    return (
      <li>
        {field}
        <ReferenceButton reference={content.reference} navigate={navigate} />
      </li>
    )
  const display = content.display!
  if (!display.expandable)
    return (
      <li>
        {field}
        {display.label}
      </li>
    )
  return (
    <li>
      <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="cursor-pointer">
          {field}
          <span className="text-muted-foreground">{display.label}</span>
        </summary>
        {expanded && (
          <ul className="ps-4">
            {content.entries!.slice(0, limit).map(({ key, properties, ...entry }) => (
              <ObjectBranch
                key={key}
                {...entry}
                name={properties ? t('diagnostics.objectProperties') : entry.name}
                path={properties ? path : `${path}.${entry.name}`}
                ancestors={children}
                model={model}
                navigate={navigate}
              />
            ))}
            {content.entries!.length === 0 && <li className="text-muted-foreground">{t('diagnostics.objectEmpty')}</li>}
            {content.entries!.length > limit && (
              <li>
                <button className="text-link focus-ring hover:underline" type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
                  {t('diagnostics.objectMore')}
                </button>
              </li>
            )}
          </ul>
        )}
      </details>
    </li>
  )
}
/** Reference buttons retain object identity and resolve the current value on every publication. */
export function ReferenceButton({ reference, navigate }: { reference: ObjectReference; navigate: (reference: ObjectReference) => void }) {
  const { t } = useI18n()
  return (
    <button type="button" className="text-link focus-ring hover:underline" onClick={() => navigate(reference)}>
      {t(`diagnostics.reference.${reference.kind}`)} · {reference.identity}
    </button>
  )
}
/** Getter-free lazy tree, paged by 50 entries and invalidated by mounted projection publications. */
export function ObjectTree({ value, model, navigate }: { value: unknown; model: GroupingModel; navigate: (reference: ObjectReference) => void }) {
  const ancestors = React.useMemo(() => new Map<object, string>(), [])
  return (
    <ul className="break-all">
      <ObjectBranch value={value} model={model} navigate={navigate} name="$" path="$" ancestors={ancestors} root />
    </ul>
  )
}
