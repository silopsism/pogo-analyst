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
