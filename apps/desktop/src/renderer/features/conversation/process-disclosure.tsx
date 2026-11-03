import * as React from 'react'

/** Only an explicit outer collapse resets inner disclosures; settlement never changes this epoch. */
export const ProcessDisclosureReset = React.createContext(0)
export function useProcessDisclosure(defaultOpen = false): [boolean, (open: boolean) => void] {
  const epoch = React.useContext(ProcessDisclosureReset)
  const [state, setState] = React.useState({ epoch, open: defaultOpen })
  if (state.epoch !== epoch) setState({ epoch, open: false })
  return [state.epoch === epoch && state.open, (open) => setState({ epoch, open })]
}

/** Portaled interactions retain their process trigger without relying on portal DOM ancestry. */
export const ProcessFocusLock = React.createContext<() => () => void>(() => () => {})
export function useProcessFocusLock(active: boolean): void {
  const acquire = React.useContext(ProcessFocusLock)
  React.useLayoutEffect(() => (active ? acquire() : undefined), [active, acquire])
}
