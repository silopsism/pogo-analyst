import type { MergedData, MoveEntry, PokemonEntry } from "../types.ts";
import type { WeatherName } from "../scoring.ts";
import {
  CHARGED_MOVE_DAMAGE_FRACTION,
  calculateMoveDamage,
  moveDurationSeconds,
  moveEnergyCost,
  moveEnergyGain,
} from "./moveDamage.ts";

export type RaidLifeEventResult = {
  survival_seconds: number;
  damage_dealt: number;
  damage_taken: number;
  attack_cycle_seconds: number;
  fainted: boolean;
};

export type RaidWindowEventResult = {
  team_damage: number;
  team_dps: number;
  copies_used: number;
  raid_time_seconds: number;
};

type MoveState = {
  move: MoveEntry;
  damageAt: number;
  completesAt: number;
  damage: number;
  energyDelta: number;
  isCharged: boolean;
  damageApplied: boolean;
};

type SideState = {
  energy: number;
  nextMove: MoveState | null;
  nextCompleteAt: number;
  chargedReady: boolean;
};

type SimSide = "boss" | "attacker";

function getAttack(value: number | null | undefined): number {
  return Math.max(1, value ?? 1);
}

function getDefense(value: number | null | undefined): number {
  return Math.max(1, value ?? 1);
}

function effectiveHp(pokemon: PokemonEntry): number {
  return getDefense(pokemon.base_stats.stamina);
}

function pickMove(
  side: SimSide,
  energy: number,
  chargedReady: boolean,
  fastMove: MoveEntry,
  chargedMove: MoveEntry,
  fastDamage: number,
  chargedDamage: number,
  currentTime: number,
): MoveState {
  const chargedCost = moveEnergyCost(chargedMove);
  const useCharged = chargedReady && energy >= chargedCost && chargedCost > 0 && (chargedMove.duration ?? 0) > 0;
  const move = useCharged ? chargedMove : fastMove;
  const isCharged = useCharged;
  const damage = useCharged ? chargedDamage : fastDamage;
  const energyDelta = useCharged ? -chargedCost : moveEnergyGain(fastMove);
  const durationSeconds = moveDurationSeconds(move);
  const damageAt = useCharged
    ? currentTime + durationSeconds * CHARGED_MOVE_DAMAGE_FRACTION
    : currentTime + durationSeconds;
  return {
    move,
    damageAt,
    completesAt: currentTime + durationSeconds,
    damage,
    energyDelta,
    isCharged,
    damageApplied: false,
  };
}

function nextPendingEvent(side: SimSide, state: SideState): { kind: "damage" | "complete"; time: number } | null {
  if (!state.nextMove) {
    return null;
  }

  const damageAt = state.nextMove.damageApplied ? Number.POSITIVE_INFINITY : state.nextMove.damageAt;
  const completeAt = state.nextCompleteAt;

  if (!Number.isFinite(damageAt) && !Number.isFinite(completeAt)) {
    return null;
  }

  if (damageAt <= completeAt) {
    return { kind: "damage", time: damageAt };
  }

  return { kind: "complete", time: completeAt };
}

function applyIncomingDamageEnergy(attackerState: SideState, attackerChargedMove: MoveEntry, damage: number): void {
  const chargedCost = moveEnergyCost(attackerChargedMove);
  if (damage <= 0 || chargedCost <= 0) {
    return;
  }

  attackerState.energy = Math.min(100, Math.max(0, attackerState.energy + Math.floor(damage / 2)));
  attackerState.chargedReady = attackerState.energy >= chargedCost;
}

export type RaidLifeEventOptions = {
  attacker: PokemonEntry;
  boss: PokemonEntry;
  attackerFastMove: MoveEntry;
  attackerChargedMove: MoveEntry;
  bossFastMove: MoveEntry;
  bossChargedMove: MoveEntry;
  weather: WeatherName;
  typeEffectiveness: MergedData["type_effectiveness"];
  timeLimitSeconds?: number;
  tieBreak?: "boss-first" | "attacker-first";
};

export function simulateDeterministicRaidLife({
  attacker,
  boss,
  attackerFastMove,
  attackerChargedMove,
  bossFastMove,
  bossChargedMove,
  weather,
  typeEffectiveness,
  timeLimitSeconds = Number.POSITIVE_INFINITY,
  tieBreak = "boss-first",
}: RaidLifeEventOptions): RaidLifeEventResult | null {
  const attackerAttack = getAttack(attacker.base_stats.attack);
  const bossAttack = getAttack(boss.base_stats.attack);
  const attackerDefense = getDefense(attacker.base_stats.defense);
  const bossDefense = getDefense(boss.base_stats.defense);
  const attackerHpMax = effectiveHp(attacker);

  const attackerFastDamage = calculateMoveDamage(
    attackerFastMove,
    attackerAttack,
    bossDefense,
    attacker.types,
    boss.types,
    weather,
    typeEffectiveness,
  );
  const attackerChargedDamage = calculateMoveDamage(
    attackerChargedMove,
    attackerAttack,
    bossDefense,
    attacker.types,
    boss.types,
    weather,
    typeEffectiveness,
  );
  const bossFastDamage = calculateMoveDamage(
    bossFastMove,
    bossAttack,
    attackerDefense,
    boss.types,
    attacker.types,
    weather,
    typeEffectiveness,
  );
  const bossChargedDamage = calculateMoveDamage(
    bossChargedMove,
    bossAttack,
    attackerDefense,
    boss.types,
    attacker.types,
    weather,
    typeEffectiveness,
  );

  if (
    attackerFastDamage === null ||
    attackerChargedDamage === null ||
    bossFastDamage === null ||
    bossChargedDamage === null
  ) {
    return null;
  }

  const attackerFastGain = moveEnergyGain(attackerFastMove);
  const attackerChargedCost = moveEnergyCost(attackerChargedMove);
  const bossFastGain = moveEnergyGain(bossFastMove);
  const bossChargedCost = moveEnergyCost(bossChargedMove);

  if (
    attackerFastGain <= 0 ||
    attackerChargedCost <= 0 ||
    bossFastGain <= 0 ||
    bossChargedCost <= 0 ||
    moveDurationSeconds(attackerFastMove) <= 0 ||
    moveDurationSeconds(attackerChargedMove) <= 0 ||
    moveDurationSeconds(bossFastMove) <= 0 ||
    moveDurationSeconds(bossChargedMove) <= 0
  ) {
    return null;
  }

  let time = 0;
  let attackerHp = attackerHpMax;
  let attackerDamage = 0;
  let bossDamageTaken = 0;
  let attackerEnergy = 0;
  let bossEnergy = 0;

  const attackerState: SideState = {
    energy: 0,
    nextMove: null,
    nextCompleteAt: 0,
    chargedReady: false,
  };
  const bossState: SideState = {
    energy: 0,
    nextMove: null,
    nextCompleteAt: 0,
    chargedReady: false,
  };
  let bossChargedDelayRemaining = 0;

  attackerState.nextMove = pickMove(
    "attacker",
    attackerState.energy,
    attackerState.chargedReady,
    attackerFastMove,
    attackerChargedMove,
    attackerFastDamage,
    attackerChargedDamage,
    time,
  );
  bossState.nextMove = pickMove(
    "boss",
    bossState.energy,
    bossState.chargedReady,
    bossFastMove,
    bossChargedMove,
    bossFastDamage,
    bossChargedDamage,
    time,
  );
  attackerState.nextCompleteAt = attackerState.nextMove.completesAt;
  bossState.nextCompleteAt = bossState.nextMove.completesAt;

  while (time < timeLimitSeconds && attackerHp > 0) {
    const attackerEvent = nextPendingEvent("attacker", attackerState);
    const bossEvent = nextPendingEvent("boss", bossState);
    const nextEventTime = Math.min(attackerEvent?.time ?? Number.POSITIVE_INFINITY, bossEvent?.time ?? Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextEventTime) || nextEventTime > timeLimitSeconds) {
      time = Math.min(timeLimitSeconds, nextEventTime);
      break;
    }

    time = nextEventTime;

    const resolveDamageEvent = (side: SimSide): boolean => {
      const state = side === "attacker" ? attackerState : bossState;
      if (!state.nextMove || state.nextMove.damageApplied || state.nextMove.damageAt !== time) {
        return false;
      }

      state.nextMove.damageApplied = true;
      if (side === "attacker") {
        attackerDamage += state.nextMove.damage;
        return false;
      }

      attackerHp -= state.nextMove.damage;
      bossDamageTaken += state.nextMove.damage;
      applyIncomingDamageEnergy(attackerState, attackerChargedMove, state.nextMove.damage);
      if (attackerHp <= 0) {
        return true;
      }
      return false;
    };

    const resolveCompleteEvent = (side: SimSide): void => {
      const state = side === "attacker" ? attackerState : bossState;
      if (!state.nextMove || state.nextCompleteAt !== time) {
        return;
      }

      state.energy = Math.min(100, Math.max(0, state.energy + state.nextMove.energyDelta));
      if (side === "attacker") {
        attackerEnergy = state.energy;
        state.chargedReady =
          state.energy >= moveEnergyCost(attackerChargedMove) && moveEnergyCost(attackerChargedMove) > 0;
        state.nextMove = pickMove(
          "attacker",
          state.energy,
          state.chargedReady,
          attackerFastMove,
          attackerChargedMove,
          attackerFastDamage,
          attackerChargedDamage,
          time,
        );
        state.nextCompleteAt = state.nextMove.completesAt;
        return;
      }

      bossEnergy = state.energy;
      const bossChargedCost = moveEnergyCost(bossChargedMove);
      const bossHasChargedEnergy = bossChargedCost > 0 && state.energy >= bossChargedCost;
      if (bossHasChargedEnergy) {
        if (bossChargedDelayRemaining > 0) {
          state.chargedReady = true;
          bossChargedDelayRemaining = 0;
        } else {
          state.chargedReady = false;
          bossChargedDelayRemaining = 1;
        }
      } else {
        state.chargedReady = false;
        bossChargedDelayRemaining = 0;
      }
      state.nextMove = pickMove(
        "boss",
        state.energy,
        state.chargedReady,
        bossFastMove,
        bossChargedMove,
        bossFastDamage,
        bossChargedDamage,
        time,
      );
      state.nextCompleteAt = state.nextMove.completesAt;
    };

    const processSide = (side: SimSide): boolean => {
      while (true) {
        const state = side === "attacker" ? attackerState : bossState;
        if (!state.nextMove) {
          return false;
        }
        if (state.nextMove.damageAt === time && !state.nextMove.damageApplied) {
          const fainted = resolveDamageEvent(side);
          if (fainted) {
            return true;
          }
          continue;
        }
        if (state.nextCompleteAt === time) {
          resolveCompleteEvent(side);
          continue;
        }
        return false;
      }
    };

    const firstSide = tieBreak === "attacker-first" ? "attacker" : "boss";
    const secondSide = firstSide === "attacker" ? "boss" : "attacker";
    if (processSide(firstSide)) {
      break;
    }
    if (attackerHp > 0 && processSide(secondSide)) {
      break;
    }
  }

  const survivalSeconds = Math.min(timeLimitSeconds, time);
  return {
    survival_seconds: Number(survivalSeconds.toFixed(3)),
    damage_dealt: Number(attackerDamage.toFixed(3)),
    damage_taken: Number(bossDamageTaken.toFixed(3)),
    attack_cycle_seconds: Number(survivalSeconds.toFixed(3)),
    fainted: attackerHp <= 0,
  };
}

export type RaidWindowEventOptions = {
  raidDurationSeconds: number;
  replacementDelaySeconds: number;
  maxCopies?: number;
  attacker: PokemonEntry;
  boss: PokemonEntry;
  attackerFastMove: MoveEntry;
  attackerChargedMove: MoveEntry;
  bossFastMove: MoveEntry;
  bossChargedMove: MoveEntry;
  weather: WeatherName;
  typeEffectiveness: MergedData["type_effectiveness"];
};

export function simulateRaidWindowEventBased({
  raidDurationSeconds,
  replacementDelaySeconds,
  maxCopies = 6,
  attacker,
  boss,
  attackerFastMove,
  attackerChargedMove,
  bossFastMove,
  bossChargedMove,
  weather,
  typeEffectiveness,
}: RaidWindowEventOptions): RaidWindowEventResult {
  const duration = Math.max(0, raidDurationSeconds);
  const delay = Math.max(0, replacementDelaySeconds);
  const cap = Math.max(1, Math.floor(maxCopies));

  let time = 0;
  let copiesUsed = 0;
  let totalDamage = 0;

  while (time < duration && copiesUsed < cap) {
    const remainingRaidTime = duration - time;
    const life = simulateDeterministicRaidLife({
      attacker,
      boss,
      attackerFastMove,
      attackerChargedMove,
      bossFastMove,
      bossChargedMove,
      weather,
      typeEffectiveness,
      timeLimitSeconds: remainingRaidTime,
    });

    if (!life) {
      break;
    }

    totalDamage += life.damage_dealt;
    time += life.survival_seconds;
    copiesUsed += 1;

    if (!life.fainted || copiesUsed >= cap || time >= duration) {
      break;
    }

    time = Math.min(duration, time + delay);
  }

  return {
    team_damage: Number(totalDamage.toFixed(3)),
    team_dps: duration > 0 ? Number((totalDamage / duration).toFixed(3)) : 0,
    copies_used: copiesUsed,
    raid_time_seconds: Number(time.toFixed(3)),
  };
}
