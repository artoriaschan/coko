/** Shared theme registration supplies milliseconds to both CSS and browser animation/timer consumers. */
export function diagnosticMotion(element: Element) {
  const style = getComputedStyle(element)
  return {
    duration: Number.parseFloat(style.getPropertyValue('--local-diagnostic-highlight-duration')),
    easing: style.getPropertyValue('--local-diagnostic-highlight-easing').trim(),
  }
}
