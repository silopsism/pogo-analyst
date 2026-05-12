# Pokemon GO Explorer

Local-first explorer for Pokemon GO data.

## What it does

- caches PokeMiners Game Master under `data/raw/pokeminers/latest.json`
- caches supporting PoGoAPI JSON (`released_pokemon.json`, `type_effectiveness.json`) under `data/raw/pogoapi/`
- downloads PokeAPI artwork payloads for released Pokemon
- builds `data/processed/merged_pogo_data.json`
- builds baseline spawn rarity outputs:
  - `data/pokemon_species.json`
  - `data/spawn_rarity.json`
  - `data/rarity_sources.json`
  - `data/manual_rarity_overrides.json`
- runs a React + TypeScript UI for search, filtering, comparison, and move DPS ranking

## Setup

```bash
python scripts/fetch_data.py
npm install
npm run build
npm run dev
```

The React app reads the merged JSON directly from `data/processed/merged_pogo_data.json`.
The `dev` command serves the already-built `dist/` bundle on `http://127.0.0.1:5173` (or the next free port if 5173 is busy).

If you are using Windows PowerShell and `npm run dev` is blocked by script execution policy, run:

```powershell
npm.cmd run dev
```

That starts the local static dev server and opens the app in your browser.

If startup gets stuck in a stale state, run:

```powershell
npm.cmd run dev:reset
```

That force-stops stale Node servers, rebuilds `dist/`, and starts a fresh server session.

## Notes

- Raid DPS is computed as `power / (duration_ms / 1000)`.
- Species stats/types/move pools are sourced from PokeMiners Game Master.
- Type-adjusted DPS uses the PoGoAPI type effectiveness table.
- Spawn rarity is an estimated semantic baseline model, not official Niantic per-species spawn probabilities.
- If the merged dataset is missing, run the fetch script again before starting the app.

## Merged schema

`data/processed/merged_pogo_data.json` contains:

- `pokemon`: one row per Pokemon form with `pokemon_id`, `dex`, `name`, `form`, `released`, `types`, `base_stats`, `moves`, `artwork`, and `derived`
- `fast_moves`, `charged_moves`, `pvp_fast_moves`, `pvp_charged_moves`: move dictionaries keyed by move name
- `type_effectiveness`: PoGoAPI attack-vs-defense multipliers

Each Pokemon row includes current fast/charged moves, elite move lists, artwork URLs, and derived fields such as `has_dual_type` and `raid_move_candidates`.
