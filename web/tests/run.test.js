import test from "node:test";
import assert from "node:assert/strict";
import { DELTAS, OPPOSITE, cellAt, serializeMaze } from "../src/maze.js";
import { ENTRANCE_UPDATES, EXIT_UPDATES, MazeRun, RUN_STATES, deriveMazeSeed } from "../src/run.js";
import { ROLL_UPDATES } from "../src/walker.js";

function runUntil(run, predicate, limit = 20000) {
  for (let i = 0; i < limit; i += 1) {
    const event = run.step();
    if (predicate(event)) return event;
  }
  throw new Error("limit reached");
}

test("the recovered float32 ramp: the entrance takes 41 updates and ends at 1.025, the exit takes 42 and ends at -0.025", () => {
  // Derived (D) from the decompiled update routine: float 0.025 steps, compare before the float32 store, so forty
  // additions give 0.99999958 (< 1) and one more update is needed; the shrink needs one more than the grow.
  assert.equal(ENTRANCE_UPDATES, 41);
  assert.equal(EXIT_UPDATES, 42);
  const run = new MazeRun({ seed: 1 });
  assert.equal(run.state, RUN_STATES.ENTRANCE);
  assert.equal(run.growth, 0);
  const x = run.walker.x;
  run.step();
  assert.ok(Math.abs(run.growth - 0.025) < 1e-7);
  for (let i = 1; i < 40; i += 1) run.step();
  assert.equal(run.state, RUN_STATES.ENTRANCE, "forty updates are not enough");
  assert.ok(run.growth < 1 && run.growth > 0.9999);
  run.step();
  assert.equal(run.state, RUN_STATES.RUNNING);
  assert.ok(Math.abs(run.growth - 1.025) < 1e-6, "overshoot is kept raw; the renderer clamps it");
  assert.equal(run.walker.x, x, "walker does not move during the entrance");
  assert.equal(run.walker.updates, 0);
});

test("reaching the exit starts a 42-update shrink, then the next maze is generated on the following update", () => {
  const run = new MazeRun({ seed: 1, objects: false });
  const first = serializeMaze(run.maze);
  runUntil(run, (e) => e.type === "finish");
  assert.equal(run.state, RUN_STATES.EXIT);
  for (let i = 1; i < EXIT_UPDATES; i += 1) {
    assert.equal(run.step().type, "exiting");
  }
  assert.equal(run.state, RUN_STATES.EXIT);
  assert.equal(run.step().type, "exiting");
  assert.equal(run.state, RUN_STATES.REGENERATE);
  assert.ok(Math.abs(run.growth + 0.025) < 1e-6, "the last shrink frame is -0.025 (hidden below the floor)");
  assert.equal(serializeMaze(run.maze), first, "old maze is still current until the next update");
  const event = run.step();
  assert.equal(event.type, "regenerated");
  assert.equal(run.mazeIndex, 1);
  assert.equal(run.state, RUN_STATES.ENTRANCE);
  assert.notEqual(serializeMaze(run.maze), first);
});

test("regeneration resets walker, counters, inversion and consumed objects", () => {
  const run = new MazeRun({ seed: 3 });
  runUntil(run, (e) => e.type === "regenerated");
  const w = run.walker;
  assert.equal(w.steps, 0);
  assert.equal(w.updates, 0);
  assert.equal(w.inverted, false);
  assert.equal(w.consumedTwisters.size, 0);
  assert.equal(w.finished, false);
  assert.equal(w.x, run.maze.entrance.x);
  assert.equal(w.y, run.maze.entrance.y);
  assert.equal(run.renderRoll(), 0);
});

test("the run is deterministic for a fixed run seed, including derived next-maze seeds", () => {
  const sequence = () => {
    const run = new MazeRun({ seed: "determinism" });
    const mazes = [serializeMaze(run.maze)];
    while (mazes.length < 4) {
      runUntil(run, (e) => e.type === "regenerated");
      mazes.push(serializeMaze(run.maze));
    }
    return mazes;
  };
  const a = sequence();
  assert.deepEqual(a, sequence());
  assert.equal(new Set(a).size, 4);
  assert.equal(deriveMazeSeed("abc", 0), "abc");
  assert.notEqual(deriveMazeSeed("abc", 1), deriveMazeSeed("abc", 2));
});

test("many repeated resets stay valid and finish", () => {
  const run = new MazeRun({ seed: "soak", objects: false });
  let resets = 0;
  while (resets < 30) {
    runUntil(run, (e) => e.type === "regenerated");
    resets += 1;
    assert.equal(run.validation.valid, true);
    assert.equal(run.maze.cells.length, 144);
  }
  assert.equal(run.mazeIndex, 30);
});

test("collecting a trigger: a touch update, then 18 roll updates of 10 degrees, then the object is consumed", () => {
  let run;
  for (let seed = 0; seed < 200; seed += 1) {
    const candidate = new MazeRun({ seed });
    if (candidate.maze.twisters.length > 0) { run = candidate; break; }
  }
  assert.ok(run, "found a seed with triggers");
  const touch = runUntil(run, (e) => e.type === "roll");
  const w = run.walker;
  const startCell = [w.x, w.y];
  const touchUpdates = w.updates;
  assert.equal(touch.roll, 0, "the touch call is a decision call and adds no roll");
  assert.equal(w.inverted, false);
  assert.equal(w.twisters, 0, "not consumed until the roll completes");
  assert.equal(w.renderRoll(), 0);
  let last = w.renderRoll();
  for (let i = 1; i < ROLL_UPDATES; i += 1) {
    const event = run.step();
    assert.equal(event.type, "roll");
    assert.equal(w.roll.update, i);
    assert.ok(Math.abs(w.renderRoll() - (i * Math.PI) / ROLL_UPDATES) < 1e-12, "10 degrees per update");
    assert.ok(w.renderRoll() > last);
    last = w.renderRoll();
  }
  const done = run.step();
  assert.equal(done.type, "twister");
  assert.equal(w.updates - touchUpdates, ROLL_UPDATES, "18 updates after the touch update, 19 updates in all");
  assert.equal(w.inverted, true);
  assert.equal(w.twisters, 1);
  assert.equal(w.renderRoll(), Math.PI);
  assert.deepEqual([w.x, w.y], startCell, "no movement while rolling");
  assert.ok(w.consumedTwisters.has(`${startCell[0]},${startCell[1]}`));
  const resume = run.step();
  assert.equal(resume.type, "transition", "the next update is a decision call");
  assert.equal(resume.transition.update, 0);
});

test("rats are off unless enabled, then follow the route rules with their own hand and never cross a wall", () => {
  assert.equal(new MazeRun({ seed: 2 }).rats.length, 0);
  const run = new MazeRun({ seed: 2, rats: true });
  assert.equal(run.rats.length, 1);
  const rat = run.rats[0];
  assert.equal(rat.handedness, run.maze.rats[0].handedness);
  assert.deepEqual([rat.x, rat.y], [run.maze.rats[0].x, run.maze.rats[0].y]);
  for (let i = 0; i < ENTRANCE_UPDATES; i += 1) run.step();
  assert.equal(rat.updates, 0, "rats wait for the running phase");
  let previous = { ...rat.pose };
  let moved = 0;
  for (let i = 0; i < 1500; i += 1) {
    run.step();
    const a = { x: Math.round(previous.x), y: Math.round(previous.y) };
    const b = { x: Math.round(rat.pose.x), y: Math.round(rat.pose.y) };
    if (a.x !== b.x || a.y !== b.y) {
      const dir = Object.keys(DELTAS).find((n) => DELTAS[n].x === b.x - a.x && DELTAS[n].y === b.y - a.y);
      assert.ok(dir, "rat skipped a cell");
      assert.ok(cellAt(run.maze, a.x, a.y).passages[dir] && cellAt(run.maze, b.x, b.y).passages[OPPOSITE[dir]], "rat crossed a wall");
      moved += 1;
    }
    previous = { ...rat.pose };
    if (run.state !== "running") break;
  }
  assert.ok(moved > 3, "the rat walks");
  assert.equal(rat.finished, false);
  assert.equal(rat.twisters, 0, "rats never collect triggers");
});

test("rat paths are deterministic and are rebuilt on every reset", () => {
  const path = () => {
    const run = new MazeRun({ seed: "rat-path", rats: true });
    for (let i = 0; i < ENTRANCE_UPDATES + 400; i += 1) run.step();
    return `${run.rats[0].x},${run.rats[0].y},${run.rats[0].direction},${run.rats[0].updates}`;
  };
  assert.equal(path(), path());
  const run = new MazeRun({ seed: 3, rats: true });
  const before = run.rats[0];
  runUntil(run, (e) => e.type === "regenerated");
  assert.notEqual(run.rats[0], before);
  assert.equal(run.rats[0].updates, 0);
  assert.equal(run.rats.length, 1);
});
