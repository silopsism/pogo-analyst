# Spawn Rarity Model

## Purpose

This project models estimated baseline wild spawn rarity for Pokemon GO.

It does **not** claim official spawn rates. Niantic does not publish exact per-species wild spawn probabilities.

## Scope

- Baseline mode: non-event day-to-day modeling
- Event boosts and temporary event pools are excluded
- Output is semantic rarity tiers, not exact percentages

## Output Files

- `data/pokemon_species.json`
- `data/spawn_rarity.json`
- `data/rarity_sources.json`
- `data/manual_rarity_overrides.json`

## Rarity Semantics

`rarityTier` uses:

- `common`
- `uncommon`
- `rare`
- `super_rare`
- `ultra_rare`
- `event_only`
- `not_wild`
- `unknown`

`geoAvailability` is separate from rarity and uses:

- `global`
- `regional`
- `unknown`

This allows a Pokemon to be modeled as rare and regional at the same time.

## Baseline Rules

1. `legendary`, `mythical`, `ultra beast`, and `baby` species default to `not_wild`.
2. Regionals are marked `wildAvailability=regional` and `geoAvailability=regional`.
3. If local hints mark `found_wild=false` and another channel is true (`raid`, `egg`, `research`), classify as `not_wild`.
4. Remaining entries infer tier from local rarity labels, capture-rate hints, and evolution stage fallback.
5. Form entries are tracked independently; forms can differ from their base species.

## Confidence

- `high`: category-based certainty (for example legendary/mythical/not wild)
- `medium`: supported by stable baseline hints
- `low`: inferred from weak or incomplete hints

## Overrides

Manual fixes live in `data/manual_rarity_overrides.json`.

Use overrides for:

- corrected regional flags
- form-specific corrections
- special cases where local source hints are wrong or stale

The generator always tags manual edits in `sources` as `manual_rarity_overrides`.
