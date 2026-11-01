// Browser-only scene merger: joins shot MP4s with cinematic crossfades and voiceover WAVs
// with acrossfades into one MP4, via ffmpeg.wasm (single-threaded core, no SharedArrayBuffer),
// loaded lazily from CDN.

import { createFFmpeg } from "@ffmpeg/ffmpeg";
import wasmAsset from "@/assets/ffmpeg-core.wasm.asset.json";

const CORE_PATH = "/ffmpeg/ffmpeg-core.js"; // single-threaded core served same-origin (no SharedArrayBuffer needed)
const XFADE = 0.5; // video crossfade seconds between shots
const AFADE = 0.3; // audio crossfade seconds

let ffmpeg: any = null;
let loading: Promise<any> | null = null;

async function getFfmpeg(onProgress?: (msg: string) => void) {
  if (ffmpeg) return ffmpeg;
  if (!loading) {
    loading = (async () => {
      onProgress?.("جارٍ تحميل أداة الدمج (أول مرة فقط)…");
      const f = createFFmpeg({ log: false, corePath: CORE_PATH, wasmPath: wasmAsset.url });
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

/** Merge shots into a single MP4 with crossfade transitions (continuity instead of hard cuts). */
export async function mergeScenes(
  scenes: { videoUrl: string; audioUrl?: string | undefined; duration: number }[],
  onProgress?: (msg: string) => void,
): Promise<Blob> {
  const f = await getFfmpeg(onProgress);
  const n = scenes.length;
  const withAudio = scenes.every((s) => s.audioUrl);

  onProgress?.("جارٍ تجهيز اللقطات…");
  const args: string[] = [];
  const cleanup: string[] = [];
  for (let i = 0; i < n; i++) {
    const scene = scenes[i]!;
    f.FS("writeFile", `v${i}.mp4`, await fetchBytes(scene.videoUrl));
    args.push("-i", `v${i}.mp4`);
    cleanup.push(`v${i}.mp4`);
    if (withAudio) {
      f.FS("writeFile", `a${i}.wav`, await fetchBytes(scene.audioUrl!));
      args.push("-i", `a${i}.wav`);
      cleanup.push(`a${i}.wav`);
    }
  }

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

  // Audio: chained acrossfade so the voiceover flows without clicks or sudden silence.
  let achain = "";
  if (withAudio) {
    if (n === 1) {
      achain = `[${n}:a]anull[aout]`;
    } else {
      const parts: string[] = [];
      let prev = `[${n}:a]`;
      for (let i = 1; i < n; i++) {
        const out = i === n - 1 ? "[aout]" : `[ax${i}]`;
        parts.push(`${prev}[${n + i}:a]acrossfade=d=${AFADE}${out}`);
        prev = out;
      }
      achain = parts.join(";");
    }
  }

  onProgress?.("جارٍ تركيب الفيديو النهائي بالانتقالات…");
  const fc = withAudio ? `${vchain};${achain}` : vchain;
  const mapArgs = withAudio ? ["-map", "[vout]", "-map", "[aout]"] : ["-map", "[vout]"];
  await f.run(...args, "-filter_complex", fc, ...mapArgs, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "final.mp4");

  const data = f.FS("readFile", "final.mp4") as Uint8Array;
  try {
    for (const name of [...cleanup, "final.mp4"]) f.FS("unlink", name);
  } catch {
    /* ignore */
  }
  return new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" });
}
