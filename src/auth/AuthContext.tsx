import { createContext, useContext, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'
import type { Session } from '../api/client'

interface AuthState {
  session: Session | null
  login: (server: string, username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(api.getSession())
  const queryClient = useQueryClient()

  const login = async (server: string, username: string, password: string) => {
    const s = await api.login(server.replace(/\/+$/, ''), username, password)
    setSessionState(s)
  }

  const logout = () => {
    api.logout()
    setSessionState(null)
    queryClient.clear()
  }

  return <AuthContext.Provider value={{ session, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
