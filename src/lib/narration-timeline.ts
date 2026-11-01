export type CaptionCue = { text: string; start: number; end: number };

// Estimated phrase timing, bounded by the measured speech window, not invented word timestamps.
export function captionCues(text: string, start: number, end: number): CaptionCue[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (!words.length || end <= start) return [];
  const groups: string[] = [];
  for (let i = 0; i < words.length; i += 4) groups.push(words.slice(i, i + 4).join(" "));
  const weights = groups.map((s) => s.replace(/\s/gu, "").length);
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = start;
  return groups.map((text, i) => {
    const next = i === groups.length - 1 ? end : cursor + (end - start) * (weights[i] ?? 0) / total;
    const cue = { text, start: cursor, end: next };
    cursor = next;
    return cue;
  });
}

export function sceneReady(scene: { videoUrl?: string; audioUrl?: string }) {
  return Boolean(scene.videoUrl && scene.audioUrl);
}

export function narrationDuration(videoDuration: number, audioDuration: number, index: number, count: number) {
  const lead = index > 0 ? 0.5 : 0;
  const tail = index < count - 1 ? 0.5 : 0;
  return Math.max(videoDuration, audioDuration + lead + tail);
}