// Mobile viewport emulation checks (dev and CI tool): drives headless Chrome or Edge over the DevTools protocol with phone-sized
// viewports, device pixel ratios 2 to 3, touch emulation and both orientations. THIS IS EMULATION, NOT A PHYSICAL PHONE: it checks
// layout, sizing, controls and resilience, but it cannot show touch latency, thermal behaviour, the on-screen keyboard, mobile GPU
// artefacts or real Safari. Real-device status is tracked in docs/phone-acceptance.md.
//   npm run smoke:mobile
// GLMAZE_SERVE_DIR / GLMAZE_BASE_PATH test the built artifact under a sub-path (see web/tools/package.mjs).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startHarness, wait } from "./harness.mjs";

const DEVICES = [
  { name: "iPhone 16", width: 393, height: 852, dpr: 3, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", noFullscreenApi: true },
  { name: "iPhone SE", width: 375, height: 667, dpr: 2, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", noFullscreenApi: true },
  { name: "Pixel 9", width: 412, height: 915, dpr: 2.625, ua: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", noFullscreenApi: false },
];
const MIN_TOUCH = 44; // CSS px; Apple asks for 44, Material for 48, WCAG 2.2 AA for 24
const MAX_DPR_USED = 2; // CAMERA_CONFIG.maxPixelRatio

const harness = await startHarness();
const { page, baseUrl } = harness;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const $ = (id) => `document.getElementById('${id}')`;

async function emulate(device, landscape) {
  const width = landscape ? device.height : device.width;
  const height = landscape ? device.width : device.height;
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: device.dpr, mobile: true, screenOrientation: { type: landscape ? "landscapePrimary" : "portraitPrimary", angle: landscape ? 90 : 0 } });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await page.send("Emulation.setUserAgentOverride", { userAgent: device.ua });
  return { width, height };
}

let scriptId = null;
async function injectBeforeLoad(source) {
  if (scriptId) await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
  scriptId = source ? (await page.send("Page.addScriptToEvaluateOnNewDocument", { source })).identifier : null;
}

async function load(query) {
  await page.send("Page.navigate", { url: `${baseUrl}?${query}` });
  await wait(1400);
}

try {
  for (const device of DEVICES) {
    for (const landscape of [false, true]) {
      const label = `${device.name} ${landscape ? "landscape" : "portrait"}`;
      const { width, height } = await emulate(device, landscape);
      // Hide the Fullscreen API on iPhones, as Safari on iPhone does (document.fullscreenEnabled is undefined there).
      await injectBeforeLoad(device.noFullscreenApi ? "Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get() { return undefined; } });" : null);
      await load("seed=2017&rng=microsoft&reduced=0&quality=high");

      const layout = await page.evaluate(`(() => {
        const root = document.documentElement;
        const canvas = ${$("webglCanvas")};
        const small = [];
        for (const el of document.querySelectorAll('button, select, input[type=text], label.check')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.height < ${MIN_TOUCH} - 0.5 || r.width < ${MIN_TOUCH} - 0.5) small.push((el.id || el.textContent.trim().slice(0, 18)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        }
        return { innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio, scrollWidth: root.scrollWidth, canvasHidden: canvas.hidden, canvasCss: [canvas.clientWidth, canvas.clientHeight], backing: [canvas.width, canvas.height], small, touch: navigator.maxTouchPoints };
      })()`);
      check(`${label}: viewport is ${width}x${height} at DPR ${device.dpr} with touch`, layout.innerWidth === width && Math.abs(layout.dpr - device.dpr) < 0.01 && layout.touch > 0, JSON.stringify({ w: layout.innerWidth, dpr: layout.dpr, touch: layout.touch }));
      check(`${label}: first-person view is shown`, layout.canvasHidden === false);
      check(`${label}: no horizontal overflow`, layout.scrollWidth <= layout.innerWidth + 1, `scrollWidth ${layout.scrollWidth} vs ${layout.innerWidth}`);
      const expectedRatio = Math.min(device.dpr, MAX_DPR_USED);
      check(`${label}: canvas backing store is CSS size x ${expectedRatio}`, Math.abs(layout.backing[0] - Math.round(layout.canvasCss[0] * expectedRatio)) <= 1 && Math.abs(layout.backing[1] - Math.round(layout.canvasCss[1] * expectedRatio)) <= 1, JSON.stringify({ css: layout.canvasCss, backing: layout.backing }));
      check(`${label}: every control is at least ${MIN_TOUCH} CSS px in both directions`, layout.small.length === 0, layout.small.slice(0, 6).join("; "));

      if (process.env.MOBILE_SHOTS) {
        mkdirSync(process.env.MOBILE_SHOTS, { recursive: true });
        const shot = await page.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(process.env.MOBILE_SHOTS, label.replace(/ /g, "-") + ".png"), Buffer.from(shot.data, "base64"));
      }

      // Play and Pause.
      const before = Number(await page.evaluate(`${$("updates")}.textContent`));
      await page.evaluate(`${$("play")}.click()`);
      await wait(700);
      const running = Number(await page.evaluate(`${$("updates")}.textContent`));
      await page.evaluate(`${$("play")}.click()`);
      const paused = Number(await page.evaluate(`${$("updates")}.textContent`));
      await wait(300);
      const stillPaused = Number(await page.evaluate(`${$("updates")}.textContent`));
      check(`${label}: Play advances the simulation and Pause freezes it`, running > before + 5 && paused === stillPaused, `${before} -> ${running}, paused at ${paused}`);

      // Regenerate with a new seed; the seed is kept in the URL.
      await page.evaluate(`(() => { const s = ${$("seed")}; s.value = 'phone-test'; ${$("regenerate")}.click(); })()`);
      await wait(300);
      const afterGenerate = await page.evaluate(`({ seed: new URL(location.href).searchParams.get('seed'), updates: ${$("updates")}.textContent, maze: ${$("mazeIndex")}.textContent })`);
      check(`${label}: Generate restarts the run and keeps the seed in the URL`, afterGenerate.seed === "phone-test" && afterGenerate.updates === "0" && afterGenerate.maze === "1", JSON.stringify(afterGenerate));

      // A short repeated-reset run: step through two exits and regenerations of seed 2017 (finish at update 403).
      await page.evaluate(`(() => { const s = ${$("seed")}; s.value = '2017'; ${$("regenerate")}.click(); })()`);
      await wait(200);
      await page.evaluate(`(() => { const b = ${$("step")}; for (let i = 0; i < 480; i += 1) b.click(); })()`);
      await wait(200);
      const afterExit = await page.evaluate(`({ maze: ${$("mazeIndex")}.textContent, phase: ${$("phase")}.textContent, log: ${$("eventLog")}.textContent.includes('New maze 2') })`);
      check(`${label}: the run exits, regenerates a new maze and keeps going`, afterExit.maze === "2" && afterExit.log, JSON.stringify(afterExit));

      // Fullscreen availability: enabled where the API exists, disabled (not broken) where it does not.
      const fullscreen = await page.evaluate(`({ disabled: ${$("fullscreen")}.disabled, api: document.fullscreenEnabled })`);
      check(`${label}: fullscreen control matches API availability`, device.noFullscreenApi ? fullscreen.disabled === true : fullscreen.disabled === !fullscreen.api, JSON.stringify(fullscreen));

      // Canvas resizing on orientation change: switch to the other orientation without reloading.
      const flipped = await emulate(device, !landscape);
      await wait(600);
      const resized = await page.evaluate(`(() => { const c = ${$("webglCanvas")}; return { css: [c.clientWidth, c.clientHeight], backing: [c.width, c.height], overflow: document.documentElement.scrollWidth - window.innerWidth, w: window.innerWidth }; })()`);
      check(`${label}: orientation change resizes the canvas without overflow`, resized.w === flipped.width && resized.overflow <= 1 && Math.abs(resized.backing[0] - Math.round(resized.css[0] * expectedRatio)) <= 1, JSON.stringify(resized));
      await emulate(device, landscape);

      // Reduced motion honoured from the system setting.
      await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await page.evaluate("localStorage.clear()");
      await load("seed=2017&rng=microsoft");
      const reduced = await page.evaluate(`({ checked: ${$("reducedMotion")}.checked })`);
      check(`${label}: reduce-motion follows the system setting`, reduced.checked === true, JSON.stringify(reduced));
      await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
      await page.evaluate("localStorage.clear()");

      // WebGL 2 missing: the debug map is shown and nothing overflows or throws.
      await injectBeforeLoad(`${device.noFullscreenApi ? "Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get() { return undefined; } });" : ""} (() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); }; })();`);
      await load("seed=2017");
      const fallback = await page.evaluate(`({ map: !${$("mazeCanvas")}.hidden, first: ${$("viewFirst")}.disabled, overflow: document.documentElement.scrollWidth - window.innerWidth })`);
      check(`${label}: without WebGL 2 the debug map is shown and layout holds`, fallback.map && fallback.first && fallback.overflow <= 1, JSON.stringify(fallback));
    }
  }
  const errors = page.events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => JSON.stringify(e.params).slice(0, 240));
  check("No uncaught page exceptions on any phone profile", errors.length === 0, errors[0] ?? "");
} catch (error) {
  check("mobile run completed", false, String(error.message ?? error).slice(0, 400));
} finally {
  harness.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} mobile emulation checks passed (emulation only; not a physical-phone test).`);
process.exit(failed.length ? 1 : 0);
