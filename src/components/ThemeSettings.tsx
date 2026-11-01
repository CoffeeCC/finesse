import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ThemePicker from './ThemePicker'
import { setTheme, setThemeEffects, useTheme, useThemeEffects } from '../lib/theme'
import guide from '../../docs/THEME-AUTHORING.md?raw'

export default function ThemeSettings() {
  const theme = useTheme()
  const effects = useThemeEffects()
  const [guideUrl, setGuideUrl] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([guide], { type: 'text/markdown;charset=utf-8' }))
    setGuideUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [])
  return <div className="theme-settings">
    <p className="theme-section-intro">Make Finesse feel like your space. Themes are saved in this browser; your account accent stays yours.</p>
    <ThemePicker />
    <div className="theme-settings-actions"><Link to="/">Try your theme</Link><button type="button" onClick={() => setTheme('default')}>Restore Finesse</button></div>
    {theme === 'card-table' && <div className="theme-effects-setting">
      <div><strong>Live 3D objects</strong><p>The search orb and library deck boxes use lit 3D models with subtle effects. Turn this off to use the still artwork. Reduced motion and TV also use the stills.</p><small>This browser</small></div>
      <button type="button" role="switch" aria-label="Live 3D objects" aria-checked={effects} onClick={() => setThemeEffects(!effects)}>{effects ? 'On' : 'Off'}</button>
    </div>}
    <div className="theme-creator-note"><h3>Create a theme</h3><p>Start with colors and artwork, or contribute a new layout. The guide covers responsive design, controller navigation, asset preparation, live 3D, and the quality checks.</p><p>Community themes currently require a source contribution. Importing theme packs and a visual editor are planned.</p><a href={guideUrl || undefined} download="Finesse-theme-authoring.md">Download the creator guide ↓</a></div>
  </div>
}
