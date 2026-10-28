import { MazeRun } from "./run.js";
import { SIMULATION_STEP_MS } from "./walker.js";

// Deterministic per-update evidence export. One record per 25 ms simulation update, independent of the display frame
// rate, so a run can be compared update by update with a future analysis of the original or with another browser.
// The same seed, RNG mode and options always produce byte-identical output on one engine; floating-point values are
// rounded to nine decimals so engines whose Math.sin / Math.cos differ in the last bit still agree.
//
// Coordinates: cameraX / cameraZ are the renderer's world position in cell units (cell (i, j) covers x in [i, i+1] and
// z in [j, j+1]; z is the original's y axis). headingRad is the renderer heading, 0 = toward -z, increasing clockwise
// seen from above. cell is the last completed cell; destination is the cell being entered during a move (the original
// advances its cell index at the START of a move, the browser at the end). moveUpdate is the update index inside the
// 18-update move (0 = decision call, 1 to 17 = integration, 18 = snap and next decision, reported as 0 of the next move);
// markerMode only says whether the Start and smiley artwork is drawn, it never changes the camera or the world.
// Version 2 dropped two constant fields when the edge-entry camera became the only camera.

export const TELEMETRY_VERSION = 2;

function round(value) {
  if (typeof value !== "number") return value;
  const rounded = Math.round(value * 1e9) / 1e9;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function objectEvent(event) {
  if (event.type === "twister") return "consumed";
  if (event.type === "roll") return event.roll === 0 ? "touch" : "rolling";
  return null;
}

/** One record describing the run right after an update. `event` is what run.step() returned (null for the initial state). */
export function telemetryRecord(run, event = null) {
  const walker = run.walker;
  const pose = walker.renderPose();
  const transition = walker.transition;
  return {
    update: run.updates,
    timeMs: run.updates * SIMULATION_STEP_MS,
    seed: run.runSeed,
    mazeSeed: run.maze.seed,
    rngMode: run.rngMode,
    mazeIndex: run.mazeIndex,
    phase: run.state,
    phaseUpdate: run.stateUpdates,
    cell: { x: walker.x, y: walker.y },
    destination: transition ? { x: transition.toX, y: transition.toY } : null,
    cameraX: round(pose.x + 0.5),
    cameraZ: round(pose.y + 0.5),
    headingRad: round(pose.heading),
    rollRad: round(walker.renderRoll()),
    inverted: walker.inverted,
    move: transition ? transition.choice : null,
    moveUpdate: transition ? transition.update : null,
    growth: round(run.growth),
    exitState: run.state === "exit" ? "shrinking" : run.state === "regenerate" ? "regenerating" : "none",
    markerMode: run.markers ? "billboard" : "off",
    event: event ? event.type : "init",
    objectEvent: event ? objectEvent(event) : null,
  };
}

/** Runs `updates` simulation updates and returns the initial record followed by one record per update. */
export function collectTelemetry({ seed = "2017", rngMode = "microsoft", updates = 1000, objects = true, rats = false, markers = false } = {}) {
  const run = new MazeRun({ seed, rngMode, objects, rats, markers });
  const records = [telemetryRecord(run)];
  for (let i = 0; i < updates; i += 1) {
    const event = run.step();
    records.push(telemetryRecord(run, event));
  }
  return records;
}

export function telemetryMeta(options, count) {
  return {
    type: "meta",
    version: TELEMETRY_VERSION,
    stepMs: SIMULATION_STEP_MS,
    seed: String(options.seed ?? "2017"),
    rngMode: options.rngMode ?? "microsoft",
    markers: Boolean(options.markers),
    objects: options.objects !== false,
    rats: Boolean(options.rats),
    records: count,
  };
}

/** Newline-delimited JSON: one meta line, then one line per record. */
export function toNdjson(records, options = {}) {
  return [telemetryMeta(options, records.length), ...records].map((line) => JSON.stringify(line)).join("\n") + "\n";
}
