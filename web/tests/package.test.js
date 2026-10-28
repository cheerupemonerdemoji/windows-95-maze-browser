import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The static artifact contains only the runtime files reachable from index.html plus the approved theme textures, and the
// validator refuses everything else. (The tool is web/tools/package.mjs; CI also runs it through `npm run build`.)

const root = fileURLToPath(new URL("../../", import.meta.url));
const tool = join(root, "web", "tools", "package.mjs");
const run = (...args) => spawnSync(process.execPath, [tool, ...args], { cwd: root, encoding: "utf8" });

function artifact() {
  const dir = mkdtempSync(join(tmpdir(), "glmaze-artifact-"));
  const built = join(dir, "site");
  cpSync(join(root, "dist", "site"), built, { recursive: true });
  return { dir, built };
}

test("the build produces a valid artifact that includes the three approved theme textures", () => {
  const built = run("build");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const { dir, built: site } = artifact();
  try {
    const ok = run("validate", site);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    for (const name of ["wall", "floor", "ceiling"]) {
      assert.ok(readFileSync(join(site, "assets", "themes", "backrooms", `${name}.webp`)).length > 1000, name);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the validator refuses extra files, unapproved or altered images, private material and root-absolute URLs", () => {
  assert.equal(run("build").status, 0);
  const cases = [
    ["a stray image", (site) => writeFileSync(join(site, "extra.png"), "png")],
    ["a file that nothing references", (site) => writeFileSync(join(site, "src", "unused.js"), "export {};")],
    ["a test directory", (site) => { cpSync(join(site, "src"), join(site, "tests"), { recursive: true }); }],
    ["a private evidence path", (site) => { cpSync(join(site, "src"), join(site, "REA-Evidence"), { recursive: true }); }],
    ["an altered theme texture", (site) => writeFileSync(join(site, "assets", "themes", "backrooms", "wall.webp"), "tampered")],
    ["an unapproved webp", (site) => writeFileSync(join(site, "assets", "themes", "backrooms", "other.webp"), "x")],
    ["a root-absolute URL", (site) => writeFileSync(join(site, "src", "app.js"), readFileSync(join(site, "src", "app.js"), "utf8") + "\nimport('/src/maze.js');\n")],
    ["a credential", (site) => writeFileSync(join(site, "src", "settings.js"), readFileSync(join(site, "src", "settings.js"), "utf8") + "\n// " + "BROWSERSTACK_ACCESS" + "_KEY=abcdefghij1234567890\n")],
    ["a missing .nojekyll", (site) => rmSync(join(site, ".nojekyll"))],
  ];
  for (const [label, damage] of cases) {
    const { dir, built } = artifact();
    try {
      damage(built);
      const result = run("validate", built);
      assert.notEqual(result.status, 0, `${label} must fail validation`);
      assert.match(result.stderr, /FAIL/, label);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("no tracked file is a Microsoft binary, a capture or a credential", () => {
  const result = run("repo");
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
