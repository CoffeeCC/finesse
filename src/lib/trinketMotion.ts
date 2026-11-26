export type TrinketSpring = { value: number; velocity: number }
/** Analytic damped response: preserves momentum on exit/re-entry, independent of FPS. */
export function stepTrinketMotion(state: TrinketSpring, engaged: boolean, seconds: number, still = false): TrinketSpring {
  if (still) return { value: 0, velocity: 0 }
  const dt = Math.max(0, Math.min(.1, seconds)), target = engaged ? 1 : 0
  const frequency = 13, damping = .72, decay = frequency * damping
  const angular = frequency * Math.sqrt(1 - damping * damping)
  const offset = state.value - target, envelope = Math.exp(-decay * dt)
  const c = Math.cos(angular * dt), s = Math.sin(angular * dt)
  return { value: target + envelope * (offset * c + (state.velocity + decay * offset) / angular * s),
    velocity: envelope * (state.velocity * c - (decay * state.velocity + frequency * frequency * offset) / angular * s) }
}
