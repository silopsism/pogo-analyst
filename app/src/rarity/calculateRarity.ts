import type {
  GeoAvailability,
  PokemonSpecies,
  RarityConfidence,
  RarityTier,
  SpawnRarity,
  SpawnRarityInput,
  SpawnRarityOverride,
  WildAvailability,
} from "./types.ts";

const KNOWN_TIERS: Set<RarityTier> = new Set([
  "common",
  "uncommon",
  "rare",
  "super_rare",
  "ultra_rare",
  "event_only",
  "not_wild",
  "unknown",
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function defaultTierFromHints(input: SpawnRarityInput): RarityTier {
  const label = normalizeText(input.sourceHints?.rarityLabel ?? null);
  if (label.includes("ultra")) {
    return "ultra_rare";
  }
  if (label.includes("super") || label.includes("very")) {
    return "super_rare";
  }
  if (label.includes("rare")) {
    return "rare";
  }
  if (label.includes("uncommon")) {
    return "uncommon";
  }
  if (label.includes("common") || label.includes("standard")) {
    return "common";
  }

  const captureRate = input.sourceHints?.captureRate;
  if (captureRate !== null && captureRate !== undefined && Number.isFinite(captureRate)) {
    if (captureRate >= 0.35) {
      return "common";
    }
    if (captureRate >= 0.2) {
      return "uncommon";
    }
    if (captureRate >= 0.1) {
      return "rare";
    }
    if (captureRate > 0) {
      return "super_rare";
    }
  }

  if (input.evolutionStage === null || input.evolutionStage === undefined) {
    return "unknown";
  }
  if (input.evolutionStage <= 1) {
    return "common";
  }
  if (input.evolutionStage === 2) {
    return "uncommon";
  }
  return "rare";
}

function resolveDefault(
  species: PokemonSpecies,
  input: SpawnRarityInput,
): {
  wildAvailability: WildAvailability;
  geoAvailability: GeoAvailability;
  rarityTier: RarityTier;
  confidence: RarityConfidence;
  notes: string[];
} {
  const notes = ["Estimated baseline rarity; not an official Niantic spawn rate."];

  if (!input.released) {
    return {
      wildAvailability: "unknown",
      geoAvailability: "unknown",
      rarityTier: "unknown",
      confidence: "low",
      notes: [...notes, "Pokemon/form not marked released in local source data."],
    };
  }

  if (species.isLegendary || species.isMythical || species.isUltraBeast || species.isBaby) {
    return {
      wildAvailability: "not_wild",
      geoAvailability: "global",
      rarityTier: "not_wild",
      confidence: "high",
      notes: [...notes, "Classified as not wild from species category (legendary/mythical/ultra beast/baby)."],
    };
  }

  if (species.isRegional) {
    return {
      wildAvailability: "regional",
      geoAvailability: "regional",
      rarityTier: "rare",
      confidence: "medium",
      notes: [...notes, "Regional baseline: rarity applies only where this spawn pool is available."],
    };
  }

  if (input.sourceHints?.foundWild === false) {
    const channelFallback = Boolean(
      input.sourceHints?.foundRaid || input.sourceHints?.foundEgg || input.sourceHints?.foundResearch,
    );
    if (channelFallback) {
      return {
        wildAvailability: "not_wild",
        geoAvailability: "global",
        rarityTier: "not_wild",
        confidence: "medium",
        notes: [...notes, "Marked non-wild in source hints while available in other channels."],
      };
    }
    return {
      wildAvailability: "unknown",
      geoAvailability: "unknown",
      rarityTier: "unknown",
      confidence: "low",
      notes,
    };
  }

  const rarityTier = defaultTierFromHints(input);
  const confidence: RarityConfidence =
    rarityTier === "common" || rarityTier === "uncommon" || rarityTier === "rare"
      ? "medium"
      : rarityTier === "super_rare" || rarityTier === "ultra_rare"
        ? "low"
        : "low";

  const extraNotes = normalizeText(input.form) !== "normal"
    ? ["Form-level entry may diverge from base species due to GO form behavior."]
    : [];

  return {
    wildAvailability: "wild",
    geoAvailability: "global",
    rarityTier,
    confidence,
    notes: [...notes, ...extraNotes],
  };
}

function normalizeTier(value: string | null | undefined, fallback: RarityTier): RarityTier {
  const normalized = normalizeText(value).replace(/\s+/g, "_") as RarityTier;
  return KNOWN_TIERS.has(normalized) ? normalized : fallback;
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

export function calculateRarity(
  species: PokemonSpecies,
  input: SpawnRarityInput,
  override?: SpawnRarityOverride | null,
  reviewedDate?: string,
): SpawnRarity {
  const base = resolveDefault(species, input);
  const notes = [...base.notes];
  const sources = ["pogoapi/released_pokemon", "pokeapi/species"];

  const wildAvailability = (override?.wildAvailability ?? base.wildAvailability) as WildAvailability;
  const geoAvailability = (override?.geoAvailability ?? base.geoAvailability) as GeoAvailability;
  const rarityTier = normalizeTier(override?.rarityTier, base.rarityTier);
  const confidence = (override?.confidence ?? base.confidence) as RarityConfidence;

  if (input.sourceHints) {
    sources.push("local/pokemon.csv");
  }
  if (override) {
    if (override.notes) {
      notes.push(`Manual override: ${override.notes}`);
    }
    if (override.sources) {
      sources.push(...override.sources);
    }
    sources.push("manual_rarity_overrides");
  }

  return {
    pokemonId: input.pokemonId,
    pokemonName: input.pokemonName,
    form: input.form,
    wildAvailability,
    geoAvailability,
    rarityTier,
    confidence,
    notes: notes.join(" ").trim(),
    sources: dedupe(sources),
    lastReviewed: reviewedDate ?? new Date().toISOString().slice(0, 10),
  };
}
