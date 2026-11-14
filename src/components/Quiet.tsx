import { Component, type ReactNode } from 'react'

/**
 * An extra that sits on every screen (the Moments bell, party invites, the quick menu, the mini
 * player) must never take the screen down with it. If one fails, it simply isn't shown, the page
 * carries on, and it gets another go when you move to another page (give it a changing `key`).
 */
export class Quiet extends Component<{ children: ReactNode; name?: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    console.error(`${this.props.name ?? 'an extra'} failed and was hidden`, e)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
