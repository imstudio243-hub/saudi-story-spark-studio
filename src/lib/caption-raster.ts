export async function captionPng(text: string, width: number, height: number) {
  await document.fonts.load('700 40px "Tajawal"');
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(height * 0.18);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذر تجهيز الكتابة العربية.");
  const styles = getComputedStyle(document.documentElement);
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = Math.round(width * 0.055);
  ctx.font = `700 ${size}px Tajawal, sans-serif`;
  while (ctx.measureText(text).width > width * 0.88 && size > 12) {
    ctx.font = `700 ${--size}px Tajawal, sans-serif`;
  }
  ctx.fillStyle = styles.getPropertyValue("--caption-background").trim();
  const textWidth = ctx.measureText(text).width;
  ctx.fillRect((width - textWidth) / 2 - 18, canvas.height / 2 - size, textWidth + 36, size * 2);
  ctx.fillStyle = styles.getPropertyValue("--caption-foreground").trim();
  ctx.fillText(text, width / 2, canvas.height / 2);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("تعذر تجهيز الكتابة.");
  return new Uint8Array(await blob.arrayBuffer());
}

export async function videoInfo(bytes: Uint8Array) {
  const video = document.createElement("video");
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "video/mp4" }));
  try {
    video.preload = "metadata";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("تعذر قراءة مدة الفيديو."));
    });
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}