import type { PokemonEntry } from "./types.ts";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function preferredByName(name: string, pokemon: PokemonEntry[]): PokemonEntry | null {
  const matches = pokemon.filter((entry) => normalize(entry.name) === normalize(name));
  if (!matches.length) {
    return null;
  }

  const normalForm = matches.find((entry) => normalize(entry.form) === "normal");
  return normalForm ?? matches[0];
}

export function lookupPokemon(query: string, pokemon: PokemonEntry[]): PokemonEntry | null {
  const trimmed = query.trim();
  if (!trimmed) {
    return pokemon[0] ?? null;
  }

  const exact = pokemon.find((entry) => normalize(entry.name) === normalize(trimmed));
  if (exact) {
    return exact;
  }

  return (
    pokemon.find(
      (entry) =>
        normalize(entry.name).includes(normalize(trimmed)) || normalize(entry.form).includes(normalize(trimmed)),
    ) ?? null
  );
}

export function evolutionFamilyMembers(pokemon: PokemonEntry, allPokemon: PokemonEntry[]): PokemonEntry[] {
  const names = new Set(pokemon.evolution.line_names.map(normalize));
  return allPokemon
    .filter((entry) => names.has(normalize(entry.name)))
    .sort((a, b) => a.dex - b.dex || a.form.localeCompare(b.form));
}

export function finalEvolutionOptions(pokemon: PokemonEntry, allPokemon: PokemonEntry[]): PokemonEntry[] {
  const finalNames = pokemon.evolution.final_evolution_names.map(normalize);
  return finalNames
    .map((name) => preferredByName(name, allPokemon))
    .filter((entry): entry is PokemonEntry => Boolean(entry));
}

export function resolvePrimaryFinalEvolution(pokemon: PokemonEntry, allPokemon: PokemonEntry[]): PokemonEntry {
  const finals = finalEvolutionOptions(pokemon, allPokemon);
  if (!finals.length) {
    return pokemon;
  }
  return finals[0];
}

export function pokemonKey(pokemon: PokemonEntry): string {
  return `${pokemon.pokemon_id}::${pokemon.form}`;
}
