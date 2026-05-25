import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  allTypes,
  formatNumber,
  loadPvpMetaData,
  loadMergedData,
  loadCurrentRaidBossesData,
  loadPokemonSpeciesData,
  refreshPvpMetaData,
  loadSpawnRarityData,
  normalizeQuery,
} from "./data.ts";
import type { PvpLeague } from "./data.ts";
import {
  evolutionFamilyMembers,
  finalEvolutionOptions,
  lookupPokemon,
  pokemonKey,
  resolvePrimaryFinalEvolution,
} from "./evolution.ts";
import { maxLevelUnderCapForIvs, topGreatLeagueLevelUpCandidates } from "./pvp_leveling.ts";
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
import { computeStatsRows, sortStatsRows, type CpMode, type StatsMovesetRow, type StatsSortMode } from "./stats.ts";
import type { GreatLeagueCombinedData, GreatLeagueCombinedRow, MergedData, PokemonEntry } from "./types.ts";
import type { CurrentRaidBossesData } from "./types.ts";
import type { PokemonSpecies, SpawnRarity } from "./rarity/types.ts";

type ViewState = {
  data: MergedData | null;
  pvpMetaData: GreatLeagueCombinedData | null;
  spawnRarityData: SpawnRarity[];
  pokemonSpeciesData: PokemonSpecies[];
  raidBossesData: CurrentRaidBossesData | null;
  error: string | null;
  pvpMetaError: string | null;
  rarityError: string | null;
  raidBossesError: string | null;
  loading: boolean;
};

type Mode = "lookup" | "raid" | "stats" | "pvp" | "rarity";
type TypeFilterMode = "or" | "and";
type PvpSquadEntry = {
  percentile: number | null;
  leagueReady: boolean;
};

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
const PVP_LEAGUE_CP_CAP: Record<PvpLeague, number> = {
  great: 1500,
  ultra: 2500,
  master: 9999,
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

function TypeBadge({
  type,
  className = "type-pill",
  label,
}: {
  type: string | null | undefined;
  className?: string;
  label?: string;
}) {
  return (
    <span className={className} style={typeStyle(type)}>
      {label ?? type ?? "n/a"}
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

function normalizeTypeFilterSelection(selected: string[], allTypesList: string[]): string[] {
  const valid = selected.filter((type) => allTypesList.includes(type));
  if (valid.length === 0 || valid.length === allTypesList.length) {
    return allTypesList;
  }
  return valid;
}

function toggleTypeFilterSelection(current: string[], type: string, allTypesList: string[]): string[] {
  const effectiveCurrent = normalizeTypeFilterSelection(current, allTypesList);
  const isAllSelected = effectiveCurrent.length === allTypesList.length;
  if (isAllSelected) {
    return [type];
  }

  if (effectiveCurrent.includes(type)) {
    const next = effectiveCurrent.filter((entry) => entry !== type);
    return next.length === 0 ? [] : next;
  }

  const next = [...effectiveCurrent, type];
  return next.length === allTypesList.length ? [] : next;
}

function cpAtLevel40(pokemon: PokemonEntry): number | null {
  const attack = pokemon.base_stats.attack;
  const defense = pokemon.base_stats.defense;
  const stamina = pokemon.base_stats.stamina;
  if (!attack || !defense || !stamina) {
    return null;
  }
  const cpm = 0.7903;
  const attackIv = attack + 15;
  const defenseIv = defense + 15;
  const staminaIv = stamina + 15;
  const cp = Math.floor((attackIv * Math.sqrt(defenseIv) * Math.sqrt(staminaIv) * cpm * cpm) / 10);
  return Math.max(10, cp);
}

function cpAtLevel50Hundo(pokemon: PokemonEntry): number | null {
  const attack = pokemon.base_stats.attack;
  const defense = pokemon.base_stats.defense;
  const stamina = pokemon.base_stats.stamina;
  if (!attack || !defense || !stamina) {
    return null;
  }
  const cpm = 0.84029999;
  const cp = Math.floor(((attack + 15) * Math.sqrt(defense + 15) * Math.sqrt(stamina + 15) * cpm * cpm) / 10);
  return Math.max(10, cp);
}

function canReachLeagueCap(pokemon: PokemonEntry, league: PvpLeague): boolean {
  if (league === "master") {
    return true;
  }
  const maxCp = cpAtLevel50Hundo(pokemon);
  if (maxCp === null) {
    return true;
  }
  return maxCp >= PVP_LEAGUE_CP_CAP[league];
}

function requiresXlCandyForLeague(pokemon: PokemonEntry, league: PvpLeague): boolean {
  if (league === "master") {
    return false;
  }
  const cap = PVP_LEAGUE_CP_CAP[league];
  const level40Cp = cpAtLevel40(pokemon);
  const hundoNeedsXl = level40Cp !== null && level40Cp < cap;
  const bulkLevel = maxLevelUnderCapForIvs(pokemon, cap, 0, 15, 15);
  const bulkBuildNeedsXl = bulkLevel !== null && bulkLevel > 40;
  return hundoNeedsXl || bulkBuildNeedsXl;
}

function attackMultiplierAgainstPokemon(
  attackType: string,
  defenderTypes: string[],
  typeEffectiveness: Record<string, Record<string, number>>,
): number | null {
  const table = typeEffectiveness[attackType];
  if (!table || !defenderTypes.length) {
    return null;
  }
  let multiplier = 1;
  for (const defenderType of defenderTypes) {
    const value = table[defenderType];
    if (typeof value === "number") {
      multiplier *= value;
    }
  }
  return multiplier;
}

function isDoubleWeakness(multiplier: number | null): boolean {
  return multiplier !== null && multiplier > 1.6;
}

function isDoubleResistance(multiplier: number | null): boolean {
  return multiplier !== null && multiplier < 0.625;
}

function multiplierScore(multiplier: number): number {
  if (multiplier <= 0.391) {
    return 2;
  }
  if (multiplier <= 0.625) {
    return 1;
  }
  if (multiplier >= 2.56) {
    return -2;
  }
  if (multiplier >= 1.6) {
    return -1;
  }
  return 0;
}

function moveTypeId(moveName: string): string {
  return normalizeSpeciesId(moveName).toUpperCase();
}

function moveTypesForPvpRow(
  row: GreatLeagueCombinedRow,
  pokemon: PokemonEntry | null,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!pokemon) {
    return out;
  }
  const fromPool = [
    ...pokemon.moves.fast,
    ...pokemon.moves.charged,
    ...pokemon.moves.elite_fast,
    ...pokemon.moves.elite_charged,
  ];
  const lookup = new Map<string, string | null>();
  fromPool.forEach((move) => {
    lookup.set(moveTypeId(move.name), move.type ?? null);
  });
  row.pvpoke.moveset.forEach((moveId) => {
    out.set(moveId, lookup.get(moveId) ?? null);
  });
  return out;
}

function moveTypeForSelectedMove(moveId: string | null | undefined, pokemon: PokemonEntry | null): string | null {
  if (!moveId || !pokemon) {
    return null;
  }
  const fromPool = [
    ...pokemon.moves.fast,
    ...pokemon.moves.charged,
    ...pokemon.moves.elite_fast,
    ...pokemon.moves.elite_charged,
  ];
  const move = fromPool.find((entry) => moveTypeId(entry.name) === moveId);
  return move?.type ?? null;
}

type TeamBuilderEntry = {
  row: GreatLeagueCombinedRow;
  pokemon: PokemonEntry | null;
};

type TeamSlotMoves = {
  fast: string | null;
  charged1: string | null;
  charged2: string | null;
};

type SavedTeam = {
  id: string;
  name: string;
  league: PvpLeague;
  slots: Array<string | null>;
  slotMoves: TeamSlotMoves[];
  savedAt: string;
};

type TeamSaveDraft = {
  open: boolean;
  name: string;
  action: "save" | "rename";
};

function pvpCacheKey(league: PvpLeague): string {
  return `pogo_pvp_meta_cache_${league}`;
}

function pvpSquadStorageKey(): string {
  return "pogo_pvp_squad";
}

function readCachedPvpMeta(league: PvpLeague): GreatLeagueCombinedData | null {
  try {
    const raw = localStorage.getItem(pvpCacheKey(league));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as GreatLeagueCombinedData;
    if (!parsed || !Array.isArray(parsed.pvpoke_rankings)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedPvpMeta(league: PvpLeague, payload: GreatLeagueCombinedData): void {
  try {
    localStorage.setItem(pvpCacheKey(league), JSON.stringify(payload));
  } catch {
    // ignore cache write failures
  }
}

function defenseScoreForType(
  attackType: string,
  team: TeamBuilderEntry[],
  typeEffectiveness: Record<string, Record<string, number>>,
): number {
  const multipliers = team
    .map((entry) => {
      if (!entry.pokemon) {
        return null;
      }
      return attackMultiplierAgainstPokemon(attackType, entry.pokemon.types, typeEffectiveness);
    })
    .filter((value): value is number => value !== null);
  if (!multipliers.length) {
    return 0;
  }
  const base = multipliers.reduce((sum, value) => sum + multiplierScore(value), 0);
  const hasResist = multipliers.some((value) => value <= 0.625);
  const allWeak = multipliers.length > 0 && multipliers.every((value) => value >= 1.6);
  const noNeutralOrBetter = multipliers.length > 0 && multipliers.every((value) => value > 1.0);
  const withBonus = base + (hasResist ? 1 : 0) - (allWeak ? 2 : 0) - (noNeutralOrBetter ? 3 : 0);
  return Math.max(-6, Math.min(6, withBonus));
}

function offenseScoreForType(
  defenderType: string,
  team: TeamBuilderEntry[],
  slotMoves: TeamSlotMoves[],
  typeEffectiveness: Record<string, Record<string, number>>,
): number {
  let total = 0;
  let fastSeUsers = 0;
  let chargedSeUsers = 0;
  let neutralUsers = 0;

  team.forEach((entry, index) => {
    if (!entry.pokemon) {
      return;
    }
    const selection = slotMoves[index];
    const fastType = moveTypeForSelectedMove(selection?.fast, entry.pokemon);
    const chargedTypes = [
      moveTypeForSelectedMove(selection?.charged1, entry.pokemon),
      moveTypeForSelectedMove(selection?.charged2, entry.pokemon),
    ].filter((value): value is string => Boolean(value));

    const fastMult = fastType ? typeEffectiveness[fastType]?.[defenderType] ?? 1 : 1;
    const chargedMultipliers = chargedTypes.map((type) => typeEffectiveness[type]?.[defenderType] ?? 1);
    const bestCharged = chargedMultipliers.length ? Math.max(...chargedMultipliers) : 1;
    const bestAny = Math.max(fastMult, bestCharged);
    const hasStabCoverage =
      [fastType, ...chargedTypes].some((type) => Boolean(type && entry.pokemon?.types.includes(type)));

    if (fastMult > 1) {
      fastSeUsers += 1;
      total += 1.35;
    } else if (fastMult >= 1) {
      total += 0.25;
    } else {
      total -= 0.25;
    }

    if (bestCharged > 1) {
      chargedSeUsers += 1;
      total += 0.65;
    } else if (bestCharged >= 1) {
      total += 0.15;
    } else {
      total -= 0.2;
    }

    if (bestAny >= 1) {
      neutralUsers += 1;
    }
    if (hasStabCoverage && bestAny > 1) {
      total += 0.25;
    }
  });

  if (fastSeUsers >= 2 || (fastSeUsers >= 1 && chargedSeUsers >= 2)) {
    return 2;
  }
  if (total >= 2.2 || fastSeUsers >= 1 || chargedSeUsers >= 2) {
    return 1;
  }
  if (neutralUsers >= 2 || total >= 0.35) {
    return 0;
  }
  return -1;
}

function teamOffenseChipClass(score: number): string {
  if (score >= 2) return "team-chip-alert-2";
  if (score >= 1) return "team-chip-alert-1";
  if (score >= 0) return "team-chip-caution-text";
  return "team-chip-muted-2";
}

function selectedTeamWeaknessTypes(team: TeamBuilderEntry[]): string[] {
  return Array.from(new Set(team.flatMap((entry) => entry.row.pvpoke.weaknesses))).filter(Boolean);
}

function selectedTeamStrengthTypes(team: TeamBuilderEntry[]): Set<string> {
  return new Set(team.flatMap((entry) => entry.row.pvpoke.resistances).filter(Boolean));
}

function teamResistsType(
  team: TeamBuilderEntry[],
  attackType: string,
  typeEffectiveness: Record<string, Record<string, number>>,
): boolean {
  return team.some((entry) => {
    if (!entry.pokemon) {
      return false;
    }
    const multiplier = attackMultiplierAgainstPokemon(attackType, entry.pokemon.types, typeEffectiveness);
    return multiplier !== null && multiplier < 1;
  });
}

function scoreTeamRecommendation(
  candidate: TeamBuilderEntry,
  selectedTeam: TeamBuilderEntry[],
  typeEffectiveness: Record<string, Record<string, number>>,
): number {
  if (!candidate.pokemon) {
    return Number.NEGATIVE_INFINITY;
  }

  const teamWeaknesses = selectedTeamWeaknessTypes(selectedTeam);
  const teamStrengths = selectedTeamStrengthTypes(selectedTeam);
  let score = 0;

  teamWeaknesses.forEach((attackType) => {
    const multiplier = attackMultiplierAgainstPokemon(attackType, candidate.pokemon?.types ?? [], typeEffectiveness);
    if (multiplier === null) {
      return;
    }
    if (multiplier < 0.625) {
      score += 7;
    } else if (multiplier < 1) {
      score += 5;
    } else if (multiplier === 1) {
      score += 1;
    } else {
      score -= 5;
    }
  });

  candidate.row.pvpoke.resistances.forEach((attackType) => {
    score += teamStrengths.has(attackType) ? 1 : 4;
  });

  candidate.row.pvpoke.weaknesses.forEach((attackType) => {
    if (teamResistsType(selectedTeam, attackType, typeEffectiveness)) {
      score += 2;
    } else {
      score -= 4;
    }
  });

  score += Math.max(0, 1000 - (candidate.row.pvpoke.rank ?? 1000)) / 1000;
  return score;
}

function rankTeamRecommendations(
  selectedTeam: TeamBuilderEntry[],
  candidates: TeamBuilderEntry[],
  typeEffectiveness: Record<string, Record<string, number>>,
): string[] {
  const selectedIds = new Set(selectedTeam.map((entry) => entry.row.canonical_id));
  return candidates
    .filter((entry) => entry.pokemon && !selectedIds.has(entry.row.canonical_id))
    .map((entry) => ({
      id: entry.row.canonical_id,
      score: scoreTeamRecommendation(entry, selectedTeam, typeEffectiveness),
      rank: entry.row.pvpoke.rank ?? 999999,
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score || left.rank - right.rank)
    .slice(0, 80)
    .map((entry) => entry.id);
}

function teamDefenseMetaForType(
  attackType: string,
  team: TeamBuilderEntry[],
  typeEffectiveness: Record<string, Record<string, number>>,
): {
  chipClass: string;
  label: string;
} {
  const multipliers = team
    .map((entry) => {
      if (!entry.pokemon) {
        return null;
      }
      return attackMultiplierAgainstPokemon(attackType, entry.pokemon.types, typeEffectiveness);
    })
    .filter((value): value is number => value !== null);
  if (!multipliers.length) {
    return { chipClass: "team-chip-muted-1", label: attackType };
  }

  const goodCount = multipliers.filter((value) => value <= 0.625).length;
  const weakCount = multipliers.filter((value) => value >= 1.6).length;
  const hasDoubleWeak = multipliers.some((value) => value >= 2.56);
  const allNeutralOrBetter = multipliers.every((value) => value <= 1);

  let chipClass = "team-chip-muted-1";
  if (weakCount >= 2) {
    chipClass = "team-chip-alert-2";
  } else if (hasDoubleWeak) {
    chipClass = "team-chip-alert-1";
  } else if (weakCount >= 1) {
    chipClass = "team-chip-caution-text";
  } else if (allNeutralOrBetter) {
    chipClass = "team-chip-muted-2";
  }

  if (goodCount >= 2) {
    return { chipClass, label: `\u2620 ${attackType} \u2620` };
  }
  if (goodCount >= 1) {
    return { chipClass, label: `\u2620 ${attackType}` };
  }
  return { chipClass, label: attackType };
}

function teamDefenseChipStyle(type: string, chipClass: string): CSSProperties {
  const base = typeStyle(type);
  if (chipClass === "team-chip-caution-text") {
    const cautionTextColor =
      base.color === "#f8fbff" ? "rgba(242, 247, 255, 0.68)" : "rgba(16, 19, 26, 0.68)";
    return {
      ...base,
      backgroundImage:
        "linear-gradient(rgba(106, 112, 126, 0.68), rgba(106, 112, 126, 0.68)), linear-gradient(rgba(6, 9, 14, 0.58), rgba(6, 9, 14, 0.58))",
      borderColor: "rgba(170, 182, 204, 0.14)",
      color: cautionTextColor,
    };
  }
  if (chipClass === "team-chip-muted-1") {
    return {
      ...base,
      backgroundColor: "#333946",
      backgroundImage: "none",
      borderColor: "rgba(164, 176, 198, 0.12)",
      color: "rgba(242, 247, 255, 0.68)",
    };
  }
  if (chipClass === "team-chip-muted-2") {
    return {
      ...base,
      backgroundColor: "#242a34",
      backgroundImage: "none",
      borderColor: "rgba(150, 162, 184, 0.1)",
      color: "rgba(242, 247, 255, 0.54)",
    };
  }
  return {
    ...base,
    backgroundImage: "none",
  };
}

function TeamDefenseTypeChip({
  type,
  label,
  chipClass,
}: {
  type: string;
  label: string;
  chipClass: string;
}) {
  return (
    <span
      className={`pvp-row-type-chip pvp-fixed-type-chip team-defense-chip ${chipClass}`}
      style={teamDefenseChipStyle(type, chipClass)}
    >
      {label}
    </span>
  );
}

function TeamOffenseTypeChip({
  type,
  chipClass,
}: {
  type: string;
  chipClass: string;
}) {
  return (
    <span
      className={`pvp-row-type-chip pvp-fixed-type-chip team-offense-chip ${chipClass}`}
      style={teamDefenseChipStyle(type, chipClass)}
    >
      {type}
    </span>
  );
}

type MoveOption = {
  id: string;
  label: string;
  type: string | null;
};

function dedupeMoveOptions(rows: MoveEntry[], fallbackKind: "Fast" | "Charged"): MoveOption[] {
  const seen = new Set<string>();
  const options: MoveOption[] = [];
  rows.forEach((move) => {
    const name = move.name?.trim();
    if (!name) {
      return;
    }
    const id = moveTypeId(name);
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    const elite = move.move_kind?.startsWith("elite") ? " (Elite)" : "";
    options.push({ id, label: `${name}${elite}`, type: move.type ?? null });
  });
  if (!options.length) {
    options.push({ id: "", label: `${fallbackKind} move unavailable`, type: null });
  }
  return options;
}

function recommendedMovesForEntry(entry: TeamBuilderEntry): TeamSlotMoves {
  const fastOptions = dedupeMoveOptions(
    [...(entry.pokemon?.moves.fast ?? []), ...(entry.pokemon?.moves.elite_fast ?? [])],
    "Fast",
  );
  const chargedOptions = dedupeMoveOptions(
    [...(entry.pokemon?.moves.charged ?? []), ...(entry.pokemon?.moves.elite_charged ?? [])],
    "Charged",
  );
  const moveIds = entry.row.pvpoke.moveset ?? [];
  const defaultFast = fastOptions.find((option) => option.id === moveIds[0])?.id ?? fastOptions[0]?.id ?? null;
  const defaultCharged1 = chargedOptions.find((option) => option.id === moveIds[1])?.id ?? chargedOptions[0]?.id ?? null;
  const defaultCharged2 = chargedOptions.find((option) => option.id === moveIds[2])?.id ?? chargedOptions[0]?.id ?? null;
  return {
    fast: defaultFast,
    charged1: defaultCharged1,
    charged2: defaultCharged2,
  };
}

function scoreBandClass(score: number, domain: "defense" | "offense"): string {
  if (domain === "defense") {
    if (score >= 3) return "team-chip-muted-2";
    if (score >= 1) return "team-chip-muted-1";
    if (score >= -1) return "team-chip-alert-1";
    return "team-chip-alert-2";
  }
  if (score <= -1) return "team-chip-muted-2";
  if (score <= 0) return "team-chip-muted-1";
  if (score <= 1) return "team-chip-alert-1";
  return "team-chip-alert-2";
}

function normalizeSpeciesId(value: string): string {
  return normalizeQuery(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function moveIdToLabel(moveId: string): string {
  return moveId
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1)}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function moveNameToId(moveName: string): string {
  return normalizeSpeciesId(moveName).toUpperCase();
}

function pvpScoreBand(score: number): "legend" | "elite" | "strong" | "core" | "fringe" {
  if (score >= 92) {
    return "legend";
  }
  if (score >= 88) {
    return "elite";
  }
  if (score >= 84) {
    return "strong";
  }
  if (score >= 80) {
    return "core";
  }
  return "fringe";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    return null;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return null;
  }
  return { r, g, b };
}

function pvpRowTypeTint(primaryType: string | null | undefined): CSSProperties {
  const hex = primaryType ? TYPE_COLORS[primaryType] ?? "#61708c" : "#61708c";
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return {};
  }
  return {
    backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`,
    borderLeftColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.7)`,
  };
}

function prettyToken(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((token) => `${token.charAt(0).toUpperCase()}${token.slice(1)}`)
    .join(" ");
}

function rarityKey(entry: Pick<SpawnRarity, "pokemonId" | "form">): string {
  return `${entry.pokemonId}::${normalizeQuery(entry.form ?? "Normal")}`;
}

function rarityTierColor(tier: string): string {
  switch (tier) {
    case "common":
      return "#3ea96f";
    case "uncommon":
      return "#5f92ff";
    case "rare":
      return "#d58f2a";
    case "super_rare":
      return "#c160d7";
    case "ultra_rare":
      return "#d64343";
    case "event_only":
      return "#8c58ff";
    case "not_wild":
      return "#6a7180";
    default:
      return "#4f596d";
  }
}

function RarityPill({ value }: { value: string | null | undefined }) {
  const color = rarityTierColor(value ?? "unknown");
  return (
    <span className="type-pill" style={{ backgroundColor: color, borderColor: color, color: "#f8fbff" }}>
      {prettyToken(value)}
    </span>
  );
}

function pokemonSpeciesIds(pokemon: PokemonEntry): string[] {
  const base = normalizeSpeciesId(pokemon.name);
  const ids: string[] = [];
  const form = normalizeSpeciesId(pokemon.form);
  // Only normal/default forms claim the base species key. Otherwise form rows
  // overwrite base lookups (e.g. Stunfisk vs Stunfisk_Galarian in PvP rows).
  if (!form || form === "normal") {
    ids.push(base);
    return ids;
  }
  ids.push(`${base}_${form === "alola" ? "alolan" : form}`);
  return ids;
}

function pvpIvTier(percentile: number | null): "bronze" | "silver" | "gold" {
  const value = percentile ?? 0;
  if (value >= 90) return "gold";
  if (value >= 67) return "silver";
  return "bronze";
}

function pvpFormAliasToLocalForm(alias: string): string {
  const normalized = normalizeSpeciesId(alias);
  switch (normalized) {
    case "altered":
    case "overcast":
    case "standard":
    case "incarnate":
    case "midday":
    case "land":
    case "full_belly":
    case "shield":
    case "blade":
      return "normal";
    default:
      return normalized;
  }
}

function pvpRowBaseName(name: string): string {
  return name
    .replace(/\s*\(shadow\)\s*/gi, " ")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pvpRowDisplayName(name: string): string {
  const base = pvpRowBaseName(name);
  if (normalizeQuery(base) !== "gourgeist") {
    return base;
  }
  const nonShadowParens = [...name.matchAll(/\(([^)]+)\)/g)]
    .map((match) => match[1].trim())
    .filter((token) => normalizeQuery(token) !== "shadow");
  const sizeToken = nonShadowParens[0];
  return sizeToken ? `${base} (${sizeToken})` : base;
}

function pvpRowIsShadow(name: string): boolean {
  return /\(\s*shadow\s*\)/i.test(name);
}

function resolveLocalPokemonForPvpRow(
  row: GreatLeagueCombinedRow,
  pokemonBySpeciesId: Map<string, PokemonEntry>,
  allPokemon: PokemonEntry[],
): PokemonEntry | null {
  const direct = pokemonBySpeciesId.get(normalizeSpeciesId(row.local_lookup_species_id)) ?? null;
  if (direct) {
    return direct;
  }

  const baseName = normalizeQuery(pvpRowBaseName(row.name));
  if (!baseName) {
    return null;
  }
  const candidates = allPokemon.filter((entry) => normalizeQuery(entry.name) === baseName);
  if (!candidates.length) {
    return null;
  }

  const idParts = normalizeSpeciesId(row.local_lookup_species_id).split("_").filter(Boolean);
  const formHints = new Set<string>();
  if (idParts.length > 1) {
    idParts.slice(1).forEach((part) => {
      if (part !== "shadow") {
        formHints.add(pvpFormAliasToLocalForm(part));
      }
    });
  }
  const parenMatches = [...row.name.matchAll(/\(([^)]+)\)/g)];
  parenMatches.forEach((match) => {
    const token = normalizeSpeciesId(match[1]);
    if (token && token !== "shadow") {
      formHints.add(pvpFormAliasToLocalForm(token));
    }
  });

  for (const hint of formHints) {
    const matched = candidates.find((entry) => normalizeSpeciesId(entry.form) === hint);
    if (matched) {
      return matched;
    }
  }
  return candidates.find((entry) => normalizeSpeciesId(entry.form) === "normal") ?? candidates[0] ?? null;
}

function pokemonRegionLabel(pokemon: PokemonEntry): string {
  const region = POKEMON_REGIONS.find((entry) => pokemon.dex <= entry.maxDex);
  if (!region) {
    return "Unknown";
  }
  return `${region.region}-${region.generation}`;
}

function pokemonGeneration(pokemon: PokemonEntry): number {
  const region = POKEMON_REGIONS.find((entry) => pokemon.dex <= entry.maxDex);
  return region?.generation ?? 0;
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

function formAwareEvolutionChain(selected: PokemonEntry, allPokemon: PokemonEntry[]): PokemonEntry[] {
  const selectedName = normalizeQuery(selected.name);
  const targetForm = normalizeQuery(selected.form);
  const selectedFinalNames = new Set(selected.evolution.final_evolution_names.map((name) => normalizeQuery(name)));
  const selectedTypes = new Set(selected.types.map((type) => normalizeQuery(type)));
  const formMatchScore = (entry: PokemonEntry): number => (normalizeQuery(entry.form) === targetForm ? 1 : 0);
  const typeOverlap = (entry: PokemonEntry): number =>
    entry.types.map((type) => normalizeQuery(type)).filter((type) => selectedTypes.has(type)).length;

  const inFamily = allPokemon.filter(
    (entry) =>
      !entry.derived.cosmetic_diff &&
      normalizeQuery(entry.evolution.family_root ?? "") === normalizeQuery(selected.evolution.family_root ?? ""),
  );

  let chosenFinalName: string | null = null;
  if (!selected.evolution.is_final_evolution) {
    const finalOptions = inFamily.filter((entry) => selectedFinalNames.has(normalizeQuery(entry.name)));
    finalOptions.sort((left, right) => {
      return (
        typeOverlap(right) - typeOverlap(left) ||
        formMatchScore(right) - formMatchScore(left) ||
        (right.evolution.evolution_stage ?? 0) - (left.evolution.evolution_stage ?? 0) ||
        right.pokemon_id - left.pokemon_id
      );
    });
    chosenFinalName = finalOptions.length ? normalizeQuery(finalOptions[0].name) : null;
  }

  const branchCandidates = inFamily.filter((entry) => {
    const entryName = normalizeQuery(entry.name);
    if (entryName === selectedName) {
      return true;
    }
    const entryFinals = entry.evolution.final_evolution_names.map((name) => normalizeQuery(name));
    if (selected.evolution.is_final_evolution) {
      return entryFinals.includes(selectedName);
    }
    if (chosenFinalName) {
      return entryName === chosenFinalName || entryFinals.includes(chosenFinalName);
    }
    return entryFinals.some((name) => selectedFinalNames.has(name));
  });

  const byName = new Map<string, PokemonEntry[]>();
  branchCandidates.forEach((entry) => {
    const key = normalizeQuery(entry.name);
    const current = byName.get(key) ?? [];
    current.push(entry);
    byName.set(key, current);
  });

  const resolved: PokemonEntry[] = [];
  for (const entries of byName.values()) {
    const isSelectedSpeciesGroup = entries.some((entry) => normalizeQuery(entry.name) === selectedName);
    const exactSelected =
      entries.find(
        (entry) => entry.pokemon_id === selected.pokemon_id && normalizeQuery(entry.form) === normalizeQuery(selected.form),
      ) ?? null;
    const sameForm = entries.find((entry) => normalizeQuery(entry.form) === targetForm) ?? null;
    const bestTypeFit =
      [...entries].sort(
        (left, right) =>
          typeOverlap(right) - typeOverlap(left) ||
          formMatchScore(right) - formMatchScore(left) ||
          left.form.localeCompare(right.form),
      )[0] ?? null;
    const normalForm = entries.find((entry) => normalizeQuery(entry.form) === "normal") ?? null;
    resolved.push(
      exactSelected ??
      (isSelectedSpeciesGroup ? sameForm : null) ??
      bestTypeFit ??
      sameForm ??
      normalForm ??
      entries[0],
    );
  }

  resolved.sort((left, right) => {
    const leftStage = left.evolution.evolution_stage ?? 0;
    const rightStage = right.evolution.evolution_stage ?? 0;
    if (leftStage !== rightStage) {
      return leftStage - rightStage;
    }
    if (left.pokemon_id !== right.pokemon_id) {
      return left.pokemon_id - right.pokemon_id;
    }
    if (left.pokemon_id === selected.pokemon_id && normalizeQuery(left.form) === targetForm) {
      return 1;
    }
    if (right.pokemon_id === selected.pokemon_id && normalizeQuery(right.form) === targetForm) {
      return -1;
    }
    return left.form.localeCompare(right.form);
  });

  const deduped: PokemonEntry[] = [];
  const seen = new Set<string>();
  resolved.forEach((entry) => {
    const key = `${entry.pokemon_id}::${normalizeQuery(entry.form)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(entry);
    }
  });

  return deduped.length ? deduped : [selected];
}

function statCard(label: string, value: number | null | undefined) {
  return (
    <div>
      <label>{label}</label>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function isEliteMoveKind(moveKind: string | null): boolean {
  return moveKind === "elite_fast" || moveKind === "elite_charged";
}

type MoveTableKind = "fast" | "charged";

function moveTableRows(
  pokemon: PokemonEntry,
  defenderTypes: string[],
  weather: WeatherName,
  typeEffectiveness: MergedData["type_effectiveness"],
  tableKind: MoveTableKind,
) {
  const moves = scorePokemon(pokemon, defenderTypes, weather, typeEffectiveness).moves;
  if (tableKind === "fast") {
    return moves.filter((move) => move.move_kind === "fast" || move.move_kind === "elite_fast");
  }
  return moves.filter((move) => move.move_kind === "charged" || move.move_kind === "elite_charged");
}

function MoveTable({
  pokemon,
  title,
  kind,
  defenderTypes,
  weather,
  typeEffectiveness,
}: {
  pokemon: PokemonEntry;
  title: string;
  kind: MoveTableKind;
  defenderTypes: string[];
  weather: WeatherName;
  typeEffectiveness: MergedData["type_effectiveness"];
}) {
  const rows = moveTableRows(pokemon, defenderTypes, weather, typeEffectiveness, kind);
  return (
    <section className="panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <span>{rows.length} moves</span>
      </div>
      <div className="table">
        <div className="table-row table-head table-9">
          <span>Name</span>
          <span>Legacy</span>
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
            <span>{isEliteMoveKind(row.move_kind) ? "Elite TM" : "-"}</span>
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
  rarityTierText,
}: {
  pokemon: PokemonEntry;
  targetTypes: string[];
  weather: WeatherName;
  typeEffectiveness: MergedData["type_effectiveness"];
  meaningfulFormCountByName: Map<string, number>;
  rarityTierText?: string | null;
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
          <div className="pokemon-title-row">
            <div className="pokemon-title">
              #{pokemon.dex} {pokemon.name}
              {pokemonDisplayForm(pokemon, meaningfulFormCountByName) ? (
                <span className="pokemon-form-inline"> ({pokemonDisplayForm(pokemon, meaningfulFormCountByName)})</span>
              ) : null}
            </div>
            {rarityTierText ? <strong className="pokemon-rarity-inline">{rarityTierText}</strong> : null}
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
          kind="fast"
          defenderTypes={targetTypes}
          weather={weather}
          typeEffectiveness={typeEffectiveness}
        />
        <MoveTable
          pokemon={pokemon}
          title="Charged moves"
          kind="charged"
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

function StatsTargets({ types }: { types: string[] }) {
  if (!types.length) {
    return <span className="pokemon-form-inline">-</span>;
  }
  return (
    <span className="type-row compact stats-type-icons">
      {types.map((type) => (
        <TypeSymbol key={type} type={type} />
      ))}
    </span>
  );
}

function StatsRankingTable({
  rows,
  cpMode,
  sortMode,
  meaningfulFormCountByName,
}: {
  rows: StatsMovesetRow[];
  cpMode: CpMode;
  sortMode: StatsSortMode;
  meaningfulFormCountByName: Map<string, number>;
}) {
  const collapsedRows = useMemo(() => {
    const grouped = new Map<string, { row: StatsMovesetRow; forms: Set<string>; key: string }>();
    rows.forEach((row) => {
      const key = [
        normalizeQuery(row.pokemon.name),
        raidMoveKey(row.fast_move),
        raidMoveKey(row.charged_move),
        row.cp,
        row.attack,
        row.defense,
        row.hp,
        row.basic_cycle_dps.toFixed(3),
      ].join("::");
      const existing = grouped.get(key);
      if (existing) {
        existing.forms.add(normalizeQuery(row.pokemon.form));
        return;
      }
      grouped.set(key, { row, forms: new Set([normalizeQuery(row.pokemon.form)]), key });
    });
    return Array.from(grouped.values());
  }, [rows]);

  return (
    <section className="panel ranking-panel raid-panel">
      <div className="table raid-table">
        <div className="table-row table-head stats-table-head">
          <span>Pokemon</span>
          <span>Atk</span>
          <span>Def</span>
          <span>HP</span>
          <span>Tankiness</span>
          <span>Moveset</span>
          <span>Cycle DPS</span>
          <span>Best targets</span>
          <span>CP ({cpMode === "level40" ? "L40" : "L50"})</span>
          <span>Not effective vs</span>
        </div>
        {collapsedRows.map((displayEntry) => {
          const entry = displayEntry.row;
          const formLabel =
            displayEntry.forms.size > 1 ? "Various" : pokemonDisplayForm(entry.pokemon, meaningfulFormCountByName);
          return (
            <div className="table-row stats-table-row" key={displayEntry.key}>
              <span className="pokemon-name-cell raid-pokemon-cell">
                <PokemonIcon pokemon={entry.pokemon} className="pokemon-icon pokemon-icon-table" />
                <span className="pokemon-name-inline">
                  <strong>{entry.pokemon.name}</strong>
                  {formLabel ? <span className="pokemon-form-inline"> ({formLabel})</span> : null}
                  <span className="pokemon-region-inline">{pokemonRegionLabel(entry.pokemon)}</span>
                </span>
                <span className="type-row compact raid-type-icons">
                  {entry.pokemon.types.map((type) => (
                    <TypeSymbol key={type} type={type} />
                  ))}
                </span>
              </span>
              <span>{entry.attack}</span>
              <span>{entry.defense}</span>
              <span>{entry.hp}</span>
              <span>{entry.tankiness}</span>
              <span className="raid-moveset-cell">
                <span>{raidMoveDisplay(entry.fast_move.name, entry.fast_move.type, entry.fast_move.move_kind, true)}</span>
                <span className="raid-moveset-separator">/</span>
                <span>{raidMoveDisplay(entry.charged_move.name, entry.charged_move.type, entry.charged_move.move_kind, true)}</span>
              </span>
              <span>{entry.basic_cycle_dps.toFixed(2)}</span>
              <span>
                <StatsTargets types={entry.best_target_types} />
              </span>
              <span>{entry.cp}</span>
              <span><StatsTargets types={entry.resisted_targets} /></span>
            </div>
          );
        })}
      </div>
      <div className="ranking-summary raid-summary-footer">
        <span>
          <strong>Rows:</strong> {collapsedRows.length}
        </span>
        <span>
          <strong>Sort:</strong> {sortMode}
        </span>
      </div>
    </section>
  );
}

function PvpMetaTable({
  rows,
  selectedId,
  onSelect,
  pokemonByCanonicalId,
  league,
  collectionViewEnabled,
  squadByCanonicalId,
}: {
  rows: GreatLeagueCombinedRow[];
  selectedId: string | null;
  onSelect: (row: GreatLeagueCombinedRow) => void;
  pokemonByCanonicalId: Map<string, PokemonEntry>;
  league: PvpLeague;
  collectionViewEnabled: boolean;
  squadByCanonicalId: Record<string, PvpSquadEntry | undefined>;
}) {
  return (
    <section className="panel ranking-panel raid-panel">
      <div className="table raid-table">
        <div className="table-row table-head pvp-meta-table-head">
          <span>Rank</span>
          <span>Pokemon</span>
          <span>Type</span>
          <span>Score</span>
        </div>
        {rows.map((row) => {
          const isActive = selectedId === row.canonical_id;
          const pokemon = pokemonByCanonicalId.get(row.canonical_id) ?? null;
          const squadEntry = squadByCanonicalId[row.canonical_id];
          const scoreBand = pvpScoreBand(row.pvpoke.score);
          const primaryType = pokemon?.types?.[0] ?? null;
          const localMoveTypes = new Map<string, string | null>();
          if (pokemon) {
            const allMoves = [
              ...pokemon.moves.fast,
              ...pokemon.moves.charged,
              ...pokemon.moves.elite_fast,
              ...pokemon.moves.elite_charged,
            ];
            allMoves.forEach((move) => {
              localMoveTypes.set(moveNameToId(move.name), move.type ?? null);
            });
          }
          return (
            <button
              key={row.canonical_id}
              type="button"
              className={isActive ? `table-row pvp-meta-row active score-${scoreBand}` : `table-row pvp-meta-row score-${scoreBand}`}
              style={pvpRowTypeTint(primaryType)}
              onClick={() => onSelect(row)}
            >
              <span>#{row.pvpoke.rank}</span>
              <span className="pvp-name-cell">
                {pokemon ? <PokemonIcon pokemon={pokemon} className="pokemon-icon pokemon-icon-table" /> : null}
                <span className="pvp-name-stack">
                  <strong className="pvp-name-title">
                    {pvpRowIsShadow(row.name) ? <em className="pvp-shadow-prefix">Shadow </em> : null}
                    {pvpRowDisplayName(row.name)}
                    {pokemon && requiresXlCandyForLeague(pokemon, league) ? <span className="pvp-levelup-xl-tag">XL</span> : null}
                  </strong>
                  <span className="pvp-row-moveset">
                    {row.pvpoke.moveset.map((moveId, index) => {
                      const moveType = localMoveTypes.get(moveId) ?? null;
                      const eliteFlag = row.pvpoke.recommended_move_elite_flags?.[index] ?? false;
                      const unresolvedByStatus =
                        row.pvpoke.recommended_move_statuses?.[index] === "missing_on_species" ||
                        row.pvpoke.recommended_move_statuses?.[index] === "missing_globally";
                      const unresolvedFlag = row.pvpoke.recommended_move_unresolved_flags?.[index] ?? unresolvedByStatus;
                      const marker = unresolvedFlag ? " !" : eliteFlag ? " *" : "";
                      return (
                        <span key={`${row.canonical_id}-row-move-${moveId}-${index}`} className="pvp-row-move-label" style={{ color: typeStyle(moveType).backgroundColor as string }}>
                          {moveIdToLabel(moveId)}
                          {marker}
                          {index === 0 && row.pvpoke.moveset.length > 1 ? (
                            <span className="pvp-row-move-sep"> | </span>
                          ) : index > 0 && index < row.pvpoke.moveset.length - 1 ? (
                            <span className="pvp-row-move-sep"> / </span>
                          ) : null}
                        </span>
                      );
                    })}
                  </span>
                </span>
              </span>
              <span className="pvp-row-type-strip">
                {pokemon?.types?.length ? (
                  pokemon.types.map((type) => (
                    <TypeBadge key={`${row.canonical_id}-type-${type}`} type={type} className="pvp-row-type-chip" />
                  ))
                ) : (
                  <span className="raid-note">n/a</span>
                )}
              </span>
              <span className="pvp-score-cell">
                <span>{row.pvpoke.score.toFixed(1)}</span>
                {collectionViewEnabled && squadEntry ? (
                  squadEntry.leagueReady ? (
                    <span
                      className={`pvp-collection-badge pvp-collection-shield-badge pvp-collection-tier-${pvpIvTier(squadEntry.percentile)}`}
                      title={`${squadEntry.percentile ?? "n/a"}%`}
                    >
                      <span className="pvp-collection-percent">{squadEntry.percentile ?? "n/a"}%</span>
                    </span>
                  ) : (
                    <span className="pvp-collection-percent-only" title={`${squadEntry.percentile ?? "n/a"}%`}>
                      <span className="pvp-collection-percent">{squadEntry.percentile ?? "n/a"}%</span>
                    </span>
                  )
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PvpMetaDetail({
  row,
  pokemon,
  typeEffectiveness,
  meaningfulFormCountByName,
  allPokemon,
  league,
  squadEntry,
  onSaveSquad,
  onDeleteSquad,
}: {
  row: GreatLeagueCombinedRow | null;
  pokemon: PokemonEntry | null;
  typeEffectiveness: Record<string, Record<string, number>>;
  meaningfulFormCountByName: Map<string, number>;
  allPokemon: PokemonEntry[];
  league: PvpLeague;
  squadEntry: PvpSquadEntry | null;
  onSaveSquad: (rowId: string, entry: PvpSquadEntry) => void;
  onDeleteSquad: (rowId: string) => void;
}) {
  const [percentileDraft, setPercentileDraft] = useState("");
  const [leagueReadyDraft, setLeagueReadyDraft] = useState(false);
  const [squadEditorOpen, setSquadEditorOpen] = useState(false);

  useEffect(() => {
    if (!row) {
      setPercentileDraft("");
      setLeagueReadyDraft(false);
      setSquadEditorOpen(false);
      return;
    }
    setPercentileDraft(squadEntry?.percentile === null || squadEntry?.percentile === undefined ? "" : String(squadEntry.percentile));
    setLeagueReadyDraft(Boolean(squadEntry?.leagueReady));
    setSquadEditorOpen(false);
  }, [league, row?.canonical_id, squadEntry?.leagueReady, squadEntry?.percentile]);

  if (!row) {
    return (
      <section className="panel raid-banner">
        <div className="raid-note">Select a row to inspect recommended moveset, traits, weaknesses, and resistances.</div>
      </section>
    );
  }

  return (
    <section className="panel raid-banner">
      <div className="panel-header">
        <h3>#{row.pvpoke.rank} {pvpRowIsShadow(row.name) ? <em className="pvp-shadow-prefix">Shadow </em> : null}{pvpRowDisplayName(row.name)}</h3>
        <span>Score {row.pvpoke.score.toFixed(1)}</span>
      </div>
      <div className="pvp-local-card">
        {pokemon ? (
          <div className="pvp-hero-chain-row">
            {formAwareEvolutionChain(pokemon, allPokemon).map((member, index, members) => {
              const isActive =
                member.pokemon_id === pokemon.pokemon_id && normalizeQuery(member.form) === normalizeQuery(pokemon.form);
              return (
                <span key={`${member.pokemon_id}-${member.form}`} className="pvp-hero-chain-step">
                  <div className={isActive ? "pvp-hero-chain-card active" : "pvp-hero-chain-card"}>
                    <PokemonIcon pokemon={member} className="pokemon-icon pokemon-icon-pvp-hero" />
                    <div>
                      <strong>
                        {pokemonDisplayLabel(member, meaningfulFormCountByName)}
                      </strong>
                      <div className="type-row compact">
                        {member.types.map((type) => (
                          <TypeBadge
                            key={`${member.pokemon_id}-${member.form}-${type}`}
                            type={type}
                            className="pvp-row-type-chip pvp-fixed-type-chip"
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  {index < members.length - 1 ? <span className="pvp-hero-chain-arrow">{"->"}</span> : null}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="raid-note">No matching local Pokemon form found for {row.local_lookup_species_id}.</div>
        )}

        {league !== "master" ? (
          <div className="pvp-moveset-card">
            <div className="lookup-label">Level Up</div>
            <div className="pvp-levelup-grid">
              {pokemon ? (
                topGreatLeagueLevelUpCandidates(pokemon, PVP_LEAGUE_CP_CAP[league], 5).map((entry, index) => (
                  <div key={`${row.canonical_id}-lvl-${index}`} className="pvp-levelup-card">
                    <span className="pvp-levelup-cp">CP {entry.cp}</span>
                    <span className="pvp-levelup-main">
                      IV {entry.iv_attack}/{entry.iv_defense}/{entry.iv_stamina}
                    </span>
                    <span className="pvp-levelup-sub">
                      L{entry.level.toFixed(entry.level % 1 === 0 ? 0 : 1)} ({entry.dust_cost.toLocaleString()})
                      {entry.level > 40 ? <span className="pvp-levelup-xl-tag">XL</span> : null}
                    </span>
                  </div>
                ))
              ) : (
                <span className="raid-note">No level-up data available.</span>
              )}
            </div>
          </div>
        ) : null}

        <div className="pvp-role-squad-grid">
          <div className="pvp-role-card">
            <div className="lookup-label">Roles</div>
            <div className="pvp-traits-row">
              {row.pvpoke.traits.length ? (
                row.pvpoke.traits.map((trait) => (
                  <TypeBadge key={`${row.canonical_id}-trait-${trait}`} type={null} className="pvp-trait-pill" label={trait} />
                ))
              ) : (
                <span className="raid-note">No roles available.</span>
              )}
            </div>
          </div>
          <div className="pvp-role-card">
            <div className="lookup-label">Squad ({league.toUpperCase()})</div>
            <div className="pvp-squad-editor">
              {squadEditorOpen ? (
                <>
                  <input
                    className="pvp-squad-input"
                    value={percentileDraft}
                    placeholder="IV %"
                    onChange={(event) => setPercentileDraft(event.target.value)}
                  />
                  <label className="toggle-field pvp-squad-ready-toggle">
                    <input
                      type="checkbox"
                      checked={leagueReadyDraft}
                      onChange={(event) => setLeagueReadyDraft(event.target.checked)}
                    />
                    <span>Ready</span>
                  </label>
                  <button
                    type="button"
                    className="mode-pill pvp-squad-primary"
                    onClick={() => {
                      const parsed = Number.parseFloat(percentileDraft.trim());
                      const percentile = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
                      onSaveSquad(row.canonical_id, { percentile, leagueReady: leagueReadyDraft });
                      setSquadEditorOpen(false);
                    }}
                  >
                    Save
                  </button>
                </>
              ) : squadEntry ? (
                <>
                  <span className="raid-note">{`${squadEntry.percentile ?? "n/a"}% ${squadEntry.leagueReady ? "Ready" : "Not ready"}`}</span>
                  <div className="pvp-squad-actions">
                    <button type="button" className="mode-pill pvp-squad-primary" onClick={() => setSquadEditorOpen(true)}>
                      Edit
                    </button>
                    <button type="button" className="mode-pill pvp-squad-delete" onClick={() => onDeleteSquad(row.canonical_id)}>
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="mode-pill pvp-squad-add" onClick={() => setSquadEditorOpen(true)}>+</button>
              )}
            </div>
          </div>
        </div>

        <div className="pvp-weakness-grid">
          <div className="pvp-weakness-card">
            <div className="lookup-label">Weaknesses</div>
            <div className="pvp-moveset-row">
              {row.pvpoke.weaknesses.length ? (
                row.pvpoke.weaknesses.map((type) => {
                  const multiplier = pokemon
                    ? attackMultiplierAgainstPokemon(type, pokemon.types, typeEffectiveness)
                    : null;
                  const className = isDoubleWeakness(multiplier)
                    ? "pvp-row-type-chip pvp-fixed-type-chip pvp-effectiveness-double"
                    : "pvp-row-type-chip pvp-fixed-type-chip";
                  return <TypeBadge key={`${row.canonical_id}-weak-${type}`} type={type} className={className} />;
                })
              ) : (
                <span className="raid-note">None</span>
              )}
            </div>
          </div>
          <div className="pvp-weakness-card">
            <div className="lookup-label">Resistances</div>
            <div className="pvp-moveset-row">
              {row.pvpoke.resistances.length ? (
                row.pvpoke.resistances.map((type) => {
                  const multiplier = pokemon
                    ? attackMultiplierAgainstPokemon(type, pokemon.types, typeEffectiveness)
                    : null;
                  const className = isDoubleResistance(multiplier)
                    ? "pvp-row-type-chip pvp-fixed-type-chip pvp-effectiveness-double"
                    : "pvp-row-type-chip pvp-fixed-type-chip";
                  return <TypeBadge key={`${row.canonical_id}-resist-${type}`} type={type} className={className} />;
                })
              ) : (
                <span className="raid-note">None</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TeamBuilderPanel({
  slots,
  slotMoves,
  activeSlot,
  onSetActiveSlot,
  onClearSlot,
  onUpdateSlotMove,
  onRequestSaveTeam,
  onMakeRecommendations,
  typeEffectiveness,
}: {
  slots: Array<TeamBuilderEntry | null>;
  slotMoves: TeamSlotMoves[];
  activeSlot: number | null;
  onSetActiveSlot: (index: number | null) => void;
  onClearSlot: (index: number) => void;
  onUpdateSlotMove: (index: number, field: keyof TeamSlotMoves, value: string) => void;
  onRequestSaveTeam: () => void;
  onMakeRecommendations: (index: number) => void;
  typeEffectiveness: Record<string, Record<string, number>>;
}) {
  const teamEntries = slots.filter((entry): entry is TeamBuilderEntry => entry !== null);
  const attackTypes = Object.keys(TYPE_COLORS);
  const defenseScores = attackTypes.map((type) => ({
    type,
    score: defenseScoreForType(type, teamEntries, typeEffectiveness),
  }));
  const offenseScores = attackTypes.map((type) => ({
    type,
    score: offenseScoreForType(type, teamEntries, slotMoves, typeEffectiveness),
  }));

  return (
    <section className="panel team-builder-panel">
      <div className="panel-header">
        <h3>Team Builder</h3>
        <button type="button" className="mode-pill team-save-button" onClick={onRequestSaveTeam}>
          Save Team
        </button>
        <span>{teamEntries.length}/3 selected</span>
      </div>
      <div className="team-builder-slots">
        {slots.map((entry, index) => {
          const isActive = index === activeSlot;
          const toggleActiveSlot = () => onSetActiveSlot(isActive ? null : index);
          const handleSlotCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
            const target = event.target as HTMLElement;
            if (target.closest("button, input, select, textarea, label")) {
              return;
            }
            toggleActiveSlot();
          };
          if (!entry) {
            if (teamEntries.length === 2) {
              return (
                <div
                  key={`slot-${index}`}
                  className={isActive ? "team-slot-card active" : "team-slot-card"}
                  role="button"
                  tabIndex={0}
                  onClick={handleSlotCardClick}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleActiveSlot();
                    }
                  }}
                >
                  <strong>Slot {index + 1}</strong>
                  <button
                    type="button"
                    className="raid-note"
                    onClick={() => onMakeRecommendations(index)}
                  >
                    Find PvP picks that cover this team's typing gaps.
                  </button>
                </div>
              );
            }
            return (
              <button
                key={`slot-${index}`}
                type="button"
                className={isActive ? "team-slot-card active" : "team-slot-card"}
                onClick={toggleActiveSlot}
              >
                <strong>Slot {index + 1}</strong>
                <span className="raid-note">Select from the list below</span>
              </button>
            );
          }
          const weakTypes = entry.row.pvpoke.weaknesses;
          const resistTypes = entry.row.pvpoke.resistances;
          const moveSelection = slotMoves[index] ?? { fast: null, charged1: null, charged2: null };
          const fastOptions = dedupeMoveOptions(
            [...(entry.pokemon?.moves.fast ?? []), ...(entry.pokemon?.moves.elite_fast ?? [])],
            "Fast",
          );
          const chargedOptions = dedupeMoveOptions(
            [...(entry.pokemon?.moves.charged ?? []), ...(entry.pokemon?.moves.elite_charged ?? [])],
            "Charged",
          );
          const fastMoveType = fastOptions.find((option) => option.id === moveSelection.fast)?.type ?? null;
          const charged1MoveType = chargedOptions.find((option) => option.id === moveSelection.charged1)?.type ?? null;
          const charged2MoveType = chargedOptions.find((option) => option.id === moveSelection.charged2)?.type ?? null;
          return (
            <div
              key={`slot-${index}`}
              className={isActive ? "team-slot-card active" : "team-slot-card"}
              role="button"
              tabIndex={0}
              onClick={handleSlotCardClick}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleActiveSlot();
                }
              }}
            >
              <div className="team-slot-head">
                <button type="button" className="team-slot-title" onClick={toggleActiveSlot}>
                  {entry.pokemon ? (
                    <PokemonIcon pokemon={entry.pokemon} className="pokemon-icon" />
                  ) : (
                    <span className="pokemon-icon pokemon-icon-fallback">{entry.row.name.slice(0, 2).toUpperCase()}</span>
                  )}
                  <span className="team-slot-title-copy">
                    <strong>#{entry.row.pvpoke.rank} {entry.row && pvpRowIsShadow(entry.row.name) ? <em className="pvp-shadow-prefix">Shadow </em> : null}{pvpRowDisplayName(entry.row.name)}</strong>
                    {entry.pokemon ? (
                      <span className="type-row compact raid-type-icons team-slot-type-icons">
                        {entry.pokemon.types.map((type) => (
                          <TypeSymbol key={`slot-${index}-type-${type}`} type={type} />
                        ))}
                      </span>
                    ) : null}
                  </span>
                </button>
                <button type="button" className="mode-pill team-slot-clear" onClick={() => onClearSlot(index)}>
                  Clear
                </button>
              </div>
              <div className="team-slot-grid">
                <div>
                  <div className="lookup-label">Weaknesses</div>
                  <div className="pvp-moveset-row">
                    {weakTypes.length ? weakTypes.map((type) => {
                      const multiplier = entry.pokemon
                        ? attackMultiplierAgainstPokemon(type, entry.pokemon.types, typeEffectiveness)
                        : null;
                      const className = isDoubleWeakness(multiplier)
                        ? "pvp-row-type-chip pvp-fixed-type-chip pvp-effectiveness-double"
                        : "pvp-row-type-chip pvp-fixed-type-chip";
                      return <TypeBadge key={`slot-${index}-weak-${type}`} type={type} className={className} />;
                    }) : <span className="raid-note">None</span>}
                  </div>
                </div>
                <div>
                  <div className="lookup-label">Strengths</div>
                  <div className="pvp-moveset-row">
                    {resistTypes.length ? resistTypes.map((type) => {
                      const multiplier = entry.pokemon
                        ? attackMultiplierAgainstPokemon(type, entry.pokemon.types, typeEffectiveness)
                        : null;
                      const className = isDoubleResistance(multiplier)
                        ? "pvp-row-type-chip pvp-fixed-type-chip pvp-effectiveness-double"
                        : "pvp-row-type-chip pvp-fixed-type-chip";
                      return <TypeBadge key={`slot-${index}-resist-${type}`} type={type} className={className} />;
                    }) : <span className="raid-note">None</span>}
                  </div>
                </div>
                <div>
                  <div className="lookup-label">Roles</div>
                  <div className="pvp-traits-row">
                    {entry.row.pvpoke.traits.length ? entry.row.pvpoke.traits.map((trait) => (
                      <TypeBadge key={`slot-${index}-trait-${trait}`} type={null} label={trait} className="pvp-trait-pill" />
                    )) : <span className="raid-note">n/a</span>}
                  </div>
                </div>
                <div>
                  <div className="lookup-label">Moves</div>
                  <div className="team-slot-moves">
                    <label className="field team-slot-move-field">
                      <span>Fast move</span>
                      <select
                        value={moveSelection.fast ?? ""}
                        onChange={(event) => onUpdateSlotMove(index, "fast", event.target.value)}
                        style={{ color: fastMoveType ? TYPE_COLORS[fastMoveType] ?? undefined : undefined }}
                      >
                        {fastOptions.map((option) => (
                          <option key={`slot-${index}-fast-${option.id || "na"}`} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field team-slot-move-field">
                      <span>Charged move 1</span>
                      <select
                        value={moveSelection.charged1 ?? ""}
                        onChange={(event) => onUpdateSlotMove(index, "charged1", event.target.value)}
                        style={{ color: charged1MoveType ? TYPE_COLORS[charged1MoveType] ?? undefined : undefined }}
                      >
                        {chargedOptions.map((option) => (
                          <option key={`slot-${index}-charged1-${option.id || "na"}`} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field team-slot-move-field">
                      <span>Charged move 2</span>
                      <select
                        value={moveSelection.charged2 ?? ""}
                        onChange={(event) => onUpdateSlotMove(index, "charged2", event.target.value)}
                        style={{ color: charged2MoveType ? TYPE_COLORS[charged2MoveType] ?? undefined : undefined }}
                      >
                        {chargedOptions.map((option) => (
                          <option key={`slot-${index}-charged2-${option.id || "na"}`} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="team-analysis-row">
        <div className="pvp-weakness-card">
          <div className="lookup-label">Defense</div>
          <div className="team-type-grid">
            {defenseScores.map((entry) => {
              const meta = teamDefenseMetaForType(entry.type, teamEntries, typeEffectiveness);
              return (
                <TeamDefenseTypeChip
                  key={`def-${entry.type}`}
                  type={entry.type}
                  label={meta.label}
                  chipClass={meta.chipClass}
                />
              );
            })}
          </div>
        </div>
        <div className="pvp-weakness-card">
          <div className="lookup-label">Offense</div>
          <div className="team-type-grid">
            {offenseScores.map((entry) => (
              <TeamOffenseTypeChip
                key={`off-${entry.type}`}
                type={entry.type}
                chipClass={teamOffenseChipClass(entry.score)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [pvpLeague, setPvpLeague] = useState<PvpLeague>(() => {
    try {
      const stored = localStorage.getItem("pogo_pvp_selected_league");
      return stored === "ultra" || stored === "master" ? stored : "great";
    } catch {
      return "great";
    }
  });
  const [state, setState] = useState<ViewState>({
    data: null,
    pvpMetaData: null,
    spawnRarityData: [],
    pokemonSpeciesData: [],
    raidBossesData: null,
    error: null,
    pvpMetaError: null,
    rarityError: null,
    raidBossesError: null,
    loading: true,
  });
  const [mode, setMode] = useState<Mode>("stats");
  const [search, setSearch] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [excludeLimitedPokemon, setExcludeLimitedPokemon] = useState(true);
  const [excludePvpEliteMovesetPokemon, setExcludePvpEliteMovesetPokemon] = useState(false);
  const [excludePvpXlRequiredPokemon, setExcludePvpXlRequiredPokemon] = useState(false);
  const [pvpSelectedTypes, setPvpSelectedTypes] = useState<string[]>([]);
  const [pvpTypeFilterMode, setPvpTypeFilterMode] = useState<TypeFilterMode>("or");
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
  const [statsMaxMovesets, setStatsMaxMovesets] = useState(1);
  const [cpMode, setCpMode] = useState<CpMode>("level50");
  const [statsSortMode, setStatsSortMode] = useState<StatsSortMode>("cp");
  const [statsGenerationFilter, setStatsGenerationFilter] = useState<number[]>(POKEMON_REGIONS.map((entry) => entry.generation));
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const [finalKey, setFinalKey] = useState<string | null>(null);
  const [compareLeftKey, setCompareLeftKey] = useState<string | null>(null);
  const [compareRightKey, setCompareRightKey] = useState<string | null>(null);
  const [pvpSearch, setPvpSearch] = useState("");
  const [pvpRecommendationIds, setPvpRecommendationIds] = useState<string[] | null>(null);
  const [pvpSelectedId, setPvpSelectedId] = useState<string | null>(null);
  const [pvpTeamBuilderEnabled, setPvpTeamBuilderEnabled] = useState(false);
  const [pvpCollectionViewEnabled, setPvpCollectionViewEnabled] = useState(false);
  const [pvpSquadByLeague, setPvpSquadByLeague] = useState<Record<PvpLeague, Record<string, PvpSquadEntry>>>({
    great: {},
    ultra: {},
    master: {},
  });
  const [teamBuilderSlots, setTeamBuilderSlots] = useState<Array<string | null>>([null, null, null]);
  const [teamBuilderSlotMoves, setTeamBuilderSlotMoves] = useState<TeamSlotMoves[]>([
    { fast: null, charged1: null, charged2: null },
    { fast: null, charged1: null, charged2: null },
    { fast: null, charged1: null, charged2: null },
  ]);
  const [teamBuilderActiveSlot, setTeamBuilderActiveSlot] = useState<number | null>(0);
  const [savedTeams, setSavedTeams] = useState<SavedTeam[]>([]);
  const [selectedSavedTeamId, setSelectedSavedTeamId] = useState<string>("");
  const [savedTeamNameDraft, setSavedTeamNameDraft] = useState("");
  const [teamSaveDraft, setTeamSaveDraft] = useState<TeamSaveDraft>({ open: false, name: "", action: "save" });
  const [savedTeamFeedback, setSavedTeamFeedback] = useState<string | null>(null);
  const [rarityTierFilter, setRarityTierFilter] = useState<string>("Any");
  const [rarityWildFilter, setRarityWildFilter] = useState<string>("Any");
  const [rarityGeoFilter, setRarityGeoFilter] = useState<string>("Any");
  const [rarityConfidenceFilter, setRarityConfidenceFilter] = useState<string>("Any");
  const [rarityTypeFilter, setRarityTypeFilter] = useState<string>("Any");
  const [rarityCompareLeftKey, setRarityCompareLeftKey] = useState<string | null>(null);
  const [rarityCompareRightKey, setRarityCompareRightKey] = useState<string | null>(null);
  const [pvpRefreshLoading, setPvpRefreshLoading] = useState(false);
  const [pvpRefreshStatus, setPvpRefreshStatus] = useState<string | null>(null);
  const [pvpRefreshProgress, setPvpRefreshProgress] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([
      loadMergedData(),
      loadSpawnRarityData().catch((error: unknown) => {
        if (error instanceof Error) {
          return { __error: error.message } as const;
        }
        return { __error: "Failed to load spawn rarity data" } as const;
      }),
      loadPokemonSpeciesData().catch((error: unknown) => {
        if (error instanceof Error) {
          return { __error: error.message } as const;
        }
        return { __error: "Failed to load pokemon species data" } as const;
      }),
      loadCurrentRaidBossesData().catch((error: unknown) => {
        if (error instanceof Error) {
          return { __error: error.message } as const;
        }
        return { __error: "Failed to load current raid bosses data" } as const;
      }),
    ])
      .then(([data, spawnRarityResult, pokemonSpeciesResult, raidBossesResult]) => {
        if (!active) {
          return;
        }
        const spawnRarityData = spawnRarityResult && "__error" in spawnRarityResult ? [] : spawnRarityResult;
        const pokemonSpeciesData = pokemonSpeciesResult && "__error" in pokemonSpeciesResult ? [] : pokemonSpeciesResult;
        const raidBossesData = raidBossesResult && "__error" in raidBossesResult ? null : raidBossesResult;
        const raidBossesError = raidBossesResult && "__error" in raidBossesResult ? raidBossesResult.__error : null;
        const rarityError = [
          spawnRarityResult && "__error" in spawnRarityResult ? spawnRarityResult.__error : null,
          pokemonSpeciesResult && "__error" in pokemonSpeciesResult ? pokemonSpeciesResult.__error : null,
        ]
          .filter(Boolean)
          .join(" | ");

        setState((current) => ({
          ...current,
          data,
          spawnRarityData,
          pokemonSpeciesData,
          raidBossesData,
          error: null,
          rarityError: rarityError || null,
          raidBossesError,
          loading: false,
        }));
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setState((current) => ({
          ...current,
          data: null,
          spawnRarityData: [],
          pokemonSpeciesData: [],
          raidBossesData: null,
          error: error instanceof Error ? error.message : "Failed to load merged data",
          rarityError: null,
          raidBossesError: null,
          loading: false,
        }));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("pogo_pvp_selected_league", pvpLeague);
    } catch {
      // ignore persistence failures
    }
  }, [pvpLeague]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(pvpSquadStorageKey());
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<Record<PvpLeague, Record<string, PvpSquadEntry>>>;
      setPvpSquadByLeague({
        great: parsed.great ?? {},
        ultra: parsed.ultra ?? {},
        master: parsed.master ?? {},
      });
    } catch {
      // ignore bad local storage payload
    }
  }, []);

  const persistPvpSquadByLeague = (next: Record<PvpLeague, Record<string, PvpSquadEntry>>) => {
    setPvpSquadByLeague(next);
    try {
      localStorage.setItem(pvpSquadStorageKey(), JSON.stringify(next));
    } catch {
      // ignore persistence failures
    }
  };

  useEffect(() => {
    setState((current) => {
      if (current.pvpMetaData) {
        return current;
      }
      const cached = readCachedPvpMeta(pvpLeague) ?? (pvpLeague !== "great" ? readCachedPvpMeta("great") : null);
      if (!cached) {
        return current;
      }
      return { ...current, pvpMetaData: cached };
    });
  }, [pvpLeague]);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, pvpMetaError: null }));
    const run = async () => {
      try {
        const data = await loadPvpMetaData(pvpLeague);
        if (!active) {
          return;
        }
        if (data) {
          writeCachedPvpMeta(pvpLeague, data);
          setState((current) => ({
            ...current,
            pvpMetaData: data,
            pvpMetaError: null,
          }));
          return;
        }
        if (pvpLeague !== "great") {
          const fallback = await loadPvpMetaData("great");
          if (!active) {
            return;
          }
          if (fallback) {
            writeCachedPvpMeta("great", fallback);
            setPvpLeague("great");
            setState((current) => ({
              ...current,
              pvpMetaData: fallback,
              pvpMetaError: `No ${pvpLeague} league file found. Switched to Great League.`,
            }));
            return;
          }
        }
        setState((current) => ({
          ...current,
          pvpMetaData: null,
          pvpMetaError: `No ${pvpLeague} league PvP data file found yet.`,
        }));
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : `Failed to load ${pvpLeague} league PvP data`;
        setState((current) => ({
          ...current,
          pvpMetaData: null,
          pvpMetaError: message,
        }));
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [pvpLeague]);

  const handlePvpRefresh = async () => {
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    setPvpRefreshLoading(true);
    setPvpRefreshStatus(null);
    setPvpRefreshProgress(6);
    progressTimer = setInterval(() => {
      setPvpRefreshProgress((current) => {
        if (current >= 92) {
          return current;
        }
        return Math.min(92, current + Math.max(2, Math.round((100 - current) * 0.08)));
      });
    }, 180);
    try {
      await refreshPvpMetaData(pvpLeague);
      const refreshed = await loadPvpMetaData(pvpLeague);
      setPvpRefreshProgress(100);
      setState((current) => ({
        ...current,
        pvpMetaData: refreshed,
        pvpMetaError: refreshed ? null : `No ${pvpLeague} league PvP data file found yet.`,
      }));
      setPvpRefreshStatus(`${pvpLeague[0].toUpperCase()}${pvpLeague.slice(1)} League PvP data refreshed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to refresh PvPoke data";
      setPvpRefreshProgress(100);
      setState((current) => ({
        ...current,
        pvpMetaError: message,
      }));
      setPvpRefreshStatus(`Refresh failed: ${message}`);
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
      }
      setPvpRefreshLoading(false);
      setTimeout(() => setPvpRefreshProgress(0), 500);
    }
  };

  const pokemon = state.data?.pokemon ?? [];
  const pvpMetaRows = state.pvpMetaData?.pvpoke_rankings ?? [];
  const spawnRarityRows = state.spawnRarityData ?? [];
  const pokemonSpeciesRows = state.pokemonSpeciesData ?? [];
  const typeEffectiveness = state.data?.type_effectiveness ?? {};
  const rarityTierByPokemonForm = useMemo(() => {
    const index = new Map<string, string>();
    spawnRarityRows.forEach((entry) => {
      index.set(rarityKey(entry), entry.rarityTier);
    });
    return index;
  }, [spawnRarityRows]);
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
  const effectivePvpSelectedTypes = useMemo(
    () => normalizeTypeFilterSelection(pvpSelectedTypes, availableTypes),
    [availableTypes, pvpSelectedTypes],
  );
  const allGenerations = useMemo(() => [...new Set(POKEMON_REGIONS.map((entry) => entry.generation))], []);
  const pokemonBySpeciesId = useMemo(() => {
    const index = new Map<string, PokemonEntry>();
    for (const entry of visiblePokemon) {
      for (const speciesId of pokemonSpeciesIds(entry)) {
        index.set(speciesId, entry);
      }
    }
    return index;
  }, [visiblePokemon]);
  const pvpRowsWithLocal = useMemo(
    () =>
      pvpMetaRows.map((row) => ({
        row,
        pokemon: resolveLocalPokemonForPvpRow(row, pokemonBySpeciesId, visiblePokemon),
      })),
    [pokemonBySpeciesId, pvpMetaRows, visiblePokemon],
  );
  const pvpBaseFilteredRows = useMemo(() => {
    const query = normalizeQuery(pvpSearch);
    const fieldPriority = (value: string): number | null => {
      if (!value) {
        return null;
      }
      if (value.startsWith(query)) {
        return 0;
      }
      const tokens = value.split(/[^a-z0-9]+/g).filter(Boolean);
      if (tokens.some((token) => token.startsWith(query))) {
        return 1;
      }
      if (value.includes(query)) {
        return 2;
      }
      return null;
    };
    const minPriority = (values: string[]): number | null => {
      let best: number | null = null;
      values.forEach((value) => {
        const candidate = fieldPriority(normalizeQuery(value));
        if (candidate !== null && (best === null || candidate < best)) {
          best = candidate;
        }
      });
      return best;
    };

    const filtered = pvpRowsWithLocal
      .map(({ row, pokemon }) => {
        const requiresEliteByFlag = row.pvpoke.requires_elite_for_recommended_moveset ?? false;
        const requiresEliteByMoveFlags = (row.pvpoke.recommended_move_elite_flags ?? []).some(Boolean);
        const requiresEliteByStatuses = (row.pvpoke.recommended_move_statuses ?? []).some((status) => status === "elite");
        const requiresElite = requiresEliteByFlag || requiresEliteByMoveFlags || requiresEliteByStatuses;
        if (excludePvpEliteMovesetPokemon && requiresElite) {
          return null;
        }
        if (excludePvpXlRequiredPokemon && pokemon && requiresXlCandyForLeague(pokemon, pvpLeague)) {
          return null;
        }
        if (pokemon && !canReachLeagueCap(pokemon, pvpLeague)) {
          return null;
        }
        if (effectivePvpSelectedTypes.length !== availableTypes.length) {
          const typePool = pokemon?.types ?? row.types ?? [];
          const matchesSelectedTypes =
            pvpTypeFilterMode === "and"
              ? effectivePvpSelectedTypes.every((type) => typePool.includes(type))
              : typePool.some((type) => effectivePvpSelectedTypes.includes(type));
          if (!matchesSelectedTypes) {
            return null;
          }
        }
        if (!query) {
          return { row, pokemon, relevance: Number.POSITIVE_INFINITY };
        }

        const namePriority = minPriority([row.name, pokemon?.name ?? ""]);
        const idPriority = minPriority([row.canonical_id, row.local_lookup_species_id, pokemon?.form ?? ""]);
        const evolutionPriority =
          pokemon === null
            ? null
            : minPriority([
                ...(pokemon.evolution.line_names ?? []),
                ...(pokemon.evolution.final_evolution_names ?? []),
                pokemon.evolution.family_root ?? "",
              ]);

        let relevance = Number.POSITIVE_INFINITY;
        if (namePriority !== null) {
          relevance = namePriority;
        } else if (idPriority !== null) {
          relevance = 10 + idPriority;
        } else if (evolutionPriority !== null) {
          relevance = 20 + evolutionPriority;
        }

        if (!Number.isFinite(relevance)) {
          return null;
        }
        return { row, pokemon, relevance };
      })
      .filter((entry): entry is { row: GreatLeagueCombinedRow; pokemon: PokemonEntry | null; relevance: number } => entry !== null);

    filtered.sort((left, right) => (left.row.pvpoke.rank ?? 999999) - (right.row.pvpoke.rank ?? 999999));

    return filtered.map(({ row, pokemon }) => ({ row, pokemon }));
  }, [
    availableTypes.length,
    effectivePvpSelectedTypes,
    excludePvpEliteMovesetPokemon,
    excludePvpXlRequiredPokemon,
    pvpRowsWithLocal,
    pvpSearch,
    pvpTypeFilterMode,
  ]);
  const pvpFilteredRows = useMemo(() => {
    if (!pvpRecommendationIds) {
      return pvpBaseFilteredRows;
    }
    const recommendationOrder = new Map(pvpRecommendationIds.map((id, index) => [id, index]));
    return pvpBaseFilteredRows
      .filter((entry) => recommendationOrder.has(entry.row.canonical_id))
      .sort(
        (left, right) =>
          (recommendationOrder.get(left.row.canonical_id) ?? 999999) -
          (recommendationOrder.get(right.row.canonical_id) ?? 999999),
      );
  }, [pvpBaseFilteredRows, pvpRecommendationIds]);
  const selectedPvpRow = useMemo(() => {
    if (pvpSelectedId) {
      return pvpFilteredRows.find((entry) => entry.row.canonical_id === pvpSelectedId) ?? null;
    }
    return pvpFilteredRows[0] ?? null;
  }, [pvpFilteredRows, pvpSelectedId]);
  const pvpPokemonByCanonicalId = useMemo(() => {
    const index = new Map<string, PokemonEntry>();
    pvpRowsWithLocal.forEach(({ row, pokemon: localPokemon }) => {
      if (localPokemon) {
        index.set(row.canonical_id, localPokemon);
      }
    });
    return index;
  }, [pvpRowsWithLocal]);
  const pvpEntryByCanonicalId = useMemo(() => {
    const index = new Map<string, TeamBuilderEntry>();
    pvpRowsWithLocal.forEach((entry) => {
      index.set(entry.row.canonical_id, entry);
    });
    return index;
  }, [pvpRowsWithLocal]);
  const pvpLeagueSquad = useMemo(() => pvpSquadByLeague[pvpLeague] ?? {}, [pvpLeague, pvpSquadByLeague]);
  const savePvpSquadEntry = (rowId: string, entry: PvpSquadEntry) => {
    const next: Record<PvpLeague, Record<string, PvpSquadEntry>> = {
      ...pvpSquadByLeague,
      [pvpLeague]: {
        ...(pvpSquadByLeague[pvpLeague] ?? {}),
        [rowId]: entry,
      },
    };
    persistPvpSquadByLeague(next);
  };
  const deletePvpSquadEntry = (rowId: string) => {
    const currentLeagueEntries = { ...(pvpSquadByLeague[pvpLeague] ?? {}) };
    if (!(rowId in currentLeagueEntries)) {
      return;
    }
    delete currentLeagueEntries[rowId];
    const next: Record<PvpLeague, Record<string, PvpSquadEntry>> = {
      ...pvpSquadByLeague,
      [pvpLeague]: currentLeagueEntries,
    };
    persistPvpSquadByLeague(next);
  };
  const teamBuilderResolvedSlots = useMemo(
    () => teamBuilderSlots.map((id) => (id ? pvpEntryByCanonicalId.get(id) ?? null : null)),
    [pvpEntryByCanonicalId, teamBuilderSlots],
  );
  const makeTeamRecommendations = (targetSlot: number) => {
    const selectedTeam = teamBuilderResolvedSlots.filter((entry): entry is TeamBuilderEntry => entry !== null);
    if (selectedTeam.length !== 2) {
      return;
    }
    const recommendedIds = rankTeamRecommendations(selectedTeam, pvpRowsWithLocal, typeEffectiveness);
    setTeamBuilderActiveSlot(targetSlot);
    setPvpSearch("");
    setPvpRecommendationIds(recommendedIds);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pogo_team_builder_saved_teams");
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Array<Partial<SavedTeam>>;
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .filter((entry) => entry && typeof entry.id === "string" && typeof entry.name === "string")
          .map((entry) => ({
            id: entry.id as string,
            name: entry.name as string,
            league: (entry.league === "ultra" || entry.league === "master" ? entry.league : "great") as PvpLeague,
            slots: Array.isArray(entry.slots) ? entry.slots.map((slot) => slot ?? null) : [null, null, null],
            slotMoves: Array.isArray(entry.slotMoves)
              ? entry.slotMoves.map((row) => ({
                  fast: row?.fast ?? null,
                  charged1: row?.charged1 ?? null,
                  charged2: row?.charged2 ?? null,
                }))
              : [
                  { fast: null, charged1: null, charged2: null },
                  { fast: null, charged1: null, charged2: null },
                  { fast: null, charged1: null, charged2: null },
                ],
            savedAt: typeof entry.savedAt === "string" ? entry.savedAt : new Date().toISOString(),
          }));
        setSavedTeams(normalized);
      }
    } catch {
      // ignore bad local storage payload
    }
  }, []);

  const persistSavedTeams = (teams: SavedTeam[]) => {
    setSavedTeams(teams);
    try {
      localStorage.setItem("pogo_team_builder_saved_teams", JSON.stringify(teams));
    } catch {
      // ignore persistence failures
    }
  };
  const leagueSavedTeams = useMemo(
    () => savedTeams.filter((team) => (team.league ?? "great") === pvpLeague),
    [pvpLeague, savedTeams],
  );

  const fallbackTeamName = () => {
    const names = teamBuilderResolvedSlots
      .map((entry) => entry?.row.name)
      .filter((name): name is string => Boolean(name));
    return names.length ? names.join(" / ") : `Team ${new Date().toLocaleString()}`;
  };

  const saveCurrentTeam = (requestedName?: string) => {
    const filled = teamBuilderSlots.filter((slot) => Boolean(slot)).length;
    if (!filled) {
      return;
    }
    const stamp = new Date().toISOString();
    const teamName = requestedName?.trim() || savedTeamNameDraft.trim() || fallbackTeamName();
    const normalizedTeamName = normalizeQuery(teamName);
    const existingTeam =
      leagueSavedTeams.find((team) => team.id === selectedSavedTeamId) ??
      leagueSavedTeams.find((team) => normalizeQuery(team.name) === normalizedTeamName);
    const nextTeam: SavedTeam = {
      id: existingTeam?.id ?? `team-${stamp}`,
      name: teamName,
      league: pvpLeague,
      slots: [...teamBuilderSlots],
      slotMoves: teamBuilderSlotMoves.map((row) => ({ ...row })),
      savedAt: stamp,
    };
    const next = existingTeam
      ? [nextTeam, ...savedTeams.filter((team) => team.id !== existingTeam.id)].slice(0, 20)
      : [nextTeam, ...savedTeams].slice(0, 20);
    persistSavedTeams(next);
    setSelectedSavedTeamId(nextTeam.id);
    setSavedTeamNameDraft(teamName);
    setSavedTeamFeedback(`${existingTeam ? "Updated" : "Saved"} "${teamName}" (${pvpLeague.toUpperCase()}).`);
    setTeamSaveDraft({ open: false, name: "", action: "save" });
  };

  const requestSaveCurrentTeam = () => {
    const filled = teamBuilderSlots.filter((slot) => Boolean(slot)).length;
    if (!filled) {
      return;
    }
    setTeamSaveDraft({ open: true, name: savedTeamNameDraft.trim() || fallbackTeamName(), action: "save" });
  };

  const loadSavedTeam = (teamId: string) => {
    const team = savedTeams.find((entry) => entry.id === teamId);
    if (!team) {
      return;
    }
    setSelectedSavedTeamId(team.id);
    setSavedTeamNameDraft(team.name);
    setSavedTeamFeedback(`Loaded "${team.name}" (${team.league.toUpperCase()}).`);
    setTeamBuilderSlots(team.slots.map((slot) => slot ?? null));
    setTeamBuilderSlotMoves(
      (team.slotMoves?.length ? team.slotMoves : [
        { fast: null, charged1: null, charged2: null },
        { fast: null, charged1: null, charged2: null },
        { fast: null, charged1: null, charged2: null },
      ]).map((row) => ({
        fast: row.fast ?? null,
        charged1: row.charged1 ?? null,
        charged2: row.charged2 ?? null,
      })),
    );
    const firstEmpty = team.slots.findIndex((slot) => !slot);
    setTeamBuilderActiveSlot(firstEmpty >= 0 ? firstEmpty : 0);
  };

  const requestRenameSelectedSavedTeam = () => {
    const team = savedTeams.find((entry) => entry.id === selectedSavedTeamId);
    if (!team) {
      return;
    }
    setTeamSaveDraft({ open: true, name: team.name, action: "rename" });
  };

  const renameSelectedSavedTeam = (requestedName?: string) => {
    const nextName = requestedName?.trim() || savedTeamNameDraft.trim();
    if (!selectedSavedTeamId || !nextName) {
      return;
    }
    setSavedTeams((current) => {
      const nextTeams = current.map((team) =>
        team.id === selectedSavedTeamId ? { ...team, name: nextName } : team,
      );
      try {
        localStorage.setItem("pogo_team_builder_saved_teams", JSON.stringify(nextTeams));
      } catch {
        // ignore persistence failures
      }
      return nextTeams;
    });
    setSavedTeamNameDraft(nextName);
    setSavedTeamFeedback(`Renamed to "${nextName}".`);
    setTeamSaveDraft({ open: false, name: "", action: "save" });
  };

  const deleteSelectedSavedTeam = () => {
    if (!selectedSavedTeamId) {
      return;
    }
    const deletedTeam = savedTeams.find((team) => team.id === selectedSavedTeamId);
    const nextTeams = savedTeams.filter((team) => team.id !== selectedSavedTeamId);
    persistSavedTeams(nextTeams);
    setSelectedSavedTeamId("");
    setSavedTeamNameDraft("");
    setSavedTeamFeedback(deletedTeam ? `Deleted "${deletedTeam.name}".` : "Deleted saved team.");
  };
  useEffect(() => {
    if (!selectedSavedTeamId) {
      return;
    }
    if (!leagueSavedTeams.some((team) => team.id === selectedSavedTeamId)) {
      setSelectedSavedTeamId("");
      setSavedTeamNameDraft("");
    }
  }, [leagueSavedTeams, selectedSavedTeamId]);
  const targetTypes = targetType === "Any" ? [] : [targetType];
  const activeWeather = weatherEnabled ? weather : "None";
  const speciesById = useMemo(() => {
    const index = new Map<number, PokemonSpecies>();
    pokemonSpeciesRows.forEach((entry) => {
      index.set(entry.pokemonId, entry);
    });
    return index;
  }, [pokemonSpeciesRows]);
  const pokemonByRarityKey = useMemo(() => {
    const index = new Map<string, PokemonEntry>();
    visiblePokemon.forEach((entry) => {
      index.set(rarityKey({ pokemonId: entry.pokemon_id, form: entry.form }), entry);
    });
    return index;
  }, [visiblePokemon]);
  const rarityRowsWithContext = useMemo(
    () =>
      spawnRarityRows.map((entry) => ({
        key: rarityKey(entry),
        rarity: entry,
        pokemon: pokemonByRarityKey.get(rarityKey(entry)) ?? null,
        species: speciesById.get(entry.pokemonId) ?? null,
      })),
    [pokemonByRarityKey, speciesById, spawnRarityRows],
  );
  const rarityTypeOptions = useMemo(
    () =>
      [...new Set(rarityRowsWithContext.flatMap((entry) => entry.species?.types ?? entry.pokemon?.types ?? []))].sort(),
    [rarityRowsWithContext],
  );
  const rarityFilteredRows = useMemo(() => {
    const query = normalizeQuery(search);
    const filtered = rarityRowsWithContext.filter(({ rarity, pokemon, species }) => {
      const formLabel = normalizeQuery(rarity.form ?? "Normal");
      const nameLabel = normalizeQuery(rarity.pokemonName);
      const dexLabel = String(rarity.pokemonId);
      const matchesQuery =
        !query || nameLabel.includes(query) || formLabel.includes(query) || dexLabel.includes(query);
      if (!matchesQuery) {
        return false;
      }
      if (rarityTierFilter !== "Any" && rarity.rarityTier !== rarityTierFilter) {
        return false;
      }
      if (rarityWildFilter !== "Any" && rarity.wildAvailability !== rarityWildFilter) {
        return false;
      }
      if (rarityGeoFilter !== "Any" && rarity.geoAvailability !== rarityGeoFilter) {
        return false;
      }
      if (rarityConfidenceFilter !== "Any" && rarity.confidence !== rarityConfidenceFilter) {
        return false;
      }
      if (rarityTypeFilter !== "Any") {
        const typePool = species?.types ?? pokemon?.types ?? [];
        if (!typePool.includes(rarityTypeFilter)) {
          return false;
        }
      }
      return true;
    });
    filtered.sort((left, right) => {
      if (left.rarity.pokemonId !== right.rarity.pokemonId) {
        return left.rarity.pokemonId - right.rarity.pokemonId;
      }
      return normalizeQuery(left.rarity.form ?? "Normal").localeCompare(normalizeQuery(right.rarity.form ?? "Normal"));
    });
    return filtered;
  }, [
    rarityRowsWithContext,
    rarityConfidenceFilter,
    rarityGeoFilter,
    rarityTierFilter,
    rarityTypeFilter,
    rarityWildFilter,
    search,
  ]);

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
    () => filterRaidBosses(bossSourceFilter, visiblePokemon, state.raidBossesData, pokemonSpeciesRows),
    [bossSourceFilter, pokemonSpeciesRows, state.raidBossesData, visiblePokemon],
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

  const statsFilteredPokemon = useMemo(() => {
    if (!statsGenerationFilter.length) {
      return [];
    }
    const query = normalizeQuery(search);
    return visiblePokemon.filter((entry) => {
      const generation = pokemonGeneration(entry);
      if (!statsGenerationFilter.includes(generation)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        normalizeQuery(entry.name).includes(query) ||
        normalizeQuery(entry.form).includes(query) ||
        String(entry.dex).includes(query)
      );
    });
  }, [search, statsGenerationFilter, visiblePokemon]);

  const statsRows = useMemo(() => {
    const targetTypePool = Object.keys(typeEffectiveness);
    const targets = targetTypePool.length ? targetTypePool : availableTypes;
    return sortStatsRows(
      computeStatsRows(statsFilteredPokemon, cpMode, statsMaxMovesets, targets, typeEffectiveness),
      statsSortMode,
    );
  }, [availableTypes, cpMode, statsFilteredPokemon, statsMaxMovesets, statsSortMode, typeEffectiveness]);

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

  const rarityTierForPokemon = (entry: PokemonEntry | null): string | null => {
    if (!entry) {
      return null;
    }
    return rarityTierByPokemonForm.get(rarityKey({ pokemonId: entry.pokemon_id, form: entry.form })) ?? null;
  };

  const lookupSelectionRarityTier = rarityTierForPokemon(lookupSelection);
  const resolvedFinalRarityTier = rarityTierForPokemon(resolvedFinal);
  const lookupResolvedRarityText = resolvedFinalRarityTier
    ? (
      lookupSelection &&
      resolvedFinal &&
      pokemonKey(lookupSelection) !== pokemonKey(resolvedFinal) &&
      lookupSelectionRarityTier
        ? `${prettyToken(resolvedFinalRarityTier)} (${prettyToken(lookupSelectionRarityTier)})`
        : prettyToken(resolvedFinalRarityTier)
    )
    : null;

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
    if (!pvpFilteredRows.length) {
      setPvpSelectedId(null);
      return;
    }
    if (!pvpSelectedId || !pvpFilteredRows.some((entry) => entry.row.canonical_id === pvpSelectedId)) {
      setPvpSelectedId(pvpFilteredRows[0].row.canonical_id);
    }
  }, [pvpFilteredRows, pvpSelectedId]);

  useEffect(() => {
    if (!rarityFilteredRows.length) {
      setRarityCompareLeftKey(null);
      setRarityCompareRightKey(null);
      return;
    }
    const first = rarityFilteredRows[0].key;
    const second = rarityFilteredRows[Math.min(1, rarityFilteredRows.length - 1)].key;
    if (!rarityCompareLeftKey || !rarityFilteredRows.some((entry) => entry.key === rarityCompareLeftKey)) {
      setRarityCompareLeftKey(first);
    }
    if (
      !rarityCompareRightKey ||
      !rarityFilteredRows.some((entry) => entry.key === rarityCompareRightKey) ||
      rarityCompareRightKey === rarityCompareLeftKey
    ) {
      setRarityCompareRightKey(second);
    }
  }, [rarityCompareLeftKey, rarityCompareRightKey, rarityFilteredRows]);

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
  const rarityCompareLeft = rarityFilteredRows.find((entry) => entry.key === rarityCompareLeftKey) ?? rarityFilteredRows[0] ?? null;
  const rarityCompareRight = rarityFilteredRows.find((entry) => entry.key === rarityCompareRightKey) ?? null;

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
            <span>
              {mode === "raid"
                ? `${raidAttackers.length} results`
                : mode === "pvp"
                  ? `${pvpFilteredRows.length} results`
                  : `${statsRows.length} results`}
            </span>
          </div>

          <div className="mode-switch">
            <button
              type="button"
              className={mode === "stats" ? "mode-pill active" : "mode-pill"}
              onClick={() => setMode("stats")}
            >
              Pokemon
            </button>
            <button
              type="button"
              className={mode === "raid" ? "mode-pill active" : "mode-pill"}
              onClick={() => setMode("raid")}
            >
              Raiding
            </button>
            <button
              type="button"
              className={mode === "pvp" ? "mode-pill active" : "mode-pill"}
              onClick={() => setMode("pvp")}
            >
              PvP
            </button>
          </div>
          {mode === "pvp" ? (
            <>
              <label className="field">
                <span>League</span>
                <select value={pvpLeague} onChange={(event) => setPvpLeague(event.target.value as PvpLeague)}>
                  <option value="great">Great League (CP 1500)</option>
                  <option value="ultra">Ultra League (CP 2500)</option>
                  <option value="master">Master League</option>
                </select>
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={pvpTeamBuilderEnabled}
                  onChange={(event) => setPvpTeamBuilderEnabled(event.target.checked)}
                />
                <span>Enable Team Builder tools</span>
              </label>
            </>
          ) : null}

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
          ) : mode === "pvp" ? (
            <>
              <label className="field">
                <span>Search PvP rows</span>
                <input
                  value={pvpSearch}
                  onChange={(event) => setPvpSearch(event.target.value)}
                  placeholder="Azumarill, clodsire, shadow..."
                />
              </label>
              {pvpRecommendationIds ? (
                <div className="pvp-recommendation-filter">
                  <span>Recommendations active: {pvpFilteredRows.length} shown</span>
                  <button type="button" className="mode-pill" onClick={() => setPvpRecommendationIds(null)}>
                    Show all
                  </button>
                </div>
              ) : null}
            </>
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

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={mode === "pvp" ? excludePvpEliteMovesetPokemon : excludeLimitedPokemon}
              onChange={(event) =>
                mode === "pvp"
                  ? setExcludePvpEliteMovesetPokemon(event.target.checked)
                  : setExcludeLimitedPokemon(event.target.checked)
              }
            />
            <span>{mode === "pvp" ? "Exclude Elite TM movesets" : "Exclude limited/event-only Pokemon"}</span>
          </label>
          {mode === "pvp" ? (
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={excludePvpXlRequiredPokemon}
                onChange={(event) => setExcludePvpXlRequiredPokemon(event.target.checked)}
              />
              <span>Exclude XL-required Pokemon</span>
            </label>
          ) : null}

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
            mode === "stats" ? (
            <>
              <label className="field">
                <span>CP level</span>
                <select value={cpMode} onChange={(event) => setCpMode(event.target.value as CpMode)}>
                  <option value="level40">Level 40 (15/15/15)</option>
                  <option value="level50">Level 50 (15/15/15)</option>
                </select>
              </label>

              <label className="field">
                <span>Max movesets</span>
                <select value={statsMaxMovesets} onChange={(event) => setStatsMaxMovesets(Number(event.target.value) || 1)}>
                  {Array.from({ length: 5 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Sort by</span>
                <select value={statsSortMode} onChange={(event) => setStatsSortMode(event.target.value as StatsSortMode)}>
                  <option value="cp">CP</option>
                  <option value="attack">Attack</option>
                  <option value="defense">Defense</option>
                  <option value="hp">HP</option>
                  <option value="tankiness">Tankiness</option>
                  <option value="basic_cycle_dps">Basic cycle DPS</option>
                </select>
              </label>

              <div className="field">
                <span>Generation filter</span>
                <div className="generation-filter-list">
                  {allGenerations.map((generation) => {
                    const active = statsGenerationFilter.includes(generation);
                    return (
                      <label key={generation} className="toggle-field generation-filter-item">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() =>
                            setStatsGenerationFilter((current) =>
                              current.includes(generation)
                                ? current.filter((entry) => entry !== generation)
                                : [...current, generation].sort((a, b) => a - b),
                            )
                          }
                        />
                        <span>Gen {generation}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
            ) : mode === "pvp" ? (
            <>
              <div className="ranking-summary raid-summary">
                <span><strong>Active league:</strong> {pvpLeague[0].toUpperCase()}{pvpLeague.slice(1)} League</span>
                <span><strong>CP cap:</strong> {pvpLeague === "master" ? "No cap" : PVP_LEAGUE_CP_CAP[pvpLeague]}</span>
              </div>
              <div className="field">
                <div className="field-header-row type-filter-header-row">
                  <span>Type filter</span>
                  <button
                    type="button"
                    className="type-filter-mode-button"
                    onClick={() => setPvpTypeFilterMode((current) => (current === "or" ? "and" : "or"))}
                    aria-label={`Type filter mode: ${pvpTypeFilterMode.toUpperCase()}`}
                  >
                    {pvpTypeFilterMode.toUpperCase()}
                  </button>
                </div>
                <div className="type-filter">
                  {availableTypes.map((type) => {
                    const active = effectivePvpSelectedTypes.includes(type);
                    return (
                      <button
                        key={`pvp-type-${type}`}
                        type="button"
                        className={active ? "type-pill active" : "type-pill type-pill-inactive"}
                        style={typeStyle(type)}
                        onClick={() =>
                          setPvpSelectedTypes((current) => toggleTypeFilterSelection(current, type, availableTypes))
                        }
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                className="mode-pill pvp-refresh-button"
                onClick={() => void handlePvpRefresh()}
                disabled={pvpRefreshLoading}
                style={{
                  backgroundImage:
                    pvpRefreshLoading || pvpRefreshProgress > 0
                      ? `linear-gradient(90deg, rgba(102, 184, 255, 0.38) ${pvpRefreshProgress}%, rgba(8, 14, 24, 0.65) ${pvpRefreshProgress}%)`
                      : undefined,
                }}
              >
                {pvpRefreshLoading ? "Refreshing PvPoke..." : "Refresh PvPoke Data"}
              </button>
              {pvpRefreshStatus ? <div className="pvp-refresh-status">{pvpRefreshStatus}</div> : null}
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={pvpCollectionViewEnabled}
                  onChange={(event) => setPvpCollectionViewEnabled(event.target.checked)}
                />
                <span>Collection View</span>
              </label>
              {pvpTeamBuilderEnabled ? (
                <>
                  <label className="field">
                    <span>Load saved team</span>
                    <select
                      value={selectedSavedTeamId}
                      onChange={(event) => {
                        const nextId = event.target.value;
                        setSelectedSavedTeamId(nextId);
                        if (nextId) {
                          loadSavedTeam(nextId);
                        }
                      }}
                      onClick={() => {
                        if (selectedSavedTeamId) {
                          loadSavedTeam(selectedSavedTeamId);
                        }
                      }}
                    >
                      <option value="">Choose saved team...</option>
                      {leagueSavedTeams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="mode-pill saved-team-rename-button"
                    onClick={requestRenameSelectedSavedTeam}
                    disabled={!selectedSavedTeamId}
                  >
                    Rename Saved Team
                  </button>
                  <button
                    type="button"
                    className="mode-pill saved-team-delete-button"
                    onClick={deleteSelectedSavedTeam}
                    disabled={!selectedSavedTeamId}
                  >
                    Delete Saved Team
                  </button>
                  {savedTeamFeedback ? <div className="pvp-refresh-status">{savedTeamFeedback}</div> : null}
                </>
              ) : null}
              {state.pvpMetaError ? <div className="raid-note">{state.pvpMetaError}</div> : null}
            </>
            ) : mode === "rarity" ? (
            <>
              <label className="field">
                <span>Rarity tier</span>
                <select value={rarityTierFilter} onChange={(event) => setRarityTierFilter(event.target.value)}>
                  <option value="Any">Any tier</option>
                  {["common", "uncommon", "rare", "super_rare", "ultra_rare", "event_only", "not_wild", "unknown"].map((tier) => (
                    <option key={tier} value={tier}>
                      {prettyToken(tier)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Wild availability</span>
                <select value={rarityWildFilter} onChange={(event) => setRarityWildFilter(event.target.value)}>
                  <option value="Any">Any</option>
                  {["wild", "regional", "event", "research", "egg", "raid", "not_wild", "unknown"].map((value) => (
                    <option key={value} value={value}>
                      {prettyToken(value)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Geo availability</span>
                <select value={rarityGeoFilter} onChange={(event) => setRarityGeoFilter(event.target.value)}>
                  <option value="Any">Any</option>
                  {["global", "regional", "unknown"].map((value) => (
                    <option key={value} value={value}>
                      {prettyToken(value)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Type</span>
                <select value={rarityTypeFilter} onChange={(event) => setRarityTypeFilter(event.target.value)}>
                  <option value="Any">Any type</option>
                  {rarityTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Confidence</span>
                <select value={rarityConfidenceFilter} onChange={(event) => setRarityConfidenceFilter(event.target.value)}>
                  <option value="Any">Any</option>
                  {["high", "medium", "low"].map((value) => (
                    <option key={value} value={value}>
                      {prettyToken(value)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="pokemon-list">
                {rarityFilteredRows.slice(0, 200).map((entry) => (
                  <button
                    type="button"
                    key={entry.key}
                    className={entry.key === (rarityCompareLeft?.key ?? "") ? "pokemon-row active" : "pokemon-row"}
                    onClick={() => setRarityCompareLeftKey(entry.key)}
                  >
                    <strong>
                      #{entry.rarity.pokemonId} {entry.rarity.pokemonName}
                      {entry.rarity.form && normalizeQuery(entry.rarity.form) !== "normal" ? (
                        <span className="pokemon-form-inline"> ({entry.rarity.form})</span>
                      ) : null}
                    </strong>
                    <span className="pokemon-form-inline">
                      {prettyToken(entry.rarity.wildAvailability)} | {prettyToken(entry.rarity.geoAvailability)}
                    </span>
                    <small>{prettyToken(entry.rarity.rarityTier)}</small>
                  </button>
                ))}
              </div>
              {state.rarityError ? <div className="raid-note">{state.rarityError}</div> : null}
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
              {bossSourceFilter === "Current Rotation" && state.raidBossesError ? (
                <div className="raid-note">
                  Live raid source unavailable, using local fallback. {state.raidBossesError}
                </div>
              ) : null}

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
            )
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
                    rarityTierText={lookupResolvedRarityText}
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
                    rarityTierText={rarityTierForPokemon(compareLeft) ? prettyToken(rarityTierForPokemon(compareLeft)) : null}
                  />
                  {compareRight ? (
                    <PokemonPanel
                      pokemon={compareRight}
                      targetTypes={targetTypes}
                      weather={activeWeather}
                      typeEffectiveness={typeEffectiveness}
                      meaningfulFormCountByName={meaningfulFormCountByName}
                      rarityTierText={rarityTierForPokemon(compareRight) ? prettyToken(rarityTierForPokemon(compareRight)) : null}
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          ) : mode === "rarity" ? (
            <>
              <section className="panel raid-banner">
                <div className="panel-header">
                  <div className="raid-banner-title">
                    <div className="raid-banner-title-copy">
                      <div className="raid-header-title-line">
                        <h3>Spawn Rarity (Baseline)</h3>
                      </div>
                    </div>
                  </div>
                  <span>{rarityFilteredRows.length} shown</span>
                </div>
                <div className="ranking-summary raid-summary">
                  <span>
                    <strong>Model:</strong> Estimated semantic rarity
                  </span>
                  <span>
                    <strong>Scope:</strong> Non-event baseline
                  </span>
                  <span>
                    <strong>Note:</strong> Not official Niantic spawn probabilities
                  </span>
                </div>
              </section>

              <section className="compare-bar panel">
                <label className="field">
                  <span>Compare left</span>
                  <select value={rarityCompareLeft?.key ?? ""} onChange={(event) => setRarityCompareLeftKey(event.target.value)}>
                    {rarityFilteredRows.map((entry) => (
                      <option key={`rarity-left-${entry.key}`} value={entry.key}>
                        #{entry.rarity.pokemonId} {entry.rarity.pokemonName}
                        {entry.rarity.form && normalizeQuery(entry.rarity.form) !== "normal"
                          ? ` (${entry.rarity.form})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Compare right</span>
                  <select value={rarityCompareRight?.key ?? ""} onChange={(event) => setRarityCompareRightKey(event.target.value)}>
                    {rarityFilteredRows.map((entry) => (
                      <option key={`rarity-right-${entry.key}`} value={entry.key}>
                        #{entry.rarity.pokemonId} {entry.rarity.pokemonName}
                        {entry.rarity.form && normalizeQuery(entry.rarity.form) !== "normal"
                          ? ` (${entry.rarity.form})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <div className="compare-grid">
                {rarityCompareLeft ? (
                  <section className="panel detail-card">
                    <div className="detail-top">
                      <div className="artwork-wrap">
                        {rarityCompareLeft.pokemon?.artwork?.official_artwork ||
                        rarityCompareLeft.pokemon?.artwork?.home ||
                        rarityCompareLeft.pokemon?.artwork?.sprite ? (
                          <img
                            src={
                              rarityCompareLeft.pokemon?.artwork?.official_artwork ||
                              rarityCompareLeft.pokemon?.artwork?.home ||
                              rarityCompareLeft.pokemon?.artwork?.sprite ||
                              ""
                            }
                            alt={rarityCompareLeft.rarity.pokemonName}
                          />
                        ) : (
                          <div className="artwork-placeholder">No artwork</div>
                        )}
                      </div>
                      <div className="detail-copy">
                        <div className="pokemon-title">
                          #{rarityCompareLeft.rarity.pokemonId} {rarityCompareLeft.rarity.pokemonName}
                          {rarityCompareLeft.rarity.form && normalizeQuery(rarityCompareLeft.rarity.form) !== "normal" ? (
                            <span className="pokemon-form-inline"> ({rarityCompareLeft.rarity.form})</span>
                          ) : null}
                        </div>
                        <div className="type-row">
                          {(rarityCompareLeft.species?.types ?? rarityCompareLeft.pokemon?.types ?? []).map((type) => (
                            <TypeBadge key={`${rarityCompareLeft.key}-${type}`} type={type} />
                          ))}
                        </div>
                        <div className="ranking-summary raid-summary">
                          <span><strong>Tier:</strong> <RarityPill value={rarityCompareLeft.rarity.rarityTier} /></span>
                          <span><strong>Wild:</strong> {prettyToken(rarityCompareLeft.rarity.wildAvailability)}</span>
                          <span><strong>Geo:</strong> {prettyToken(rarityCompareLeft.rarity.geoAvailability)}</span>
                          <span><strong>Confidence:</strong> {prettyToken(rarityCompareLeft.rarity.confidence)}</span>
                          <span><strong>Generation:</strong> {rarityCompareLeft.species?.generation ?? "n/a"}</span>
                        </div>
                        <p className="raid-note">{rarityCompareLeft.rarity.notes ?? "No notes."}</p>
                        <p className="pokemon-form-inline">Sources: {rarityCompareLeft.rarity.sources.join(", ")}</p>
                      </div>
                    </div>
                  </section>
                ) : null}
                {rarityCompareRight ? (
                  <section className="panel detail-card">
                    <div className="detail-top">
                      <div className="artwork-wrap">
                        {rarityCompareRight.pokemon?.artwork?.official_artwork ||
                        rarityCompareRight.pokemon?.artwork?.home ||
                        rarityCompareRight.pokemon?.artwork?.sprite ? (
                          <img
                            src={
                              rarityCompareRight.pokemon?.artwork?.official_artwork ||
                              rarityCompareRight.pokemon?.artwork?.home ||
                              rarityCompareRight.pokemon?.artwork?.sprite ||
                              ""
                            }
                            alt={rarityCompareRight.rarity.pokemonName}
                          />
                        ) : (
                          <div className="artwork-placeholder">No artwork</div>
                        )}
                      </div>
                      <div className="detail-copy">
                        <div className="pokemon-title">
                          #{rarityCompareRight.rarity.pokemonId} {rarityCompareRight.rarity.pokemonName}
                          {rarityCompareRight.rarity.form && normalizeQuery(rarityCompareRight.rarity.form) !== "normal" ? (
                            <span className="pokemon-form-inline"> ({rarityCompareRight.rarity.form})</span>
                          ) : null}
                        </div>
                        <div className="type-row">
                          {(rarityCompareRight.species?.types ?? rarityCompareRight.pokemon?.types ?? []).map((type) => (
                            <TypeBadge key={`${rarityCompareRight.key}-${type}`} type={type} />
                          ))}
                        </div>
                        <div className="ranking-summary raid-summary">
                          <span><strong>Tier:</strong> <RarityPill value={rarityCompareRight.rarity.rarityTier} /></span>
                          <span><strong>Wild:</strong> {prettyToken(rarityCompareRight.rarity.wildAvailability)}</span>
                          <span><strong>Geo:</strong> {prettyToken(rarityCompareRight.rarity.geoAvailability)}</span>
                          <span><strong>Confidence:</strong> {prettyToken(rarityCompareRight.rarity.confidence)}</span>
                          <span><strong>Generation:</strong> {rarityCompareRight.species?.generation ?? "n/a"}</span>
                        </div>
                        <p className="raid-note">{rarityCompareRight.rarity.notes ?? "No notes."}</p>
                        <p className="pokemon-form-inline">Sources: {rarityCompareRight.rarity.sources.join(", ")}</p>
                      </div>
                    </div>
                  </section>
                ) : null}
              </div>
            </>
          ) : mode === "stats" ? (
            <>
              <section className="panel raid-banner">
                <div className="panel-header">
                  <div className="raid-banner-title">
                    <div className="raid-banner-title-copy">
                      <div className="raid-header-title-line">
                        <h3>Stats Ranking</h3>
                      </div>
                    </div>
                  </div>
                  <span>{statsRows.length} shown</span>
                </div>
                <div className="ranking-summary raid-summary">
                  <span>
                    <strong>CP mode:</strong> {cpMode === "level40" ? "Level 40 (15/15/15)" : "Level 50 (15/15/15)"}
                  </span>
                  <span>
                    <strong>Sort:</strong> {statsSortMode}
                  </span>
                  <span>
                    <strong>Movesets per Pokemon:</strong> {statsMaxMovesets}
                  </span>
                </div>
              </section>
              <StatsRankingTable
                rows={statsRows}
                cpMode={cpMode}
                sortMode={statsSortMode}
                meaningfulFormCountByName={meaningfulFormCountByName}
              />
            </>
          ) : mode === "pvp" ? (
            <>
              <div className="pvp-mode-shell">
                {pvpTeamBuilderEnabled ? (
                  <TeamBuilderPanel
                    slots={teamBuilderResolvedSlots}
                    slotMoves={teamBuilderSlotMoves}
                    activeSlot={teamBuilderActiveSlot}
                    onSetActiveSlot={setTeamBuilderActiveSlot}
                    onRequestSaveTeam={requestSaveCurrentTeam}
                    onMakeRecommendations={makeTeamRecommendations}
                    onClearSlot={(index) => {
                      setTeamBuilderSlots((current) => current.map((value, slotIndex) => (slotIndex === index ? null : value)));
                      setTeamBuilderSlotMoves((current) =>
                        current.map((value, slotIndex) =>
                          slotIndex === index ? { fast: null, charged1: null, charged2: null } : value,
                        ),
                      );
                    }}
                    onUpdateSlotMove={(index, field, value) =>
                      setTeamBuilderSlotMoves((current) =>
                        current.map((row, slotIndex) =>
                          slotIndex === index ? { ...row, [field]: value || null } : row,
                        ),
                      )
                    }
                    typeEffectiveness={typeEffectiveness}
                  />
                ) : (
                  <PvpMetaDetail
                    row={selectedPvpRow?.row ?? null}
                    pokemon={selectedPvpRow?.pokemon ?? null}
                    typeEffectiveness={typeEffectiveness}
                    meaningfulFormCountByName={meaningfulFormCountByName}
                    allPokemon={visiblePokemon}
                    league={pvpLeague}
                    squadEntry={selectedPvpRow ? pvpLeagueSquad[selectedPvpRow.row.canonical_id] ?? null : null}
                    onSaveSquad={savePvpSquadEntry}
                    onDeleteSquad={deletePvpSquadEntry}
                  />
                )}

                <div className="pvp-list-scroll">
                  {!pvpFilteredRows.length ? (
                    <section className="panel raid-banner">
                      <div className="raid-note">
                        {state.pvpMetaError ? state.pvpMetaError : "Loading PvP rankings..."}
                      </div>
                    </section>
                  ) : null}
                  <PvpMetaTable
                    rows={pvpFilteredRows.map((entry) => entry.row)}
                    selectedId={
                      pvpTeamBuilderEnabled
                        ? teamBuilderActiveSlot === null
                          ? null
                          : teamBuilderSlots[teamBuilderActiveSlot] ?? null
                        : selectedPvpRow?.row.canonical_id ?? null
                    }
                    onSelect={(row) => {
                      if (pvpTeamBuilderEnabled) {
                        const targetSlot =
                          teamBuilderActiveSlot ??
                          teamBuilderSlots.findIndex((slot) => !slot);
                        const resolvedTargetSlot = targetSlot >= 0 ? targetSlot : 0;
                        const selectedEntry = pvpEntryByCanonicalId.get(row.canonical_id) ?? null;
                        const recommended = selectedEntry
                          ? recommendedMovesForEntry(selectedEntry)
                          : { fast: null, charged1: null, charged2: null };
                        setTeamBuilderSlots((current) => {
                          const wasEmpty = !current[resolvedTargetSlot];
                          const updated = current.map((value, index) =>
                            index === resolvedTargetSlot ? row.canonical_id : value,
                          );
                          if (wasEmpty) {
                            const nextEmpty = updated.findIndex((slot) => !slot);
                            setTeamBuilderActiveSlot(nextEmpty >= 0 ? nextEmpty : (resolvedTargetSlot + 1) % 3);
                          } else {
                            setTeamBuilderActiveSlot(resolvedTargetSlot);
                          }
                          return updated;
                        });
                        setTeamBuilderSlotMoves((current) =>
                          current.map((value, index) => (index === resolvedTargetSlot ? recommended : value)),
                        );
                        return;
                      }
                      setPvpSelectedId(row.canonical_id);
                    }}
                    pokemonByCanonicalId={pvpPokemonByCanonicalId}
                    league={pvpLeague}
                    collectionViewEnabled={pvpCollectionViewEnabled}
                    squadByCanonicalId={pvpLeagueSquad}
                  />
                </div>
              </div>
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
            ) : mode === "pvp" ? (
              <p>
                PvP mode uses PvPoke {pvpLeague[0].toUpperCase()}{pvpLeague.slice(1)} League rankings and scores directly. Elite TM flags are inferred by
                comparing the recommended PvPoke moveset against local normal-vs-elite move pools. Unresolved markers
                flag recommended moves that are missing from local species assignments or local move dictionaries.
              </p>
            ) : mode === "stats" ? (
              <p>
                Stats view cycle DPS uses fast moves to one charged move, includes STAB, excludes weather, and applies
                type effectiveness. Each Pokemon first auto-selects one best target type, and all shown movesets for
                that Pokemon are constrained to that same target. Rows are only kept when both fast and charged moves
                are super effective for that target. CP uses max IV (15/15/15) at the selected level.
              </p>
            ) : mode === "rarity" ? (
              <p>
                Rarity mode uses semantic baseline tiers only (common to ultra rare, plus event-only and not-wild). It
                intentionally avoids claiming official spawn percentages.
              </p>
            ) : null}
          </section>
        </section>
      </main>
      {teamSaveDraft.open ? (
        <div className="team-save-modal-backdrop" role="presentation">
          <form
            className="team-save-modal panel"
            onSubmit={(event) => {
              event.preventDefault();
              if (teamSaveDraft.action === "rename") {
                renameSelectedSavedTeam(teamSaveDraft.name);
              } else {
                saveCurrentTeam(teamSaveDraft.name);
              }
            }}
          >
            <div className="panel-header">
              <h3>{teamSaveDraft.action === "rename" ? "Rename Team" : "Save Team"}</h3>
              <button
                type="button"
                className="mode-pill team-save-modal-close"
                onClick={() => setTeamSaveDraft({ open: false, name: "", action: "save" })}
              >
                Cancel
              </button>
            </div>
            <label className="field">
              <span>Name</span>
              <input
                autoFocus
                value={teamSaveDraft.name}
                onChange={(event) => setTeamSaveDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Great League safe swap team"
              />
            </label>
            <button type="submit" className="mode-pill active team-save-modal-submit">
              {teamSaveDraft.action === "rename" ? "Rename Team" : "Save Team"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}


