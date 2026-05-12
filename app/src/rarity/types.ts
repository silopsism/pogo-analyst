export type RarityTier =
  | "common"
  | "uncommon"
  | "rare"
  | "super_rare"
  | "ultra_rare"
  | "event_only"
  | "not_wild"
  | "unknown";

export type WildAvailability =
  | "wild"
  | "regional"
  | "event"
  | "research"
  | "egg"
  | "raid"
  | "not_wild"
  | "unknown";

export type GeoAvailability = "global" | "regional" | "unknown";

export type RarityConfidence = "low" | "medium" | "high";

export type SpawnRarity = {
  pokemonId: number;
  pokemonName: string;
  form?: string;
  wildAvailability: WildAvailability;
  geoAvailability: GeoAvailability;
  rarityTier: RarityTier;
  confidence: RarityConfidence;
  notes?: string;
  sources: string[];
  lastReviewed: string;
};

export type PokemonSpecies = {
  pokemonId: number;
  name: string;
  types: string[];
  generation: number;
  familyId?: number;
  forms?: string[];
  isLegendary?: boolean;
  isMythical?: boolean;
  isUltraBeast?: boolean;
  isRegional?: boolean;
  isBaby?: boolean;
};

export type SpawnRarityOverride = Partial<Omit<SpawnRarity, "pokemonId" | "pokemonName">> & {
  pokemonId: number;
  form?: string;
};

export type SpawnRarityInput = {
  pokemonId: number;
  pokemonName: string;
  form?: string;
  released: boolean;
  evolutionStage?: number | null;
  isCosmeticForm?: boolean;
  sourceHints?: {
    foundWild?: boolean | null;
    foundRaid?: boolean | null;
    foundEgg?: boolean | null;
    foundResearch?: boolean | null;
    captureRate?: number | null;
    rarityLabel?: string | null;
  };
};
