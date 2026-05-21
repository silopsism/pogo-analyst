from __future__ import annotations

import json
import re
import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import requests

BASE_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = BASE_DIR / "data" / "raw" / "pvp_meta"
PROCESSED_DIR = BASE_DIR / "data" / "processed"

LEAGUE_CONFIG = {
    "great": {
        "label": "Great League",
        "cp": 1500,
        "page_url": "https://pvpoke.com/rankings/all/1500/overall/",
        "output_file": "pvpoke_great_league_rankings.json",
    },
    "ultra": {
        "label": "Ultra League",
        "cp": 2500,
        "page_url": "https://pvpoke.com/rankings/all/2500/overall/",
        "output_file": "pvpoke_ultra_league_rankings.json",
    },
    "master": {
        "label": "Master League",
        "cp": 10000,
        "page_url": "https://pvpoke.com/rankings/all/10000/overall/",
        "output_file": "pvpoke_master_league_rankings.json",
    },
}

REQUEST_HEADERS = {
    "User-Agent": "pokemon-go-explorer/1.0",
    "Accept": "text/html,application/json",
}


def ensure_directories() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def fetch_text(url: str) -> str:
    response = requests.get(url, headers=REQUEST_HEADERS, timeout=60)
    response.raise_for_status()
    return response.text


def fetch_json(url: str) -> Any:
    response = requests.get(url, headers=REQUEST_HEADERS, timeout=60)
    response.raise_for_status()
    return response.json()


def normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def normalize_identifier(value: Any) -> str:
    cleaned = re.sub(r"[’']", "", normalize_text(value))
    normalized = re.sub(r"[^a-z0-9]+", "_", cleaned)
    normalized = re.sub(r"_+", "_", normalized)
    return normalized.strip("_")


def normalize_form(value: Any) -> str:
    return str(value or "Normal").strip() or "Normal"


def normalize_pvpoke_species_for_lookup(species_id: str) -> str:
    value = normalize_identifier(species_id)
    if value.endswith("_shadow"):
        value = value[: -len("_shadow")]
    if value.endswith("_b"):
        value = value[: -len("_b")]
    return value


def compact_move_id(move_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "", move_id.upper())


def extract_site_version(html: str) -> str:
    match = re.search(r"/js/RankingMain\.js\?v=([0-9.]+)", html)
    if match:
        return match.group(1)
    return "latest"


def move_name_to_id(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", value.upper())
    normalized = re.sub(r"_+", "_", normalized)
    return normalized.strip("_")


def score_value(scores: Sequence[Any], index: int) -> Optional[float]:
    if index >= len(scores):
        return None
    value = scores[index]
    if not isinstance(value, (int, float)):
        return None
    return round(float(value), 3)


def move_uses(move_rows: Any) -> List[Dict[str, Any]]:
    if not isinstance(move_rows, list):
        return []
    ranked = sorted(
        [
            {
                "move_id": str(row.get("moveId") or ""),
                "uses": int(row.get("uses") or 0),
            }
            for row in move_rows
            if isinstance(row, Mapping) and str(row.get("moveId") or "").strip()
        ],
        key=lambda item: item["uses"],
        reverse=True,
    )
    return ranked


def build_merged_indexes() -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    merged_path = PROCESSED_DIR / "merged_pogo_data.json"
    if not merged_path.exists():
        return {}, {}

    payload = load_json(merged_path)
    pokemon_rows = payload.get("pokemon", []) if isinstance(payload, dict) else []
    if not isinstance(pokemon_rows, list):
        return {}, {}

    by_species_id: Dict[str, Dict[str, Any]] = {}
    move_pool_by_species_id: Dict[str, Dict[str, Any]] = {}

    def move_count(pool: Mapping[str, Any]) -> int:
        normal = pool.get("normal_move_ids") if isinstance(pool.get("normal_move_ids"), list) else []
        elite = pool.get("elite_move_ids") if isinstance(pool.get("elite_move_ids"), list) else []
        return len(normal) + len(elite)

    for row in pokemon_rows:
        if not isinstance(row, dict):
            continue
        name = normalize_identifier(row.get("name"))
        form = normalize_form(row.get("form"))
        if not name:
            continue

        ids: set[str] = set()
        if form == "Normal":
            ids.add(name)
        if form != "Normal":
            form_id = normalize_identifier(form)
            if form_id == "alola":
                form_id = "alolan"
            if form_id == "pom_pom":
                form_id = "pompom"
            ids.add(f"{name}_{form_id}")

        moves = row.get("moves", {}) if isinstance(row.get("moves"), dict) else {}
        normal_move_rows = [
            *[move for move in moves.get("fast", []) if isinstance(move, dict)],
            *[move for move in moves.get("charged", []) if isinstance(move, dict)],
        ]
        elite_move_rows = [
            *[move for move in moves.get("elite_fast", []) if isinstance(move, dict)],
            *[move for move in moves.get("elite_charged", []) if isinstance(move, dict)],
        ]

        normal_move_ids = {
            move_name_to_id(str(move.get("name") or ""))
            for move in normal_move_rows
            if str(move.get("name") or "").strip()
        }
        elite_move_ids = {
            move_name_to_id(str(move.get("name") or ""))
            for move in elite_move_rows
            if str(move.get("name") or "").strip()
        }
        normal_move_ids.discard("")
        elite_move_ids.discard("")

        candidate_pool = {
            "normal_move_ids": sorted(normal_move_ids),
            "elite_move_ids": sorted(elite_move_ids),
            "normal_move_ids_compact": sorted({compact_move_id(move_id) for move_id in normal_move_ids}),
            "elite_move_ids_compact": sorted({compact_move_id(move_id) for move_id in elite_move_ids}),
        }

        for species_id in ids:
            existing_pool = move_pool_by_species_id.get(species_id)
            if existing_pool and move_count(existing_pool) > move_count(candidate_pool):
                continue
            by_species_id[species_id] = row
            move_pool_by_species_id[species_id] = candidate_pool

    return by_species_id, move_pool_by_species_id


def species_lookup_candidates(species_id: str) -> List[str]:
    base = normalize_identifier(species_id)
    if not base:
        return []
    aliases = {
        "tauros_aqua": "tauros_paldea_aqua",
        "tauros_blaze": "tauros_paldea_blaze",
        "tauros_combat": "tauros_paldea_combat",
        "oricorio_pom_pom": "oricorio_pompom",
        "zygarde_10": "zygarde_ten_percent",
        "golisopodsh": "golisopod",
    }
    candidates = [base]
    if base in aliases:
        candidates.append(aliases[base])
    if base.endswith("_shadow"):
        candidates.append(base[: -len("_shadow")])
    if base.endswith("_b"):
        candidates.append(base[: -len("_b")])
    if base.endswith("_blade"):
        candidates.append(base.replace("_blade", "_shield"))
    if base.endswith("_shield"):
        candidates.append(base.replace("_shield", "_blade"))
    deduped: List[str] = []
    for candidate in candidates:
        if candidate and candidate not in deduped:
            deduped.append(candidate)
    return deduped


def resolve_lookup_species_id(species_id: str, merged_index: Mapping[str, Any]) -> str:
    candidates = species_lookup_candidates(species_id)
    for candidate in candidates:
        if candidate in merged_index:
            return candidate
    return normalize_pvpoke_species_for_lookup(species_id)


def compute_type_matchup_labels(
    pokemon_types: Sequence[str],
    type_effectiveness: Mapping[str, Mapping[str, Any]],
) -> Tuple[List[str], List[str]]:
    if not pokemon_types or not isinstance(type_effectiveness, Mapping):
        return [], []

    scored: List[Tuple[str, float]] = []
    for attack_type, defender_map in type_effectiveness.items():
        if not isinstance(defender_map, Mapping):
            continue
        multiplier = 1.0
        for defender_type in pokemon_types:
            raw = defender_map.get(defender_type)
            if isinstance(raw, (int, float)):
                multiplier *= float(raw)
        scored.append((str(attack_type), round(multiplier, 4)))

    weaknesses = [name for name, mult in sorted(scored, key=lambda item: item[1], reverse=True) if mult > 1.0001]
    resistances = [name for name, mult in sorted(scored, key=lambda item: item[1]) if mult < 0.9999]
    return weaknesses, resistances


def derive_traits(scores: Dict[str, Optional[float]], stats: Dict[str, Optional[float]]) -> List[str]:
    traits: List[str] = []

    role_candidates = [
        ("Lead", scores.get("leads")),
        ("Closer", scores.get("closers")),
        ("Switch", scores.get("switches")),
        ("Charger", scores.get("chargers")),
        ("Attacker", scores.get("attackers")),
    ]
    valid_roles = [(label, value) for label, value in role_candidates if isinstance(value, (int, float))]
    if valid_roles:
        best_role = max(valid_roles, key=lambda item: float(item[1]))
        traits.append(best_role[0])

    consistency = scores.get("consistency")
    if isinstance(consistency, (int, float)) and consistency >= 80:
        traits.append("Consistent")

    defense = stats.get("def")
    stamina = stats.get("hp")
    if isinstance(defense, (int, float)) and isinstance(stamina, (int, float)) and defense >= 110 and stamina >= 145:
        traits.append("Bulky")

    attack = stats.get("atk")
    if isinstance(attack, (int, float)) and attack >= 120:
        traits.append("High Attack")

    overall = scores.get("overall")
    if isinstance(overall, (int, float)) and overall >= 90:
        traits.append("Top Meta")

    deduped: List[str] = []
    for trait in traits:
        if trait not in deduped:
            deduped.append(trait)
    return deduped


def build_pvpoke_output(league: str) -> Dict[str, Any]:
    ensure_directories()
    league_key = league if league in LEAGUE_CONFIG else "great"
    config = LEAGUE_CONFIG[league_key]
    page_url = config["page_url"]
    cp = int(config["cp"])

    pvpoke_page_html = fetch_text(page_url)
    save_text(RAW_DIR / f"pvpoke_rankings_all_{cp}_overall.html", pvpoke_page_html)
    pvpoke_version = extract_site_version(pvpoke_page_html)
    pvpoke_json_url = (
        f"https://pvpoke.com/data/rankings/all/overall/rankings-{cp}.json?v={pvpoke_version}"
    )
    pvpoke_rows = fetch_json(pvpoke_json_url)
    save_json(RAW_DIR / f"pvpoke_rankings_all_{cp}_overall.json", pvpoke_rows)

    merged_index, merged_move_pool_index = build_merged_indexes()

    merged_payload = load_json(PROCESSED_DIR / "merged_pogo_data.json")
    type_effectiveness = merged_payload.get("type_effectiveness", {}) if isinstance(merged_payload, dict) else {}
    global_move_ids: set[str] = set()
    global_move_ids_compact: set[str] = set()
    if isinstance(merged_payload, dict):
        for move_bucket in ("fast_moves", "charged_moves", "pvp_fast_moves", "pvp_charged_moves"):
            payload = merged_payload.get(move_bucket)
            if not isinstance(payload, Mapping):
                continue
            for move_entry in payload.values():
                if not isinstance(move_entry, Mapping):
                    continue
                name = str(move_entry.get("name") or "").strip()
                if not name:
                    continue
                move_id = move_name_to_id(name)
                if move_id:
                    global_move_ids.add(move_id)
                    global_move_ids_compact.add(compact_move_id(move_id))

    rankings: List[Dict[str, Any]] = []
    unresolved_rows = 0
    elite_rows = 0
    for rank, item in enumerate(pvpoke_rows, start=1):
        if not isinstance(item, Mapping):
            continue

        species_id = str(item.get("speciesId") or "").strip()
        species_name = str(item.get("speciesName") or "").strip() or species_id
        lookup_species_id = resolve_lookup_species_id(species_id, merged_index)

        moveset = [str(move) for move in (item.get("moveset") or []) if str(move or "").strip()]
        moves_payload = item.get("moves") if isinstance(item.get("moves"), Mapping) else {}
        fast_moves = move_uses(moves_payload.get("fastMoves"))
        charged_moves = move_uses(moves_payload.get("chargedMoves"))

        move_pool = merged_move_pool_index.get(
            lookup_species_id,
            {
                "normal_move_ids": [],
                "elite_move_ids": [],
                "normal_move_ids_compact": [],
                "elite_move_ids_compact": [],
            },
        )
        normal_move_ids = set(move_pool.get("normal_move_ids") or [])
        elite_move_ids = set(move_pool.get("elite_move_ids") or [])
        normal_move_ids_compact = set(move_pool.get("normal_move_ids_compact") or [])
        elite_move_ids_compact = set(move_pool.get("elite_move_ids_compact") or [])
        move_statuses: List[str] = []
        elite_flags: List[bool] = []
        unresolved_flags: List[bool] = []
        for move_id in moveset:
            compact_id = compact_move_id(move_id)
            in_normal = move_id in normal_move_ids or compact_id in normal_move_ids_compact
            in_elite = move_id in elite_move_ids or compact_id in elite_move_ids_compact
            in_global = move_id in global_move_ids or compact_id in global_move_ids_compact
            if in_normal:
                status = "standard"
            elif in_elite:
                status = "elite"
            elif in_global:
                status = "missing_on_species"
            else:
                status = "missing_globally"
            move_statuses.append(status)
            elite_flags.append(status == "elite")
            unresolved_flags.append(status in {"missing_on_species", "missing_globally"})
        has_unresolved = any(unresolved_flags)
        requires_elite = any(elite_flags)
        if has_unresolved:
            unresolved_rows += 1
        if requires_elite:
            elite_rows += 1

        local_pokemon = merged_index.get(lookup_species_id, {}) if isinstance(merged_index.get(lookup_species_id), dict) else {}
        pokemon_types = [
            str(type_name)
            for type_name in (local_pokemon.get("types") or [])
            if str(type_name or "").strip()
        ]
        weaknesses, resistances = compute_type_matchup_labels(pokemon_types, type_effectiveness)

        scores_payload = item.get("scores")
        scores_list = scores_payload if isinstance(scores_payload, list) else []
        score_map = {
            "overall": score_value(scores_list, 0),
            "leads": score_value(scores_list, 1),
            "closers": score_value(scores_list, 2),
            "switches": score_value(scores_list, 3),
            "chargers": score_value(scores_list, 4),
            "attackers": score_value(scores_list, 5),
            "consistency": score_value(scores_list, 6),
            "attack": score_value(scores_list, 7),
            "defense": score_value(scores_list, 8),
            "stamina": score_value(scores_list, 9),
        }

        stats_payload = item.get("stats") if isinstance(item.get("stats"), Mapping) else {}
        stats_map = {
            "atk": float(stats_payload.get("atk")) if isinstance(stats_payload.get("atk"), (int, float)) else None,
            "def": float(stats_payload.get("def")) if isinstance(stats_payload.get("def"), (int, float)) else None,
            "hp": float(stats_payload.get("hp")) if isinstance(stats_payload.get("hp"), (int, float)) else None,
        }

        rankings.append(
            {
                "canonical_id": species_id,
                "local_lookup_species_id": lookup_species_id,
                "local_lookup_found": lookup_species_id in merged_index,
                "name": species_name,
                "pvpoke": {
                    "rank": rank,
                    "score": float(item.get("score")) if isinstance(item.get("score"), (int, float)) else 0.0,
                    "rating": int(item.get("rating")) if isinstance(item.get("rating"), (int, float)) else None,
                    "species_id": species_id,
                    "species_name": species_name,
                    "moveset": moveset,
                    "moves": {
                        "fast": fast_moves,
                        "charged": charged_moves,
                    },
                    "traits": derive_traits(score_map, stats_map),
                    "weaknesses": weaknesses,
                    "resistances": resistances,
                    "requires_elite_for_recommended_moveset": requires_elite,
                    "recommended_move_elite_flags": elite_flags,
                    "recommended_move_statuses": move_statuses,
                    "has_unresolved_recommended_moveset": has_unresolved,
                    "recommended_move_unresolved_flags": unresolved_flags,
                    "scores": score_map,
                },
            }
        )

    return {
        "meta": {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "league": config["label"],
            "source": page_url,
            "sources": {
                "pvpoke_rankings_page": page_url,
                "pvpoke_rankings_json": pvpoke_json_url,
            },
            "counts": {
                "pvpoke_total": len(rankings),
                "requires_elite_total": elite_rows,
                "unresolved_recommended_moveset_total": unresolved_rows,
            },
            "notes": [
                "Rank and score values are copied directly from PvPoke rankings JSON.",
                "Elite move requirements are inferred by matching PvPoke moveset IDs against local normal and elite move pools.",
                "Unresolved moveset flags indicate PvPoke recommended moves absent from local species move pools.",
                "Weaknesses and resistances are computed from local Pokemon GO type effectiveness data.",
            ],
        },
        "pvpoke_rankings": rankings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch PvPoke rankings and merge with local move/type metadata.")
    parser.add_argument(
        "--league",
        choices=list(LEAGUE_CONFIG.keys()),
        default="great",
        help="League to fetch (great, ultra, master).",
    )
    args = parser.parse_args()
    league = str(args.league or "great")
    config = LEAGUE_CONFIG[league]

    payload = build_pvpoke_output(league)
    output_path = PROCESSED_DIR / str(config["output_file"])
    save_json(output_path, payload)
    print(f"Saved PvPoke {config['label']} data to {output_path}")

    top_rows = payload.get("pvpoke_rankings", [])[:20]
    for row in top_rows:
        pvpoke = row.get("pvpoke", {}) if isinstance(row.get("pvpoke"), dict) else {}
        print(
            f"{pvpoke.get('rank', 0):>3}. {row.get('name')} "
            f"[score={pvpoke.get('score')}]"
        )
    counts = payload.get("meta", {}).get("counts", {})
    print(
        "Validation:"
        f" total={counts.get('pvpoke_total', 0)}"
        f" elite_required={counts.get('requires_elite_total', 0)}"
        f" unresolved={counts.get('unresolved_recommended_moveset_total', 0)}"
    )


if __name__ == "__main__":
    main()
