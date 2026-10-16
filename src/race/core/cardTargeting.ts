/** All cross-horse card effects use this gate, whether beneficial, harmful, instant or continuous. */
export function canCardAffect(source: number, target: number, targetIsolated: boolean): boolean {
  return source === target || !targetIsolated
}
