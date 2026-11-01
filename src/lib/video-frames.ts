// Browser-only: extract evenly spaced JPEG frames from a reference video file
// so the vision model can analyze its style (character, colors, transitions).

export type ExtractedFrame = { blob: Blob; mime: "image/jpeg"; at: number };

export async function extractVideoFrames(file: File, count = 6): Promise<ExtractedFrame[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  try {
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("تعذر قراءة الفيديو المرجعي."));
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration < 1) throw new Error("الفيديو المرجعي قصير جدًا أو غير صالح.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("تعذر تجهيز قراءة الإطارات.");
    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < count; i++) {
      const at = Math.min(duration - 0.1, (duration * (i + 0.5)) / count);
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("تعذر قراءة إطار من الفيديو."));
        video.currentTime = at;
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) throw new Error("تعذر استخراج إطار من الفيديو.");
      frames.push({ blob, mime: "image/jpeg", at });
    }
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
