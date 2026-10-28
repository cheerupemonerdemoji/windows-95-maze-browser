// Static packaging for the browser reconstruction. The application is dependency-free static ES modules, so "building" is
// copying exactly the runtime files reachable from web/index.html and checking the result; there is no bundler.
//   node web/tools/package.mjs build [outDir]      copy the runtime files to outDir (default dist/site) and validate them
//   node web/tools/package.mjs validate [outDir]   validate an existing artifact
//   node web/tools/package.mjs repo                check the tracked files for private or Microsoft material
// Exit status 1 means a check failed; every failure is printed.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = resolve(webRoot, "..");
const ENTRY = "index.html";
const ALLOWED_EXTENSIONS = new Set([".html", ".css", ".js", ".webp"]);
// The only binary assets that may be published: the Backrooms-inspired theme textures listed, with their SHA-256, in
// web/assets/themes/backrooms/manifest.json. They are original images generated for this project.
const APPROVED_ASSET_DIR = "assets/themes/backrooms/";
function approvedAssetHashes() {
  const manifest = JSON.parse(readFileSync(join(webRoot, APPROVED_ASSET_DIR, "manifest.json"), "utf8"));
  return new Map(manifest.map((entry) => [entry.output.file, entry.output.sha256]));
}
const ALLOWED_DOTFILES = new Set([".nojekyll"]);
const LIMITS = { totalBytes: 700 * 1024, fileBytes: 160 * 1024, files: 40 };
// Extensions and names that must never be tracked or published: the Microsoft screensaver and anything that could carry its
// artwork, recordings, archives, and credential files.
const FORBIDDEN_EXTENSIONS = new Set([".scr", ".exe", ".dll", ".sys", ".msi", ".mkv", ".mp4", ".mov", ".avi", ".webm", ".zip", ".7z", ".rar", ".bmp", ".ico", ".cur", ".ani"]);
const FORBIDDEN_PATH_PARTS = ["rea-evidence", "windows95maze", "runtime-test", "runtime-timing", "browser-acceptance", "private-analysis", ".whiteboard-agent", "ssmaze"];
const FORBIDDEN_NAMES = [/^\.env(\.|$)/i, /credential/i, /secret/i, /\.pem$/i, /\.key$/i, /id_rsa/i];
const SECRET_PATTERNS = [
  [/CF[-_]Access[-_]Client[-_](Id|Secret)\s*[:=]\s*\S{8,}/i, "Cloudflare access credential"],
  [/WHITEBOARD_TOKEN\s*=\s*\S{8,}/, "whiteboard token"],
  [/BROWSERSTACK_ACCESS_KEY\s*[:=]\s*[A-Za-z0-9]{10,}/, "BrowserStack access key"],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
];

// Upstream GLMaze files that look forbidden by type or name but are legitimate: the project icon and the updater public key.
const REPO_ALLOWLIST = new Set(["Win/glmaze.ico", "Xcode/dsa_pub.pem"]);

const failures = [];
const fail = (message) => failures.push(message);
const toPosix = (path) => path.split(sep).join("/");

/** Resolves a relative reference found inside `fromFile` (posix path under the root) to a posix path, or null if it leaves the root. */
function resolveReference(fromFile, reference) {
  const target = normalize(join(dirname(fromFile), reference));
  const posix = toPosix(target);
  return posix.startsWith("..") ? null : posix;
}

function isAbsoluteReference(reference) {
  return reference.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//");
}

/** References a file makes: html src/href, css url(), and static or dynamic module imports with a string literal. */
function referencesOf(file, text) {
  const refs = [];
  const ext = extname(file);
  if (ext === ".html") {
    for (const match of text.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)) refs.push({ kind: "html", value: match[1] });
  } else if (ext === ".css") {
    for (const match of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) refs.push({ kind: "css", value: match[1] });
    for (const match of text.matchAll(/@import\s+['"]([^'"]+)['"]/g)) refs.push({ kind: "css", value: match[1] });
  } else if (ext === ".js") {
    for (const match of text.matchAll(/\bimport\s*(?:[^'"()]*?\bfrom\s*)?['"]([^'"]+)['"]/g)) refs.push({ kind: "import", value: match[1] });
    for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.push({ kind: "import", value: match[1] });
    for (const match of text.matchAll(/["'`](\.\/assets\/[A-Za-z0-9_./-]+)["'`]/g)) refs.push({ kind: "asset", value: match[1] });
    for (const match of text.matchAll(/\bnew Worker\(\s*['"]([^'"]+)['"]/g)) refs.push({ kind: "worker", value: match[1] });
    for (const match of text.matchAll(/\bfetch\(\s*['"]([^'"]+)['"]/g)) refs.push({ kind: "fetch", value: match[1] });
  }
  return refs.filter((ref) => !ref.value.startsWith("#") && !ref.value.startsWith("data:"));
}

/** The set of files reachable from the entry page, relative to `root`. Records unresolved and absolute references as failures. */
function reachableFiles(root, label) {
  const seen = new Set();
  const queue = [ENTRY];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    const full = join(root, file);
    if (!existsSync(full) || !statSync(full).isFile()) { fail(`${label}: missing file ${file}`); continue; }
    seen.add(file);
    if (extname(file) === ".webp") continue;
    const text = readFileSync(full, "utf8");
    for (const ref of referencesOf(file, text)) {
      if (isAbsoluteReference(ref.value)) {
        // A root-absolute or external URL breaks under a sub-path (GitHub Pages) or leaks a third-party request.
        fail(`${label}: ${file} references "${ref.value}"; use a relative URL`);
        continue;
      }
      const clean = ref.value.split("#")[0].split("?")[0];
      if (clean === "") continue;
      // Theme asset URLs are resolved against the page (document.baseURI), not against the module that names them.
      const target = ref.kind === "asset" ? toPosix(normalize(clean)) : resolveReference(file, clean);
      if (target === null) { fail(`${label}: ${file} references "${ref.value}" outside the package`); continue; }
      queue.push(target);
    }
  }
  return seen;
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(toPosix(relative(base, full)));
  }
  return out;
}

function validateArtifact(dir) {
  if (!existsSync(dir)) { fail(`artifact ${dir} does not exist`); return; }
  const files = walk(dir);
  const reachable = reachableFiles(dir, "artifact");
  let total = 0;
  for (const file of files) {
    const name = file.split("/").pop();
    const size = statSync(join(dir, file)).size;
    total += size;
    if (ALLOWED_DOTFILES.has(name)) continue;
    if (extname(file) === ".webp") {
      const approved = approvedAssetHashes();
      const digest = createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
      if (!file.startsWith(APPROVED_ASSET_DIR) || approved.get(file.slice(APPROVED_ASSET_DIR.length)) !== digest) fail(`artifact: ${file} is not an approved theme asset (path or SHA-256 differs from manifest.json)`);
    }
    if (!ALLOWED_EXTENSIONS.has(extname(file))) fail(`artifact: ${file} has a file type that is not runtime code (${extname(file) || "none"})`);
    if (!reachable.has(file)) fail(`artifact: ${file} is not reachable from ${ENTRY}; only runtime files may be published`);
    if (size > LIMITS.fileBytes) fail(`artifact: ${file} is ${size} bytes (limit ${LIMITS.fileBytes})`);
    const lower = file.toLowerCase();
    if (FORBIDDEN_PATH_PARTS.some((part) => lower.includes(part))) fail(`artifact: ${file} has a forbidden path`);
    if (/(^|\/)(tests?|docs|tools|node_modules)\//.test(lower)) fail(`artifact: ${file} is not a runtime file`);
    if (extname(file) === ".js" || extname(file) === ".html" || extname(file) === ".css") {
      const text = readFileSync(join(dir, file), "utf8");
      for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(text)) fail(`artifact: ${file} looks like it contains a ${label}`);
      if (/\.scr\b/i.test(text) && /ssmaze/i.test(text)) fail(`artifact: ${file} mentions the Microsoft screensaver binary`);
    }
  }
  for (const needed of reachable) if (!files.includes(needed)) fail(`artifact: ${needed} is referenced but not in the artifact`);
  if (!files.includes(".nojekyll")) fail("artifact: missing .nojekyll (GitHub Pages would run Jekyll over the files)");
  if (files.length > LIMITS.files) fail(`artifact: ${files.length} files (limit ${LIMITS.files})`);
  if (total > LIMITS.totalBytes) fail(`artifact: ${total} bytes (limit ${LIMITS.totalBytes})`);
  console.log(`artifact ${dir}: ${files.length} files, ${total} bytes, ${reachable.size} reachable from ${ENTRY}`);
}

function build(outDir) {
  const out = resolve(outDir);
  const dist = resolve(repoRoot, "dist");
  if (!(out + sep).startsWith(dist + sep) && !(out + sep).startsWith(resolve(repoRoot, "tmp") + sep)) {
    fail(`refusing to clean ${out}: build output must be inside ${dist}`);
    return;
  }
  const reachable = reachableFiles(webRoot, "source");
  if (failures.length) return;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(dist, ".gitignore"), "*\n"); // the build output never enters Git
  for (const file of reachable) {
    mkdirSync(dirname(join(out, file)), { recursive: true });
    cpSync(join(webRoot, file), join(out, file));
  }
  writeFileSync(join(out, ".nojekyll"), "");
  validateArtifact(out);
}

/** Tracked files (git index) must not include private or Microsoft material or credentials. */
function checkRepo() {
  let listing;
  try {
    listing = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    fail(`could not list tracked files: ${error.message}`);
    return;
  }
  const files = listing.split("\0").filter(Boolean);
  for (const file of files) {
    if (REPO_ALLOWLIST.has(file)) continue;
    const lower = file.toLowerCase();
    const name = lower.split("/").pop();
    if (FORBIDDEN_EXTENSIONS.has(extname(lower))) fail(`repo: ${file} has a forbidden file type`);
    if (FORBIDDEN_PATH_PARTS.some((part) => lower.includes(part))) fail(`repo: ${file} has a forbidden path`);
    if (FORBIDDEN_NAMES.some((pattern) => pattern.test(name))) fail(`repo: ${file} looks like a credential file`);
    const full = join(repoRoot, file);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    if (statSync(full).size > 2 * 1024 * 1024 && lower.startsWith("web/")) fail(`repo: ${file} is larger than 2 MB`);
    if (/\.(js|mjs|json|md|html|css|yml|yaml|txt)$/.test(lower) && statSync(full).size < 2 * 1024 * 1024) {
      const text = readFileSync(full, "utf8");
      for (const [pattern, label] of SECRET_PATTERNS) {
        if (file === "web/tools/package.mjs") continue; // this file defines the patterns
        if (pattern.test(text)) fail(`repo: ${file} looks like it contains a ${label}`);
      }
      // A Microsoft binary's hash is fine in documentation; the file itself and extracted images are not (checked by type above).
    }
  }
  console.log(`repo: ${files.length} tracked files checked`);
}

const [command = "build", argument] = process.argv.slice(2);
if (command === "build") build(argument ?? join(repoRoot, "dist", "site"));
else if (command === "validate") validateArtifact(resolve(argument ?? join(repoRoot, "dist", "site")));
else if (command === "repo") checkRepo();
else { console.error(`unknown command ${command}`); process.exit(2); }

if (failures.length) {
  for (const message of failures) console.error(`FAIL ${message}`);
  process.exit(1);
}
console.log("OK");
