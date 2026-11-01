// Estimated generation cost per scene, derived from this project's recorded usage
// (2026-11-01): ~44.6 credits for ~20 clips of ~10s at 720p, ~0.21 for all voiceovers.
// Estimates, not billing data; actual charges depend on the provider.

export const VIDEO_CREDITS_PER_SECOND_720P = 0.22;
export const VIDEO_CREDITS_PER_SECOND_1080P = 0.44;
export const VOICE_CREDITS_PER_SCENE = 0.02;
export const PLAN_CREDITS = 0.3;

export function sceneVideoCredits(durationSeconds: number, resolution: "720p" | "1080p") {
  const rate = resolution === "1080p" ? VIDEO_CREDITS_PER_SECOND_1080P : VIDEO_CREDITS_PER_SECOND_720P;
  return durationSeconds * rate;
}

export function sceneTotalCredits(durationSeconds: number, resolution: "720p" | "1080p") {
  return sceneVideoCredits(durationSeconds, resolution) + VOICE_CREDITS_PER_SCENE;
}

export function planTotalCredits(scenes: { duration: number }[], resolution: "720p" | "1080p") {
  return PLAN_CREDITS + scenes.reduce((sum, s) => sum + sceneTotalCredits(s.duration, resolution), 0);
}

export function formatCredits(credits: number) {
  return credits >= 10 ? credits.toFixed(1) : credits.toFixed(2);
}
