from __future__ import annotations

import json
import csv
import re
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import requests

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
RAW_DIR = BASE_DIR / "data" / "raw"
PROCESSED_DIR = BASE_DIR / "data" / "processed"
POGOAPI_DIR = RAW_DIR / "pogoapi"
POKEMINERS_DIR = RAW_DIR / "pokeminers"
POKEAPI_DIR = RAW_DIR / "pokeapi" / "pokemon"
POKEAPI_SPECIES_DIR = RAW_DIR / "pokeapi" / "species"
POKEAPI_EVOLUTION_CHAIN_DIR = RAW_DIR / "pokeapi" / "evolution_chain"
POKEAPI_FORM_DIR = RAW_DIR / "pokeapi" / "pokemon_forms"
POKEMON_CSV_PATH = DATA_DIR / "pokemon.csv"
POKEMON_SPECIES_PATH = DATA_DIR / "pokemon_species.json"
SPAWN_RARITY_PATH = DATA_DIR / "spawn_rarity.json"
RARITY_SOURCES_PATH = DATA_DIR / "rarity_sources.json"
MANUAL_RARITY_OVERRIDES_PATH = DATA_DIR / "manual_rarity_overrides.json"
MANUAL_MOVE_OVERRIDES_PATH = DATA_DIR / "manual_move_overrides.json"

POGOAPI_BASE = "https://pogoapi.net/api/v1"
POGO_FILES = {
    "released_pokemon.json": f"{POGOAPI_BASE}/released_pokemon.json",
    "type_effectiveness.json": f"{POGOAPI_BASE}/type_effectiveness.json",
    "raid_bosses.json": f"{POGOAPI_BASE}/raid_bosses.json",
}
POKEMINERS_LATEST_URL = "https://raw.githubusercontent.com/PokeMiners/game_masters/refs/heads/master/latest/latest.json"
POKEMINERS_LATEST_PATH = POKEMINERS_DIR / "latest.json"
POKEAPI_POKEMON_URL = "https://pokeapi.co/api/v2/pokemon/{pokemon_id}"
POKEAPI_SPECIES_URL = "https://pokeapi.co/api/v2/pokemon-species/{pokemon_id}"

REQUEST_HEADERS = {
    "User-Agent": "pokemon-go-explorer/1.0",
    "Accept": "application/json",
}

ROMAN_GENERATION_MAP = {
    "i": 1,
    "ii": 2,
    "iii": 3,
    "iv": 4,
    "v": 5,
    "vi": 6,
    "vii": 7,
    "viii": 8,
    "ix": 9,
}

ULTRA_BEAST_IDS = {793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806}

# Baseline regional species list for static, non-event rarity modeling.
# This list is intentionally override-friendly via data/manual_rarity_overrides.json.
DEFAULT_REGIONAL_POKEMON_IDS = {
    83,   # Farfetch'd
    115,  # Kangaskhan
    122,  # Mr. Mime
    128,  # Tauros
    214,  # Heracross
    222,  # Corsola
    313,  # Volbeat
    314,  # Illumise
    324,  # Torkoal
    335,  # Zangoose
    336,  # Seviper
    337,  # Lunatone
    338,  # Solrock
    369,  # Relicanth
    417,  # Pachirisu
    422,  # Shellos
    423,  # Gastrodon
    439,  # Mime Jr.
    511,  # Pansage
    512,  # Simisage
    513,  # Pansear
    514,  # Simisear
    515,  # Panpour
    516,  # Simipour
    538,  # Throh
    539,  # Sawk
    550,  # Basculin
    556,  # Maractus
    561,  # Sigilyph
    618,  # Stunfisk
    631,  # Heatmor
    632,  # Durant
    669,  # Flabebe
    707,  # Klefki
    764,  # Comfey
    771,  # Pyukumuku
    874,  # Stonjourner
    924,  # Tandemaus
}

RARITY_TIERS = {
    "common",
    "uncommon",
    "rare",
    "super_rare",
    "ultra_rare",
    "event_only",
    "not_wild",
    "unknown",
}


def ensure_directories() -> None:
    POGOAPI_DIR.mkdir(parents=True, exist_ok=True)
    POKEMINERS_DIR.mkdir(parents=True, exist_ok=True)
    POKEAPI_DIR.mkdir(parents=True, exist_ok=True)
    POKEAPI_SPECIES_DIR.mkdir(parents=True, exist_ok=True)
    POKEAPI_EVOLUTION_CHAIN_DIR.mkdir(parents=True, exist_ok=True)
    POKEAPI_FORM_DIR.mkdir(parents=True, exist_ok=True)
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


def normalize_identifier(value: Any) -> str:
    cleaned = re.sub(r"[’']", "", normalize_text(value))
    normalized = re.sub(r"[^a-z0-9]+", "_", cleaned)
    normalized = re.sub(r"_+", "_", normalized)
    return normalized.strip("_")


def normalize_form(value: Any) -> str:
    cleaned = str(value or "Normal").strip()
    return cleaned if cleaned else "Normal"


def normalize_type(value: Any) -> str:
    cleaned = str(value or "").strip().replace("_", " ")
    return cleaned.title()


def to_iso_date() -> str:
    return datetime.now(UTC).date().isoformat()


def to_iso_datetime() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


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


def parse_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes", "y"}:
        return True
    if normalized in {"false", "0", "no", "n"}:
        return False
    return None


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


def gm_dex_from_template_id(template_id: str) -> Optional[int]:
    match = re.match(r"^V(\d{4})_POKEMON_", str(template_id))
    if not match:
        return None
    return safe_int(match.group(1))


def gm_species_name_from_id(pokemon_id: str) -> str:
    token = normalize_identifier(pokemon_id)
    hardcoded = {
        "farfetchd": "Farfetch’d",
        "sirfetchd": "Sirfetch’d",
        "mr_mime": "Mr. Mime",
        "mr_rime": "Mr. Rime",
        "mime_jr": "Mime Jr.",
        "ho_oh": "Ho-Oh",
        "porygon_z": "Porygon-Z",
        "kommo_o": "Kommo-o",
        "hakamo_o": "Hakamo-o",
        "jangmo_o": "Jangmo-o",
    }
    if token in hardcoded:
        return hardcoded[token]
    return " ".join(part.capitalize() for part in token.split("_"))


def gm_form_from_settings(pokemon_id: str, form_value: Any) -> str:
    species = normalize_identifier(pokemon_id)
    form = normalize_identifier(form_value)
    if not form or form == species or form == f"{species}_normal":
        return "Normal"
    if form.startswith(f"{species}_"):
        form = form[len(species) + 1 :]
    if form == "alolan":
        form = "alola"
    return "_".join(part.capitalize() for part in form.split("_"))


def gm_move_catalog_name(move_id: str) -> str:
    normalized = str(move_id or "").strip().upper()
    if normalized.endswith("_FAST"):
        normalized = normalized[: -len("_FAST")]
    normalized = re.sub(r"^V\d+_MOVE_", "", normalized)
    normalized = re.sub(r"^COMBAT_V\d+_MOVE_", "", normalized)
    normalized = re.sub(r"_MOVE$", "", normalized)
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return " ".join(part.capitalize() for part in normalized.split("_"))


def gm_move_type(raw_type: Any) -> Optional[str]:
    if not raw_type:
        return None
    cleaned = str(raw_type).strip().upper().replace("POKEMON_TYPE_", "")
    if cleaned in {"NONE", "POKEMON_TYPE_NONE"}:
        return None
    return normalize_type(cleaned)


def load_pokeminers_templates() -> List[Dict[str, Any]]:
    payload = load_json(POKEMINERS_LATEST_PATH)
    if not isinstance(payload, list):
        return []
    return [row for row in payload if isinstance(row, dict)]


def build_rows_from_pokeminers(
    templates: Sequence[Dict[str, Any]],
) -> Tuple[
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[Dict[str, Any]],
]:
    stats_index: Dict[Tuple[int, str], Dict[str, Any]] = {}
    types_index: Dict[Tuple[int, str], Dict[str, Any]] = {}
    moves_index: Dict[Tuple[int, str], Dict[str, Any]] = {}
    raid_fast_rows: List[Dict[str, Any]] = []
    raid_charged_rows: List[Dict[str, Any]] = []
    pvp_fast_rows: List[Dict[str, Any]] = []
    pvp_charged_rows: List[Dict[str, Any]] = []

    for template in templates:
        data = template.get("data", {}) if isinstance(template.get("data"), dict) else {}
        template_id = str(template.get("templateId") or "")

        pokemon_settings = data.get("pokemonSettings")
        if isinstance(pokemon_settings, dict):
            dex = gm_dex_from_template_id(template_id)
            if dex is None:
                continue
            pokemon_id = str(pokemon_settings.get("pokemonId") or "").strip()
            if not pokemon_id:
                continue
            name = gm_species_name_from_id(pokemon_id)
            form = gm_form_from_settings(pokemon_id, pokemon_settings.get("form"))
            key = (dex, form)

            stats = pokemon_settings.get("stats", {}) if isinstance(pokemon_settings.get("stats"), dict) else {}
            type_one = gm_move_type(pokemon_settings.get("type"))
            type_two = gm_move_type(pokemon_settings.get("type2"))
            quick_moves = [gm_move_catalog_name(move_id) for move_id in ensure_list(pokemon_settings.get("quickMoves")) if move_id]
            cinematic_moves = [gm_move_catalog_name(move_id) for move_id in ensure_list(pokemon_settings.get("cinematicMoves")) if move_id]
            elite_quick_moves = [
                gm_move_catalog_name(move_id) for move_id in ensure_list(pokemon_settings.get("eliteQuickMove")) if move_id
            ]
            elite_cinematic_moves = [
                gm_move_catalog_name(move_id) for move_id in ensure_list(pokemon_settings.get("eliteCinematicMove")) if move_id
            ]
            # Some special/legacy charged moves (e.g. Dragon Ascent on Rayquaza)
            # are carried under nonTm move pools instead of elite pools.
            non_tm_quick_moves = [
                gm_move_catalog_name(move_id) for move_id in ensure_list(pokemon_settings.get("nonTmQuickMoves")) if move_id
            ]
            non_tm_cinematic_moves = [
                gm_move_catalog_name(move_id) for move_id in ensure_list(pokemon_settings.get("nonTmCinematicMoves")) if move_id
            ]
            elite_quick_moves = list(dict.fromkeys([*elite_quick_moves, *non_tm_quick_moves]))
            elite_cinematic_moves = list(dict.fromkeys([*elite_cinematic_moves, *non_tm_cinematic_moves]))

            stats_index[key] = {
                "pokemon_id": dex,
                "pokemon_name": name,
                "form": form,
                "base_attack": safe_int(stats.get("baseAttack")),
                "base_defense": safe_int(stats.get("baseDefense")),
                "base_stamina": safe_int(stats.get("baseStamina")),
            }
            types_index[key] = {
                "pokemon_id": dex,
                "pokemon_name": name,
                "form": form,
                "types": [move_type for move_type in (type_one, type_two) if move_type],
            }

            current = {
                "pokemon_id": dex,
                "pokemon_name": name,
                "form": form,
                "fast_moves": quick_moves,
                "charged_moves": cinematic_moves,
                "elite_fast_moves": elite_quick_moves,
                "elite_charged_moves": elite_cinematic_moves,
            }
            previous = moves_index.get(key)
            if previous is None:
                moves_index[key] = current
            else:
                previous_count = len(ensure_list(previous.get("fast_moves"))) + len(ensure_list(previous.get("charged_moves")))
                current_count = len(quick_moves) + len(cinematic_moves)
                if current_count >= previous_count:
                    moves_index[key] = current

        move_settings = data.get("moveSettings")
        if isinstance(move_settings, dict):
            movement_id = str(move_settings.get("movementId") or "").strip().upper()
            if movement_id:
                row = {
                    "name": gm_move_catalog_name(movement_id),
                    "type": gm_move_type(move_settings.get("pokemonType")),
                    "power": safe_int(move_settings.get("power")),
                    "duration": safe_int(move_settings.get("durationMs")),
                    "turn_duration": safe_int(move_settings.get("durationTurns")),
                    "energy_delta": safe_int(move_settings.get("energyDelta")),
                }
                if movement_id.endswith("_FAST"):
                    raid_fast_rows.append(row)
                else:
                    raid_charged_rows.append(row)

        combat_move = data.get("combatMove")
        if isinstance(combat_move, dict):
            unique_id = str(combat_move.get("uniqueId") or "").strip().upper()
            if unique_id:
                row = {
                    "name": gm_move_catalog_name(unique_id),
                    "type": gm_move_type(combat_move.get("type")),
                    "power": safe_int(combat_move.get("power")),
                    "duration": safe_int(combat_move.get("durationMs")),
                    "turn_duration": safe_int(combat_move.get("durationTurns")),
                    "energy_delta": safe_int(combat_move.get("energyDelta")),
                }
                if unique_id.endswith("_FAST"):
                    pvp_fast_rows.append(row)
                else:
                    pvp_charged_rows.append(row)

    return (
        list(stats_index.values()),
        list(types_index.values()),
        list(moves_index.values()),
        raid_fast_rows,
        raid_charged_rows,
        pvp_fast_rows,
        pvp_charged_rows,
    )


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


FORM_SLUG_ALIASES = {
    "galarian": "galar",
    "galarian_standard": "galar",
    "galarian_zen": "galar-zen",
    "alola": "alola",
    "hisuian": "hisui",
    "paldean": "paldea",
    "normal": "",
}


def pokemon_name_slug(value: Any) -> str:
    return normalize_identifier(value).replace("_", "-")


def pokemon_form_slug(value: Any) -> str:
    normalized = normalize_identifier(value)
    if normalized in FORM_SLUG_ALIASES:
        return FORM_SLUG_ALIASES[normalized]
    return normalized.replace("_", "-")


def form_artwork_slug_candidates(name: str, form: str) -> List[str]:
    name_slug = pokemon_name_slug(name)
    form_slug = pokemon_form_slug(form)
    if not name_slug or not form_slug:
        return []
    candidates = [f"{name_slug}-{form_slug}"]
    if form_slug.startswith("galar-"):
        candidates.append(f"{name_slug}-galar")
    return list(dict.fromkeys([item for item in candidates if item]))


def fetch_pokeapi_form_artwork_data(rows: Sequence[Tuple[str, str]]) -> None:
    if not rows:
        return
    pending: List[Tuple[Path, str]] = []
    for name, form in rows:
        for slug in form_artwork_slug_candidates(name, form):
            path = POKEAPI_FORM_DIR / f"{slug}.json"
            if path.exists():
                continue
            pending.append((path, f"https://pokeapi.co/api/v2/pokemon/{slug}"))
    if not pending:
        return
    with ThreadPoolExecutor(max_workers=min(24, len(pending))) as executor:
        future_map = {executor.submit(fetch_json, url): (path, url) for path, url in pending}
        for future in as_completed(future_map):
            path, url = future_map[future]
            try:
                payload = future.result()
            except Exception:
                continue
            print(f"Downloading {url}")
            save_json(path, payload)


def fetch_pogoapi_files() -> None:
    download_json_files([(POGOAPI_DIR / filename, url) for filename, url in POGO_FILES.items()])


def fetch_pokeminers_file() -> None:
    download_json_files([(POKEMINERS_LATEST_PATH, POKEMINERS_LATEST_URL)])


def cleanup_legacy_pogoapi_files() -> None:
    legacy = [
        "pokemon_stats.json",
        "pokemon_types.json",
        "current_pokemon_moves.json",
        "fast_moves.json",
        "charged_moves.json",
        "pvp_fast_moves.json",
        "pvp_charged_moves.json",
    ]
    for filename in legacy:
        path = POGOAPI_DIR / filename
        if path.exists():
            path.unlink()


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


def load_form_artwork_index() -> Dict[str, Dict[str, Optional[str]]]:
    index: Dict[str, Dict[str, Optional[str]]] = {}
    if not POKEAPI_FORM_DIR.exists():
        return index
    for path in POKEAPI_FORM_DIR.glob("*.json"):
        payload = load_json(path)
        index[path.stem] = build_artwork_urls(0, payload)
    return index


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


def ensure_manual_move_overrides() -> Dict[str, Any]:
    if MANUAL_MOVE_OVERRIDES_PATH.exists():
        payload = load_json(MANUAL_MOVE_OVERRIDES_PATH)
        if isinstance(payload, dict):
            payload.setdefault("modelVersion", "v1")
            payload.setdefault("notes", "Manual move-pool corrections for recent events or lagging upstream sources.")
            payload.setdefault("overrides", [])
            return payload

    payload = {
        "modelVersion": "v1",
        "notes": "Manual move-pool corrections for recent events or lagging upstream sources.",
        "overrides": [],
    }
    save_json(MANUAL_MOVE_OVERRIDES_PATH, payload)
    return payload


def add_unique_move_name(move_names: List[Any], move_name: Any) -> None:
    if not move_name:
        return
    normalized = normalize_text(move_name)
    if not normalized:
        return
    if any(normalize_text(existing) == normalized for existing in move_names):
        return
    move_names.append(str(move_name))


def apply_manual_move_overrides(
    move_row: Dict[str, Any],
    pokemon_id: int,
    form: str,
    manual_move_overrides: Mapping[str, Any],
) -> Dict[str, Any]:
    rows = manual_move_overrides.get("overrides", []) if isinstance(manual_move_overrides, Mapping) else []
    if not isinstance(rows, list):
        return move_row

    patched_row = dict(move_row)
    for key in ("fast_moves", "charged_moves", "elite_fast_moves", "elite_charged_moves"):
        patched_row[key] = list(ensure_list(patched_row.get(key)))

    for row in rows:
        if not isinstance(row, Mapping):
            continue
        override_id = safe_int(row.get("pokemonId"))
        if override_id != pokemon_id:
            continue
        override_forms = [normalize_form(item) for item in ensure_list(row.get("forms")) if item]
        override_form = normalize_form(row.get("form"))
        if not override_forms and override_form:
            override_forms = [override_form]
        if override_forms and form not in override_forms:
            continue

        moves = row.get("moves", {}) if isinstance(row.get("moves"), Mapping) else {}
        add_unique_move_name(patched_row["fast_moves"], row.get("addFastMove"))
        add_unique_move_name(patched_row["charged_moves"], row.get("addChargedMove"))
        add_unique_move_name(patched_row["elite_fast_moves"], row.get("addEliteFastMove"))
        add_unique_move_name(patched_row["elite_charged_moves"], row.get("addEliteChargedMove"))
        for move_name in ensure_list(moves.get("fast")):
            add_unique_move_name(patched_row["fast_moves"], move_name)
        for move_name in ensure_list(moves.get("charged")):
            add_unique_move_name(patched_row["charged_moves"], move_name)
        for move_name in ensure_list(moves.get("elite_fast")):
            add_unique_move_name(patched_row["elite_fast_moves"], move_name)
        for move_name in ensure_list(moves.get("elite_charged")):
            add_unique_move_name(patched_row["elite_charged_moves"], move_name)

    return patched_row


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


def normalize_generation(species_payload: Mapping[str, Any]) -> int:
    generation = species_payload.get("generation", {}) if isinstance(species_payload, Mapping) else {}
    generation_name = generation.get("name") if isinstance(generation, Mapping) else None
    if not generation_name:
        return 0
    token = str(generation_name).strip().lower().replace("generation-", "")
    return ROMAN_GENERATION_MAP.get(token, 0)


def load_csv_spawn_hints(path: Path) -> Dict[int, Dict[str, Any]]:
    if not path.exists():
        return {}

    hints: Dict[int, Dict[str, Any]] = {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            pokemon_id = safe_int(row.get("pokemon_id"))
            if pokemon_id is None:
                continue
            hints[pokemon_id] = {
                "rarity": str(row.get("rarity") or "").strip(),
                "found_wild": parse_bool(row.get("found_wild")),
                "found_raid": parse_bool(row.get("found_raid")),
                "found_egg": parse_bool(row.get("found_egg")),
                "found_research": parse_bool(row.get("found_research")),
                "base_capture_rate": safe_float(row.get("base_capture_rate")),
            }
    return hints


def build_name_to_id_index(species_rows: Mapping[int, Dict[str, Any]]) -> Dict[str, int]:
    name_to_id: Dict[str, int] = {}
    for pokemon_id, species in species_rows.items():
        name = normalize_text(species.get("name"))
        if name:
            name_to_id[name] = pokemon_id
    return name_to_id


def ensure_manual_rarity_overrides() -> Dict[str, Any]:
    if MANUAL_RARITY_OVERRIDES_PATH.exists():
        payload = load_json(MANUAL_RARITY_OVERRIDES_PATH)
        if isinstance(payload, dict):
            payload.setdefault("modelVersion", "v1-semantic")
            payload.setdefault("notes", "Manual spawn rarity overrides for baseline non-event modeling.")
            payload.setdefault("regionalPokemonIds", sorted(DEFAULT_REGIONAL_POKEMON_IDS))
            payload.setdefault("overrides", [])
            return payload

    payload = {
        "modelVersion": "v1-semantic",
        "notes": "Manual spawn rarity overrides for baseline non-event modeling.",
        "regionalPokemonIds": sorted(DEFAULT_REGIONAL_POKEMON_IDS),
        "overrides": [],
    }
    save_json(MANUAL_RARITY_OVERRIDES_PATH, payload)
    return payload


def manual_override_map(manual_overrides: Mapping[str, Any]) -> Dict[Tuple[int, str], Dict[str, Any]]:
    rows = manual_overrides.get("overrides", []) if isinstance(manual_overrides, Mapping) else []
    index: Dict[Tuple[int, str], Dict[str, Any]] = {}
    if not isinstance(rows, list):
        return index

    for row in rows:
        if not isinstance(row, Mapping):
            continue
        pokemon_id = safe_int(row.get("pokemonId"))
        if pokemon_id is None:
            continue
        form = normalize_form(row.get("form"))
        index[(pokemon_id, form)] = dict(row)
    return index


def infer_rarity_tier_from_hints(
    hint_row: Mapping[str, Any] | None,
    evolution_stage: Optional[int],
    capture_rate: Optional[float],
) -> str:
    rarity_label = normalize_text(hint_row.get("rarity")) if hint_row else ""
    if "ultra" in rarity_label:
        return "ultra_rare"
    if "super" in rarity_label or "very" in rarity_label:
        return "super_rare"
    if "rare" in rarity_label:
        return "rare"
    if "uncommon" in rarity_label:
        return "uncommon"
    if "common" in rarity_label or "standard" in rarity_label:
        if evolution_stage is not None and evolution_stage >= 3:
            return "rare"
        if evolution_stage is not None and evolution_stage == 2:
            return "uncommon"
        return "common"

    if capture_rate is not None:
        if capture_rate >= 0.35:
            return "common"
        if capture_rate >= 0.2:
            return "uncommon"
        if capture_rate >= 0.1:
            return "rare"
        if capture_rate > 0:
            return "super_rare"

    if evolution_stage is None:
        return "unknown"
    if evolution_stage <= 1:
        return "common"
    if evolution_stage == 2:
        return "uncommon"
    return "rare"


def classify_spawn_entry(
    pokemon_entry: Mapping[str, Any],
    species_row: Mapping[str, Any],
    hint_row: Mapping[str, Any] | None,
    override_row: Mapping[str, Any] | None,
    regional_ids: set[int],
    reviewed_date: str,
) -> Dict[str, Any]:
    pokemon_id = safe_int(pokemon_entry.get("pokemon_id")) or 0
    pokemon_name = str(pokemon_entry.get("name") or "")
    form = normalize_form(pokemon_entry.get("form"))
    evolution = pokemon_entry.get("evolution", {}) if isinstance(pokemon_entry.get("evolution"), Mapping) else {}
    derived = pokemon_entry.get("derived", {}) if isinstance(pokemon_entry.get("derived"), Mapping) else {}
    evolution_stage = safe_int(evolution.get("evolution_stage"))
    released = bool(pokemon_entry.get("released"))
    is_cosmetic_form = bool(derived.get("cosmetic_diff"))

    is_legendary = bool(species_row.get("isLegendary"))
    is_mythical = bool(species_row.get("isMythical"))
    is_ultra_beast = bool(species_row.get("isUltraBeast"))
    is_baby = bool(species_row.get("isBaby"))

    default_wild_availability = "wild"
    default_geo_availability = "global"
    default_rarity_tier = "unknown"
    default_confidence = "low"
    notes: List[str] = ["Estimated baseline rarity; not an official Niantic spawn rate."]
    sources = ["pogoapi/released_pokemon", "pokeapi/species", "local/pokemon.csv"]

    if not released:
        default_wild_availability = "unknown"
        default_geo_availability = "unknown"
        default_rarity_tier = "unknown"
        notes.append("Pokemon/form not marked as released in local PoGoAPI cache.")
    elif is_legendary or is_mythical or is_ultra_beast or is_baby:
        default_wild_availability = "not_wild"
        default_rarity_tier = "not_wild"
        default_confidence = "high"
        notes.append("Classified as not wild from species category (legendary/mythical/ultra beast/baby).")
    elif normalize_text(form) != "normal" and is_cosmetic_form:
        default_wild_availability = "event"
        default_rarity_tier = "event_only"
        default_confidence = "medium"
        notes.append("Cosmetic form treated as event-limited by default in baseline mode.")
    elif pokemon_id in regional_ids:
        default_wild_availability = "regional"
        default_geo_availability = "regional"
        default_rarity_tier = "rare"
        default_confidence = "medium"
        notes.append("Regional baseline: rarity applies only where this spawn pool is available.")
    elif hint_row and hint_row.get("found_wild") is False:
        found_other_channels = any(
            hint_row.get(key) is True for key in ("found_raid", "found_egg", "found_research")
        )
        if found_other_channels:
            default_wild_availability = "not_wild"
            default_rarity_tier = "not_wild"
            default_confidence = "medium"
            notes.append("Marked non-wild in local spawn hints while available through other channels.")
        else:
            default_wild_availability = "unknown"
            default_rarity_tier = "unknown"
            default_confidence = "low"
    else:
        capture_rate = hint_row.get("base_capture_rate") if hint_row else None
        default_rarity_tier = infer_rarity_tier_from_hints(hint_row, evolution_stage, capture_rate)
        if default_rarity_tier in {"common", "uncommon", "rare"}:
            default_confidence = "medium"
        elif default_rarity_tier in {"super_rare", "ultra_rare"}:
            default_confidence = "low"
        if normalize_text(form) != "normal":
            notes.append("Form-level entry may diverge from base species due to GO form behavior.")

    final_wild_availability = str(override_row.get("wildAvailability")) if override_row and override_row.get("wildAvailability") else default_wild_availability
    final_geo_availability = str(override_row.get("geoAvailability")) if override_row and override_row.get("geoAvailability") else default_geo_availability
    final_rarity_tier = str(override_row.get("rarityTier")) if override_row and override_row.get("rarityTier") else default_rarity_tier
    final_confidence = str(override_row.get("confidence")) if override_row and override_row.get("confidence") else default_confidence

    if final_rarity_tier not in RARITY_TIERS:
        final_rarity_tier = default_rarity_tier if default_rarity_tier in RARITY_TIERS else "unknown"

    manual_notes = str(override_row.get("notes")) if override_row and override_row.get("notes") else ""
    manual_sources = override_row.get("sources") if override_row and isinstance(override_row.get("sources"), list) else []
    if manual_notes:
        notes.append(f"Manual override: {manual_notes}")
    if manual_sources:
        sources.extend(str(source) for source in manual_sources if source)
    if override_row:
        sources.append("manual_rarity_overrides")

    dedup_sources = sorted({source for source in sources if source})

    entry: Dict[str, Any] = {
        "pokemonId": pokemon_id,
        "pokemonName": pokemon_name,
        "form": form,
        "wildAvailability": final_wild_availability,
        "geoAvailability": final_geo_availability,
        "rarityTier": final_rarity_tier,
        "confidence": final_confidence,
        "notes": " ".join(notes).strip(),
        "sources": dedup_sources,
        "lastReviewed": reviewed_date,
    }

    return entry


def build_spawn_rarity_outputs(
    merged_payload: Mapping[str, Any],
    species_rows: Mapping[int, Dict[str, Any]],
    evolution_index: Mapping[int, Dict[str, Any]],
) -> None:
    manual_overrides = ensure_manual_rarity_overrides()
    override_index = manual_override_map(manual_overrides)
    csv_hints = load_csv_spawn_hints(POKEMON_CSV_PATH)
    reviewed_date = to_iso_date()

    regional_ids = set(DEFAULT_REGIONAL_POKEMON_IDS)
    regional_ids.update(
        safe_int(value)
        for value in ensure_list(manual_overrides.get("regionalPokemonIds"))
        if safe_int(value) is not None
    )

    merged_pokemon = merged_payload.get("pokemon", []) if isinstance(merged_payload, Mapping) else []
    if not isinstance(merged_pokemon, list):
        merged_pokemon = []

    forms_by_id: Dict[int, List[str]] = {}
    types_by_id: Dict[int, List[str]] = {}
    names_by_id: Dict[int, str] = {}
    for row in merged_pokemon:
        if not isinstance(row, Mapping):
            continue
        pokemon_id = safe_int(row.get("pokemon_id"))
        if pokemon_id is None:
            continue
        form = normalize_form(row.get("form"))
        forms_by_id.setdefault(pokemon_id, [])
        if form not in forms_by_id[pokemon_id]:
            forms_by_id[pokemon_id].append(form)
        row_types = [normalize_type(item) for item in ensure_list(row.get("types")) if item]
        if row_types and pokemon_id not in types_by_id:
            types_by_id[pokemon_id] = row_types
        if pokemon_id not in names_by_id:
            names_by_id[pokemon_id] = str(row.get("name") or "")

    name_to_id = build_name_to_id_index(species_rows)
    pokemon_species_rows: List[Dict[str, Any]] = []
    for pokemon_id in sorted(forms_by_id.keys()):
        species_payload = species_rows.get(pokemon_id, {})
        species_name = str(species_payload.get("name") or names_by_id.get(pokemon_id) or "")
        evolution_meta = evolution_index.get(pokemon_id, {})
        family_root_name = normalize_text(evolution_meta.get("family_root"))
        family_id = name_to_id.get(family_root_name) if family_root_name else None
        pokemon_species_rows.append(
            {
                "pokemonId": pokemon_id,
                "name": species_name.title() if species_name else names_by_id.get(pokemon_id, ""),
                "types": types_by_id.get(pokemon_id, []),
                "generation": normalize_generation(species_payload),
                "familyId": family_id,
                "forms": sorted(forms_by_id.get(pokemon_id, [])),
                "isLegendary": bool(species_payload.get("is_legendary")),
                "isMythical": bool(species_payload.get("is_mythical")),
                "isUltraBeast": pokemon_id in ULTRA_BEAST_IDS,
                "isRegional": pokemon_id in regional_ids,
                "isBaby": bool(species_payload.get("is_baby")),
            }
        )

    species_by_id = {row["pokemonId"]: row for row in pokemon_species_rows}

    spawn_rows: List[Dict[str, Any]] = []
    for row in merged_pokemon:
        if not isinstance(row, Mapping):
            continue
        pokemon_id = safe_int(row.get("pokemon_id"))
        if pokemon_id is None:
            continue
        form = normalize_form(row.get("form"))
        override = override_index.get((pokemon_id, form)) or override_index.get((pokemon_id, "Normal"))
        species_row = species_by_id.get(pokemon_id, {})
        hint_row = csv_hints.get(pokemon_id)
        spawn_rows.append(
            classify_spawn_entry(
                pokemon_entry=row,
                species_row=species_row,
                hint_row=hint_row,
                override_row=override,
                regional_ids=regional_ids,
                reviewed_date=reviewed_date,
            )
        )

    spawn_rows.sort(key=lambda item: (item["pokemonId"], item.get("form", "")))

    source_payload = {
        "modelVersion": "v1-semantic",
        "generatedAtUtc": to_iso_datetime(),
        "disclaimer": "Estimated relative rarity only. Niantic does not publish official per-species wild spawn probabilities.",
        "baselineMode": "non_event_static",
        "sources": [
            {
                "id": "pokeminers_gm",
                "description": "Primary species stats/types/move pools from PokeMiners Game Master.",
                "paths": [
                    "data/raw/pokeminers/latest.json",
                ],
                "confidence": "high",
            },
            {
                "id": "pogoapi_supporting",
                "description": "Supporting released roster and type-effectiveness tables.",
                "paths": [
                    "data/raw/pogoapi/released_pokemon.json",
                    "data/raw/pogoapi/type_effectiveness.json",
                ],
                "confidence": "medium",
            },
            {
                "id": "pokeapi_species",
                "description": "Species flags (legendary/mythical/baby) and generation context.",
                "paths": ["data/raw/pokeapi/species/*.json"],
                "confidence": "high",
            },
            {
                "id": "local_spawn_hints",
                "description": "Legacy local hints for wild/raid/research/egg availability and rarity labels.",
                "paths": ["data/pokemon.csv"],
                "confidence": "low",
            },
            {
                "id": "manual_overrides",
                "description": "Project-owned manual corrections for regionals and exceptional cases.",
                "paths": ["data/manual_rarity_overrides.json"],
                "confidence": "high",
            },
        ],
    }

    save_json(POKEMON_SPECIES_PATH, pokemon_species_rows)
    save_json(SPAWN_RARITY_PATH, spawn_rows)
    save_json(RARITY_SOURCES_PATH, source_payload)


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

    pokeminers_templates = load_pokeminers_templates()
    (
        stats_rows,
        types_rows,
        current_moves_rows,
        fast_moves_rows,
        charged_moves_rows,
        pvp_fast_moves_rows,
        pvp_charged_moves_rows,
    ) = build_rows_from_pokeminers(pokeminers_templates)
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
    manual_move_overrides = ensure_manual_move_overrides()
    artwork_index = load_artwork_index()
    form_rows: List[Tuple[str, str]] = []
    for (pokemon_id, form), stat_row in stats_index.items():
        if normalize_identifier(form) == "normal":
            continue
        type_row = types_index.get((pokemon_id, form), {})
        name = str(first_present(stat_row.get("pokemon_name"), type_row.get("pokemon_name"), stat_row.get("name")) or "")
        if name:
            form_rows.append((name, form))
    fetch_pokeapi_form_artwork_data(form_rows)
    form_artwork_index = load_form_artwork_index()

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
        move_row = apply_manual_move_overrides(
            current_moves_index.get(key, {}),
            pokemon_id,
            form,
            manual_move_overrides,
        )

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

        name = first_present(
            stat_row.get("pokemon_name"),
            type_row.get("pokemon_name"),
            move_row.get("pokemon_name"),
            stat_row.get("name"),
            type_row.get("name"),
            move_row.get("name"),
            released_index.get(pokemon_id, {}).get("pokemon_name"),
            released_index.get(pokemon_id, {}).get("name"),
        )
        artwork = artwork_index.get(pokemon_id) or {
            "official_artwork": None,
            "home": None,
            "sprite": None,
        }
        for slug in form_artwork_slug_candidates(str(name or ""), form):
            candidate = form_artwork_index.get(slug)
            if candidate and any(candidate.get(key) for key in ("official_artwork", "home", "sprite")):
                artwork = candidate
                break

        merged_pokemon.append(
            {
                "pokemon_id": pokemon_id,
                "dex": pokemon_id,
                "name": name,
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
                "artwork": artwork,
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
    fetch_pokeminers_file()
    cleanup_legacy_pogoapi_files()

    released_rows = as_dict_rows(load_json(POGOAPI_DIR / "released_pokemon.json"))
    fetch_pokeapi_artwork_data(released_rows)

    merged = merge_data()
    save_json(PROCESSED_DIR / "merged_pogo_data.json", merged)
    species_rows = load_species_index()
    evolution_chains = load_evolution_chain_index()
    evolution_index = build_species_evolution_index(species_rows, evolution_chains)
    build_spawn_rarity_outputs(merged, species_rows, evolution_index)
    print(f"Saved merged data to {PROCESSED_DIR / 'merged_pogo_data.json'}")
    print(f"Saved species data to {POKEMON_SPECIES_PATH}")
    print(f"Saved spawn rarity data to {SPAWN_RARITY_PATH}")


if __name__ == "__main__":
    main()
