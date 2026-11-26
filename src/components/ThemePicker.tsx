import { useEffect } from 'react'
import { availableThemes, loadThemeStyles, setTheme, useTheme, useThemePreviews } from '../lib/theme'

export default function ThemePicker() {
  const selected = useTheme()
  const unfinished = useThemePreviews()
  const themes = availableThemes()
  // Arcane Table's preview card uses its own artwork, which lives in its own styles.
  useEffect(() => { if (themes.some((t) => t.id === 'card-table')) loadThemeStyles('card-table') }, [unfinished]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <fieldset className="theme-picker">
      <legend className="text-sm font-semibold text-white">Theme</legend>
      <p className="mt-1 mb-4 text-xs text-ink-400">Saved on this device. Themes marked Preview are still being made, so they may look rough or change in an update.</p>
      <div className="theme-options">
        {themes.map((theme) => (
          <label key={theme.id} className={`theme-option ${selected === theme.id ? 'theme-option-selected' : ''}`}>
            <input type="radio" name="finesse-theme" value={theme.id} checked={selected === theme.id} onChange={() => setTheme(theme.id)} />
            <span className="theme-scene" data-preview={theme.id} aria-hidden><span /><span /><span /><i>F.</i></span>
            <span className="theme-swatches" aria-hidden>{theme.swatches.map((color) => <span key={color} style={{ background: color }} />)}</span>
            <span className="theme-option-name">{theme.name}{theme.preview && <span className="ml-2 rounded bg-ink-800 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wider text-ink-400">Preview</span>}</span>
            <span className="theme-option-description">{theme.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
