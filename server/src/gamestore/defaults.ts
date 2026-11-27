// The sources a server sets up when the game store is turned on with nothing plugged in. This is
// the only place the names of actual sites live: everything that reads them (feed.ts) works from
// the address and the rules alone and knows no site by name. These two follow the common
// post-list conventions, so no per-source rules are needed. An administrator can remove or change
// these in Settings, and adding your own source (any site, any rules) is the same as before.

import type { FeedConfig } from './feed.ts'

export const DEFAULT_FEEDS: FeedConfig[] = [
  { id: 'fitgirl', name: 'FitGirl Repacks', url: 'https://fitgirl-repacks.site', kind: 'posts' },
  { id: 'dodi', name: 'DODI Repacks', url: 'https://dodi-repacks.site', kind: 'posts' },
]
