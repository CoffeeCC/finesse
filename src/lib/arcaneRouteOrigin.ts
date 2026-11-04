export interface ArcaneRouteOrigin { pathname: string; search: string; hash: string }
export function arcaneProjectionDepth(state: unknown): number {
  const depth = state && typeof state === 'object' && 'arcaneProjectionDepth' in state ? state.arcaneProjectionDepth : null
  return typeof depth === 'number' && Number.isSafeInteger(depth) && depth >= 1 && depth <= 1000 ? depth : 1
}
/** Only implemented tabletop surfaces can remain behind a routed apparition. */
export function arcaneRouteOrigin(state: unknown): ArcaneRouteOrigin | null {
  if (!state || typeof state !== 'object' || !('arcaneTableOrigin' in state)) return null
  const origin = state.arcaneTableOrigin
  if (!origin || typeof origin !== 'object' || !('pathname' in origin) || typeof origin.pathname !== 'string') return null
  if (!/^(?:\/|\/dashboard|\/mylist|\/library\/[\w-]+)$/.test(origin.pathname)) return null
  const search = 'search' in origin && typeof origin.search === 'string' && origin.search.startsWith('?') ? origin.search : ''
  return { pathname: origin.pathname, search, hash: '' }
}
