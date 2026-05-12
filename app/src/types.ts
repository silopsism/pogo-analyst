export type MoveEntry = {
  name: string;
  type?: string | null;
  power?: number | null;
  duration?: number | null;
  turn_duration?: number | null;
  energy_delta?: number | null;
  move_kind?: string | null;
  raid_dps?: number | null;
  raw_dps?: number | null;
  stab_multiplier?: number | null;
  stab_dps?: number | null;
};

export type PokemonEntry = {
  pokemon_id: number;
  dex: number;
  name: string;
  form: string;
  released: boolean;
  types: string[];
  evolution: {
    family_root: string | null;
    evolution_stage: number | null;
    final_evolution_names: string[];
    is_final_evolution: boolean;
    line_names: string[];
  };
  base_stats: {
    attack: number | null;
    defense: number | null;
    stamina: number | null;
  };
  moves: {
    fast: MoveEntry[];
    charged: MoveEntry[];
    elite_fast: MoveEntry[];
    elite_charged: MoveEntry[];
  };
  artwork: {
    official_artwork?: string | null;
    home?: string | null;
    sprite?: string | null;
  };
  derived: {
    has_dual_type: boolean;
    cosmetic_diff: boolean;
    raid_move_candidates: Array<Record<string, unknown>>;
  };
};

export type MergedData = {
  pokemon: PokemonEntry[];
  fast_moves: Record<string, MoveEntry>;
  charged_moves: Record<string, MoveEntry>;
  pvp_fast_moves: Record<string, MoveEntry>;
  pvp_charged_moves: Record<string, MoveEntry>;
  type_effectiveness: Record<string, Record<string, number>>;
};

export type GreatLeagueCombinedRow = {
  canonical_id: string;
  local_lookup_species_id: string;
  local_lookup_found: boolean;
  name: string;
  pvpoke: {
    rank: number;
    score: number;
    rating: number | null;
    species_id: string;
    species_name: string;
    moveset: string[];
    moves: {
      fast: Array<{
        move_id: string;
        uses: number;
      }>;
      charged: Array<{
        move_id: string;
        uses: number;
      }>;
    };
    traits: string[];
    weaknesses: string[];
    resistances: string[];
    requires_elite_for_recommended_moveset: boolean;
    recommended_move_elite_flags: boolean[];
    recommended_move_statuses: Array<"standard" | "elite" | "missing_on_species" | "missing_globally">;
    has_unresolved_recommended_moveset: boolean;
    recommended_move_unresolved_flags: boolean[];
    scores: {
      overall: number | null;
      leads: number | null;
      closers: number | null;
      switches: number | null;
      chargers: number | null;
      attackers: number | null;
      consistency: number | null;
      attack: number | null;
      defense: number | null;
      stamina: number | null;
    };
  };
};

export type GreatLeagueCombinedData = {
  meta: {
    generated_at_utc: string;
    league: string;
    source: string;
    counts: {
      pvpoke_total: number;
      requires_elite_total?: number;
      unresolved_recommended_moveset_total?: number;
    };
  };
  pvpoke_rankings: GreatLeagueCombinedRow[];
};

export type CurrentRaidBossEntry = {
  boosted_weather?: string[];
  form: string;
  id: number;
  name: string;
  tier: number;
  type?: string[];
};

export type CurrentRaidBossesData = {
  current: Record<string, CurrentRaidBossEntry[]>;
  previous?: unknown;
};
