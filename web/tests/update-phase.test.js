import test from "node:test";
import assert from "node:assert/strict";
import { ENTRANCE_UPDATES, EXIT_UPDATES, MazeRun, RUN_STATES } from "../src/run.js";
import { ROLL_UPDATES, TRANSITION_UPDATES, originalEdgePose } from "../src/walker.js";
import { collectTelemetry } from "../src/telemetry.js";

// The update-phase table (docs/original-exit-camera-analysis.md, "Update-phase table"), checked as an exact sequence of
// update indices and not only as a total duration. u = the update call that makes the decision (call 0 of a move).
//   u        decision: goal check, choose the move, cell index advances; the pose does not change
//   u+1..u+17  integration steps 1 to 17 (explicit Euler)
//   u+18     snap to the destination edge pose; goal detection; this call is the next decision call
// Exit: goal detected at the snap call (state 3 selected in the same call), then 42 shrink calls, then a regenerate call.
// Trigger: the touch happens at a decision call and adds no roll, then 18 roll calls (the last consumes the object).

const poseKey = (run) => JSON.stringify(run.renderPose());

test("entrance: 40 growing updates, the 41st enters the walking state, the 42nd is the first decision with no motion", () => {
  const run = new MazeRun({ seed: 2017, objects: false });
  const start = poseKey(run);
  for (let i = 1; i < ENTRANCE_UPDATES; i += 1) {
    assert.equal(run.step().type, "entering", `update ${i}`);
    assert.equal(poseKey(run), start, "the camera does not move while the walls grow");
  }
  assert.equal(run.step().type, "entered", "update 41");
  assert.equal(run.state, RUN_STATES.RUNNING);
  assert.equal(run.updates, 41);
  const decision = run.step();
  assert.equal(run.updates, 42);
  assert.equal(decision.type, "transition");
  assert.equal(decision.transition.update, 0, "update 42 is call 0 of the first move");
  assert.equal(poseKey(run), start, "the decision call does not move the camera");
});

test("one move, update by update: decision, 17 integration steps that each move the camera, snap that decides the next move", () => {
  const run = new MazeRun({ seed: 2017, objects: false });
  for (let i = 0; i < ENTRANCE_UPDATES; i += 1) run.step();
  const first = run.step(); // decision, update 42
  assert.equal(first.transition.update, 0);
  const from = [run.walker.x, run.walker.y];
  let previous = poseKey(run);
  const kinds = [];
  for (let k = 1; k <= 17; k += 1) {
    const event = run.step();
    assert.equal(run.updates, 42 + k);
    assert.equal(event.type, "transition");
    assert.equal(event.transition.update, k, `integration step ${k}`);
    assert.notEqual(poseKey(run), previous, `integration step ${k} moves or turns the camera`);
    assert.deepEqual([run.walker.x, run.walker.y], from, "the cell is unchanged until the snap");
    previous = poseKey(run);
    kinds.push(event.transition.choice);
  }
  assert.equal(new Set(kinds).size, 1, "one move kind for the whole move");
  const snap = run.step();
  assert.equal(run.updates, 42 + TRANSITION_UPDATES, "the snap is update 60");
  assert.equal(snap.type, "move");
  assert.equal(snap.transition.update, 0, "the snap call is call 0 of the next move");
  assert.deepEqual(run.renderPose(), originalEdgePose(run.walker.x, run.walker.y, run.walker.direction));
  assert.notDeepEqual([run.walker.x, run.walker.y], from);
  const next = run.step();
  assert.equal(next.transition.update, 1, "the update after the snap is integration step 1 of the next move");
});

test("goal detection: the exit is detected in the snap call, with no extra update before the shrink starts", () => {
  const run = new MazeRun({ seed: 2017, objects: false });
  let before = null;
  let event;
  do {
    before = { updates: run.updates, pose: poseKey(run) };
    event = run.step();
  } while (event.type !== "finish" && run.updates < 5000);
  assert.equal(event.type, "finish");
  assert.equal(event.moved, true, "the finish call also completed the last move");
  assert.equal(event.choice !== null, true);
  assert.equal(run.updates - before.updates, 1);
  assert.equal(run.state, RUN_STATES.EXIT);
  assert.equal(run.stateUpdates, 0);
  assert.ok(run.growth > 1, "the walls are still at 1.025 on the detection call");
  const raw = [];
  while (run.state === RUN_STATES.EXIT) { run.step(); raw.push(run.growth); }
  assert.equal(raw.length, EXIT_UPDATES);
  assert.equal(run.state, RUN_STATES.REGENERATE);
  assert.equal(run.step().type, "regenerated", "regeneration is the update after the last shrink update");
});

test("telemetry shows the move-update index cycling 0 to 17 with the snap reported as 0 of the next move", () => {
  const records = collectTelemetry({ seed: 2017, updates: 400, objects: false });
  const walking = records.filter((r) => r.phase === "running" && r.update >= 42); // update 41 is the entering update
  const indices = walking.slice(0, 18 * 4).map((r) => r.moveUpdate);
  indices.forEach((value, i) => assert.equal(value, i % 18, `walking update ${i}`));
});

test("trigger: a touch update with no roll, 17 roll updates, the consuming update, then a decision update", () => {
  let found = null;
  for (let seed = 0; seed < 300 && !found; seed += 1) {
    const records = collectTelemetry({ seed, updates: 2500, objects: true });
    const touch = records.findIndex((r) => r.objectEvent === "touch");
    if (touch > 0) found = { seed, records, touch };
  }
  assert.ok(found, "a seed with a collected trigger");
  const { records, touch } = found;
  const at = (i) => records[i];
  assert.equal(at(touch).event, "roll");
  assert.equal(at(touch).rollRad, at(touch - 1).rollRad, "the touch update adds no roll");
  for (let k = 1; k <= 17; k += 1) {
    const r = at(touch + k);
    assert.equal(r.objectEvent, "rolling", `roll update ${k}`);
    assert.ok(Math.abs(r.rollRad - at(touch).rollRad - (k * Math.PI) / ROLL_UPDATES) < 1e-6, "10 degrees per update");
    assert.deepEqual(r.cell, at(touch).cell, "no movement while rolling");
    assert.equal(r.move, null, "navigation is paused");
  }
  const consumed = at(touch + 18);
  assert.equal(consumed.objectEvent, "consumed");
  assert.ok(Math.abs(Math.abs(consumed.rollRad - at(touch).rollRad) - Math.PI) < 1e-6, "a half turn in 18 roll updates");
  const resume = at(touch + 19);
  assert.equal(resume.event, "transition");
  assert.equal(resume.moveUpdate, 0, "the update after the consumption is a decision call");
  assert.equal(resume.rollRad, consumed.rollRad, "the decision call does not move or roll the camera");
  assert.equal(at(touch + 20).moveUpdate, 1);
});
