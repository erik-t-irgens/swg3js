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
- A WING form's DATA is the wing template, a float open angle in degrees, a float seconds to open, then the sound; its PSOR is the hinge (position, then yaw, pitch, roll in degrees), not a placement. The wings are static meshes the client turns about the hinge's Z; the X-wing's foils are two diagonal pairs at ±14°. `dump --hex` is how that was decoded.
- Ship bolts come from `datatables/projectile/projectile.iff` (index to the bolt's `.prt`, its fire `.cef` and its hit `.cef` per surface; a `.cef` names a `.prt` and a `.snd`) and `datatables/space/ship_weapon_components.iff` (weapon name to projectile index, speed, range). Space bolts are 600 m/s, 512 m, drawn 19 m long ahead of the projectile point in local-space emitters, which `particles.ts` honours; passing effects are placed `transient`.
- A bolt is a thing in flight with a velocity: it carries the shooter's velocity (`inherit`) and its ray leads by its visual reach, so a fast ship's bolts never lag it and a long streak does not poke through what it hits.
- Normal maps are Direct3D's (green down); the converter writes them as they are and the game uses `normalScale (1, -1)`.
- An animation table's string selector (SSAT) keeps its value list in a chunk tagged `VAL ` (three letters and a space), not `VALS`: an i16 count, then each value's name and the i16 index of the branch it picks; several values share a branch. The converter names branches for their first value (`loop_riding:vehicle_speeder_bike`, `skill_action_5:dance_18`), the default branch plain, and writes every branch's values to the manifest as `variants`; `rig.variant(base, value)` resolves them in the game.
- How a rider sits comes from three mount tables (`datatables/mount/`): logical_saddle_name_map (a `.sat`, listed as its `_hue` variant, to a logical saddle), saddle_appearance_map (to the saddle's appearance), rider_pose_map (appearance and seat to the pose). The pose is the rider_pose selector's value; the hover chair is not in the tables, so unknown vehicles are tried as `vehicle_<id>`. A rideable vehicle's `pv_*.sat` is a placeholder whose body is the static appearance of the same name; the pose still keys on the `.sat`.
- A rideable vehicle's `pv_*.sat` is a placeholder only when its animation table is the shared `monstrosity.lat`; the walkers (AT-ST, AT-XT) and the basilisk carry their own table and mesh and walk with them. The game's own rider poses are what they are: the AT-ST seats its pilot as the hover chair does, the AT-XT as a pod racer.
- Three applies tone mapping only to the default framebuffer: with a render target bound the materials come out linear, so post-processing must end in an OutputPass, and toggling it recompiles every program (the tone mapping is in the program key).
- The game seats a rider at the vehicle's authored origin and the riding clip's root offset puts the pelvis in the seat: a speeder bike's `player` hardpoint is exactly its clip's root (0, 1.16, -0.04), so the rider must not be placed at the hardpoint as well. The garage recentres a model on its box, so the authored origin is `model.position` afterwards. A guessed seat (a mount's back, a cockpit frame) names the pelvis instead and takes the clip's root off (`seatPelvis`); `__debug.seat(dx, dy, dz)` nudges a seat live and prints the pose's root.
- EffectComposer swaps its read and write buffers after every pass that writes across, so a frame drawn into a fixed target reads back every other frame: draw into `composer.readBuffer`.
- A vehicle's hull colliders leave out the terrain group (`HULL_GROUPS`): the springs hold the vehicle off the ground from their rays, and hull-versus-heightfield contact made every slope snag and jolt.
- A flying hull is driven by setting its velocity every step, so a contact the solver resolves is overridden the next step and the hull wedges into whatever it hit: `flyShip` compares the velocity it commanded with what the step left (`commanded`), takes a big loss as a hit, and then leaves the body to the contacts for a few tenths of a second. The hull collider ignores the terrain heightfield (`HULL_GROUPS`), so the ground is checked by height: below it is a crash and the hull is lifted out.
- Never give the effects' render target `samples`: three resolves a multisampled target at the end of every `render()` call, and the portal renderer makes a dozen calls a frame, so bloom alone dropped the frame from 144 to 11 a second. The target is single-sampled and FXAA smooths the edges.
- The motion blur reads the frame's depth (a `DepthTexture` on the multisampled composer target, resolved after the frame) and reprojects with the last frame's camera; without a near cut-off (25 to 60 m) the ship flown, which moves with the camera, smears as much as the ground.
- A player aboard a ship's rooms has their body in that room's own Rapier world: before any world unload (travel, switching character, removing vehicles) the player must `leave()` the room, or the body is left in a freed world. `travel` carries a ship across as a `ShipCrossing` with a `ShipCrew` record (place in the hull's frame, heading, at the controls) and boards the new hull with it.
- A space zone has no snapshot: its stations are `datatables/space/spacestation/<zone>.iff` (server names; drawn as `object/ship/shared_spacestation_<faction>.iff` by a table in `space.mjs`), its asteroid fields `datatables/space/asteroidfield/<zone>.iff` (centre, radius, count, seed, a style table of appearances with likelihoods, or a spline), and its sky is its `terrain/<zone>.trn`: SKYB names the six-sided skybox (`texture/<name>_<side>.dds`, 512 px; the ENVI cube map is what reflections see, not the sky, and drawn as the sky it is a blurry, misaligned mess), CLEA the clear colour, AMBI the ambient (alpha, r, g, b), PARA each parallel light (a byte, diffuse and specular as a-r-g-b, then yaw, pitch, roll in degrees, the same frame convention as the environment file's celestials), STAR the star ramp and count, DUST the motes' count and radius, CELE each star sprite (shader, size, a spare float, a byte, yaw, pitch, roll), PLAN the planets. In space the procedural ground must not be built at all: placed objects anchor the ground to their height, which raised a needle of terrain under every asteroid, and the ground plane three kilometres down filled the lower half of the view.
- The dances are the skill loop's third branch (`loop_skill:speed2:dance_N`, N the performance table's visual id, odd novice and even full) and the flourishes `skill_action_1..8:dance_N`; `nameLocomotion` must not re-rank loop_skill's branches by speed. Emotes are the 270 `emt_` clips; the `_ag` ones are NPC ambient idles.

## Where things stand

Working: character creation and selection, planets with buildings and interiors, Jedi and Bounty Hunter combat, vehicles, ships that fly with wings that open in flight, engine glows and trails, guns from the weapon hardpoints firing the game's own bolts (the projectile and weapon tables, the bolt and hit effects, the ship's velocity carried) that hurt ships, a target with a lead reticle (Tab cycles), riders seated in each vehicle's own pose, every mount the game sold and the walkers with their own clips, pod racers with Racer-style air brakes, the game's emotes, dances and flourishes on the wheel and the number keys, bloom and a speed blur behind a setting, cockpit frames with first-person view, ship interiors as a still room with its own physics (the "gravity hull" approach), boarding, walking the rooms with their own lights and sunlight, flying a multi-crew ship from its bridge, a relay for playing together.

Known gaps and the agreed order for the next work:

1. The wing hinge's axis order (yaw, pitch, roll about the hinge's Z) is verified only on the X-wing and ARC-170; the B-wing and V-wing entries are the test, and the owner has not reported on them yet. No sound plays for the wings or the guns (the sound names are in the manifest and `projectiles.json`; there is no audio system).
2. A hull's rooms are hidden until someone boards; the proper fix is drawing them through the portal renderer with the windows as exits, so they show from outside.
3. The relay does not carry who is aboard or at the controls of what, nor bolts, so ships cannot fight each other across it; nothing but the player fires at ships yet. It carries emotes, dances and flourishes, but not a rider's pose (other players ride in the default saddle).
4. The lifts and terminals inside ship rooms are objects the server spawned, not part of the models; elevators do not work, and the Star Destroyer's bridge is behind one.
5. Space: the zones convert and fly (`space` command; stations, asteroid fields, planets in the sky, the nebula skybox), reached from the top of a planet's sky and left through the ship menu (P; E aboard a multi-crew ship is for the controls and the door). A crossing carries the local player's place in the rooms; the relay does not carry crossings, so a crew on the relay does not cross together. Not done: docking (a placeholder in the menu), landing at a station, the stations' interiors (wanted as rooms in the same zone with the ship-interior technique, a still room in the station's frame, so ships show outside and players inside), hyperspace between systems, enemies, the zone's own POIs on the map; on foot in space the player drifts with momentum (`evaUpdate`) but nothing yet needs a jetpack or a helmet; the planets' directions in the sky are read from the terrain file's PLAN forms (path, then eight floats: taken as a direction, three angles, a spare and a size) and not verified against the client.
6. The engine client data (`clientdata/ship/component/eng_*.cdf`, `GLOW` forms) carries glow sizes per engine style; their float layout is not decoded, so glows are sized by hull height.
7. Mounts carry no saddle model yet (the saddle appearances in `datatables/mount/saddle_appearance_map.iff`); the rider sits on the bare creature. God rays are not done (see the README's effects section); the motion blur is the camera's (depth reprojection) and does not smear what moves on its own against a still camera.
8. The map window (M): a planet's map is the client's `texture/ui_map_<planet>.dds` over the terrain's width (`maps` command); the space map draws the streamer's placed objects and every ship. Not done: other ships needing a ping, the space map's stations named, remote players on either. The owner reported Anakin's pod racer misbehaving; headless it accelerates and steers like the others, so the fault is something seen, not measured: ask what.

## How to work with the owner

Give them exact commands to run and exactly what to look for, one list, every item independent of the others so they can do it all in one session. When something cannot be judged from here, ask for the one observation that separates the causes rather than guessing twice. Converter changes need a reconversion (`npm run swg -- ships @SWG assets-private --retail-only` for ships; the README's table for the rest); say so every time, and say when a change needs none.
