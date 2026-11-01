/** Bound a deal without changing timeouts for playback or other app requests.
 * Also reject if a buggy transport ignores abort, so late results cannot replace
 * the hand after the user has retried or left the table. */
export async function withHandDeadline<T>(load: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, milliseconds = 15_000): Promise<T> {
  if (parent.aborted) throw new DOMException('The deal was cancelled.', 'AbortError')
  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = () => controller.abort()
  let rejectAbort: () => void = () => {}
  const interrupted = new Promise<T>((_, reject) => {
    rejectAbort = () => {
      const error = timedOut
        ? Object.assign(new Error('The library took too long to answer. Try dealing again.'), { name: 'TimeoutError' })
        : new DOMException('The deal was cancelled.', 'AbortError')
      reject(error)
    }
  })
  controller.signal.addEventListener('abort', rejectAbort)
  parent.addEventListener('abort', forwardAbort)
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, milliseconds)
  try {
    return await Promise.race([
      Promise.resolve().then(() => load(controller.signal)),
      interrupted,
    ])
  } finally {
    clearTimeout(timer)
    controller.signal.removeEventListener('abort', rejectAbort)
    parent.removeEventListener('abort', forwardAbort)
  }
}
