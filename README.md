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
| Space | Jump |
| Shift | Walk |
| 1 | Force Jump |
| 2 | Force Speed (toggle) |
| 3 | Force Push |
| 4 | Force Lightning (hold) |
| L | Lightsaber |
| M | Galaxy map |
| H | Toggle help |
| Esc | Release mouse |

Add `?planet=lok` (or any planet id) to the URL to spawn on a specific world.

## What exists today (v0.1)

- **Ten launch-era planets**: Tatooine, Naboo, Corellia, Dantooine, Lok, Endor, Dathomir, Yavin IV, Talus, Rori. Each is a seed plus a set of terrain, palette, sky, fog, vegetation and wildlife parameters in `src/data/planets.ts`.
- **Streaming procedural terrain**: 64 m chunks generated from layered simplex noise around the player, with analytic normals (no seams), vertex-colored by height, slope and shoreline. Planets are effectively unbounded.
- **Props**: instanced trees (six styles: pine, round, palm, dead, giant, swamp) and rocks scattered deterministically per chunk, with cylinder colliders.
- **Water**, per-planet gravity, a gradient sky shader with sun discs (Tatooine gets two), exponential fog, and shadow-casting sunlight.
- **Player**: SWG-style orbit camera, run/walk, jumping, air control, wading and swimming, a low-poly Jedi with a walk cycle and a toggleable lightsaber.
- **Force powers** with a regenerating pool: Force Jump, Force Speed, Force Push (sends creatures flying), Force Lightning (arcs to the nearest creature in front of you).
- **Wildlife**: per-planet creatures (banthas, kaadu, rancors, kimogila...) that wander, flee if skittish, get knocked around and stunned.
- **Galaxy map** overlay for instant travel.

## Roadmap

Rough order, all up for discussion:

1. **Feel**: better character rig and animations (GLTF), camera collision polish, footsteps and ambient audio, day/night cycle.
2. **Places**: hand-placed cities and points of interest on top of the procedural base (Mos Eisley, Theed, Coronet), starports, buildings with interiors.
3. **Life**: NPCs with dialogue, quests, creature aggression and combat, loot.
4. **Systems**: skills and professions, inventory, crafting, harvesters, housing.
5. **Space**: ships, the JTL-style space layer, travel between planets by actually flying.
6. **Multiplayer**: authoritative server, chat, guilds. The code keeps world state in plain data with this in mind.

## Layout

```
src/
  core/      input and camera
  data/      planet definitions
  world/     noise, terrain, props, creatures, world streaming
  player/    character controller and model
  force/     force powers and effects
  ui/        HUD and galaxy map
  main.ts    app wiring and game loop
```

## Build

```bash
npm run build    # typecheck + production build into dist/
npm run preview  # serve dist/
```

A GitHub Pages workflow in `.github/workflows/deploy.yml` builds and deploys `dist/` on pushes to `main` when Pages is enabled for the repo.
