// Prepares the optional Backrooms-inspired theme textures from the generated source images (dev tool; the sources stay outside the
// repository and are never modified).
//   node web/tools/prepare-textures.mjs <sourceDir> <outDir> [--size 512] [--format png|webp] [--report report.json]
// For each of backrooms-wallpaper, backrooms-carpet and backrooms-ceiling it
//   1. measures how well opposite edges match (mean absolute difference between the two edge lines, against the mean difference of
//      neighbouring lines inside the image),
//   2. searches square crops (size and offset) for the one whose edges match best, so the texture is as seamless as the picture allows,
//   3. cross-fades a narrow band across any seam that remains (mirror-weighted blend with the wrapped neighbour),
//   4. resizes to the runtime size and writes the file, and prints the transformation and the measured seam scores.
// Requires ffmpeg on PATH. No Microsoft material is involved: the inputs are images generated for this project.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const args = process.argv.slice(2);
const [sourceDir, outDir] = args;
if (!sourceDir || !outDir) { console.error("usage: prepare-textures.mjs <sourceDir> <outDir> [--size N] [--format png|webp]"); process.exit(2); }
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const SIZE = Number.parseInt(option("size", "512"), 10);
const FORMAT = option("format", "png");
const BAND = 0.08; // fraction of the tile blended across a remaining seam
mkdirSync(outDir, { recursive: true });

function decode(file) {
  const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" }).trim().split(",").map(Number);
  const [w, h] = probe;
  const data = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 29 });
  return { w, h, data };
}

/** Seam score of a square crop: (edge difference) / (typical neighbour difference); 1 means the edge looks like any other line. */
function seamScore(img, ox, oy, s, step = 3) {
  const { w, data } = img;
  const px = (x, y, c) => data[((oy + y) * w + ox + x) * 3 + c];
  const line = (a, b, vertical) => {
    let sum = 0, n = 0;
    for (let k = 0; k < s; k += step) for (let c = 0; c < 3; c += 1) { sum += vertical ? Math.abs(px(a, k, c) - px(b, k, c)) : Math.abs(px(k, a, c) - px(k, b, c)); n += 1; }
    return sum / n;
  };
  let inner = 0, count = 0;
  for (let k = Math.floor(s * 0.1); k < s * 0.9; k += Math.max(7, Math.floor(s / 40))) { inner += line(k, k + 1, true) + line(k, k + 1, false); count += 2; }
  inner /= count;
  const seam = (line(s - 1, 0, true) + line(s - 1, 0, false)) / 2;
  return { score: seam / inner, seam, inner };
}

function crop(img, ox, oy, s) {
  const out = Buffer.alloc(s * s * 3);
  for (let y = 0; y < s; y += 1) img.data.copy(out, y * s * 3, ((oy + y) * img.w + ox) * 3, ((oy + y) * img.w + ox + s) * 3);
  return out;
}

/** Cross-fades the wrap seam: pixels within BAND of an edge blend with their mirror image across the seam, weight 0.5 at the edge, so both sides meet at the same value. */
function healSeams(tile, s) {
  const band = Math.max(4, Math.round(s * BAND));
  const out = Buffer.from(tile);
  const at = (x, y, c) => tile[(((y + s) % s) * s + ((x + s) % s)) * 3 + c];
  for (let y = 0; y < s; y += 1) for (let x = 0; x < s; x += 1) {
    const dx = Math.min(x, s - 1 - x);
    const dy = Math.min(y, s - 1 - y);
    const wx = dx < band ? 0.5 * (1 - dx / band) : 0;
    const wy = dy < band ? 0.5 * (1 - dy / band) : 0;
    if (wx === 0 && wy === 0) continue;
    for (let c = 0; c < 3; c += 1) {
      let v = at(x, y, c);
      if (wx > 0) v = v * (1 - wx) + at(s - 1 - x, y, c) * wx; // mirror partner across the seam
      if (wy > 0) v = v * (1 - wy) + at(x, s - 1 - y, c) * wy;
      out[(y * s + x) * 3 + c] = Math.round(v);
    }
  }
  return out;
}

const report = [];
const TARGETS = { "backrooms-wallpaper": "wall", "backrooms-carpet": "floor", "backrooms-ceiling": "ceiling" };
for (const name of Object.keys(TARGETS)) {
  const file = join(sourceDir, `${name}.png`);
  const img = decode(file);
  const full = seamScore(img, 0, 0, Math.min(img.w, img.h));
  let best = { ox: 0, oy: 0, s: Math.min(img.w, img.h), ...full };
  const max = Math.min(img.w, img.h);
  for (let s = max; s >= Math.floor(max * 0.82); s -= 2) {
    const slack = max - s;
    for (let oy = 0; oy <= slack; oy += Math.max(1, Math.floor(slack / 6))) for (let ox = 0; ox <= slack; ox += Math.max(1, Math.floor(slack / 6))) {
      const r = seamScore(img, ox, oy, s);
      if (r.score < best.score) best = { ox, oy, s, ...r };
    }
  }
  const cropped = crop(img, best.ox, best.oy, best.s);
  const healed = healSeams(cropped, best.s);
  const scaled = execFileSync("ffmpeg", ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${best.s}x${best.s}`, "-i", "-", "-vf", `scale=${SIZE}:${SIZE}:flags=lanczos`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: healed, maxBuffer: 1 << 28 });
  const target = join(outDir, `${TARGETS[name]}.${FORMAT}`);
  const encode = FORMAT === "webp" ? ["-c:v", "libwebp", "-quality", "92", "-lossless", "0"] : ["-compression_level", "9"];
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${SIZE}x${SIZE}`, "-i", "-", ...encode, target], { input: scaled });
  const healedScore = seamScore({ w: best.s, h: best.s, data: healed }, 0, 0, best.s);
  const bytes = readFileSync(target);
  report.push({
    texture: TARGETS[name], source: `${img.w}x${img.h}`, sourceBytes: statSync(file).size, sourceSeamScore: +full.score.toFixed(2),
    crop: { x: best.ox, y: best.oy, size: best.s }, cropSeamScore: +best.score.toFixed(2), healedSeamScore: +healedScore.score.toFixed(2),
    output: { file: target.split(/[\\/]/).pop(), size: SIZE, format: FORMAT, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
  });
}
const text = JSON.stringify(report, null, 2);
console.log(text);
if (option("report", null)) writeFileSync(option("report", null), text + "\n");
