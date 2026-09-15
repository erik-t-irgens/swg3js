# swg3js: what this is and how we work on it

Read this first. It is the handoff from the sessions that built the game so far, written so a new session can carry on without the old chat.

## What we are building

A just-for-fun recreation of Star Wars Galaxies (the 2003 MMO) that runs in a browser: Three.js for rendering, Rapier for physics, Vite and TypeScript, no framework. The owner has a legal SWG install (the SWG Legends client, which contains the original SOE archives) and Jedi Academy; everything the game shows is converted from those installs on the owner's own machine into `assets-private/`, which is git-ignored. The game code is public; the assets never are.

The owner plays it on Windows, in Chrome, and tests by hand. They report what they see in words ("the cockpit is a metre too high"), paste console output, and run converter commands you give them. They cannot see your tool calls, so every reply has to stand on its own and say exactly what to run and what to look for.

## Hard rules

- Never commit, copy into the repo, or publish anything from `assets-private/`, any `.tre` archive, or anything derived from the game's files. Diagnostic output pasted into chat is fine; files are not.
- The converter must work with `--retail-only`, which mounts only the SOE-origin archives. Emulator and mod content stays out. See `docs/ASSETS.md`.
- Never put a model name or model identifier in a commit message, PR text, or code comment.
- Commit messages: a one-line summary in plain words (what changed for the player or the converter), then a short paragraph of why, no bullet lists, no file lists. Attribution trailers are whatever the current tool adds; do not invent them.
- Do not create pull requests unless asked.
- Development happens on `claude/gun-combat`. After every commit, push the branch and fast-forward `main`:
  `git push -u origin claude/gun-combat && git checkout main && git merge --ff-only claude/gun-combat && git push origin main && git checkout claude/gun-combat`
- Before pushing: `npx tsc --noEmit -p .` and `npx vite build` must be clean. `node --check` any converter module you touched. The converter tests are plain node scripts (`npm run test:converter`), not vitest suites.

## Setup on a new machine

Node 22.18 or newer, `npm install`. Copy `.env.example` to `.env` and fill in:

```
SWG=<folder holding the client's .tre archives>
JKA=<Jedi Academy's GameData folder>
```

The converter replaces `@SWG` and `@JKA` on its command line with those. Then follow "Converting your own SWG install" in `README.md` (the whole list, in order, every command with `--retail-only`), and `npm run dev`. `npm run swg -- status assets-private` says what is in place and prints the command for anything missing.

`.claude/launch.json` starts the Vite dev server for the Claude Code extension.

## How the pieces fit

- `tools/swg/cli.mjs` is the converter, one `case` per command; `tools/swg/README.md` documents every command. It reads the client's IFF-based formats (`iff.mjs`, `msh.mjs`, `appearance.mjs`, `pob.mjs`, `sht.mjs`, `dds.mjs`, `objtemplate.mjs`, `datatable.mjs`, `shipdata.mjs`), writes GLB (`glb.mjs`) plus a `manifest.json` per pack. Diagnostics that exist and are worth knowing: `list`, `dump --strings` (prints every readable string per chunk, the way to learn a file layout), `template` (an object template's parameter chain), `materials --ship=<id>` (every shader a hull uses with what the converter made of it, and its hardpoints), `shader`, `pob`.
- `src/main.ts` is the app: the game loop, input dispatch, mounting and boarding, the camera choice, the `__debug` object on `window` (every helper is documented in the README's Debugging section).
- `src/world/` streams the planet: terrain from the game's own terrain rules, placed objects, portal buildings with cells drawn through a stencil portal renderer (`portalRender.ts`), a compile queue that pre-compiles shaders so nothing stalls on first draw, cascaded shadow maps.
- `src/player/` is the character: a parts-based skinned rig, the Jedi Academy movement and saber port, the blaster carries, and the "aboard" mode (see ships).
- `src/vehicles/` is the garage (`garage.ts` reads the manifests and spawns), the vehicle physics (`vehicle.ts`), ship interiors (`interior.ts`), engine trails (`trail.ts`).
- `src/net/` and `server/relay.mjs`: a dependency-free WebSocket relay that passes player states around; other players are drawn as their own characters.

## Things that took a long time to learn (do not relearn them)

- GLTFLoader strips `:` from node names and keeps the original in `userData.name`. The converter names hardpoints `hp:<name>` and cells `cell:<index>:<name>`; read them through `hardpointName()` in `garage.ts` and `cellIndexOf()` in `interior.ts`, never by matching `o.name` for a colon.
- A ship's hardpoints live in its `.lod` appearance, not its mesh, and the appearance chain (`.apt`, `.lod`, `.cmp`) carries them through `resolveParts` onto the first part. A single-mesh ship must keep its chain when the chain has hardpoints.
- Rapier scene queries see nothing until the world has stepped once. A ray cast into a freshly built world misses everything.
- Rapier's character controller with "apply impulses to dynamic bodies" panics on a trimesh collider. The push is off (`Player.pushBodies`), and every trimesh goes through `cleanTrimesh()` with `TRIMESH_FLAGS`.
- Changing the number of lights in the scene recompiles every shader (a second each on the owner's machine). Lights are pooled and never added or removed at runtime: `effects.flash` is a pool of point lights that everything borrows, including a ship's room lights.
- Materials with `transparent` true and any opacity still cast full shadows; glass meshes get `castShadow = false`. The converter marks glass-named shaders with `userData.glass`; the game never blends them (the client did not either), it swaps in a clear copy of the material while someone is in the ship.
- The game's rooms in a portal building are often larger than the hull around them and are only meant to be seen through portals. The window openings are "invisible collidable" meshes: colliders only, never drawn, never casting.
- A cockpit frame (`cockpit/<ship>.iff`) is authored in the ship's own space: hang it on the model at its origin and it lands in the canopy. The game never drew a pilot in a fighter, so the seat is derived from the frame's middle (`SEAT_FROM_FRAME` in `garage.ts`).
- Ship attachments (wings, engines, guns, boosters) are templates under `object/tangible/ship/attachment/`, named `shared_<ship>_<kind>_<side>_s01`; the hull's client data (`clientdata/ship/client_shared_<ship>.cdf`) names the wings; the components hang on hardpoints named `engine_pos1`, `weapon1_neg1`, `booster_pos1`. Wings are modelled in the hull's frame and sit at its origin.
- Normal maps are Direct3D's (green down); the converter writes them as they are and the game uses `normalScale (1, -1)`.

## Where things stand

Working: character creation and selection, planets with buildings and interiors, Jedi and Bounty Hunter combat, vehicles, ships that fly with wings, engine glows and trails, guns from the weapon hardpoints, cockpit frames with first-person view, ship interiors as a still room with its own physics (the "gravity hull" approach), boarding, walking the rooms with their own lights and sunlight, flying a multi-crew ship from its bridge, a relay for playing together.

Known gaps and the agreed order for the next work:

1. Ships do not take damage from bolts yet, so dogfights have no ending (vehicle damage exists for collisions: `hp`, `justHit`, `destroyed` in `vehicle.ts`; bolts need to find vehicles in `Bolts.update` through `hittableAt`).
2. A hull's rooms are hidden until someone boards; the proper fix is drawing them through the portal renderer with the windows as exits, so they show from outside.
3. The relay does not carry who is aboard or at the controls of what.
4. The lifts and terminals inside ship rooms are objects the server spawned, not part of the models; elevators do not work, and the Star Destroyer's bridge is behind one.
5. Space itself: no space maps yet.
6. The engine client data (`clientdata/ship/component/eng_*.cdf`, `GLOW` forms) carries glow sizes per engine style; their float layout is not decoded, so glows are sized by hull height.

## How to work with the owner

Give them exact commands to run and exactly what to look for, one list, every item independent of the others so they can do it all in one session. When something cannot be judged from here, ask for the one observation that separates the causes rather than guessing twice. Converter changes need a reconversion (`npm run swg -- ships @SWG assets-private --retail-only` for ships; the README's table for the rest); say so every time, and say when a change needs none.
