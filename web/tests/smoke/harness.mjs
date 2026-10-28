// Shared dev harness for the browser smoke and visual tests: starts a throw-away local server and a headless
// Chromium browser (Chrome or Edge) and exposes a minimal DevTools-protocol page handle.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const freePort = () => new Promise((resolve) => {
  const server = createServer().listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

// GLMAZE_BASE_URL points the tests at an already running site (for example the published GitHub Pages URL): no local server is
// started and the browser still gets a fresh throw-away profile. GLMAZE_SERVE_DIR and GLMAZE_BASE_PATH apply to the local server only.
// GLMAZE_BROWSER_ARGS adds browser flags (space separated), e.g. "--no-sandbox --use-angle=swiftshader" on a CI runner.
export async function startHarness({ browserArgs = [] } = {}) {
  browserArgs = [...browserArgs, ...(process.env.GLMAZE_BROWSER_ARGS ? process.env.GLMAZE_BROWSER_ARGS.split(" ").filter(Boolean) : [])];
  const chromePath = candidates.find((path) => existsSync(path));
  if (!chromePath) throw new Error("No Chrome/Edge found. Set CHROME_PATH.");
  const httpPort = await freePort();
  const debugPort = await freePort();
  const remote = process.env.GLMAZE_BASE_URL ? process.env.GLMAZE_BASE_URL.replace(/\/*$/, "/") : null;
  const server = remote ? null : spawn(process.execPath, ["web/server.mjs"], { cwd: root, env: { ...process.env, PORT: String(httpPort) }, stdio: "ignore" });
  const browser = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "glmaze-smoke-"))}`, "--no-first-run", "--enable-unsafe-swiftshader", ...browserArgs, "about:blank"], { stdio: "ignore" });

  const rawBase = process.env.GLMAZE_BASE_PATH ?? "/";
  const basePath = `/${rawBase.replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");
  const baseUrl = remote ?? `http://127.0.0.1:${httpPort}${basePath}`;
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch { /* retry */ } await wait(200); }
  let targets;
  for (let i = 0; i < 60; i += 1) {
    try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch { /* retry */ }
    await wait(250);
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); } else events.push(data);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (data) => (data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression, userGesture = false) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  const close = () => { browser.kill(); server?.kill(); };
  return { page: { send, evaluate, events }, httpPort, baseUrl, close, browserPath: chromePath };
}
