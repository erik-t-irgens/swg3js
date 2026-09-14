# SWG3JS

Star Wars Galaxies, rebuilt for the browser with [Three.js](https://threejs.org/). A for-fun recreation of the SWG feel: big open planets, a free third-person camera, wildlife wandering the plains, and a galaxy map for hopping between worlds. Plus the things SWG never had: a jump button and Force powers.

## Play

```bash
npm install
npm run dev
```

Open the printed URL, click **Enter the galaxy**, and go.

| Key | Action |
| --- | --- |
| WASD / arrows | Move (relative to camera) |
| Mouse | Look (pointer locked) |
| Wheel | Zoom camera |
| Space | Jump (from prone: stand up) |
| Ctrl / X | Crouch (hold) |
| Z | Lie prone and get up again |
| K | Jedi: next saber style · Bounty Hunter: pistol or rifle |
| Shift | Walk (on a speeder: boost) |
| LMB | Attack: saber swing or blaster fire |
| E | Mount / dismount the speeder |
| C | Switch class (Jedi / Bounty Hunter) |
| T | Hold to fast-forward the day |
| N | Noclip fly mode (Space up, Ctrl down, Shift fast, + and - change the speed) |
| F | Flashlight on and off |
| In water | Chest-deep water swims: Space surfaces, Ctrl dives, or look down and swim forward; under water you swim where you look |
| M | Galaxy map |
| H | Toggle help |
| Esc | Release mouse |

**Jedi**: `1` Force Jump · `2` Force Speed · `3` Force Push · `4` Force Lightning (hold) · `L` lightsaber.
**Bounty Hunter**: `1` Thermal Detonator · `2` Stim Pack · `RMB` aim · `K` pistol or rifle.
**Speeder**: `W/S` throttle · `A/D` steer · `Shift` boost · `Space` hop.

URL options: `?planet=lok` spawns on a specific world, `?class=bounty_hunter` picks a class, `?lowfx=1` disables shadows and halves resolution for weak machines.

## What exists today (v0.3)

- **Rigged character pipeline**: skinned GLTF characters with an animation state machine (idle, walk, run, airborne, seated), clip speed matched to movement, and world-space arm solving so aiming and saber swings override the clip pose. The Mixamo X Bot ships as a stand-in in `public/assets/characters/`; add `?rig=0` to use the primitive body.
- **SWG asset converter** in `tools/swg/`: reads TRE archives (including the `.toc`-indexed archives of the later client) from a locally owned install and writes textured static meshes as GLB, with retail-manifest verification. Verified on a real install. See `tools/swg/README.md` and `docs/ASSETS.md`.
- **Asset packs**: `npm run swg -- pack` builds `assets-private/<planet>/` from a spec; the game scatters the converted rocks, debris and flora across the terrain and places a hand-laid outpost of real buildings near spawn, with exact mesh collision. Without a pack the low-poly placeholders are used, so the public build stays asset-free. `npm run swg -- creatures` and `npm run swg -- player` convert the game's own creatures and a dressed player character (skin baked from the game's texture-renderer recipes) into `assets-private/creatures/` and `assets-private/player/`; the game swaps them in when the manifests exist.
- **Design doc** in `docs/DESIGN.md` with the settled decisions, pillars, combat model, skill system and phases.

- **Physics** via [Rapier](https://rapier.rs/) (Rust compiled to WebAssembly). Terrain chunks near the player get heightfield colliders, trees and rocks get cylinders, creatures are dynamic rigid bodies, and the player is a kinematic character controller with auto-step, slope limits and ground snapping. Force Push, detonators and deaths all move real bodies.
- **Speeder bike**: a dynamic body held up by four spring ray casts, with throttle, steering, lateral grip, boost, hops and engine drag. Mount it with `E`.
- **Hitbox combat**: the saber blade is swept as a capsule against creature colliders every frame of a swing, and the blaster fires bolts that fly at 58 m/s and hit the first thing in their path, so a moving target is missed. No hit-chance rolls anywhere.
- **Two classes**: Jedi (saber, Force Jump, Speed, Push, Lightning) and Bounty Hunter (blaster rifle, physics-simulated thermal detonators, stim pack). Switch with `C`. The placeholder jetpack is gone; the game's own jetpack will come back as something you equip.
- **Creatures fight back**: health, aggression on the dangerous worlds (rancors, kimogila, boar-wolves, mawgax), stuns, knockback, ragdoll-ish deaths and respawns.
- **Day and night**: a 12-minute day with a moving sun, sunset tint, moon, stars and moonlight. Hold `T` to fast-forward.
- **Player health** with regeneration, a defeat screen and respawn.

- **Twelve planets**: the ten launch-era worlds (Tatooine, Naboo, Corellia, Dantooine, Lok, Endor, Dathomir, Yavin IV, Talus, Rori) plus the expansions' Mustafar and Kashyyyk. Kashyyyk is several separate terrains in the game (Kachirho, the hunting grounds, the Dead Forest, the Rryatt Trail, the caverns, the Kkowir forest, the Avatar platform), so the galaxy map lists its zones and travel lands in whichever you pick. Each is a seed plus a set of terrain, palette, sky, fog, vegetation and wildlife parameters in `src/data/planets.ts`.
- **Streaming procedural terrain**: 64 m chunks generated from layered simplex noise around the player, with analytic normals (no seams), vertex-colored by height, slope and shoreline. Planets are effectively unbounded.
- **Real ground in private builds**: the terrain generator paints the game's shader families across the ground exactly where the original rules put them, and the ground material blends each family's texture (at its own world scale) across every triangle, so sand meets rock and grass the way it did in the game.
- **Particle effects in private builds**: the game's own emitter descriptions (campfires, smoke, sparks, steam, candle flames, waterfall mist, Mustafar's lava plumes) play where the world snapshot places them, batched per texture and asleep beyond their range.
- **Real creatures in private builds**: the converter turns the game's skeletal appearances (skinned meshes, skeletons, compressed keyframe animations) into skinned GLBs, and the planets' creatures walk, run, attack and fall with their own animations.
- **Real flora and water in private builds**: the planet's own trees, rocks and plants grow where the terrain rules and the engine's seeded random numbers put them (the same spots on every server), and water sits at the terrain's global table height with every lake and pool from the terrain layers.
- **Real SWG terrain in private builds**: `src/swg/terrain/` is a port of the game's terrain generator (its seeded fractals, layer boundaries, filters and affectors, and the ground modifications buildings apply). When a converted pack carries the planet's `.trn`, chunks are generated from it in a Web Worker and the ground matches the original game to the centimetre, so snapshot buildings sit exactly on it.
- **Props**: instanced trees (six styles: pine, round, palm, dead, giant, swamp) and rocks scattered deterministically per chunk, with cylinder colliders.
- **Water**, per-planet gravity, a gradient sky shader with sun discs (Tatooine gets two), exponential fog, and shadow-casting sunlight.
- **Player**: SWG-style orbit camera, run/walk, jumping, air control, wading and swimming, a low-poly Jedi with a walk cycle and a toggleable lightsaber.
- **Force powers** with a regenerating pool: Force Jump, Force Speed, Force Push (sends creatures flying), Force Lightning (arcs to the nearest creature in front of you).
- **Wildlife**: per-planet creatures (banthas, kaadu, rancors, kimogila...) that wander, flee if skittish, get knocked around and stunned.
- **Galaxy map** overlay for instant travel.

Debug counters are exposed on `window.__stats` (frame, physics and render milliseconds, draw calls).

## Roadmap

Rough order, all up for discussion:

1. **Feel**: rigged GLTF characters and creatures with real animations (Mixamo for humanoids), saber stances and combos, blocking, dodge rolls, footsteps and ambient audio.
2. **Models**: replace primitives with proper assets. See "On assets" below.
3. **Places**: hand-placed cities and points of interest on top of the procedural base (Mos Eisley, Theed, Coronet), starports, buildings with interiors.
4. **Life**: NPCs with dialogue, quests, enemy humanoids that shoot back, loot.
5. **Systems**: skills and professions, inventory, crafting, harvesters, housing.
6. **Space**: ships, the JTL-style space layer, travel between planets by actually flying.
7. **Multiplayer**: authoritative server, chat, guilds. The code keeps world state in plain data with this in mind.

## Jedi Academy movement and saber combat (this branch)

The branch `claude/jka-combat` swaps the player's ground and air movement and the lightsaber combat for translations of Jedi Academy's (OpenJK, GPL-2.0; see `LICENSES/OpenJK-GPL-2.0.txt`). Swimming and noclip are untouched.

- **Movement**: Quake-style friction and acceleration, a little air control, and jumps that keep lifting while Space is held, up to the Force Jump level (level 3 by default, spending Force while it lifts). Landing from higher than your own jump's reach hurts. Ctrl crouches (half speed and a shorter capsule), tapping Ctrl while moving rolls that way, and landing with Ctrl held while moving rolls out of the landing for a third of the damage. `__debug.profile('swg')` in the console restores the original numbers.
- **Wall moves** (Force Jump level 2 and up, each a fresh press of Space): strafing and running beside a wall runs along it (press Space again to flip off, or run out of wall to stop); strafing into a wall flips off it; jumping at a wall just off the ground runs up it and flips back (level 3 runs higher); back and Space backflips; and at level 3, pressing at a wall in mid-air grabs it and springs off. A force jump that starts while pushing a direction becomes a flip that way.
- **Saber**: the first click draws the saber; the direction keys held with the click pick the swing (forward: overhead, sideways: horizontal cuts, diagonals: diagonal cuts); holding attack chains swings through Jedi Academy's arcs until the style's chain runs out and the saber returns to ready. **K** cycles the five styles: fast, medium, strong, the dual sabers (a second saber in the left hand) and the staff (a blade at each end); each has its own animations, speeds, chain lengths and damage, and the dual and staff styles chain without end. `__debug.saber()` reports the state.
- **Special moves**, as the game's rules pick them: pressing jump with attack held and forward pushed (medium flips over into a downward slash, strong leaps into the death-from-above, the dual sabers leap twice, the staff butterflies; the fast style has none, its special is the crouched lunge); jump with attack and a strafe (a cartwheel, the staff's sideways butterfly); the staff's back, jump and attack backflip attack. The press of jump starts the leap at once, cutting short any swing in progress, rather than waiting for the game's narrow window after the jump; crouched and forward (fast lunges, the dual sabers and the staff spin); back with an enemy behind (the back stab or back attack, low when crouched); attack out of a forward roll (the roll stab); the dual sabers hitting both sides at once with enemies on both; and the katas, both mouse buttons together while standing still (each style's own long special). **R** throws the saber, which flies where you look, returns when you let go (or at its reach, after six seconds, or off a wall) and cuts what it passes; with the staff, R kicks in the direction held (in the air too). The special moves cost Force.
- **Controls**: every action can be rebound from the console and the choice is kept in local storage: `__debug.bind('crouch', 'KeyV')` (KeyboardEvent code names, or `Mouse0`, `Mouse1`, `Mouse2`; several keys may be given; none restores the default), `__debug.bindings()` lists them, `__debug.resetBindings()` clears them. X crouches as well as Ctrl out of the box, because a Mac turns Ctrl-click into a right click.
- **Facing**: the body faces the camera while fighting, in the air, rolling and during the wall moves, so a flip or a wall run reads the way the move was made. On the ground SWG has no sideways or backwards clips (its run is `loop_standing:0:speed2` whichever way you go), so the game does what Jedi Academy does: the legs turn at most 45 degrees off the camera (sideways runs angle them, diagonals half as much), backing up plays Jedi Academy's back-pedal (`BOTH_RUNBACK1`, `BOTH_WALKBACK1`, imported by default) with the legs forward, and the torso twists back to face the camera. Without those clips the body turns the way it runs.
- **Blaster bolts** (after Jedi Academy's E-11, `src/combat/bolts.ts`): the bounty hunter's LMB fires a bolt every 0.35 s from the muzzle at whatever the crosshair is on. From the hip it scatters 1.6 degrees each way; with **RMB** held you aim, the shot flies true and the camera comes in over the shoulder with a narrower view.
- **Blaster carries** (`gunIdle`, `gunReady`, `gunAim` and their walks and runs in `src/player/rig.ts`): SWG's own gun animations, converted by default with the player (`loop_rifle:speedN`, `loop_pistol_standing:speedN`, the `_combat` and `_combat_aimed` loops and the `_fire_N` shots). At rest a pistol hangs at the side like a hilt and a rifle sits across the chest, and the body turns the way it runs. A shot brings up the combat carry facing the camera and it stays up for five seconds after the last shot, so firing does not snap between poses; aiming brings up the aimed carry. Each shot plays its fire clip on the upper body over whatever the legs are doing. **K** switches between the pistol's and the rifle's carries as it cycles the saber styles (`__debug.gun('pistol')` or `('rifle')` does the same; there is one placeholder gun model until the weapons are converted); without the converted clips the arms are aimed by hand as before. Prone with a blaster has its own three loops (`loop_<kind>_prone`, `loop_<kind>_combat_prone`, `loop_<kind>_combat_prone_aimed`, still and crawling) and its own fire clips (`<kind>_combat_prone_fire_N`); the transitions (`trn_pistol_standing_to_pistol_combat_standing` and its inverse, and the rifle's) are converted with the player but not played yet. Kneeling is not in yet. Bolts fly straight at 2300 units a second (58 m/s) with no drop, hurt the first thing they run into (20 damage), and can be sidestepped: whoever shoots aims where you are, not where you will be. Three **blaster turrets** stand on open ground around wherever you arrive (`src/combat/turrets.ts`): each turns to face you within 45 m, fires every 0.8 s with a degree of scatter, has 120 health, and stands again 25 s after it is destroyed. `__debug.turret(20)` stands one ahead of you, `__debug.turrets()` and `__debug.bolts()` report them, and `__debug.shootPlayer()` fires one bolt at you.
- **Blocking**: **RMB** held with the saber lit is the block: the style's stance comes up, and a bolt that reaches you from ahead is turned back into the air (`src/combat/deflect.ts`, after `WP_SaberCanBlock` and `G_ReflectMissile`). It then belongs to you and hurts what it hits. At saber defence rank 3 (the default) it flies where you look, and you can block in the middle of a swing; at rank 2 it is turned back the way it came with some scatter; at rank 1 it scatters widely, and swings leave you open. `__debug.saberDefense(n)` sets the rank. Nothing is blocked while the button is up. The parry played comes from where the bolt struck (`BOTH_P1_S1_T_`, `_TR`, `_TL`, `_BR`, `_BL`; the dual sabers' `P6_S6` and the staff's `P7_S7` sets), imported by default. Bolts from behind, while the saber flies, mid-flip or mid-roll are not blocked. Only a lightsaber blocks; other melee weapons, when they come, will not.
- **Jumps**: every jump is Jedi Academy's, since SWG's own jump clip is not usable: the jump, the pose in the air and the landing come in the direction pushed (forward, back, left, right, as `PM_JumpForDir` picks them) and in their force jump versions when the jump is a Force one (`PM_ForceJumpAnimForJumpAnim`), all imported by default. Only the Jedi has a Force jump level; the bounty hunter's jump is the plain one, with no wall moves, flips or backflips. Standing still and holding attack chains swings round the quadrants the way `PM_AttackMoveForQuad` does, each starting where the last ended.
- **Pace**: the ground speed follows the clip that plays for it, so the feet stay planted: walking is as fast as the walk clip travels (SWG's own, or Jedi Academy's saber walk with the block held), crouch-walking with the walk key as its clip, and backing up with the block held a touch slower than the run, as its back-pedal is; a plain crouch moves at Jedi Academy's crouched walking speed, a little quicker than the clip, with the clip scaled up to it, and running keeps Jedi Academy's speed with the run clip scaled to it, except with the block held, where the run drops to the saber run's own pace within 65 to 80 percent of the full run and the back-pedal to its own within 50 to 80 percent. Jedi Academy's clips were made for less than its speeds (the game lets the feet slide), so the paces taken from them are held within those bands, and its walks go no slower than 1.2 m/s. The importer measures each Jedi Academy locomotion clip's speed from its feet (the planted foot slides back under the body at the travel speed) and stores it beside the clip; SWG's clips carry their own. Looping clips (idles, walks, runs, stances) now close properly: the converter adds the key that takes the last frame back to the first over one frame interval, which is what the loop was missing when it hitched.
- **Postures**: Ctrl or X held crouches; without the block held it is SWG's own crouch (`loop_crouched:speed0` still, `loop_crouched:speed1` moving, at the clip's pace, and the same clip slowed with the walk key as the movement is), with the block held Jedi Academy's. **Z** lies prone and gets up again (`loop_prone:speed0` still, `loop_prone:speed1` crawling, at the crawl's own pace, with the walk key too); the capsule shrinks to the crouch height. A saber swing, the block, swimming or the jump key stand you up (the jump key only stands you up; it jumps on the next press). SWG's female walk is its own clip (`loop_skill:speed0`), to be picked up when the other species and genders are converted.
- **Weapons in hand**: the saber and the rifle sit on the skeleton's own weapon hold points (`hold_r`, `hold_l`, the bones the game hangs weapons from, in the palm) when the skeleton has them, and on the wrist bones otherwise. Where the blade points in the hand is solved by the importer from Jedi Academy's own swings: each medium and strong swing starts and ends in a named quadrant (the overhead starts pointing up, a side cut starts pointing that way), which pins the blade's axis in the wrist frame by least squares over fourteen swings; the left hand's axis is the right's mirrored through the dual stance. The axis is written beside the clips (`jkaGrip` in the manifest and in `parts.json`, carried by the clip bundle), and the game aligns the hilt to it, so wrist twists in the katas turn into the saber spins they are; without it the game guesses from the bind pose. The solved axis is used while the arms play a Jedi Academy clip and the bind-pose guess while they play an SWG one, blended over a few frames when the source changes. For the held Jedi Academy poses (the stances, its runs and walks) a calibration can be added without touching the swings: `__debug.grip({ stanceRoll: 20 })` rolls the hilt about the forearm by that many degrees in those poses only, `__debug.grip({ jkaRoll: 5 })` in every Jedi Academy clip, and `__debug.grip()` reports both; a value that looks right can then be made the default.
- **Animations**: SWG's own idle, walk, run and swimming are what you see by default, saber lit or not, with the saber hanging at your side and the body turning the way it runs. Jedi Academy takes over while the block is held, and through any swing, throw, flip or roll: the style's stance when standing, Jedi Academy's saber run and walk (`BOTH_RUN2`, `BOTH_WALK2`; the staff's and the dual sabers' own `BOTH_RUN_STAFF`, `BOTH_RUN_DUAL` and walks, since the game gives the three single-saber styles one set) and back-pedals, the crouch and its back-pedal, when moving with the legs angled to the camera, its jump and landing in the air, and its crouch. Swimming with the block held layers the stance on the torso and arms over the swimming legs. The clips come in when the player is converted with `--jka=<path to Jedi Academy's GameData or base folder>` (see the converter README); the importer retargets them onto the SWG skeleton, and the parts rig receives them through `clips-save` and `clips-apply`. Without them, everything is SWG's and swings fall back to the stand-in arm swing. `__debug.player().rig` names the clip playing.

## The gallery (a development world)

`npm run swg -- gallery @SWG assets-private --retail-only --jka=@JKA` builds `assets-private/gallery/`: a flat world under Tatooine's sky with every player house (interiors and all, walk in through the doors), every vehicle and every weapon in rows, each with its name over it, and every animation from both games on a grid of player models six feet apart, sorted by category (SWG's locomotion, pistol, rifle, one-hand and two-hand melee, polearm, unarmed, emotes, reactions and so on; Jedi Academy's stances, each saber style's swings, the specials and katas, parries, jumps and rolls, Force powers, deaths) with the clip's name over each. A clip that moves part of the skeleton only (the arm-only shots such as the pistol's `_fire` clips, which would stand as T-poses on their own) is layered over the idle on its joints, as the game plays it. Play it with `?planet=gallery` or from the galaxy map. Only the mannequins within 3 m of you animate (the rest of the grid is labels), so the grid can hold thousands of clips; `__debug.gallery(10)` widens that to 10 m. `--only=houses,vehicles,weapons,anims` builds part of it, `--limit=N` a sample. In the console, `__debug.gallery()` names the animation slot nearest you and `__debug.anim('name')` plays any clip the player's rig has on the player, so a saber style can be assembled by naming its clips.

## On assets

The original SWG client assets (the `.tre` archives) are copyrighted by Sony Online Entertainment / Lucasfilm and cannot be redistributed, so they will never be committed to this repo. A private build could load them from a local install via a converter, but a public site cannot ship them. The plan instead:

- **CC0 low-poly packs** that already match the flat-shaded style: Kenney, Quaternius, Poly Pizza. Good for props, buildings and vehicles.
- **Mixamo** for a rigged humanoid and a large animation library (free with an Adobe account, licensed for use in games). The X Bot stand-in in this repo comes from the three.js examples.
- **Sketchfab** fan-made Star Wars models under CC-BY where the licence allows it, credited in a `CREDITS.md`.

GLTF is the loading format for all of it.

## Layout

```
docs/DESIGN.md   game design decisions
tools/swg/       SWG asset converter (TRE, IFF, .msh to GLB)
src/
  core/      input, camera, physics wrapper
  data/      planet definitions
  world/     noise, terrain, props, creatures, day cycle, world streaming
  player/    character controller, primitive model, skinned rig
  combat/    class kits (Jedi, Bounty Hunter), effects, hit detection
  vehicles/  speeder bike
  ui/        HUD and galaxy map
  main.ts    app wiring and game loop
```

## Converting your own SWG install

Everything the game shows from the original client (planets, buildings, ground textures, creatures, the player character) is converted from a locally owned install into `assets-private/`, which is git-ignored and never committed. The converter is `tools/swg/cli.mjs`; `docs/ASSETS.md` explains what may be converted and why, and `tools/swg/README.md` documents every command.

**Setup, once per machine.** Node 22.18 or newer (24 is fine), then `npm install`. Copy `.env.example` to `.env` (git-ignored) and put the folder holding the `.tre` archives in it, and Jedi Academy's `GameData` folder if you have the game:

```
SWG=C:/SWG
JKA=C:/Program Files (x86)/Steam/steamapps/common/Jedi Academy/GameData
```

The converter replaces `@SWG`, `@JKA` and `@CORE3` on its command line with those values, so the commands below work the same in cmd, PowerShell, Git Bash and a Unix shell, and paths with spaces need no quoting. A shell variable works too (`export SWG=...`, then `@SWG` as the argument), and the environment wins over `.env`.

**The whole conversion, in order.** Every command takes `--retail-only`, which mounts only the SOE-origin archives and leaves an emulator project's own content out.

```bash
npm run swg -- verify @SWG --retail-only                                        # 1. which archives are retail (sanity check)
npm run swg -- planets @SWG --retail-only                                       # 2. which planets the archives hold
npm run swg -- snapshot @SWG all assets-private --radius=all --retail-only       # 3. every planet: objects, terrain, ground textures, sky, flora, places (long: minutes per planet)
npm run swg -- creatures @SWG assets-private --retail-only                      # 4. the creatures the planets spawn
npm run swg -- player @SWG assets-private --retail-only                         # 5. the player character, dressed, with its animations
npm run swg -- player @SWG assets-private --retail-only --jka=@JKA             #    ... plus Jedi Academy's saber, jump and parry clips (@JKA: its GameData or base folder)
npm run swg -- parts @SWG assets-private --retail-only                           # 6. the same character as parts (body, head, clothes on one skeleton), which the game prefers
npm run swg -- clips-save assets-private/player/human_male.glb assets-private/player/jka.clips --only=BOTH_
npm run swg -- clips-apply assets-private/characters/human_male/rig.glb assets-private/player/jka.clips   #    carry the Jedi Academy clips onto the parts rig
npm run swg -- wardrobe @SWG assets-private --retail-only                        # 7. every wearable and hairstyle, for the wardrobe on I (optional, long)
npm run swg -- status assets-private                                              # 8. what is in place, and the command for anything missing
npm run dev                                                                       # 9. play
```

Step 3 also accepts one planet at a time (`snapshot @SWG tatooine assets-private/tatooine --center=auto --radius=all --retail-only`), and `--radius=500` for a quick look at just the starport area. Step 5 dresses the character in a shirt, trousers and shoes; `--wear=object/tangible/wearables/...,...` picks other clothes (`list @SWG wearables/` shows what exists), `--var=name=value` sets skin and hair colours (the command prints every variable), `--template=object/creature/player/shared_twilek_female.iff` picks another species.

**After pulling new code.** Run `npm run swg -- status assets-private` first: it reports each pack and prints the exact command for whatever is missing. In general:

| What changed | Command to rerun |
| --- | --- |
| Ground textures, terrain rules, building layers, the sky | `terrain @SWG all assets-private --retail-only` (refreshes every existing pack in seconds) |
| Just the sky: sun, moons, stars, colour ramps, skybox, reflection maps | `sky @SWG all assets-private --retail-only` |
| Reflective metal and glass on buildings and props | `snapshot @SWG <planet> assets-private/<planet> --center=auto --radius=all --retail-only` (the shine is baked into each model's textures) |
| Buildings, objects, flora, a new planet | `snapshot @SWG <planet> assets-private/<planet> --center=auto --radius=all --retail-only` |
| Named places on the galaxy map | `pois @SWG all assets-private --retail-only` |
| Skin, clothes, eyes, animations (walking, swimming, crouching, prone, the blaster carries) | `player @SWG assets-private --retail-only --jka=@JKA`, then `parts @SWG assets-private --retail-only` and the `clips-save` and `clips-apply` pair (steps 5 and 6): the game plays the parts rig, so new SWG clips reach it only through `parts`, and the Jedi Academy clips through the bundle |
| Creature models or clips | `creatures @SWG assets-private --retail-only` |

Two optional sources add what the client files alone do not place. `--events` on `snapshot` includes buildout areas the game only shows during an event (`planets` lists which planets have any, with the event each needs). `--core3=<path to Core3/MMOCoreORB/bin/scripts>` reads the SWGEmu server scripts: the static objects its screenplays place go into the pack, and every creature and NPC spawn point is written to the pack's `spawns.json` for later use.

Commands that write a single planet's pack take the planet's folder (`assets-private/tatooine`); commands that take `all` take the parent (`assets-private`). Reconverting is always safe: each command overwrites only its own files.

## Build

```bash
npm run build    # typecheck + production build into dist/
npm run preview  # serve dist/
```

A GitHub Pages workflow in `.github/workflows/deploy.yml` builds and deploys `dist/` on pushes to `main` when Pages is enabled for the repo.
