# Project: Pokémon GO Explorer

Build a local-first app for exploring Pokémon GO data.

## Goal
Create a small app that can:
- list all currently released Pokémon in Pokémon GO
- show base stats, types, and available moves
- compare move DPS for raid/gym contexts
- apply Pokémon GO type effectiveness
- display nice artwork/images for each Pokémon

## Data sources
Primary source for Pokémon GO mechanics/data:
- PoGoAPI:
  - /api/v1/released_pokemon.json
  - /api/v1/pokemon_stats.json
  - /api/v1/pokemon_types.json
  - /api/v1/current_pokemon_moves.json
  - /api/v1/fast_moves.json
  - /api/v1/charged_moves.json
  - /api/v1/pvp_fast_moves.json
  - /api/v1/pvp_charged_moves.json
  - /api/v1/type_effectiveness.json

Artwork source:
- PokéAPI pokemon endpoint for sprite/artwork URLs

Fallback/validation source only:
- PokeMiners Game Master

## Rules
- Cache all remote data locally under `data/raw/`.
- Build one merged file under `data/processed/merged_pogo_data.json`.
- Do not overcomplicate the first version.
- First ship a data pipeline and a very simple explorer UI.
- Keep functions small and typed where reasonable.
- Prefer explicit schema over cleverness.

## Desired merged schema
For each Pokémon/form, include:
- pokemon_id
- dex
- name
- form
- released
- types
- base_stats:
  - attack
  - defense
  - stamina
- moves:
  - fast
  - charged
  - elite_fast
  - elite_charged
- artwork:
  - official_artwork
  - home
  - sprite
- derived fields:
  - has_dual_type
  - raid_move_candidates

Also create separate move dictionaries:
- fast_moves
- charged_moves
- pvp_fast_moves
- pvp_charged_moves

Each move should include, if available:
- name
- type
- power
- duration
- turn_duration
- energy_delta
- move_kind

## First tasks
1. Implement `scripts/fetch_data.py` to download all source JSON files.
2. Merge them into `data/processed/merged_pogo_data.json`.
3. Create a tiny README with run instructions.
4. Then scaffold a minimal local app in `app/` that can:
   - search Pokémon by name
   - filter by type
   - compare two Pokémon side by side
   - show fast/charged moves with computed raid DPS

## DPS logic
For raid/gym move DPS:
- DPS = power / (duration_ms / 1000)
- Use PoGoAPI fast_moves and charged_moves data
- Keep raw DPS and type-adjusted DPS separate

## Type effectiveness
Use Pokémon GO type multipliers from `type_effectiveness.json`.
Do not use mainline Pokémon multipliers unless clearly marked as non-GO.