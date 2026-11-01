import { THEMES, setTheme, useTheme } from '../lib/theme'

export default function ThemePicker() {
  const selected = useTheme()
  return (
    <fieldset className="theme-picker">
      <legend className="text-sm font-semibold text-white">Theme</legend>
      <p className="mt-1 mb-4 text-xs text-ink-400">Saved on this device. Arcane Table adds a movie and show discovery Home, with shared colors across Finesse.</p>
      <div className="theme-options">
        {THEMES.map((theme) => (
          <label key={theme.id} className={`theme-option ${selected === theme.id ? 'theme-option-selected' : ''}`}>
            <input type="radio" name="finesse-theme" value={theme.id} checked={selected === theme.id} onChange={() => setTheme(theme.id)} />
            <span className="theme-scene" data-preview={theme.id} aria-hidden><span /><span /><span /><i>F.</i></span>
            <span className="theme-swatches" aria-hidden>{theme.swatches.map((color) => <span key={color} style={{ background: color }} />)}</span>
            <span className="theme-option-name">{theme.name}</span>
            <span className="theme-option-description">{theme.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
