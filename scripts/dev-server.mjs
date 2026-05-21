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
const defaultPorts = [5173, 5174, 5175, 5176];
const envPortRaw = process.env.PORT ?? process.env.DEV_PORT ?? "";
const envPort = Number.parseInt(envPortRaw, 10);
const preferredPorts = Number.isInteger(envPort) && envPort > 0
  ? [envPort, ...defaultPorts.filter((port) => port !== envPort)]
  : defaultPorts;

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

function runPvpMetaRefresh(league = "great") {
  const windowsVenvPython = path.join(projectRoot, ".venv", "Scripts", "python.exe");
  const fallbackPython = process.platform === "win32" ? "python" : "python3";
  const pythonCmd = existsSync(windowsVenvPython) ? windowsVenvPython : fallbackPython;
  const scriptPath = path.join(projectRoot, "scripts", "fetch_great_league_meta.py");

  return new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, [scriptPath, "--league", league], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`PvP meta refresh failed (exit ${String(code)}): ${stderr || stdout || "no output"}`));
    });
  });
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

  if (pathname === "/__refresh/pvp-meta") {
    if (req.method !== "POST") {
      res.writeHead(405, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
      return;
    }

    try {
      let league = "great";
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      if (chunks.length) {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          const incoming = String(payload?.league ?? "").toLowerCase();
          if (incoming === "ultra" || incoming === "master" || incoming === "great") {
            league = incoming;
          }
        } catch {
          // fall back to default league
        }
      }
      await runPvpMetaRefresh(league);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.end(JSON.stringify({ ok: true, league, refreshed_at_utc: new Date().toISOString() }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to refresh PvP meta data";
      res.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.end(JSON.stringify({ ok: false, error: message }));
    }
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
