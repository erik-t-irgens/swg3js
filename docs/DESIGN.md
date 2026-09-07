# SWG3JS Design

Decisions recorded here are settled unless a later entry overrides them. Everything else is a proposal.

## What this is

A private, friends-scale (2 to 10 players) co-op sandbox that recreates the feel of Star Wars Galaxies in the browser, with modern movement and skill-based combat layered on top. It is an improvement on SWG, not a museum piece: the same worlds, made vertical and physical.

## Pillars

1. **Skill-based combat with stats as modifiers.** Every hit is physical. Sabers are swept capsules, blasters are rays, grenades are bodies. Stats and skills change damage, speed, stamina, block windows and cooldowns. Nothing ever rolls to decide whether you hit.
2. **Verticality is a rule, not a feature.** Jump, Force Jump, jetpack, and later climbing and mantling. Any space we build gets rooftops, ledges, pits or ravines. If a space has no vertical play, it is not finished.
3. **Sandbox progression.** SWG-style skill boxes earned by doing the thing, spent on branches. Classes are starting kits. Anyone can respec at a trainer.
4. **Places worth reaching.** Procedural planets anchored by hand-built cities, starports, points of interest, lairs, ruins, resource nodes, dynamic events and exploration badges.

## Settled decisions

| Topic | Decision |
| --- | --- |
| Era and flavour | Pre-CU sandbox systems with hero-grade combat feel |
| Jedi | Freely selectable for now; a proper unlock may come later |
| Physics | Rapier everywhere: characters, creatures, vehicles, projectiles |
| Hit detection | Melee: swept capsule per swing frame. Ranged: linear hitscan. Splash: radius on a physics body |
| Art | Low-poly placeholders in the public repo. Converted SWG assets (meshes, animations, terrain, city snapshots) in private builds only, never committed |
| Multiplayer | Authoritative Node server sharing the Rapier simulation, client prediction for the local player, SQLite persistence. Built in phase three |
| Asset format | GLTF for everything the engine loads |

## Combat model

**Sabers.** Three stances, borrowed from Jedi Academy's read on the fantasy. Fast: short arcs, quick recovery, low damage, can chain. Medium: the baseline. Strong: wide arcs, slow, high damage, staggers. A block held on right mouse deflects blaster bolts within a cone and reduces melee damage. A parry window in the first 150 ms of a block interrupts the attacker. Swings are readable: wind-up, active window, recovery.

**Ranged.** Blasters build heat; overheating locks the weapon for a moment. Aim sway grows while moving or airborne and shrinks while crouched or stationary. Cover matters because bolts are physical.

**Force and gadgets.** Force powers draw from a pool that regenerates faster while not attacking. Bounty Hunter gadgets run on cooldowns and fuel. Both classes get one mobility tool (Force Jump, jetpack), one crowd tool (Push, detonator), one sustain tool (Heal, stim) and one damage tool (Lightning, rockets).

**Enemies.** Every enemy attack has a tell and a dodge. Creatures use lunges and sweeps. Humanoids use the same weapons players do.

## Skill system

- XP types match SWG: combat XP per weapon family, Force XP, crafting, exploration.
- Skill boxes form small trees per profession. Each box grants modifiers (damage, speed, heat capacity, Force pool) and occasionally an ability.
- Starting kits: Jedi, Bounty Hunter. Next: Smuggler (pistols, tricks), Commando (heavy weapons), Medic (support), Artisan (crafting).
- Respec at a trainer, no penalty during testing.

## World

- Planets stay procedural in the public build. Private builds run the ported SWG terrain generator from the planet's own rule file, so cities sit on the exact ground the game gave them; our additions (rooftops, pits, climbing) go on top of it.
- Cities and points of interest are placed from data files (later the SWG world snapshots), then edited by hand for verticality: rooftop routes, elevated walkways, pits and sewers.
- Travel: speeders on the surface, shuttles between cities, ships between planets once space exists.
- Day and night on every world, with a shared clock in multiplayer.

## Vertical movement spec

| Move | Who | Rule |
| --- | --- | --- |
| Jump | Everyone | 1.7 m, air control |
| Force Jump | Jedi | ~11 m, forward boost, costs Force |
| Jetpack | Bounty Hunter | Sustained thrust on fuel, regenerates on the ground |
| Mantle | Everyone (planned) | Auto-climb ledges up to chest height while airborne against a wall |
| Climb | Everyone (planned) | Ladders and marked climbable surfaces |
| Fall damage | Everyone (planned) | Starts at 8 m, Jedi and jetpack users mitigate |

## Asset pipeline

- `tools/swg/` converts from a locally owned SWG install to GLTF: TRE archive reading, IFF parsing, static meshes with textures first, then skinned meshes and animations, then world snapshots and terrain. Sourcing rules and provenance are in `docs/ASSETS.md`.
- Converted output goes to `assets-private/`, which is git-ignored. The game loads it when present and falls back to placeholders when it is not.
- The Mixamo X Bot stand-in proves the skinned-character pipeline until SWG characters convert.

## Phases

1. **Feel** (now): rigged characters, animation states, saber stances, block and parry, dodge, fall damage, mantling.
2. **SWG assets**: converter stages one through four, private builds with real meshes and animations.
3. **Multiplayer**: authoritative server, prediction, persistence, chat.
4. **Places**: first city with a starport, rooftops and a lair.
5. **Systems**: skill boxes, trainers, inventory, loot, crafting.
6. **Space**: ships and interplanetary flight.

## Open questions

- Jedi unlock design once the core is fun.
- Death penalty, if any, beyond respawn.
