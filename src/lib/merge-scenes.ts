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

/** Merge shots into a single MP4 with crossfade transitions (continuity instead of hard cuts). */
export async function mergeScenes(
  scenes: { videoUrl: string; audioUrl?: string | undefined; duration: number }[],
  onProgress?: (msg: string) => void,
): Promise<Blob> {
  const f = await getFfmpeg(onProgress);
  const n = scenes.length;
  const withAudio = scenes.every((s) => s.audioUrl);

  onProgress?.("جارٍ تجهيز اللقطات…");
  const cleanup: string[] = [];
  for (let i = 0; i < n; i++) {
    const scene = scenes[i]!;
    await f.writeFile(`v${i}.mp4`, await fetchBytes(scene.videoUrl));
    cleanup.push(`v${i}.mp4`);
    if (withAudio) {
      await f.writeFile(`a${i}.wav`, await fetchBytes(scene.audioUrl!));
      cleanup.push(`a${i}.wav`);
    }
  }
  // Inputs grouped: videos 0..n-1, then audios n..2n-1 (filtergraph below relies on this order).
  const args: string[] = [];
  for (let i = 0; i < n; i++) args.push("-i", `v${i}.mp4`);
  if (withAudio) for (let i = 0; i < n; i++) args.push("-i", `a${i}.wav`);

  // Video: chained xfade. Offset of join k = sum(durations of shots before k) - k * XFADE.
  let vchain: string;
  if (n === 1) {
    vchain = "[0:v]format=yuv420p[vout]";
  } else {
    const parts: string[] = [];
    let prev = "[0:v]";
    let cum = 0;
    for (let i = 1; i < n; i++) {
      cum += scenes[i - 1]!.duration;
      const offset = Math.max(0.1, cum - i * XFADE);
      const out = i === n - 1 ? "[vout]" : `[vx${i}]`;
      parts.push(`${prev}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(2)}${out}`);
      prev = out;
    }
    vchain = parts.join(";");
  }

  // Audio: trim each voiceover to its shot's duration (TTS runs long and would drift out of
  // sync), then chain acrossfades with the same overlap as the video so both end together.
  let achain = "";
  if (withAudio) {
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      parts.push(`[${n + i}:a]atrim=0:${scenes[i]!.duration.toFixed(2)},asetpts=PTS-STARTPTS[at${i}]`);
    }
    if (n === 1) {
      parts.push("[at0]anull[aout]");
    } else {
      let prev = "[at0]";
      for (let i = 1; i < n; i++) {
        const out = i === n - 1 ? "[aout]" : `[ax${i}]`;
        parts.push(`${prev}[at${i}]acrossfade=d=${XFADE}${out}`);
        prev = out;
      }
    }
    achain = parts.join(";");
  }

  onProgress?.("جارٍ تركيب الفيديو النهائي بالانتقالات…");
  const fc = withAudio ? `${vchain};${achain}` : vchain;
  const mapArgs = withAudio ? ["-map", "[vout]", "-map", "[aout]"] : ["-map", "[vout]"];
  const ok = await f.exec(
    [...args, "-filter_complex", fc, ...mapArgs, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "final.mp4"],
    600000,
  );
  if (ok !== 0) throw new Error("فشل تركيب الفيديو النهائي.");

  const data = (await f.readFile("final.mp4")) as Uint8Array;
  try {
    for (const name of [...cleanup, "final.mp4"]) await f.deleteFile(name);
  } catch {
    /* ignore */
  }
  const buf = new Uint8Array(data).buffer as ArrayBuffer;
  return new Blob([buf], { type: "video/mp4" });
}
