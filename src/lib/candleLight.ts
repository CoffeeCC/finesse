const noise = (time: number, seed: number) => {
  const cell = Math.floor(time), blend = time - cell, smooth = blend * blend * (3 - 2 * blend)
  const hash = (n: number) => { const value = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return (value - Math.floor(value)) * 2 - 1 }
  return hash(cell) * (1 - smooth) + hash(cell + 1) * smooth
}

/** Continuous, bounded motion shared by the flame, warm point light and shadows.
 * Ambient fill and exposure intentionally do not flicker. Time is renderer-visible time. */
export function candleLight(time: number, still = false) {
  if (still) return { intensity: 1, lean: 0, x: 0, z: 0, warmth: .5 }
  const breath = noise(time * 1.35, 3), flutter = noise(time * 5.1, 11), sway = noise(time * .8, 23)
  return { intensity: 1 + breath * .09 + flutter * .02,
    lean: sway * .10 + flutter * .018, x: sway * .035, z: noise(time * .95, 17) * .022,
    warmth: .5 + breath * .5 }
}
