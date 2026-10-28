// Fixed-seed visual regression (dev tool, not part of `npm test`/CI). Captures the first-person canvas at fixed
// simulation updates of seed 1 and compares it with the PNG baselines in web/tests/visual-baselines/, which contain
// only this project's own generated visuals (procedural textures), never Microsoft imagery.
//   npm run visual            compare with the baselines
//   npm run visual -- --update  rewrite the baselines (review them before committing)
//   npm run visual -- --capture <dir>  save the current frames to <dir> and the environment to <dir>/environment.json without
//                                      reading or writing the baselines (for diagnosing a failure)
// Baselines were produced with a headless Chrome on one GPU; thresholds allow small cross-GPU filtering differences.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startHarness, wait } from "./harness.mjs";

const update = process.argv.includes("--update");
const captureIndex = process.argv.indexOf("--capture");
const captureDir = captureIndex >= 0 ? process.argv[captureIndex + 1] : null;
if (captureIndex >= 0 && !captureDir) { console.error("--capture needs a directory"); process.exit(2); }
const baselineDir = fileURLToPath(new URL("../visual-baselines/", import.meta.url));
// Update indices of seed 1 (objects off). With the recovered draw order seed 1 has a left-hand route, so the first move is a
// left quarter turn. Phase: the entrance takes 41 updates, update 42 is the first decision call (no motion), updates 43 to 59
// integrate, update 60 snaps and decides the next move. The two marker views show the experimental Start and smiley artwork;
// everything else has the artwork off. The exit view is 14 updates after the finish update (2400) of this route.
const VIEWS = [
  { name: "entrance-growth-half", updates: 20 },
  { name: "entrance-facing-wall", updates: 41 },
  { name: "quarter-turn-mid", updates: 51 },
  { name: "quarter-turn-done", updates: 60 },
  { name: "reversal-mid", updates: 69 },
  { name: "straight-mid", updates: 87 },
  { name: "second-turn-mid", updates: 105 },
  { name: "open-corridor", updates: 159 },
  { name: "start-markers", updates: 22, markers: true },
  { name: "exit-markers-shrinking", updates: 2414, markers: true },
];
const LIMITS = { meanAbsDiff: 4, fractionOver48: 0.03 };

const harness = await startHarness();
const { page, baseUrl } = harness;
const results = [];
try {
  if (!captureDir) mkdirSync(baselineDir, { recursive: true });
  else mkdirSync(captureDir, { recursive: true });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false });
  const versionInfo = await page.send("Browser.getVersion");
  for (const view of VIEWS) {
    await page.send("Page.navigate", { url: `${baseUrl}?seed=1&rng=microsoft&objects=0&reduced=0&quality=standard&markers=${view.markers ? 1 : 0}&view=first` });
    await wait(1200);
    await page.evaluate(`(() => { for (let i = 0; i < ${view.updates}; i += 1) document.getElementById('step').click(); })()`);
    await page.evaluate("document.querySelector('.view-switch').style.visibility = 'hidden'");
    await wait(250);
    const rect = await page.evaluate(`(() => { const b = document.getElementById('webglCanvas').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, scale: 0.5 }; })()`);
    const shot = (await page.send("Page.captureScreenshot", { format: "png", clip: rect })).data;
    if (captureDir) {
      writeFileSync(join(captureDir, `${view.name}.png`), Buffer.from(shot, "base64"));
      console.log(`CAPTURED ${view.name}.png`);
      continue;
    }
    const file = join(baselineDir, `${view.name}.png`);
    if (update) {
      writeFileSync(file, Buffer.from(shot, "base64"));
      console.log(`WROTE ${view.name}.png`);
      continue;
    }
    if (!existsSync(file)) { results.push({ name: view.name, ok: false, detail: "missing baseline" }); console.log(`FAIL  ${view.name} (missing baseline)`); continue; }
    const baseline = readFileSync(file).toString("base64");
    const diff = await page.evaluate(`(async () => {
      const load = (b64) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = 'data:image/png;base64,' + b64; });
      const [a, b] = await Promise.all([load(${JSON.stringify(shot)}), load(${JSON.stringify(baseline)})]);
      if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: [a.width, a.height, b.width, b.height] };
      const data = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
      const da = data(a), db = data(b); let sum = 0, over = 0;
      for (let i = 0; i < da.length; i += 4) { const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3; sum += d; if (d > 48) over += 1; }
      return { mean: sum / (da.length / 4), over: over / (da.length / 4) };
    })()`);
    const ok = !diff.sizeMismatch && diff.mean < LIMITS.meanAbsDiff && diff.over < LIMITS.fractionOver48;
    results.push({ name: view.name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${view.name}  ${diff.sizeMismatch ? `size ${diff.sizeMismatch}` : `mean diff ${diff.mean.toFixed(2)}, pixels over 48: ${(diff.over * 100).toFixed(2)}%`}`);
  }
  if (captureDir || update) {
    const gpu = await page.evaluate(`(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); if (!gl) return null; const e = gl.getExtension('WEBGL_debug_renderer_info'); return { vendor: e ? gl.getParameter(e.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION) }; })()`);
    const environment = { browser: versionInfo.product, userAgent: versionInfo.userAgent, gpu, viewport: [1000, 640], devicePixelRatio: 1, quality: "standard", seed: 1, capturedWith: captureDir ? "--capture" : "--update" };
    const target = captureDir ? join(captureDir, "environment.json") : join(baselineDir, "environment.json");
    writeFileSync(target, JSON.stringify(environment, null, 2) + "\n");
    console.log(`WROTE ${target}`);
  }
} finally {
  harness.close();
}
if (!update && !captureDir) {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} visual checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
