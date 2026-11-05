// Substitute only the external network boundary inside the isolated Sidecar process.
// The configured Provider URL and installed pi capability catalog remain real.
const source = process.env.COKO_FIXTURE_MODEL_ORIGIN
const target = process.env.COKO_FIXTURE_MODEL_TARGET
if (source && target) {
  const fetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.origin === source) {
      const redirected = target + url.pathname + url.search
      return fetch(input instanceof Request ? new Request(redirected, input) : redirected, init)
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('Unexpected external fixture request')
    return fetch(input, init)
  }
}
