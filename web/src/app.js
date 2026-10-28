import { serializeMaze, validateMaze } from "./maze.js";
import { MazeRun, RUN_STATES } from "./run.js";
import { SIMULATION_STEP_MS, TRANSITION_UPDATES, originalEdgePose } from "./walker.js";
import { SETTINGS_KEY, parseSavedSettings, resolveSettings, serializeSettings } from "./settings.js";
import { WebGLMazeRenderer } from "./webgl-renderer.js";

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const context = elements.mazeCanvas.getContext("2d");
const params = new URLSearchParams(location.search);
const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");

// Settings hold only UI choices (no personal data); resolution logic lives in settings.js (unit tested).
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, serializeSettings(settings)); } catch { /* storage may be unavailable */ }
}

function readSaved() {
  try { return parseSavedSettings(localStorage.getItem(SETTINGS_KEY)); } catch { return {}; }
}

const settings = resolveSettings(params, readSaved());
let renderer = null;
let view = settings.view; // "first" | "map"; first person is preferred whenever WebGL 2 works

function reducedMotion() {
  return settings.reducedMotion ?? reducedMotionQuery.matches;
}

function announce(message) {
  elements.announcement.textContent = message;
}

function useFirstPerson() {
  return view === "first" && renderer !== null && !renderer.contextLost;
}

function syncView() {
  const first = useFirstPerson();
  elements.webglCanvas.hidden = !first;
  elements.mazeCanvas.hidden = first;
  elements.viewFirst.setAttribute("aria-pressed", String(view === "first"));
  elements.viewMap.setAttribute("aria-pressed", String(view === "map"));
}

function setView(next, message) {
  view = next;
  settings.view = next;
  saveSettings();
  syncView();
  render();
  if (message) announce(message);
}

try {
  renderer = new WebGLMazeRenderer(elements.webglCanvas, {
    onContextLost: () => {
      syncView();
      render();
      announce("WebGL context lost; showing the debug map until it is restored.");
    },
    onContextRestored: () => {
      syncView();
      render();
      announce("WebGL context restored.");
    },
  });
  renderer.setQuality(settings.quality);
  renderer.setMarkers(settings.markers);
  renderer.setExperimental(settings);
} catch (error) {
  console.warn(error);
  view = "map";
  elements.viewFirst.disabled = true;
  elements.viewFirst.title = "WebGL 2 is unavailable";
  elements.quality.disabled = true;
  announce("WebGL 2 is unavailable, so the debug map is shown instead of the first-person view.");
}
elements.seed.value = params.get("seed") ?? "windows-95";
elements.rngMode.value = params.get("rng") === "portable" ? "portable" : "microsoft";
elements.quality.value = settings.quality;
elements.objectsFlag.checked = settings.objects;
elements.markersFlag.checked = settings.markers;
elements.picturesFlag.checked = settings.pictures;
elements.logosFlag.checked = settings.logos;
elements.ratsFlag.checked = settings.rats;
elements.reducedMotion.checked = reducedMotion();
elements.fullscreen.disabled = !document.fullscreenEnabled;

let run;
let maze;
let walker;
let running = false;
let lastFrame = 0;
let accumulator = 0;
let startedAt = performance.now();
let events = [];

function log(message, type = "info") {
  events.unshift({ at: new Date().toISOString(), type, message, state: run.snapshot() });
  events = events.slice(0, 80);
  elements.eventLog.replaceChildren(...events.map((event) => {
    const item = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = event.at.slice(11, 19);
    item.append(time, ` ${event.message}`);
    return item;
  }));
}

function updateUrl() {
  const next = new URL(location.href);
  next.searchParams.set("seed", run.runSeed);
  next.searchParams.set("rng", run.rngMode);
  if (!settings.objects) next.searchParams.set("objects", "0"); else next.searchParams.delete("objects");
  history.replaceState(null, "", next);
}

function adoptMaze() {
  maze = run.maze;
  walker = run.walker;
  renderer?.setMaze(maze);
}

function setRunning(next) {
  running = next;
  elements.play.textContent = running ? "Pause" : "Play";
  elements.play.setAttribute("aria-pressed", String(running));
}

function reset() {
  run = new MazeRun({
    seed: elements.seed.value.trim() || "windows-95",
    rngMode: elements.rngMode.value,
    objects: settings.objects,
    rats: settings.rats,
    markers: settings.markers,
  });
  adoptMaze();
  setRunning(false);
  accumulator = 0;
  startedAt = performance.now();
  events = [];
  updateUrl();
  log(`Generated ${maze.width}×${maze.height} seed “${maze.seed}” with ${maze.rngMode} RNG and ${maze.handedness}-hand route (${run.validation.passageCount} passages, ${maze.twisters.length} trigger solids).`);
  render();
}

function simulateOne() {
  const event = run.step();
  if (event.type === "twister") log(`Trigger collected at ${event.x},${event.y}; world ${event.inverted ? "inverted" : "restored"}.`, "twister");
  if (event.type === "finish") {
    log(`Exit reached in ${event.steps} moves; the walls shrink.`, "finish");
    announce(`Exit reached in ${event.steps} moves.`);
  }
  if (event.type === "regenerated") {
    adoptMaze();
    log(`New maze ${event.mazeIndex + 1}: seed “${maze.seed}”, ${maze.handedness}-hand route, ${maze.twisters.length} trigger solids.`, "reset");
    announce(`New maze ${event.mazeIndex + 1} generated.`);
  }
  render();
}

function drawMap() {
  const rect = elements.mazeCanvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(320, Math.floor(rect.height));
  if (elements.mazeCanvas.width !== width * ratio || elements.mazeCanvas.height !== height * ratio) {
    elements.mazeCanvas.width = width * ratio;
    elements.mazeCanvas.height = height * ratio;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = walker.inverted ? "#111725" : "#080b0c";
  context.fillRect(0, 0, width, height);

  const padding = 24;
  const columns = maze.width;
  const size = Math.min((width - padding * 2) / columns, (height - padding * 2) / maze.height);
  const originX = (width - size * columns) / 2;
  const originY = (height - size * maze.height) / 2;
  context.lineWidth = Math.max(2, size * 0.07);
  context.lineCap = "square";
  context.strokeStyle = walker.inverted ? "#a78bfa" : "#83e7bd";

  for (const cell of maze.cells) {
    const x = originX + cell.x * size;
    const y = originY + cell.y * size;
    context.beginPath();
    if (!cell.passages.up) { context.moveTo(x, y); context.lineTo(x + size, y); }
    if (!cell.passages.right && !(cell.x === maze.exit.x && cell.y === maze.exit.y)) {
      context.moveTo(x + size, y); context.lineTo(x + size, y + size);
    }
    if (!cell.passages.down) { context.moveTo(x, y + size); context.lineTo(x + size, y + size); }
    if (!cell.passages.left && !(cell.x === maze.entrance.x && cell.y === maze.entrance.y)) {
      context.moveTo(x, y); context.lineTo(x, y + size);
    }
    context.stroke();

    if (cell.object !== "none") {
      const color = { start: "#4ade80", finish: "#fb7185", twister: "#fbbf24" }[cell.object];
      context.fillStyle = color;
      context.globalAlpha = cell.object === "twister" && walker.consumedTwisters.has(`${cell.x},${cell.y}`) ? 0.2 : 0.8;
      context.beginPath();
      context.arc(x + size / 2, y + size / 2, size * 0.12, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
    }
  }

  const pose = walker.renderPose();
  const angle = pose.heading;
  const x = originX + (pose.x + 0.5) * size;
  const y = originY + (pose.y + 0.5) * size;
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.moveTo(0, -size * 0.3);
  context.lineTo(size * 0.21, size * 0.22);
  context.lineTo(0, size * 0.14);
  context.lineTo(-size * 0.21, size * 0.22);
  context.closePath();
  context.fill();
  context.restore();
}

// Reduced motion keeps the simulation (and its 25 ms x 18 update timing) unchanged and only removes visual
// animation: the camera shows the logical cell and heading, the roll and the wall growth are skipped, solids hold still.
const staticPose = { x: 0, y: 0, heading: 0 };

function render() {
  syncView();
  if (useFirstPerson()) {
    if (reducedMotion()) {
      const held = originalEdgePose(walker.x, walker.y, walker.direction);
      staticPose.x = held.x;
      staticPose.y = held.y;
      staticPose.heading = held.heading;
      renderer.render(staticPose, { roll: walker.inverted ? Math.PI : 0, growth: 1, simUpdates: 0, consumed: walker.consumedTwisters, rats: run.rats });
    } else {
      renderer.render(walker.renderPose(), {
        roll: run.renderRoll(),
        growth: run.growth,
        simUpdates: run.updates + accumulator / SIMULATION_STEP_MS,
        consumed: walker.consumedTwisters,
        rats: run.rats,
      });
    }
  } else drawMap();

  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
  elements.position.textContent = `${walker.x}, ${walker.y}`;
  elements.direction.textContent = walker.direction;
  elements.handedness.textContent = `${walker.handedness}-hand`;
  elements.steps.textContent = walker.steps;
  elements.updates.textContent = run.updates;
  elements.simulationTime.textContent = `${run.updates * SIMULATION_STEP_MS} ms`;
  elements.turns.textContent = walker.turns;
  elements.deadEnds.textContent = walker.deadEnds;
  elements.twisters.textContent = walker.twisters;
  elements.elapsed.textContent = `${elapsed}s`;
  elements.world.textContent = walker.inverted ? "inverted" : "upright";
  elements.mazeIndex.textContent = run.mazeIndex + 1;
  elements.phase.textContent = run.state === RUN_STATES.RUNNING ? (walker.roll ? "rolling" : "walking") : run.state;
}

function frame(time) {
  const delta = lastFrame ? Math.min(time - lastFrame, 100) : 0;
  lastFrame = time;
  if (running) {
    accumulator += delta;
    while (accumulator >= SIMULATION_STEP_MS) {
      simulateOne();
      accumulator -= SIMULATION_STEP_MS;
    }
    render();
  }
  requestAnimationFrame(frame);
}

elements.play.addEventListener("click", () => setRunning(!running));
elements.step.addEventListener("click", () => {
  setRunning(false);
  simulateOne();
  announce(`Advanced one ${SIMULATION_STEP_MS} millisecond update of ${TRANSITION_UPDATES}.`);
});
elements.regenerate.addEventListener("click", reset);
elements.rngMode.addEventListener("change", reset);
elements.seed.addEventListener("keydown", (event) => { if (event.key === "Enter") reset(); });
elements.quality.addEventListener("change", () => {
  settings.quality = elements.quality.value;
  saveSettings();
  renderer?.setQuality(settings.quality);
  render();
  announce(`Quality set to ${settings.quality}.`);
});
elements.reducedMotion.addEventListener("change", () => {
  settings.reducedMotion = elements.reducedMotion.checked;
  saveSettings();
  render();
  announce(settings.reducedMotion ? "Reduced motion on: the view shows each cell without animation." : "Reduced motion off.");
});
reducedMotionQuery.addEventListener("change", () => {
  if (settings.reducedMotion === null) {
    elements.reducedMotion.checked = reducedMotion();
    render();
  }
});
elements.objectsFlag.addEventListener("change", () => {
  settings.objects = elements.objectsFlag.checked;
  saveSettings();
  reset();
  announce(settings.objects ? "Trigger solids on; run restarted." : "Trigger solids off; run restarted.");
});
elements.markersFlag.addEventListener("change", () => {
  settings.markers = elements.markersFlag.checked;
  saveSettings();
  renderer?.setMarkers(settings.markers);
  render(); // only the Start and smiley artwork changes; the camera, projection and world stay the same
  announce(settings.markers ? "Start and exit markers shown (experimental)." : "Start and exit markers hidden.");
});
for (const [id, key, label] of [["picturesFlag", "pictures", "Picture walls"], ["logosFlag", "logos", "Logo objects"]]) {
  elements[id].addEventListener("change", () => {
    settings[key] = elements[id].checked;
    saveSettings();
    renderer?.setExperimental(settings);
    render();
    announce(`${label} ${settings[key] ? "on" : "off"} (experimental).`);
  });
}
elements.ratsFlag.addEventListener("change", () => {
  settings.rats = elements.ratsFlag.checked;
  saveSettings();
  reset();
  announce(settings.rats ? "Rat on (experimental); run restarted." : "Rat off; run restarted.");
});
elements.fullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await elements.canvasShell.requestFullscreen();
  } catch (error) {
    announce("Fullscreen is not available in this browser context.");
  }
});
document.addEventListener("fullscreenchange", () => {
  const on = Boolean(document.fullscreenElement);
  elements.fullscreen.textContent = on ? "Exit fullscreen" : "Fullscreen";
  announce(on ? "Fullscreen on. Press Escape to leave." : "Fullscreen off.");
  render();
});
elements.exportRun.addEventListener("click", () => {
  const report = {
    exportedAt: new Date().toISOString(),
    seed: maze.seed,
    rngMode: maze.rngMode,
    entrance: maze.entrance,
    exit: maze.exit,
    handedness: maze.handedness,
    simulation: { stepMs: SIMULATION_STEP_MS, transitionUpdates: TRANSITION_UPDATES },
    maze: serializeMaze(maze),
    validation: validateMaze(maze),
    walker: walker.snapshot(),
    events: [...events].reverse(),
    // Additive fields (not in the first export format): run lifecycle and the UI settings in force.
    run: run.snapshot().run,
    settings: { quality: settings.quality, reducedMotion: reducedMotion(), objects: settings.objects, markers: settings.markers, pictures: settings.pictures, logos: settings.logos, rats: settings.rats },
  };
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  link.download = `glmaze-${maze.seed.replace(/[^a-z0-9_-]+/gi, "-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) {
    setRunning(false);
    log("Paused because the page was hidden.");
  }
});
elements.viewFirst.addEventListener("click", () => {
  if (renderer) setView("first", "First-person view selected.");
});
elements.viewMap.addEventListener("click", () => setView("map", "Debug map selected."));
new ResizeObserver(render).observe(elements.mazeCanvas.parentElement);
reset();
requestAnimationFrame(frame);
