import type { MergedData, MoveEntry, PokemonEntry } from "./types.ts";

const DATA_URL = "/data/processed/merged_pogo_data.json";

export async function loadMergedData(): Promise<MergedData> {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load merged data: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as MergedData;
}

export function pokemonLabel(pokemon: PokemonEntry): string {
  return `#${pokemon.dex} ${pokemon.name} (${pokemon.form})`;
}

export function pokemonKey(pokemon: PokemonEntry): string {
  return `${pokemon.pokemon_id}::${pokemon.form}`;
}

export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function moveRaidDps(move: MoveEntry): number | null {
  return move.raid_dps ?? move.raw_dps ?? null;
}

export function typeMultiplier(
  attackType: string | null | undefined,
  defenderTypes: string[],
  typeEffectiveness: Record<string, Record<string, number>>,
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

export function moveEffectiveDps(
  move: MoveEntry,
  defenderTypes: string[],
  typeEffectiveness: Record<string, Record<string, number>>,
): number | null {
  const raidDps = moveRaidDps(move);
  if (raidDps === null) {
    return null;
  }
  const stab = move.stab_multiplier ?? 1;
  const multiplier = typeMultiplier(move.type, defenderTypes, typeEffectiveness);
  return Number((raidDps * stab * multiplier).toFixed(3));
}

export function allTypes(pokemon: PokemonEntry[]): string[] {
  return [...new Set(pokemon.flatMap((entry) => entry.types))].sort();
}
