import type { PokemonEntry } from "./types.ts";

export type LevelUpCandidate = {
  level: number;
  iv_attack: number;
  iv_defense: number;
  iv_stamina: number;
  cp: number;
  dust_cost: number;
  cp_gap: number;
  iv_distance_from_0_15_15: number;
};

const CPM_BY_LEVEL: Record<string, number> = {
  "1": 0.094,
  "1.5": 0.135137432,
  "2": 0.16639787,
  "2.5": 0.192650919,
  "3": 0.21573247,
  "3.5": 0.236572661,
  "4": 0.25572005,
  "4.5": 0.273530381,
  "5": 0.29024988,
  "5.5": 0.306057377,
  "6": 0.3210876,
  "6.5": 0.335445036,
  "7": 0.34921268,
  "7.5": 0.362457751,
  "8": 0.37523559,
  "8.5": 0.387592406,
  "9": 0.39956728,
  "9.5": 0.411193551,
  "10": 0.42250001,
  "10.5": 0.432926419,
  "11": 0.44310755,
  "11.5": 0.453059958,
  "12": 0.46279839,
  "12.5": 0.472336083,
  "13": 0.48168495,
  "13.5": 0.4908558,
  "14": 0.49985844,
  "14.5": 0.508701765,
  "15": 0.51739395,
  "15.5": 0.525942511,
  "16": 0.53435433,
  "16.5": 0.542635767,
  "17": 0.55079269,
  "17.5": 0.558830576,
  "18": 0.56675452,
  "18.5": 0.574569153,
  "19": 0.58227891,
  "19.5": 0.589887917,
  "20": 0.59740001,
  "20.5": 0.604818814,
  "21": 0.61215729,
  "21.5": 0.619399365,
  "22": 0.62656713,
  "22.5": 0.633644533,
  "23": 0.64065295,
  "23.5": 0.647576426,
  "24": 0.65443563,
  "24.5": 0.661214806,
  "25": 0.667934,
  "25.5": 0.674577537,
  "26": 0.68116492,
  "26.5": 0.687680648,
  "27": 0.69414365,
  "27.5": 0.700538673,
  "28": 0.70688421,
  "28.5": 0.713164996,
  "29": 0.71939909,
  "29.5": 0.725571552,
  "30": 0.7317,
  "30.5": 0.734741009,
  "31": 0.73776948,
  "31.5": 0.740785574,
  "32": 0.74378943,
  "32.5": 0.746781211,
  "33": 0.74976104,
  "33.5": 0.752729087,
  "34": 0.75568551,
  "34.5": 0.758630378,
  "35": 0.76156384,
  "35.5": 0.764486065,
  "36": 0.76739717,
  "36.5": 0.770297266,
  "37": 0.7731865,
  "37.5": 0.776064962,
  "38": 0.77893275,
  "38.5": 0.781790055,
  "39": 0.78463697,
  "39.5": 0.787473578,
  "40": 0.79030001,
  "40.5": 0.792803968,
  "41": 0.79530001,
  "41.5": 0.797803921,
  "42": 0.8003,
  "42.5": 0.802803892,
  "43": 0.8053,
  "43.5": 0.807803863,
  "44": 0.81029999,
  "44.5": 0.812803834,
  "45": 0.81529999,
  "45.5": 0.817803806,
  "46": 0.82029999,
  "46.5": 0.822803778,
  "47": 0.82529999,
  "47.5": 0.82780375,
  "48": 0.83029999,
  "48.5": 0.832803723,
  "49": 0.83529999,
  "49.5": 0.837803696,
  "50": 0.84029999,
  "50.5": 0.84279999,
  "51": 0.84529999,
};

const MAX_POGO_LEVEL = 50;

const LEVELS = Object.keys(CPM_BY_LEVEL)
  .map((key) => Number.parseFloat(key))
  .filter((level) => level <= MAX_POGO_LEVEL)
  .sort((a, b) => a - b);

function cpAt(
  baseAttack: number,
  baseDefense: number,
  baseStamina: number,
  ivAttack: number,
  ivDefense: number,
  ivStamina: number,
  level: number,
): number {
  const key = Number.isInteger(level) ? String(Math.trunc(level)) : level.toFixed(1);
  const cpm = CPM_BY_LEVEL[key];
  if (!cpm) {
    return 10;
  }
  const attack = baseAttack + ivAttack;
  const defense = baseDefense + ivDefense;
  const stamina = baseStamina + ivStamina;
  const cp = Math.floor((attack * Math.sqrt(defense) * Math.sqrt(stamina) * cpm * cpm) / 10);
  return Math.max(10, cp);
}

function stardustCostForLevel(level: number): number {
  const tiers: Array<{ maxLevel: number; dust: number }> = [
    { maxLevel: 2.5, dust: 200 },
    { maxLevel: 4.5, dust: 400 },
    { maxLevel: 6.5, dust: 600 },
    { maxLevel: 8.5, dust: 800 },
    { maxLevel: 10.5, dust: 1000 },
    { maxLevel: 12.5, dust: 1300 },
    { maxLevel: 14.5, dust: 1600 },
    { maxLevel: 16.5, dust: 1900 },
    { maxLevel: 18.5, dust: 2200 },
    { maxLevel: 20.5, dust: 2500 },
    { maxLevel: 22.5, dust: 3000 },
    { maxLevel: 24.5, dust: 3500 },
    { maxLevel: 26.5, dust: 4000 },
    { maxLevel: 28.5, dust: 4500 },
    { maxLevel: 30.5, dust: 5000 },
    { maxLevel: 32.5, dust: 6000 },
    { maxLevel: 34.5, dust: 7000 },
    { maxLevel: 36.5, dust: 8000 },
    { maxLevel: 38.5, dust: 9000 },
    { maxLevel: 40.5, dust: 10000 },
    { maxLevel: 41.5, dust: 11000 },
    { maxLevel: 42.5, dust: 12000 },
    { maxLevel: 43.5, dust: 13000 },
    { maxLevel: 44.5, dust: 14000 },
    { maxLevel: 45.5, dust: 15000 },
    { maxLevel: 46.5, dust: 16000 },
    { maxLevel: 47.5, dust: 17000 },
    { maxLevel: 48.5, dust: 18000 },
    { maxLevel: 49.5, dust: 19000 },
    { maxLevel: 50, dust: 20000 },
  ];
  for (const tier of tiers) {
    if (level <= tier.maxLevel) {
      return tier.dust;
    }
  }
  return 20000;
}

function sameIvSpread(left: LevelUpCandidate, right: LevelUpCandidate): boolean {
  return (
    left.iv_attack === right.iv_attack &&
    left.iv_defense === right.iv_defense &&
    left.iv_stamina === right.iv_stamina
  );
}

function bestNonXlCandidate(
  baseAttack: number,
  baseDefense: number,
  baseStamina: number,
  cap: number,
): LevelUpCandidate | null {
  const rows: LevelUpCandidate[] = [];
  for (const level of LEVELS) {
    if (level > 40) {
      continue;
    }
    for (let ivAttack = 0; ivAttack <= 15; ivAttack += 1) {
      for (let ivDefense = 0; ivDefense <= 15; ivDefense += 1) {
        for (let ivStamina = 0; ivStamina <= 15; ivStamina += 1) {
          const cp = cpAt(baseAttack, baseDefense, baseStamina, ivAttack, ivDefense, ivStamina, level);
          if (cp > cap) {
            continue;
          }
          const cpGap = cap - cp;
          const ivDistance = Math.abs(ivAttack - 0) + Math.abs(ivDefense - 15) + Math.abs(ivStamina - 15);
          rows.push({
            level,
            iv_attack: ivAttack,
            iv_defense: ivDefense,
            iv_stamina: ivStamina,
            cp,
            dust_cost: stardustCostForLevel(level),
            cp_gap: cpGap,
            iv_distance_from_0_15_15: ivDistance,
          });
        }
      }
    }
  }

  rows.sort((left, right) => {
    return (
      right.cp - left.cp ||
      right.level - left.level ||
      left.iv_attack - right.iv_attack ||
      right.iv_defense - left.iv_defense ||
      right.iv_stamina - left.iv_stamina
    );
  });

  return rows[0] ?? null;
}

export function topGreatLeagueLevelUpCandidates(
  pokemon: PokemonEntry,
  cap = 1500,
  limit = 5,
): LevelUpCandidate[] {
  const baseAttack = pokemon.base_stats.attack ?? 0;
  const baseDefense = pokemon.base_stats.defense ?? 0;
  const baseStamina = pokemon.base_stats.stamina ?? 0;
  if (baseAttack <= 0 || baseDefense <= 0 || baseStamina <= 0) {
    return [];
  }

  const rows: LevelUpCandidate[] = [];
  const targetAttack = 0;
  const targetDefense = 15;
  const targetStamina = 15;
  const ivWindow = 2;
  const minAttack = Math.max(0, targetAttack - ivWindow);
  const maxAttack = Math.min(15, targetAttack + ivWindow);
  const minDefense = Math.max(0, targetDefense - ivWindow);
  const maxDefense = Math.min(15, targetDefense + ivWindow);
  const minStamina = Math.max(0, targetStamina - ivWindow);
  const maxStamina = Math.min(15, targetStamina + ivWindow);

  for (const level of LEVELS) {
    for (let ivAttack = minAttack; ivAttack <= maxAttack; ivAttack += 1) {
      for (let ivDefense = minDefense; ivDefense <= maxDefense; ivDefense += 1) {
        for (let ivStamina = minStamina; ivStamina <= maxStamina; ivStamina += 1) {
          const cp = cpAt(baseAttack, baseDefense, baseStamina, ivAttack, ivDefense, ivStamina, level);
          if (cp > cap) {
            continue;
          }
          const cpGap = cap - cp;
          const ivDistance =
            Math.abs(ivAttack - targetAttack) +
            Math.abs(ivDefense - targetDefense) +
            Math.abs(ivStamina - targetStamina);
          rows.push({
            level,
            iv_attack: ivAttack,
            iv_defense: ivDefense,
            iv_stamina: ivStamina,
            cp,
            dust_cost: stardustCostForLevel(level),
            cp_gap: cpGap,
            iv_distance_from_0_15_15: ivDistance,
          });
        }
      }
    }
  }

  rows.sort((left, right) => {
    return (
      right.cp - left.cp ||
      left.iv_distance_from_0_15_15 - right.iv_distance_from_0_15_15 ||
      left.iv_attack - right.iv_attack ||
      right.iv_defense - left.iv_defense ||
      right.iv_stamina - left.iv_stamina ||
      right.level - left.level
    );
  });

  const ideal = rows
    .filter((row) => row.iv_attack === targetAttack && row.iv_defense === targetDefense && row.iv_stamina === targetStamina)
    .sort((left, right) => right.cp - left.cp || right.level - left.level)[0];

  const unique = new Set<string>();
  const best: LevelUpCandidate[] = [];
  if (ideal) {
    const idealKey = `${ideal.iv_attack}|${ideal.iv_defense}|${ideal.iv_stamina}`;
    unique.add(idealKey);
    best.push(ideal);
  }

  for (const row of rows) {
    const key = `${row.iv_attack}|${row.iv_defense}|${row.iv_stamina}`;
    if (unique.has(key)) {
      continue;
    }
    unique.add(key);
    best.push(row);
    if (best.length >= limit) {
      break;
    }
  }

  const allTopRequireXl = best.length >= limit && best.every((entry) => entry.level > 40);
  if (!allTopRequireXl) {
    return best;
  }

  const nonXl = bestNonXlCandidate(baseAttack, baseDefense, baseStamina, cap);
  if (!nonXl) {
    return best;
  }

  const rebuilt: LevelUpCandidate[] = [];
  if (ideal) {
    rebuilt.push(ideal);
  }
  if (!ideal || !sameIvSpread(nonXl, ideal)) {
    rebuilt.push(nonXl);
  }

  for (const candidate of best) {
    if (rebuilt.some((entry) => sameIvSpread(entry, candidate))) {
      continue;
    }
    rebuilt.push(candidate);
    if (rebuilt.length >= limit) {
      break;
    }
  }

  for (const candidate of rows) {
    if (rebuilt.some((entry) => sameIvSpread(entry, candidate))) {
      continue;
    }
    rebuilt.push(candidate);
    if (rebuilt.length >= limit) {
      break;
    }
  }

  return rebuilt.slice(0, limit);
}
