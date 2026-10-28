import test from "node:test";
import assert from "node:assert/strict";
import { ENTRANCE_UPDATES, EXIT_UPDATES, MazeRun, RUN_STATES } from "../src/run.js";
import { AutoWalker, originalEdgePose } from "../src/walker.js";
import { collectTelemetry } from "../src/telemetry.js";
import { generateMaze } from "../src/maze.js";
import { markerBillboards } from "../src/webgl-geometry.js";

// The recovered original camera is the only camera. It stands on the midpoint of the edge through which it entered its cell,
// facing into the cell, so the cell-centre Start sign and smiley billboards are 0.5 straight ahead at the start and when the
// exit cell is entered. The artwork flag (markers) never changes the camera, the projection or the world.

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, "windows-95", "maze-95", 2017];

function runToFinish(run, limit = 20000) {
  for (let i = 0; i < limit; i += 1) {
    const event = run.step();
    if (event.type === "finish") return event;
  }
  throw new Error("no finish");
}

const forwardOf = (heading) => ({ x: Math.sin(heading), z: -Math.cos(heading) });

test("every run starts on the entrance cell's west edge facing east, with or without the marker artwork", () => {
  for (const markers of [false, true]) {
    for (const seed of SEEDS) {
      const run = new MazeRun({ seed, markers });
      const w = run.walker;
      assert.equal(w.direction, "right");
      assert.deepEqual([w.x, w.y], [run.maze.entrance.x, run.maze.entrance.y]);
      const pose = run.renderPose();
      assert.equal(pose.x + 0.5, run.maze.entrance.x);
      assert.equal(pose.y + 0.5, run.maze.entrance.y + 0.5);
      assert.ok(Math.abs(pose.heading - Math.PI / 2) < 1e-12);
      const [sign] = markerBillboards(run.maze);
      const forward = forwardOf(pose.heading);
      const dx = sign.x - (pose.x + 0.5), dz = sign.z - (pose.y + 0.5);
      assert.ok(Math.abs(dx * forward.x + dz * forward.z - 0.5) < 1e-9, "0.5 ahead");
      assert.ok(Math.abs(dx * forward.z - dz * forward.x) < 1e-9, "no sideways offset");
    }
  }
});

test("marker artwork is decoupled from camera, projection and world: runs differ only in the markerMode field", () => {
  const strip = (records) => records.map(({ markerMode, ...rest }) => JSON.stringify(rest));
  const off = collectTelemetry({ seed: 2017, updates: 2500, markers: false });
  const on = collectTelemetry({ seed: 2017, updates: 2500, markers: true });
  assert.deepEqual(strip(on), strip(off));
  assert.equal(off[0].markerMode, "off");
  assert.equal(on[0].markerMode, "billboard");
  const a = new MazeRun({ seed: 7, markers: false });
  const b = new MazeRun({ seed: 7, markers: true });
  assert.deepEqual(a.walker.renderPose(), b.walker.renderPose());
  assert.equal(JSON.stringify(a.maze), JSON.stringify(b.maze));
});

test("the run ends on the exit cell, inside the maze, on its entry edge with the smiley 0.5 straight ahead", () => {
  const sides = new Set();
  for (const seed of SEEDS) {
    const run = new MazeRun({ seed, objects: false });
    const event = runToFinish(run);
    const w = run.walker;
    assert.equal(event.type, "finish");
    assert.equal(run.state, RUN_STATES.EXIT);
    assert.deepEqual([w.x, w.y], [run.maze.exit.x, run.maze.exit.y], `seed ${seed}: the run ends on the exit cell`);
    assert.equal(w.x, run.maze.width - 1);
    const pose = run.renderPose();
    assert.deepEqual(pose, originalEdgePose(w.x, w.y, w.direction), "snapped to the exact edge pose");
    const [, smiley] = markerBillboards(run.maze);
    const forward = forwardOf(pose.heading);
    const dx = smiley.x - (pose.x + 0.5), dz = smiley.z - (pose.y + 0.5);
    assert.ok(Math.abs(dx * forward.x + dz * forward.z - 0.5) < 1e-6, `seed ${seed}: smiley 0.5 straight ahead`);
    assert.ok(Math.abs(dx * forward.z - dz * forward.x) < 1e-6, `seed ${seed}: smiley on the view axis`);
    sides.add(w.direction);
  }
  assert.ok(sides.size >= 2, "different seeds arrive from different sides; the rule does not depend on the side");
});

test("the camera stays still and the wall ahead and the marker persist for the whole exit transition", () => {
  for (const seed of SEEDS) {
    const run = new MazeRun({ seed, markers: true, objects: false });
    runToFinish(run);
    const still = JSON.stringify(run.renderPose());
    const [, smiley] = markerBillboards(run.maze);
    let previous = run.growth;
    let updates = 0;
    while (run.state === RUN_STATES.EXIT) {
      assert.equal(JSON.stringify(run.renderPose()), still, "no camera motion during the exit");
      assert.equal(run.walker.finished, true);
      run.step();
      updates += 1;
      assert.ok(run.growth < previous, "growth falls on every update");
      previous = run.growth;
      const visible = Math.min(1, Math.max(0, run.growth));
      if (run.state === RUN_STATES.EXIT) {
        assert.ok(visible > 0, `update ${updates}: the wall and the marker are still drawn`);
        assert.ok(smiley.height * visible > 0);
      }
    }
    assert.equal(updates, EXIT_UPDATES, "42 updates from the finish update to the regenerate state");
    assert.equal(run.state, RUN_STATES.REGENERATE);
  }
});

test("the shrink is followed by the next maze growing from zero: 1 regenerate update, then 41 entrance updates", () => {
  const run = new MazeRun({ seed: 2017, objects: false });
  runToFinish(run);
  for (let i = 0; i < EXIT_UPDATES; i += 1) run.step();
  assert.equal(run.state, RUN_STATES.REGENERATE);
  assert.ok(run.growth <= 0);
  const regenerated = run.step();
  assert.equal(regenerated.type, "regenerated");
  assert.equal(run.state, RUN_STATES.ENTRANCE);
  assert.equal(run.growth, 0, "the next maze starts flat");
  assert.equal(run.walker.direction, "right");
  const growth = [];
  while (run.state === RUN_STATES.ENTRANCE) {
    run.step();
    growth.push(run.growth);
  }
  assert.equal(growth.length, ENTRANCE_UPDATES);
  assert.ok(growth.every((value, i) => i === 0 || value > growth[i - 1]), "monotonic growth");
  assert.ok(growth[growth.length - 2] < 1 && growth[growth.length - 1] > 1);
  assert.deepEqual(run.renderPose(), originalEdgePose(run.maze.entrance.x, run.maze.entrance.y, "right"));
});

test("a straight move advances 1/18 cell per integration update and 17/18 before the snap", () => {
  const walker = new AutoWalker(generateMaze({ seed: 1, twisterCount: 0 }));
  let found = null;
  for (let i = 0; i < 2000 && !found; i += 1) {
    walker.step();
    if (walker.transition && walker.transition.choice === "forward" && walker.transition.update === 0) found = walker.renderPose();
  }
  assert.ok(found, "a straight move occurred");
  for (let k = 1; k <= 17; k += 1) {
    const before = walker.renderPose();
    walker.step();
    const after = walker.renderPose();
    assert.ok(Math.abs(Math.hypot(after.x - before.x, after.y - before.y) - 1 / 18) < 1e-12);
  }
  const near = walker.renderPose();
  assert.ok(Math.abs(Math.hypot(near.x - found.x, near.y - found.y) - 17 / 18) < 1e-9);
  walker.step();
  const end = walker.renderPose();
  assert.ok(Math.abs(Math.hypot(end.x - found.x, end.y - found.y) - 1) < 1e-6, "the snap lands on the next edge");
});

test("turns advance the heading 5 degrees and reversals 10 degrees per integration update", () => {
  let turns = 0, reverses = 0;
  const w = new AutoWalker(generateMaze({ seed: 5, twisterCount: 0 }));
  let last = w.renderPose().heading;
  for (let i = 0; i < 6000 && !w.finished; i += 1) {
    w.step();
    const t = w.transition;
    const heading = w.renderPose().heading;
    if (t && t.update > 0 && t.update < 18) {
      const delta = heading - last;
      if (t.choice === "left" || t.choice === "right") { assert.ok(Math.abs(Math.abs(delta) - 0.08726647) < 1e-9); turns += 1; }
      if (t.choice === "reverse") { assert.ok(Math.abs(Math.abs(delta) - 0.17453294) < 1e-9); reverses += 1; }
      if (t.choice === "forward") assert.ok(Math.abs(delta) < 1e-12);
    }
    last = heading;
  }
  assert.ok(turns > 0 && reverses > 0, `exercised ${turns} turn updates and ${reverses} reversal updates`);
});

test("rats start on the east edge of their cell facing west, as the original route set-up does", () => {
  const run = new MazeRun({ seed: 2, rats: true });
  for (const rat of run.rats) {
    assert.equal(rat.direction, "left");
    assert.deepEqual(rat.renderPose(), originalEdgePose(rat.x, rat.y, "left"));
  }
});
