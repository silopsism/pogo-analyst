import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simulateDeterministicRaidLife } from "../app/src/combat/eventRaidSim.ts";
import { computeRaidAttackers, raidMoveKey, type RaidSimulationMode } from "../app/src/raid.ts";
import type { MergedData, MoveEntry, PokemonEntry } from "../app/src/types.ts";

const data = JSON.parse(
  readFileSync(new URL("../data/processed/merged_pogo_data.json", import.meta.url), "utf8"),
) as MergedData;

const typeEffectiveness = data.type_effectiveness;

function getPokemon(name: string, form = "Normal"): PokemonEntry {
  const entry = data.pokemon.find((pokemon) => pokemon.name === name && pokemon.form === form);
  if (!entry) {
    throw new Error(`Missing Pokemon: ${name} (${form})`);
  }
  return entry;
}

function makeMove(partial: Partial<MoveEntry> & Pick<MoveEntry, "name" | "type" | "power" | "duration" | "energy_delta" | "move_kind">): MoveEntry {
  return partial as MoveEntry;
}

function makePokemon(
  base: PokemonEntry,
  overrides: Partial<PokemonEntry> & { moves?: PokemonEntry["moves"] },
): PokemonEntry {
  return {
    ...base,
    ...overrides,
    base_stats: {
      ...base.base_stats,
      ...overrides.base_stats,
    },
    moves: overrides.moves ?? base.moves,
    artwork: base.artwork,
    derived: base.derived,
    evolution: base.evolution,
  };
}

function findBestTeamDamage(
  attackers: PokemonEntry[],
  boss: PokemonEntry,
  mode: RaidSimulationMode,
  specificMoveset: { fastKey: string | null; chargedKey: string | null } | null = null,
  raidDurationSeconds = 90,
): number {
  const rows = computeRaidAttackers(
    attackers,
    boss,
    "Average",
    specificMoveset,
    raidDurationSeconds,
    2,
    "team_damage",
    1,
    mode,
    typeEffectiveness,
  );
  return rows[0]?.team_damage ?? 0;
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "attacker charged move is lost if the boss KOs first",
    run: () => {
      const attacker = makePokemon(getPokemon("Gengar"), {
        base_stats: { attack: 200, defense: 50, stamina: 50 },
        types: ["Normal"],
        moves: {
          fast: [makeMove({ name: "Jab", type: "Normal", power: 10, duration: 500, energy_delta: 100, move_kind: "fast" })],
          charged: [makeMove({ name: "Blast", type: "Normal", power: 500, duration: 3000, energy_delta: -100, move_kind: "charged" })],
          elite_fast: [],
          elite_charged: [],
        },
      });
      const boss = makePokemon(getPokemon("Mewtwo"), {
        base_stats: { attack: 250, defense: 100, stamina: 100 },
        types: ["Normal"],
        moves: {
          fast: [makeMove({ name: "Ruin", type: "Normal", power: 200, duration: 1000, energy_delta: 100, move_kind: "fast" })],
          charged: [makeMove({ name: "Crash", type: "Normal", power: 1, duration: 1000, energy_delta: -100, move_kind: "charged" })],
          elite_fast: [],
          elite_charged: [],
        },
      });

      const result = simulateDeterministicRaidLife({
        attacker,
        boss,
        attackerFastMove: attacker.moves.fast[0],
        attackerChargedMove: attacker.moves.charged[0],
        bossFastMove: boss.moves.fast[0],
        bossChargedMove: boss.moves.charged[0],
        typeEffectiveness: {},
      });

      assert.ok(result);
      assert.equal(result?.fainted, true);
      assert.ok((result?.damage_dealt ?? 0) < 100);
      assert.ok((result?.survival_seconds ?? 0) <= 1.1);
    },
  },
  {
    name: "spiked mode penalizes a fragile attacker more than smoothed mode",
    run: () => {
      const attacker = getPokemon("Venusaur", "Copy_2019");
      const bossBase = getPokemon("Mewtwo");
      const psychoCut = bossBase.moves.fast.find((move) => move.name === "Psycho Cut");
      const psystrike = makeMove({
        name: "Psystrike",
        type: "Psychic",
        power: 90,
        duration: 2500,
        energy_delta: -50,
        move_kind: "charged",
      });
      if (!psychoCut) {
        throw new Error("Missing Mewtwo Psycho Cut");
      }
      const boss = makePokemon(bossBase, {
        moves: {
          fast: [psychoCut],
          charged: [psystrike],
          elite_fast: [],
          elite_charged: [],
        },
      });
      const specificMoveset = { fastKey: raidMoveKey(psychoCut), chargedKey: raidMoveKey(psystrike) };

      const spiked = computeRaidAttackers(
        [attacker],
        boss,
        "Specific moveset",
        specificMoveset,
        90,
        2,
        "team_damage",
        1,
        "spiked",
        typeEffectiveness,
      )[0]?.team_damage ?? 0;
      const smoothed = computeRaidAttackers(
        [attacker],
        boss,
        "Specific moveset",
        specificMoveset,
        90,
        2,
        "team_damage",
        1,
        "smoothed",
        typeEffectiveness,
      )[0]?.team_damage ?? 0;
      assert.ok(spiked < smoothed);
    },
  },
  {
    name: "raid duration changes the winning attacker on a real boss setup",
    run: () => {
      const bossBase = getPokemon("Venusaur");
      const razorLeaf = bossBase.moves.fast.find((move) => move.name === "Razor Leaf");
      const sludgeBomb = bossBase.moves.charged.find((move) => move.name === "Sludge Bomb");
      if (!razorLeaf || !sludgeBomb) {
        throw new Error("Missing Venusaur Razor Leaf or Sludge Bomb");
      }
      const boss = makePokemon(bossBase, {
        moves: {
          fast: [razorLeaf],
          charged: [sludgeBomb],
          elite_fast: [],
          elite_charged: [],
        },
      });
      const specificMoveset = { fastKey: raidMoveKey(razorLeaf), chargedKey: raidMoveKey(sludgeBomb) };
      const shortRaid = computeRaidAttackers(
        data.pokemon.filter((pokemon) => pokemon.evolution.is_final_evolution || pokemon.evolution.line_names.length === 1),
        boss,
        "Specific moveset",
        specificMoveset,
        30,
        2,
        "team_damage",
        1,
        "spiked",
        typeEffectiveness,
      );
      const longRaid = computeRaidAttackers(
        data.pokemon.filter((pokemon) => pokemon.evolution.is_final_evolution || pokemon.evolution.line_names.length === 1),
        boss,
        "Specific moveset",
        specificMoveset,
        90,
        2,
        "team_damage",
        1,
        "spiked",
        typeEffectiveness,
      );

      assert.notEqual(shortRaid[0]?.pokemon.name, longRaid[0]?.pokemon.name);
      assert.equal(shortRaid[0]?.pokemon.name, "Salamence");
      assert.equal(longRaid[0]?.pokemon.name, "Mewtwo");
    },
  },
  {
    name: "Mewtwo Psycho Cut plus Psystrike keeps Ghost attackers ahead of Dark attackers",
    run: () => {
      const bossBase = getPokemon("Mewtwo");
      const psychoCut = bossBase.moves.fast.find((move) => move.name === "Psycho Cut");
      if (!psychoCut) {
        throw new Error("Missing Mewtwo Psycho Cut");
      }
      const psystrike = makeMove({
        name: "Psystrike",
        type: "Psychic",
        power: 90,
        duration: 2500,
        energy_delta: -50,
        move_kind: "charged",
      });
      const boss = makePokemon(bossBase, {
        moves: {
          fast: [psychoCut],
          charged: [psystrike],
          elite_fast: [],
          elite_charged: [],
        },
      });
      const specificMoveset = { fastKey: raidMoveKey(psychoCut), chargedKey: raidMoveKey(psystrike) };
      const darkAttackers = data.pokemon.filter(
        (pokemon) =>
          (pokemon.evolution.is_final_evolution || pokemon.evolution.line_names.length === 1) &&
          pokemon.types.includes("Dark"),
      );
      const ghostAttackers = data.pokemon.filter(
        (pokemon) =>
          (pokemon.evolution.is_final_evolution || pokemon.evolution.line_names.length === 1) &&
          pokemon.types.includes("Ghost"),
      );

      const darkBest = simulateDeterministicRaidLife({
        attacker: darkAttackers.find((pokemon) => pokemon.name === "Darkrai") ?? darkAttackers[0],
        boss,
        attackerFastMove: darkAttackers.find((pokemon) => pokemon.name === "Darkrai")?.moves.fast[0] ?? darkAttackers[0].moves.fast[0],
        attackerChargedMove: darkAttackers.find((pokemon) => pokemon.name === "Darkrai")?.moves.charged[0] ?? darkAttackers[0].moves.charged[0],
        bossFastMove: psychoCut,
        bossChargedMove: psystrike,
        typeEffectiveness,
      });
      const ghostBest = simulateDeterministicRaidLife({
        attacker: ghostAttackers.find((pokemon) => pokemon.name === "Lunala") ?? ghostAttackers[0],
        boss,
        attackerFastMove: ghostAttackers.find((pokemon) => pokemon.name === "Lunala")?.moves.fast[0] ?? ghostAttackers[0].moves.fast[0],
        attackerChargedMove: ghostAttackers.find((pokemon) => pokemon.name === "Lunala")?.moves.charged[0] ?? ghostAttackers[0].moves.charged[0],
        bossFastMove: psychoCut,
        bossChargedMove: psystrike,
        typeEffectiveness,
      });

      assert.ok(darkBest && ghostBest);
      assert.ok((ghostBest.damage_dealt ?? 0) > (darkBest.damage_dealt ?? 0));
    },
  },
  {
    name: "Mewtwo Confusion plus Focus Blast favors Ghost attackers more than Dark attackers",
    run: () => {
      const bossBase = getPokemon("Mewtwo");
      const confusion = bossBase.moves.fast.find((move) => move.name === "Confusion");
      const focusBlast = bossBase.moves.charged.find((move) => move.name === "Focus Blast");
      if (!confusion || !focusBlast) {
        throw new Error("Missing Mewtwo Confusion or Focus Blast");
      }
      const boss = makePokemon(bossBase, {
        moves: {
          fast: [confusion],
          charged: [focusBlast],
          elite_fast: [],
          elite_charged: [],
        },
      });
      const specificMoveset = { fastKey: raidMoveKey(confusion), chargedKey: raidMoveKey(focusBlast) };
      const darkAttackers = data.pokemon.filter(
        (pokemon) =>
          (pokemon.evolution.is_final_evolution || pokemon.evolution.line_names.length === 1) &&
          pokemon.types.includes("Dark"),
      );
      const ghostAttackers = data.pokemon.filter(
        (pokemon) =>
          (pokemon.evolution.is_final_evolution || pokemon.evolution.line_names.length === 1) &&
          pokemon.types.includes("Ghost"),
      );

      const darkBest = simulateDeterministicRaidLife({
        attacker: darkAttackers.find((pokemon) => pokemon.name === "Darkrai") ?? darkAttackers[0],
        boss,
        attackerFastMove: darkAttackers.find((pokemon) => pokemon.name === "Darkrai")?.moves.fast[0] ?? darkAttackers[0].moves.fast[0],
        attackerChargedMove: darkAttackers.find((pokemon) => pokemon.name === "Darkrai")?.moves.charged[0] ?? darkAttackers[0].moves.charged[0],
        bossFastMove: confusion,
        bossChargedMove: focusBlast,
        typeEffectiveness,
      });
      const ghostBest = simulateDeterministicRaidLife({
        attacker: ghostAttackers.find((pokemon) => pokemon.name === "Lunala") ?? ghostAttackers[0],
        boss,
        attackerFastMove: ghostAttackers.find((pokemon) => pokemon.name === "Lunala")?.moves.fast[0] ?? ghostAttackers[0].moves.fast[0],
        attackerChargedMove: ghostAttackers.find((pokemon) => pokemon.name === "Lunala")?.moves.charged[0] ?? ghostAttackers[0].moves.charged[0],
        bossFastMove: confusion,
        bossChargedMove: focusBlast,
        typeEffectiveness,
      });

      assert.ok(darkBest && ghostBest);
      assert.ok((ghostBest.damage_dealt ?? 0) > (darkBest.damage_dealt ?? 0));
    },
  },
  {
    name: "Dragonite Draco Meteor punishes Kyurem more clearly in spiked mode",
    run: () => {
      const dragonite = getPokemon("Dragonite");
      const dragonTail = dragonite.moves.fast.find((move) => move.name === "Dragon Tail");
      if (!dragonTail) {
        throw new Error("Missing Dragonite Dragon Tail");
      }
      const dracoMeteor = makeMove({
        name: "Draco Meteor",
        type: "Dragon",
        power: 150,
        duration: 3500,
        energy_delta: -100,
        move_kind: "charged",
      });
      const boss = makePokemon(dragonite, {
        moves: {
          fast: [dragonTail],
          charged: [dracoMeteor],
          elite_fast: [],
          elite_charged: [],
        },
      });
      const specificMoveset = { fastKey: raidMoveKey(dragonTail), chargedKey: raidMoveKey(dracoMeteor) };
      const kyurem = getPokemon("Kyurem", "White");
      const mamoswine = getPokemon("Mamoswine");

      const spikedRows = computeRaidAttackers(
        [kyurem, mamoswine],
        boss,
        "Specific moveset",
        specificMoveset,
        90,
        2,
        "team_damage",
        1,
        "spiked",
        typeEffectiveness,
      );
      const smoothedRows = computeRaidAttackers(
        [kyurem, mamoswine],
        boss,
        "Specific moveset",
        specificMoveset,
        90,
        2,
        "team_damage",
        1,
        "smoothed",
        typeEffectiveness,
      );

      const spikedKyurem = spikedRows.find((row) => row.pokemon.name === "Kyurem" && row.pokemon.form === "White");
      const spikedMamoswine = spikedRows.find((row) => row.pokemon.name === "Mamoswine");
      const smoothedKyurem = smoothedRows.find((row) => row.pokemon.name === "Kyurem" && row.pokemon.form === "White");
      const smoothedMamoswine = smoothedRows.find((row) => row.pokemon.name === "Mamoswine");

      assert.ok(spikedKyurem && spikedMamoswine && smoothedKyurem && smoothedMamoswine);
      const spikedRatio = (spikedKyurem?.survival_seconds ?? 0) / (spikedMamoswine?.survival_seconds ?? 1);
      const smoothedRatio = (smoothedKyurem?.survival_seconds ?? 0) / (smoothedMamoswine?.survival_seconds ?? 1);
      assert.ok(spikedRatio < smoothedRatio);
      assert.ok((spikedKyurem?.survival_seconds ?? 0) < (spikedMamoswine?.survival_seconds ?? 0));
    },
  },
];

let failures = 0;
for (const testCase of tests) {
  try {
    testCase.run();
    console.log(`ok - ${testCase.name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${testCase.name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exitCode = 1;
  throw new Error(`${failures} raid simulation test(s) failed`);
}
