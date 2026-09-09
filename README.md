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
| Space | Jump (Bounty Hunter: hold in the air for jetpack) |
| Shift | Walk (on a speeder: boost) |
| LMB | Attack: saber swing or blaster fire |
| E | Mount / dismount the speeder |
| C | Switch class (Jedi / Bounty Hunter) |
| T | Hold to fast-forward the day |
| N | Noclip fly mode (Space up, Ctrl down, Shift fast) |
| In water | Chest-deep water swims: Space surfaces, Ctrl dives, or look down and swim forward; under water you swim where you look |
| M | Galaxy map |
| H | Toggle help |
| Esc | Release mouse |

**Jedi**: `1` Force Jump · `2` Force Speed · `3` Force Push · `4` Force Lightning (hold) · `L` lightsaber.
**Bounty Hunter**: `1` Thermal Detonator · `2` Stim Pack · Space in the air for the jetpack.
**Speeder**: `W/S` throttle · `A/D` steer · `Shift` boost · `Space` hop.

URL options: `?planet=lok` spawns on a specific world, `?class=bounty_hunter` picks a class, `?lowfx=1` disables shadows and halves resolution for weak machines.

## What exists today (v0.3)

- **Rigged character pipeline**: skinned GLTF characters with an animation state machine (idle, walk, run, airborne, seated), clip speed matched to movement, and world-space arm solving so aiming and saber swings override the clip pose. The Mixamo X Bot ships as a stand-in in `public/assets/characters/`; add `?rig=0` to use the primitive body.
- **SWG asset converter** in `tools/swg/`: reads TRE archives (including the `.toc`-indexed archives of the later client) from a locally owned install and writes textured static meshes as GLB, with retail-manifest verification. Verified on a real install. See `tools/swg/README.md` and `docs/ASSETS.md`.
- **Asset packs**: `npm run swg -- pack` builds `assets-private/<planet>/` from a spec; the game scatters the converted rocks, debris and flora across the terrain and places a hand-laid outpost of real buildings near spawn, with exact mesh collision. Without a pack the low-poly placeholders are used, so the public build stays asset-free. `npm run swg -- creatures` and `npm run swg -- player` convert the game's own creatures and a dressed player character (skin baked from the game's texture-renderer recipes) into `assets-private/creatures/` and `assets-private/player/`; the game swaps them in when the manifests exist.
- **Design doc** in `docs/DESIGN.md` with the settled decisions, pillars, combat model, skill system and phases.

- **Physics** via [Rapier](https://rapier.rs/) (Rust compiled to WebAssembly). Terrain chunks near the player get heightfield colliders, trees and rocks get cylinders, creatures are dynamic rigid bodies, and the player is a kinematic character controller with auto-step, slope limits and ground snapping. Force Push, detonators and deaths all move real bodies.
- **Speeder bike**: a dynamic body held up by four spring ray casts, with throttle, steering, lateral grip, boost, hops and engine drag. Mount it with `E`.
- **Hitbox combat**: the saber blade is swept as a capsule against creature colliders every frame of a swing, and the blaster is a hitscan ray from the camera through the crosshair. No hit-chance rolls anywhere.
- **Two classes**: Jedi (saber, Force Jump, Speed, Push, Lightning) and Bounty Hunter (blaster rifle, jetpack, physics-simulated thermal detonators, stim pack). Switch with `C`.
- **Creatures fight back**: health, aggression on the dangerous worlds (rancors, kimogila, boar-wolves, mawgax), stuns, knockback, ragdoll-ish deaths and respawns.
- **Day and night**: a 12-minute day with a moving sun, sunset tint, moon, stars and moonlight. Hold `T` to fast-forward.
- **Player health** with regeneration, a defeat screen and respawn.

- **Twelve planets**: the ten launch-era worlds (Tatooine, Naboo, Corellia, Dantooine, Lok, Endor, Dathomir, Yavin IV, Talus, Rori) plus the expansions' Mustafar and Kashyyyk. Kashyyyk is several separate terrains in the game (Kachirho, the hunting grounds, the Dead Forest, the Rryatt Trail, the caverns, the Kkowir forest, the Avatar platform), so the galaxy map lists its zones and travel lands in whichever you pick. Each is a seed plus a set of terrain, palette, sky, fog, vegetation and wildlife parameters in `src/data/planets.ts`.
- **Streaming procedural terrain**: 64 m chunks generated from layered simplex noise around the player, with analytic normals (no seams), vertex-colored by height, slope and shoreline. Planets are effectively unbounded.
- **Real ground in private builds**: the terrain generator paints the game's shader families across the ground exactly where the original rules put them, and the ground material blends each family's texture (at its own world scale) across every triangle, so sand meets rock and grass the way it did in the game.
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

## Build

```bash
npm run build    # typecheck + production build into dist/
npm run preview  # serve dist/
```

A GitHub Pages workflow in `.github/workflows/deploy.yml` builds and deploys `dist/` on pushes to `main` when Pages is enabled for the repo.
