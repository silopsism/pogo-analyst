import type { MergedData, MoveEntry, PokemonEntry } from "./types.ts";

export type WeatherName =
  | "None"
  | "Sunny"
  | "Rainy"
  | "Partly Cloudy"
  | "Cloudy"
  | "Windy"
  | "Snow"
  | "Fog";

export const WEATHER_OPTIONS: WeatherName[] = [
  "None",
  "Sunny",
  "Rainy",
  "Partly Cloudy",
  "Cloudy",
  "Windy",
  "Snow",
  "Fog",
];

const WEATHER_BOOSTS: Record<Exclude<WeatherName, "None">, string[]> = {
  Sunny: ["Fire", "Grass", "Ground"],
  Rainy: ["Bug", "Electric", "Water"],
  "Partly Cloudy": ["Normal", "Rock"],
  Cloudy: ["Fairy", "Fighting", "Poison"],
  Windy: ["Dragon", "Flying", "Psychic"],
  Snow: ["Ice", "Steel"],
  Fog: ["Dark", "Ghost"],
};

export type ScoredMove = {
  name: string;
  type: string | null;
  move_kind: string | null;
  power: number | null;
  duration: number | null;
  raw_dps: number | null;
  attack_multiplier: number;
  stab_multiplier: number;
  matchup_multiplier: number;
  weather_multiplier: number;
  effective_dps: number | null;
};

export type ScoredPokemon = {
  pokemon: PokemonEntry;
  moves: ScoredMove[];
  best_move: ScoredMove | null;
  best_fast_move: ScoredMove | null;
  best_charged_move: ScoredMove | null;
  best_effective_dps: number | null;
};

export type RankingMode = "fast" | "charged" | "cycle";

export type CycleScore = {
  fast_move: ScoredMove;
  charged_move: ScoredMove;
  fast_uses: number;
  total_damage: number;
  total_duration_ms: number;
  cycle_dps: number;
};

export type RankedPokemon = {
  pokemon: PokemonEntry;
  score_kind: RankingMode;
  score: number | null;
  selected_fast_move: ScoredMove | null;
  selected_charged_move: ScoredMove | null;
  cycle: CycleScore | null;
};

function moveRaidDps(move: MoveEntry): number | null {
  return move.raid_dps ?? move.raw_dps ?? null;
}

function attackMultiplier(pokemon: PokemonEntry): number {
  const attack = pokemon.base_stats.attack ?? 100;
  return attack > 0 ? attack / 100 : 1;
}

export function matchupMultiplier(
  attackType: string | null | undefined,
  defenderTypes: string[],
  typeEffectiveness: MergedData["type_effectiveness"],
): number {
  if (!attackType) {
    return 1;
  }

  const attackKey = attackType.trim();
  let multiplier = 1;
  for (const defenderType of defenderTypes) {
    multiplier *= typeEffectiveness[attackKey]?.[defenderType.trim()] ?? 1;
  }
  return multiplier;
}

export function weatherMultiplier(weather: WeatherName, moveType: string | null | undefined): number {
  if (weather === "None" || !moveType) {
    return 1;
  }
  const boostedTypes = WEATHER_BOOSTS[weather];
  return boostedTypes.includes(moveType.trim()) ? 1.2 : 1;
}

export function scoreMove(
  move: MoveEntry,
  defenderTypes: string[],
  weather: WeatherName,
  typeEffectiveness: MergedData["type_effectiveness"],
  pokemonAttackMultiplier = 1,
): ScoredMove {
  const rawDps = moveRaidDps(move);
  const stabMultiplier = move.stab_multiplier ?? 1;
  const matchup = matchupMultiplier(move.type, defenderTypes, typeEffectiveness);
  const weatherBoost = weatherMultiplier(weather, move.type);
  const effectiveDps =
    rawDps === null ? null : Number((rawDps * stabMultiplier * matchup * weatherBoost * pokemonAttackMultiplier).toFixed(3));

  return {
    name: move.name,
    type: move.type ?? null,
    move_kind: move.move_kind ?? null,
    power: move.power ?? null,
    duration: move.duration ?? null,
    raw_dps: rawDps,
    attack_multiplier: Number(pokemonAttackMultiplier.toFixed(4)),
    stab_multiplier: stabMultiplier,
    matchup_multiplier: Number(matchup.toFixed(4)),
    weather_multiplier: Number(weatherBoost.toFixed(4)),
    effective_dps: effectiveDps,
  };
}

function bestByKind(moves: ScoredMove[], kinds: string[]): ScoredMove | null {
  const filtered = moves.filter((move) => move.move_kind !== null && kinds.includes(move.move_kind));
  return filtered.length ? filtered[0] : null;
}

function moveDamage(move: ScoredMove): number | null {
  if (move.effective_dps === null || move.duration === null) {
    return null;
  }
  return Number((move.effective_dps * (move.duration / 1000)).toFixed(3));
}

function bestCycleScore(
  pokemon: PokemonEntry,
  defenderTypes: string[],
  weather: WeatherName,
  typeEffectiveness: MergedData["type_effectiveness"],
): CycleScore | null {
  const attackerMultiplier = attackMultiplier(pokemon);
  const fastMoves = [...pokemon.moves.fast, ...pokemon.moves.elite_fast].map((move) =>
    scoreMove(move, defenderTypes, weather, typeEffectiveness, attackerMultiplier),
  );
  const chargedMoves = [...pokemon.moves.charged, ...pokemon.moves.elite_charged].map((move) =>
    scoreMove(move, defenderTypes, weather, typeEffectiveness, attackerMultiplier),
  );

  let best: CycleScore | null = null;

  for (const fastMove of fastMoves) {
    const fastGain = pokemon.moves.fast.find((move) => move.name === fastMove.name && move.move_kind === fastMove.move_kind)?.energy_delta ??
      pokemon.moves.elite_fast.find((move) => move.name === fastMove.name && move.move_kind === fastMove.move_kind)?.energy_delta ??
      0;
    if (fastGain <= 0 || fastMove.duration === null || fastMove.raw_dps === null) {
      continue;
    }

    const fastDamage = moveDamage(fastMove);
    if (fastDamage === null) {
      continue;
    }

    for (const chargedMove of chargedMoves) {
      const chargedCost =
        Math.abs(
          pokemon.moves.charged.find((move) => move.name === chargedMove.name && move.move_kind === chargedMove.move_kind)?.energy_delta ??
            pokemon.moves.elite_charged.find((move) => move.name === chargedMove.name && move.move_kind === chargedMove.move_kind)?.energy_delta ??
            0,
        );
      if (chargedCost <= 0 || chargedMove.duration === null || chargedMove.raw_dps === null) {
        continue;
      }

      const chargedDamage = moveDamage(chargedMove);
      if (chargedDamage === null) {
        continue;
      }

      const fastUses = Math.max(1, Math.ceil(chargedCost / fastGain));
      const totalDamage = fastDamage * fastUses + chargedDamage;
      const totalDurationMs = fastMove.duration * fastUses + chargedMove.duration;
      if (totalDurationMs <= 0) {
        continue;
      }

      const cycleDps = Number((totalDamage / (totalDurationMs / 1000)).toFixed(3));
      const candidate: CycleScore = {
        fast_move: fastMove,
        charged_move: chargedMove,
        fast_uses: fastUses,
        total_damage: Number(totalDamage.toFixed(3)),
        total_duration_ms: totalDurationMs,
        cycle_dps: cycleDps,
      };

      if (!best || candidate.cycle_dps > best.cycle_dps) {
        best = candidate;
      }
    }
  }

  return best;
}

export function scorePokemon(
  pokemon: PokemonEntry,
  defenderTypes: string[],
  weather: WeatherName,
  typeEffectiveness: MergedData["type_effectiveness"],
): ScoredPokemon {
  const attackerMultiplier = attackMultiplier(pokemon);
  const moves = [
    ...pokemon.moves.fast,
    ...pokemon.moves.elite_fast,
    ...pokemon.moves.charged,
    ...pokemon.moves.elite_charged,
  ]
    .map((move) => scoreMove(move, defenderTypes, weather, typeEffectiveness, attackerMultiplier))
    .sort((a, b) => (b.effective_dps ?? 0) - (a.effective_dps ?? 0));

  return {
    pokemon,
    moves,
    best_move: moves[0] ?? null,
    best_fast_move: bestByKind(moves, ["fast", "elite_fast"]),
    best_charged_move: bestByKind(moves, ["charged", "elite_charged"]),
    best_effective_dps: moves[0]?.effective_dps ?? null,
  };
}

export function rankPokemon(
  pokemon: PokemonEntry[],
  defenderTypes: string[],
  weather: WeatherName,
  typeEffectiveness: MergedData["type_effectiveness"],
  mode: RankingMode,
): RankedPokemon[] {
  return pokemon
    .map((entry) => {
      const scored = scorePokemon(entry, defenderTypes, weather, typeEffectiveness);
      const cycle = bestCycleScore(entry, defenderTypes, weather, typeEffectiveness);

      if (mode === "fast") {
        return {
          pokemon: entry,
          score_kind: mode,
          score: scored.best_fast_move?.effective_dps ?? null,
          selected_fast_move: scored.best_fast_move,
          selected_charged_move: null,
          cycle,
        };
      }

      if (mode === "charged") {
        return {
          pokemon: entry,
          score_kind: mode,
          score: scored.best_charged_move?.effective_dps ?? null,
          selected_fast_move: null,
          selected_charged_move: scored.best_charged_move,
          cycle,
        };
      }

      return {
        pokemon: entry,
        score_kind: mode,
        score: cycle?.cycle_dps ?? null,
        selected_fast_move: cycle?.fast_move ?? null,
        selected_charged_move: cycle?.charged_move ?? null,
        cycle,
      };
    })
    .filter((entry) => entry.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export function percentOfBest(value: number | null, best: number | null): number | null {
  if (value === null || best === null || best <= 0) {
    return null;
  }
  return Number(((value / best) * 100).toFixed(1));
}

export function matchupBonusPercent(multiplier: number): number {
  return Number(((multiplier - 1) * 100).toFixed(1));
}
