import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ThemePicker from './ThemePicker'
import { setTheme, setThemeEffects, useTheme, useThemeEffects } from '../lib/theme'
import guide from '../../docs/THEME-AUTHORING.md?raw'
import { setArcaneScene, useArcaneScene } from '../lib/arcaneScene'

export default function ThemeSettings() {
  const theme = useTheme()
  const effects = useThemeEffects()
  const scene = useArcaneScene()
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
      <div><strong>Live 3D objects</strong><p>Give the table live lighting, shadows and animated objects. Turn this off for lighter artwork. Reduced motion keeps the light steady.</p><small>This browser</small></div>
      <button type="button" role="switch" aria-label="Live 3D objects" aria-checked={effects} onClick={() => setThemeEffects(!effects)}>{effects ? 'On' : 'Off'}</button>
    </div>}
    {theme === 'card-table' && <fieldset className="theme-scene-settings" disabled={!effects}>
      <legend>Table lighting</legend><p>Adjust the live scene for your screen. Text and movie artwork keep their original colors.</p>
      <label>Scene brightness <output>{Math.round(scene.brightness * 100)}%</output><input type="range" aria-label="Scene brightness" min="70" max="140" step="5" value={Math.round(scene.brightness * 100)} onChange={(event) => setArcaneScene({ brightness: Number(event.target.value) / 100 })} /></label>
      <label>Light strength <output>{Math.round(scene.lights * 100)}%</output><input type="range" aria-label="Light strength" min="50" max="150" step="5" value={Math.round(scene.lights * 100)} onChange={(event) => setArcaneScene({ lights: Number(event.target.value) / 100 })} /></label>
      <button type="button" onClick={() => setArcaneScene({ brightness: 1, lights: 1 })}>Reset table lighting</button>
      {!effects && <small>Turn on Live 3D objects to adjust the lighting.</small>}
    </fieldset>}
    <div className="theme-creator-note"><h3>Create a theme</h3><p>Start with colors and artwork, or contribute a new layout. The guide covers responsive design, controller navigation, asset preparation, live 3D, and the quality checks.</p><p>Community themes currently require a source contribution. Importing theme packs and a visual editor are planned.</p><a href={guideUrl || undefined} download="Finesse-theme-authoring.md">Download the creator guide ↓</a></div>
  </div>
}
