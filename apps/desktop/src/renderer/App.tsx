import { useEffect, useState } from 'react'
import { connect, type ConnectionState } from './connection.ts'
import { rendererMessages } from './messages.ts'

export function App() {
  const [state, setState] = useState<ConnectionState>({ phase: 'connecting', locale: navigator.language })
  useEffect(() => connect(window.coko, navigator.language, setState), [])
  const text = rendererMessages(state.locale)
  return (
    <main className="status" data-window-drag="">
      <p className="status-label" role="status" data-connection={state.phase}>
        {text[state.phase]}
      </p>
      {state.phase === 'failed' && (
        <p className="status-detail" data-error-code={state.code}>
          {state.message}
        </p>
      )}
    </main>
  )
}
