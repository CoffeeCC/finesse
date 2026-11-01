import { Component, type ReactNode } from 'react'

/**
 * A page that couldn't load (its file didn't arrive: offline, or the server is mid-update)
 * says so with a way to try again, instead of leaving a blank screen. Keyed by the page, so
 * going somewhere else starts fresh.
 */
export class PageError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    console.error('page failed', e)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex min-h-[calc(var(--vh)*60)] items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <p className="font-display text-4xl text-white">This page didn’t load</p>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-300">Check the connection to your server, then try again. If Finesse just updated, trying again picks up the new version.</p>
          <button type="button" data-autofocus onClick={() => window.location.reload()} className="mt-6 inline-flex h-11 items-center rounded-lg bg-white px-5 text-sm font-semibold text-ink-950 hover:bg-ink-200">
            Try again
          </button>
        </div>
      </div>
    )
  }
}
