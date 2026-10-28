import test from "node:test";
import assert from "node:assert/strict";
import { SETTING_FIELDS, parseSavedSettings, resolveSettings, serializeSettings } from "../src/settings.js";

const p = (query) => new URLSearchParams(query);

test("defaults: high quality, first person, solids on, reduced motion follows the system", () => {
  assert.deepEqual(resolveSettings(p(""), {}), { quality: "high", view: "first", objects: true, reducedMotion: null, markers: false, pictures: false, logos: false, rats: false });
});

test("URL parameters win over saved settings, which win over defaults", () => {
  const saved = { quality: "standard", view: "map", objects: false, reducedMotion: true, markers: true, pictures: true, logos: true, rats: true };
  assert.deepEqual(resolveSettings(p(""), saved), { quality: "standard", view: "map", objects: false, reducedMotion: true, markers: true, pictures: true, logos: true, rats: true });
  assert.deepEqual(resolveSettings(p("quality=turbo&view=first&objects=1&reduced=0&markers=0&pictures=0&logos=0&rats=0"), saved), { quality: "turbo", view: "first", objects: true, reducedMotion: false, markers: false, pictures: false, logos: false, rats: false });
  assert.deepEqual(["pictures", "logos", "rats"].map((n) => resolveSettings(p(`${n}=1`), {})[n]), [true, true, true]);
  assert.equal(resolveSettings(p(""), { rats: "yes", logos: 1 }).rats, false);
  assert.equal(resolveSettings(p(""), { rats: "yes", logos: 1 }).logos, false);
  assert.equal(resolveSettings(p("markers=1"), {}).markers, true);
  assert.equal(resolveSettings(p(""), { markers: "yes" }).markers, false);
  assert.equal(resolveSettings(p("objects=0"), {}).objects, false);
  assert.equal(resolveSettings(p("reduced=1"), {}).reducedMotion, true);
});

test("invalid or hostile values fall back to safe defaults", () => {
  assert.equal(resolveSettings(p("quality=ultra"), { quality: 7 }).quality, "high");
  assert.equal(resolveSettings(p("view=<script>"), {}).view, "first");
  assert.equal(resolveSettings(p(""), { reducedMotion: "yes" }).reducedMotion, null);
  assert.equal(resolveSettings(p(""), null).quality, "high");
  assert.equal(resolveSettings(p(""), [1, 2]).quality, "high");
});

test("saved settings parse defensively and serialize only the UI fields", () => {
  assert.deepEqual(parseSavedSettings("{not json"), {});
  assert.deepEqual(parseSavedSettings(null), {});
  assert.deepEqual(parseSavedSettings("[1]"), {});
  const text = serializeSettings({ quality: "turbo", view: "map", objects: false, reducedMotion: null, markers: false, pictures: false, logos: false, rats: false, seed: "private", email: "x@y.z" });
  const back = JSON.parse(text);
  assert.deepEqual(Object.keys(back).sort(), [...SETTING_FIELDS].sort());
  assert.equal(back.seed, undefined);
  assert.deepEqual(resolveSettings(p(""), back), { quality: "turbo", view: "map", objects: false, reducedMotion: null, markers: false, pictures: false, logos: false, rats: false });
});
