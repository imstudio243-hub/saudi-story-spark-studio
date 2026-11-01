// Browser-only scene merger: joins shot MP4s with cinematic crossfades and voiceover WAVs
// with acrossfades into one MP4, via ffmpeg.wasm 0.12 (single-threaded core served
// same-origin, no SharedArrayBuffer needed). Loaded lazily on first export.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import wasmAsset from "@/assets/ffmpeg-core.wasm.asset.json";

const CORE_URL = "/ffmpeg/ffmpeg-core.js";
const XFADE = 0.5; // crossfade seconds between shots (video and audio use the same overlap so they stay in sync)

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

async function getFfmpeg(onProgress?: (msg: string) => void) {
  if (ffmpeg) return ffmpeg;
  if (!loading) {
    loading = (async () => {
      onProgress?.("جارٍ تحميل أداة الدمج (أول مرة فقط)…");
      const f = new FFmpeg();
      f.on("log", ({ message }) => console.log("[ffmpeg]", message));
      // Blob URLs bypass the dev server's module interception of /public files.
      const coreURL = await toBlobURL(CORE_URL, "text/javascript");
      const wasmURL = await toBlobURL(wasmAsset.url, "application/wasm");
      await f.load({ coreURL, wasmURL });
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

/** Export a narrated MP4 with browser-shaped Arabic captions. */
export async function mergeScenes(
  scenes: { videoUrl: string; audioUrl?: string; duration: number; voiceover?: string }[],
  onProgress?: (msg: string) => void,
): Promise<Blob> {
  if (!scenes.length || scenes.some((s) => !s.audioUrl)) throw new Error("أكمل التعليق الصوتي لكل اللقطات قبل التنزيل.");
  const f = await getFfmpeg(onProgress);
  const { captionPng, videoInfo } = await import("./caption-raster");
  const { captionCues, narrationDuration } = await import("./narration-timeline");
  const n = scenes.length;
  const cleanup: string[] = [];
  const prepared = [];
  const audioContext = new AudioContext();
  try {
    for (const [i, scene] of scenes.entries()) {
      const audioUrl = scene.audioUrl;
      if (!audioUrl) throw new Error("التعليق الصوتي غير مكتمل.");
      onProgress?.(`جارٍ تجهيز الصوت والكتابة ${i + 1}/${n}…`);
      const [video, audio] = await Promise.all([fetchBytes(scene.videoUrl), fetchBytes(audioUrl)]);
      const info = await videoInfo(video);
      const decoded = await audioContext.decodeAudioData(new Uint8Array(audio).buffer);
      const lead = i > 0 ? XFADE : 0;
      const duration = narrationDuration(Math.max(info.duration, scene.duration), decoded.duration, i, n);
      await f.writeFile(`v${i}.mp4`, video);
      await f.writeFile(`a${i}.wav`, audio);
      cleanup.push(`v${i}.mp4`, `a${i}.wav`);
      prepared.push({ ...info, duration, audioDuration: decoded.duration, lead, text: scene.voiceover ?? "" });
    }
    const args: string[] = [];
    for (let i = 0; i < n; i++) args.push("-i", `v${i}.mp4`);
    for (let i = 0; i < n; i++) args.push("-i", `a${i}.wav`);
    const first = prepared[0];
    if (!first) throw new Error("لا توجد لقطات.");
    const parts: string[] = [];
    const cues: { text: string; start: number; end: number }[] = [];
    let timeline = 0;
    for (const [i, scene] of prepared.entries()) {
      // Freeze only the tail when narration exceeds the original clip; never cut spoken words.
      parts.push(`[${i}:v]scale=${first.width}:${first.height},setsar=1,fps=24,settb=AVTB,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${scene.duration},trim=duration=${scene.duration},format=yuv420p[v${i}]`);
      parts.push(`[${n + i}:a]asetpts=PTS-STARTPTS,aresample=24000,adelay=${Math.round(scene.lead * 1000)}:all=1,apad,atrim=duration=${scene.duration}[at${i}]`);
      cues.push(...captionCues(scene.text, timeline + scene.lead, timeline + scene.lead + scene.audioDuration));
      timeline += scene.duration - (i < n - 1 ? XFADE : 0);
    }
    let videoPrev = "[v0]";
    let audioPrev = "[at0]";
    let cumulative = 0;
    for (let i = 1; i < n; i++) {
      cumulative += prepared[i - 1]?.duration ?? 0;
      const vout = `[vx${i}]`;
      const aout = `[ax${i}]`;
      parts.push(`${videoPrev}[v${i}]xfade=transition=fade:duration=${XFADE}:offset=${(cumulative - i * XFADE).toFixed(3)}${vout}`);
      parts.push(`${audioPrev}[at${i}]acrossfade=d=${XFADE}${aout}`);
      videoPrev = vout;
      audioPrev = aout;
    }
    for (const [i, cue] of cues.entries()) {
      const name = `caption${i}.png`;
      await f.writeFile(name, await captionPng(cue.text, first.width, first.height));
      cleanup.push(name);
      args.push("-i", name);
      const out = `[cv${i}]`;
      parts.push(`${videoPrev}[${2 * n + i}:v]overlay=x=0:y=H-h-H*0.08:eof_action=repeat:enable='between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})'${out}`);
      videoPrev = out;
    }
    onProgress?.("جارٍ حفظ الفيديو بالصوت والكتابة العربية…");
    const progress = ({ progress }: { progress: number }) => onProgress?.(`جارٍ حفظ الفيديو بالصوت والكتابة… ${Math.max(0, Math.min(99, Math.round(progress * 100)))}٪`);
    f.on("progress", progress);
    try {
      const result = await f.exec([...args, "-filter_complex", parts.join(";"), "-map", videoPrev, "-map", audioPrev, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-t", timeline.toFixed(3), "-y", "final.mp4"], 600000);
      if (result !== 0) throw new Error("فشل حفظ الفيديو بالصوت والكتابة.");
    } finally {
      f.off("progress", progress);
    }
    const data = await f.readFile("final.mp4");
    if (!(data instanceof Uint8Array)) throw new Error("تعذر قراءة الفيديو النهائي.");
    return new Blob([new Uint8Array(data).buffer], { type: "video/mp4" });
  } finally {
    await audioContext.close();
    for (const name of [...cleanup, "final.mp4"]) {
      try { await f.deleteFile(name); } catch { /* May not exist on failure. */ }
    }
  }
}
