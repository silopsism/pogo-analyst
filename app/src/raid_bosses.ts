import type { CurrentRaidBossEntry, CurrentRaidBossesData, PokemonEntry } from "./types.ts";
import type { PokemonSpecies } from "./rarity/types.ts";

export type RaidBossSourceFilter = "Current Rotation" | "Mythical & Legendary" | "All other bosses";
export type RaidBossBucket = "5 Star" | "3 Star" | "1 Star" | "Mega";
export type RaidBossBucketFilter = RaidBossBucket | "All";

export type RaidBossCatalogEntry = {
  key: string;
  label: string;
  bucket: RaidBossBucket;
  popular: boolean;
  currentRotation: boolean;
  speciesName: string;
  speciesForm: string;
  proxyBaseSpecies?: string;
  proxyTypes?: string[];
  proxyNote?: string;
};

export type ResolvedRaidBoss = {
  catalog: RaidBossCatalogEntry;
  pokemon: PokemonEntry;
  isProxy: boolean;
  note: string | null;
};

export type RaidBossOptionGroup = {
  label: string;
  options: RaidBossCatalogEntry[];
};

function makeKey(speciesName: string, speciesForm: string): string {
  return `${speciesName}::${speciesForm}`;
}

function bucketFromTierKey(tierKey: string, tierValue: number | null | undefined): RaidBossBucket {
  if (tierKey.startsWith("mega")) {
    return "Mega";
  }
  const tier = tierValue ?? Number.parseInt(tierKey, 10);
  if (Number.isFinite(tier) && tier >= 5) {
    return "5 Star";
  }
  if (Number.isFinite(tier) && tier >= 3) {
    return "3 Star";
  }
  return "1 Star";
}

const T5_PAST_YEAR_KEYS = new Set<string>([
  makeKey("Groudon", "Normal"),
  makeKey("Kyogre", "Normal"),
  makeKey("Dialga", "Normal"),
  makeKey("Palkia", "Normal"),
  makeKey("Reshiram", "Normal"),
  makeKey("Zekrom", "Normal"),
  makeKey("Kyurem", "Normal"),
  makeKey("Kyurem", "Black"),
  makeKey("Kyurem", "White"),
  makeKey("Articuno", "Normal"),
  makeKey("Zapdos", "Normal"),
  makeKey("Moltres", "Normal"),
  makeKey("Cobalion", "Normal"),
  makeKey("Terrakion", "Normal"),
  makeKey("Virizion", "Normal"),
  makeKey("Regieleki", "Normal"),
  makeKey("Regidrago", "Normal"),
  makeKey("Zacian", "Normal"),
  makeKey("Zamazenta", "Normal"),
  makeKey("Lunala", "Normal"),
  makeKey("Solgaleo", "Normal"),
  makeKey("Thundurus", "Normal"),
  makeKey("Genesect", "Normal"),
  makeKey("Genesect", "Burn"),
  makeKey("Genesect", "Chill"),
  makeKey("Genesect", "Douse"),
  makeKey("Genesect", "Shock"),
  makeKey("Blacephalon", "Normal"),
  makeKey("Mega Absol", "Mega"),
  makeKey("Mega Pinsir", "Mega"),
  makeKey("Mega Steelix", "Mega"),
  makeKey("Mega Slowbro", "Mega"),
  makeKey("Mega Houndoom", "Mega"),
  makeKey("Mega Alakazam", "Mega"),
  makeKey("Mega Aerodactyl", "Mega"),
  makeKey("Mega Manectric", "Mega"),
  makeKey("Mega Banette", "Mega"),
  makeKey("Mega Sharpedo", "Mega"),
]);

const ULTRA_BEAST_NAMES = new Set<string>([
  "nihilego",
  "buzzwole",
  "pheromosa",
  "xurkitree",
  "celesteela",
  "kartana",
  "guzzlord",
  "poipole",
  "naganadel",
  "stakataka",
  "blacephalon",
]);

const PROXY_BOSSES: Record<string, { types: string[]; note: string }> = {
  [makeKey("Mega Charizard X", "Mega")]: {
    types: ["Fire", "Dragon"],
    note: "Mega Charizard X uses a proxy profile based on Charizard Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Charizard Y", "Mega")]: {
    types: ["Fire", "Flying"],
    note: "Mega Charizard Y uses a proxy profile based on Charizard Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Gengar", "Mega")]: {
    types: ["Ghost", "Poison"],
    note: "Mega Gengar uses a proxy profile based on Gengar Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Tyranitar", "Mega")]: {
    types: ["Rock", "Dark"],
    note: "Mega Tyranitar uses a proxy profile based on Tyranitar Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Blaziken", "Mega")]: {
    types: ["Fire", "Fighting"],
    note: "Mega Blaziken uses a proxy profile based on Blaziken Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Swampert", "Mega")]: {
    types: ["Water", "Ground"],
    note: "Mega Swampert uses a proxy profile based on Swampert Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Sceptile", "Mega")]: {
    types: ["Grass", "Dragon"],
    note: "Mega Sceptile uses a proxy profile based on Sceptile Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Gardevoir", "Mega")]: {
    types: ["Psychic", "Fairy"],
    note: "Mega Gardevoir uses a proxy profile based on Gardevoir Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Alakazam", "Mega")]: {
    types: ["Psychic"],
    note: "Mega Alakazam uses a proxy profile based on Alakazam Normal until mega-form boss data is added locally.",
  },
  [makeKey("Shadow Dratini", "Shadow")]: {
    types: ["Dragon"],
    note: "Shadow Dratini uses a proxy profile based on Dratini Normal until shadow-form boss data is added locally.",
  },
  [makeKey("Shadow Gligar", "Shadow")]: {
    types: ["Ground", "Flying"],
    note: "Shadow Gligar uses a proxy profile based on Gligar Normal until shadow-form boss data is added locally.",
  },
  [makeKey("Shadow Cacnea", "Shadow")]: {
    types: ["Grass"],
    note: "Shadow Cacnea uses a proxy profile based on Cacnea Normal until shadow-form boss data is added locally.",
  },
  [makeKey("Shadow Joltik", "Shadow")]: {
    types: ["Bug", "Electric"],
    note: "Shadow Joltik uses a proxy profile based on Joltik Normal until shadow-form boss data is added locally.",
  },
  [makeKey("Shadow Alolan Marowak", "Shadow")]: {
    types: ["Fire", "Ghost"],
    note: "Shadow Alolan Marowak uses a proxy profile based on Alolan Marowak Normal until shadow-form boss data is added locally.",
  },
  [makeKey("Shadow Lapras", "Shadow")]: {
    types: ["Water", "Ice"],
    note: "Shadow Lapras uses a proxy profile based on Lapras Normal until shadow-form boss data is added locally.",
  },
  [makeKey("Shadow Stantler", "Shadow")]: {
    types: ["Normal"],
    note: "Shadow Stantler uses a proxy profile based on Stantler Normal until shadow-form boss data is added locally.",
  },
  [makeKey("Shadow Latios", "Shadow")]: {
    types: ["Dragon", "Psychic"],
    note: "Shadow Latios uses a proxy profile based on Latios Normal until shadow-form boss data is added locally.",
  },
  [makeKey("Mega Absol", "Mega")]: {
    types: ["Dark"],
    note: "Mega Absol uses a proxy profile based on Absol Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Pinsir", "Mega")]: {
    types: ["Bug", "Flying"],
    note: "Mega Pinsir uses a proxy profile based on Pinsir Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Steelix", "Mega")]: {
    types: ["Steel", "Ground"],
    note: "Mega Steelix uses a proxy profile based on Steelix Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Slowbro", "Mega")]: {
    types: ["Water", "Psychic"],
    note: "Mega Slowbro uses a proxy profile based on Slowbro Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Houndoom", "Mega")]: {
    types: ["Dark", "Fire"],
    note: "Mega Houndoom uses a proxy profile based on Houndoom Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Aerodactyl", "Mega")]: {
    types: ["Rock", "Flying"],
    note: "Mega Aerodactyl uses a proxy profile based on Aerodactyl Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Manectric", "Mega")]: {
    types: ["Electric"],
    note: "Mega Manectric uses a proxy profile based on Manectric Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Banette", "Mega")]: {
    types: ["Ghost"],
    note: "Mega Banette uses a proxy profile based on Banette Normal until mega-form boss data is added locally.",
  },
  [makeKey("Mega Sharpedo", "Mega")]: {
    types: ["Water", "Dark"],
    note: "Mega Sharpedo uses a proxy profile based on Sharpedo Normal until mega-form boss data is added locally.",
  },
  [makeKey("Kyurem", "Black")]: {
    types: ["Dragon", "Ice"],
    note: "Kyurem Black uses a proxy profile based on Kyurem Normal until alternate-form boss data is added locally.",
  },
  [makeKey("Kyurem", "White")]: {
    types: ["Dragon", "Ice"],
    note: "Kyurem White uses a proxy profile based on Kyurem Normal until alternate-form boss data is added locally.",
  },
  [makeKey("Genesect", "Burn")]: {
    types: ["Bug", "Fire"],
    note: "Genesect Burn uses a proxy profile based on Genesect Normal until drive-form boss data is added locally.",
  },
  [makeKey("Genesect", "Chill")]: {
    types: ["Bug", "Ice"],
    note: "Genesect Chill uses a proxy profile based on Genesect Normal until drive-form boss data is added locally.",
  },
  [makeKey("Genesect", "Douse")]: {
    types: ["Bug", "Water"],
    note: "Genesect Douse uses a proxy profile based on Genesect Normal until drive-form boss data is added locally.",
  },
  [makeKey("Genesect", "Shock")]: {
    types: ["Bug", "Electric"],
    note: "Genesect Shock uses a proxy profile based on Genesect Normal until drive-form boss data is added locally.",
  },
};

const RAW_BOSSES: Omit<RaidBossCatalogEntry, "label">[] = [
  { key: makeKey("Mewtwo", "Normal"), bucket: "5 Star", popular: true, currentRotation: true, speciesName: "Mewtwo", speciesForm: "Normal" },
  { key: makeKey("Rayquaza", "Normal"), bucket: "5 Star", popular: true, currentRotation: true, speciesName: "Rayquaza", speciesForm: "Normal" },
  { key: makeKey("Kyogre", "Normal"), bucket: "5 Star", popular: true, currentRotation: true, speciesName: "Kyogre", speciesForm: "Normal" },
  { key: makeKey("Groudon", "Normal"), bucket: "5 Star", popular: true, currentRotation: true, speciesName: "Groudon", speciesForm: "Normal" },
  { key: makeKey("Articuno", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Articuno", speciesForm: "Normal" },
  { key: makeKey("Zapdos", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Zapdos", speciesForm: "Normal" },
  { key: makeKey("Moltres", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Moltres", speciesForm: "Normal" },
  { key: makeKey("Dialga", "Normal"), bucket: "5 Star", popular: false, currentRotation: true, speciesName: "Dialga", speciesForm: "Normal" },
  { key: makeKey("Palkia", "Normal"), bucket: "5 Star", popular: false, currentRotation: true, speciesName: "Palkia", speciesForm: "Normal" },
  { key: makeKey("Giratina", "Altered"), bucket: "5 Star", popular: false, currentRotation: true, speciesName: "Giratina", speciesForm: "Altered" },
  { key: makeKey("Giratina", "Origin"), bucket: "5 Star", popular: false, currentRotation: true, speciesName: "Giratina", speciesForm: "Origin" },
  { key: makeKey("Zekrom", "Normal"), bucket: "5 Star", popular: false, currentRotation: true, speciesName: "Zekrom", speciesForm: "Normal" },
  { key: makeKey("Reshiram", "Normal"), bucket: "5 Star", popular: false, currentRotation: true, speciesName: "Reshiram", speciesForm: "Normal" },
  { key: makeKey("Xerneas", "Normal"), bucket: "5 Star", popular: false, currentRotation: true, speciesName: "Xerneas", speciesForm: "Normal" },
  { key: makeKey("Yveltal", "Normal"), bucket: "5 Star", popular: false, currentRotation: true, speciesName: "Yveltal", speciesForm: "Normal" },
  { key: makeKey("Zacian", "Normal"), bucket: "5 Star", popular: false, currentRotation: true, speciesName: "Zacian", speciesForm: "Normal" },
  { key: makeKey("Zamazenta", "Normal"), bucket: "5 Star", popular: false, currentRotation: true, speciesName: "Zamazenta", speciesForm: "Normal" },
  { key: makeKey("Cobalion", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Cobalion", speciesForm: "Normal" },
  { key: makeKey("Terrakion", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Terrakion", speciesForm: "Normal" },
  { key: makeKey("Virizion", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Virizion", speciesForm: "Normal" },
  { key: makeKey("Regieleki", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Regieleki", speciesForm: "Normal" },
  { key: makeKey("Regidrago", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Regidrago", speciesForm: "Normal" },
  { key: makeKey("Lunala", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Lunala", speciesForm: "Normal" },
  { key: makeKey("Solgaleo", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Solgaleo", speciesForm: "Normal" },
  { key: makeKey("Thundurus", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Thundurus", speciesForm: "Normal" },
  { key: makeKey("Blacephalon", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Blacephalon", speciesForm: "Normal" },
  { key: makeKey("Kyurem", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Kyurem", speciesForm: "Normal" },
  { key: makeKey("Kyurem", "Black"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Kyurem", speciesForm: "Black", proxyBaseSpecies: "Kyurem", proxyTypes: PROXY_BOSSES[makeKey("Kyurem", "Black")].types, proxyNote: PROXY_BOSSES[makeKey("Kyurem", "Black")].note },
  { key: makeKey("Kyurem", "White"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Kyurem", speciesForm: "White", proxyBaseSpecies: "Kyurem", proxyTypes: PROXY_BOSSES[makeKey("Kyurem", "White")].types, proxyNote: PROXY_BOSSES[makeKey("Kyurem", "White")].note },
  { key: makeKey("Genesect", "Normal"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Genesect", speciesForm: "Normal" },
  { key: makeKey("Genesect", "Burn"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Genesect", speciesForm: "Burn", proxyBaseSpecies: "Genesect", proxyTypes: PROXY_BOSSES[makeKey("Genesect", "Burn")].types, proxyNote: PROXY_BOSSES[makeKey("Genesect", "Burn")].note },
  { key: makeKey("Genesect", "Chill"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Genesect", speciesForm: "Chill", proxyBaseSpecies: "Genesect", proxyTypes: PROXY_BOSSES[makeKey("Genesect", "Chill")].types, proxyNote: PROXY_BOSSES[makeKey("Genesect", "Chill")].note },
  { key: makeKey("Genesect", "Douse"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Genesect", speciesForm: "Douse", proxyBaseSpecies: "Genesect", proxyTypes: PROXY_BOSSES[makeKey("Genesect", "Douse")].types, proxyNote: PROXY_BOSSES[makeKey("Genesect", "Douse")].note },
  { key: makeKey("Genesect", "Shock"), bucket: "5 Star", popular: false, currentRotation: false, speciesName: "Genesect", speciesForm: "Shock", proxyBaseSpecies: "Genesect", proxyTypes: PROXY_BOSSES[makeKey("Genesect", "Shock")].types, proxyNote: PROXY_BOSSES[makeKey("Genesect", "Shock")].note },

  { key: makeKey("Mega Charizard X", "Mega"), bucket: "Mega", popular: false, currentRotation: true, speciesName: "Mega Charizard X", speciesForm: "Mega", proxyBaseSpecies: "Charizard", proxyTypes: PROXY_BOSSES[makeKey("Mega Charizard X", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Charizard X", "Mega")].note },
  { key: makeKey("Mega Charizard Y", "Mega"), bucket: "Mega", popular: false, currentRotation: true, speciesName: "Mega Charizard Y", speciesForm: "Mega", proxyBaseSpecies: "Charizard", proxyTypes: PROXY_BOSSES[makeKey("Mega Charizard Y", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Charizard Y", "Mega")].note },
  { key: makeKey("Mega Gengar", "Mega"), bucket: "Mega", popular: false, currentRotation: true, speciesName: "Mega Gengar", speciesForm: "Mega", proxyBaseSpecies: "Gengar", proxyTypes: PROXY_BOSSES[makeKey("Mega Gengar", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Gengar", "Mega")].note },
  { key: makeKey("Mega Tyranitar", "Mega"), bucket: "Mega", popular: false, currentRotation: true, speciesName: "Mega Tyranitar", speciesForm: "Mega", proxyBaseSpecies: "Tyranitar", proxyTypes: PROXY_BOSSES[makeKey("Mega Tyranitar", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Tyranitar", "Mega")].note },
  { key: makeKey("Mega Blaziken", "Mega"), bucket: "Mega", popular: false, currentRotation: true, speciesName: "Mega Blaziken", speciesForm: "Mega", proxyBaseSpecies: "Blaziken", proxyTypes: PROXY_BOSSES[makeKey("Mega Blaziken", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Blaziken", "Mega")].note },
  { key: makeKey("Mega Swampert", "Mega"), bucket: "Mega", popular: false, currentRotation: true, speciesName: "Mega Swampert", speciesForm: "Mega", proxyBaseSpecies: "Swampert", proxyTypes: PROXY_BOSSES[makeKey("Mega Swampert", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Swampert", "Mega")].note },
  { key: makeKey("Mega Sceptile", "Mega"), bucket: "Mega", popular: false, currentRotation: true, speciesName: "Mega Sceptile", speciesForm: "Mega", proxyBaseSpecies: "Sceptile", proxyTypes: PROXY_BOSSES[makeKey("Mega Sceptile", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Sceptile", "Mega")].note },
  { key: makeKey("Mega Gardevoir", "Mega"), bucket: "Mega", popular: false, currentRotation: true, speciesName: "Mega Gardevoir", speciesForm: "Mega", proxyBaseSpecies: "Gardevoir", proxyTypes: PROXY_BOSSES[makeKey("Mega Gardevoir", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Gardevoir", "Mega")].note },
  { key: makeKey("Mega Alakazam", "Mega"), bucket: "Mega", popular: false, currentRotation: true, speciesName: "Mega Alakazam", speciesForm: "Mega", proxyBaseSpecies: "Alakazam", proxyTypes: PROXY_BOSSES[makeKey("Mega Alakazam", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Alakazam", "Mega")].note },
  { key: makeKey("Mega Absol", "Mega"), bucket: "Mega", popular: false, currentRotation: false, speciesName: "Mega Absol", speciesForm: "Mega", proxyBaseSpecies: "Absol", proxyTypes: PROXY_BOSSES[makeKey("Mega Absol", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Absol", "Mega")].note },
  { key: makeKey("Mega Pinsir", "Mega"), bucket: "Mega", popular: false, currentRotation: false, speciesName: "Mega Pinsir", speciesForm: "Mega", proxyBaseSpecies: "Pinsir", proxyTypes: PROXY_BOSSES[makeKey("Mega Pinsir", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Pinsir", "Mega")].note },
  { key: makeKey("Mega Steelix", "Mega"), bucket: "Mega", popular: false, currentRotation: false, speciesName: "Mega Steelix", speciesForm: "Mega", proxyBaseSpecies: "Steelix", proxyTypes: PROXY_BOSSES[makeKey("Mega Steelix", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Steelix", "Mega")].note },
  { key: makeKey("Mega Slowbro", "Mega"), bucket: "Mega", popular: false, currentRotation: false, speciesName: "Mega Slowbro", speciesForm: "Mega", proxyBaseSpecies: "Slowbro", proxyTypes: PROXY_BOSSES[makeKey("Mega Slowbro", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Slowbro", "Mega")].note },
  { key: makeKey("Mega Houndoom", "Mega"), bucket: "Mega", popular: false, currentRotation: false, speciesName: "Mega Houndoom", speciesForm: "Mega", proxyBaseSpecies: "Houndoom", proxyTypes: PROXY_BOSSES[makeKey("Mega Houndoom", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Houndoom", "Mega")].note },
  { key: makeKey("Mega Aerodactyl", "Mega"), bucket: "Mega", popular: false, currentRotation: false, speciesName: "Mega Aerodactyl", speciesForm: "Mega", proxyBaseSpecies: "Aerodactyl", proxyTypes: PROXY_BOSSES[makeKey("Mega Aerodactyl", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Aerodactyl", "Mega")].note },
  { key: makeKey("Mega Manectric", "Mega"), bucket: "Mega", popular: false, currentRotation: false, speciesName: "Mega Manectric", speciesForm: "Mega", proxyBaseSpecies: "Manectric", proxyTypes: PROXY_BOSSES[makeKey("Mega Manectric", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Manectric", "Mega")].note },
  { key: makeKey("Mega Banette", "Mega"), bucket: "Mega", popular: false, currentRotation: false, speciesName: "Mega Banette", speciesForm: "Mega", proxyBaseSpecies: "Banette", proxyTypes: PROXY_BOSSES[makeKey("Mega Banette", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Banette", "Mega")].note },
  { key: makeKey("Mega Sharpedo", "Mega"), bucket: "Mega", popular: false, currentRotation: false, speciesName: "Mega Sharpedo", speciesForm: "Mega", proxyBaseSpecies: "Sharpedo", proxyTypes: PROXY_BOSSES[makeKey("Mega Sharpedo", "Mega")].types, proxyNote: PROXY_BOSSES[makeKey("Mega Sharpedo", "Mega")].note },

  { key: makeKey("Shadow Latios", "Shadow"), bucket: "5 Star", popular: false, currentRotation: true, speciesName: "Shadow Latios", speciesForm: "Shadow", proxyBaseSpecies: "Latios", proxyTypes: PROXY_BOSSES[makeKey("Shadow Latios", "Shadow")].types, proxyNote: PROXY_BOSSES[makeKey("Shadow Latios", "Shadow")].note },

  { key: makeKey("Shadow Alolan Marowak", "Shadow"), bucket: "3 Star", popular: false, currentRotation: true, speciesName: "Shadow Alolan Marowak", speciesForm: "Shadow", proxyBaseSpecies: "Alolan Marowak", proxyTypes: PROXY_BOSSES[makeKey("Shadow Alolan Marowak", "Shadow")].types, proxyNote: PROXY_BOSSES[makeKey("Shadow Alolan Marowak", "Shadow")].note },
  { key: makeKey("Shadow Lapras", "Shadow"), bucket: "3 Star", popular: false, currentRotation: true, speciesName: "Shadow Lapras", speciesForm: "Shadow", proxyBaseSpecies: "Lapras", proxyTypes: PROXY_BOSSES[makeKey("Shadow Lapras", "Shadow")].types, proxyNote: PROXY_BOSSES[makeKey("Shadow Lapras", "Shadow")].note },
  { key: makeKey("Shadow Stantler", "Shadow"), bucket: "3 Star", popular: false, currentRotation: true, speciesName: "Shadow Stantler", speciesForm: "Shadow", proxyBaseSpecies: "Stantler", proxyTypes: PROXY_BOSSES[makeKey("Shadow Stantler", "Shadow")].types, proxyNote: PROXY_BOSSES[makeKey("Shadow Stantler", "Shadow")].note },

  { key: makeKey("Shadow Dratini", "Shadow"), bucket: "1 Star", popular: false, currentRotation: true, speciesName: "Shadow Dratini", speciesForm: "Shadow", proxyBaseSpecies: "Dratini", proxyTypes: PROXY_BOSSES[makeKey("Shadow Dratini", "Shadow")].types, proxyNote: PROXY_BOSSES[makeKey("Shadow Dratini", "Shadow")].note },
  { key: makeKey("Shadow Gligar", "Shadow"), bucket: "1 Star", popular: false, currentRotation: true, speciesName: "Shadow Gligar", speciesForm: "Shadow", proxyBaseSpecies: "Gligar", proxyTypes: PROXY_BOSSES[makeKey("Shadow Gligar", "Shadow")].types, proxyNote: PROXY_BOSSES[makeKey("Shadow Gligar", "Shadow")].note },
  { key: makeKey("Shadow Cacnea", "Shadow"), bucket: "1 Star", popular: false, currentRotation: true, speciesName: "Shadow Cacnea", speciesForm: "Shadow", proxyBaseSpecies: "Cacnea", proxyTypes: PROXY_BOSSES[makeKey("Shadow Cacnea", "Shadow")].types, proxyNote: PROXY_BOSSES[makeKey("Shadow Cacnea", "Shadow")].note },
  { key: makeKey("Shadow Joltik", "Shadow"), bucket: "1 Star", popular: false, currentRotation: true, speciesName: "Shadow Joltik", speciesForm: "Shadow", proxyBaseSpecies: "Joltik", proxyTypes: PROXY_BOSSES[makeKey("Shadow Joltik", "Shadow")].types, proxyNote: PROXY_BOSSES[makeKey("Shadow Joltik", "Shadow")].note },

  { key: makeKey("Foongus", "Normal"), bucket: "1 Star", popular: false, currentRotation: true, speciesName: "Foongus", speciesForm: "Normal" },
  { key: makeKey("Phantump", "Normal"), bucket: "1 Star", popular: false, currentRotation: true, speciesName: "Phantump", speciesForm: "Normal" },
  { key: makeKey("Sandygast", "Normal"), bucket: "1 Star", popular: false, currentRotation: true, speciesName: "Sandygast", speciesForm: "Normal" },
  { key: makeKey("Gossifleur", "Normal"), bucket: "1 Star", popular: false, currentRotation: true, speciesName: "Gossifleur", speciesForm: "Normal" },
  { key: makeKey("Vileplume", "Normal"), bucket: "3 Star", popular: false, currentRotation: true, speciesName: "Vileplume", speciesForm: "Normal" },
  { key: makeKey("Dugtrio", "Normal"), bucket: "3 Star", popular: false, currentRotation: true, speciesName: "Dugtrio", speciesForm: "Normal" },
  { key: makeKey("Torterra", "Normal"), bucket: "3 Star", popular: false, currentRotation: true, speciesName: "Torterra", speciesForm: "Normal" },

  { key: makeKey("Dragonite", "Normal"), bucket: "3 Star", popular: true, currentRotation: true, speciesName: "Dragonite", speciesForm: "Normal" },
  { key: makeKey("Tyranitar", "Normal"), bucket: "3 Star", popular: true, currentRotation: false, speciesName: "Tyranitar", speciesForm: "Normal" },
  { key: makeKey("Machamp", "Normal"), bucket: "3 Star", popular: true, currentRotation: true, speciesName: "Machamp", speciesForm: "Normal" },
  { key: makeKey("Metagross", "Normal"), bucket: "3 Star", popular: true, currentRotation: true, speciesName: "Metagross", speciesForm: "Normal" },
  { key: makeKey("Garchomp", "Normal"), bucket: "3 Star", popular: true, currentRotation: true, speciesName: "Garchomp", speciesForm: "Normal" },
  { key: makeKey("Salamence", "Normal"), bucket: "3 Star", popular: true, currentRotation: true, speciesName: "Salamence", speciesForm: "Normal" },
];

export const DEFAULT_RAID_BOSS_KEY = makeKey("Dragonite", "Normal");

export const RAID_BOSS_SOURCE_OPTIONS: RaidBossSourceFilter[] = ["Current Rotation", "Mythical & Legendary", "All other bosses"];

export function formatRaidBossLabel(entry: RaidBossCatalogEntry): string {
  if (entry.speciesName.startsWith("Shadow ") || entry.speciesName.startsWith("Mega ")) {
    return entry.speciesName;
  }
  if (entry.speciesForm && entry.speciesForm !== "Normal" && entry.speciesForm !== "Mega") {
    return `${entry.speciesName} (${entry.speciesForm})`;
  }
  return entry.speciesName;
}

export const RAID_BOSS_OPTIONS: RaidBossCatalogEntry[] = RAW_BOSSES.map((entry) => ({
  ...entry,
  label: formatRaidBossLabel(entry),
}));

const CURRENT_ROTATION_KEYS = new Set<string>([
  makeKey("Foongus", "Normal"),
  makeKey("Phantump", "Normal"),
  makeKey("Sandygast", "Normal"),
  makeKey("Gossifleur", "Normal"),
  makeKey("Vileplume", "Normal"),
  makeKey("Dugtrio", "Normal"),
  makeKey("Torterra", "Normal"),
  makeKey("Groudon", "Normal"),
  makeKey("Mega Alakazam", "Mega"),
  makeKey("Shadow Dratini", "Shadow"),
  makeKey("Shadow Gligar", "Shadow"),
  makeKey("Shadow Cacnea", "Shadow"),
  makeKey("Shadow Joltik", "Shadow"),
  makeKey("Shadow Alolan Marowak", "Shadow"),
  makeKey("Shadow Lapras", "Shadow"),
  makeKey("Shadow Stantler", "Shadow"),
  makeKey("Shadow Latios", "Shadow"),
]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeFormToken(value: string): string {
  const token = normalize(value).replace(/[^a-z0-9]+/g, "");
  if (!token) {
    return "normal";
  }
  if (token === "alola" || token === "alolan") {
    return "alolan";
  }
  if (token === "galar" || token === "galarian") {
    return "galarian";
  }
  if (token === "hisui" || token === "hisuian") {
    return "hisuian";
  }
  if (token === "paldea" || token === "paldean") {
    return "paldean";
  }
  return token;
}

function displayFormFromApi(value: string): string {
  const token = normalizeFormToken(value);
  if (token === "normal") {
    return "Normal";
  }
  if (token === "alolan") {
    return "Alolan";
  }
  if (token === "galarian") {
    return "Galarian";
  }
  if (token === "hisuian") {
    return "Hisuian";
  }
  if (token === "paldean") {
    return "Paldean";
  }
  return value || "Normal";
}

function preferredByName(name: string, pokemon: PokemonEntry[]): PokemonEntry | null {
  const matches = pokemon.filter((entry) => normalize(entry.name) === normalize(name));
  if (!matches.length) {
    return null;
  }

  const normalForm = matches.find((entry) => normalize(entry.form) === "normal");
  return normalForm ?? matches[0];
}

function cloneBossPokemon(base: PokemonEntry, entry: RaidBossCatalogEntry): PokemonEntry {
  return {
    ...base,
    name: entry.speciesName,
    form: entry.speciesForm,
    types: entry.proxyTypes ?? base.types,
  };
}

function draftRaidBossEntryFromPokemon(
  pokemon: PokemonEntry,
  bucket: RaidBossBucket = "5 Star",
  currentRotation = false,
): RaidBossCatalogEntry {
  const key = makeKey(pokemon.name, pokemon.form);
  return {
    key,
    label: formatRaidBossLabel({
      key,
      bucket,
      popular: false,
      currentRotation,
      speciesName: pokemon.name,
      speciesForm: pokemon.form,
    }),
    bucket,
    popular: false,
    currentRotation,
    speciesName: pokemon.name,
    speciesForm: pokemon.form,
  };
}

function findPokemonByNameAndForm(
  allPokemon: PokemonEntry[],
  speciesName: string,
  speciesForm: string,
): PokemonEntry | null {
  const targetName = normalize(speciesName);
  const targetForm = normalizeFormToken(speciesForm);
  const exact = allPokemon.find(
    (pokemon) =>
      normalize(pokemon.name) === targetName && normalizeFormToken(pokemon.form) === targetForm,
  );
  if (exact) {
    return exact;
  }
  return allPokemon.find((pokemon) => normalize(pokemon.name) === targetName) ?? null;
}

function draftCurrentRaidEntry(
  raidBoss: CurrentRaidBossEntry,
  tierKey: string,
  allPokemon: PokemonEntry[],
): RaidBossCatalogEntry {
  const bucket = bucketFromTierKey(tierKey, raidBoss.tier);
  const isMega = bucket === "Mega";
  const isShadow = normalizeFormToken(raidBoss.form || "") === "shadow" || /^shadow\s+/i.test(raidBoss.name);
  const baseName = raidBoss.name.replace(/^shadow\s+/i, "").replace(/^mega\s+/i, "").trim() || raidBoss.name;
  const resolvedName = isMega ? `Mega ${baseName}` : isShadow ? `Shadow ${baseName}` : baseName;
  const resolvedForm = isMega ? "Mega" : isShadow ? "Shadow" : displayFormFromApi(raidBoss.form || "Normal");
  const foundPokemon = findPokemonByNameAndForm(allPokemon, raidBoss.name, raidBoss.form || "Normal");
  const proxyTypes = raidBoss.type?.length ? raidBoss.type : foundPokemon?.types;
  const key = makeKey(resolvedName, resolvedForm);
  return {
    key,
    label: formatRaidBossLabel({
      key,
      bucket,
      popular: false,
      currentRotation: true,
      speciesName: resolvedName,
      speciesForm: resolvedForm,
    }),
    bucket,
    popular: false,
    currentRotation: true,
    speciesName: resolvedName,
    speciesForm: resolvedForm,
    proxyBaseSpecies: isMega || isShadow ? baseName : undefined,
    proxyTypes,
    proxyNote: isMega
      ? `Mega ${baseName} uses a proxy profile based on ${baseName} until mega-form boss data is available locally.`
      : isShadow
        ? `Shadow ${baseName} uses a proxy profile based on ${baseName} until shadow-form boss data is available locally.`
        : undefined,
  };
}

function isUltraBeastSpecies(speciesName: string): boolean {
  return ULTRA_BEAST_NAMES.has(normalize(speciesName));
}

function isMegaBoss(entry: RaidBossCatalogEntry): boolean {
  return entry.bucket === "Mega" || entry.speciesName.startsWith("Mega ");
}

function currentRotationFromLiveData(
  currentRaidBossesData: CurrentRaidBossesData | null | undefined,
  allPokemon: PokemonEntry[],
): RaidBossCatalogEntry[] {
  const deduped = new Map<string, RaidBossCatalogEntry>();
  const current = currentRaidBossesData?.current ?? null;
  if (!current) {
    return [];
  }

  Object.entries(current).forEach(([tierKey, entries]) => {
    const safeEntries = Array.isArray(entries) ? entries : [];
    safeEntries.forEach((raidBoss) => {
      const isMegaTier = tierKey.startsWith("mega");
      const apiName = raidBoss?.name ?? "";
      const apiForm = raidBoss?.form ?? "Normal";
      const exactKey = makeKey(apiName, displayFormFromApi(apiForm));
      const catalogExact = RAID_BOSS_OPTIONS.find((entry) => entry.key === exactKey);
      const catalogMega = isMegaTier
        ? RAID_BOSS_OPTIONS.find((entry) => entry.key === makeKey(`Mega ${apiName}`, "Mega"))
        : null;
      const chosen = catalogMega ?? catalogExact ?? draftCurrentRaidEntry(raidBoss, tierKey, allPokemon);
      deduped.set(chosen.key, chosen);
    });
  });

  RAID_BOSS_OPTIONS.filter(
    (entry) => CURRENT_ROTATION_KEYS.has(entry.key) && entry.speciesName.startsWith("Shadow "),
  ).forEach((entry) => {
    deduped.set(entry.key, entry);
  });

  return Array.from(deduped.values());
}

export function filterRaidBosses(
  source: RaidBossSourceFilter,
  allPokemon: PokemonEntry[] = [],
  currentRaidBossesData: CurrentRaidBossesData | null = null,
  pokemonSpeciesData: PokemonSpecies[] = [],
): RaidBossCatalogEntry[] {
  if (source === "Current Rotation") {
    const live = currentRotationFromLiveData(currentRaidBossesData, allPokemon);
    if (live.length > 0) {
      return live;
    }
    // Hardcoded full rotations go stale quickly. If live/local feeds are unavailable,
    // keep only static shadow raid placeholders rather than outdated tier-5/mega picks.
    return RAID_BOSS_OPTIONS.filter(
      (entry) => CURRENT_ROTATION_KEYS.has(entry.key) && entry.speciesName.startsWith("Shadow "),
    );
  }

  const speciesFlagsByName = new Map<string, { isLegendary: boolean; isMythical: boolean; isUltraBeast: boolean }>();
  pokemonSpeciesData.forEach((entry) => {
    const key = normalize(entry.name);
    const current = speciesFlagsByName.get(key) ?? { isLegendary: false, isMythical: false, isUltraBeast: false };
    speciesFlagsByName.set(key, {
      isLegendary: current.isLegendary || Boolean(entry.isLegendary),
      isMythical: current.isMythical || Boolean(entry.isMythical),
      isUltraBeast: current.isUltraBeast || Boolean(entry.isUltraBeast),
    });
  });

  const isLegendaryMythicalOrUltra = (entry: RaidBossCatalogEntry): boolean => {
    const baseName = normalize(
      entry.speciesName
        .replace(/^shadow\s+/i, "")
        .replace(/^mega\s+/i, "")
        .trim(),
    );
    const flags = speciesFlagsByName.get(baseName);
    if (flags) {
      return flags.isLegendary || flags.isMythical || flags.isUltraBeast;
    }
    return isUltraBeastSpecies(baseName);
  };

  const tierFiveFromRaidData = () => {
    const deduped = new Map<string, RaidBossCatalogEntry>();
    const sections: unknown[] = [];
    if (currentRaidBossesData?.current) {
      sections.push(currentRaidBossesData.current);
    }
    const previous = (currentRaidBossesData as { previous?: unknown } | null)?.previous;
    if (previous && typeof previous === "object") {
      sections.push(previous);
    }

    sections.forEach((section) => {
      if (!section || typeof section !== "object") {
        return;
      }
      Object.entries(section as Record<string, unknown>).forEach(([tierKey, rows]) => {
        const safeRows = Array.isArray(rows) ? rows : [];
        safeRows.forEach((raw) => {
          const raidBoss = raw as CurrentRaidBossEntry;
          if (!raidBoss || typeof raidBoss !== "object") {
            return;
          }
          const tierValue = Number.isFinite(raidBoss.tier) ? raidBoss.tier : Number.parseInt(tierKey, 10);
          if (!Number.isFinite(tierValue) || tierValue < 5 || tierKey.startsWith("mega")) {
            return;
          }
          const drafted = draftCurrentRaidEntry(raidBoss, tierKey, allPokemon);
          const entry: RaidBossCatalogEntry = {
            ...drafted,
            currentRotation: false,
            bucket: "5 Star",
          };
          deduped.set(entry.key, entry);
        });
      });
    });

    if (deduped.size > 0) {
      return Array.from(deduped.values());
    }
    return RAID_BOSS_OPTIONS.filter((entry) => entry.bucket === "5 Star");
  };

  const tierFive = tierFiveFromRaidData().filter((entry) => !isMegaBoss(entry));

  if (source === "Mythical & Legendary") {
    return tierFive.filter((entry) => isLegendaryMythicalOrUltra(entry));
  }

  return tierFive.filter((entry) => !isLegendaryMythicalOrUltra(entry));
}

export function groupRaidBosses(
  entries: RaidBossCatalogEntry[],
  source: RaidBossSourceFilter,
  allPokemon: PokemonEntry[] = [],
): RaidBossOptionGroup[] {
  if (source === "Mythical & Legendary" || source === "All other bosses") {
    const sorted = [...entries].sort((left, right) => left.label.localeCompare(right.label));
    return sorted.length ? [{ label: "5-Star", options: sorted }] : [];
  }

  const order: RaidBossBucket[] = ["Mega", "5 Star", "3 Star", "1 Star"];
  const displayLabel: Record<RaidBossBucket, string> = {
    Mega: "Mega",
    "5 Star": "5-Star",
    "3 Star": "3-Star",
    "1 Star": "1-Star",
  };
  return order
    .map((label) => ({
      label: displayLabel[label],
      options: entries
        .filter((entry) => entry.bucket === label)
        .sort((left, right) => {
          const leftShadow = left.speciesName.startsWith("Shadow ");
          const rightShadow = right.speciesName.startsWith("Shadow ");
          if (leftShadow !== rightShadow) {
            return leftShadow ? -1 : 1;
          }
          return left.label.localeCompare(right.label);
        }),
    }))
    .filter((group) => group.options.length > 0);
}

export function resolveRaidBoss(entry: RaidBossCatalogEntry, allPokemon: PokemonEntry[]): ResolvedRaidBoss | null {
  const exact = allPokemon.find(
    (pokemon) =>
      normalize(pokemon.name) === normalize(entry.speciesName) &&
      normalize(pokemon.form) === normalize(entry.speciesForm),
  );

  if (exact) {
    return { catalog: entry, pokemon: exact, isProxy: false, note: null };
  }

  const fallbackName =
    entry.proxyBaseSpecies ??
    entry.speciesName
      .replace(/^shadow\s+/i, "")
      .replace(/^mega\s+/i, "")
      .trim();
  const fallback = preferredByName(fallbackName, allPokemon);
  if (!fallback) {
    return null;
  }

  const note = entry.proxyNote ?? `Using ${fallback.name} (${fallback.form}) as a proxy profile.`;
  return {
    catalog: entry,
    pokemon: cloneBossPokemon(fallback, entry),
    isProxy: true,
    note,
  };
}

export function defaultRaidBoss(allPokemon: PokemonEntry[]): ResolvedRaidBoss | null {
  const entry = RAID_BOSS_OPTIONS.find((boss) => boss.key === DEFAULT_RAID_BOSS_KEY) ?? RAID_BOSS_OPTIONS[0] ?? null;
  return entry ? resolveRaidBoss(entry, allPokemon) : null;
}
