from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Mapping, Sequence

import streamlit as st

BASE_DIR = Path(__file__).resolve().parents[1]
MERGED_PATH = BASE_DIR / "data" / "processed" / "merged_pogo_data.json"


@st.cache_data(show_spinner=False)
def load_merged_data() -> Dict[str, Any]:
    if not MERGED_PATH.exists():
        return {}
    with MERGED_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_query(value: str) -> str:
    return value.strip().lower()


def pokemon_label(pokemon: Mapping[str, Any]) -> str:
    return f"#{pokemon.get('dex')} {pokemon.get('name')} ({pokemon.get('form')})"


def type_multiplier(
    attack_type: str | None,
    defender_types: Sequence[str],
    type_effectiveness: Mapping[str, Mapping[str, float]],
) -> float:
    if not attack_type:
        return 1.0
    multiplier = 1.0
    attack_key = attack_type.title()
    for defender_type in defender_types:
        multiplier *= type_effectiveness.get(attack_key, {}).get(defender_type.title(), 1.0)
    return round(multiplier, 4)


def pokemon_best_moves(
    pokemon: Mapping[str, Any],
    defender_types: Sequence[str],
    type_effectiveness: Mapping[str, Mapping[str, float]],
) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    for move_group in ("fast", "charged", "elite_fast", "elite_charged"):
        for move in pokemon.get("moves", {}).get(move_group, []):
            raw_dps = move.get("raw_dps")
            if raw_dps is None:
                continue
            multiplier = type_multiplier(move.get("type"), defender_types, type_effectiveness)
            stab = move.get("stab_multiplier", 1.0)
            candidates.append(
                {
                    "name": move.get("name"),
                    "move_kind": move_group,
                    "type": move.get("type"),
                    "power": move.get("power"),
                    "duration": move.get("duration"),
                    "raw_dps": raw_dps,
                    "stab_multiplier": stab,
                    "type_multiplier": multiplier,
                    "effective_dps": round(raw_dps * stab * multiplier, 3),
                }
            )
    candidates.sort(key=lambda item: (item["effective_dps"] is None, -(item["effective_dps"] or 0.0)))
    return candidates


def best_move_summary(
    pokemon: Mapping[str, Any],
    defender_types: Sequence[str],
    type_effectiveness: Mapping[str, Mapping[str, float]],
) -> Dict[str, Any]:
    moves = pokemon_best_moves(pokemon, defender_types, type_effectiveness)
    best_move = moves[0] if moves else {}
    return {
        "best_move": best_move,
        "best_dps": best_move.get("effective_dps"),
        "moves": moves,
    }


def render_stat_card(label: str, value: Any) -> None:
    st.metric(label, value if value is not None else "n/a")


def render_pokemon_panel(
    pokemon: Mapping[str, Any],
    opponent: Mapping[str, Any] | None,
    type_effectiveness: Mapping[str, Mapping[str, float]],
) -> None:
    cols = st.columns([1, 2])
    with cols[0]:
        artwork = pokemon.get("artwork", {})
        artwork_url = artwork.get("official_artwork") or artwork.get("home") or artwork.get("sprite")
        if artwork_url:
            st.image(artwork_url, use_container_width=True)
        else:
            st.info("No artwork cached yet.")

    with cols[1]:
        st.subheader(pokemon_label(pokemon))
        st.caption(" / ".join(pokemon.get("types", [])) or "Unknown type")
        stat_cols = st.columns(3)
        with stat_cols[0]:
            render_stat_card("Attack", pokemon.get("base_stats", {}).get("attack"))
        with stat_cols[1]:
            render_stat_card("Defense", pokemon.get("base_stats", {}).get("defense"))
        with stat_cols[2]:
            render_stat_card("Stamina", pokemon.get("base_stats", {}).get("stamina"))

        if opponent:
            opponent_types = opponent.get("types", [])
            best_vs = best_move_summary(pokemon, opponent_types, type_effectiveness)
            best_move = best_vs["best_move"]
            if best_move:
                st.success(
                    f"Best move into {opponent.get('name')}: {best_move.get('name')} "
                    f"({best_move.get('effective_dps')})"
                )


def render_move_table(
    pokemon: Mapping[str, Any],
    opponent: Mapping[str, Any] | None,
    type_effectiveness: Mapping[str, Mapping[str, float]],
) -> None:
    defender_types = opponent.get("types", []) if opponent else []
    rows = pokemon_best_moves(pokemon, defender_types, type_effectiveness)
    if not rows:
        st.info("No move data available.")
        return
    st.dataframe(rows, use_container_width=True, hide_index=True)


def render_team_compilation(
    pokemon_rows: Sequence[Mapping[str, Any]],
    target_types: Sequence[str],
    type_effectiveness: Mapping[str, Mapping[str, float]],
) -> None:
    scored: List[Dict[str, Any]] = []
    for pokemon in pokemon_rows:
        best = best_move_summary(pokemon, target_types, type_effectiveness)
        if best["best_dps"] is None:
            continue
        scored.append(
            {
                "pokemon": pokemon_label(pokemon),
                "types": " / ".join(pokemon.get("types", [])),
                "best_move": best["best_move"].get("name"),
                "move_kind": best["best_move"].get("move_kind"),
                "effective_dps": best["best_dps"],
            }
        )
    scored.sort(key=lambda item: item["effective_dps"], reverse=True)
    st.dataframe(scored[:15], use_container_width=True, hide_index=True)


def main() -> None:
    st.set_page_config(page_title="Pokemon GO Explorer", layout="wide")
    st.title("Pokemon GO Explorer")
    st.caption("Search the Pokedex, compare two Pokemon, and rank moves by raid DPS.")

    data = load_merged_data()
    pokemon_rows = data.get("pokemon", [])
    type_effectiveness = data.get("type_effectiveness", {})

    if not pokemon_rows:
        st.warning(
            "No merged data found yet. Run `python scripts/fetch_data.py` first to cache the source files and build the merged dataset."
        )
        return

    all_types = sorted({pokemon_type for row in pokemon_rows for pokemon_type in row.get("types", [])})

    with st.sidebar:
        st.header("Filters")
        search = st.text_input("Search name", placeholder="Bulbasaur")
        selected_types = st.multiselect("Filter by type", all_types)
        compare_type = st.selectbox("Team target type", [""] + all_types, index=0)

    filtered_rows = list(pokemon_rows)
    if search.strip():
        query = normalize_query(search)
        filtered_rows = [
            row
            for row in filtered_rows
            if query in normalize_query(str(row.get("name", "")))
            or query in normalize_query(str(row.get("form", "")))
        ]
    if selected_types:
        filtered_rows = [
            row
            for row in filtered_rows
            if all(selected_type in row.get("types", []) for selected_type in selected_types)
        ]

    st.subheader("Pokedex")
    st.write(f"{len(filtered_rows)} matching Pokemon")
    st.dataframe(
        [
            {
                "dex": row.get("dex"),
                "name": row.get("name"),
                "form": row.get("form"),
                "types": " / ".join(row.get("types", [])),
                "attack": row.get("base_stats", {}).get("attack"),
                "defense": row.get("base_stats", {}).get("defense"),
                "stamina": row.get("base_stats", {}).get("stamina"),
            }
            for row in filtered_rows
        ],
        use_container_width=True,
        hide_index=True,
    )

    if not filtered_rows:
        st.stop()

    compare_labels = [pokemon_label(row) for row in filtered_rows]
    col_left, col_right = st.columns(2)
    with col_left:
        first_choice = st.selectbox("First Pokemon", compare_labels, index=0)
    with col_right:
        second_choice = st.selectbox("Second Pokemon", compare_labels, index=min(1, len(compare_labels) - 1))

    label_to_row = {pokemon_label(row): row for row in filtered_rows}
    first_pokemon = label_to_row[first_choice]
    second_pokemon = label_to_row[second_choice]

    st.subheader("Side-by-side compare")
    left, right = st.columns(2)
    with left:
        render_pokemon_panel(first_pokemon, second_pokemon, type_effectiveness)
        st.markdown("**Moves into the selected opponent**")
        render_move_table(first_pokemon, second_pokemon, type_effectiveness)
    with right:
        render_pokemon_panel(second_pokemon, first_pokemon, type_effectiveness)
        st.markdown("**Moves into the selected opponent**")
        render_move_table(second_pokemon, first_pokemon, type_effectiveness)

    if compare_type:
        st.subheader(f"Best raid attackers into {compare_type}")
        render_team_compilation(pokemon_rows, [compare_type], type_effectiveness)


if __name__ == "__main__":
    main()
