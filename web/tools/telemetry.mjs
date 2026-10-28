// Writes the deterministic per-update telemetry of a run as NDJSON.
//   node web/tools/telemetry.mjs --seed 2017 --updates 5000 --markers > run-2017.ndjson
// Options: --seed <text> (default 2017), --updates <n> (default 2000), --rng microsoft|portable, --markers,
//          --no-objects, --rats, --out <file> (default stdout).
import { writeFileSync } from "node:fs";
import { collectTelemetry, toNdjson } from "../src/telemetry.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};

const options = {
  seed: value("seed", "2017"),
  rngMode: value("rng", "microsoft"),
  updates: Number.parseInt(value("updates", "2000"), 10),
  markers: flag("markers"),
  objects: !flag("no-objects"),
  rats: flag("rats"),
};
if (!Number.isInteger(options.updates) || options.updates < 0 || options.updates > 2_000_000) {
  console.error("--updates must be an integer from 0 to 2000000");
  process.exit(2);
}

process.stdout.on("error", (error) => { if (error.code === "EPIPE") process.exit(0); throw error; });
const text = toNdjson(collectTelemetry(options), options);
const out = value("out", null);
if (out) writeFileSync(out, text);
else process.stdout.write(text);
