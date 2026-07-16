export function getFocusLoopTarget<T>(
  controls: readonly T[],
  activeElement: unknown,
  reverse: boolean
): T | null {
  if (controls.length === 0) return null;

  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!controls.includes(activeElement as T)) return reverse ? last : first;
  if (reverse && activeElement === first) return last;
  if (!reverse && activeElement === last) return first;
  return null;
}
