import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './arcaneSceneLayout.css'

const Layout = createContext({ immersive: false, register: () => () => {} })
/** A mounted physical workspace owns the viewport; standard themes keep their chrome. */
export function ArcaneSceneLayout({ children }: { children: ReactNode }) {
  const owners = useRef(new Set<symbol>()), [immersive, setImmersive] = useState(false)
  const register = useCallback(() => {
    const owner = Symbol('arcane-workspace'); owners.current.add(owner); setImmersive(true)
    return () => { owners.current.delete(owner); setImmersive(owners.current.size > 0) }
  }, [])
  const value = useMemo(() => ({ immersive, register }), [immersive, register])
  return <Layout.Provider value={value}>{children}</Layout.Provider>
}
export function useArcaneSceneLayout() { return useContext(Layout).immersive }
export function useArcaneWorkspace(enabled = true) {
  const { register } = useContext(Layout)
  useLayoutEffect(() => enabled ? register() : undefined, [enabled, register])
}
