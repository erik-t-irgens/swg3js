# swg3js: what this is and how we work on it

Read this first. It is the handoff from the sessions that built the game so far, written so a new session can carry on without the old chat.

## What we are building

A just-for-fun recreation of Star Wars Galaxies (the 2003 MMO) that runs in a browser: Three.js for rendering, Rapier for physics, Vite and TypeScript, no framework. The owner has a legal SWG install (the SWG Legends client, which contains the original SOE archives) and Jedi Academy; everything the game shows is converted from those installs on the owner's own machine into `assets-private/`, which is git-ignored. The game code is public; the assets never are.

The owner plays it on Windows, in Chrome, and tests by hand. They report what they see in words ("the cockpit is a metre too high"), paste console output, and run converter commands you give them. They cannot see your tool calls, so every reply has to stand on its own and say exactly what to run and what to look for.

## Hard rules

- Never commit, copy into the repo, or publish anything from `assets-private/`, any `.tre` archive, or anything derived from the game's files, with two exceptions the owner made. On 2026-10-18: `tools/swg/manifests/final-names.json`, the names list taken from SOE's own final index (each file's path, archive, offset, lengths, compressor and checksum, and SOE's deletions, for archives every NGE install already holds; no content), so every player's converter reads SOE's late archives from their own install with nothing extra. On 2026-10-19: `tools/swg/ngeref/`, the data every client needs from SOE's own server data and no client has -- which creature stands where on Kashyyyk and Mustafar, facing which way, how many, over which areas and in which rooms, as names, numbers and places (`docs/ASSETS.md`) -- so every player's converter stands their people, and, by his answer of 2026-10-31, the ways about those two worlds kept the same way (where each gate lands, the tree lifts, the trail's level moves, the dungeons' ways in and out, the clone droids and the two starports' terminals: names, numbers and places again), and, by his answer of 2026-11-01, the same rule reaches every world and everything the server placed or kept there (what stands where, the people and their crews, the regions, the map's categories, a station's furnishings, a space zone's objects), the copy winning wherever it and Core3's reference disagree and Core3 filling only what the copy lacks; game content (models, textures, sounds, strings) never is, and no script, code, quest or quoted line of the copy. Nothing else derived from SOE's indexes, the development tree or the NGE copy is committed or quoted. Diagnostic output pasted into chat is fine; files are not.
- The converter must work with `--retail-only`, which mounts only the SOE-origin archives, and the whole game must run from what that converts. Emulator and mod content stays out, with one exception the owner made on 2026-10-18: SWG Legends' own additions (its new armour, clothes, creatures, places and planets) may be converted where a player's install has them and they can be read as they stand, never by breaking an archive's encryption. Whatever comes from them is optional and marked as Legends in the game, nothing may depend on a Legends file, and a player without them simply does not see them. Like everything converted, nothing of theirs is ever committed. See `docs/ASSETS.md`.
- The interface is entirely our own and none of the client's own interface art is used: no `ui_*` atlas, icon, bar, reticle, frame or colour scheme of the game's is converted, read or drawn, by the owner's decision. Everything on the screen is drawn by this game from one table of eighteen named colours (`src/core/palette.ts` and the `palette` block in `src/style.css`), the shapes in `src/ui/hudCanvas.ts` and `src/ui/hud.css`, and the marks we drew by hand in `src/ui/hud.svg`. The client's own map pictures (`texture/ui_map_<planet>.dds`) and zone-map icons are the map window's and are not the interface's art.
- Never put a model name or model identifier in a commit message, PR text, or code comment.
- Commit messages: a one-line summary in plain words (what changed for the player or the converter), then a short paragraph of why, no bullet lists, no file lists. Attribution trailers are whatever the current tool adds; do not invent them.
- Do not create pull requests unless asked.
- Development happens on `claude/three-187`, the WebGPU port, which is the trunk (the owner's word of 2026-11-18): no visual work goes to main, and main moves only when the owner says a pass goes there as a release, by a fast-forward pushed by name (`git push origin <branch>:main`). Never `git checkout main` in a worktree. `claude/webgl-backup` is the last WebGL release and is never deleted.
- Before pushing: `npx tsc --noEmit -p .` and `npx vite build` must be clean, and `npm run test:all` must pass (it runs the converter, terrain, effects, weather, first-person head, close combat, inventory, audio, display and network suites; several other suites are still separate scripts). `npm run test:par` runs the same suites several at a time and a failure again alone, in a fraction of the time: a wave's fixer runs it once, last; the one-at-a-time `test:all` is for the end of a pass and before main. `node --check` any converter or server module you touched. The tests are plain node scripts (`npm run test:converter`, `npm run test:net`, …), not vitest suites.

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
- `src/net/` and `server/relay.mjs`: a dependency-free WebSocket server, grown in place from the relay that came before it, which passes player states around and holds the few things nobody can hold alone — one clock, who each player is, and which browser keeps each of the world's creatures (`ownership.mjs`, the browser's half `src/net/owned.ts` and `npcNet.ts`). Its sibling modules (`hash.mjs`, `clock.mjs`, `rooms.mjs`, `wire.mjs`, `store.mjs`, `identity.mjs`, `ownership.mjs`, `npcWire.mjs`) are dependency-free and shared with the node tests exactly as `shipWire.mjs` is; the browser's half is `src/net/session.ts` and `src/net/hash.ts`, and `src/world/sharedClock.ts` is what the day and the weather read. Other players are drawn as their own characters. With no server address set none of it runs and the game is what it was.
- `src/story/` is the story's rule book, pure and imported by the server as it stands: the book and its changes (`book.ts`), the sets read from `story-private/` and the test set (`set.ts`, `talkSet.ts`, `doc.ts`, `standing.ts`'s ladders), the step machine (`quests.ts`), conversations (`talkRules.ts`), documents (`docRules.ts`), the journal and the ISB's file, Standing and the named people (`standing.ts`, `people.ts`), the checker (`check.ts`), and the one host loop both hosts are (`hostCore.ts`): `localHost.ts` in the browser with no server, `server/stories.mjs` with one, `remoteHost.ts` the browser's side of that. What the world does with it (detectors, the tracker, the windows, the stood cast, the companion) is `src/main.ts`, `src/world/` and `src/ui/`.
- `src/anim/` is the imported animations, and `tools/anim/` the developer's importer that writes their pack (`public/anims/mixamo/`, committed and shipped): the pack's format (`mxaFile.ts`), the source's bones onto the game's joints (`mixamoMap.ts`), the fit to a skeleton (`fit.ts`, pure), the pack in the running game (`mixamoPack.ts`), which clip plays when (`animRules.ts`, pure), what a body remembers between frames for those rules and the hand-over of each answer to the rig (`bodyAnim.ts`, pure: the player's update calls one method of it at each moment and does nothing else about them) and the numbers of feel with their dials (`animTune.ts`, `animDials.ts`). The rig knows none of it: its loader is handed the fitted clips through `IMPORTED_CLIPS`.

## Lessons (do not relearn them)

What took a long time to learn is kept in `docs/lessons/`, one file an area, each lesson a paragraph naming the code it is about. Before changing an area, read its file, or grep `docs/lessons/` for the names you are about to touch: a lesson often sits in another area's file (the lessons on numbers boxed in a frame are spread over the grapple's, the racing's, the volumetrics' and the editor's). A new lesson goes into its area's file, never here.

This file is loaded whole into every session, so keep it under 200 lines and about 30,000 characters, and put here only what every session needs.

- `docs/lessons/testing.md`: **Testing and tooling.** How the tests run under node, driving a tab, shader text in tests, the dev server holding files.
- `docs/lessons/converter.md`: **The converter and the archives.** IFF tags, animation tables and their marks, hardpoint and template formats, status stamps, Core3 and NGE references, SOE's final names list, entries of ours.
- `docs/lessons/ships.md`: **Ships.** Hardpoints, cockpits and seats, fits and components, NPC ship types, paint, wings, bolts, mouse flight, ship combat, refits, landing, the rooms aboard.
- `docs/lessons/space.md`: **Space.** Space zones and their packs, stars and bodies, stations and docking lanes, clamping, nebulae, hyperspace, the cruise, the sandbox system.
- `docs/lessons/vehicles.md`: **Vehicles and mounts.** Mount tables, saddles and rider seats, pod seats, hull colliders, a vehicle's own materials.
- `docs/lessons/racing.md`: **Racing.** The race drive, engine parts, tracks and runs, pods from parts, the race course drawer.
- `docs/lessons/materials.md`: **Materials and effects.** Normal maps, detail maps, the mirror mask, the client's highlight, model reflections, unread slots, particles and those carried in a hull's frame, ribbons, flip-books, scrolling, effect passes, emissive split, animated surfaces.
- `docs/lessons/flora.md`: **Flora.** Leaf cards, their light and shadow, sway, the terrain's grass and far cards, flora collision.
- `docs/lessons/rendering.md`: **Rendering.** Three's traps: light counts, glass shadows, tone mapping and targets, the effects chain, motion blur, program keys, disposing materials, culling, the portal renderer, shadows, AO, flare, haze, depth of field, lights in rooms and the rooms' light pool.
- `docs/lessons/physics.md`: **Physics.** Rapier's traps: queries before the first step, the character controller, camera blocks, the floor under a body, the engine panic.
- `docs/lessons/audio.md`: **Audio.** Clip event marks, footsteps, the saber sounds, guns, sound templates, ship sounds, the mixer, ambience, loops, rooms and echoes, player music.
- `docs/lessons/player.md`: **The player: rig, animation and combat.** Moods, three's mixer, sabers and blaster aim, number slots, species rigs, dances, additive clips, first-person head hiding, where a blow came from.
- `docs/lessons/appearance.md`: **Appearance.** The creator table, look colours, dyes, the colour worker, garment tints, hairstyles, a fresh body, eye films.
- `docs/lessons/items.md`: **Items and equipment.** Owned things and their identity, item names, arrangements, the appearance table, item pictures, hands, putting things on in play.
- `docs/lessons/npcs.md`: **NPCs and creatures.** Mobiles, fighters, the AI fixes, indoor pathing, ragdolls, the living, perched people, the emulator's rows and screenplays, camps, the NGE overlay.
- `docs/lessons/world.md`: **The world: buildings, placement, travel, dungeons.** Cells and floors, doors, placing buildings and props, homes and keepers, permanent placements, deeds and footprints, object effects, shuttles and terminals, Restuss, the dungeons, the map fixes.
- `docs/lessons/terrain.md`: **Terrain, water and weather.** Boundaries and families, ground pictures and the ground program, environment areas, water and lava, the sea, reflections on water, the weather schedule and the shared clock, wetness.
- `docs/lessons/net.md`: **The network and the server.** Peer bodies and hulls, boarding peers, the relay and its words, claims, the world file, groups, shots between players, credits, a peer's saber, another player's vehicle drawn by the motion they send.
- `docs/lessons/ui.md`: **The interface.** The palette, the message line, the overlay, the minimap, keys and bindings, marks, the prompt, panels and windows, the map window and its tabs, the space map, the select screen, map pictures.
- `docs/lessons/story.md`: **The story.** The local and server hosts, conversations, the rule book, rewards paid once, the client's words, documents, rank and trust, named people, the companion.
- `docs/lessons/progression.md`: **Progression.** The stat resolver, fights noticed, the server's half.
- `docs/lessons/grapple.md`: **The grappling hook.** The rope's frame, its danger and look, props, vehicles, other players' vehicles, ropes on the wire.
- `docs/lessons/performance.md`: **Performance.** Loading screens, per-pass render states and links, the crowd's walk, shadow cadence and splits, person program keys, files never asked for.
- `docs/lessons/volumetrics.md`: **Volumetrics.** The moving air, its ground marks, dust, smoke, fog, particles, rain, water and lava currents, the wind and the clouds.
- `docs/lessons/editor.md`: **The world editor.** Flying the camera, editing as actions, folding and the scatter brush, sculpting, painting, lakes, rivers, looks, places, imports, removals, the dresser, worlds of yours.
- `docs/lessons/horizon.md`: **Terrain to the horizon.** The far bake, the rings, their shading, shape and edits, the reach, landmarks, rings made in the browser.
- `docs/lessons/webgpu.md`: **The WebGPU port.** Three 0.187, the WebGPU switch, warming, node copies of materials, leaf cards, ground, effects, AO, frame cost, timers.
- `docs/lessons/movement.md`: **Movement and climbing.** Imported clips, speed classes, foot speeds, stairs, the feet, hanging and climbing, bars, ropes, poles, vaults.

## Rules that cut across every area

Each is told at length in the file named.

- No frame waits on a shader program. Anything shown is prepared before it is shown, behind a loading screen; what must still be built in play goes through the world's queue, off the frame (issued and polled where the browser compiles in parallel); and the number of lights in the scene never changes at run time (`rendering.md`, `performance.md`).
- A frame allocates nothing. A number handed to or back from a call the compiler does not build in is a number made: carry numbers in kept records and fields, write `Math.sqrt` rather than `Math.hypot`, start a field that will hold a fraction as a fraction, and measure in fresh node processes, a dozen at once, since which calls are built in changes from run to run (`grapple.md`, `racing.md`, `volumetrics.md`, `editor.md`).
- A test runs the game's own code, never a copy of it; what only the game hands over is pinned as text; a comparison with the code before a change loads that code out of git or holds to a hash recorded from it (`editor.md`, `volumetrics.md`, `racing.md`, and most areas' files).
- Node runs the tests with TypeScript stripped: no parameter properties, and every value import under `src/` carries its `.ts` extension. Node compiles no GLSL, so a test that reads a shader runs it through `glslRun.ts` or scans it for what a compiler would refuse (`testing.md`, `volumetrics.md`).
- An IFF tag is four bytes, so a three-letter tag carries a trailing space (`VAL `, `DIR `, `ARG `): count the letters (`converter.md`).
- The emulator's rows are in the snapshot's frame, and every reader carries them into the game's (`npcs.md`).
- A material that is disposed is first forgotten by the portal renderer's set and the shadow cascades' map (`rendering.md`).
- Stop the dev server before a conversion swaps pack folders: on Windows it holds the files open (`testing.md`).
- The owner edits `public/placements/` and `public/tracks/` live from the editor, and a test that trips on his edits is mended in the test, never in his files (`racing.md`). His standing instruction besides: never revert, stage, reformat or commit his uncommitted files there.

## Where things stand

The whole account, pass by pass, is `docs/STATUS.md`: what each pass built, what is not built and what nobody has seen yet, and at its end the known gaps and the agreed order. Read the paragraph of the area you are about to change, and add one there when a wave lands. In brief:

- `claude/three-187` is the trunk: the WebGPU port on three 0.187, carrying everything main has, the climbing included. It draws on WebGPU by default; `?renderer=webgl` gives the WebGL renderer to compare.
- `main`, and `claude/webgl-backup` beside it, is the last WebGL release. Main moves only on the owner's word (the hard rules).
- The port's plan and each step's design are kept on the owner's machine under `A:\swg3js\port\`, and the session's handoff note says what comes next.

## How to work with the owner

Give them exact commands to run and exactly what to look for, one list, every item independent of the others so they can do it all in one session. When something cannot be judged from here, ask for the one observation that separates the causes rather than guessing twice. Converter changes need a reconversion (`npm run swg -- ships @SWG assets-private --retail-only` for ships; the README's table for the rest); say so every time, and say when a change needs none.

**Feel is the owner's to decide, by hand.** How a thing feels -- how high a jump goes, how hard a pull, how fast, how sudden is too sudden, how much a camera eases -- is his call, made with live knobs (his words, 2026-10-17: "the 'feel' of driving over things, or what is 'too sudden' of a hill steepness change should be something I decide"). Build the mechanism, give each such number a live knob with a sensible start and its reason in a comment, and stop: never pick one by measuring and re-measuring, and never run a measuring campaign over worlds or frame rates to choose one. Where a helper's numbers are mostly feel, hand the debug menu a set of dials for it (`src/ui/dials.ts`; the race's and the engines' are `src/vehicles/raceDials.ts`), each set through the helper's own setter, so he can move them as sliders and paste back the line that keeps them. Measure and fix only what is not taste: the code contradicting itself, something under the ground or through a wall, a difference by frame rate, an allocation in a frame, a crash or a wreck nothing caused, a hard rule broken.
