import test from "node:test";
import assert from "node:assert/strict";
import { DELTAS, OPPOSITE, cellAt, generateMaze } from "../src/maze.js";
import { AutoWalker, TRANSITION_UPDATES, originalEdgePose } from "../src/walker.js";

// Mechanically derived invariants of the render pose (what the first-person camera consumes): no per-update jumps,
// bounded heading change, the camera stays inside the maze and inside the two cells of the move it is making, and every
// completed move ends exactly on an edge pose. Pose coordinates are cell coordinates with the cell centre at integers, so
// the world position is the pose plus 0.5.

const SEEDS = [1, 2, 3, 7, "windows-95", "maze-95", "continuity"];
const MAX_UPDATES = 3500;

function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

test("render pose has bounded steps, bounded heading change, stays in the maze and in the cells of its move", () => {
  for (const seed of SEEDS) {
    const maze = generateMaze({ seed, rngMode: "microsoft" });
    const walker = new AutoWalker(maze);
    let previous = walker.renderPose();
    let maxStep = 0;
    let maxTurn = 0;
    for (let update = 0; update < MAX_UPDATES && !walker.finished; update += 1) {
      walker.step();
      const pose = walker.renderPose();
      assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.heading));
      const step = Math.hypot(pose.x - previous.x, pose.y - previous.y);
      const turn = Math.abs(angleDelta(previous.heading, pose.heading));
      maxStep = Math.max(maxStep, step);
      maxTurn = Math.max(maxTurn, turn);
      assert.ok(step <= 0.09, `seed ${seed} update ${update}: pose jumped ${step}`);
      assert.ok(turn <= (10 * Math.PI) / 180 + 1e-6, `seed ${seed} update ${update}: heading jumped ${turn}`);

      const wx = pose.x + 0.5;
      const wz = pose.y + 0.5;
      assert.ok(wx >= -1e-6 && wx <= maze.width + 1e-6 && wz >= -1e-6 && wz <= maze.height + 1e-6, `seed ${seed}: outside the maze`);
      const t = walker.transition;
      if (t) {
        const inside = (cell) => wx >= cell.x - 0.05 && wx <= cell.x + 1.05 && wz >= cell.y - 0.05 && wz <= cell.y + 1.05;
        assert.ok(inside({ x: t.fromX, y: t.fromY }) || inside({ x: t.toX, y: t.toY }), `seed ${seed} update ${update}: left its two cells`);
        const direction = Object.keys(DELTAS).find((name) => DELTAS[name].x === t.toX - t.fromX && DELTAS[name].y === t.toY - t.fromY);
        assert.ok(direction, "moves go to a neighbouring cell");
        assert.ok(cellAt(maze, t.fromX, t.fromY).passages[direction], `seed ${seed}: left through a wall`);
        assert.ok(cellAt(maze, t.toX, t.toY).passages[OPPOSITE[direction]]);
      }
      previous = pose;
    }
    assert.ok(maxStep > 0 && maxTurn > 0);
  }
});

test("pose is the exact edge pose with a cardinal heading after every completed move", () => {
  const maze = generateMaze({ seed: 1, rngMode: "microsoft" });
  const walker = new AutoWalker(maze);
  let completed = 0;
  for (let update = 0; update < 600 && !walker.finished; update += 1) {
    const event = walker.step();
    if (event.type === "move") {
      completed += 1;
      const pose = walker.renderPose();
      assert.deepEqual(pose, originalEdgePose(walker.x, walker.y, walker.direction));
      assert.ok(Math.abs(Math.sin(pose.heading * 2)) < 1e-9, "heading is a multiple of 90 degrees");
    }
  }
  assert.ok(completed >= 10);
  assert.equal(TRANSITION_UPDATES, 18);
});
