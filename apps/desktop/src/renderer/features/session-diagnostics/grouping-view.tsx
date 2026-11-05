import { useTimelineNavigation } from './use-timeline-navigation.tsx'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { subscribeTimelineProjection, timelineProjection } from '../conversation/timeline-projection.ts'
import { DiagnosticTable } from './diagnostic-table.tsx'
import { buildGroupingModel, sameGroupingValue, type ObjectReference, type GroupingModel } from './grouping-model.ts'
import { ObjectTree, ReferenceButton } from './object-tree.tsx'

function GroupingDetails({
  model,
  rootKey,
  path,
  navigate,
  back,
}: {
  model: GroupingModel
  rootKey: string
  path: readonly string[]
  navigate: (reference: ObjectReference) => void
  back: (index: number) => void
}) {
  const { t } = useI18n()
  const steps = [rootKey, ...path]
  const current = model.references.get(steps.at(-1)!)
  return (
    <>
      <nav aria-label={t('diagnostics.inspectionPath')} className="mb-2 flex flex-wrap gap-2">
        {steps.map((key, index) => (
          <button
            type="button"
            className="text-link focus-ring hover:underline"
            key={`${index}:${key}`}
            aria-current={index === steps.length - 1 ? 'page' : undefined}
            onClick={() => back(index)}
          >
            {model.references.get(key)?.identity ?? key}
          </button>
        ))}
      </nav>
      {!current ? (
        <p role="status">{t('diagnostics.removed')}</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1" aria-label={t('diagnostics.references')}>
            {(model.related.get(current.key) ?? []).map((key) => {
              const ref = model.references.get(key)
              return ref ? <ReferenceButton key={key} reference={ref} navigate={navigate} /> : null
            })}
          </div>
          <ObjectTree value={current.value} model={model} navigate={navigate} />
        </>
      )}
    </>
  )
}
/** Current-main projection subscriber; navigation and disclosure stay local to this table. */
export function GroupingView({ sessionId, toolbar }: { sessionId: string | null; toolbar: React.ReactNode }) {
  const projection = React.useSyncExternalStore(subscribeTimelineProjection, () => timelineProjection(sessionId))
  const model = React.useMemo(() => buildGroupingModel(projection), [projection])
  const navigation = useTimelineNavigation(sessionId, model.targets)
  React.useEffect(() => {
    if (navigation.revealRequest) setReveal(navigation.revealRequest)
  }, [navigation.revealRequest])
  const [path, setPath] = React.useState<readonly string[]>([])
  const [revealRequest, setReveal] = React.useState<import('./diagnostic-table.tsx').DiagnosticTableRevealRequest>()
  const [changedKeys, setChangedKeys] = React.useState<ReadonlyMap<string, { at: number }>>(new Map())
  const previous = React.useRef<GroupingModel | undefined>(undefined)
  React.useLayoutEffect(() => {
    const before = previous.current
    previous.current = model
    if (!before) return
    const changes = new Set([...model.records].filter(([key, record]) => !sameGroupingValue(before.records.get(key)?.value, record.value)).map(([key]) => key))
    if (changes.size === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setChangedKeys((previous) => {
      const next = new Map([...previous].filter(([key]) => model.records.has(key)))
      for (const key of changes) next.set(key, { at: Date.now() })
      return next
    })
  }, [model])
  const navigate = (reference: ObjectReference) => {
    navigation.locate(reference.target)
    setPath((previous) => [...previous, reference.key])
    if (reference.rowKey) setReveal({ key: reference.rowKey, nonce: {} })
  }
  return (
    <DiagnosticTable
      model={model}
      showTime={false}
      toolbar={
        <>
          {toolbar}
          {navigation.picker}
        </>
      }
      revealRequest={revealRequest}
      changedKeys={changedKeys}
      onSelect={(key) => {
        setPath([])
        navigation.select(key)
      }}
      renderDetails={(_record, key) => (
        <GroupingDetails
          model={model}
          rootKey={key}
          path={path}
          navigate={navigate}
          back={(index) => {
            setPath((previous) => previous.slice(0, index))
            const reference = model.references.get(index === 0 ? key : path[index - 1]!)
            navigation.locate(reference?.target)
            if (reference?.rowKey) setReveal({ key: reference.rowKey, nonce: {} })
          }}
        />
      )}
    />
  )
}
