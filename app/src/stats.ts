import { normalizeQuery } from "./data.ts";
import type { MergedData, MoveEntry, PokemonEntry } from "./types.ts";

export type CpMode = "level40" | "level50";
export type StatsSortMode = "cp" | "attack" | "defense" | "hp" | "tankiness" | "basic_cycle_dps";

export type StatsMovesetRow = {
  pokemon: PokemonEntry;
  fast_move: MoveEntry;
  charged_move: MoveEntry;
  basic_cycle_dps: number;
  best_target_types: string[];
  attack: number;
  defense: number;
  hp: number;
  tankiness: number;
  cp: number;
  resisted_targets: string[];
};

const STAB_MULTIPLIER = 1.2;
const CPM_BY_MODE: Record<CpMode, number> = {
  level40: 0.7903,
  level50: 0.84029999,
};

function moveKey(move: MoveEntry): string {
  return `${move.move_kind ?? "move"}::${move.name}`;
}

function collectRaidMoves(pokemon: PokemonEntry, kind: "fast" | "charged"): MoveEntry[] {
  const movePools =
    kind === "fast"
      ? [pokemon.moves.fast, pokemon.moves.elite_fast]
      : [pokemon.moves.charged, pokemon.moves.elite_charged];

  const seen = new Set<string>();
  const moves: MoveEntry[] = [];

  for (const pool of movePools) {
    for (const move of pool) {
      const key = moveKey(move);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      moves.push(move);
    }
  }

  return moves;
}

function isSameType(a: string | null | undefined, b: string): boolean {
  if (!a) {
    return false;
  }
  return normalizeQuery(a) === normalizeQuery(b);
}

function isStab(move: MoveEntry, pokemon: PokemonEntry): boolean {
  return pokemon.types.some((type) => isSameType(move.type, type));
}

function typeMultiplier(
  attackType: string | null | undefined,
  defenderType: string,
  typeEffectiveness: MergedData["type_effectiveness"],
): number {
  if (!attackType) {
    return 1;
  }
  return typeEffectiveness[attackType]?.[defenderType] ?? 1;
}

function computeCp(pokemon: PokemonEntry, mode: CpMode): number {
  const cpm = CPM_BY_MODE[mode];
  const attack = pokemon.base_stats.attack ?? 1;
  const defense = pokemon.base_stats.defense ?? 1;
  const stamina = pokemon.base_stats.stamina ?? 1;
  const attackIv = attack + 15;
  const defenseIv = defense + 15;
  const staminaIv = stamina + 15;
  const cp = Math.floor((attackIv * Math.sqrt(defenseIv) * Math.sqrt(staminaIv) * cpm * cpm) / 10);
  return Math.max(10, cp);
}

function computeCycleDps(
  attackerScaledAttack: number,
  pokemonTypes: string[],
  fastMove: MoveEntry,
  chargedMove: MoveEntry,
  targetType: string,
  typeEffectiveness: MergedData["type_effectiveness"],
): number | null {
  const fastPower = fastMove.power ?? 0;
  const chargedPower = chargedMove.power ?? 0;
  const fastDurationMs = fastMove.duration ?? 0;
  const chargedDurationMs = chargedMove.duration ?? 0;
  const fastEnergyGain = Math.max(0, fastMove.energy_delta ?? 0);
  const chargedCost = Math.max(0, Math.abs(chargedMove.energy_delta ?? 0));

  if (fastPower <= 0 || chargedPower <= 0 || fastDurationMs <= 0 || chargedDurationMs <= 0) {
    return null;
  }
  if (fastEnergyGain <= 0 || chargedCost <= 0) {
    return null;
  }

  const fastUses = Math.max(1, Math.ceil(chargedCost / fastEnergyGain));
  const fastStab = pokemonTypes.some((type) => isSameType(fastMove.type, type)) ? STAB_MULTIPLIER : 1;
  const chargedStab = pokemonTypes.some((type) => isSameType(chargedMove.type, type)) ? STAB_MULTIPLIER : 1;
  const fastMultiplier = typeMultiplier(fastMove.type, targetType, typeEffectiveness);
  const chargedMultiplier = typeMultiplier(chargedMove.type, targetType, typeEffectiveness);
  if (fastMultiplier <= 1 || chargedMultiplier <= 1) {
    return null;
  }
  const normalizedDefense = 100;
  const fastDamage = Math.max(1, Math.floor(0.5 * fastPower * (attackerScaledAttack / normalizedDefense) * fastStab * fastMultiplier) + 1);
  const chargedDamage = Math.max(
    1,
    Math.floor(0.5 * chargedPower * (attackerScaledAttack / normalizedDefense) * chargedStab * chargedMultiplier) + 1,
  );
  const totalDamage = fastDamage * fastUses + chargedDamage;
  const totalDurationSeconds = (fastDurationMs * fastUses + chargedDurationMs) / 1000;
  if (totalDurationSeconds <= 0) {
    return null;
  }
  return Number((totalDamage / totalDurationSeconds).toFixed(3));
}

function effectBuckets(
  fastMove: MoveEntry,
  chargedMove: MoveEntry,
  targetTypes: string[],
  typeEffectiveness: MergedData["type_effectiveness"],
): { resisted: string[] } {
  const resisted: string[] = [];

  for (const targetType of targetTypes) {
    const fastMult = typeMultiplier(fastMove.type, targetType, typeEffectiveness);
    const chargedMult = typeMultiplier(chargedMove.type, targetType, typeEffectiveness);
    if (fastMult < 1 && chargedMult < 1) {
      resisted.push(targetType);
    }
  }

  return { resisted };
}

function scaledAttackAtMode(pokemon: PokemonEntry, mode: CpMode): number {
  const cpm = CPM_BY_MODE[mode];
  const attack = (pokemon.base_stats.attack ?? 1) + 15;
  return attack * cpm;
}

export function computeStatsRows(
  pokemon: PokemonEntry[],
  cpMode: CpMode,
  maxMovesetsPerPokemon: number,
  targetTypes: string[],
  typeEffectiveness: MergedData["type_effectiveness"],
): StatsMovesetRow[] {
  const EPSILON = 0.0001;
  const cap = Math.max(1, Math.floor(maxMovesetsPerPokemon));
  const rows: StatsMovesetRow[] = [];

  for (const entry of pokemon) {
    const fastMoves = collectRaidMoves(entry, "fast");
    const chargedMoves = collectRaidMoves(entry, "charged");
    const cp = computeCp(entry, cpMode);
    const scaledAttack = scaledAttackAtMode(entry, cpMode);
    const attack = entry.base_stats.attack ?? 0;
    const defense = entry.base_stats.defense ?? 0;
    const hp = entry.base_stats.stamina ?? 0;
    const tankiness = defense * hp;

    const rowsByTarget = new Map<string, StatsMovesetRow[]>();
    for (const targetType of targetTypes) {
      rowsByTarget.set(targetType, []);
    }

    for (const fastMove of fastMoves) {
      for (const chargedMove of chargedMoves) {
        for (const targetType of targetTypes) {
          const cycleDps = computeCycleDps(
            scaledAttack,
            entry.types,
            fastMove,
            chargedMove,
            targetType,
            typeEffectiveness,
          );
          if (cycleDps === null) {
            continue;
          }
          const buckets = effectBuckets(fastMove, chargedMove, targetTypes, typeEffectiveness);
          rowsByTarget.get(targetType)?.push({
            pokemon: entry,
            fast_move: fastMove,
            charged_move: chargedMove,
            basic_cycle_dps: cycleDps,
            best_target_types: [targetType],
            attack,
            defense,
            hp,
            tankiness,
            cp,
            resisted_targets: buckets.resisted,
          });
        }
      }
    }

    let chosenRows: StatsMovesetRow[] = [];
    let chosenBestDps = -1;
    const chosenTargets: string[] = [];
    for (const [targetType, candidateRows] of rowsByTarget.entries()) {
      if (!candidateRows.length) {
        continue;
      }
      candidateRows.sort((a, b) => b.basic_cycle_dps - a.basic_cycle_dps);
      const bestForTarget = candidateRows[0].basic_cycle_dps;
      if (bestForTarget > chosenBestDps + EPSILON) {
        chosenBestDps = bestForTarget;
        chosenTargets.length = 0;
        chosenTargets.push(targetType);
      } else if (Math.abs(bestForTarget - chosenBestDps) <= EPSILON) {
        chosenTargets.push(targetType);
      }
    }

    if (!chosenTargets.length) {
      continue;
    }

    const mergedRows = new Map<string, StatsMovesetRow>();
    for (const targetType of chosenTargets) {
      const candidateRows = rowsByTarget.get(targetType) ?? [];
      for (const row of candidateRows) {
        const key = `${moveKey(row.fast_move)}::${moveKey(row.charged_move)}`;
        const existing = mergedRows.get(key);
        if (!existing) {
          mergedRows.set(key, {
            ...row,
            best_target_types: [targetType],
          });
          continue;
        }
        if (row.basic_cycle_dps > existing.basic_cycle_dps + EPSILON) {
          existing.basic_cycle_dps = row.basic_cycle_dps;
          existing.best_target_types = [targetType];
          continue;
        }
        if (Math.abs(row.basic_cycle_dps - existing.basic_cycle_dps) <= EPSILON) {
          if (!existing.best_target_types.includes(targetType)) {
            existing.best_target_types.push(targetType);
          }
        }
      }
    }

    chosenRows = Array.from(mergedRows.values());

    chosenRows
      .sort((a, b) => b.basic_cycle_dps - a.basic_cycle_dps)
      .slice(0, cap)
      .forEach((row) => rows.push(row));
  }

  return rows;
}

export function sortStatsRows(rows: StatsMovesetRow[], sortMode: StatsSortMode): StatsMovesetRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sortMode === "cp") {
      return (
        b.cp - a.cp ||
        b.attack - a.attack ||
        b.defense - a.defense ||
        b.hp - a.hp ||
        b.tankiness - a.tankiness ||
        b.basic_cycle_dps - a.basic_cycle_dps
      );
    }
    if (sortMode === "attack") {
      return b.attack - a.attack || b.cp - a.cp || b.basic_cycle_dps - a.basic_cycle_dps;
    }
    if (sortMode === "defense") {
      return b.defense - a.defense || b.cp - a.cp || b.basic_cycle_dps - a.basic_cycle_dps;
    }
    if (sortMode === "hp") {
      return b.hp - a.hp || b.cp - a.cp || b.basic_cycle_dps - a.basic_cycle_dps;
    }
    if (sortMode === "tankiness") {
      return b.tankiness - a.tankiness || b.cp - a.cp || b.basic_cycle_dps - a.basic_cycle_dps;
    }
    return b.basic_cycle_dps - a.basic_cycle_dps || b.cp - a.cp;
  });
  return sorted;
}
