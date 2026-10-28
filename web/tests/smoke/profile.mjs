// Local performance profile (dev tool, not CI): startup, asset size, geometry size, draw calls, per-frame CPU time,
// per-frame JS allocation and run cadence in a headless Chromium. Headless timing is not a substitute for a visible
// browser on real hardware: GPU time is not measured, only CPU-side submission.
//   npm run profile
import { startHarness, wait } from "./harness.mjs";

const harness = await startHarness({ browserArgs: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const { page, baseUrl } = harness;
try {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 760, deviceScaleFactor: 1, mobile: false });
  await page.send("Network.enable");
  await page.send("Page.navigate", { url: `${baseUrl}?seed=1&rng=microsoft&reduced=0` });
  await wait(2000);
  const startup = await page.evaluate(`(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    return { domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd),
      requests: res.length + 1, transferBytes: res.reduce((s, r) => s + r.encodedBodySize, 0) + nav.encodedBodySize,
      scriptBytes: res.filter((r) => r.name.endsWith('.js')).reduce((s, r) => s + r.encodedBodySize, 0) };
  })()`);

  const render = await page.evaluate(`(async () => {
    const calls = { drawElements: 0, drawArrays: 0 };
    const proto = WebGL2RenderingContext.prototype;
    for (const name of ['drawElements', 'drawArrays']) { const o = proto[name]; proto[name] = function (...a) { calls[name] += 1; return o.apply(this, a); }; }
    const { generateMaze } = await import(new URL('./src/maze.js', document.baseURI).href);
    const { buildMazeGeometry } = await import(new URL('./src/webgl-geometry.js', document.baseURI).href);
    const { WebGLMazeRenderer } = await import(new URL('./src/webgl-renderer.js', document.baseURI).href);
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:600px;visibility:hidden';
    document.body.append(canvas);
    const r = new WebGLMazeRenderer(canvas);
    const maze = generateMaze({ seed: 1 });
    const geometry = buildMazeGeometry(maze);
    r.setMaze(maze); r.setMarkers(true); r.setExperimental({ pictures: true, logos: true }); // every experimental flag on = worst case
    const consumed = new Set();
    const rat = { pose: { x: 4, y: 3 } };
    const opts = { roll: 0, growth: 1, simUpdates: 0, consumed, rats: [rat] };
    const pose = { x: 3, y: 3, heading: 0 };
    const frame = (i) => { pose.x = 3 + (i % 18) / 18; pose.heading = i * 0.01; opts.simUpdates = i; r.render(pose, opts); };
    for (let i = 0; i < 100; i += 1) frame(i); // warm up
    calls.drawElements = 0; calls.drawArrays = 0; frame(0);
    const draws = { drawElements: calls.drawElements, drawArrays: calls.drawArrays, solids: maze.twisters.length, logos: maze.logos.length, pictureWalls: maze.pictures.length };
    const times = []; const N = 1500;
    if (window.gc) window.gc(); const heap0 = performance.memory.usedJSHeapSize;
    for (let i = 0; i < N; i += 1) { const a = performance.now(); frame(i); times.push(performance.now() - a); }
    const heap1 = performance.memory.usedJSHeapSize;
    times.sort((x, y) => x - y);
    const q = (p) => +times[Math.floor(times.length * p)].toFixed(3);
    r.dispose(); canvas.remove();
    return { vertices: geometry.vertexCount, indices: geometry.indexCount, quads: geometry.counts, draws, cpuMs: { median: q(0.5), p95: q(0.95), max: +times.at(-1).toFixed(3) }, frames: N, heapDeltaBytesPerFrame: Math.round((heap1 - heap0) / N) };
  })()`);

  // Run cadence on the real page: updates per second and rAF interval while playing.
  const cadence = await page.evaluate(`(async () => {
    const $ = (id) => document.getElementById(id);
    $('regenerate').click();
    const frames = []; let on = true;
    (function f(t) { frames.push(t); if (on) requestAnimationFrame(f); })(performance.now());
    $('play').click(); const u0 = +$('updates').textContent; const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 8000));
    const u1 = +$('updates').textContent; const t1 = performance.now(); $('play').click(); on = false;
    const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
    return { updatesPerSecond: +((u1 - u0) / ((t1 - t0) / 1000)).toFixed(2), expected: 40, rafMedianMs: +gaps[gaps.length >> 1].toFixed(2), rafP99Ms: +gaps[Math.floor(gaps.length * 0.99)].toFixed(2), rafMaxMs: +gaps.at(-1).toFixed(2) };
  })()`);

  console.log(JSON.stringify({ browser: harness.browserPath, startup, render, cadence }, null, 2));
} finally {
  harness.close();
}
