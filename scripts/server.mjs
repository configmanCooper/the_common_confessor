import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function resolvePath(url, rootDirectory) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return undefined;
  }
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  const resolved = join(rootDirectory, relative || "index.html");
  return resolved.startsWith(rootDirectory) ? resolved : null;
}

export function createStaticServer(rootDirectory = root) {
  return createServer((request, response) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url, "http://localhost");
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    if (requestUrl.pathname === "/local-ai" || requestUrl.pathname.startsWith("/local-ai/")) {
      const host = String(request.headers.host || "");
      const hostMatch = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(host);
      const allowedOrigins = hostMatch
        ? new Set([`http://127.0.0.1:${hostMatch[2]}`, `http://localhost:${hostMatch[2]}`])
        : new Set();
      if (!hostMatch || (request.headers.origin && !allowedOrigins.has(request.headers.origin))) {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Cross-origin local AI requests are forbidden" }));
        return;
      }
      const targetPath = requestUrl.pathname.replace(/^\/local-ai/, "") || "/";
      const proxy = httpRequest({
        hostname: "127.0.0.1",
        port: 8095,
        method: request.method,
        path: `${targetPath}${requestUrl.search}`,
        headers: {
          "content-type": request.headers["content-type"] || "application/json",
          accept: "application/json"
        }
      }, (proxyResponse) => {
        response.writeHead(proxyResponse.statusCode ?? 502, {
          "Content-Type": proxyResponse.headers["content-type"] || "application/json; charset=utf-8"
        });
        proxyResponse.pipe(response);
      });
      proxy.on("error", () => {
        if (!response.headersSent) {
          response.writeHead(targetPath === "/health" ? 200 : 503, {
            "Content-Type": "application/json; charset=utf-8"
          });
        }
        response.end(JSON.stringify(
          targetPath === "/health"
            ? { status: "unavailable" }
            : { error: "The Common Crown local AI is not running" }
        ));
      });
      request.pipe(proxy);
      return;
    }

    let filePath = resolvePath(request.url, rootDirectory);
    if (filePath === undefined) {
      response.writeHead(400).end("Bad request");
      return;
    }
    if (!filePath) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(response);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT || 8086);
  createStaticServer().listen(port, "127.0.0.1", () => {
    console.log(`The Common Confessor is running at http://127.0.0.1:${port}`);
  });
}
