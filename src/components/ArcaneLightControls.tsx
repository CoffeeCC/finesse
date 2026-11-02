import { setArcaneScene, useArcaneScene } from '../lib/arcaneScene'
import { useThemeEffects } from '../lib/theme'

/** Same browser preference from the candle and Themes; neither resets burn time. */
export default function ArcaneLightControls() {
  const scene = useArcaneScene(), effects = useThemeEffects()
  return <fieldset className="theme-scene-settings" disabled={!effects}>
    <legend>Table lighting</legend><p>Adjust the live scene for your screen. Text and movie artwork keep their original colors.</p>
    <label>Scene brightness <output>{Math.round(scene.brightness * 100)}%</output><input type="range" aria-label="Scene brightness" min="70" max="140" step="5" value={Math.round(scene.brightness * 100)} onChange={(event) => setArcaneScene({ brightness: Number(event.target.value) / 100 })} /></label>
    <label>Light strength <output>{Math.round(scene.lights * 100)}%</output><input type="range" aria-label="Light strength" min="50" max="150" step="5" value={Math.round(scene.lights * 100)} onChange={(event) => setArcaneScene({ lights: Number(event.target.value) / 100 })} /></label>
    <button type="button" onClick={() => setArcaneScene({ brightness: 1, lights: 1 })}>Reset table lighting</button>
    {!effects && <small>Turn on Live 3D objects in Themes to adjust the lighting.</small>}
  </fieldset>
}
