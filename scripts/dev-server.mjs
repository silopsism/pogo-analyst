import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, "..");
const distDir = path.join(projectRoot, "dist");
const dataDir = path.join(projectRoot, "data");
const host = "127.0.0.1";
const preferredPorts = [5173, 5174, 5175, 5176];

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

async function serveFile(res, filePath) {
  const data = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.end(data);
}

function openBrowser(url) {
  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

if (!(await fileExists(path.join(distDir, "index.html")))) {
  console.error("dist/index.html is missing. Run `npm run build` first.");
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const requestUrl = req.url ? new URL(req.url, `http://${host}:${port}`) : new URL("/", `http://${host}:${port}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === "/__status") {
    const payload = JSON.stringify({
      ok: true,
      app: "pokemon-go-explorer",
      mode: "static-dev",
      now: new Date().toISOString(),
    });
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(payload);
    return;
  }

  const candidate = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = pathname.startsWith("/data/")
    ? path.join(dataDir, candidate.replace(/^data[\\/]/, ""))
    : path.join(distDir, candidate);

  if (existsSync(filePath) && (await fileExists(filePath))) {
    await serveFile(res, filePath);
    return;
  }

  if (pathname.startsWith("/data/")) {
    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end("Not found");
    return;
  }

  await serveFile(res, path.join(distDir, "index.html"));
});

let port = preferredPorts[0];
let currentPortIndex = 0;

function startServer() {
  port = preferredPorts[currentPortIndex];
  server.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    console.log(`Preview server running at ${url}`);
    try {
      openBrowser(url);
    } catch {
      console.log(`Open this URL manually in your browser: ${url}`);
    }
  });
}

server.on("error", (error) => {
  if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
    if (currentPortIndex < preferredPorts.length - 1) {
      currentPortIndex += 1;
      startServer();
      return;
    }
    console.error(`Ports ${preferredPorts.join(", ")} are all in use. Close old dev server processes and retry.`);
    process.exit(1);
  }
  console.error("Failed to start dev server:", error);
  process.exit(1);
});

startServer();

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
