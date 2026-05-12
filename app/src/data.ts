import type { CurrentRaidBossesData, GreatLeagueCombinedData, MergedData, MoveEntry, PokemonEntry } from "./types.ts";
import type { PokemonSpecies, SpawnRarity } from "./rarity/types.ts";

const DATA_URL = "/data/processed/merged_pogo_data.json";
const GREAT_LEAGUE_META_URL = "/data/processed/pvpoke_great_league_rankings.json";
const SPAWN_RARITY_URL = "/data/spawn_rarity.json";
const POKEMON_SPECIES_URL = "/data/pokemon_species.json";
const LEEKDUCK_RAID_BOSSES_URL = "https://leekduck.com/raid-bosses/";
const POGOAPI_RAID_BOSSES_URL = "https://pogoapi.net/api/v1/raid_bosses.json";
const LOCAL_RAID_BOSSES_URL = "/data/raw/pogoapi/raid_bosses.json";

export async function refreshGreatLeagueMetaData(): Promise<void> {
  const response = await fetch("/__refresh/pvp-meta", {
    method: "POST",
    cache: "no-store",
  });
  if (!response.ok) {
    let message = `Failed to refresh Great League meta data: ${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // Keep fallback status message.
    }
    throw new Error(message);
  }
}

export async function loadMergedData(): Promise<MergedData> {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load merged data: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as MergedData;
}

export async function loadGreatLeagueMetaData(): Promise<GreatLeagueCombinedData | null> {
  const response = await fetch(GREAT_LEAGUE_META_URL, { cache: "no-store" });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load Great League meta data: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as GreatLeagueCombinedData;
}

export async function loadSpawnRarityData(): Promise<SpawnRarity[]> {
  const response = await fetch(SPAWN_RARITY_URL, { cache: "no-store" });
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Failed to load spawn rarity data: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as SpawnRarity[];
}

export async function loadPokemonSpeciesData(): Promise<PokemonSpecies[]> {
  const response = await fetch(POKEMON_SPECIES_URL, { cache: "no-store" });
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Failed to load pokemon species data: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as PokemonSpecies[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseLeekDuckBossName(
  displayName: string,
  isShadowSection: boolean,
  isMegaTier: boolean,
): { name: string; form: string } {
  const cleaned = normalizeWhitespace(displayName);
  if (!cleaned) {
    return { name: "", form: "Normal" };
  }
  if (isShadowSection) {
    return { name: cleaned, form: "Shadow" };
  }
  if (isMegaTier || /^mega\s+/i.test(cleaned)) {
    const base = cleaned.replace(/^mega\s+/i, "").trim();
    return { name: base || cleaned, form: "Mega" };
  }
  const regionalPrefixes: Array<{ prefix: RegExp; form: string }> = [
    { prefix: /^alolan\s+/i, form: "Alolan" },
    { prefix: /^galarian\s+/i, form: "Galarian" },
    { prefix: /^hisuian\s+/i, form: "Hisuian" },
    { prefix: /^paldean\s+/i, form: "Paldean" },
  ];
  for (const { prefix, form } of regionalPrefixes) {
    if (prefix.test(cleaned)) {
      return { name: cleaned.replace(prefix, "").trim(), form };
    }
  }
  return { name: cleaned, form: "Normal" };
}

function parseLeekDuckCurrentRaidBosses(html: string): CurrentRaidBossesData | null {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const current: Record<string, Array<{
    boosted_weather?: string[];
    form: string;
    id: number;
    name: string;
    tier: number;
    type?: string[];
  }>> = {};

  const pushEntry = (tierKey: string, entry: {
    boosted_weather?: string[];
    form: string;
    id: number;
    name: string;
    tier: number;
    type?: string[];
  }) => {
    if (!current[tierKey]) {
      current[tierKey] = [];
    }
    current[tierKey].push(entry);
  };

  const extractFromContainer = (selector: string, isShadowSection: boolean) => {
    const container = document.querySelector(selector);
    if (!container) {
      return;
    }
    const tiers = Array.from(container.querySelectorAll(".tier"));
    tiers.forEach((tierBlock) => {
      const header = tierBlock.querySelector("h2.header");
      const tierAttr = normalizeWhitespace(header?.getAttribute("data-tier") ?? "");
      const label = normalizeWhitespace(header?.querySelector(".tier-label")?.textContent ?? "").toLowerCase();
      const isMegaTier = label.includes("mega");
      const numericTier = Number.parseInt(tierAttr, 10);
      const tierValue = Number.isFinite(numericTier) ? numericTier : isMegaTier ? 4 : 1;
      const tierKey = isShadowSection ? `shadow_${tierAttr || "1"}` : isMegaTier ? "mega" : tierAttr || "1";
      const cards = Array.from(tierBlock.querySelectorAll(".card"));
      cards.forEach((card) => {
        const nameText = normalizeWhitespace(card.querySelector(".identity .name")?.textContent ?? "");
        if (!nameText) {
          return;
        }
        const parsed = parseLeekDuckBossName(nameText, isShadowSection, isMegaTier);
        if (!parsed.name) {
          return;
        }
        const types = Array.from(card.querySelectorAll(".boss-type .type-label"))
          .map((node) => normalizeWhitespace(node.textContent ?? ""))
          .filter(Boolean);
        pushEntry(tierKey, {
          name: parsed.name,
          form: parsed.form,
          id: 0,
          tier: tierValue,
          type: types.length ? types : undefined,
        });
      });
    });
  };

  extractFromContainer("[data-raid-type='regular']", false);
  extractFromContainer("[data-raid-type='shadow']", true);

  const count = Object.values(current).reduce((total, rows) => total + rows.length, 0);
  if (count === 0) {
    return null;
  }
  return { current };
}

export async function loadCurrentRaidBossesData(): Promise<CurrentRaidBossesData | null> {
  let liveCurrent: CurrentRaidBossesData | null = null;
  try {
    const response = await fetch(LEEKDUCK_RAID_BOSSES_URL, { cache: "no-store" });
    if (response.ok) {
      const html = await response.text();
      const parsed = parseLeekDuckCurrentRaidBosses(html);
      if (parsed) {
        liveCurrent = parsed;
      }
    }
  } catch {
    // fall through to PoGoAPI/local fallback
  }

  const sources = [POGOAPI_RAID_BOSSES_URL, LOCAL_RAID_BOSSES_URL];
  let pogoPayload: CurrentRaidBossesData | null = null;
  for (const source of sources) {
    try {
      const response = await fetch(source, { cache: "no-store" });
      if (!response.ok) {
        continue;
      }
      const payload = (await response.json()) as CurrentRaidBossesData;
      if (payload && typeof payload === "object" && payload.current && typeof payload.current === "object") {
        pogoPayload = payload;
        break;
      }
    } catch {
      continue;
    }
  }

  if (liveCurrent && pogoPayload) {
    return {
      current: liveCurrent.current,
      previous: pogoPayload.previous,
    };
  }
  return liveCurrent ?? pogoPayload ?? null;
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
