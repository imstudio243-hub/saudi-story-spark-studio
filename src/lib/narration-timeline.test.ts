import { describe, expect, it } from "vitest";
import { captionCues, narrationDuration, sceneReady } from "./narration-timeline";

describe("Arabic narrated videos", () => {
  it("does not mark a silent video ready", () => {
    expect(sceneReady({ videoUrl: "video.mp4" })).toBe(false);
    expect(sceneReady({ videoUrl: "video.mp4", audioUrl: "voice.wav" })).toBe(true);
  });
  it("preserves all spoken Arabic words within the speech window", () => {
    const text = "برق للتمويل معك خطوة بخطوة حتى تحقق أهدافك";
    const cues = captionCues(text, 0.5, 5);
    expect(cues.map((c) => c.text).join(" ")).toBe(text);
    expect(cues[0]?.start).toBe(0.5);
    expect(cues.at(-1)?.end).toBe(5);
    expect(cues.every((c) => c.end > c.start)).toBe(true);
  });
  it("never cuts a long voiceover to the short video duration", () => {
    expect(narrationDuration(3, 6, 1, 3)).toBe(7);
    expect(narrationDuration(3, 6, 0, 1)).toBe(6);
  });
});