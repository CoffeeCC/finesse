/** A leaf opens away from the writing surface. Left and right bindings have opposite hinges. */
export function folioLeafAngle(age: number, turnAge: number, side: number, reduced: boolean) {
  if (reduced || !Number.isFinite(age)) return 0
  const opening = Math.max(0, 1 - Math.max(0, age) / 1.5)
  const turn = Number.isFinite(turnAge) && turnAge >= 0 && turnAge < .65 ? Math.sin(turnAge / .65 * Math.PI) * .055 : 0
  return (side < 0 ? -1 : 1) * (opening * .16 + turn)
}
