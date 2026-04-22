Raid Attackers Table Spec
Purpose

This table is specifically for ranking Pokémon as raid attackers against a selected raid boss.

It is not for PvP and not for general gym-defense analysis.

The goal is to rank attackers in a way that balances:

damage output
survivability
the fact that some glass cannons may die before getting enough charged moves off

This view should help answer:

“What are my best raid attackers against this boss under these boss move assumptions?”

User options

Add or keep these controls for this table:

1. Raid Boss

User selects a specific raid boss Pokémon, for example:

Dragonite
Rayquaza
Kyogre

This determines:

boss types
boss stats
boss available fast and charged moves

2. Boss moveset assumption

User selects one of:

Unknown
Best for attacker
Worst for attacker
Average
Specific moveset (optional if already easy to support)

These should work as follows:

Unknown

Use Average as the default fallback.

Best for attacker

Assume the boss is using the moveset that gives the attacker the best result among the boss’s available legal raid movesets.

This usually means:

the attacker resists the boss’s moves
incoming boss pressure is relatively low
Worst for attacker

Assume the boss is using the moveset that gives the attacker the worst result among the boss’s available legal raid movesets.

This usually means:

boss moves hit the attacker hard
incoming boss pressure is relatively high
Average

Calculate the attacker’s result across all legal boss fast + charged move combinations, then average the results.

This should be the main realistic default.

Specific moveset

If supported, let the user choose:

one boss fast move
one boss charged move

Use that exact moveset.

Scope

This table is for raid attackers only.

Use PvE move stats, not PvP move stats.

Assumptions for v1:

no dodging
neutral weather
no friendship bonus
no party power
no mega ally bonus
no relobby simulation
one attacker at a time
Core logic

For each attacker row, calculate performance against the selected raid boss.

Each row already has:

attacker Pokémon
attacker fast move
attacker charged move

The calculation should estimate:

how much damage the attacker deals
how long the attacker survives
how much total damage it gets out before fainting

Math to implement

1. Type effectiveness

Use Pokémon GO PvE type multipliers.

For each move:

get move type
compare against defender type(s)
multiply effectiveness across both defending types if needed

Examples:

Ice vs Dragon = super effective
Ice vs Dragon/Flying = super effective against both, so multiply both effects

2. STAB

If the move type matches one of the attacker’s own types, apply STAB.

3. Move damage

Use the normal simplified PvE damage formula:

damage = floor(0.5 * move_power * (attacker_attack / defender_defense) * multipliers) + 1

Where multipliers includes:

STAB
type effectiveness

This should be used for:

attacker hitting boss
boss hitting attacker

4. Boss incoming pressure

For the selected boss moveset assumption, estimate the boss’s incoming DPS against the attacker.

For a specific boss fast + charged moveset:

calculate boss fast move damage into the attacker
calculate boss charged move damage into the attacker
estimate the boss attack cycle:
fast moves generate energy
charged move spends energy
compute:
boss_incoming_dps = boss_cycle_damage / boss_cycle_time

This gives a fixed pressure value for that attacker matchup.

For Average, average this result across all legal boss movesets.

For Best for attacker, use the lowest-pressure / best-result boss moveset.

For Worst for attacker, use the highest-pressure / worst-result boss moveset.

5. Estimated survival time

Estimate how long the attacker stays alive:

estimated_survival_seconds = attacker_hp / boss_incoming_dps

This does not need to be perfect. It is mainly for relative comparison across attackers.

6. Attacker attack cycle

Simulate the attacker until fainting.

Rules:

start at 0 energy
use fast moves until enough energy for charged move
then use charged move
repeat until estimated survival time is reached

Pseudo-logic:

time = 0
energy = 0
total_damage = 0

while time < survival_time:
    if energy >= charged_cost:
        use charged move
    else:
        use fast move

If there is not enough time left to finish a move before fainting, do not count that move.

This naturally captures:

fast-move damage
charged-move damage
whether glass cannons die before firing enough charged moves
7. Final row outputs

From that simulation, compute the main results.

Keep the table limited to these columns only:

Recommended columns
Pokémon
Moveset
Format: Fast / Charged
Est. DPS
Damage dealt divided by actual simulated alive time
Survival
Estimated survival time in seconds
Total Damage
Total estimated damage dealt before fainting
Score
One combined ranking value

That is enough. No more columns in the main table.

Score formula

The ranking should not be pure DPS, because that overvalues glass cannons.

Use a simple balanced score such as:

score = est_dps * log(1 + survival_seconds)

This rewards:

high damage
staying alive longer

Sort the table by Score descending by default.

Display behavior
Moveset column

Show as:

Powder Snow / Avalanche
Est. DPS

Rounded to 1 or 2 decimals.

Survival

Rounded to 1 decimal with s.

Total Damage

Rounded to whole number or 1 decimal.

Score

Rounded to 1 or 2 decimals.

Expected behavior examples
Example: glass cannon

A Pokémon with huge attack but poor bulk may show:

high Est. DPS
low Survival
middling Score
Example: bulky attacker

A Pokémon with slightly lower DPS but much better survivability may show:

decent Est. DPS
high Survival
high Total Damage
better overall Score

That is intended.

Default behavior

When the user first opens this raid attackers table:

boss must be selected
boss moveset assumption defaults to Average
table sorts by Score descending
Implementation notes
Keep this logic inside utility/service functions, not directly in the table component
The table should only render the computed results
Do not mix PvE and PvP move data
Keep the code easy to extend later