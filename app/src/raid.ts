import { matchupMultiplier, weatherMultiplier, type WeatherName } from "./scoring.ts";
import {
  simulateDeterministicRaidLife,
  simulateRaidWindowEventBased,
  type RaidLifeEventResult,
} from "./combat/eventRaidSim.ts";
import { CHARGED_MOVE_DAMAGE_FRACTION } from "./combat/moveDamage.ts";
import type { MergedData, MoveEntry, PokemonEntry } from "./types.ts";

export type RaidBossAssumption =
  | "Best for attacker"
  | "Worst for attacker"
  | "Average"
  | "Specific moveset";

export type RaidMovesetSelection = {
  fastKey: string | null;
  chargedKey: string | null;
};

export type RaidSortMode = "raid_dps" | "base_dps";
export type RaidSimulationMode = "spiked" | "smoothed";

export type RaidBossScenario = {
  fast_move: MoveEntry;
  charged_move: MoveEntry;
  key: string;
};

export type RaidAttackerRow = {
  pokemon: PokemonEntry;
  fast_move: MoveEntry;
  charged_move: MoveEntry;
  moveset_label: string;
  base_dps: number;
  survival_seconds: number;
  damage_per_life: number;
  team_damage: number;
  team_dps: number;
  attack_cycle_seconds: number;
  incoming_boss_dps: number;
};

// Tunable raid-pressure calibration. Lowering this softens boss DPS without changing the underlying damage formula.
export const BOSS_DPS_SCALE = 0.8;
export const RAID_REPLACEMENT_DELAY_SECONDS = 2;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

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

export function raidMovePools(pokemon: PokemonEntry): { fast: MoveEntry[]; charged: MoveEntry[] } {
  return {
    fast: collectRaidMoves(pokemon, "fast"),
    charged: collectRaidMoves(pokemon, "charged"),
  };
}

export function raidMoveLabel(move: MoveEntry): string {
  return move.name;
}

export function raidMoveKey(move: MoveEntry): string {
  return moveKey(move);
}

function compareRows(a: RaidAttackerRow, b: RaidAttackerRow): number {
  return b.team_dps - a.team_dps || b.base_dps - a.base_dps;
}

function getAttack(value: number | null | undefined): number {
  return Math.max(1, value ?? 1);
}

function getDefense(value: number | null | undefined): number {
  return Math.max(1, value ?? 1);
}

function effectiveHp(pokemon: PokemonEntry): number {
  return getDefense(pokemon.base_stats.stamina);
}

function moveEnergyGain(move: MoveEntry): number {
  return Math.max(0, move.energy_delta ?? 0);
}

function moveEnergyCost(move: MoveEntry): number {
  return Math.max(0, Math.abs(move.energy_delta ?? 0));
}

function moveDurationSeconds(move: MoveEntry): number {
  return Math.max(0, (move.duration ?? 0) / 1000);
}

export type RaidWindowSimulationOptions = {
  raidDurationSeconds: number;
  survivalSeconds: number;
  replacementDelaySeconds?: number;
  maxCopies?: number;
  copyDamageForActiveTime: (activeTimeSeconds: number) => number;
};

export type RaidWindowSimulationResult = {
  team_damage: number;
  team_dps: number;
  copies_used: number;
  raid_time_seconds: number;
};

export function simulateRaidWindow({
  raidDurationSeconds,
  survivalSeconds,
  replacementDelaySeconds = RAID_REPLACEMENT_DELAY_SECONDS,
  maxCopies = 6,
  copyDamageForActiveTime,
}: RaidWindowSimulationOptions): RaidWindowSimulationResult {
  const duration = Math.max(0, raidDurationSeconds);
  const survival = Math.max(0, survivalSeconds);
  const delay = Math.max(0, replacementDelaySeconds);
  const cap = Math.max(1, Math.floor(maxCopies));

  let time = 0;
  let copiesUsed = 0;
  let totalDamage = 0;

  while (time < duration && copiesUsed < cap) {
    const remainingRaidTime = duration - time;
    const activeTime = Math.min(survival, remainingRaidTime);
    if (activeTime <= 0) {
      break;
    }

    totalDamage += Math.max(0, copyDamageForActiveTime(activeTime));
    time += activeTime;
    copiesUsed += 1;

    const faintedBeforeRaidEnd = survival < remainingRaidTime;
    if (!faintedBeforeRaidEnd || copiesUsed >= cap || time >= duration) {
      break;
    }

    time = Math.min(duration, time + delay);
  }

  const teamDps = duration > 0 ? totalDamage / duration : 0;
  return {
    team_damage: Number(totalDamage.toFixed(3)),
    team_dps: Number(teamDps.toFixed(3)),
    copies_used: copiesUsed,
    raid_time_seconds: Number(time.toFixed(3)),
  };
}

function moveDamage(
  move: MoveEntry,
  attackerAttack: number,
  defenderDefense: number,
  attackerTypes: string[],
  defenderTypes: string[],
  weather: WeatherName,
  typeEffectiveness: MergedData["type_effectiveness"],
): number | null {
  const power = move.power ?? 0;
  const duration = move.duration ?? 0;
  if (power <= 0 || duration <= 0) {
    return null;
  }

  const stab = move.type && attackerTypes.some((type) => normalize(type) === normalize(move.type)) ? 1.2 : 1;
  const typeMultiplier = matchupMultiplier(move.type, defenderTypes, typeEffectiveness);
  const weatherBoost = weatherMultiplier(weather, move.type);
  const raw = 0.5 * power * (attackerAttack / defenderDefense) * stab * typeMultiplier * weatherBoost;
  return Math.max(1, Math.floor(raw) + 1);
}

function buildBossScenarios(boss: PokemonEntry, specificMoveset?: RaidMovesetSelection | null): RaidBossScenario[] {
  const pools = raidMovePools(boss);
  const scenarios: RaidBossScenario[] = [];

  for (const fastMove of pools.fast) {
    for (const chargedMove of pools.charged) {
      scenarios.push({
        fast_move: fastMove,
        charged_move: chargedMove,
        key: `${moveKey(fastMove)}::${moveKey(chargedMove)}`,
      });
    }
  }

  if (specificMoveset) {
    if (!specificMoveset.fastKey || !specificMoveset.chargedKey) {
      return [];
    }
    const selected = scenarios.find(
      (scenario) => scenario.key === `${specificMoveset.fastKey}::${specificMoveset.chargedKey}`,
    );
    return selected ? [selected] : [];
  }

  return scenarios;
}

function simulateBossIncomingDps(
  boss: PokemonEntry,
  attacker: PokemonEntry,
  scenario: RaidBossScenario,
  weather: WeatherName,
  typeEffectiveness: MergedData["type_effectiveness"],
): number | null {
  const bossAttack = getAttack(boss.base_stats.attack);
  const attackerDefense = getDefense(attacker.base_stats.defense);

  const fastDamage = moveDamage(
    scenario.fast_move,
    bossAttack,
    attackerDefense,
    boss.types,
    attacker.types,
    weather,
    typeEffectiveness,
  );
  const chargedDamage = moveDamage(
    scenario.charged_move,
    bossAttack,
    attackerDefense,
    boss.types,
    attacker.types,
    weather,
    typeEffectiveness,
  );
  const fastGain = moveEnergyGain(scenario.fast_move);
  const chargedCost = moveEnergyCost(scenario.charged_move);

  if (fastDamage === null || chargedDamage === null || fastGain <= 0 || chargedCost <= 0) {
    return null;
  }

  const fastUses = Math.max(1, Math.ceil(chargedCost / fastGain));
  const totalDamage = fastDamage * fastUses + chargedDamage;
  const totalTimeSeconds = moveDurationSeconds(scenario.fast_move) * fastUses + moveDurationSeconds(scenario.charged_move);

  if (totalTimeSeconds <= 0) {
    return null;
  }

  return (totalDamage / totalTimeSeconds) * BOSS_DPS_SCALE;
}

function simulateAttackerCycle(
  attacker: PokemonEntry,
  boss: PokemonEntry,
  fastMove: MoveEntry,
  chargedMove: MoveEntry,
  survivalSeconds: number,
  bossIncomingDps: number,
  weather: WeatherName,
  typeEffectiveness: MergedData["type_effectiveness"],
): { estimated_dps: number; total_damage: number; attack_cycle_seconds: number } | null {
  const attackerAttack = getAttack(attacker.base_stats.attack);
  const bossDefense = getDefense(boss.base_stats.defense);
  const fastGain = moveEnergyGain(fastMove);
  const chargedCost = moveEnergyCost(chargedMove);
  const fastDuration = moveDurationSeconds(fastMove);
  const chargedDuration = moveDurationSeconds(chargedMove);

  if (fastGain <= 0 || chargedCost <= 0 || fastDuration <= 0 || chargedDuration <= 0) {
    return null;
  }

  const fastDamage = moveDamage(
    fastMove,
    attackerAttack,
    bossDefense,
    attacker.types,
    boss.types,
    weather,
    typeEffectiveness,
  );
  const chargedDamage = moveDamage(
    chargedMove,
    attackerAttack,
    bossDefense,
    attacker.types,
    boss.types,
    weather,
    typeEffectiveness,
  );

  if (fastDamage === null || chargedDamage === null) {
    return null;
  }

  let time = 0;
  let energy = 0;
  let totalDamage = 0;

  while (time < survivalSeconds) {
    const useCharged = energy >= chargedCost;
    const damage = useCharged ? chargedDamage : fastDamage;
    const duration = useCharged ? chargedDuration : fastDuration;
    const damageTime = useCharged ? chargedDuration * CHARGED_MOVE_DAMAGE_FRACTION : duration;

    if (duration <= 0 || time + damageTime > survivalSeconds) {
      break;
    }

    totalDamage += damage;
    if (time + duration > survivalSeconds) {
      time = survivalSeconds;
      break;
    }

    time += duration;
    energy += useCharged ? -chargedCost : fastGain;
    energy += bossIncomingDps * 0.5 * duration;
    energy = Math.min(100, Math.max(0, energy));
  }

  const estimatedDps = time > 0 ? totalDamage / time : 0;
  return {
    estimated_dps: Number(estimatedDps.toFixed(3)),
    total_damage: Number(totalDamage.toFixed(3)),
    attack_cycle_seconds: Number(time.toFixed(3)),
  };
}

function computeBaseCycleDps(
  attacker: PokemonEntry,
  boss: PokemonEntry,
  fastMove: MoveEntry,
  chargedMove: MoveEntry,
  weather: WeatherName,
  typeEffectiveness: MergedData["type_effectiveness"],
): number | null {
  const attackerAttack = getAttack(attacker.base_stats.attack);
  const bossDefense = getDefense(boss.base_stats.defense);
  const fastGain = moveEnergyGain(fastMove);
  const chargedCost = moveEnergyCost(chargedMove);
  const fastDuration = moveDurationSeconds(fastMove);
  const chargedDuration = moveDurationSeconds(chargedMove);

  if (fastGain <= 0 || chargedCost <= 0 || fastDuration <= 0 || chargedDuration <= 0) {
    return null;
  }

  const fastDamage = moveDamage(
    fastMove,
    attackerAttack,
    bossDefense,
    attacker.types,
    boss.types,
    weather,
    typeEffectiveness,
  );
  const chargedDamage = moveDamage(
    chargedMove,
    attackerAttack,
    bossDefense,
    attacker.types,
    boss.types,
    weather,
    typeEffectiveness,
  );

  if (fastDamage === null || chargedDamage === null) {
    return null;
  }

  const fastUses = Math.max(1, Math.ceil(chargedCost / fastGain));
  const totalDamage = fastDamage * fastUses + chargedDamage;
  const totalDuration = fastDuration * fastUses + chargedDuration;
  if (totalDuration <= 0) {
    return null;
  }

  return Number((totalDamage / totalDuration).toFixed(3));
}

type PairOutcome = {
  fast_move: MoveEntry;
  charged_move: MoveEntry;
  survival_seconds: number;
  damage_per_life: number;
  attack_cycle_seconds: number;
  team_damage: number;
  team_dps: number;
  incoming_boss_dps: number;
};

function evaluateSpikedPairAgainstScenario(
  attacker: PokemonEntry,
  boss: PokemonEntry,
  fastMove: MoveEntry,
  chargedMove: MoveEntry,
  scenario: RaidBossScenario,
  weather: WeatherName,
  raidDurationSeconds: number,
  replacementDelaySeconds: number,
  typeEffectiveness: MergedData["type_effectiveness"],
): PairOutcome | null {
  const life: RaidLifeEventResult | null = simulateDeterministicRaidLife({
    attacker,
    boss,
    attackerFastMove: fastMove,
    attackerChargedMove: chargedMove,
    bossFastMove: scenario.fast_move,
    bossChargedMove: scenario.charged_move,
    weather,
    typeEffectiveness,
    timeLimitSeconds: Number.POSITIVE_INFINITY,
    tieBreak: "attacker-first",
  });

  if (!life) {
    return null;
  }

  const teamWindow = simulateRaidWindowEventBased({
    raidDurationSeconds,
    replacementDelaySeconds,
    maxCopies: 6,
    attacker,
    boss,
    attackerFastMove: fastMove,
    attackerChargedMove: chargedMove,
    bossFastMove: scenario.fast_move,
    bossChargedMove: scenario.charged_move,
    weather,
    typeEffectiveness,
  });

  const incomingBossDps = life.survival_seconds > 0 ? life.damage_taken / life.survival_seconds : 0;
  return {
    fast_move: fastMove,
    charged_move: chargedMove,
    survival_seconds: life.survival_seconds,
    damage_per_life: life.damage_dealt,
    attack_cycle_seconds: life.attack_cycle_seconds,
    team_damage: teamWindow.team_damage,
    team_dps: teamWindow.team_dps,
    incoming_boss_dps: Number(incomingBossDps.toFixed(3)),
  };
}

function evaluateSmoothedPairAgainstScenario(
  attacker: PokemonEntry,
  boss: PokemonEntry,
  fastMove: MoveEntry,
  chargedMove: MoveEntry,
  scenario: RaidBossScenario,
  weather: WeatherName,
  raidDurationSeconds: number,
  replacementDelaySeconds: number,
  typeEffectiveness: MergedData["type_effectiveness"],
): PairOutcome | null {
  const incomingBossDps = simulateBossIncomingDps(boss, attacker, scenario, weather, typeEffectiveness);
  if (incomingBossDps === null || incomingBossDps <= 0) {
    return null;
  }

  const attackerHp = effectiveHp(attacker);
  const survivalSeconds = attackerHp / incomingBossDps;
  const cycle = simulateAttackerCycle(
    attacker,
    boss,
    fastMove,
    chargedMove,
    survivalSeconds,
    incomingBossDps,
    weather,
    typeEffectiveness,
  );
  if (!cycle) {
    return null;
  }

  const teamWindow = simulateRaidWindow({
    raidDurationSeconds,
    survivalSeconds,
    replacementDelaySeconds,
    maxCopies: 6,
    copyDamageForActiveTime: (activeTimeSeconds) => {
      const activeCycle = simulateAttackerCycle(
        attacker,
        boss,
        fastMove,
        chargedMove,
        activeTimeSeconds,
        incomingBossDps,
        weather,
        typeEffectiveness,
      );
      return activeCycle?.total_damage ?? 0;
    },
  });

  return {
    fast_move: fastMove,
    charged_move: chargedMove,
    survival_seconds: Number(survivalSeconds.toFixed(3)),
    damage_per_life: cycle.total_damage,
    attack_cycle_seconds: cycle.attack_cycle_seconds,
    team_damage: teamWindow.team_damage,
    team_dps: teamWindow.team_dps,
    incoming_boss_dps: Number(incomingBossDps.toFixed(3)),
  };
}

function evaluatePairAgainstScenario(
  attacker: PokemonEntry,
  boss: PokemonEntry,
  fastMove: MoveEntry,
  chargedMove: MoveEntry,
  scenario: RaidBossScenario,
  weather: WeatherName,
  raidDurationSeconds: number,
  replacementDelaySeconds: number,
  simulationMode: RaidSimulationMode,
  typeEffectiveness: MergedData["type_effectiveness"],
): PairOutcome | null {
  return simulationMode === "spiked"
    ? evaluateSpikedPairAgainstScenario(
        attacker,
        boss,
        fastMove,
        chargedMove,
        scenario,
        weather,
        raidDurationSeconds,
        replacementDelaySeconds,
        typeEffectiveness,
      )
    : evaluateSmoothedPairAgainstScenario(
        attacker,
        boss,
        fastMove,
        chargedMove,
        scenario,
        weather,
        raidDurationSeconds,
        replacementDelaySeconds,
        typeEffectiveness,
      );
}

function summarizePairAcrossScenarios(
  outcomes: PairOutcome[],
  assumption: RaidBossAssumption,
): PairOutcome | null {
  if (!outcomes.length) {
    return null;
  }

  if (assumption === "Best for attacker") {
    return outcomes.reduce((best, current) => (current.team_damage > best.team_damage ? current : best));
  }

  if (assumption === "Worst for attacker") {
    return outcomes.reduce((worst, current) => (current.team_damage < worst.team_damage ? current : worst));
  }

  if (assumption !== "Average") {
    return outcomes[0];
  }

  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const first = outcomes[0];
  return {
    ...first,
    damage_per_life: Number(mean(outcomes.map((entry) => entry.damage_per_life)).toFixed(3)),
    survival_seconds: Number(mean(outcomes.map((entry) => entry.survival_seconds)).toFixed(3)),
    attack_cycle_seconds: Number(mean(outcomes.map((entry) => entry.attack_cycle_seconds)).toFixed(3)),
    team_damage: Number(mean(outcomes.map((entry) => entry.team_damage)).toFixed(3)),
    team_dps: Number(mean(outcomes.map((entry) => entry.team_dps)).toFixed(3)),
    incoming_boss_dps: Number(mean(outcomes.map((entry) => entry.incoming_boss_dps)).toFixed(3)),
  };
}

function evaluatePairAcrossBossScenarios(
  attacker: PokemonEntry,
  boss: PokemonEntry,
  fastMove: MoveEntry,
  chargedMove: MoveEntry,
  scenarios: RaidBossScenario[],
  assumption: RaidBossAssumption,
  weather: WeatherName,
  raidDurationSeconds: number,
  replacementDelaySeconds: number,
  simulationMode: RaidSimulationMode,
  typeEffectiveness: MergedData["type_effectiveness"],
): PairOutcome | null {
  const outcomes = scenarios
    .map((scenario) =>
      evaluatePairAgainstScenario(
        attacker,
        boss,
        fastMove,
        chargedMove,
        scenario,
        weather,
        raidDurationSeconds,
        replacementDelaySeconds,
        simulationMode,
        typeEffectiveness,
      ),
    )
    .filter((entry): entry is PairOutcome => Boolean(entry));
  return summarizePairAcrossScenarios(outcomes, assumption);
}

function buildRowsForAttacker(
  attacker: PokemonEntry,
  boss: PokemonEntry,
  scenarios: RaidBossScenario[],
  assumption: RaidBossAssumption,
  weather: WeatherName,
  raidDurationSeconds: number,
  replacementDelaySeconds: number,
  simulationMode: RaidSimulationMode,
  typeEffectiveness: MergedData["type_effectiveness"],
): RaidAttackerRow[] {
  const pools = raidMovePools(attacker);
  const rows: RaidAttackerRow[] = [];

  for (const fastMove of pools.fast) {
    for (const chargedMove of pools.charged) {
      const summary = evaluatePairAcrossBossScenarios(
        attacker,
        boss,
        fastMove,
        chargedMove,
        scenarios,
        assumption,
        weather,
        raidDurationSeconds,
        replacementDelaySeconds,
        simulationMode,
        typeEffectiveness,
      );
      if (!summary) {
        continue;
      }
      const baseDps = computeBaseCycleDps(
        attacker,
        boss,
        fastMove,
        chargedMove,
        weather,
        typeEffectiveness,
      );
      if (baseDps === null) {
        continue;
      }

      const row: RaidAttackerRow = {
        pokemon: attacker,
        fast_move: fastMove,
        charged_move: chargedMove,
        moveset_label: `${fastMove.name} / ${chargedMove.name}`,
        base_dps: baseDps,
        survival_seconds: summary.survival_seconds,
        damage_per_life: summary.damage_per_life,
        team_damage: summary.team_damage,
        team_dps: summary.team_dps,
        attack_cycle_seconds: summary.attack_cycle_seconds,
        incoming_boss_dps: summary.incoming_boss_dps,
      };
      rows.push(row);
    }
  }

  return rows.sort(compareRows);
}

export function computeRaidAttackers(
  attackers: PokemonEntry[],
  boss: PokemonEntry,
  assumption: RaidBossAssumption,
  specificMoveset: RaidMovesetSelection | null,
  weather: WeatherName,
  raidDurationSeconds: number,
  replacementDelaySeconds: number,
  sortMode: RaidSortMode,
  maxMovesetsPerPokemon: number,
  simulationMode: RaidSimulationMode,
  typeEffectiveness: MergedData["type_effectiveness"],
): RaidAttackerRow[] {
  const scenarios = buildBossScenarios(boss, assumption === "Specific moveset" ? specificMoveset : null);
  if (!scenarios.length) {
    return [];
  }

  const cap = Math.max(1, Math.floor(maxMovesetsPerPokemon));

  return attackers
    .flatMap((attacker) =>
      buildRowsForAttacker(
        attacker,
        boss,
        scenarios,
        assumption,
        weather,
        raidDurationSeconds,
        replacementDelaySeconds,
        simulationMode,
        typeEffectiveness,
      ).slice(0, cap),
    )
    .filter((entry): entry is RaidAttackerRow => Boolean(entry))
    .sort((a, b) =>
      sortMode === "base_dps"
        ? b.base_dps - a.base_dps || b.team_dps - a.team_dps
        : b.team_dps - a.team_dps || b.base_dps - a.base_dps,
    );
}
