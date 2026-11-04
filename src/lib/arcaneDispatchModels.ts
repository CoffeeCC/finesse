import type { Group } from 'three'

const assets = {
  retry: () => import('../assets/card-table/dispatch-courier-horn-v1.glb?url'),
  pause: () => import('../assets/card-table/dispatch-escapement-v1.glb?url'),
  cancel: () => import('../assets/card-table/dispatch-shears-v1.glb?url'),
}
/** Stream visible ledger tools into the existing scene, and release them when their page closes. */
export function watchDispatchModels(scope: HTMLElement, load: (url: string, selector: string) => Promise<Group | null>, remove: (root: Group) => void, place: () => void) {
  const slots = new Map<string, { root?: Group }>()
  let live = true, frame = 0
  const scan = () => {
    if (!live) return
    const current = new Set<string>()
    for (const anchor of scope.querySelectorAll<HTMLElement>('[data-dispatch-model]')) {
      const kind = anchor.dataset.dispatchModel as keyof typeof assets
      const key = anchor.closest<HTMLElement>('[data-arcane-download-key]')?.dataset.arcaneDownloadKey
      if (!(kind in assets) || !key) continue
      const selector = `[data-arcane-download-key="${CSS.escape(key)}"] .dispatch-${kind}-art`
      current.add(selector)
      if (slots.has(selector)) continue
      const bounds = anchor.getBoundingClientRect(), page = anchor.closest('.collection-index-writing')?.getBoundingClientRect()
      if (!bounds.width || !bounds.height || page && (bounds.bottom < page.top - 100 || bounds.top > page.bottom + 100)) continue
      const slot: { root?: Group } = {}; slots.set(selector, slot)
      void assets[kind]().then(url => load(url.default, selector)).then(root => {
        if (!root) { if (slots.get(selector) === slot) slots.delete(selector); return }
        if (!live || slots.get(selector) !== slot || !anchor.isConnected) { remove(root); return }
        slot.root = root; place()
      }).catch(() => { if (slots.get(selector) === slot) slots.delete(selector) })
    }
    for (const [selector, slot] of slots) if (!current.has(selector)) { if (slot.root) remove(slot.root); slots.delete(selector) }
  }
  const schedule = () => {
    if (frame || !live) return
    frame = requestAnimationFrame(() => { frame = 0; scan(); place() })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(scope, { childList: true, subtree: true })
  scope.addEventListener('scroll', schedule, true); scan()
  return () => {
    if (!live) return
    live = false; observer.disconnect(); scope.removeEventListener('scroll', schedule, true)
    if (frame) cancelAnimationFrame(frame)
    slots.forEach(slot => { if (slot.root) remove(slot.root) }); slots.clear()
  }
}
