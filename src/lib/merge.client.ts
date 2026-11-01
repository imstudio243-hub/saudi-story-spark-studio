// Browser-only scene merger: concatenates scene MP4s + voiceover WAVs into one MP4
// using ffmpeg.wasm (single-threaded core, no SharedArrayBuffer needed), loaded lazily from CDN.

const FFMPEG_URL = "https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js";
const CORE_URL = "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js";

let ffmpeg: any = null;
let loading: Promise<any> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("تعذر تحميل مكتبة الدمج."));
    document.head.appendChild(s);
  });
}

async function getFfmpeg(onProgress?: (msg: string) => void) {
  if (ffmpeg) return ffmpeg;
  if (!loading) {
    loading = (async () => {
      onProgress?.("جارٍ تحميل أداة الدمج (أول مرة فقط)…");
      await loadScript(FFMPEG_URL);
      const { createFFmpeg } = (window as any).FFmpeg;
      const f = createFFmpeg({ log: false, corePath: CORE_URL });
      await f.load();
      ffmpeg = f;
      return f;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

async function fetchBytes(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("تعذر جلب أحد الملفات للدمج.");
  return new Uint8Array(await res.arrayBuffer());
}

/** Merge scene videos (+ optional per-scene audio) into a single MP4 blob. */
export async function mergeScenes(
  scenes: { videoUrl: string; audioUrl?: string }[],
  onProgress?: (msg: string) => void,
): Promise<Blob> {
  const f = await getFfmpeg(onProgress);
  const withAudio = scenes.every((s) => s.audioUrl);

  onProgress?.("جارٍ تجهيز المشاهد…");
  const vList: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const name = `v${i}.mp4`;
    f.FS("writeFile", name, await fetchBytes(scenes[i].videoUrl));
    vList.push(`file '${name}'`);
    if (withAudio) f.FS("writeFile", `a${i}.wav`, await fetchBytes(scenes[i].audioUrl!));
  }
  f.FS("writeFile", "vlist.txt", new TextEncoder().encode(vList.join("\n")));

  onProgress?.("جارٍ دمج المشاهد…");
  await f.run("-f", "concat", "-safe", "0", "-i", "vlist.txt", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "video_all.mp4");

  let outName = "video_all.mp4";
  if (withAudio) {
    const aList = scenes.map((_, i) => `file 'a${i}.wav'`).join("\n");
    f.FS("writeFile", "alist.txt", new TextEncoder().encode(aList));
    onProgress?.("جارٍ دمج الصوت…");
    await f.run("-f", "concat", "-safe", "0", "-i", "alist.txt", "-c:a", "aac", "audio_all.m4a");
    onProgress?.("جارٍ تركيب الفيديو النهائي…");
    await f.run("-i", "video_all.mp4", "-i", "audio_all.m4a", "-c:v", "copy", "-c:a", "copy", "-shortest", "final.mp4");
    outName = "final.mp4";
  }

  const data = f.FS("readFile", outName) as Uint8Array;
  // Clean up FS for potential re-runs.
  try {
    for (let i = 0; i < scenes.length; i++) {
      f.FS("unlink", `v${i}.mp4`);
      if (withAudio) f.FS("unlink", `a${i}.wav`);
    }
    f.FS("unlink", "vlist.txt");
    f.FS("unlink", "video_all.mp4");
    if (withAudio) {
      f.FS("unlink", "alist.txt");
      f.FS("unlink", "audio_all.m4a");
      f.FS("unlink", "final.mp4");
    }
  } catch {
    /* ignore */
  }
  return new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" });
}
