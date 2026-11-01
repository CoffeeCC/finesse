// LB/RB on a controller (lib/gamepad): pure, so server/test/tab-step.test.ts can check it.

/**
 * Which tab LB/RB goes to: the one before or after the current one, wrapping round. On a
 * page that isn't one of the tabs (a title, Settings), RB starts at the first and LB at the
 * last, rather than one that depends on where the missing one would have been.
 */
export function nextTabIndex(here: number, dir: 1 | -1, count: number): number {
  if (count <= 0) return -1
  if (here < 0) return dir === 1 ? 0 : count - 1
  return (here + dir + count) % count
}
