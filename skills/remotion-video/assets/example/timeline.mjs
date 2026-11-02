export const STEPS = ['Read the source', 'Verify the behavior', 'Review the edge cases'];
export function stateAtFrame(frame, fps = 30) {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) throw new Error('finite frame and positive fps required');
  const seconds = Math.max(0, frame) / fps;
  return { active: Math.min(2, Math.floor(seconds / 1.1)), progress: Math.min(1, seconds / 3.4), complete: seconds >= 3.4 };
}
