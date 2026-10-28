import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// GLMAZE_SERVE_DIR serves another directory (the built static artifact); GLMAZE_BASE_PATH serves it under a sub-path such as
// /repository-name/ like GitHub Pages does, and answers 404 for anything outside that prefix, so a root-absolute URL in the page
// fails here instead of on the published site.
const root = resolve(process.env.GLMAZE_SERVE_DIR ?? fileURLToPath(new URL("./", import.meta.url))) + sep;
const basePath = (() => {
  const value = process.env.GLMAZE_BASE_PATH ?? "/";
  return `/${value.replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");
})();
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (basePath !== "/" && url.pathname === basePath.slice(0, -1)) {
    response.writeHead(301, { location: basePath + url.search });
    response.end();
    return;
  }
  if (!url.pathname.startsWith(basePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const inner = url.pathname.slice(basePath.length);
  const requested = inner === "" ? "index.html" : inner;
  const file = normalize(join(root, requested));

  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": types[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`GLMaze browser reconstruction: http://127.0.0.1:${port}${basePath}`);
});
