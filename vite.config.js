import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function runPvpMetaRefresh(projectRoot) {
  const windowsVenvPython = path.join(projectRoot, ".venv", "Scripts", "python.exe");
  const fallbackPython = process.platform === "win32" ? "python" : "python3";
  const pythonCmd = existsSync(windowsVenvPython) ? windowsVenvPython : fallbackPython;
  const scriptPath = path.join(projectRoot, "scripts", "fetch_great_league_meta.py");

  return new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, [scriptPath], {
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

function pvpMetaRefreshPlugin() {
  return {
    name: "pvp-meta-refresh",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__refresh/pvp-meta")) {
          next();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
          return;
        }
        try {
          await runPvpMetaRefresh(server.config.root);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: true, refreshed_at_utc: new Date().toISOString() }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to refresh PvP meta data";
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), pvpMetaRefreshPlugin()],
});
