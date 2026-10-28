import { DELTAS, cellAt } from "./maze.js";

export const SIMULATION_STEP_MS = 25;
export const TRANSITION_UPDATES = 18;
// Observation (decoded update routine 0x1003ad1, state 4): a trigger roll adds 10 degrees per update for 18 updates
// (180 degrees) while navigation is paused, then the object is consumed. The call that touches the trigger is a route
// decision call and adds no roll, so a roll spans 19 updates from the touch to the consumption.
export const ROLL_UPDATES = 18;

const RIGHT = Object.freeze({ up: "right", right: "down", down: "left", left: "up" });
const LEFT = Object.freeze({ up: "left", left: "down", down: "right", right: "up" });
const HEADING = Object.freeze({ up: 0, right: Math.PI / 2, down: Math.PI, left: Math.PI * 1.5 });

// Camera path (observation: route set-up 0x10044bf, edge-pose snap 0x10045a0 and route step 0x10045e6 of the Windows NT 4.0
// OpenGL Maze; confidence high for the constants, medium-high for the call phase, which was decoded by hand). The camera
// stands on the MIDPOINT OF THE EDGE through which it entered the current cell, facing into the cell. A move is 18 update
// calls (docs/original-exit-camera-analysis.md, "Update-phase table"):
//   call 0   decision: goal check, choose the move, advance the cell index; the pose does not change
//   calls 1-17  integration: explicit Euler, old heading first
//   call 18  snap to the exact edge pose of the destination cell, and this call is the next move's call 0
// Per integration step: straight moves 1/18 cell; a quarter turn moves 1.5707964 x 0.027777778 along the current heading
// and then turns 5 degrees; a reversal turns 10 degrees in place. East and south edge offsets are the float 0.99999994.
const ORIGINAL_CAMERA = Object.freeze({
  straightStep: 1 / 18,
  arcStep: (Math.PI / 2) / 36,
  turnStep: 0.08726647,
  reverseStep: 0.17453294,
  farEdge: 0.99999994,
});

/** Walker pose (cell coordinates, integer = cell centre) at the entry edge of cell (x, y) when heading `direction`. */
export function originalEdgePose(x, y, direction) {
  const far = ORIGINAL_CAMERA.farEdge;
  switch (direction) {
    case "right": return { x: x - 0.5, y, heading: HEADING.right };
    case "left": return { x: x + far - 0.5, y, heading: HEADING.left };
    case "up": return { x, y: y + far - 0.5, heading: HEADING.up };
    case "down": return { x, y: y - 0.5, heading: HEADING.down };
    default: throw new RangeError(`Unknown direction: ${direction}`);
  }
}

export class AutoWalker {
  constructor(maze, { direction = "right", handedness = maze.handedness ?? "right", start = null, ignoreObjects = false } = {}) {
    if (handedness !== "left" && handedness !== "right") {
      throw new RangeError("Walker handedness must be left or right.");
    }
    this.maze = maze;
    this.x = start?.x ?? maze.entrance?.x ?? 0;
    this.y = start?.y ?? maze.entrance?.y ?? 0;
    this.ignoreObjects = ignoreObjects; // rats use the same route machinery but never finish or collect triggers
    this.direction = direction;
    this.handedness = handedness;
    this.steps = 0;
    this.updates = 0;
    this.turns = 0;
    this.deadEnds = 0;
    this.twisters = 0;
    this.inverted = false;
    this.finished = false;
    this.consumedTwisters = new Set();
    this.transition = null;
    this.roll = null;
    this.pose = originalEdgePose(this.x, this.y, this.direction);
  }

  renderPose() {
    return { ...this.pose };
  }

  /** Continuous scene roll in radians: 0 upright, pi inverted, advancing 10 degrees per roll update. */
  renderRoll() {
    const base = this.inverted ? Math.PI : 0;
    if (!this.roll) return base;
    return base + (Math.PI * this.roll.update) / ROLL_UPDATES;
  }

  snapshot() {
    return {
      x: this.x, y: this.y, direction: this.direction, handedness: this.handedness, steps: this.steps,
      simulationUpdates: this.updates, simulationTimeMs: this.updates * SIMULATION_STEP_MS,
      turns: this.turns, deadEnds: this.deadEnds, twisters: this.twisters,
      inverted: this.inverted, finished: this.finished, roll: this.roll ? this.roll.update : null,
      transition: this.transition ? {
        choice: this.transition.choice,
        direction: this.transition.direction,
        update: this.transition.update,
        totalUpdates: TRANSITION_UPDATES,
      } : null,
      pose: this.renderPose(),
    };
  }

  /** True when `dir` leaves `current` through a passage. */
  isOpen(current, dir) {
    return Boolean(current.passages[dir]);
  }

  /** Decision call: picks the next move by the route rule. The pose is not changed (observation). */
  chooseTransition() {
    const current = cellAt(this.maze, this.x, this.y);
    const right = RIGHT[this.direction];
    const left = LEFT[this.direction];
    const preferred = this.handedness === "left" ? left : right;
    const fallback = this.handedness === "left" ? right : left;
    let nextDirection;
    let choice;
    if (this.isOpen(current, preferred)) { nextDirection = preferred; choice = this.handedness; }
    else if (this.isOpen(current, this.direction)) { nextDirection = this.direction; choice = "forward"; }
    else if (this.isOpen(current, fallback)) {
      nextDirection = fallback;
      choice = this.handedness === "left" ? "right" : "left";
    }
    else {
      nextDirection = RIGHT[right];
      choice = "reverse";
      this.deadEnds += 1;
    }

    if (choice !== "forward") this.turns += 1;
    const delta = DELTAS[nextDirection];
    const destination = cellAt(this.maze, this.x + delta.x, this.y + delta.y);
    if (!destination || !this.isOpen(current, nextDirection)) {
      throw new Error("Walker attempted to cross a closed boundary.");
    }

    this.transition = {
      choice,
      direction: nextDirection,
      update: 0,
      fromX: this.x,
      fromY: this.y,
      toX: destination.x,
      toY: destination.y,
      // Integration state in the original's world frame: x east, y south, theta counter-clockwise from east.
      world: { x: this.pose.x + 0.5, y: this.pose.y + 0.5, theta: Math.PI / 2 - this.pose.heading },
    };
  }

  /** One explicit-Euler integration step (calls 1 to 17 of a move). */
  integrate() {
    const { choice, world } = this.transition;
    const { straightStep, arcStep, turnStep, reverseStep } = ORIGINAL_CAMERA;
    if (choice === "forward") {
      world.x += Math.cos(world.theta) * straightStep;
      world.y -= Math.sin(world.theta) * straightStep;
    } else if (choice === "left" || choice === "right") {
      world.x += Math.cos(world.theta) * arcStep;
      world.y -= Math.sin(world.theta) * arcStep;
      world.theta += choice === "left" ? turnStep : -turnStep;
    } else {
      world.theta += this.handedness === "left" ? reverseStep : -reverseStep;
    }
    this.pose = { x: world.x - 0.5, y: world.y - 0.5, heading: Math.PI / 2 - world.theta };
  }

  /** Call 18 of a move: snap to the exact edge pose of the destination cell. Returns the move's choice. */
  completeMove() {
    const { toX, toY, direction, choice } = this.transition;
    this.x = toX;
    this.y = toY;
    this.direction = direction;
    this.pose = originalEdgePose(this.x, this.y, this.direction);
    this.steps += 1;
    this.transition = null;
    return choice;
  }

  advanceRoll() {
    this.roll.update += 1;
    if (this.roll.update < ROLL_UPDATES) return { type: "roll", ...this.snapshot() };
    this.consumedTwisters.add(this.roll.key);
    this.twisters += 1;
    this.inverted = !this.inverted;
    this.roll = null;
    return { type: "twister", ...this.snapshot() };
  }

  /**
   * Idle decision: goal detection, then the next move. `moved` is the choice of the move completed in this same call
   * (call 18 of the previous move doubles as call 0 of the next), or null.
   */
  decide(moved) {
    const current = cellAt(this.maze, this.x, this.y);
    const key = `${this.x},${this.y}`;
    if (!this.ignoreObjects) {
      if (current.object === "finish") {
        this.finished = true;
        return { type: "finish", moved: moved !== null, choice: moved, ...this.snapshot() };
      }
      if (current.object === "twister" && !this.consumedTwisters.has(key)) {
        // The touch call itself adds no roll; the 18 roll updates follow it.
        this.roll = { key, update: 0 };
        return { type: "roll", moved: moved !== null, choice: moved, ...this.snapshot() };
      }
    }
    this.chooseTransition();
    return moved === null
      ? { type: "transition", ...this.snapshot() }
      : { type: "move", choice: moved, ...this.snapshot() };
  }

  /** Advances exactly one update call and returns an event describing it. */
  step() {
    if (this.finished) return { type: "finished", ...this.snapshot() };
    this.updates += 1;
    if (this.roll) return this.advanceRoll();
    let moved = null;
    if (this.transition) {
      this.transition.update += 1;
      if (this.transition.update < TRANSITION_UPDATES) {
        this.integrate();
        return { type: "transition", ...this.snapshot() };
      }
      moved = this.completeMove();
    }
    return this.decide(moved);
  }
}
