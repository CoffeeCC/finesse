import home from '../assets/card-table/home-waystone-v1-still.webp'
import search from '../assets/card-table/scrying-orb-still-v1.webp'
import movies from '../assets/card-table/deck-movies-still-v1.webp'
import shows from '../assets/card-table/deck-shows-still-v1.webp'
import library from '../assets/card-table/archive-chest-v1-still.webp'
import mylist from '../assets/card-table/story-codex-v1-still.webp'
import anime from '../assets/card-table/fox-mask-v1-still.webp'
import music from '../assets/card-table/silver-lyre-v1-still.webp'
import games from '../assets/card-table/obsidian-die-v1-still.webp'
import friends from '../assets/card-table/linked-rings-v1-still.webp'
import collections from '../assets/card-table/collection-folio-v1-still.webp'
import together from '../assets/card-table/gathering-brazier-v1-still.webp'
import moments from '../assets/card-table/memory-vessel-v1-still.webp'
import smart from '../assets/card-table/oracle-prism-v1-still.webp'
import requests from '../assets/card-table/dispatch-seal-v1-still.webp'
import activity from '../assets/card-table/chronicle-hourglass-v1-still.webp'
import settings from '../assets/card-table/artificer-armillary-v1-still.webp'
import remote from '../assets/card-table/command-wand-v1-still.webp'
import desk from '../assets/card-table/desk-key-v1-still.webp'
import lightingReset from '../assets/card-table/lighting-tuning-fork-v1-still.webp'
import lightingDrawerPull from '../assets/card-table/drawer-pull-v1-still.webp'

/** A function owns its object identity. Never fall back to another function's prop. */
export const arcaneTrinkets = { home, search, movies, shows, library, mylist, anime, music, games, friends, collections, together, moments, smart, requests, activity, settings, remote, desk, lightingReset, lightingDrawerPull } as const
export type ArcaneTrinket = keyof typeof arcaneTrinkets
export function destinationTrinket(destination: string): ArcaneTrinket | null {
  if (destination === '/' || destination === '/dashboard') return 'home'
  if (destination.startsWith('/browse?')) return destination.includes('tags=anime') ? 'anime' : destination.includes('BoxSet') ? 'collections' : null
  const path = destination.split('?')[0].split('/')[1]
  const routes: Record<string, ArcaneTrinket> = { libraries: 'library', mylist: 'mylist', search: 'search', music: 'music', album: 'music', games: 'games', friends: 'friends', together: 'together', moments: 'moments', smart: 'smart', request: 'requests', activity: 'activity', settings: 'settings', remote: 'remote' }
  return routes[path] ?? null
}
