import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'
import type { Session } from '../api/client'
import { useFinesse } from '../lib/finesseServer'
import { hasPendingHandoff, redeemHttpsHandoff, trySilentHttpsUpgrade } from '../lib/httpsHandoff'
import { resetPreviewState } from '../lib/preview'

interface AuthState {
  session: Session | null
  login: (server: string, username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(api.getSession())
  const [handingOff, setHandingOff] = useState<boolean>(() => !api.getSession() && hasPendingHandoff())
  const { info } = useFinesse()
  const queryClient = useQueryClient()

  // Redeem a one-time HTTP → HTTPS session handoff if present in the URL hash.
  useEffect(() => {
    if (!hasPendingHandoff()) return
    let alive = true
    void redeemHttpsHandoff()
      .then((restored) => {
        if (alive && restored) setSessionState(restored)
      })
      .finally(() => {
        if (alive) setHandingOff(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // Silently upgrade from HTTP to HTTPS when this browser already trusts Finesse's certificate.
  useEffect(() => {
    if (!info?.httpsPort || handingOff) return
    void trySilentHttpsUpgrade(info.httpsPort)
  }, [info?.httpsPort, handingOff])

  const login = useCallback(async (server: string, username: string, password: string) => {
    const s = await api.login(server.replace(/\/+$/, ''), username, password)
    setSessionState(s)
  }, [])

  const logout = useCallback(() => {
    api.logout()
    resetPreviewState()
    setSessionState(null)
    queryClient.clear()
  }, [queryClient])

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout])

  if (handingOff) return <div className="min-h-screen bg-ink-950" aria-busy="true" />

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
