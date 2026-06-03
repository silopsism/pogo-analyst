"""Minimal production server for the Pokemon GO Explorer.

Serves the built frontend (dist/) and the data/ JSON files, and exposes the
POST /__refresh/pvp-meta endpoint that the app's "refresh PvP meta" button
calls (mirrors the Vite dev-server middleware: runs the pvpoke fetch script,
which rewrites data/processed/pvpoke_<league>_league_rankings.json).
"""

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"
DATA_DIR = BASE_DIR / "data"
REFRESH_SCRIPT = BASE_DIR / "scripts" / "fetch_great_league_meta.py"
VALID_LEAGUES = {"great", "ultra", "master"}

app = Flask(__name__)


@app.post("/__refresh/pvp-meta")
def refresh_pvp_meta():
    body = request.get_json(silent=True) or {}
    league = str(body.get("league", "great")).lower()
    if league not in VALID_LEAGUES:
        league = "great"
    try:
        subprocess.run(
            [sys.executable, str(REFRESH_SCRIPT), "--league", league],
            cwd=str(BASE_DIR),
            check=True,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error=f"Refresh timed out for {league} league"), 504
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "unknown error").strip()
        return jsonify(ok=False, error=f"Refresh failed: {detail[-400:]}"), 500
    return jsonify(
        ok=True,
        league=league,
        refreshed_at_utc=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/data/<path:subpath>")
def serve_data(subpath):
    # 404s naturally if the file is missing (the frontend handles 404 as "no data")
    return send_from_directory(DATA_DIR, subpath)


@app.get("/")
@app.get("/<path:subpath>")
def serve_static(subpath="index.html"):
    candidate = (DIST_DIR / subpath).resolve()
    if candidate.is_file() and str(candidate).startswith(str(DIST_DIR.resolve())):
        return send_from_directory(DIST_DIR, subpath)
    # SPA fallback
    return send_from_directory(DIST_DIR, "index.html")
