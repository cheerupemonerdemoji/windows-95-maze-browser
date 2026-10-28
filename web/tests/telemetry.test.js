import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TELEMETRY_VERSION, collectTelemetry, telemetryMeta, toNdjson } from "../src/telemetry.js";
import { ENTRANCE_UPDATES, EXIT_UPDATES } from "../src/run.js";
import { SIMULATION_STEP_MS } from "../src/walker.js";

const FIELDS = [
  "update", "timeMs", "seed", "mazeSeed", "rngMode", "mazeIndex", "phase", "phaseUpdate", "cell", "destination",
  "cameraX", "cameraZ", "headingRad", "rollRad", "inverted", "move", "moveUpdate", "growth", "exitState",
  "markerMode", "event", "objectEvent",
];

test("seed 2017 telemetry is byte-identical across repeated runs, in both modes", () => {
  for (const markers of [false, true]) {
    const options = { seed: "2017", updates: 3000, markers };
    const a = toNdjson(collectTelemetry(options), options);
    const b = toNdjson(collectTelemetry(options), options);
    assert.equal(a, b);
    assert.equal(a.split("\n").length, 3000 + 1 + 1 + 1, "meta line, initial record, one record per update, trailing newline");
  }
  const a = toNdjson(collectTelemetry({ seed: "2017", updates: 500, markers: true }), { seed: "2017", markers: true });
  const b = toNdjson(collectTelemetry({ seed: "2017", updates: 500, markers: false }), { seed: "2017", markers: false });
  assert.notEqual(a, b, "the two modes are distinguishable");
});

test("telemetry does not depend on timers, frame rate or randomness other than the seeded stream", () => {
  const source = readFileSync(new URL("../src/telemetry.js", import.meta.url), "utf8");
  for (const forbidden of ["Date", "performance", "requestAnimationFrame", "Math.random", "setTimeout", "setInterval"]) {
    assert.equal(source.includes(forbidden), false, `telemetry.js must not use ${forbidden}`);
  }
  // Records are indexed by simulation update: time = update * 25 ms exactly.
  const records = collectTelemetry({ seed: "2017", updates: 200 });
  records.forEach((record, i) => {
    assert.equal(record.update, i);
    assert.equal(record.timeMs, i * SIMULATION_STEP_MS);
  });
});

test("every record carries the full evidence field set and finite coordinates", () => {
  const records = collectTelemetry({ seed: "2017", updates: 2500, markers: true });
  for (const record of records) {
    assert.deepEqual(Object.keys(record), FIELDS);
    for (const key of ["cameraX", "cameraZ", "headingRad", "rollRad", "growth"]) assert.ok(Number.isFinite(record[key]), key);
    assert.equal(record.seed, "2017");
    assert.equal(record.rngMode, "microsoft");
    assert.equal(record.markerMode, "billboard");
    assert.ok(record.cameraX >= -1e-6 && record.cameraX <= 12 + 1e-6 && record.cameraZ >= -1e-6 && record.cameraZ <= 12 + 1e-6, "inside the maze");
    assert.ok(["entrance", "running", "exit", "regenerate"].includes(record.phase));
    assert.ok(["none", "shrinking", "regenerating"].includes(record.exitState));
  }
  const first = records[0];
  assert.equal(first.event, "init");
  assert.equal(first.phase, "entrance");
  assert.equal(first.growth, 0);
  assert.equal(first.mazeSeed, "2017", "maze 0 uses the run seed itself");
  assert.equal(collectTelemetry({ seed: "2017", updates: 5 })[0].markerMode, "off");
});

test("the export records the lifecycle: entrance, running, exit, regenerate, entrance, with the recovered tick counts", () => {
  const records = collectTelemetry({ seed: "2017", updates: 6000, markers: true, objects: false });
  const phases = [];
  for (const record of records) {
    const last = phases[phases.length - 1];
    if (!last || last.phase !== record.phase || last.mazeIndex !== record.mazeIndex) phases.push({ phase: record.phase, mazeIndex: record.mazeIndex, count: 0 });
    phases[phases.length - 1].count += 1;
  }
  assert.deepEqual(phases.slice(0, 4).map((p) => p.phase), ["entrance", "running", "exit", "regenerate"]);
  assert.equal(phases[0].count, ENTRANCE_UPDATES, "initial record plus 40 entrance updates; the 41st update enters the running phase");
  assert.equal(phases[2].count, EXIT_UPDATES, "the finish update plus 41 shrink updates; the 42nd update reaches the regenerate state");
  assert.equal(phases[3].count, 1, "regenerate lasts one record");
  assert.equal(phases[4].phase, "entrance");
  assert.equal(phases[4].mazeIndex, 1);
  // exit states
  const states = new Set(records.map((record) => record.exitState));
  assert.deepEqual([...states].sort(), ["none", "regenerating", "shrinking"]);
});

test("object events and the scene roll are exported: a touch, 17 rolling updates, a consumption, and a half turn", () => {
  const records = collectTelemetry({ seed: 2, updates: 12000, objects: true });
  const touch = records.findIndex((r) => r.objectEvent === "touch");
  assert.ok(touch > 0, "a trigger is touched");
  const consumed = records.findIndex((r, i) => i > touch && r.objectEvent === "consumed");
  assert.equal(consumed - touch, 18, "the touch update adds no roll; 18 roll updates follow and the last one consumes the object");
  assert.equal(records[consumed - 1].objectEvent, "rolling");
  assert.equal(Math.abs(records[touch].rollRad - records[touch - 1].rollRad), 0, "no roll on the touch update");
  assert.ok(Math.abs(Math.abs(records[consumed].rollRad - records[touch].rollRad) - Math.PI) < 1e-6, "a half turn in all");
  assert.equal(records[consumed].inverted !== records[touch].inverted, true);
});

test("meta line describes the export and the format version", () => {
  const meta = telemetryMeta({ seed: 2017, markers: true }, 10);
  assert.deepEqual(meta, { type: "meta", version: TELEMETRY_VERSION, stepMs: 25, seed: "2017", rngMode: "microsoft", markers: true, objects: true, rats: false, records: 10 });
  const lines = toNdjson(collectTelemetry({ seed: "2017", updates: 2 }), { seed: "2017" }).trim().split("\n");
  assert.equal(JSON.parse(lines[0]).type, "meta");
  assert.equal(JSON.parse(lines[1]).update, 0);
});
