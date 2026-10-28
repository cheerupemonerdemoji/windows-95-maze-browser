import test from "node:test";
import assert from "node:assert/strict";
import { SETTING_FIELDS, parseSavedSettings, resolveSettings, serializeSettings } from "../src/settings.js";

const p = (query) => new URLSearchParams(query);

test("defaults: high quality, first person, solids on, reduced motion follows the system", () => {
  assert.deepEqual(resolveSettings(p(""), {}), { quality: "high", view: "first", objects: true, reducedMotion: null, markers: false, pictures: false, logos: false, rats: false, theme: "classic" });
});

test("URL parameters win over saved settings, which win over defaults", () => {
  const saved = { quality: "standard", view: "map", objects: false, reducedMotion: true, markers: true, pictures: true, logos: true, rats: true, theme: "backrooms" };
  assert.deepEqual(resolveSettings(p(""), saved), { quality: "standard", view: "map", objects: false, reducedMotion: true, markers: true, pictures: true, logos: true, rats: true, theme: "backrooms" });
  assert.deepEqual(resolveSettings(p("quality=turbo&view=first&objects=1&reduced=0&markers=0&pictures=0&logos=0&rats=0&theme=classic"), saved), { quality: "turbo", view: "first", objects: true, reducedMotion: false, markers: false, pictures: false, logos: false, rats: false, theme: "classic" });
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
  const text = serializeSettings({ quality: "turbo", view: "map", objects: false, reducedMotion: null, markers: false, pictures: false, logos: false, rats: false, theme: "custom", seed: "private", email: "x@y.z" });
  const back = JSON.parse(text);
  assert.deepEqual(Object.keys(back).sort(), [...SETTING_FIELDS].sort());
  assert.equal(back.seed, undefined);
  assert.deepEqual(resolveSettings(p(""), back), { quality: "turbo", view: "map", objects: false, reducedMotion: null, markers: false, pictures: false, logos: false, rats: false, theme: "custom" });
});

test("theme: Classic is the default, the choice persists, the URL overrides it, and anything unknown falls back to Classic", () => {
  assert.equal(resolveSettings(p(""), {}).theme, "classic");
  assert.equal(resolveSettings(p(""), null).theme, "classic");
  for (const theme of ["classic", "backrooms", "custom"]) {
    assert.equal(resolveSettings(p(""), { theme }).theme, theme, "stored choice");
    assert.equal(resolveSettings(p(`theme=${theme}`), { theme: "classic" }).theme, theme, "URL wins over the stored choice");
  }
  assert.equal(resolveSettings(p("theme=classic"), { theme: "backrooms" }).theme, "classic");
  for (const bad of ["neon", "", "BACKROOMS", "custom;drop", "<img>", "../x"]) {
    assert.equal(resolveSettings(p(`theme=${encodeURIComponent(bad)}`), {}).theme, "classic", bad);
    assert.equal(resolveSettings(p(""), { theme: bad }).theme, "classic", bad);
  }
  assert.equal(resolveSettings(p(""), { theme: 3 }).theme, "classic");
  // Persistence uses the settings JSON and stores only the theme name: never an image or a file name.
  const text = serializeSettings({ ...resolveSettings(p("theme=custom"), {}), wallImage: "secret.png" });
  assert.equal(JSON.parse(text).theme, "custom");
  assert.ok(!text.includes("secret"));
  assert.ok(SETTING_FIELDS.includes("theme"));
});
