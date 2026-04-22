import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { allTypes, formatNumber, loadMergedData, normalizeQuery } from "./data.ts";
import { evolutionFamilyMembers, finalEvolutionOptions, lookupPokemon, pokemonKey, resolvePrimaryFinalEvolution } from "./evolution.ts";
import {
  computeRaidAttackers,
  raidMoveKey,
  raidMoveLabel,
  raidMovePools,
  RAID_REPLACEMENT_DELAY_SECONDS,
  type RaidBossAssumption,
  type RaidAttackerRow,
  type RaidSimulationMode,
  type RaidSortMode,
} from "./raid.ts";
import {
  filterRaidBosses,
  groupRaidBosses,
  RAID_BOSS_SOURCE_OPTIONS,
  resolveRaidBoss,
  type RaidBossSourceFilter,
} from "./raid_bosses.ts";
import { matchupBonusPercent, percentOfBest, scorePokemon, WEATHER_OPTIONS } from "./scoring.ts";
import type { WeatherName } from "./scoring.ts";
import type { MergedData, PokemonEntry } from "./types.ts";

type ViewState = {
  data: MergedData | null;
  error: string | null;
  loading: boolean;
};

type Mode = "lookup" | "raid";

const LIMITED_POKEMON = new Set(["eternatus", "zygarde", "cosmog", "poipole", "kubfu"]);

const POKEMON_REGIONS: Array<{ maxDex: number; region: string; generation: number }> = [
  { maxDex: 151, region: "Kanto", generation: 1 },
  { maxDex: 251, region: "Johto", generation: 2 },
  { maxDex: 386, region: "Hoenn", generation: 3 },
  { maxDex: 493, region: "Sinnoh", generation: 4 },
  { maxDex: 649, region: "Unova", generation: 5 },
  { maxDex: 721, region: "Kalos", generation: 6 },
  { maxDex: 809, region: "Alola", generation: 7 },
  { maxDex: 905, region: "Galar", generation: 8 },
  { maxDex: 1025, region: "Paldea", generation: 9 },
];

const TYPE_COLORS: Record<string, string> = {
  Normal: "#A8A77A",
  Fire: "#EE8130",
  Water: "#6390F0",
  Electric: "#F7D02C",
  Grass: "#7AC74C",
  Ice: "#96D9D6",
  Fighting: "#C22E28",
  Poison: "#A33EA1",
  Ground: "#E2BF65",
  Flying: "#A98FF3",
  Psychic: "#F95587",
  Bug: "#A6B91A",
  Rock: "#B6A136",
  Ghost: "#735797",
  Dragon: "#6F35FC",
  Dark: "#705746",
  Steel: "#B7B7CE",
  Fairy: "#D685AD",
};

const TYPE_SYMBOLS: Record<string, string> = {
  Normal: "\u25EF",
  Fire: "\uD83D\uDD25",
  Water: "\uD83D\uDCA7",
  Electric: "\u26A1",
  Grass: "\uD83C\uDF3F",
  Ice: "\u2744",
  Fighting: "\u270A",
  Poison: "\u2620",
  Ground: "\u26F0",
  Flying: "\uD83E\uDEBD",
  Psychic: "\uD83D\uDD2E",
  Bug: "\uD83D\uDC1E",
  Rock: "\uD83E\uDEA8",
  Ghost: "\uD83D\uDC7B",
  Dragon: "\uD83D\uDC09",
  Dark: "\uD83C\uDF11",
  Steel: "\u2699",
  Fairy: "\u2728",
};

function contrastText(hex: string): string {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? "#10131a" : "#f8fbff";
}

function typeStyle(type: string | null | undefined): CSSProperties {
  const color = type ? TYPE_COLORS[type] ?? "#61708c" : "#61708c";
  return {
    backgroundColor: color,
    borderColor: color,
    color: contrastText(color),
  };
}

function TypeBadge({ type, className = "type-pill" }: { type: string | null | undefined; className?: string }) {
  return (
    <span className={className} style={typeStyle(type)}>
      {type ?? "n/a"}
    </span>
  );
}

function TypeSymbol({
  type,
  className = "type-symbol",
}: {
  type: string | null | undefined;
  className?: string;
}) {
  const color = type ? TYPE_COLORS[type] ?? "#61708c" : "#61708c";
  return (
    <span className={className} style={{ color }} title={type ?? "n/a"} aria-label={type ?? "n/a"}>
      {type ? TYPE_SYMBOLS[type] ?? "\u2022" : "?"}
    </span>
  );
}

function PokemonIcon({
  pokemon,
  className = "pokemon-icon",
}: {
  pokemon: PokemonEntry;
  className?: string;
}) {
  const icon = pokemon.artwork.sprite || pokemon.artwork.home || pokemon.artwork.official_artwork;
  if (!icon) {
    return <span className={`${className} pokemon-icon-fallback`}>{pokemon.name.slice(0, 2).toUpperCase()}</span>;
  }
  return <img className={className} src={icon} alt="" aria-hidden="true" />;
}

function raidMoveDisplay(
  moveName: string,
  moveType: string | null | undefined,
  moveKind?: string | null,
  showEliteIndicator = false,
) {
  const color = moveType ? TYPE_COLORS[moveType] ?? "#61708c" : "#61708c";
  const elitePrefix = showEliteIndicator && moveKind?.startsWith("elite") ? "\u2605 " : "";
  return (
    <span className="raid-move-display" style={{ color }} aria-label={moveType ?? "n/a"} title={moveType ?? "n/a"}>
      <span>{elitePrefix}{moveName}</span>
    </span>
  );
}

function formatScore(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

function formatTeamDps(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(1);
}

function pokemonRegionLabel(pokemon: PokemonEntry): string {
  const region = POKEMON_REGIONS.find((entry) => pokemon.dex <= entry.maxDex);
  if (!region) {
    return "Unknown";
  }
  return `${region.region}-${region.generation}`;
}

function shouldShowPokemonForm(pokemon: PokemonEntry, meaningfulFormCountByName: Map<string, number>): boolean {
  void meaningfulFormCountByName;
  const isNormalForm = normalizeQuery(pokemon.form) === "normal";
  return !isNormalForm;
}

function formatPokemonFormLabel(form: string): string {
  const normalized = normalizeQuery(form);
  if (normalized === "galarian_zen") {
    return "Gal-Z";
  }
  if (normalized === "galarian_standard") {
    return "Gal";
  }
  if (normalized === "crowned_sword") {
    return "CrownSw";
  }
  return form.replace(/galarian/gi, "Gal");
}

function pokemonDisplayForm(
  pokemon: PokemonEntry,
  meaningfulFormCountByName: Map<string, number>,
): string | null {
  if (!shouldShowPokemonForm(pokemon, meaningfulFormCountByName)) {
    return null;
  }
  return formatPokemonFormLabel(pokemon.form);
}

function pokemonDisplayLabel(pokemon: PokemonEntry, meaningfulFormCountByName: Map<string, number>): string {
  const form = pokemonDisplayForm(pokemon, meaningfulFormCountByName);
  return form ? `${pokemon.name} (${form})` : pokemon.name;
}

function statCard(label: string, value: number | null | undefined) {
  return (
    <div>
      <label>{label}</label>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function moveKindLabel(moveKind: string | null): string {
  if (!moveKind) {
    return "n/a";
  }
  return moveKind.replace("_", " ");
}

function moveTableRows(
  pokemon: PokemonEntry,
  defenderTypes: string[],
  weather: WeatherName,
  typeEffectiveness: MergedData["type_effectiveness"],
) {
  return scorePokemon(pokemon, defenderTypes, weather, typeEffectiveness).moves;
}

function MoveTable({
  pokemon,
  title,
  defenderTypes,
  weather,
  typeEffectiveness,
}: {
  pokemon: PokemonEntry;
  title: string;
  defenderTypes: string[];
  weather: WeatherName;
  typeEffectiveness: MergedData["type_effectiveness"];
}) {
  const rows = moveTableRows(pokemon, defenderTypes, weather, typeEffectiveness);
  return (
    <section className="panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <span>{rows.length} moves</span>
      </div>
      <div className="table">
        <div className="table-row table-head table-9">
          <span>Name</span>
          <span>Kind</span>
          <span>Type</span>
          <span>Power</span>
          <span>Raw DPS</span>
          <span>STAB</span>
          <span>Matchup</span>
          <span>Weather</span>
          <span>Effective DPS</span>
        </div>
        {rows.map((row) => (
          <div className="table-row table-9" key={`${title}-${row.name}-${row.move_kind}`}>
            <span>{row.name}</span>
            <span>{moveKindLabel(row.move_kind)}</span>
            <span>
              <TypeBadge type={row.type} className="move-type-chip" />
            </span>
            <span>{formatNumber(row.power)}</span>
            <span>{formatScore(row.raw_dps)}</span>
            <span>{row.stab_multiplier.toFixed(2)}</span>
            <span>
              {row.matchup_multiplier.toFixed(2)} ({matchupBonusPercent(row.matchup_multiplier)}%)
            </span>
            <span>{row.weather_multiplier.toFixed(2)}</span>
            <span>{formatScore(row.effective_dps)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PokemonPanel({
  pokemon,
  targetTypes,
  weather,
  typeEffectiveness,
  meaningfulFormCountByName,
}: {
  pokemon: PokemonEntry;
  targetTypes: string[];
  weather: WeatherName;
  typeEffectiveness: MergedData["type_effectiveness"];
  meaningfulFormCountByName: Map<string, number>;
}) {
  const scored = scorePokemon(pokemon, targetTypes, weather, typeEffectiveness);
  const bestMove = scored.best_move;
  const bestFast = scored.best_fast_move;
  const bestCharged = scored.best_charged_move;
  const artwork = pokemon.artwork.official_artwork || pokemon.artwork.home || pokemon.artwork.sprite;

  return (
    <section className="detail-card panel">
      <div className="detail-top">
        <div className="artwork-wrap">
          {artwork ? <img src={artwork} alt={pokemon.name} /> : <div className="artwork-placeholder">No artwork</div>}
        </div>
        <div className="detail-copy">
          <div className="pokemon-title">
            #{pokemon.dex} {pokemon.name}
            {pokemonDisplayForm(pokemon, meaningfulFormCountByName) ? (
              <span className="pokemon-form-inline"> ({pokemonDisplayForm(pokemon, meaningfulFormCountByName)})</span>
            ) : null}
          </div>
          <div className="type-row">
            {pokemon.types.map((type) => (
              <TypeBadge key={type} type={type} />
            ))}
          </div>
          <div className="stats-grid">
            {statCard("Attack", pokemon.base_stats.attack)}
            {statCard("Defense", pokemon.base_stats.defense)}
            {statCard("Stamina", pokemon.base_stats.stamina)}
          </div>
          <div className="meta-line">
            <span>{pokemon.released ? "Released" : "Not released"}</span>
            <span>{pokemon.evolution.is_final_evolution ? "Final evolution" : "Not final evolution"}</span>
            <span>{pokemon.evolution.family_root ? `Family root: ${pokemon.evolution.family_root}` : "No family data"}</span>
          </div>
          {bestMove ? (
            <div className="best-move">
              <strong>Best move:</strong> {bestMove.name} ({formatScore(bestMove.effective_dps)})<br />
              <strong>Fast:</strong> {bestFast ? `${bestFast.name} (${formatScore(bestFast.effective_dps)})` : "n/a"}<br />
              <strong>Charged:</strong>{" "}
              {bestCharged ? `${bestCharged.name} (${formatScore(bestCharged.effective_dps)})` : "n/a"}
            </div>
          ) : null}
        </div>
      </div>
      <div className="summary-strip">
        <div>
          <span>Raw DPS</span>
          <strong>{formatScore(bestMove?.raw_dps ?? null)}</strong>
        </div>
        <div>
          <span>STAB</span>
          <strong>{bestMove ? bestMove.stab_multiplier.toFixed(2) : "n/a"}</strong>
        </div>
        <div>
          <span>Matchup</span>
          <strong>
            {bestMove ? `${bestMove.matchup_multiplier.toFixed(2)} (${matchupBonusPercent(bestMove.matchup_multiplier)}%)` : "n/a"}
          </strong>
        </div>
        <div>
          <span>Weather</span>
          <strong>{bestMove ? bestMove.weather_multiplier.toFixed(2) : "n/a"}</strong>
        </div>
        <div>
          <span>Effective DPS</span>
          <strong>{formatScore(bestMove?.effective_dps ?? null)}</strong>
        </div>
      </div>

      <div className="move-columns">
        <MoveTable
          pokemon={pokemon}
          title="Fast moves"
          defenderTypes={targetTypes}
          weather={weather}
          typeEffectiveness={typeEffectiveness}
        />
        <MoveTable
          pokemon={pokemon}
          title="Charged moves"
          defenderTypes={targetTypes}
          weather={weather}
          typeEffectiveness={typeEffectiveness}
        />
      </div>
    </section>
  );
}

function FamilyTable({
  members,
  targetTypes,
  weather,
  typeEffectiveness,
  meaningfulFormCountByName,
}: {
  members: PokemonEntry[];
  targetTypes: string[];
  weather: WeatherName;
  typeEffectiveness: MergedData["type_effectiveness"];
  meaningfulFormCountByName: Map<string, number>;
}) {
  const ranked = members
    .map((entry) => scorePokemon(entry, targetTypes, weather, typeEffectiveness))
    .filter((entry) => entry.best_effective_dps !== null)
    .sort((a, b) => (b.best_effective_dps ?? 0) - (a.best_effective_dps ?? 0));
  const best = ranked[0]?.best_effective_dps ?? null;

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>Evolution family comparison</h3>
        <span>{ranked.length} forms</span>
      </div>
      <div className="table">
        <div className="table-row table-head table-9">
          <span>Pokemon</span>
          <span>Form</span>
          <span>Stage</span>
          <span>Best move</span>
          <span>Raw DPS</span>
          <span>Matchup</span>
          <span>Weather</span>
          <span>Effective DPS</span>
          <span>% of best</span>
        </div>
        {ranked.map((entry) => (
          <div className="table-row table-9" key={pokemonKey(entry.pokemon)}>
            <span>{entry.pokemon.name}</span>
            <span>{pokemonDisplayForm(entry.pokemon, meaningfulFormCountByName) ?? "-"}</span>
            <span>{entry.pokemon.evolution.evolution_stage ?? "n/a"}</span>
            <span>{entry.best_move?.name ?? "n/a"}</span>
            <span>{formatScore(entry.best_move?.raw_dps ?? null)}</span>
            <span>
              {entry.best_move ? `${entry.best_move.matchup_multiplier.toFixed(2)} (${matchupBonusPercent(entry.best_move.matchup_multiplier)}%)` : "n/a"}
            </span>
            <span>{entry.best_move?.weather_multiplier.toFixed(2) ?? "n/a"}</span>
            <span>{formatScore(entry.best_effective_dps ?? null)}</span>
            <span>{percentOfBest(entry.best_effective_dps, best)?.toFixed(1) ?? "n/a"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RaidAttackersTable({
  rows,
  sortMode,
  spotlightPokemon,
  meaningfulFormCountByName,
}: {
  rows: RaidAttackerRow[];
  sortMode: RaidSortMode;
  spotlightPokemon: PokemonEntry | null;
  meaningfulFormCountByName: Map<string, number>;
}) {
  const collapsedRows = useMemo(() => {
    const grouped = new Map<string, { row: RaidAttackerRow; forms: Set<string>; key: string }>();
    rows.forEach((row) => {
      const key = [
        normalizeQuery(row.pokemon.name),
        raidMoveKey(row.fast_move),
        raidMoveKey(row.charged_move),
        row.team_dps.toFixed(3),
      ].join("::");
      const existing = grouped.get(key);
      if (existing) {
        existing.forms.add(normalizeQuery(row.pokemon.form));
        return;
      }
      grouped.set(key, {
        row,
        forms: new Set([normalizeQuery(row.pokemon.form)]),
        key,
      });
    });
    return Array.from(grouped.values());
  }, [rows]);

  const best = collapsedRows[0]?.row?.[sortMode === "base_dps" ? "base_dps" : "team_dps"] ?? null;
  const spotlightName = spotlightPokemon ? normalizeQuery(spotlightPokemon.name) : null;
  const spotlightRows = spotlightName
    ? collapsedRows.filter((entry) => normalizeQuery(entry.row.pokemon.name) === spotlightName)
    : [];
  const spotlightRow = spotlightRows[0] ?? null;
  const topRows = collapsedRows.slice(0, 20);
  const spotlightIncluded = spotlightRow
    ? topRows.some((entry) => entry.key === spotlightRow.key)
    : false;
  const displayRows =
    spotlightRow && !spotlightIncluded
      ? [...topRows.slice(0, Math.max(0, topRows.length - 1)), spotlightRow]
      : topRows;

  return (
    <section className="panel ranking-panel raid-panel">
      <div className="table raid-table">
        <div className="table-row table-head raid-table-head">
          <span>Pokemon</span>
          <span>Moveset</span>
          <span>Survival</span>
          <span>Base DPS</span>
          <span>Raid DPS</span>
          <span>Relative</span>
        </div>
        {displayRows.map((displayEntry) => {
          const entry = displayEntry.row;
          const formLabel =
            displayEntry.forms.size > 1 ? "Various" : pokemonDisplayForm(entry.pokemon, meaningfulFormCountByName);
          const isSpotlight =
            spotlightName !== null && normalizeQuery(entry.pokemon.name) === spotlightName;
          return (
            <div
              className={isSpotlight ? "table-row raid-table-row spotlight" : "table-row raid-table-row"}
              key={displayEntry.key}
            >
              <span className="pokemon-name-cell raid-pokemon-cell">
                <PokemonIcon pokemon={entry.pokemon} className="pokemon-icon pokemon-icon-table" />
                <span className="pokemon-name-inline">
                  <strong>{entry.pokemon.name}</strong>
                  {formLabel ? (
                    <span className="pokemon-form-inline"> ({formLabel})</span>
                  ) : null}
                  <span className="pokemon-region-inline">{pokemonRegionLabel(entry.pokemon)}</span>
                </span>
                <span className="type-row compact raid-type-icons">
                  {entry.pokemon.types.map((type) => (
                    <TypeSymbol key={type} type={type} />
                  ))}
                </span>
              </span>
              <span className="raid-moveset-cell">
                <span>{raidMoveDisplay(entry.fast_move.name, entry.fast_move.type, entry.fast_move.move_kind, true)}</span>
                <span className="raid-moveset-separator">/</span>
                <span>{raidMoveDisplay(entry.charged_move.name, entry.charged_move.type, entry.charged_move.move_kind, true)}</span>
              </span>
              <span>{entry.survival_seconds.toFixed(1)}s</span>
              <span>{formatTeamDps(entry.base_dps)}</span>
              <span>{formatTeamDps(entry.team_dps)}</span>
              <span className="raid-strength-cell" aria-hidden="true">
                <span className="raid-strength-track">
                  <span
                    className="raid-strength-fill"
                    style={{ width: `${percentOfBest(sortMode === "base_dps" ? entry.base_dps : entry.team_dps, best) ?? 0}%` }}
                  />
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="ranking-summary raid-summary-footer">
        <span>
          <strong>Best {sortMode === "base_dps" ? "base DPS" : "raid DPS"}:</strong> {formatTeamDps(best)}
        </span>
        <span>
          <strong>Sort:</strong> {sortMode === "base_dps" ? "Base DPS descending" : "Raid DPS descending"}
        </span>
      </div>
    </section>
  );
}

export default function App() {
  const [state, setState] = useState<ViewState>({
    data: null,
    error: null,
    loading: true,
  });
  const [mode, setMode] = useState<Mode>("raid");
  const [search, setSearch] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [excludeLimitedPokemon, setExcludeLimitedPokemon] = useState(true);
  const [weatherEnabled, setWeatherEnabled] = useState(true);
  const [targetType, setTargetType] = useState("Any");
  const [weather, setWeather] = useState<WeatherName>("None");
  const [raidWeather, setRaidWeather] = useState<WeatherName>("None");
  const [bossSourceFilter, setBossSourceFilter] = useState<RaidBossSourceFilter>("Current Rotation");
  const [raidIncludeSearch, setRaidIncludeSearch] = useState("");
  const [bossKey, setBossKey] = useState<string | null>(null);
  const [raidAssumption, setRaidAssumption] = useState<RaidBossAssumption>("Average");
  const [raidSimulationMode, setRaidSimulationMode] = useState<RaidSimulationMode>("spiked");
  const [raidBossFastKey, setRaidBossFastKey] = useState<string | null>(null);
  const [raidBossChargedKey, setRaidBossChargedKey] = useState<string | null>(null);
  const [raidIncludeDraftKey, setRaidIncludeDraftKey] = useState<string | null>(null);
  const [raidIncludeKey, setRaidIncludeKey] = useState<string | null>(null);
  const [raidDurationPreset, setRaidDurationPreset] = useState<"30" | "60" | "90" | "120" | "150" | "180">("120");
  const [raidSortMode, setRaidSortMode] = useState<RaidSortMode>("raid_dps");
  const [maxMovesets, setMaxMovesets] = useState(1);
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const [finalKey, setFinalKey] = useState<string | null>(null);
  const [compareLeftKey, setCompareLeftKey] = useState<string | null>(null);
  const [compareRightKey, setCompareRightKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadMergedData()
      .then((data) => {
        if (!active) {
          return;
        }
        setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setState({
          data: null,
          error: error instanceof Error ? error.message : "Failed to load merged data",
          loading: false,
        });
      });
    return () => {
      active = false;
    };
  }, []);

  const pokemon = state.data?.pokemon ?? [];
  const typeEffectiveness = state.data?.type_effectiveness ?? {};
  const visiblePokemon = useMemo(() => {
    const meaningfulPool = pokemon.filter((entry) => !entry.derived.cosmetic_diff);
    return excludeLimitedPokemon
      ? meaningfulPool.filter((entry) => !LIMITED_POKEMON.has(normalizeQuery(entry.name)))
      : meaningfulPool;
  }, [excludeLimitedPokemon, pokemon]);
  const meaningfulFormCountByName = useMemo(() => {
    const counts = new Map<string, number>();
    visiblePokemon.forEach((entry) => {
      const key = normalizeQuery(entry.name);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [visiblePokemon]);
  const availableTypes = useMemo(() => allTypes(visiblePokemon), [visiblePokemon]);
  const targetTypes = targetType === "Any" ? [] : [targetType];
  const activeWeather = weatherEnabled ? weather : "None";

  const lookupFilteredPokemon = useMemo(() => {
    const query = normalizeQuery(search);
    return visiblePokemon.filter((entry) => {
      const matchesSearch =
        query.length === 0 ||
        normalizeQuery(entry.name).includes(query) ||
        normalizeQuery(entry.form).includes(query) ||
        String(entry.dex).includes(query);
      const matchesTypes =
        selectedTypes.length === 0 || selectedTypes.every((type) => entry.types.includes(type));
      return matchesSearch && matchesTypes;
    });
  }, [search, selectedTypes, visiblePokemon]);

  const raidIncludeOptions = useMemo(() => {
    if (mode !== "raid") {
      return [];
    }

    const query = normalizeQuery(raidIncludeSearch);
    if (!query) {
      return [];
    }

    return visiblePokemon
      .filter((entry) => {
        return (
          normalizeQuery(entry.name).includes(query) ||
          normalizeQuery(entry.form).includes(query) ||
          String(entry.dex).includes(query)
        );
      })
      .slice(0, 8);
  }, [mode, raidIncludeSearch, visiblePokemon]);

  const raidIncludePokemon = useMemo(() => {
    if (mode !== "raid" || !raidIncludeKey) {
      return null;
    }
    return visiblePokemon.find((entry) => pokemonKey(entry) === raidIncludeKey) ?? null;
  }, [mode, raidIncludeKey, visiblePokemon]);

  useEffect(() => {
    if (mode !== "raid") {
      setRaidIncludeSearch("");
      return;
    }

    if (raidIncludeDraftKey && !raidIncludeOptions.some((entry) => pokemonKey(entry) === raidIncludeDraftKey)) {
      setRaidIncludeDraftKey(null);
    }
  }, [mode, raidIncludeDraftKey, raidIncludeOptions]);

  const raidBossOptions = useMemo(
    () => filterRaidBosses(bossSourceFilter, visiblePokemon),
    [bossSourceFilter, visiblePokemon],
  );

  const raidBossGroups = useMemo(
    () => groupRaidBosses(raidBossOptions, bossSourceFilter, visiblePokemon),
    [bossSourceFilter, raidBossOptions, visiblePokemon],
  );

  const selectedRaidBossOption = useMemo(() => {
    if (!bossKey) {
      return null;
    }
    return raidBossOptions.find((entry) => entry.key === bossKey) ?? null;
  }, [bossKey, raidBossOptions]);

  const resolvedRaidBoss = useMemo(() => {
    if (!selectedRaidBossOption) {
      return null;
    }
    return resolveRaidBoss(selectedRaidBossOption, pokemon);
  }, [pokemon, selectedRaidBossOption]);

  const raidBossMovePools = useMemo(() => {
    if (!resolvedRaidBoss) {
      return { fast: [], charged: [] };
    }
    return raidMovePools(resolvedRaidBoss.pokemon);
  }, [resolvedRaidBoss]);

  const raidSpecificMoveset = useMemo(
    () =>
      raidAssumption === "Specific moveset"
        ? { fastKey: raidBossFastKey, chargedKey: raidBossChargedKey }
        : null,
    [raidAssumption, raidBossChargedKey, raidBossFastKey],
  );

  const raidDurationSeconds = useMemo(() => {
    return Number(raidDurationPreset);
  }, [raidDurationPreset]);

  const raidAttackers = useMemo(() => {
    if (!resolvedRaidBoss) {
      return [];
    }
    const attackPool = visiblePokemon.filter(
      (entry) => entry.evolution.is_final_evolution || entry.evolution.line_names.length === 1,
    );
    return computeRaidAttackers(
      attackPool,
      resolvedRaidBoss.pokemon,
      raidAssumption,
      raidSpecificMoveset,
      raidWeather,
      raidDurationSeconds,
      RAID_REPLACEMENT_DELAY_SECONDS,
      raidSortMode,
      maxMovesets,
      raidSimulationMode,
      typeEffectiveness,
    );
  }, [
    raidAssumption,
    raidDurationSeconds,
    raidWeather,
    raidSpecificMoveset,
    raidSortMode,
    resolvedRaidBoss,
    maxMovesets,
    raidSimulationMode,
    visiblePokemon,
    typeEffectiveness,
  ]);

  const lookupSelection = useMemo(() => {
    if (lookupKey) {
      return visiblePokemon.find((entry) => pokemonKey(entry) === lookupKey) ?? null;
    }
    return lookupPokemon(search, lookupFilteredPokemon.length ? lookupFilteredPokemon : visiblePokemon);
  }, [lookupFilteredPokemon, lookupKey, search, visiblePokemon]);

  const resolvedFinal = useMemo(() => {
    if (!lookupSelection) {
      return null;
    }
    if (finalKey) {
      const selected = visiblePokemon.find((entry) => pokemonKey(entry) === finalKey);
      if (selected) {
        return selected;
      }
    }
    return resolvePrimaryFinalEvolution(lookupSelection, visiblePokemon);
  }, [finalKey, lookupSelection, visiblePokemon]);

  const familyMembers = useMemo(() => {
    if (!lookupSelection) {
      return [];
    }
    return evolutionFamilyMembers(lookupSelection, visiblePokemon);
  }, [lookupSelection, visiblePokemon]);

  const finalOptions = useMemo(() => {
    if (!lookupSelection) {
      return [];
    }
    return finalEvolutionOptions(lookupSelection, visiblePokemon);
  }, [lookupSelection, visiblePokemon]);

  useEffect(() => {
    if (!lookupFilteredPokemon.length) {
      return;
    }
    if (compareLeftKey === null || !lookupFilteredPokemon.some((entry) => pokemonKey(entry) === compareLeftKey)) {
      setCompareLeftKey(pokemonKey(lookupFilteredPokemon[0]));
    }
    if (
      compareRightKey === null ||
      !lookupFilteredPokemon.some((entry) => pokemonKey(entry) === compareRightKey) ||
      compareRightKey === compareLeftKey
    ) {
      setCompareRightKey(pokemonKey(lookupFilteredPokemon[Math.min(1, lookupFilteredPokemon.length - 1)]));
    }
  }, [compareLeftKey, compareRightKey, lookupFilteredPokemon]);

  useEffect(() => {
    if (mode !== "raid") {
      return;
    }
    if (raidIncludeDraftKey && !visiblePokemon.some((entry) => pokemonKey(entry) === raidIncludeDraftKey)) {
      setRaidIncludeDraftKey(null);
    }
    if (raidIncludeKey && !visiblePokemon.some((entry) => pokemonKey(entry) === raidIncludeKey)) {
      setRaidIncludeKey(null);
    }
  }, [mode, raidIncludeDraftKey, raidIncludeKey, visiblePokemon]);

  useEffect(() => {
    if (!bossKey) {
      return;
    }
    if (!raidBossOptions.some((entry) => entry.key === bossKey)) {
      setBossKey(null);
    }
  }, [bossKey, raidBossOptions]);

  useEffect(() => {
    if (!resolvedRaidBoss) {
      return;
    }
    const pools = raidBossMovePools;
    if (!pools.fast.length || !pools.charged.length) {
      return;
    }
    if (raidBossFastKey === null || !pools.fast.some((move) => raidMoveKey(move) === raidBossFastKey)) {
      setRaidBossFastKey(raidMoveKey(pools.fast[0]));
    }
    if (
      raidBossChargedKey === null ||
      !pools.charged.some((move) => raidMoveKey(move) === raidBossChargedKey)
    ) {
      setRaidBossChargedKey(raidMoveKey(pools.charged[0]));
    }
  }, [raidBossChargedKey, raidBossFastKey, raidBossMovePools, resolvedRaidBoss]);

  const compareLeft = lookupFilteredPokemon.find((entry) => pokemonKey(entry) === compareLeftKey) ?? lookupFilteredPokemon[0] ?? null;
  const compareRight = lookupFilteredPokemon.find((entry) => pokemonKey(entry) === compareRightKey) ?? null;

  if (state.loading) {
    return <div className="app-shell centered">Loading merged Pokemon data...</div>;
  }

  if (state.error) {
    return (
      <div className="app-shell centered">
        <div className="error-card">
          <h1>Pokemon GO Explorer</h1>
          <p>{state.error}</p>
          <p>Run <code>python scripts/fetch_data.py</code> again if the merged JSON is missing or stale.</p>
        </div>
      </div>
    );
  }

  if (!pokemon.length) {
    return <div className="app-shell centered">No Pokemon data found.</div>;
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local-first Pokemon GO explorer</p>
        </div>
      </header>

      <main className="layout">
        <aside className="sidebar panel">
          <div className="panel-header">
            <h2>Explorer</h2>
            <span>{mode === "raid" ? `${raidAttackers.length} results` : `${lookupFilteredPokemon.length} results`}</span>
          </div>

          <div className="mode-switch">
            <button
              type="button"
              className={mode === "raid" ? "mode-pill active" : "mode-pill"}
              onClick={() => setMode("raid")}
            >
              Raid Attackers
            </button>
            <button
              type="button"
              className={mode === "lookup" ? "mode-pill active" : "mode-pill"}
              onClick={() => setMode("lookup")}
            >
              Lookup
            </button>
          </div>

          {mode === "raid" ? (
            <div className="field raid-include-field">
              <div className="field-header-row">
                <span>Include attacker</span>
                <button
                  type="button"
                  className="mode-pill raid-select-button"
                  onClick={() => {
                    if (raidIncludeKey) {
                      setRaidIncludeKey(null);
                      setRaidIncludeDraftKey(null);
                      setRaidIncludeSearch("");
                      return;
                    }
                    if (raidIncludeDraftKey) {
                      const selected = visiblePokemon.find((entry) => pokemonKey(entry) === raidIncludeDraftKey) ?? null;
                      const resolved = selected ? resolvePrimaryFinalEvolution(selected, visiblePokemon) : null;
                      if (resolved) {
                        setRaidIncludeKey(pokemonKey(resolved));
                        setRaidIncludeDraftKey(null);
                        setRaidIncludeSearch("");
                      }
                    }
                  }}
                  disabled={!raidIncludeKey && !raidIncludeDraftKey}
                >
                  {raidIncludeKey ? "Remove" : "Select"}
                </button>
              </div>
              <input
                value={raidIncludeSearch}
                onChange={(event) => {
                  setRaidIncludeSearch(event.target.value);
                }}
                placeholder="Charizard, Venusaur, Dragonite..."
              />
              {raidIncludeOptions.length ? (
                <div className="raid-include-list">
                  {raidIncludeOptions.map((entry) => {
                    const isSelected = raidIncludeDraftKey === pokemonKey(entry);
                    return (
                      <button
                        key={pokemonKey(entry)}
                        type="button"
                        className={isSelected ? "raid-include-item active" : "raid-include-item"}
                        onClick={() => setRaidIncludeDraftKey(pokemonKey(entry))}
                      >
                        <span>
                          {entry.name}
                          {pokemonDisplayForm(entry, meaningfulFormCountByName) ? (
                            <span className="pokemon-form-inline"> ({pokemonDisplayForm(entry, meaningfulFormCountByName)})</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <label className="field">
              <span>Search</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Bulbasaur, Charizard, Dragon..."
              />
            </label>
          )}

          {mode === "lookup" ? (
            <div className="field">
              <span>Type filter</span>
              <div className="type-filter">
                {availableTypes.map((type) => {
                  const active = selectedTypes.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      className={active ? "type-pill active" : "type-pill"}
                      style={typeStyle(type)}
                      onClick={() =>
                        setSelectedTypes((current) =>
                          current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type],
                        )
                      }
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={excludeLimitedPokemon}
              onChange={(event) => setExcludeLimitedPokemon(event.target.checked)}
            />
            <span>Exclude limited/event-only Pokemon</span>
          </label>

          {mode === "lookup" ? (
            <>
              <label className="field">
                <span>Target type</span>
                <select value={targetType} onChange={(event) => setTargetType(event.target.value)}>
                  <option value="Any">Any</option>
                  {availableTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={weatherEnabled}
                  onChange={(event) => setWeatherEnabled(event.target.checked)}
                />
                <span>Apply weather</span>
              </label>

              <label className="field">
                <span>Weather</span>
                <select
                  value={weather}
                  onChange={(event) => setWeather(event.target.value as WeatherName)}
                  disabled={!weatherEnabled}
                >
                  {WEATHER_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <div className="pokemon-list">
                {lookupFilteredPokemon.map((entry) => (
                  <button
                    type="button"
                    key={pokemonKey(entry)}
                    className={
                      pokemonKey(entry) === (lookupSelection ? pokemonKey(lookupSelection) : "")
                        ? "pokemon-row active"
                        : "pokemon-row"
                    }
                    onClick={() => {
                      setLookupKey(pokemonKey(entry));
                      setCompareLeftKey(pokemonKey(entry));
                    }}
                  >
                    <strong>
                      #{entry.dex} {entry.name}
                      {pokemonDisplayForm(entry, meaningfulFormCountByName) ? (
                        <span className="pokemon-form-inline"> ({pokemonDisplayForm(entry, meaningfulFormCountByName)})</span>
                      ) : null}
                    </strong>
                    <span className="pokemon-form-inline">{pokemonDisplayForm(entry, meaningfulFormCountByName) ?? "-"}</span>
                    <small>{entry.types.join(" / ")}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <label className="field">
                <span>Max movesets</span>
                <select value={maxMovesets} onChange={(event) => setMaxMovesets(Number(event.target.value) || 1)}>
                  {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <div className="field">
                <span>Boss source</span>
                <select
                  value={bossSourceFilter}
                  onChange={(event) => setBossSourceFilter(event.target.value as RaidBossSourceFilter)}
                >
                  {RAID_BOSS_SOURCE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <label className="field">
                <span>Raid boss</span>
                <select value={bossKey ?? ""} onChange={(event) => setBossKey(event.target.value || null)}>
                  <option value="">Choose a raid boss...</option>
                  {raidBossGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((entry) => (
                        <option key={entry.key} value={entry.key}>
                          {entry.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Boss moveset assumption</span>
                <select value={raidAssumption} onChange={(event) => setRaidAssumption(event.target.value as RaidBossAssumption)}>
                  <option value="Best for attacker">Best for attacker</option>
                  <option value="Worst for attacker">Worst for attacker</option>
                  <option value="Average">Average</option>
                  <option value="Specific moveset">Specific moveset</option>
                </select>
              </label>

              <label className="field">
                <span>Weather</span>
                <select value={raidWeather} onChange={(event) => setRaidWeather(event.target.value as WeatherName)}>
                  {WEATHER_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Battle model</span>
                <select
                  value={raidSimulationMode}
                  onChange={(event) => setRaidSimulationMode(event.target.value as RaidSimulationMode)}
                >
                  <option value="spiked">Spiked</option>
                  <option value="smoothed">Smoothed</option>
                </select>
              </label>

              {raidAssumption === "Specific moveset" && resolvedRaidBoss ? (
                <>
                  <label className="field">
                    <span>Boss fast move</span>
                    <select
                      value={raidBossFastKey ?? ""}
                      onChange={(event) => setRaidBossFastKey(event.target.value)}
                    >
                      {raidBossMovePools.fast.map((move) => (
                        <option key={raidMoveKey(move)} value={raidMoveKey(move)}>
                          {raidMoveLabel(move)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Boss charged move</span>
                    <select
                      value={raidBossChargedKey ?? ""}
                      onChange={(event) => setRaidBossChargedKey(event.target.value)}
                    >
                      {raidBossMovePools.charged.map((move) => (
                        <option key={raidMoveKey(move)} value={raidMoveKey(move)}>
                          {raidMoveLabel(move)}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}

              <label className="field">
                <span>Raid duration</span>
                <select value={raidDurationPreset} onChange={(event) => setRaidDurationPreset(event.target.value as typeof raidDurationPreset)}>
                  <option value="30">30s</option>
                  <option value="60">60s</option>
                  <option value="90">90s</option>
                  <option value="120">120s</option>
                  <option value="150">150s</option>
                  <option value="180">180s</option>
                </select>
              </label>

              <label className="field">
                <span>Sort by</span>
                <select value={raidSortMode} onChange={(event) => setRaidSortMode(event.target.value as RaidSortMode)}>
                  <option value="raid_dps">Raid DPS</option>
                  <option value="base_dps">Base DPS</option>
                </select>
              </label>
            </>
          )}
        </aside>

        <section className="content">
          {mode === "lookup" ? (
            <>
              {lookupSelection ? (
                <section className="panel lookup-summary">
                  <div className="panel-header">
                    <h3>Lookup</h3>
                    <span>{lookupSelection.evolution.is_final_evolution ? "Already final" : "Resolved to final form"}</span>
                  </div>
                  <div className="lookup-grid">
                    <div>
                      <div className="lookup-label">Input</div>
                      <strong>
                        {lookupSelection.name}
                        {pokemonDisplayForm(lookupSelection, meaningfulFormCountByName) ? (
                          <span className="pokemon-form-inline"> ({pokemonDisplayForm(lookupSelection, meaningfulFormCountByName)})</span>
                        ) : null}
                      </strong>
                      <div className="pokemon-form-inline">{pokemonDisplayForm(lookupSelection, meaningfulFormCountByName) ?? "-"}</div>
                    </div>
                    <div>
                      <div className="lookup-label">Final form</div>
                      <strong>
                        {resolvedFinal ? resolvedFinal.name : "n/a"}
                        {resolvedFinal && pokemonDisplayForm(resolvedFinal, meaningfulFormCountByName) ? (
                          <span className="pokemon-form-inline"> ({pokemonDisplayForm(resolvedFinal, meaningfulFormCountByName)})</span>
                        ) : null}
                      </strong>
                      <div className="pokemon-form-inline">
                        {resolvedFinal ? pokemonDisplayForm(resolvedFinal, meaningfulFormCountByName) ?? "-" : "n/a"}
                      </div>
                    </div>
                    <div>
                      <div className="lookup-label">Family line</div>
                      <strong>{lookupSelection.evolution.line_names.length} species</strong>
                      <div>{lookupSelection.evolution.line_names.join(" -> ")}</div>
                    </div>
                    <div>
                      <div className="lookup-label">Final options</div>
                      <strong>{finalOptions.length}</strong>
                      <div>{finalOptions.map((entry) => entry.name).join(", ") || "n/a"}</div>
                    </div>
                  </div>
                </section>
              ) : null}

              {resolvedFinal ? (
                <>
                  {finalOptions.length > 1 ? (
                    <label className="field">
                      <span>Choose final form</span>
                      <select value={finalKey ?? ""} onChange={(event) => setFinalKey(event.target.value)}>
                        {finalOptions.map((entry) => (
                          <option key={pokemonKey(entry)} value={pokemonKey(entry)}>
                            {pokemonDisplayLabel(entry, meaningfulFormCountByName)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <PokemonPanel
                    pokemon={resolvedFinal}
                    targetTypes={targetTypes}
                    weather={activeWeather}
                    typeEffectiveness={typeEffectiveness}
                    meaningfulFormCountByName={meaningfulFormCountByName}
                  />

                  {familyMembers.length > 1 ? (
                    <FamilyTable
                      members={familyMembers}
                      targetTypes={targetTypes}
                      weather={activeWeather}
                      typeEffectiveness={typeEffectiveness}
                      meaningfulFormCountByName={meaningfulFormCountByName}
                    />
                  ) : null}
                </>
              ) : null}

              <section className="compare-bar panel">
                <label className="field">
                  <span>Compare left</span>
                  <select value={compareLeft ? pokemonKey(compareLeft) : ""} onChange={(event) => setCompareLeftKey(event.target.value)}>
                    {lookupFilteredPokemon.map((entry) => (
                      <option key={`left-${pokemonKey(entry)}`} value={pokemonKey(entry)}>
                        #{entry.dex} {pokemonDisplayLabel(entry, meaningfulFormCountByName)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Compare right</span>
                  <select value={compareRight ? pokemonKey(compareRight) : ""} onChange={(event) => setCompareRightKey(event.target.value)}>
                    {lookupFilteredPokemon.map((entry) => (
                      <option key={`right-${pokemonKey(entry)}`} value={pokemonKey(entry)}>
                        #{entry.dex} {pokemonDisplayLabel(entry, meaningfulFormCountByName)}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              {compareLeft ? (
                <div className="compare-grid">
                  <PokemonPanel
                    pokemon={compareLeft}
                    targetTypes={targetTypes}
                    weather={activeWeather}
                    typeEffectiveness={typeEffectiveness}
                    meaningfulFormCountByName={meaningfulFormCountByName}
                  />
                  {compareRight ? (
                    <PokemonPanel
                      pokemon={compareRight}
                      targetTypes={targetTypes}
                      weather={activeWeather}
                      typeEffectiveness={typeEffectiveness}
                      meaningfulFormCountByName={meaningfulFormCountByName}
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <section className="panel raid-banner">
              <div className="panel-header">
                  <div className="raid-banner-title">
                    {resolvedRaidBoss ? <PokemonIcon pokemon={resolvedRaidBoss.pokemon} className="pokemon-icon pokemon-icon-hero" /> : null}
                    <div className="raid-banner-title-copy">
                      <div className="raid-header-title-line">
                        <h3>{selectedRaidBossOption ? `Raid Attackers vs ${selectedRaidBossOption.label}` : "Raid Attackers"}</h3>
                        <div className="raid-banner-types">
                          {resolvedRaidBoss?.pokemon.types.map((type) => (
                            <TypeSymbol key={type} type={type} className="type-symbol type-symbol-xl" />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <span>{selectedRaidBossOption ? `${Math.min(20, raidAttackers.length)} shown` : "Choose a boss"}</span>
                </div>
                {selectedRaidBossOption ? (
                  <>
                    <div className="ranking-summary raid-summary">
                      <span>
                        <strong>Bucket:</strong> {selectedRaidBossOption.bucket}
                      </span>
                      <span>
                        <strong>Boss moveset:</strong> {raidAssumption}
                      </span>
                      <span>
                        <strong>Weather:</strong> {raidWeather}
                      </span>
                      <span>
                        <strong>Battle model:</strong> {raidSimulationMode === "spiked" ? "Spiked" : "Smoothed"}
                      </span>
                      <span>
                        <strong>Raid duration:</strong> {raidDurationSeconds}s
                      </span>
                      <span>
                        <strong>Replacement delay:</strong> {RAID_REPLACEMENT_DELAY_SECONDS.toFixed(1)}s
                      </span>
                      <span>
                        <strong>Sort:</strong> {raidSortMode === "base_dps" ? "Base DPS descending" : "Raid DPS descending"}
                      </span>
                    </div>
                    {resolvedRaidBoss?.note ? <div className="raid-note">{resolvedRaidBoss.note}</div> : null}
                  </>
                ) : (
                  <div className="raid-note">Choose a raid boss to calculate attackers.</div>
                )}
              </section>

              {selectedRaidBossOption ? (
                <RaidAttackersTable
                  rows={raidAttackers}
                  sortMode={raidSortMode}
                  spotlightPokemon={raidIncludePokemon}
                  meaningfulFormCountByName={meaningfulFormCountByName}
                />
              ) : null}
            </>
          )}

          <section className="panel note-card">
            <h3>How the numbers work</h3>
            <p>
              Raw DPS = <code>power / (duration_ms / 1000)</code>. Final DPS multiplies raw DPS by STAB, matchup,
              and weather. Matchup values below <code>1.00</code> are resisted; values above <code>1.00</code> are
              super effective.
            </p>
            <p>
              Example: <code>0.39</code> means about <code>-60.9%</code> versus neutral, while <code>1.60</code> means
              about <code>+60%</code>.
            </p>
            {mode === "raid" ? (
              <p>
                Raid DPS models full raid uptime (including faints and relobbies). Base DPS is a single-cycle estimate:
                fast moves to charged, divided by cycle time, with no fainting pressure.
              </p>
            ) : null}
          </section>
        </section>
      </main>
    </div>
  );
}
