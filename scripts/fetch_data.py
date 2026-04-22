from __future__ import annotations

import json
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import requests

BASE_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = BASE_DIR / "data" / "raw"
PROCESSED_DIR = BASE_DIR / "data" / "processed"
POGOAPI_DIR = RAW_DIR / "pogoapi"
POKEAPI_DIR = RAW_DIR / "pokeapi" / "pokemon"
POKEAPI_SPECIES_DIR = RAW_DIR / "pokeapi" / "species"
POKEAPI_EVOLUTION_CHAIN_DIR = RAW_DIR / "pokeapi" / "evolution_chain"

POGOAPI_BASE = "https://pogoapi.net/api/v1"
POGO_FILES = {
    "released_pokemon.json": f"{POGOAPI_BASE}/released_pokemon.json",
    "pokemon_stats.json": f"{POGOAPI_BASE}/pokemon_stats.json",
    "pokemon_types.json": f"{POGOAPI_BASE}/pokemon_types.json",
    "current_pokemon_moves.json": f"{POGOAPI_BASE}/current_pokemon_moves.json",
    "fast_moves.json": f"{POGOAPI_BASE}/fast_moves.json",
    "charged_moves.json": f"{POGOAPI_BASE}/charged_moves.json",
    "pvp_fast_moves.json": f"{POGOAPI_BASE}/pvp_fast_moves.json",
    "pvp_charged_moves.json": f"{POGOAPI_BASE}/pvp_charged_moves.json",
    "type_effectiveness.json": f"{POGOAPI_BASE}/type_effectiveness.json",
}
POKEAPI_POKEMON_URL = "https://pokeapi.co/api/v2/pokemon/{pokemon_id}"
POKEAPI_SPECIES_URL = "https://pokeapi.co/api/v2/pokemon-species/{pokemon_id}"

REQUEST_HEADERS = {
    "User-Agent": "pokemon-go-explorer/1.0",
    "Accept": "application/json",
}


def ensure_directories() -> None:
    POGOAPI_DIR.mkdir(parents=True, exist_ok=True)
    POKEAPI_DIR.mkdir(parents=True, exist_ok=True)
    POKEAPI_SPECIES_DIR.mkdir(parents=True, exist_ok=True)
    POKEAPI_EVOLUTION_CHAIN_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


def fetch_json(url: str) -> Any:
    response = requests.get(url, headers=REQUEST_HEADERS, timeout=60)
    response.raise_for_status()
    return response.json()


def download_json_files(paths_and_urls: Sequence[Tuple[Path, str]]) -> None:
    missing = [(path, url) for path, url in paths_and_urls if not path.exists()]
    if not missing:
        return

    max_workers = min(24, len(missing))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(fetch_json, url): (path, url) for path, url in missing}
        for future in as_completed(future_map):
            path, url = future_map[future]
            print(f"Downloading {url}")
            save_json(path, future.result())


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def normalize_form(value: Any) -> str:
    cleaned = str(value or "Normal").strip()
    return cleaned if cleaned else "Normal"


def normalize_type(value: Any) -> str:
    cleaned = str(value or "").strip().replace("_", " ")
    return cleaned.title()


def safe_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def safe_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def ensure_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def first_present(*values: Any) -> Any:
    for value in values:
        if value not in (None, ""):
            return value
    return None


def compute_raid_dps(power: Any, duration: Any) -> Optional[float]:
    power_value = safe_float(power)
    duration_value = safe_float(duration)
    if power_value is None or duration_value is None or duration_value <= 0:
        return None
    return round(power_value / (duration_value / 1000.0), 3)


def as_dict_rows(data: Any) -> List[Dict[str, Any]]:
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        rows: List[Dict[str, Any]] = []
        for value in data.values():
            if isinstance(value, list):
                rows.extend(row for row in value if isinstance(row, dict))
            elif isinstance(value, dict):
                rows.append(value)
        return rows
    return []


def build_artwork_urls(pokemon_id: int, artwork_payload: Mapping[str, Any] | None) -> Dict[str, Optional[str]]:
    sprites = artwork_payload.get("sprites", {}) if artwork_payload else {}
    other = sprites.get("other", {}) if isinstance(sprites, dict) else {}
    official_artwork = {}
    home = {}
    if isinstance(other, dict):
        official_artwork = other.get("official-artwork", {}) or {}
        home = other.get("home", {}) or {}

    return {
        "official_artwork": official_artwork.get("front_default")
        if isinstance(official_artwork, dict)
        else None,
        "home": home.get("front_default") if isinstance(home, dict) else None,
        "sprite": sprites.get("front_default") if isinstance(sprites, dict) else None,
    }


def fetch_pogoapi_files() -> None:
    download_json_files([(POGOAPI_DIR / filename, url) for filename, url in POGO_FILES.items()])


def fetch_pokeapi_artwork_data(released_rows: Sequence[Dict[str, Any]]) -> None:
    pokemon_ids = sorted(
        {
            pokemon_id
            for row in released_rows
            if (pokemon_id := safe_int(first_present(row.get("pokemon_id"), row.get("id"))))
            is not None
        }
    )
    download_json_files(
        [
            (POKEAPI_DIR / f"{pokemon_id}.json", POKEAPI_POKEMON_URL.format(pokemon_id=pokemon_id))
            for pokemon_id in pokemon_ids
        ]
    )


def fetch_pokeapi_species_data(released_rows: Sequence[Dict[str, Any]]) -> None:
    pokemon_ids = sorted(
        {
            pokemon_id
            for row in released_rows
            if (pokemon_id := safe_int(first_present(row.get("pokemon_id"), row.get("id"))))
            is not None
        }
    )
    download_json_files(
        [
            (POKEAPI_SPECIES_DIR / f"{pokemon_id}.json", POKEAPI_SPECIES_URL.format(pokemon_id=pokemon_id))
            for pokemon_id in pokemon_ids
        ]
    )


def get_chain_id(chain_url: str | None) -> Optional[str]:
    if not chain_url:
        return None
    return str(chain_url).rstrip("/").split("/")[-1] or None


def fetch_pokeapi_evolution_chain_data(species_rows: Sequence[Dict[str, Any]]) -> None:
    chain_urls = sorted(
        {
            species.get("evolution_chain", {}).get("url")
            for species in species_rows
            if isinstance(species.get("evolution_chain"), dict)
            and species.get("evolution_chain", {}).get("url")
        }
    )
    download_json_files(
        [
            (POKEAPI_EVOLUTION_CHAIN_DIR / f"{chain_id}.json", chain_url)
            for chain_url in chain_urls
            if (chain_id := get_chain_id(chain_url)) is not None
        ]
    )


def load_artwork_index() -> Dict[int, Dict[str, Optional[str]]]:
    artwork_index: Dict[int, Dict[str, Optional[str]]] = {}
    if not POKEAPI_DIR.exists():
        return artwork_index
    for path in POKEAPI_DIR.glob("*.json"):
        pokemon_id = safe_int(path.stem)
        if pokemon_id is None:
            continue
        payload = load_json(path)
        artwork_index[pokemon_id] = build_artwork_urls(pokemon_id, payload)
    return artwork_index


def load_species_index() -> Dict[int, Dict[str, Any]]:
    index: Dict[int, Dict[str, Any]] = {}
    if not POKEAPI_SPECIES_DIR.exists():
        return index
    for path in POKEAPI_SPECIES_DIR.glob("*.json"):
        pokemon_id = safe_int(path.stem)
        if pokemon_id is None:
            continue
        index[pokemon_id] = load_json(path)
    return index


def load_evolution_chain_index() -> Dict[str, Dict[str, Any]]:
    index: Dict[str, Dict[str, Any]] = {}
    if not POKEAPI_EVOLUTION_CHAIN_DIR.exists():
        return index
    for path in POKEAPI_EVOLUTION_CHAIN_DIR.glob("*.json"):
        chain_id = path.stem
        index[chain_id] = load_json(path)
    return index


def collect_evolution_paths(node: Mapping[str, Any], prefix: Optional[List[str]] = None) -> List[List[str]]:
    current = list(prefix or [])
    species = node.get("species", {}) if isinstance(node, Mapping) else {}
    name = species.get("name") if isinstance(species, Mapping) else None
    if not name:
        return []

    current.append(str(name))
    evolves_to = node.get("evolves_to", []) if isinstance(node, Mapping) else []
    if not evolves_to:
        return [current]

    paths: List[List[str]] = []
    for child in evolves_to:
        if isinstance(child, Mapping):
            paths.extend(collect_evolution_paths(child, current))
    return paths


def build_evolution_family_metadata(chain_payload: Mapping[str, Any]) -> Dict[str, Any]:
    chain = chain_payload.get("chain", {}) if isinstance(chain_payload, Mapping) else {}
    if not isinstance(chain, Mapping):
        return {}

    paths = collect_evolution_paths(chain, [])
    if not paths:
        return {}

    depth_by_name: Dict[str, int] = {}
    finals_by_name: Dict[str, set[str]] = {}
    line_names: set[str] = set()
    for path in paths:
        final_name = path[-1]
        for index, name in enumerate(path, start=1):
            line_names.add(name)
            current_depth = depth_by_name.get(name)
            depth_by_name[name] = index if current_depth is None else min(current_depth, index)
            finals_by_name.setdefault(name, set()).add(final_name)

    family_root = paths[0][0]
    family_final_names = sorted({path[-1] for path in paths})

    return {
        "family_root": family_root,
        "paths": paths,
        "depth_by_name": depth_by_name,
        "finals_by_name": {name: sorted(values) for name, values in finals_by_name.items()},
        "family_final_names": family_final_names,
        "line_names": sorted(line_names),
    }


def build_species_evolution_index(
    species_rows: Mapping[int, Dict[str, Any]],
    evolution_chains: Mapping[str, Dict[str, Any]],
) -> Dict[int, Dict[str, Any]]:
    evolution_index: Dict[int, Dict[str, Any]] = {}
    for pokemon_id, species_payload in species_rows.items():
        chain_url = species_payload.get("evolution_chain", {}).get("url") if isinstance(species_payload, dict) else None
        chain_id = get_chain_id(chain_url)
        chain_payload = evolution_chains.get(chain_id or "")
        if not chain_payload:
            continue
        family = build_evolution_family_metadata(chain_payload)
        species_name = normalize_text(species_payload.get("name"))
        depth_by_name = family.get("depth_by_name", {})
        finals_by_name = family.get("finals_by_name", {})
        final_names = finals_by_name.get(species_name, family.get("family_final_names", []))
        evolution_index[pokemon_id] = {
            "family_root": family.get("family_root"),
            "evolution_stage": depth_by_name.get(species_name),
            "final_evolution_names": final_names,
            "is_final_evolution": species_name in family.get("family_final_names", []),
            "line_names": family.get("line_names", []),
        }
    return evolution_index


def index_rows(rows: Iterable[Dict[str, Any]]) -> Dict[Tuple[Optional[int], str], Dict[str, Any]]:
    index: Dict[Tuple[Optional[int], str], Dict[str, Any]] = {}
    for row in rows:
        pokemon_id = safe_int(first_present(row.get("pokemon_id"), row.get("id")))
        form = normalize_form(row.get("form"))
        index[(pokemon_id, form)] = row
    return index


def standardize_move(row: Mapping[str, Any], move_kind: str) -> Dict[str, Any]:
    move: Dict[str, Any] = dict(row)
    move["name"] = row.get("name")
    move["type"] = normalize_type(row.get("type"))
    move["power"] = safe_int(row.get("power"))
    move["duration"] = safe_int(row.get("duration"))
    move["turn_duration"] = safe_int(row.get("turn_duration"))
    move["energy_delta"] = safe_int(row.get("energy_delta"))
    move["move_kind"] = move_kind
    if "move_id" in move:
        move["move_id"] = safe_int(move.get("move_id"))
    if "critical_chance" in move:
        move["critical_chance"] = safe_float(move.get("critical_chance"))
    if "heal_scalar" in move:
        move["heal_scalar"] = safe_float(move.get("heal_scalar"))
    if "stamina_loss_scaler" in move:
        move["stamina_loss_scaler"] = safe_float(move.get("stamina_loss_scaler"))
    move["raid_dps"] = compute_raid_dps(move.get("power"), move.get("duration"))
    return move


def move_catalog(rows: Sequence[Dict[str, Any]], move_kind: str) -> Dict[str, Dict[str, Any]]:
    catalog: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        name = row.get("name")
        if not name:
            continue
        catalog[normalize_text(name)] = standardize_move(row, move_kind)
    return catalog


def get_move_entry(
    move_name: str,
    move_kind: str,
    catalog: Mapping[str, Dict[str, Any]],
    pokemon_types: Sequence[str],
) -> Dict[str, Any]:
    entry = deepcopy(catalog.get(normalize_text(move_name), {}))
    entry["name"] = entry.get("name") or move_name
    entry["move_kind"] = move_kind
    entry.setdefault("type", None)

    raw_dps = None
    duration = entry.get("duration")
    power = entry.get("power")
    if isinstance(duration, int) and duration > 0 and isinstance(power, int):
        raw_dps = round(power / (duration / 1000), 3)
    entry["raw_dps"] = raw_dps
    entry["stab_multiplier"] = 1.2 if entry.get("type") and entry["type"] in pokemon_types else 1.0
    entry["stab_dps"] = round(raw_dps * entry["stab_multiplier"], 3) if raw_dps is not None else None
    return entry


def build_type_effectiveness_index(rows: Any) -> Dict[str, Dict[str, float]]:
    if not isinstance(rows, dict):
        return {}
    index: Dict[str, Dict[str, float]] = {}
    for attacker_type, defenders in rows.items():
        if not isinstance(defenders, dict):
            continue
        index[normalize_type(attacker_type)] = {
            normalize_type(defender_type): safe_float(multiplier) or 1.0
            for defender_type, multiplier in defenders.items()
        }
    return index


def combine_type_multiplier(
    attack_type: Optional[str],
    defender_types: Sequence[str],
    type_effectiveness: Mapping[str, Mapping[str, float]],
) -> float:
    if not attack_type:
        return 1.0
    attack_key = normalize_type(attack_type)
    defender_keys = [normalize_type(defender_type) for defender_type in defender_types if defender_type]
    multiplier = 1.0
    for defender_type in defender_keys:
        multiplier *= type_effectiveness.get(attack_key, {}).get(defender_type, 1.0)
    return round(multiplier, 4)


def summarize_raid_candidates(
    moves: Sequence[Dict[str, Any]],
    pokemon_types: Sequence[str],
) -> List[Dict[str, Any]]:
    candidates = []
    for move in moves:
        if move.get("raw_dps") is None:
            continue
        multiplier = 1.2 if move.get("type") in pokemon_types else 1.0
        candidates.append(
            {
                "name": move.get("name"),
                "move_kind": move.get("move_kind"),
                "type": move.get("type"),
                "power": move.get("power"),
                "duration": move.get("duration"),
                "raw_dps": move.get("raw_dps"),
                "stab_multiplier": multiplier,
                "raid_dps": round(move.get("raw_dps") * multiplier, 3),
            }
        )
    candidates.sort(key=lambda item: (item["raid_dps"] is None, -(item["raid_dps"] or 0.0)))
    return candidates[:8]


def move_signature(moves: Sequence[Dict[str, Any]]) -> Tuple[Tuple[Any, ...], ...]:
    signature: set[Tuple[Any, ...]] = set()
    for move in moves:
        signature.add(
            (
                normalize_text(move.get("name")),
                normalize_text(move.get("move_kind")),
                normalize_type(move.get("type")) if move.get("type") else None,
                safe_int(move.get("power")),
                safe_int(move.get("duration")),
                safe_int(move.get("energy_delta")),
            )
        )
    return tuple(sorted(signature))


def pokemon_form_signature(
    entry: Mapping[str, Any],
) -> Tuple[Tuple[str, ...], Tuple[Tuple[Any, ...], ...], Tuple[Optional[int], Optional[int], Optional[int]]]:
    types = tuple(sorted(normalize_type(t) for t in ensure_list(entry.get("types")) if t))
    moves = entry.get("moves", {}) if isinstance(entry.get("moves"), Mapping) else {}
    move_pool = [
        *ensure_list(moves.get("fast")),
        *ensure_list(moves.get("charged")),
        *ensure_list(moves.get("elite_fast")),
        *ensure_list(moves.get("elite_charged")),
    ]
    move_entries = [move for move in move_pool if isinstance(move, Mapping)]
    stats = entry.get("base_stats", {}) if isinstance(entry.get("base_stats"), Mapping) else {}
    stat_signature = (
        safe_int(stats.get("attack")),
        safe_int(stats.get("defense")),
        safe_int(stats.get("stamina")),
    )
    return types, move_signature(move_entries), stat_signature


def annotate_cosmetic_differences(pokemon_entries: List[Dict[str, Any]]) -> None:
    def has_battle_profile(entry: Mapping[str, Any]) -> bool:
        stats = entry.get("base_stats", {}) if isinstance(entry.get("base_stats"), Mapping) else {}
        has_stats = any(safe_int(stats.get(key)) is not None for key in ("attack", "defense", "stamina"))
        moves = entry.get("moves", {}) if isinstance(entry.get("moves"), Mapping) else {}
        has_moves = any(
            len([move for move in ensure_list(moves.get(key)) if isinstance(move, Mapping)]) > 0
            for key in ("fast", "charged", "elite_fast", "elite_charged")
        )
        has_types = len([t for t in ensure_list(entry.get("types")) if t]) > 0
        return has_stats or has_moves or has_types

    grouped: Dict[int, List[Dict[str, Any]]] = {}
    for entry in pokemon_entries:
        pokemon_id = safe_int(entry.get("pokemon_id"))
        if pokemon_id is None:
            continue
        grouped.setdefault(pokemon_id, []).append(entry)

    for forms in grouped.values():
        if not forms:
            continue

        canonical = next(
            (
                entry
                for entry in forms
                if normalize_form(entry.get("form")) == "Normal" and has_battle_profile(entry)
            ),
            None,
        )
        if canonical is None:
            canonical = next((entry for entry in forms if has_battle_profile(entry)), None)
        if canonical is None:
            canonical = next((entry for entry in forms if normalize_form(entry.get("form")) == "Normal"), None)
        if canonical is None:
            canonical = sorted(forms, key=lambda entry: normalize_form(entry.get("form")))[0]

        canonical_signature = pokemon_form_signature(canonical)
        for entry in forms:
            entry_signature = pokemon_form_signature(entry)
            same_as_canonical = entry_signature == canonical_signature
            is_canonical = entry is canonical
            entry.setdefault("derived", {})
            entry["derived"]["cosmetic_diff"] = bool(not is_canonical and same_as_canonical)


def released_species_index(released_rows: Sequence[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    index: Dict[int, Dict[str, Any]] = {}
    for row in released_rows:
        pokemon_id = safe_int(first_present(row.get("pokemon_id"), row.get("id")))
        if pokemon_id is not None:
            index[pokemon_id] = row
    return index


def collect_pokemon_keys(
    *indexes: Mapping[Tuple[Optional[int], str], Dict[str, Any]],
    released_ids: Optional[Sequence[int]] = None,
) -> List[Tuple[int, str]]:
    keys: set[Tuple[int, str]] = set()
    for index in indexes:
        for pokemon_id, form in index.keys():
            if pokemon_id is None:
                continue
            keys.add((pokemon_id, form))
    if released_ids:
        for pokemon_id in released_ids:
            keys.add((pokemon_id, "Normal"))
    return sorted(keys, key=lambda item: (item[0], item[1]))


def merge_data() -> Dict[str, Any]:
    released_rows = as_dict_rows(load_json(POGOAPI_DIR / "released_pokemon.json"))
    fetch_pokeapi_artwork_data(released_rows)
    fetch_pokeapi_species_data(released_rows)
    released_index = released_species_index(released_rows)

    stats_rows = as_dict_rows(load_json(POGOAPI_DIR / "pokemon_stats.json"))
    types_rows = as_dict_rows(load_json(POGOAPI_DIR / "pokemon_types.json"))
    current_moves_rows = as_dict_rows(load_json(POGOAPI_DIR / "current_pokemon_moves.json"))
    fast_moves_rows = as_dict_rows(load_json(POGOAPI_DIR / "fast_moves.json"))
    charged_moves_rows = as_dict_rows(load_json(POGOAPI_DIR / "charged_moves.json"))
    pvp_fast_moves_rows = as_dict_rows(load_json(POGOAPI_DIR / "pvp_fast_moves.json"))
    pvp_charged_moves_rows = as_dict_rows(load_json(POGOAPI_DIR / "pvp_charged_moves.json"))
    type_effectiveness_rows = load_json(POGOAPI_DIR / "type_effectiveness.json")
    species_rows = load_species_index()
    fetch_pokeapi_evolution_chain_data(species_rows.values())
    evolution_chains = load_evolution_chain_index()

    stats_index = index_rows(stats_rows)
    types_index = index_rows(types_rows)
    current_moves_index = index_rows(current_moves_rows)
    evolution_index = build_species_evolution_index(species_rows, evolution_chains)

    fast_moves = move_catalog(fast_moves_rows, "fast")
    charged_moves = move_catalog(charged_moves_rows, "charged")
    pvp_fast_moves = move_catalog(pvp_fast_moves_rows, "pvp_fast")
    pvp_charged_moves = move_catalog(pvp_charged_moves_rows, "pvp_charged")
    type_effectiveness = build_type_effectiveness_index(type_effectiveness_rows)
    artwork_index = load_artwork_index()

    merged_pokemon: List[Dict[str, Any]] = []

    for pokemon_id, form in collect_pokemon_keys(
        stats_index,
        types_index,
        current_moves_index,
        released_ids=released_index.keys(),
    ):
        key = (pokemon_id, form)
        stat_row = stats_index.get(key, {})
        type_row = types_index.get(key, {})
        move_row = current_moves_index.get(key, {})

        pokemon_types = [
            normalize_type(t)
            for t in ensure_list(first_present(type_row.get("type"), type_row.get("types")))
            if t
        ]
        if not pokemon_types:
            pokemon_types = [
                normalize_type(t)
                for t in [type_row.get("type"), type_row.get("type_2")]
                if t
            ]

        current_fast = [
            get_move_entry(move_name, "fast", fast_moves, pokemon_types)
            for move_name in ensure_list(move_row.get("fast_moves"))
        ]
        current_charged = [
            get_move_entry(move_name, "charged", charged_moves, pokemon_types)
            for move_name in ensure_list(move_row.get("charged_moves"))
        ]
        elite_fast = [
            get_move_entry(move_name, "elite_fast", fast_moves, pokemon_types)
            for move_name in ensure_list(move_row.get("elite_fast_moves"))
        ]
        elite_charged = [
            get_move_entry(move_name, "elite_charged", charged_moves, pokemon_types)
            for move_name in ensure_list(move_row.get("elite_charged_moves"))
        ]

        raid_candidates = summarize_raid_candidates(
            [*current_fast, *current_charged, *elite_fast, *elite_charged],
            pokemon_types,
        )

        merged_pokemon.append(
            {
                "pokemon_id": pokemon_id,
                "dex": pokemon_id,
                "name": first_present(
                    stat_row.get("pokemon_name"),
                    type_row.get("pokemon_name"),
                    move_row.get("pokemon_name"),
                    stat_row.get("name"),
                    type_row.get("name"),
                    move_row.get("name"),
                    released_index.get(pokemon_id, {}).get("pokemon_name"),
                    released_index.get(pokemon_id, {}).get("name"),
                ),
                "form": form,
                "released": pokemon_id in released_index,
                "types": pokemon_types,
                "base_stats": {
                    "attack": safe_int(first_present(stat_row.get("base_attack"), stat_row.get("attack"))),
                    "defense": safe_int(first_present(stat_row.get("base_defense"), stat_row.get("defense"))),
                    "stamina": safe_int(first_present(stat_row.get("base_stamina"), stat_row.get("stamina"))),
                },
                "moves": {
                    "fast": current_fast,
                    "charged": current_charged,
                    "elite_fast": elite_fast,
                    "elite_charged": elite_charged,
                },
                "artwork": artwork_index.get(pokemon_id)
                or {
                    "official_artwork": None,
                    "home": None,
                    "sprite": None,
                },
                "evolution": evolution_index.get(pokemon_id)
                or {
                    "family_root": None,
                    "evolution_stage": None,
                    "final_evolution_names": [],
                    "is_final_evolution": False,
                    "line_names": [],
                },
                "derived": {
                    "has_dual_type": len(pokemon_types) == 2,
                    "cosmetic_diff": False,
                    "raid_move_candidates": raid_candidates,
                },
            }
        )

    annotate_cosmetic_differences(merged_pokemon)
    merged_pokemon.sort(key=lambda entry: (entry["dex"], entry["form"], str(entry["name"])))

    return {
        "pokemon": merged_pokemon,
        "fast_moves": fast_moves,
        "charged_moves": charged_moves,
        "pvp_fast_moves": pvp_fast_moves,
        "pvp_charged_moves": pvp_charged_moves,
        "type_effectiveness": type_effectiveness,
    }


def main() -> None:
    ensure_directories()
    fetch_pogoapi_files()

    released_rows = as_dict_rows(load_json(POGOAPI_DIR / "released_pokemon.json"))
    fetch_pokeapi_artwork_data(released_rows)

    merged = merge_data()
    save_json(PROCESSED_DIR / "merged_pogo_data.json", merged)
    print(f"Saved merged data to {PROCESSED_DIR / 'merged_pogo_data.json'}")


if __name__ == "__main__":
    main()
