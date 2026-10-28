// Browser smoke test (dev tool, not part of `npm test`/CI): drives a real Chrome or Edge over the DevTools
// protocol against a throw-away local server. Requires a local Chromium browser (CHROME_PATH to override).
//   npm run smoke
// Set SMOKE_SHOTS to a directory to also save screenshots (kept out of Git; never commit them unless they show
// only project-generated visuals).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startHarness, wait } from "./harness.mjs";

let harness;
try {
  harness = await startHarness();
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(2);
}
const { baseUrl } = harness;

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

try {
  const page = harness.page;
  const shots = process.env.SMOKE_SHOTS;
  if (shots) mkdirSync(shots, { recursive: true });
  const shot = async (name) => {
    if (!shots) return;
    const image = await page.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(image.data, "base64"));
  };
  const load = async (query) => {
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.navigate", { url: `${baseUrl}?${query}` });
    await wait(1500);
  };
  const $ = (id) => `document.getElementById('${id}')`;
  const text = (id) => page.evaluate(`${$(id)}.textContent`);

  await load("seed=1&rng=microsoft&reduced=0&objects=1");
  check("first-person view is visible with WebGL 2", await page.evaluate(`!${$("webglCanvas")}.hidden && ${$("mazeCanvas")}.hidden`));
  check("starts at entrance cell (0, 5) facing right", (await text("position")) === "0, 5" && (await text("direction")) === "right");
  check("starts in the entrance phase", (await text("phase")) === "entrance");

  await page.evaluate(`${$("step")}.click()`);
  check("Step advances exactly one update", (await text("updates")) === "1");

  await page.evaluate(`${$("play")}.click()`);
  await wait(1100);
  const playing = Number(await text("updates"));
  await page.evaluate(`${$("play")}.click()`);
  const frozen = Number(await text("updates"));
  await wait(400);
  check("Play advances about 40 updates per second", playing >= 30 && playing <= 55, `${playing} updates in ~1.1 s`);
  check("Pause freezes the simulation", Number(await text("updates")) === frozen);

  const mazeBefore = await text("mazeIndex");
  await page.evaluate(`${$("viewMap")}.click()`);
  check("Debug map can be selected", await page.evaluate(`!${$("mazeCanvas")}.hidden && ${$("webglCanvas")}.hidden`));
  await page.evaluate(`${$("viewFirst")}.click()`);
  check("First person can be reselected", await page.evaluate(`${$("mazeCanvas")}.hidden`));
  await shot("first-person-entrance");

  await page.evaluate(`${$("regenerate")}.click()`);
  check("Generate restarts the run", (await text("updates")) === "0" && (await text("mazeIndex")) === mazeBefore);

  await page.evaluate(`(() => { ${$("quality")}.value = 'turbo'; ${$("quality")}.dispatchEvent(new Event('change')); })()`);
  const turbo = await page.evaluate(`[${$("webglCanvas")}.width, ${$("webglCanvas")}.height]`);
  check("Turbo quality uses a 320x200 buffer", turbo[0] === 320 && turbo[1] === 200, turbo.join("x"));
  await page.evaluate(`(() => { ${$("quality")}.value = 'high'; ${$("quality")}.dispatchEvent(new Event('change')); })()`);

  await page.evaluate(`(() => { ${$("reducedMotion")}.checked = true; ${$("reducedMotion")}.dispatchEvent(new Event('change')); })()`);
  check("Reduced motion is announced", /Reduced motion on/.test(await text("announcement")));
  await page.evaluate(`(() => { ${$("reducedMotion")}.checked = false; ${$("reducedMotion")}.dispatchEvent(new Event('change')); })()`);

  check("Fullscreen control is present", await page.evaluate(`!!${$("fullscreen")}`));

  const stored = await page.evaluate(`JSON.parse(localStorage.getItem('glmaze.settings.v1'))`);
  check("Settings persist locally without personal data", stored && Object.keys(stored).sort().join() === "logos,markers,objects,pictures,quality,rats,reducedMotion,theme,view", JSON.stringify(stored));

  // Keyboard operation and visible focus: Tab reaches every control and each focus ring is a visible outline.
  await load("seed=1&rng=microsoft&reduced=0&objects=1");
  const key = (type, code, keyName) => page.send("Input.dispatchKeyEvent", { type, key: keyName, code, windowsVirtualKeyCode: keyName === "Tab" ? 9 : 27 });
  const reached = new Map();
  for (let i = 0; i < 30; i += 1) {
    await key("rawKeyDown", "Tab", "Tab");
    await key("keyUp", "Tab", "Tab");
    const info = await page.evaluate(`(() => { const e = document.activeElement; const c = getComputedStyle(e); return { id: e.id, outline: c.outlineStyle + ' ' + c.outlineWidth }; })()`);
    if (info.id) reached.set(info.id, info.outline);
  }
  const wanted = ["seed", "regenerate", "rngMode", "quality", "reducedMotion", "objectsFlag", "play", "step", "exportRun", "viewFirst", "viewMap", "fullscreen"];
  const missing = wanted.filter((id) => !reached.has(id));
  check("Tab reaches every control", missing.length === 0, missing.join(",") || `${reached.size} controls`);
  const weak = [...reached].filter(([, outline]) => !/^solid (2|3)\.?\d*px$/.test(outline) && !/^solid [3-9]px$/.test(outline)).map(([id, outline]) => `${id}:${outline}`);
  check("Focused controls show a solid 3px outline", weak.length === 0, weak.join(" "));

  // Fullscreen (needs a user gesture; skipped in browsers that refuse it).
  await page.evaluate(`${$("fullscreen")}.click()`, true);
  await wait(600);
  const fullscreenOn = await page.evaluate(`document.fullscreenElement && document.fullscreenElement.id`);
  if (fullscreenOn) {
    check("Fullscreen enters on the canvas shell", fullscreenOn === "canvasShell");
    await page.evaluate(`${$("fullscreen")}.click()`, true);
    await wait(600);
    check("Fullscreen exits again", (await page.evaluate(`document.fullscreenElement`)) === null);
  } else {
    console.log("SKIP  fullscreen (browser refused the request in this context)");
  }

  // Reduced motion keeps the view still within a transition; normal motion moves it.
  const stillFrames = async (reduced) => {
    await load(`seed=1&rng=microsoft&objects=0&reduced=${reduced}`);
    await page.evaluate(`(() => { for (let i = 0; i < 43; i += 1) ${$("step")}.click(); })()`);
    const rect = await page.evaluate(`(() => { const b = ${$("canvasShell")}.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, scale: 1 }; })()`);
    await wait(150); // let the compositor present the synchronous renders before capturing
    const a = (await page.send("Page.captureScreenshot", { format: "png", clip: rect })).data;
    await page.evaluate(`(() => { for (let i = 0; i < 3; i += 1) ${$("step")}.click(); })()`);
    await wait(150);
    const b = (await page.send("Page.captureScreenshot", { format: "png", clip: rect })).data;
    return a === b;
  };
  check("Reduced motion: view holds still during a transition", (await stillFrames(1)) === true);
  check("Normal motion: view moves during a transition", (await stillFrames(0)) === false);
  await load("seed=1&rng=microsoft&reduced=0&objects=1");

  // Resize during play and pause keeps the simulation running/frozen and the backing store matched to the CSS size.
  const dims = () => page.evaluate(`(() => { const c = ${$("webglCanvas")}; return { css: [c.clientWidth, c.clientHeight], backing: [c.width, c.height], dpr: devicePixelRatio, overflow: document.documentElement.scrollWidth > innerWidth }; })()`);
  await load("seed=1&rng=microsoft&reduced=0&objects=1");
  await page.evaluate(`${$("play")}.click()`);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 420, height: 800, deviceScaleFactor: 2, mobile: false });
  await wait(700);
  const narrow = await dims();
  const u1 = Number(await text("updates"));
  await wait(500);
  check("Resize during play keeps the run advancing", Number(await text("updates")) > u1);
  check("Narrow DPR 2: backing store is CSS size x 2 with no horizontal overflow", narrow.backing[0] === narrow.css[0] * 2 && narrow.backing[1] === narrow.css[1] * 2 && !narrow.overflow, JSON.stringify(narrow));
  await page.evaluate(`${$("play")}.click()`);
  const frozenAt = Number(await text("updates"));
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(600);
  const wide = await dims();
  check("Resize while paused leaves the simulation frozen", Number(await text("updates")) === frozenAt);
  check("Wide DPR 1: backing store equals CSS size", wide.backing[0] === wide.css[0] && wide.backing[1] === wide.css[1], JSON.stringify(wide));

  // Markers: render the original-camera entrance and exit poses (entry edge of the cell, facing east) with the flag off and on.
  const markerPixels = await page.evaluate(`(async () => {
    const { generateMaze } = await import(new URL('./src/maze.js', document.baseURI).href);
    const { WebGLMazeRenderer } = await import(new URL('./src/webgl-renderer.js', document.baseURI).href);
    const { originalEdgePose } = await import(new URL('./src/walker.js', document.baseURI).href);
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:200px;visibility:hidden';
    document.body.append(canvas);
    const r = new WebGLMazeRenderer(canvas);
    const maze = generateMaze({ seed: 1, twisterCount: 0 });
    r.setMaze(maze);
    const gl = r.gl;
    const centre = (pose) => { r.render(pose, {}); const px = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px.slice(0, 3)); };
    const out = {};
    const entrancePose = originalEdgePose(maze.entrance.x, maze.entrance.y, 'right'); // Start sign billboard 0.5 ahead
    // Enter the exit cell through one of its open passages (the route can only arrive that way): the smiley is 0.5 ahead.
    const exitCell = maze.cells.find((c) => c.x === maze.exit.x && c.y === maze.exit.y);
    const arrival = exitCell.passages.left ? 'right' : exitCell.passages.up ? 'down' : 'up';
    const exitPose = originalEdgePose(maze.exit.x, maze.exit.y, arrival);
    r.setMarkers(false); out.entranceOff = centre(entrancePose); out.exitOff = centre(exitPose);
    r.setMarkers(true); out.entranceOn = centre(entrancePose); out.exitOn = centre(exitPose);
    r.dispose(); canvas.remove();
    return out;
  })()`);
  const greenish = (c) => c[1] > c[0] * 1.3;
  const brick = (c) => c[0] > c[1] * 1.8;
  check("Markers off: brick walls, no Start sign or smiley, at the entrance and the exit (the boundary walls are closed)", brick(markerPixels.entranceOff) && brick(markerPixels.exitOff), JSON.stringify(markerPixels));
  check("Markers on: the Start sign billboard is green and the smiley billboard is yellow, straight ahead", greenish(markerPixels.entranceOn) && markerPixels.exitOn[0] > 150 && markerPixels.exitOn[2] < 120, JSON.stringify(markerPixels));
  await load("seed=1&rng=microsoft&reduced=0&objects=1");

  // Experimental objects: picture walls, logo objects and rats change the rendered pixels only when enabled.
  const objectPixels = await page.evaluate(`(async () => {
    const { generateMaze } = await import(new URL('./src/maze.js', document.baseURI).href);
    const { AutoWalker } = await import(new URL('./src/walker.js', document.baseURI).href);
    const { WebGLMazeRenderer } = await import(new URL('./src/webgl-renderer.js', document.baseURI).href);
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:200px;visibility:hidden';
    document.body.append(canvas);
    const r = new WebGLMazeRenderer(canvas);
    const gl = r.gl;
    const frame = (pose, extra = {}) => { r.render(pose, extra); const px = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n += 1; return n / (a.length / 4); };
    const out = {};
    // Picture wall: stand in the cell on the owning side of a picture and look at it.
    let maze;
    for (let seed = 1; seed < 40; seed += 1) { maze = generateMaze({ seed, twisterCount: 0 }); if (maze.pictures.length) break; }
    r.setMaze(maze);
    const w = maze.pictures[0];
    const headings = { n: 0, e: Math.PI / 2, s: Math.PI, w: Math.PI * 1.5 };
    // Look at the wall from inside the cell it belongs to (north wall: face up; west wall: face left; ...).
    const pose = { x: w.x, y: w.y, heading: headings[w.side] };
    r.setExperimental({ pictures: false });
    const off = frame(pose);
    r.setExperimental({ pictures: true });
    out.picture = diff(off, frame(pose));
    // Logo object: face it from the neighbouring cell centre.
    let logoMaze;
    for (let seed = 1; seed < 200; seed += 1) { logoMaze = generateMaze({ seed, twisterCount: 0 }); if (logoMaze.logos.length) break; }
    r.setMaze(logoMaze);
    const logo = logoMaze.logos[0];
    const lpose = { x: logo.x - 0.3, y: logo.y, heading: Math.PI / 2 };
    r.setExperimental({ logos: false });
    const loff = frame(lpose, { simUpdates: 3 });
    r.setExperimental({ logos: true });
    out.logo = diff(loff, frame(lpose, { simUpdates: 3 }));
    // Rat: put a walker one cell ahead of the camera.
    r.setMaze(generateMaze({ seed: 1, twisterCount: 0 }));
    r.setExperimental({});
    const rpose = { x: 3, y: 3, heading: Math.PI / 2 };
    const noRat = frame(rpose, { rats: [] });
    out.rat = diff(noRat, frame(rpose, { rats: [{ pose: { x: 4, y: 3 } }] }));
    r.dispose(); canvas.remove();
    return out;
  })()`);
  check("Picture walls change the view only when enabled", objectPixels.picture > 0.01, JSON.stringify(objectPixels));
  check("Logo objects change the view only when enabled", objectPixels.logo > 0.0005, JSON.stringify(objectPixels));
  check("A rat in front of the camera is drawn", objectPixels.rat > 0.0005, JSON.stringify(objectPixels));
  await load("seed=1&rng=microsoft&reduced=0&objects=1");

  // Context loss / restore.
  const lost = await page.evaluate(`(async () => {
    const gl = ${$("webglCanvas")}.getContext('webgl2'); const ext = gl.getExtension('WEBGL_lose_context');
    ext.loseContext(); await new Promise((r) => setTimeout(r, 200));
    const during = { glHidden: ${$("webglCanvas")}.hidden, mapShown: !${$("mazeCanvas")}.hidden, note: ${$("announcement")}.textContent };
    ext.restoreContext(); await new Promise((r) => setTimeout(r, 400));
    return { during, after: { glShown: !${$("webglCanvas")}.hidden, note: ${$("announcement")}.textContent } };
  })()`);
  check("Context loss falls back to the debug map", lost.during.glHidden && lost.during.mapShown);
  check("Context restore returns to first person", lost.after.glShown && /restored/.test(lost.after.note));

  // Objects flag restarts the run and removes triggers.
  await load("seed=1&rng=microsoft&objects=0");
  check("objects=0 URL flag turns trigger solids off", !(await page.evaluate(`${$("objectsFlag")}.checked`)) && (await text("eventLog")).includes("0 trigger solids"));

  // WebGL-unavailable fallback.
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: "(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); }; })()" });
  await load("seed=1");
  check("Without WebGL 2 the debug map is shown", await page.evaluate(`!${$("mazeCanvas")}.hidden && ${$("viewFirst")}.disabled`));

  const errors = page.events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => JSON.stringify(e.params).slice(0, 200));
  check("No uncaught page exceptions", errors.length === 0, errors[0] ?? "");
} catch (error) {
  check("smoke run completed", false, String(error.message ?? error).slice(0, 300));
} finally {
  harness.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed.`);
process.exit(failed.length ? 1 : 0);
