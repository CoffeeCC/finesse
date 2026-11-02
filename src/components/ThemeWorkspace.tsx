import { lazy, Suspense, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useTheme } from '../lib/theme'
const Correspondence = __WEBOS__ ? null : lazy(() => import('./ArcaneCorrespondence'))
export default function ThemeWorkspace({ children }: { children: ReactNode }) {
  const theme = useTheme(), { pathname } = useLocation()
  const correspondence = ['/request', '/friends', '/activity', '/moments', '/together'].some((path) => pathname === path || pathname.startsWith(`${path}/`))
  if (theme !== 'card-table' || !Correspondence || !correspondence) return <>{children}</>
  return <Suspense fallback={children}><Correspondence>{children}</Correspondence></Suspense>
}
