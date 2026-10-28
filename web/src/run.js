import { generateMaze, validateMaze } from "./maze.js";
import { AutoWalker } from "./walker.js";

// Run lifecycle: entrance transition -> automatic walk -> exit transition -> next maze, with no page reload.
//
// Direct observation (static analysis of the original update routine at 0x1003ad1):
//   state 0 initializes a maze and selects state 1; state 1 adds the float 0.025 per update to a float transition value
//   until the unrounded sum reaches 1.0; state 2 walks the route; when the route returns the exit record state 3
//   subtracts 0.025 per update until the unrounded difference is no longer above 0.0 and selects state 0; the next
//   update generates the next maze. Derived (D): the transition value is stored as a float32 after every update (the
//   compare happens before the store, at x87 precision), so 40 additions give 0.99999958 and not 1.0: the entrance takes
//   41 updates and ends at 1.025, the exit takes 42 updates and ends at -0.025. The wall quads span z 0..value, so the
//   overshoot is hidden behind the ceiling and the floor. Both compare precisions give the same counts.
// Direct observation (private 2026-10-21 captures of the original, seven resets in a six-minute clip and three in an
// earlier one): the scene appears at full brightness and the WALLS GROW upward from the floor (a vertical scale)
// while the floor and ceiling stay fully visible, so the transition value is a wall-height scale, not a fade. On
// exit the walls shrink linearly to zero in about 0.97 s with the camera still, and the next maze appears in the very
// next presented frame, upright, with its walls growing for about 1.1 s. The ramp is hand-measured on two events.
// Browser reconstruction choice: the next maze seed is derived deterministically from the run seed (the original
// keeps one time-seeded CRT stream across mazes, which this per-maze generator cannot continue exactly).

export const TRANSITION_STEP = 0.025;
const STEP32 = Math.fround(TRANSITION_STEP);

/** One entrance update: float32 store after an unrounded compare, as in the original. */
export function growEntrance(value) {
  const sum = value + STEP32;
  return { value: Math.fround(sum), done: !(sum < 1) };
}

/** One exit update. */
export function shrinkExit(value) {
  const difference = value - STEP32;
  return { value: Math.fround(difference), done: !(difference > 0) };
}

function countUpdates(start, step) {
  let value = start;
  for (let updates = 1; ; updates += 1) {
    const next = step(value);
    value = next.value;
    if (next.done) return { updates, value };
  }
}

const ENTRANCE = countUpdates(0, growEntrance);
const EXIT = countUpdates(ENTRANCE.value, shrinkExit);
export const ENTRANCE_UPDATES = ENTRANCE.updates; // 41
export const EXIT_UPDATES = EXIT.updates; // 42

export const RUN_STATES = Object.freeze({
  ENTRANCE: "entrance",
  RUNNING: "running",
  EXIT: "exit",
  REGENERATE: "regenerate",
});

function hash32(text) {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Maze 0 uses the run seed itself, so a URL seed reproduces the first maze exactly. */
export function deriveMazeSeed(runSeed, mazeIndex) {
  if (mazeIndex === 0) return String(runSeed);
  return String(hash32(`${runSeed}#${mazeIndex}`));
}

export class MazeRun {
  /** `markers` only records whether the Start and smiley artwork is shown; it never changes the camera or the world. */
  constructor({ seed = "windows-95", rngMode = "microsoft", objects = true, rats = false, markers = false } = {}) {
    this.runSeed = String(seed);
    this.rngMode = rngMode;
    this.objects = objects;
    this.ratsEnabled = rats;
    this.markers = markers;
    this.mazeIndex = 0;
    this.updates = 0;
    this.beginMaze();
  }

  beginMaze() {
    const options = { seed: deriveMazeSeed(this.runSeed, this.mazeIndex), rngMode: this.rngMode };
    if (!this.objects) options.twisterCount = 0;
    this.maze = generateMaze(options);
    const validation = validateMaze(this.maze);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    this.validation = validation;
    // The walker stands on the entry edge of its cell (recovered original camera), so the cell-centre Start sign and
    // smiley billboards are straight ahead at 0.5 at the start and at the exit whether or not their artwork is shown.
    this.walker = new AutoWalker(this.maze);
    // Rats (experimental flag) use the same route machinery with their own hand, never finish and never collect.
    this.rats = this.ratsEnabled
      ? this.maze.rats.map((rat) => new AutoWalker(this.maze, { start: rat, direction: "left", handedness: rat.handedness, ignoreObjects: true }))
      : [];
    this.state = RUN_STATES.ENTRANCE;
    this.stateUpdates = 0;
    this.growth = 0;
  }

  /** Advances exactly one 25 ms simulation update and returns an event describing it. */
  step() {
    this.updates += 1;
    switch (this.state) {
      case RUN_STATES.ENTRANCE:
        this.stateUpdates += 1;
        {
          const next = growEntrance(this.growth);
          this.growth = next.value;
          if (next.done) {
            this.state = RUN_STATES.RUNNING;
            this.stateUpdates = 0;
            return { type: "entered", mazeIndex: this.mazeIndex };
          }
        }
        return { type: "entering", growth: this.growth };
      case RUN_STATES.RUNNING: {
        const event = this.walker.step();
        for (const rat of this.rats) rat.step();
        if (event.type === "finish") {
          this.state = RUN_STATES.EXIT;
          this.stateUpdates = 0;
        }
        return event;
      }
      case RUN_STATES.EXIT:
        this.stateUpdates += 1;
        {
          const next = shrinkExit(this.growth);
          this.growth = next.value;
          if (next.done) this.state = RUN_STATES.REGENERATE;
        }
        return { type: "exiting", growth: this.growth };
      default: {
        this.mazeIndex += 1;
        this.beginMaze();
        return { type: "regenerated", mazeIndex: this.mazeIndex, seed: this.maze.seed };
      }
    }
  }

  renderPose() {
    return this.walker.renderPose();
  }

  renderRoll() {
    return this.walker.renderRoll();
  }

  snapshot() {
    return {
      run: { runSeed: this.runSeed, mazeIndex: this.mazeIndex, state: this.state, stateUpdates: this.stateUpdates, growth: this.growth, totalUpdates: this.updates },
      ...this.walker.snapshot(),
    };
  }
}
