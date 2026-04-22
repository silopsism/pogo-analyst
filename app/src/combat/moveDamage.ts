import type { MergedData, MoveEntry } from "../types.ts";
import { weatherMultiplier, type WeatherName } from "../scoring.ts";

export const CHARGED_MOVE_DAMAGE_FRACTION = 0.7;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function moveEnergyGain(move: MoveEntry): number {
  return Math.max(0, move.energy_delta ?? 0);
}

export function moveEnergyCost(move: MoveEntry): number {
  return Math.max(0, Math.abs(move.energy_delta ?? 0));
}

export function moveDurationSeconds(move: MoveEntry): number {
  return Math.max(0, (move.duration ?? 0) / 1000);
}

export function calculateMoveDamage(
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
  const typeMultiplier = (move.type ? defenderTypes.reduce((multiplier, defenderType) => {
    return multiplier * (typeEffectiveness[move.type ?? ""]?.[defenderType.trim()] ?? 1);
  }, 1) : 1);
  const weatherBoost = weatherMultiplier(weather, move.type);
  const raw = 0.5 * power * (attackerAttack / defenderDefense) * stab * typeMultiplier * weatherBoost;
  return Math.max(1, Math.floor(raw) + 1);
}
