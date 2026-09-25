#!/usr/bin/env node
// SWG asset converter. Reads a locally owned client install; never ships its output.
//
//   node tools/swg/cli.mjs verify <swg-dir>                       classify every archive against retail manifests
//   node tools/swg/cli.mjs headers <swg-dir>                      print the raw header of every archive (diagnostic)
//   node tools/swg/cli.mjs list <swg-dir> [filter]                list files across archives (search priority applied)
//   node tools/swg/cli.mjs extract <swg-dir> <path-in-archive> <out-file>
//   node tools/swg/cli.mjs dump <file.iff> | <swg-dir> <path-in-archive> [--strings] [--hex]   print an IFF tree (--strings lists every readable string in each chunk, --hex every chunk's bytes with the floats they would be)
//   node tools/swg/cli.mjs weapons <swg-dir> <out-dir> [--limit=N] [--no-icons]   every weapon the game can hold, with its class, name, hands and picture, under <out-dir>/weapons;
//                                                                  also the Force's own effects (the pt_force_ particles, the pl_force_ client effects and the beam appearances) as the manifest's `powers` block
//   node tools/swg/cli.mjs ships <swg-dir> <out-dir> [--limit=N] [--match=yacht] [--glass=<regex>]   every ship a player can fly, with its interior when it has one, under <out-dir>/ships (--match redoes those ships only; --glass=<regex> marks more shaders as glass);
//                                                                  also the game's projectile table with every bolt and hit effect as projectiles.json,
//                                                                  every component a hull's slots take and the droids as components.json, and the paint
//                                                                  recipes as customize.json (images in customize/), and the NPC ship types with
//                                                                  their tier fits, formations, taunts and hit effects as combat.json (--verbose lists its notes)
//   node tools/swg/cli.mjs species <swg-dir> <out-dir> [--only=human,twilek_female] [--var=...] [--no-moods]   every playable species and gender as parts, with characters/index.json for the character creator
//   node tools/swg/cli.mjs ash <swg-dir> <appearance/x.sat | object/.../shared_x.iff> [--find=pistol]   the animation state hierarchy behind a skeletal appearance, with its strings
//   node tools/swg/cli.mjs shader <swg-dir> <shader/x.sht>        list a shader's texture slots
//   node tools/swg/cli.mjs materials <swg-dir> <appearance-path | object/x.iff> | --ship=<id>   every shader an appearance uses, with its effect, alpha and what the converter makes of it (diagnostic)
//   node tools/swg/cli.mjs template <swg-dir> <object/x.iff>       print an object template's parameter chain
//   node tools/swg/cli.mjs texture <swg-dir> <texture/x.dds> <out.png>
//   node tools/swg/cli.mjs msh <swg-dir> <appearance-path> <out.glb>
//   node tools/swg/cli.mjs batch <swg-dir> <out-dir> [filter]     convert every .msh matching filter (default appearance/mesh/)
//   node tools/swg/cli.mjs pack <swg-dir> <spec.json> <out-dir>    build a game asset pack from a spec (see packs/)
//   node tools/swg/cli.mjs planets <swg-dir>                        list the world snapshots in the archives and where each would centre
//   node tools/swg/cli.mjs pois <swg-dir> <planet>|all <out-dir>    (re)write just pois.json and gates.json for packs converted already
//   node tools/swg/cli.mjs creatures <swg-dir> <out-dir>              every planet's creature as a skinned GLB under <out-dir>/creatures/
//   node tools/swg/cli.mjs mobiles <swg-dir> <out-dir> [--only=creatures,droids,npcs,dressed,specials] [--match=re] [--limit=N] [--skip-existing] [--core3=<dir>|none] [--max-variants=32] [--plan]
//                                                                  every creature, droid and NPC for the spawner under <out-dir>/mobiles: models, shared animation packs, catalogue.json
//   node tools/swg/cli.mjs sat <swg-dir> <x.sat | object/mobile/shared_x.iff> <out.glb> [--anim=all|idle,walk] [--var=skin_color=3,...] [--wear=object/tangible/wearables/...,...]
//   node tools/swg/cli.mjs trt <swg-dir> <x.trt> <out.png> [--var=name=value,...]   bake a texture renderer blueprint (skin, hair) to a PNG
//   node tools/swg/cli.mjs player <swg-dir> <out-dir> [--template=object/creature/player/shared_human_male.iff] [--wear=...|none] [--var=...] [--no-moods]   the player's character as <out-dir>/player/<id>.glb + manifest.json
//                                                               [--jka=<Jedi Academy GameData or base dir>] [--jka-anims=BOTH_A1_T__B_,...]  adds Jedi Academy's saber attacks, jumps and rolls, retargeted
//   node tools/swg/cli.mjs loading <swg-dir> <out-dir> [--match=ui_load] [--list]   the game's loading-screen pictures, one per planet, as <out-dir>/loading/<planet>.png
//   node tools/swg/cli.mjs wardrobe <swg-dir> <out-dir> [--gender=male|female] [--kind=wearables,hair] [--match=...] [--limit=N] [--no-icons]   every wearable and hairstyle as parts, with names, slots, species rules and pictures
//   node tools/swg/cli.mjs parts <swg-dir> <out-dir> [--template=...] [--wear=...] [--no-moods]   body, head and worn items as separate GLBs on one shared skeleton
//   node tools/swg/cli.mjs clips-save <model.glb> <out.clips> [--only=BOTH_]   lift a model's animations into a bundle that survives re-conversion
//   node tools/swg/cli.mjs clips-apply <model.glb> <in.clips> [--drop=BOTH_]   put a bundle's animations back onto a model, joints matched by name
//   node tools/swg/cli.mjs jka-clips <player.glb> <jka-dir> [--jka-anims=...]   re-import Jedi Academy's clips into a converted player GLB (no SWG archives needed)
//   node tools/swg/cli.mjs jka-extract <jka-dir> <out-dir>                 copy the humanoid skeleton and animation.cfg out of the pk3 archives
//   node tools/swg/cli.mjs gallery <swg-dir> <out-dir> [--jka=<dir>] [--only=houses,vehicles,weapons,anims,interiors] [--limit=N]
//                                                                  a flat development world under <out-dir>/gallery: every player house, vehicle and
//                                                                  weapon in rows, and every animation from both games on a grid of player models
//                                                                  (dressed in a shirt, trousers and shoes unless --wear says otherwise)
//                                                                  convert a skeletal appearance (creature, character) with skeleton and animations
//   node tools/swg/cli.mjs flora <swg-dir> <planet>|all <out-dir>   (re)convert just the flora models for packs converted already
//   node tools/swg/cli.mjs snapshot <swg-dir> <planet>|all <out-dir> [--center=x,z|auto] --radius=r|all [--max=n]
//                                                                  convert the world snapshot's objects around a point into a layout,
//                                                                  and copy the planet's terrain (.trn) plus building terrain layers (.lay);
//                                                                  the centre defaults to the planet's starport (else its busiest spot);
//                                                                  "all" converts every planet the game knows into <out-dir>/<planet>
//   node tools/swg/cli.mjs stat <swg-dir> <file>                    which archive provides a file (after load order and deletions)
//   node tools/swg/cli.mjs why <swg-dir> <planet> <pattern>         why snapshot objects matching a name do or do not convert
//   node tools/swg/cli.mjs pob <swg-dir> <file.pob>                 print a portal building's cells, portals, links and each cell's walkable floor (diagnostic)
//
//   Every command that converts a portal building (snapshot, ships, gallery, space; no other
//   command reads a floor at all) also writes the cells' walkable floors and path graphs as
//   <out-dir>/floors.json, which says in a `mesh` field which of the two shapes it is.
//   --no-floors writes none and removes one an earlier run left, so the pack really has none;
//   --floors-graph-only writes the node graphs without the triangle meshes (about a twentieth of
//   the bytes), which `status` reports as GRAPHS ONLY and asks to be run again in full, since
//   nothing can funnel a body through a doorway without the mesh. A building this run redid never
//   keeps the last run's floors, and one the pack no longer carries is dropped. A pack with no
//   floors.json plays exactly as it did before they existed.
//   node tools/swg/cli.mjs terrain <swg-dir> <planet>|all <out-dir>  copy just the terrain template and ground textures into a pack
//                                                                  ("all": into every planet pack already under <out-dir>)
//   node tools/swg/cli.mjs sky <swg-dir> <planet>|all <out-dir>      the planet's sky (sun, moons, colour ramps, skybox, reflection maps) into a pack
//                                                                  (snapshot and terrain do this too)
//   node tools/swg/cli.mjs water <swg-dir> <planet>|all <out-dir>   each planet's water shaders: colour, opacity, ripple, drift and cube map (terrain does this too)
//   node tools/swg/cli.mjs space <swg-dir> <zone>|all <out-dir>     a space zone (space_tatooine, ..., space_light1 Kessel, space_heavy1 Deep Space,
//                                                                  space_ord_mantell): its stations, asteroid fields, planets, sky and hyperspace points
//   node tools/swg/cli.mjs maps <swg-dir> <out-dir>                 the client's planet map image into every converted planet pack (map.png, map.json)
//   node tools/swg/cli.mjs navgrid <planet>|all <out-dir> [--cell=2] [--slope=47] [--skip-existing]
//                                                                  bake a world's outdoor walkability grid (nav.json, nav.bin) from the pack
//                                                                  it already has: the terrain, the placements and the models' own triangles.
//                                                                  It reads no archive, so it takes no <swg-dir>. About two minutes and three
//                                                                  megabytes for a 16 km world; without it every body outdoors steers as it
//                                                                  always did
//   node tools/swg/cli.mjs scenes <out-dir> [--places=a,b] [--quality=0.35] [--aspect=3.8] [--cull=6]
//                                                                  the small worlds the creation and selection screens stand a character in, built
//                                                                  from the planet packs already converted: only what the shot's fixed camera can
//                                                                  see, with every texture taken down to the pixels it really covers. It opens no
//                                                                  archive, so it takes no <swg-dir>, and it must run after the worlds it draws
//                                                                  from. It writes only under <out-dir>/scenes and never touches a pack
//   node tools/swg/cli.mjs clouds <out-dir> [--no-noise]           what each converted world's sky is really like, measured off the cloud sheets
//                                                                  the client drew it with (<pack>/clouds.json: how much of the sky each weather
//                                                                  row covers and how dark that cover is), and the two noise volumes the
//                                                                  volumetric march reads (<out-dir>/clouds/, 8 MB, invented and the same on
//                                                                  every world). It reads converted packs and no archive, so it takes no
//                                                                  <swg-dir>, and it must run after sky
//   node tools/swg/cli.mjs spawns <out-dir> [--core3=<dir>]        where the world's creatures and its standing people really were, and every
//                                                                  creature's own level, health and damage, read out of the owner's emulator
//                                                                  checkout (CORE3 in .env). It opens no game archive, so it takes no <swg-dir>,
//                                                                  and it must run after the worlds and after mobiles. Writes <pack>/spawns.json
//                                                                  per world and <out-dir>/spawns/manifest.json for the fleet
//   node tools/swg/cli.mjs sandbox <swg-dir> <out-dir> [--seed=N]   a made-up system to fly in, 250 km across, as <out-dir>/space_sandbox:
//                                                                  a sun and a sky borrowed from a converted zone, four to six planets with real
//                                                                  places you can fly to, asteroid fields and three jump points; nothing in it
//                                                                  is the game's, and the pack says so
//                                                                  as <out-dir>/<zone>, a pack the game flies through
//   node tools/swg/cli.mjs audit <swg-dir> <out-dir> [planet] [--limit=n]   every object the archives place on each converted planet against its pack:
//                                                                  what is missing, why (skipped kind, creature, older conversion), and where;
//                                                                  also written to <out-dir>/audit.txt
//   node tools/swg/cli.mjs extras <swg-dir>                       what the archives outside the retail manifests add or replace, by category
//                                                                  (a listing only; nothing from them is converted)
//   node tools/swg/cli.mjs sounds <swg-dir> <out-dir> [planet|all] [--only=<text>] [--no-samples] [--jka=<dir>]
//                                                                  every sound the game can play, the samples they name, and where each one is
//                                                                  used, as <out-dir>/sounds; a planet (or all) also writes that planet's own
//                                                                  placed emitters, room beds and surfaces as <out-dir>/<planet>/sounds.json;
//                                                                  --jka also takes Jedi Academy's saber sounds and the frames its animations
//                                                                  mark, from its GameData folder; the ships pack, where it is converted, also
//                                                                  gets its hulls', parts' and vehicles' own sounds as <out-dir>/sounds/ships.json
//   node tools/swg/cli.mjs convert [out-dir] [--swg=<dir>] [--jka=<dir>] [--only=<command>,...] [--jobs=N] [--dry-run] [--yes]
//                                                                  the whole conversion in one command: it asks status what is missing, runs
//                                                                  exactly that in the order the converter needs, several steps at once, and
//                                                                  asks again until nothing is; stop it and run it again to carry on.
//                                                                  <out-dir> is assets-private unless another is named, the two installs are
//                                                                  found without a .env, and every step runs with --retail-only
//   node tools/swg/cli.mjs status <out-dir> [--json]               what the packs under <out-dir> hold and which commands would fill the gaps
//                                                                  (--json: the same as steps in order, arguments split, for the launcher)
//   node tools/swg/cli.mjs terrain-check <out-dir> [--limit=n] [--layers] [--at=x,z]
//                                                                  generate terrain at every snapshot object and compare with its height;
//                                                                  --layers lists every layer, --at prints the height at one point
//
// Paths: a .env file beside package.json can name the folders once (SWG=..., JKA=..., CORE3=...); any
//        argument or flag value written @SWG, @JKA, @CORE3 (any @NAME) is replaced by that value, from
//        .env or the environment, so paths with spaces need no quoting in any shell.
// Flags: --retail-only (mount only archives named in the retail manifests)
//        --events (place buildout areas that the game only shows during an event; planets lists them)
//        --areas (why: list every buildout area with its rows, unknown templates and extent)
//        --ws-add=<archive>@x1,z1,x2,z2 (snapshot, why, audit: also place what an older publish's world snapshot in that
//                       archive put inside the rectangle; stat <file> --all lists every archive carrying a file)
//        --near=x,z,r (why: only objects within r metres of x,z; the pattern "." matches everything)
//        --core3=<dir> (SWGEmu's MMOCoreORB/bin/scripts: place the static objects its screenplays spawn,
//                       and write the creature and NPC spawns to <pack>/spawns.json; or set CORE3 in the environment)
//        --no-flip (keep left-handed coordinates)  --no-textures (skip DDS decoding)
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { resolveParts } from './appearance.mjs';
import { decodeDds } from './dds.mjs';
import { FLOOR_PACK_VERSION, floorBlock, floorSize, parseFloor } from './flr.mjs';
import { GOAL_SNAP, NAV_GRID_VERSION, SLOPE_CLIMB_DEGREES, buildNavGrid, writeNavGrid } from './navgrid.mjs';
import { buildGlb } from './glb.mjs';
import { dump, find, isForm, parseIff, readCString } from './iff.mjs';
import { classifyDirectory, isRetailByName } from './manifest.mjs';
import { parseMesh } from './msh.mjs';
import { buildPack, familyOf } from './pack.mjs';
import { parseSnapshot, flattenWithWorldTransforms } from './ws.mjs';
import { loadBuildouts, mergeBuildouts } from './buildout.mjs';
import { R, composeMeshes, mergeSkeletons, parseAnimation, parseLat, parseLmg, parseMgn, parseSat, parseSkeleton, poseAtFrame, readIff, skinData, skinnedPrimitives } from './skeletal.mjs';
import { resolveAppearanceToMesh, resolveTemplateMesh, resolveTemplateString } from './objtemplate.mjs';
import { exportParticle, parseParticleEffect } from './particle.mjs';
import { defaultJkaClips, importJkaClips } from './jka.mjs';
import { extractClips, readGlb, replaceClips, skinJoints } from './glbclips.mjs';
import { packClips, retargetClips, unpackClips } from './clipbundle.mjs';
import { encodePng } from './png.mjs';
import { describeItem, itemPackStatus, newItemCaches, parseSlotDescriptor, readAppearanceTable, speciesColumn, wardrobeChoice, wardrobeFit, PLAYER_SLOTS } from './items.mjs';
import { iconMeshes, renderThumbnail, thumbTexture } from './thumbnail.mjs';
import { effectAlphaMode, shaderTextures } from './sht.mjs';
import { bakeShader, describeShader, describeVariables, loadImage, loadShader, parseBlueprint, parsePalette, preparedShaders, renderBlueprint, renderContext, shaderNeedsBake } from './texrender.mjs';
import { ImageRegistry, exportBlueprint, exportPalettes, exportShader, palettesOf } from './customize.mjs';
import { effectAlpha, alphaModeFor } from './eff.mjs';
import { MATERIAL_FORMAT, describeLines, describeSurface, surfaceCounts, surfaceCountsLine, surfaceLine, surfaceTexture } from './surface.mjs';
import { localize, parseDatatable, parseStringTable } from './datatable.mjs';
import { galaxyData, galaxyStatus, SPACE_PACK_VERSION, SPACE_ZONES, spaceZoneStatus } from './space.mjs';
import { SANDBOX_ZONE, buildSandbox, pickSkyZone, sandboxStatus } from './sandbox.mjs';
import { mountCreatures, riderPoseFor } from './mounts.mjs';
import { pickSaddleHardpoint, saddleEntry, saddleStatus, satHardpoints } from './saddles.mjs';
import { assembleShip, assemblyStatus, clientChildren, expandPart, partFamilyOf, SHIP_ASSEMBLY_FORMAT } from './shipparts.mjs';
import {
  buildDroids, buildSlots, chassisNameFor, componentKey, componentList, droidHeadRows, fitStatus, hullTokens, isPaintShader, loadoutsLine, mergePaintVariables,
  mergeRecipes, modalLooks, paintedMainImage, paintGlow, pickStock, recipeImages, SHIP_FIT_FORMAT, stockPairs, stockWeapon, trimPaintShader, wingOpenSpeedFactorOf,
} from './shipfit.mjs';
import { buildCombat, combatCounts, combatLine, combatStatus, FORMATIONS, TAUNT_TABLES } from './npcships.mjs';
import { resolveTemplateParam } from './objtemplate.mjs';
import { setStringId } from './items.mjs';
import * as M from './mobiles.mjs';
import * as MS from './mobilescan.mjs';
import { finestLevelWithGeometry } from './lmglevel.mjs';
import { createRequire } from 'node:module';

/** Named places per planet (see regions/build.mjs). */
const REGIONS = createRequire(import.meta.url)('./regions/regions.json');
import { frameCheck, mergePlaceLists, placeKey, portLabel, readClientPlaces, title } from './places.mjs';
import { isZoneGate, writeZoneGates } from './gates.mjs';
import { decodeTga, encodeHeightmap } from './tga.mjs';
import { exportSky } from './sky.mjs';
import { exportWater, readWaterHarm, waterHarmLines, waterPackNeedsHarm } from './water.mjs';
import { convertSounds, soundStatus } from './sound.mjs';
import { convertSoundPlaces, placesStatus } from './soundplaces.mjs';
import { clipEventStatus, convertClipEvents } from './clipevents.mjs';
import { convertJkaSounds, jkaSoundStatus } from './jkasound.mjs';
import { convertShipSounds, shipSoundStatus } from './shipsounds.mjs';
import { extraEffectsStatus, forcePowersStatus } from './weapons.mjs';
import { nameLocomotion } from './clipnames.mjs';
import { moodEntries } from './moods.mjs';
import { core3MobileStats, scanServerSpawns } from './spawns.mjs';
import { loadEffect } from './texrender.mjs';
import { readTemplate, stringParam } from './objtemplate.mjs';
import { statusJson } from './statusplan.mjs';
import { openTre, openVfs, readHeader } from './tre.mjs';

// A .env beside package.json names the folders once; @NAME anywhere in the arguments becomes that
// variable's value (from .env or the environment), whichever shell is running.
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
const expandEnv = (a) =>
  a.replace(/(^|=)@([A-Za-z_][A-Za-z0-9_]*)$/g, (whole, before, name) => {
    const value = process.env[name];
    if (value === undefined) {
      console.error(`@${name}: not set; put ${name}=<path> in .env beside package.json (see .env.example), or in the environment`);
      process.exit(1);
    }
    return before + value;
  });
const args = process.argv.slice(2).map(expandEnv);
const flags = new Set(args.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]));
const options = Object.fromEntries(args.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => a.slice(2).split('=')));
const pos = args.filter((a) => !a.startsWith('--'));
const cmd = pos[0];

function usage() {
  const src = readFileSync(new URL(import.meta.url)).toString().split('\n');
  console.log(src.filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(1);
}

function mount(dir) {
  const retailOnly = flags.has('--retail-only');
  const vfs = openVfs(dir, {
    filter: retailOnly ? (f) => isRetailByName(f, statSync(join(dir, f)).size) !== null : undefined,
  });
  console.error(`mounted ${vfs.summary}${retailOnly ? ' (retail only)' : ''}`);
  return vfs;
}

const textureCache = new Map();
const effectCache = new Map();
const effectUse = new Map();

/**
 * Whether texture entries carry a reduced copy of their picture for the item icons (`thumb`, not
 * enumerable, so no JSON or GLB writer sees it; tools/swg/thumbnail.mjs). Only the weapons and
 * wardrobe commands draw icons and set it, so the snapshot, gallery and ships runs make none.
 */
let wantThumbs = false;

/** Alpha mode from the effect file's first pass; falls back to the name heuristic. */
function alphaFromEffect(vfs, effect, fallback) {
  if (!effect) return fallback;
  if (!effectCache.has(effect)) {
    let mode = fallback;
    try {
      if (vfs.has(effect)) mode = alphaModeFor(effectAlpha(parseIff(vfs.read(effect))), effect);
    } catch (err) {
      console.error(`  effect ${effect} unreadable: ${err.message}`);
    }
    effectCache.set(effect, mode);
  }
  const mode = effectCache.get(effect);
  const key = `${effect} -> ${mode}`;
  effectUse.set(key, (effectUse.get(key) ?? 0) + 1);
  return mode;
}

function printEffectSummary() {
  if (!effectUse.size) return;
  console.log('effects used:');
  for (const [k, n] of [...effectUse.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
}

/**
 * What names a glass shader (its own name or its texture's): a window, a canopy, a viewport.
 * The game draws these as their effect says, opaque and reflective for a hull's windows (the
 * outside shows through a room's invisible pane and the hull's single-sided window seen from
 * behind), so they are only marked: the runtime lets the sun through them and clears them while
 * someone is aboard. "cockpit" is not glass: it names the panels around the pilot as often as
 * the canopy. --glass=<regex> marks more shaders for a ship whose windows are named otherwise.
 */
const GLASS_NAMED = new RegExp(options.glass ? `glass|window|windshield|canopy|transparen|viewport|pane|${options.glass}` : 'glass|window|windshield|canopy|transparen|viewport|pane', 'i');

/** What surface.mjs has read of each shader (and its effects' passes and programs), for this run. */
const surfaceCache = new Map();
/** The texture entries of the pack a snapshot is converting, for its `surfaces:` line; null otherwise. */
let surfaceUse = null;

/** What surfaceTexture needs from this file: the effect and gloss readers, the normal maps, the log. */
function surfaceDeps(vfs) {
  return {
    cache: surfaceCache,
    decodeDds,
    encodePng,
    alphaFromEffect: (effect, fallback) => alphaFromEffect(vfs, effect, fallback),
    surfaceFor: (effect, slots, dds, alphaMode, opts) => surfaceFor(vfs, effect, slots, dds, alphaMode, opts),
    normalFor: (path) => normalFor(vfs, path),
    // Glass by name is drawn as its effect says (a name told nothing about transparency: a
    // fuselage texture called cockpit blended at a fixed share looked like a ghost ship), only
    // marked so the runtime lets the sun through it and clears it while someone is aboard.
    glassNamed: GLASS_NAMED,
    byName: effectAlphaMode,
    log: (message) => console.error(`  ${message}`),
  };
}

/**
 * What the paint shaders load through: their static shaders, effects, palettes and the images their
 * default patterns bind, with no customization values, so each is read at the shader's own defaults.
 * The ships command's recipes load through it too.
 */
const paintContext = renderContext();

const customizableCache = new Map();
/**
 * Whether a shader file is a customizable one (FORM CSHD), read from its top form alone, so that only
 * those are loaded into paintContext, which keeps every image it loads for the whole run.
 */
function isCustomizableShader(vfs, shaderPath) {
  const file = shaderPath.replace(/\\/g, '/');
  if (!customizableCache.has(file)) {
    let yes = false;
    try {
      yes = vfs.has(file) && parseIff(vfs.read(file)).type === 'CSHD';
    } catch {
      yes = false;
    }
    customizableCache.set(file, yes);
  }
  return customizableCache.get(file);
}

/**
 * A ship paint shader (a customizable shader, shipfit.mjs isPaintShader) baked at its defaults, every
 * pass (the colours are passes two and three, which a first-pass check misses), as the main image
 * surfaceTexture takes in place of the shader's own texture: the bake's colour with the chosen pattern's
 * own alpha (its gloss mask, and a MAIN-alpha glow's mask, as the game's repaint reads them; the bake's
 * alpha is the first pass's, opaque), named for the chosen pattern's MAIN and the shader, since two
 * paint shaders on one pattern differ by their colours (shipfit.mjs paintedMainImage). Null for anything else.
 */
function paintedMain(vfs, shaderPath) {
  if (!isCustomizableShader(vfs, shaderPath)) return null;
  let shader = null;
  try {
    shader = loadShader(vfs, shaderPath, paintContext);
  } catch (err) {
    console.error(`  paint ${shaderPath} unreadable: ${err.message}`);
    return null;
  }
  return paintedMainImage(shader, shaderPath, bakeShader);
}

/**
 * A shader's texture entry (surface.mjs `surfaceTexture`): the main image and its alpha mode as
 * before, plus flip-book frames, scroll rates, split alpha, the unlit and additive flags and the
 * lit and glow images of a glowing texture. An invisible collidable surface (the pane in a room's
 * window opening, a rail you cannot cross) is drawn as nothing and kept for its colliders.
 * With `opts.paint` (the ships command), a paint shader's main image is its bake at its defaults.
 */
function textureFor(vfs, shaderPath, opts = {}) {
  if (flags.has('--no-textures')) return null;
  const key = `${shaderPath}${opts.paint ? '|paint' : ''}`;
  let result = null;
  if (textureCache.has(key)) result = textureCache.get(key);
  else {
    try {
      result = surfaceTexture(vfs, shaderPath, { ...surfaceDeps(vfs), thumb: wantThumbs ? thumbTexture : undefined, mainImage: opts.paint ? (p) => paintedMain(vfs, p) : undefined });
    } catch (err) {
      console.error(`  texture for ${shaderPath} skipped: ${err.message}`);
    }
    textureCache.set(key, result);
  }
  return result;
}

const normalCache = new Map();

/**
 * A shader's normal map as tangent-space RGB. The game's compressed normal maps ("cn"
 * textures, the CNRM slot) keep x in the alpha and y in the green channel with z left to be
 * rebuilt, told from an ordinary RGB map by the alpha carrying the detail and the red none.
 * The channels go into the GLB exactly as the game has them; which way up the green is read is the
 * game's own business and not the converter's (`__debug.normals`), so nothing here changes with it.
 */
function normalFor(vfs, file) {
  const key = file.replace(/\\/g, '/').toLowerCase();
  if (normalCache.has(key)) return normalCache.get(key);
  let out = null;
  try {
    if (vfs.has(key)) {
      const dds = decodeDds(vfs.read(key));
      const n = dds.width * dds.height;
      const src = dds.rgba;
      let sumA = 0, sumR = 0, sqA = 0, sqR = 0, count = 0;
      const step = Math.max(1, Math.floor(n / 4096));
      for (let i = 0; i < n; i += step) {
        const r8 = src[i * 4], a8 = src[i * 4 + 3];
        sumR += r8; sqR += r8 * r8; sumA += a8; sqA += a8 * a8; count++;
      }
      const varA = sqA / count - (sumA / count) ** 2;
      const varR = sqR / count - (sumR / count) ** 2;
      const swizzled = varA > 4 && varA > varR * 4;
      const rgba = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        const x = (swizzled ? src[i * 4 + 3] : src[i * 4]) / 127.5 - 1;
        const y = src[i * 4 + 1] / 127.5 - 1;
        const z = swizzled ? Math.sqrt(Math.max(0, 1 - x * x - y * y)) : src[i * 4 + 2] / 127.5 - 1;
        rgba[i * 4] = Math.round((x * 0.5 + 0.5) * 255);
        rgba[i * 4 + 1] = Math.round((y * 0.5 + 0.5) * 255);
        rgba[i * 4 + 2] = Math.round((z * 0.5 + 0.5) * 255);
        rgba[i * 4 + 3] = 255;
      }
      out = { path: key, png: encodePng(dds.width, dds.height, rgba), swizzled };
    }
  } catch (err) {
    console.error(`  normal map ${file} skipped: ${err.message}`);
  }
  normalCache.set(key, out);
  return out;
}

const surfaceEffects = new Map();

/**
 * How shiny a shader's surface is, from its effect and texture slots. The game keeps the
 * specular and reflection mask in the alpha channel of the diffuse map (when the effect does
 * not use alpha for transparency): bright alpha means glossy metal or glass. Reflective
 * shaders carry an environment cube map (slot ENVM) that the scene's own environment replaces.
 * Returns glTF metallic/roughness factors and, where a mask exists, a metallicRoughness image.
 */
function surfaceFor(vfs, effect, slots, dds, alphaMode, { alphaIsEmissive = false } = {}) {
  const name = (effect ?? '').toLowerCase();
  let tags = surfaceEffects.get(name);
  if (!tags) {
    tags = new Set();
    try {
      const eff = effect ? loadEffect(vfs, effect.replace(/\\/g, '/')) : null;
      for (const pass of eff?.passes ?? []) for (const st of pass.stageList ?? []) if (st.textureTag) tags.add(st.textureTag);
    } catch {
      /* effects the renderer cannot parse just get no shine */
    }
    surfaceEffects.set(name, tags);
  }
  const slotTags = new Set((slots ?? []).map((s) => s.slot));
  const reflective = slotTags.has('ENVM') || tags.has('ENVM') || /env|chrome|mirror|refl/.test(name);
  const specular = reflective || slotTags.has('SPEC') || tags.has('SPEC') || /spec|gloss|shin|metal|glass/.test(name);
  if (!specular) return {};
  // A glowing texture's alpha is its glow mask, not a gloss mask.
  const masked = dds.hasAlpha && alphaMode === 'OPAQUE' && !alphaIsEmissive;
  if (!masked) return { metallic: reflective ? 0.6 : 0, roughness: reflective ? 0.3 : 0.45 };
  // Roughness in green, metalness in blue, both from the mask.
  const mr = new Uint8Array(dds.width * dds.height * 4);
  for (let i = 0; i < dds.width * dds.height; i++) {
    const a = dds.rgba[i * 4 + 3];
    mr[i * 4] = 0;
    mr[i * 4 + 1] = 255 - Math.round(a * 0.85);
    mr[i * 4 + 2] = reflective ? a : 0;
    mr[i * 4 + 3] = 255;
  }
  return { metallic: 1, roughness: 1, mr: { png: encodePng(dds.width, dds.height, mr) } };
}

/** Apply a row-major 3x4 transform to a parsed mesh's positions and normals in place. */
function transformMesh(mesh, m) {
  for (const g of mesh.groups) {
    for (const p of g.primitives) {
      const pos = p.positions;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        pos[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
        pos[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
        pos[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
      }
      const nrm = p.normals;
      if (nrm) {
        for (let i = 0; i < nrm.length; i += 3) {
          const x = nrm[i], y = nrm[i + 1], z = nrm[i + 2];
          nrm[i] = m[0] * x + m[1] * y + m[2] * z;
          nrm[i + 1] = m[4] * x + m[5] * y + m[6] * z;
          nrm[i + 2] = m[8] * x + m[9] * y + m[10] * z;
        }
      }
    }
  }
  mesh.bounds = null;
  for (const hp of mesh.hardpoints) {
    const [x, y, z] = hp.position;
    hp.position = [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
  }
}

function boundsFromPositions(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const g of mesh.groups) for (const p of g.primitives) {
    for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p.positions[i + k]);
      max[k] = Math.max(max[k], p.positions[i + k]);
    }
  }
  return { min, max };
}

/** Load an appearance as one merged mesh: component parts are baked by their transforms. */
/**
 * Load every mesh part of an appearance into one merged mesh. Portal buildings keep their
 * cells apart in `cells` (exterior first) so the game can hide the shell from inside.
 */
function loadAppearanceMesh(vfs, appearancePath) {
  const parts = resolveParts(vfs, appearancePath);
  const merged = { version: '', groups: [], hardpoints: [], bounds: null, warnings: [] };
  const cells = new Map();
  const effects = [];
  let portalGeometry = null;
  for (const part of parts) {
    if (part.particle) {
      // A particle effect among the parts (a lamp's flame, a fountain's spray): kept with its
      // transform for the runtime to play at every placed copy of the model.
      effects.push({ particle: part.particle, transform: part.transform ?? null, ...(part.cell !== undefined ? { cell: part.cell } : {}) });
      continue;
    }
    const mesh = parseMesh(parseIff(vfs.read(part.mesh)));
    if (part.transform) transformMesh(mesh, part.transform);
    // The appearance chain's own hardpoints (a .lod's, a .cmp's) ride on the part, already in its frame.
    if (part.hardpoints?.length) mesh.hardpoints.push(...part.hardpoints);
    merged.groups.push(...mesh.groups);
    merged.hardpoints.push(...mesh.hardpoints);
    merged.warnings.push(...mesh.warnings);
    if (parts.length === 1) merged.bounds = mesh.bounds;
    if (part.cell !== undefined) {
      const cell = cells.get(part.cell) ?? cells.set(part.cell, { index: part.cell, name: part.cellName, groups: [], hardpoints: [], warnings: [], portals: part.cellPortals ?? [], lights: part.cellLights ?? [], floor: part.cellFloor ?? '' }).get(part.cell);
      cell.groups.push(...mesh.groups);
      cell.hardpoints.push(...mesh.hardpoints);
      portalGeometry ??= part.portalGeometry ?? null;
    }
  }
  if (!merged.groups.length) throw new Error(`${appearancePath}: no mesh parts (${effects.length} particle effects only)`);
  if (!merged.bounds) merged.bounds = boundsFromPositions(merged);
  const cellList = [...cells.values()].sort((a, b) => a.index - b.index);
  for (const c of cellList) c.bounds = boundsFromPositions(c);
  const meshParts = parts.length - effects.length;
  return { mesh: merged, meshPath: meshParts === 1 ? parts.find((p) => p.mesh).mesh : appearancePath, partCount: meshParts, cells: cellList.length > 1 ? cellList : null, portalGeometry, effects };
}

/** `opts.paint`: paint shaders are baked at their defaults (textureFor), for the ships command. */
function convertOne(vfs, appearancePath, outFile, opts = {}) {
  const { mesh, meshPath, partCount, cells, portalGeometry, effects } = loadAppearanceMesh(vfs, appearancePath);
  const textures = new Map();
  for (const g of mesh.groups) {
    const t = textureFor(vfs, g.shader, opts);
    if (t) textures.set(g.shader, t);
    if (t && surfaceUse) surfaceUse.add(t);
  }
  const flipX = !flags.has('--no-flip');
  const baseName = basename(meshPath).replace(/\.[^.]+$/, '');
  // One GLB node per portal cell ("cell:<index>:<name>"), or a single node for plain appearances.
  const meshes = cells ? cells.map((c) => ({ name: `cell:${c.index}:${c.name}`, groups: c.groups, hardpoints: c.hardpoints, bounds: c.bounds })) : [{ name: baseName, ...mesh }];
  const glb = buildGlb(meshes, { flipX, textures });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, glb);
  const tris = mesh.groups.reduce((n, g) => n + g.primitives.reduce((m, p) => m + p.indices.length / 3, 0), 0);
  const shaders = [...new Set(mesh.groups.map((g) => g.shader))];
  const flipBounds = (b) => (flipX && b ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b);
  const flipVec = (v) => (flipX ? [-v[0], v[1], v[2]] : v);
  const cellInfo = cells
    ? cells.map((c) => ({
        index: c.index,
        name: c.name,
        bounds: flipBounds(c.bounds),
        portals: c.portals.map((p) => ({ geometry: p.geometry, target: p.target, passable: p.passable && !p.disabled })),
        ...(c.lights?.length ? { lights: c.lights.map((l) => ({ type: l.type, color: l.color.map((v) => Math.round(v * 1000) / 1000), position: flipVec(l.position).map((v) => Math.round(v * 100) / 100), direction: flipVec(l.direction).map((v) => Math.round(v * 1000) / 1000), attenuation: l.attenuation.map((v) => Math.round(v * 10000) / 10000) })) } : {}),
      }))
    : undefined;
  // Portal polygons in model space (X flipped with the meshes) so the game can tell which cell the player is in.
  const portals = portalGeometry ? portalGeometry.map((p) => ({ v: p.verts.map(([x, y, z]) => [flipX ? -x : x, y, z]), i: p.indices })) : undefined;
  // The cells' walkable floors, into the pack's floors.json rather than the manifest: the manifests
  // are written indented, and a floor is thousands of plain numbers.
  if (cells) noteFloors(vfs, dirname(outFile), basename(outFile).replace(/\.glb$/i, ''), cells, flipX);
  return { meshPath, mesh, flipX, tris, shaders, textured: textures.size, warnings: mesh.warnings, partCount, cells: cellInfo, portals, effects };
}

// The floors a portal building's cells walk on, gathered per pack and written beside the manifest
// as floors.json rather than into it: the manifests are written indented, and one number a line
// would turn a planet's floors from three megabytes into thirty. Keyed by pack for the same reason
// the particle caches are: a run over several planets must not leave one planet's floors in
// another planet's file. `--no-floors` leaves the file out altogether and `--floors-graph-only`
// writes the node graphs without the triangle meshes, which is about a twentieth of the bytes.
const packFloors = new Map(); // resolve(outDir) -> { stats, seen: Set(id), models: Map(id -> { cellIndex: block }) }

// The commands that carry floors into a pack, which is exactly the four that write floors.json.
// Anything else converting a portal building -- `why` and `msh` into a temporary file, `pack` and
// `sandbox`, whose manifests keep no cells at all -- would otherwise fetch and parse every cell's
// floor out of the archives and drop the lot without a word.
const FLOOR_COMMANDS = new Set(['snapshot', 'ships', 'gallery', 'space']);

function floorsFor(outDir) {
  const key = resolve(outDir);
  let rec = packFloors.get(key);
  if (!rec) packFloors.set(key, (rec = { models: new Map(), seen: new Set(), stats: { cells: 0, named: 0, read: 0, missing: 0, failed: 0, older: 0, meshes: 0, graphs: 0, vertices: 0, triangles: 0, nodes: 0, edges: 0, notes: [] } }));
  return rec;
}

/**
 * One cell's floor. Deliberately not cached: the whole game holds 3,332 cell floors in 3,266
 * distinct files, so a cache would save 66 reads and hold a few hundred megabytes of parsed
 * triangles for the length of a run over every planet. Reading and converting every floor in the
 * archives takes 423 ms measured, so there is nothing to save.
 */
function readFloor(vfs, path) {
  if (!vfs.has(path)) return { missing: true };
  try {
    return parseFloor(parseIff(vfs.read(path)));
  } catch (err) {
    return { failed: err.message };
  }
}

/**
 * The floors of one converted portal building, into the pack's record. `cells` is what convertOne
 * built for the manifest, each carrying the .flr its cell named.
 */
function noteFloors(vfs, outDir, id, cells, flipX) {
  if (flags.has('--no-floors') || !cells || !FLOOR_COMMANDS.has(cmd)) return;
  const rec = floorsFor(outDir);
  // Recorded whether or not a floor comes of it, for two reasons: a building this run redid must
  // never keep the floors of the run before it (its cells and their indices may have moved), and a
  // building whose cells name no floor, or name one the archives have not got, is a building that
  // was read and has none -- which is not the same as one nobody has looked at, and is what the
  // pack and `status` would otherwise have no way of saying.
  rec.seen.add(id);
  const mesh = !flags.has('--floors-graph-only');
  const out = {};
  for (const c of cells) {
    rec.stats.cells++;
    if (!c.floor) continue;
    rec.stats.named++;
    const floor = readFloor(vfs, c.floor);
    if (floor.missing) {
      rec.stats.missing++;
      continue;
    }
    if (floor.failed) {
      rec.stats.failed++;
      if (rec.stats.notes.length < 8) rec.stats.notes.push(`cell ${c.index} of ${id}: ${floor.failed}`);
      continue;
    }
    rec.stats.read++;
    if (floor.version !== '0006') rec.stats.older++;
    for (const w of floor.warnings) if (rec.stats.notes.length < 8) rec.stats.notes.push(`cell ${c.index} of ${id}: ${w}`);
    const { block, notes } = floorBlock(floor, { flipX, links: c.portals ?? [], mesh });
    for (const nte of notes) if (rec.stats.notes.length < 8) rec.stats.notes.push(`cell ${c.index} of ${id}: ${nte}`);
    if (!block.floor && !block.graph) continue;
    const size = floorSize(floor);
    if (block.floor) {
      rec.stats.meshes++;
      rec.stats.vertices += size.vertices;
      rec.stats.triangles += size.triangles;
    }
    if (block.graph) {
      rec.stats.graphs++;
      rec.stats.nodes += size.nodes;
      rec.stats.edges += size.edges;
    }
    out[c.index] = block;
  }
  rec.models.set(id, out);
}

/**
 * Write the pack's floors.json and say what went in.
 *
 * `keep` is the ids the pack's manifest now carries, which the caller has just written. Only three
 * kinds of entry survive from the file already on disk: one for a building this run did not touch,
 * that the pack still carries, and that the last run wrote in the same shape. That matters because
 * floors.json is the one snapshot artefact that is not rewritten outright: without the first test a
 * building whose floors came back missing this run would go on publishing the last run's, cell
 * indices and all; without the second a `--retail-only` run would leave the floors a non-retail run
 * read for buildings the retail archives do not hold; and without the third a `--floors-graph-only`
 * run would leave a file that is half meshes and half not, which no line of the run could describe.
 *
 * `--no-floors` means the pack is to have none, so a file an earlier run left is removed rather
 * than left to be served. A run that converted no portal building at all makes no claim and leaves
 * the file exactly as it found it.
 */
function writeFloors(outDir, keep = null) {
  const key = resolve(outDir);
  const rec = packFloors.get(key);
  packFloors.delete(key);
  const file = join(outDir, 'floors.json');
  if (flags.has('--no-floors')) {
    if (existsSync(file)) {
      rmSync(file);
      console.log(`floors: --no-floors, so the floors.json an earlier run left was removed (${file})`);
    }
    return;
  }
  if (!rec) return;
  const mesh = !flags.has('--floors-graph-only');
  const keepIds = keep ? new Set(keep) : null;
  let models = {};
  let kept = 0;
  let gone = 0;
  let reshaped = 0;
  try {
    if (existsSync(file)) {
      const old = JSON.parse(readFileSync(file, 'utf8'));
      if (old && old.version === FLOOR_PACK_VERSION && old.models) {
        const sameShape = (old.mesh ?? true) === mesh;
        for (const [id, cells] of Object.entries(old.models)) {
          if (rec.seen.has(id)) continue;
          if (keepIds && !keepIds.has(id)) {
            gone++;
            continue;
          }
          if (!sameShape) {
            reshaped++;
            continue;
          }
          models[id] = cells;
          kept++;
        }
      }
    }
  } catch (err) {
    console.log(`   the last floors.json could not be read (${err.message}); writing only this run's`);
    models = {};
    kept = 0;
  }
  for (const [id, cells] of rec.models) models[id] = cells;
  const s = rec.stats;
  if (!Object.keys(models).length) {
    if (existsSync(file)) rmSync(file);
    console.log(`floors: none written (${s.cells} cells, ${s.named} naming a floor, ${s.missing} not in the archives, ${s.failed} unreadable)`);
    return;
  }
  // `mesh` says which shape the file is, since a graph without the mesh it funnels over is a pack
  // that looks complete and cannot path: `status` reads it and asks for the full run.
  writeFileSync(file, JSON.stringify({ version: FLOOR_PACK_VERSION, mesh, models }));
  const empty = [...rec.models.values()].filter((m) => !Object.keys(m).length).length;
  const kb = (statSync(file).size / 1024).toFixed(0);
  const asides = [
    s.missing ? `${s.missing} named but not in the archives` : '',
    s.failed ? `${s.failed} unreadable` : '',
    s.older ? `${s.older} in an older version of the format` : '',
    empty ? `${empty} building(s) with no cell floor at all` : '',
    kept ? `${kept} building(s) kept from the last run` : '',
    gone ? `${gone} dropped as no longer in the pack` : '',
    reshaped ? `${reshaped} dropped: the last run wrote ${mesh ? 'graphs only' : 'meshes'}` : '',
  ].filter(Boolean);
  console.log(`floors: ${s.read} of ${s.named} cell floors read over ${rec.models.size} buildings (${s.cells} cells in all${asides.length ? `; ${asides.join(', ')}` : ''})`);
  console.log(`   ${mesh ? `${s.meshes} walkable meshes (${s.vertices} vertices, ${s.triangles} triangles), ` : 'GRAPHS ONLY (--floors-graph-only: no walkable meshes, so nothing can funnel through a doorway), '}${s.graphs} path graphs (${s.nodes} nodes, ${s.edges} edges) -> ${file}, ${kb} KB`);
  for (const n of s.notes) console.log(`   note: ${n}`);
}

// Particle effects: converted once per .prt into <out-dir>/particles/, textures shared within one
// pack. Keying by pack matters: a run over several planets used to write a later planet's manifest
// entries without its files, because the first planet's conversion had already cached the effect.
const particleTextures = new Map(); // resolve(outDir) -> Map(shader -> entry)
const particleEffects = new Map(); // `${resolve(outDir)}|${prt}` -> entry

/** How many particle effects this run converted (or failed) into one pack. */
function particleCountFor(outDir) {
  const prefix = `${resolve(outDir)}|`;
  let n = 0;
  for (const k of particleEffects.keys()) if (k.startsWith(prefix)) n++;
  return n;
}

/** The first fixed-function pass of a shader's effect, for its blend mode. */
function passFor(vfs, shaderPath) {
  try {
    const { effect } = shaderTextures(parseIff(vfs.read(shaderPath)));
    const eff = effect ? loadEffect(vfs, effect.replace(/\\/g, '/')) : null;
    return eff?.passes?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Convert a particle effect into the pack (cached per file); returns its manifest entry or { failed }. */
function convertParticle(vfs, prtPath, outDir) {
  const pack = resolve(outDir);
  const key = `${pack}|${prtPath.toLowerCase()}`;
  let entry = particleEffects.get(key);
  if (entry) return entry;
  if (!particleTextures.has(pack)) particleTextures.set(pack, new Map());
  // A placeholder while this one converts: an effect that carries itself, however far down its
  // attachments, gets the placeholder back instead of recursing for ever.
  particleEffects.set(key, { pending: true });
  try {
    entry = exportParticle(vfs, prtPath, outDir, {
      textureFor: (shader) => textureFor(vfs, shader),
      passFor: (shader) => passFor(vfs, shader),
      textures: particleTextures.get(pack),
      // The effects its particles carry, converted into the same pack and cached like any other.
      attach: (p) => convertParticle(vfs, p.replace(/\\/g, '/'), outDir),
      write: (file, bytes) => {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, bytes);
      },
      log: (m) => console.error(m),
    });
    console.error(`  ${entry.id}: particle effect, ${entry.quads} quad emitter(s)${entry.meshes ? `, ${entry.meshes} mesh emitter(s) (not drawn yet)` : ''}${entry.attached ? `, ${entry.attached} carried effect(s)` : ''}${entry.missingTextures.length ? `, textures missing: ${entry.missingTextures.join(', ')}` : ''}`);
  } catch (err) {
    entry = { failed: err.message };
  }
  particleEffects.set(key, entry);
  return entry;
}

/** Attached effects of a converted model, as the manifest stores them (transforms in the model's unflipped space). */
function attachedEffects(vfs, effects, outDir) {
  const out = [];
  for (const e of effects ?? []) {
    const p = convertParticle(vfs, e.particle, outDir);
    if (p.failed) {
      console.error(`  attached effect ${e.particle} skipped: ${p.failed}`);
      continue;
    }
    out.push({ file: p.file, id: p.id, ...(e.transform ? { transform: e.transform.map((v) => Math.round(v * 10000) / 10000) } : {}), ...(e.cell !== undefined ? { cell: e.cell } : {}) });
  }
  return out;
}

/**
 * Copy terrain/<planet>.trn into the pack as terrain.trn, plus every bitmap its bitmap
 * filters reference (TGA decoded to "HMAP" greyscale files under terrain/). Returns the
 * terrain file name or null. Needs Node 22.18+ for the bitmap step (runs the game's TypeScript).
 */
async function copyTerrain(vfs, planet, outDir) {
  const path = `terrain/${planet}.trn`;
  if (!vfs.has(path)) return null;
  const bytes = vfs.read(path);
  writeFileSync(join(outDir, 'terrain.trn'), bytes);
  // Reset first: under "terrain all" a planet whose parse throws would otherwise inherit the
  // previous planet's template for its ground textures, its flora and its water.
  lastTemplate = null;
  let planetTemplate = null;
  try {
    const { parseTerrainTemplate, bitmapFiles } = await import('../../src/swg/terrain/trn.ts');
    const template = parseTerrainTemplate(new Uint8Array(bytes));
    lastTemplate = template;
    planetTemplate = template;
    for (const b of bitmapFiles(template)) {
      const src = b.name.replace(/\\/g, '/').replace(/^\//, '');
      if (!vfs.has(src)) {
        console.warn(`terrain bitmap missing: ${src}`);
        continue;
      }
      const img = decodeTga(vfs.read(src));
      const target = join(outDir, b.file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, encodeHeightmap(img));
      console.error(`  terrain bitmap ${src}: ${img.width}x${img.height} ${img.greyscale ? 'greyscale' : `type ${img.imageType}/${img.pixelDepth} bit`} -> ${b.file}`);
    }
  } catch (err) {
    console.warn(`terrain bitmaps not converted: ${err.message}`);
  }
  if (lastTemplate) copyTerrainShaders(vfs, lastTemplate, outDir);
  // Its own try: a water shader that will not read must not be reported as the bitmaps failing,
  // and must not cost the planet its heightmaps. A planet whose terrain does not parse gets no
  // water.json at all, so `status` keeps asking for it; an empty file would hide the failure.
  if (planetTemplate) {
    try {
      const { waterShaderUses } = await import('../../src/swg/terrain/trn.ts');
      exportWater(vfs, planet, waterShaderUses(planetTemplate), planetTemplate, outDir);
    } catch (err) {
      console.warn(`water look not converted: ${err.message}`);
    }
  }
  exportSky(vfs, planet, outDir, { textureFor: (p) => textureFor(vfs, p), particleFor: (p) => convertParticle(vfs, p, outDir) });
  return 'terrain.trn';
}

/**
 * The ground textures: one per shader family (its heaviest child's main texture, at most 512 px),
 * written under <out>/terrain/shaders/ and listed with each family's metres-per-repeat in
 * terrain/shaders.json, which the game blends across the ground.
 */
function copyTerrainShaders(vfs, template, outDir) {
  const families = [];
  let missing = 0;
  // Families the planet's rules use, plus any that building layer files in the pack add by name.
  const wanted = [...template.generator.shaderGroup.families.values()];
  const known = new Set(wanted.map((f) => f.name.toLowerCase()));
  const layerDir = join(outDir, 'terrain');
  if (existsSync(layerDir)) {
    // Ids after the planet's own; the game matches these by name, the id only has to be unique here.
    let nextId = Math.max(0, ...wanted.map((f) => f.id)) + 1;
    for (const file of readdirSync(layerDir).filter((f) => /\.lay$/i.test(f)).sort()) {
      try {
        for (const fam of layerFamilies(readFileSync(join(layerDir, file)))) {
          if (!fam.name || fam.name === 'null' || known.has(fam.name.toLowerCase())) continue;
          known.add(fam.name.toLowerCase());
          wanted.push({ ...fam, id: nextId++ });
        }
      } catch (err) {
        console.warn(`terrain layer ${file}: families not read: ${err.message}`);
      }
    }
  }
  for (const fam of wanted) {
    const child = [...fam.children].sort((a, b) => b.weight - a.weight)[0];
    const entry = { id: fam.id, name: fam.name, size: fam.shaderSize, file: null, shader: child ? child.name.replace(/\\/g, '/') : null };
    families.push(entry);
    if (!child) continue;
    // Families name their shaders bare (rock_cliff_anza): look for the file wherever it lives.
    const bare = entry.shader.replace(/^\//, '');
    const stem = bare.replace(/\.sht$/i, '').toLowerCase();
    const path = [bare, `${bare}.sht`, `shader/${bare}`, `shader/${bare}.sht`, `shader/terrain/${stem}.sht`].find((c) => vfs.has(c)) ?? vfs.list(`${stem}.sht`).find((f) => f === `${stem}.sht` || f.endsWith(`/${stem}.sht`));
    if (!path) {
      console.warn(`terrain shader missing: ${bare} (family ${fam.id} ${fam.name})`);
      missing++;
      continue;
    }
    try {
      const { main } = shaderTextures(parseIff(vfs.read(path)));
      if (!main || !vfs.has(main)) throw new Error(`no main texture${main ? ` (${main} not in archives)` : ''}`);
      const img = downscaleRgba(decodeDds(vfs.read(main)), 512);
      // The alpha channel is a specular or blend mask, not transparency: browsers drop the colour of
      // transparent pixels when they draw an image, so the ground texture is written opaque.
      for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = 255;
      const rel = `terrain/shaders/${fam.id}_${fam.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.png`;
      mkdirSync(join(outDir, 'terrain/shaders'), { recursive: true });
      writeFileSync(join(outDir, rel), encodePng(img.width, img.height, img.rgba));
      entry.file = rel;
      entry.texture = main;
    } catch (err) {
      console.warn(`terrain shader ${path}: ${err.message}`);
      missing++;
    }
  }
  mkdirSync(join(outDir, 'terrain'), { recursive: true });
  writeFileSync(join(outDir, 'terrain/shaders.json'), JSON.stringify({ families }, null, 1));
  console.error(`  terrain shaders: ${families.length - missing}/${families.length} families with textures -> terrain/shaders.json`);
}

/** The shader families a terrain layer file (.lay) carries: SFAM chunks of its SGRP form. */
function layerFamilies(bytes) {
  const out = [];
  let o = 0;
  while (o + 8 <= bytes.length) {
    const tag = bytes.toString('latin1', o, o + 4);
    const size = bytes.readUInt32BE(o + 4);
    if (tag === 'FORM' && bytes.toString('latin1', o + 8, o + 12) === 'SGRP') {
      const root = parseIff(bytes.subarray(o, o + 8 + size));
      const v = root.children.find((c) => c.tag === 'FORM');
      const version = v ? Number.parseInt(v.type, 10) : 0;
      for (const c of v ? v.children : []) {
        if (c.tag !== 'SFAM') continue;
        const r = new R(c.data);
        const id = r.i32();
        let name = 'null';
        if (version >= 1) {
          name = r.str();
          if (version >= 6) r.str();
          r.u8(); r.u8(); r.u8();
        }
        let shaderSize = 2;
        if (version >= 2) shaderSize = r.f32();
        if (version === 3) r.f32();
        let featherClamp = 1;
        if (version >= 4) featherClamp = r.f32();
        if (version === 5) r.i32();
        const n = r.i32();
        const children = [];
        for (let k = 0; k < n; k++) children.push({ name: r.str(), weight: version >= 1 ? r.f32() : 1 / n });
        out.push({ id, name, shaderSize, featherClamp, children });
      }
      break;
    }
    o += 8 + size;
  }
  return out;
}

/** Box-filter an RGBA image down by whole factors until neither side exceeds `max`. */
function downscaleRgba(img, max) {
  let { width, height, rgba } = img;
  while (width > max || height > max) {
    const w = Math.max(1, width >> 1);
    const h = Math.max(1, height >> 1);
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
          const x0 = Math.min(width - 1, x * 2), x1 = Math.min(width - 1, x * 2 + 1);
          const y0 = Math.min(height - 1, y * 2), y1 = Math.min(height - 1, y * 2 + 1);
          out[(y * w + x) * 4 + c] = (rgba[(y0 * width + x0) * 4 + c] + rgba[(y0 * width + x1) * 4 + c] + rgba[(y1 * width + x0) * 4 + c] + rgba[(y1 * width + x1) * 4 + c] + 2) >> 2;
        }
      }
    }
    width = w;
    height = h;
    rgba = out;
  }
  return { width, height, rgba };
}

/** The terrain template copyTerrain parsed last (for the flora conversion that follows it). */
let lastTemplate = null;

/**
 * Convert the appearances the terrain's flora families name (trees, rocks, plants) into
 * <out>/flora/ and record them as the pack's `flora` category, keyed by appearance file.
 */
function convertFlora(vfs, template, outDir, manifest) {
  const families = [...template.generator.floraGroup.families.values()];
  if (!families.length) return { models: 0, missing: 0, families: 0 };
  mkdirSync(join(outDir, 'flora'), { recursive: true });
  const defs = new Map();
  let missing = 0;
  let particles = 0;
  for (const family of families) {
    for (const child of family.children) {
      const appearance = child.appearance;
      const key = appearance.toLowerCase();
      if (defs.has(key)) continue;
      if (/\.prt$/i.test(appearance)) {
        // Particle systems (insects, dust): not meshes.
        particles++;
        continue;
      }
      if (!vfs.has(appearance)) {
        missing++;
        console.warn(`flora appearance missing: ${appearance} (family ${family.name})`);
        continue;
      }
      const id = familyOf(appearance);
      try {
        const conv = convertOne(vfs, appearance, join(outDir, 'flora', `${id}.glb`));
        const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
        const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
        defs.set(key, { id, file: `flora/${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, appearance, family: family.id, familyName: family.name });
      } catch (err) {
        missing++;
        console.warn(`flora ${appearance}: ${err.message}`);
      }
    }
  }
  manifest.categories.flora = [...defs.values()];
  return { models: defs.size, missing, particles, families: families.length };
}

/**
 * Convert a skeletal appearance (.sat, or an object template that names one) into a skinned
 * GLB with its skeleton and the animations its logical animation table lists.
 * `animations` filters logical names by substring ('all' keeps every one).
 */
/**
 * A character as parts (body, head and each worn item as its own GLB against one shared skeleton)
 * under <outRoot>/characters/<id>/, keeping the Jedi Academy clips an old rig there carried.
 */
function convertParts(vfs, outRoot, template, { wear = DEFAULT_WEAR, variables = new Map(), anim = undefined, maxAnims = undefined } = {}) {
  const id = basename(template).replace(/^shared_/, '').replace(/\.[^.]+$/, '');
  const outDir = join(outRoot, 'characters', id);
  const rigFile = join(outDir, 'rig.glb');
  const oldParts = existsSync(join(outDir, 'parts.json')) ? JSON.parse(readFileSync(join(outDir, 'parts.json'), 'utf8')) : null;
  let carried = null;
  if (existsSync(rigFile)) {
    try {
      const bundle = extractClips(readFileSync(rigFile), (name) => /^BOTH_/i.test(name));
      if (bundle.clips.length) carried = { bundle, jkaClips: oldParts?.jkaClips ?? {}, jkaGrip: oldParts?.jkaGrip, scale: oldParts?.scale };
    } catch (err) {
      console.log(`  (the old rig's Jedi Academy clips could not be read: ${err.message})`);
    }
  }
  const gender = /female/i.test(id) ? 'f' : 'm';
  const info = convertSat(vfs, template, null, {
    animations: anim ?? PLAYER_CLIPS,
    maxAnimations: maxAnims ? Number(maxAnims) : PLAYER_MAX_CLIPS,
    variables,
    wear,
    parts: { dir: outDir, rig: 'rig' },
    gender,
    // The parts rig is the one the game plays, so the moods have to reach it and not only the
    // single-model player pack; --no-moods leaves them out for a size baseline.
    moods: !flags.has('--no-moods'),
  });
  let kept = null;
  if (carried) {
    const buf = readFileSync(rigFile);
    const { json } = readGlb(buf);
    if (!(json.animations ?? []).some((a) => /^BOTH_/i.test(a.name))) {
      const { clips } = retargetClips(carried.bundle, skinJoints(json));
      writeFileSync(rigFile, replaceClips(buf, clips, (name) => clips.some((c) => c.name === name)));
      info.rig.clips = (info.rig.clips ?? 0) + clips.length;
      kept = { count: clips.length, jkaClips: Object.fromEntries(Object.entries(carried.jkaClips).filter(([n]) => clips.some((c) => c.name === n))) };
    }
  }
  const manifest = {
    id,
    species: id.replace(/_(male|female)$/, ''),
    gender: gender === 'f' ? 'female' : 'male',
    template,
    skeleton: info.skeleton,
    rig: info.rig,
    joints: info.joints,
    defaultWear: info.parts.filter((p) => p.occlusionLayer > 0).map((p) => p.name),
    clips: info.animations,
    clipSpeeds: info.clipSpeeds ?? {},
    // Whether this run was asked for the standing loop's mood branches at all; false is
    // --no-moods, which is a choice rather than a gap, and `status` reads it as one.
    moods: info.moodsAsked === true,
    ...(info.partialClips ? { partialClips: info.partialClips } : {}),
    ...(info.variants ? { variants: info.variants } : {}),
    parts: info.parts,
    customization: [...info.customization],
    variables: customizationList(vfs, info),
    values: Object.fromEntries(variables),
    ...(kept ? { jkaClips: kept.jkaClips, ...(carried.jkaGrip ? { jkaGrip: carried.jkaGrip } : {}), ...(carried.scale !== undefined ? { scale: carried.scale } : {}) } : {}),
  };
  writeFileSync(join(outDir, 'parts.json'), JSON.stringify(manifest, null, 2));
  const total = info.parts.reduce((a, p) => a + p.bytes, 0);
  console.log(`-> ${outDir}`);
  console.log(`   rig ${info.rig.file}: ${info.rig.joints} joints, ${info.rig.clips} clips${kept ? ` (${kept.count} Jedi Academy clips carried over from the old rig)` : ''}`);
  if (info.moodClips) console.log(`   moods: ${info.moodClips.length} branches (${info.moodClips.join(', ') || 'none'})`);
  for (const m of info.moodNotes ?? []) console.log(`   mood ${m}`);
  for (const p of info.parts) {
    console.log(`   ${p.name.padEnd(22)} ${String(p.triangles).padStart(5)} tris  ${(p.bytes / 1024).toFixed(0).padStart(5)} KB  layer ${p.occlusionLayer}${p.occludes?.length ? `  hides ${p.occludes.join(' ')}` : ''}${p.morphs?.length ? `  ${p.morphs.length} morphs` : ''}`);
  }
  console.log(`   ${info.parts.length} parts, ${(total / 1e6).toFixed(1)} MB of meshes (the rig and its clips are shared)`);
  if (info.recipes) console.log(`   live customization: ${info.recipes} texture recipes over ${info.images} images in customize/ (the game renders skin, hair and eyes itself)`);
  const palettes = manifest.variables.filter((v) => v.kind === 'palette');
  if (manifest.variables.length) console.log(`   customization: ${palettes.length} colour palettes (${palettes.map((v) => `${v.name} ${v.colors.length}`).join(', ')}), ${manifest.variables.length - palettes.length} choices; set with --var=name=value`);
  if (info.skipped.length) console.log(`   skipped: ${info.skipped.slice(0, 5).join('; ')}`);
  return { id, outDir, manifest };
}

/** Put a saved clip bundle onto a parts rig that lacks its clips, with the loop flags into parts.json; returns how many clips went on. */
function applyBundleToRig(rigFile, bundleFile) {
  const buf = readFileSync(rigFile);
  const { json } = readGlb(buf);
  if ((json.animations ?? []).some((a) => /^BOTH_/i.test(a.name))) return 0;
  const bundle = unpackClips(readFileSync(bundleFile));
  const { clips } = retargetClips(bundle, skinJoints(json));
  if (!clips.length) return 0;
  writeFileSync(rigFile, replaceClips(buf, clips, (name) => clips.some((c) => c.name === name)));
  const partsManifest = join(dirname(rigFile), 'parts.json');
  if (existsSync(partsManifest)) {
    const m = JSON.parse(readFileSync(partsManifest, 'utf8'));
    const present = new Set(clips.map((c) => c.name));
    m.rig = { ...(m.rig ?? {}), clips: (m.rig?.clips ?? 0) + clips.length };
    m.jkaClips = Object.fromEntries(Object.entries(bundle.meta?.jkaClips ?? {}).filter(([n]) => present.has(n)));
    m.clipSpeeds = { ...(m.clipSpeeds ?? {}), ...(bundle.meta?.clipSpeeds ?? {}) };
    if (bundle.meta?.scale !== undefined) m.scale = bundle.meta.scale;
    if (bundle.meta?.grip) m.jkaGrip = bundle.meta.grip;
    writeFileSync(partsManifest, JSON.stringify(m, null, 2));
  }
  return clips.length;
}

/** characters/index.json: every parts pack under <outRoot>/characters, with what each offers the character creator. */
function writeSpeciesIndex(outRoot) {
  const dir = join(outRoot, 'characters');
  const species = [];
  if (existsSync(dir)) {
    for (const id of readdirSync(dir).sort()) {
      const file = join(dir, id, 'parts.json');
      if (!existsSync(file)) continue;
      let m;
      try {
        m = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      const gender = m.gender ?? (/female/i.test(id) ? 'female' : 'male');
      const wardrobeDir = [id, `human_${gender}`].find((w) => existsSync(join(outRoot, 'wardrobe', w, 'wardrobe.json')));
      species.push({
        id,
        species: m.species ?? id.replace(/_(male|female)$/, ''),
        gender,
        template: m.template,
        skeleton: m.skeleton,
        parts: m.parts?.length ?? 0,
        morphs: [...new Set((m.parts ?? []).flatMap((p) => p.morphs ?? []))],
        variables: m.variables ?? [],
        jkaClips: Object.keys(m.jkaClips ?? {}).length,
        wardrobe: wardrobeDir ?? null,
      });
    }
  }
  const index = { species };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2));
  return index;
}

/**
 * One worn mesh (a .lmg's finest present level, or a .mgn) as a wardrobe part GLB in outDir, with
 * the live colour recipe for a shader whose look a colour changes; null when the mesh is missing
 * or draws nothing.
 */
function convertWearableMesh(vfs, meshPath, { skeleton, skin, outDir, ctx, info, recipes, recipeKeys, registry, onMesh }) {
  let name = meshPath;
  let parsed = null;
  if (/\.lmg$/i.test(name)) {
    if (!vfs.has(name)) return null;
    // The finest level with geometry: a level the game's own archives hold stripped is passed over.
    ({ file: name, mgn: parsed } = finestLevelWithGeometry(parseLmg(readIff(vfs, name)), { has: (l) => vfs.has(l), load: (l) => parseMgn(readIff(vfs, l)) }));
  }
  if (!name || !vfs.has(name)) return null;
  const mgn = parsed ?? parseMgn(readIff(vfs, name));
  const { groups } = skinnedPrimitives(mgn, skeleton);
  const meshName = basename(name).replace(/\.[^.]+$/, '');
  const textures = new Map();
  const kept = [];
  for (const g of groups) {
    if (!g.primitives[0].indices.length) continue;
    const t = skinnedTexture(vfs, g.shader, null, ctx, info, meshName);
    if (t) textures.set(g.shader, t);
    if (t && surfaceUse) surfaceUse.add(t);
    kept.push(g);
    const rkey = `${g.shader}|${meshName}`;
    if (!recipeKeys.has(rkey)) {
      try {
        const shader = loadShader(vfs, g.shader, ctx);
        if (shader?.effect && shaderNeedsBake(shader)) {
          recipeKeys.add(rkey);
          recipes.push({ mesh: meshName, material: g.shader, kind: 'bake', baseTag: 'MAIN', shader: exportShader(shader, registry, (f) => loadImage(vfs, f, ctx.images)), slots: [] });
        }
      } catch (err) {
        info.skipped.push(`${g.shader}: no live recipe (${err.message})`);
      }
    }
  }
  if (!kept.length) return null;
  const file = `${meshName}.glb`;
  // The wardrobe's icon draws every mesh of the item: the groups kept and their textures.
  onMesh?.(meshName, kept, textures);
  writeFileSync(join(outDir, file), buildGlb([{ name: meshName, groups: kept, extras: { occlusionLayer: mgn.occlusionLayer, occludes: mgn.occludes, zoneNames: mgn.occlusionZones, zoneCombinations: mgn.zoneCombinations, fullyOccludedBy: mgn.fullyOccludedBy } }], { flipX: true, textures, skin, keepZones: true }));
  return {
    name: meshName,
    file,
    bytes: statSync(join(outDir, file)).size,
    triangles: kept.reduce((a, g) => a + g.primitives[0].indices.length / 3, 0),
    occlusionLayer: mgn.occlusionLayer,
    occludes: mgn.occludes,
    zoneNames: mgn.occlusionZones,
    zoneCombinations: mgn.zoneCombinations,
    fullyOccludedBy: mgn.fullyOccludedBy,
    morphs: mgn.blendTargets.map((b) => b.name),
  };
}

/** Remember a customization variable by name, with where it was met, for the structured manifest. */
function noteVariables(info, list, source, mesh = null) {
  if (!info.variables) return;
  for (const v of list) {
    // A private variable is the object's own (a shirt's colour 1 is not the body's colour 1), so
    // it is kept per mesh; a shared one (the owner's skin colour) is one for the whole character.
    const key = `${v.private ? 'private:' : ''}${v.name}`;
    const entry = info.variables.get(key) ?? info.variables.set(key, { name: v.name, private: !!v.private, kind: v.kind, sources: [], meshes: [] }).get(key);
    if (v.kind === 'palette') entry.palette = v.palette;
    else entry.max = Math.max(entry.max ?? 0, v.max ?? 0);
    if (entry.default === undefined) entry.default = v.default ?? 0;
    if (!entry.sources.includes(source)) entry.sources.push(source);
    if (mesh && !entry.meshes.includes(mesh)) entry.meshes.push(mesh);
  }
}

/** The structured customization list a manifest carries: each variable with its palette's colours or its range. */
function customizationList(vfs, info) {
  const out = [];
  for (const v of info.variables?.values() ?? []) {
    const entry = { name: v.name, private: v.private, kind: v.kind === 'palette' ? 'palette' : 'index', default: v.default, sources: v.sources.map((f) => basename(f)), meshes: v.meshes ?? [] };
    if (v.kind === 'palette') {
      entry.palette = v.palette;
      try {
        entry.colors = vfs.has(v.palette) ? parsePalette(vfs.read(v.palette)).map(([r, g, b]) => [r, g, b]) : [];
      } catch {
        entry.colors = [];
      }
    } else entry.count = v.max ?? 0;
    out.push(entry);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** --var=a=1,b=2 â†’ Map of customization variable values (matched by full or short name). */
function customizationValues(spec) {
  const values = new Map();
  for (const part of (spec ?? '').split(',')) {
    const m = part.match(/^\s*([^=]+?)\s*=\s*(-?\d+)\s*$/);
    if (m) values.set(m[1], Number(m[2]));
  }
  return values;
}

/**
 * The texture for one skinned mesh's shader: a texture-renderer blueprint's output when the mesh
 * names one for it (skin, hair, eyes), the shader baked with its default palette colours when its
 * look depends on them, otherwise the shader's main texture as for any other mesh.
 */
function skinnedTexture(vfs, shaderPath, slots, ctx, info, mesh = null) {
  let shader = null;
  try {
    shader = loadShader(vfs, shaderPath, ctx);
  } catch (err) {
    info.skipped.push(`${shaderPath}: ${err.message}`);
  }
  if (shader && shader.variables?.length) {
    for (const line of describeVariables(shader.variables)) info.customization.add(`${shaderPath}: ${line}`);
    noteVariables(info, shader.variables, shaderPath, mesh);
  }
  info.shaderNotes.add(`${shaderPath}: ${describeShader(shader)}`);
  const rendered = slots?.find((s) => s.tag === 'MAIN') ?? slots?.[0];
  if (!rendered && !(shader && shaderNeedsBake(shader))) return textureFor(vfs, shaderPath);
  let image = rendered ? rendered.image : null;
  if (shader && shader.effect) {
    const s = { ...shader, textures: new Map(shader.textures) };
    for (const slot of slots ?? []) s.textures.set(slot.tag, slot.image);
    if (!rendered || shaderNeedsBake(s, rendered.tag)) image = bakeShader(s, rendered ? rendered.tag : 'MAIN') ?? image;
  }
  if (!image) return textureFor(vfs, shaderPath);
  const pass = shader?.effect?.passes[0];
  const alphaMode = pass?.alphaTest ? 'MASK' : pass?.alphaBlend ? 'BLEND' : 'OPAQUE';
  let hasAlpha = image.hasAlpha ?? false;
  if (image.hasAlpha === undefined) for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i] !== 255) { hasAlpha = true; break; }
  const normalFile = shader?.textureFiles?.get('CNRM') ?? shader?.textureFiles?.get('NRML') ?? shader?.textureFiles?.get('DOT3') ?? null;
  const normal = normalFile ? normalFor(vfs, normalFile) : null;
  const result = { path: `${shaderPath}#${rendered ? basename(rendered.file) : 'baked'}`, png: encodePng(image.width, image.height, image.rgba), hasAlpha, alphaMode, ...(normal ? { normal } : {}) };
  // The icon's copy of the baked texture, reduced (the item pictures never decode a PNG just encoded).
  if (wantThumbs) Object.defineProperty(result, 'thumb', { value: thumbTexture(image.width, image.height, image.rgba), enumerable: false });
  return result;
}

/**
 * Convert a skeletal appearance.
 *
 * By default everything -- body, head and whatever is worn -- is merged into one GLB, with the
 * skin under the clothing culled away for good. `parts` instead writes each mesh as its own GLB
 * against the same skeleton, keeps every triangle, and carries the occlusion zones through, so
 * the game can dress and undress a character at run time rather than the converter deciding once.
 * `animations: false` reads no animation table at all, for a model whose clips live in a shared pack.
 */
function convertSat(vfs, path, outFile, { animations = 'all', maxAnimations = 80, variables = new Map(), wear = [], extraClips = null, parts = null, gender = null, hardpoints = false, extraHardpoints = [], moods = false } = {}) {
  let satPath = path.replace(/\\/g, '/');
  if (/\.iff$/i.test(satPath)) {
    const cache = new Map();
    const a = resolveTemplateString(vfs, satPath, ['appearanceFilename'], cache);
    if (!a) throw new Error(`${satPath}: no appearanceFilename in its template chain`);
    satPath = a.replace(/\\/g, '/').replace(/^\//, '');
  }
  const sat = parseSat(readIff(vfs, satPath));
  if (!sat.skeletons.length) throw new Error(`${satPath}: no skeleton`);
  const skeletonFile = sat.skeletons[0].file;
  const loadSkeleton = (file) => parseSkeleton(readIff(vfs, file), (f) => (vfs.has(f) ? readIff(vfs, f) : null));
  // `moodsAsked` goes into the manifest so that `status` can tell a pack converted with
  // --no-moods, which is a choice the owner made, from one converted before the moods existed,
  // which is work still to do. Without it the two look the same and status asks for ever.
  const info = { sat: satPath, skeleton: skeletonFile, joints: 0, meshes: [], animations: [], missing: [], unknownTransforms: 0, skipped: [], textureRenderers: [], customization: new Set(), variables: new Map(), attached: [], shaderNotes: new Set(), moodsAsked: moods === true };
  // Extra skeletons (the face rig) hang from a joint of the first.
  const extras = [];
  for (const k of sat.skeletons.slice(1)) {
    if (!vfs.has(k.file)) {
      info.missing.push(k.file);
      continue;
    }
    try {
      extras.push({ skeleton: loadSkeleton(k.file), attachTo: k.attachTo, file: k.file });
    } catch (err) {
      info.skipped.push(`${k.file}: ${err.message}`);
    }
  }
  const skeleton = mergeSkeletons(loadSkeleton(skeletonFile), extras);
  info.joints = skeleton.joints.length;
  {
    const ext = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const j of skeleton.joints) for (let k = 0; k < 3; k++) {
      ext.min[k] = Math.min(ext.min[k], j.bindT[k]);
      ext.max[k] = Math.max(ext.max[k], j.bindT[k]);
    }
    info.jointExtent = ext;
    info.rootJoint = skeleton.joints.find((j) => j.parent < 0)?.name ?? '?';
  }
  info.attached = skeleton.attached.map((a, i) => `${extras[i].file} (${a.joints} joints) at ${a.attachTo}`);
  const meshes = [];
  const recipes = parts ? [] : null;
  const registry = parts ? new ImageRegistry((id, bytes) => {
    mkdirSync(join(parts.dir, 'customize'), { recursive: true });
    writeFileSync(join(parts.dir, 'customize', id), bytes);
  }) : null;
  const textures = new Map();
  const ctx = renderContext(variables);
  // Mesh generators of the body and of everything worn over it, composed the way the game does:
  // outer layers hide the zones of inner ones (a shirt hides the torso skin beneath it).
  const loaded = [];
  const sources = [{ sat, label: satPath, body: true }];
  for (const item of wear) {
    try {
      let file = item.replace(/\\/g, '/').replace(/^\//, '');
      if (/\.iff$/i.test(file)) {
        const a = resolveTemplateString(vfs, file, ['appearanceFilename'], new Map());
        if (!a) throw new Error('no appearanceFilename in its template chain');
        file = a.replace(/\\/g, '/').replace(/^\//, '');
      }
      // A wearable's template names one gender's appearance and the client swaps the suffix for
      // the other, so a male character given shirt_s03_f.sat should wear shirt_s03_m.sat.
      if (gender) {
        const swapped = file.replace(/_[fm](\.sat)$/i, `_${gender}$1`);
        if (swapped !== file && vfs.has(swapped)) file = swapped;
      }
      if (!vfs.has(file)) throw new Error('not in archives');
      const worn = parseSat(readIff(vfs, file));
      const skeletons = worn.skeletons.map((k) => k.file.toLowerCase());
      if (!skeletons.includes(skeletonFile.toLowerCase())) throw new Error(`built for skeleton ${worn.skeletons.map((k) => k.file).join(', ') || 'none'}, not ${skeletonFile}`);
      sources.push({ sat: worn, label: file, body: false });
    } catch (err) {
      info.skipped.push(`wearable ${item}: ${err.message}`);
    }
  }
  for (const source of sources) {
    for (const name of source.sat.meshes) {
      let file = name;
      let parsed = null;
      if (/\.lmg$/i.test(file)) {
        if (!vfs.has(file)) {
          info.missing.push(file);
          continue;
        }
        // The finest level with geometry: a level the game's own archives hold stripped is passed over.
        ({ file, mgn: parsed } = finestLevelWithGeometry(parseLmg(readIff(vfs, file)), { has: (l) => vfs.has(l), load: (l) => parseMgn(readIff(vfs, l)) }));
      }
      if (!file || !vfs.has(file)) {
        info.missing.push(file ?? name);
        continue;
      }
      try {
        loaded.push({ mgn: parsed ?? parseMgn(readIff(vfs, file)), file, body: source.body });
      } catch (err) {
        info.skipped.push(`${file}: ${err.message}`);
      }
    }
  }
  // In parts mode nothing is hidden at conversion time: the zones travel with the mesh instead.
  const composed = parts ? loaded.map((l) => ({ ...l, hiddenTriangles: 0 })) : composeMeshes(loaded);
  // The body's hardpoints (a mount's saddle, the basilisk's rider point), for `hardpoints`.
  const bodyHardpoints = [];
  for (const { mgn, file, body, hiddenTriangles } of composed) {
    if (hardpoints && body) bodyHardpoints.push(...(mgn.hardpoints ?? []));
    const { groups, unknownTransforms, unknownNames } = skinnedPrimitives(mgn, skeleton);
    info.unknownTransforms += unknownTransforms;
    for (const n of unknownNames) (info.unknownJoints ??= new Set()).add(n);
    // Each mesh's own extent, for telling a tiny model from a wrong one.
    const ext = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < mgn.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        ext.min[k] = Math.min(ext.min[k], mgn.positions[i + k]);
        ext.max[k] = Math.max(ext.max[k], mgn.positions[i + k]);
      }
    }
    (info.meshExtents ??= []).push({ file, vertices: mgn.positions.length / 3, min: ext.min, max: ext.max });
    if (body) {
      for (let i = 0; i < mgn.positions.length; i += 3) {
        const b = (info.bounds ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
        const p = [-mgn.positions[i], mgn.positions[i + 1], mgn.positions[i + 2]];
        for (let k = 0; k < 3; k++) {
          b.min[k] = Math.min(b.min[k], p[k]);
          b.max[k] = Math.max(b.max[k], p[k]);
        }
      }
    }
    // Run the mesh's texture renderers (skin, hair, eyes) and hand their output to the shaders they fill.
    const meshName = basename(file).replace(/\.[^.]+$/, '');
    const slotsByShader = new Map();
    for (const trt of mgn.textureRenderers) {
      if (!vfs.has(trt.file)) {
        info.missing.push(trt.file);
        continue;
      }
      try {
        const bp = parseBlueprint(readIff(vfs, trt.file));
        const image = renderBlueprint(vfs, bp, ctx);
        info.textureRenderers.push(`${trt.file}: ${bp.width}x${bp.height} for ${trt.slots.map((sl) => `${mgn.shaders[sl.shaderIndex]?.shader ?? sl.shaderIndex}:${sl.tag}`).join(', ')}${image.missing.length ? `; missing textures ${image.missing.join(', ')}` : ''}${image.unsupported.length ? `; effects without fixed-function passes ${image.unsupported.join(', ')}` : ''}`);
        for (const line of describeVariables(bp.variables)) info.customization.add(`${trt.file}: ${line}`);
        noteVariables(info, bp.variables, trt.file, meshName);
        for (const sl of trt.slots) (slotsByShader.get(sl.shaderIndex) ?? slotsByShader.set(sl.shaderIndex, []).get(sl.shaderIndex)).push({ tag: sl.tag, image, file: trt.file, bp });
      } catch (err) {
        info.skipped.push(`${trt.file}: ${err.message}`);
      }
    }
    const kept = [];
    groups.forEach((g, i) => {
      if (!g.primitives[0].indices.length) return; // everything this shader drew is under clothing
      const slots = slotsByShader.get(i);
      const shaderPath = g.shader;
      const t = skinnedTexture(vfs, g.shader, slots, ctx, info, meshName);
      if (slots) g.shader = `${g.shader}@${meshName}`; // its own material: the rendered texture is this mesh's
      if (t) textures.set(g.shader, t);
      if (t && surfaceUse) surfaceUse.add(t);
      kept.push(g);
      // For a parts pack: how this material's texture is made, so the game can make it again with
      // other colours and choices (a rendered blueprint, a shader baked over one, or a shader
      // baked from its own textures and palette factors). A plain texture needs nothing.
      if (parts && recipes) {
        try {
          const shader = loadShader(vfs, shaderPath, ctx);
          const rendered = slots?.find((sl) => sl.tag === 'MAIN') ?? slots?.[0];
          let bake = false;
          if (shader?.effect) {
            const s = { ...shader, textures: new Map(shader.textures) };
            for (const slot of slots ?? []) s.textures.set(slot.tag, slot.image);
            bake = !rendered || shaderNeedsBake(s, rendered.tag);
          }
          if (rendered || bake) {
            const load = (file) => loadImage(vfs, file, ctx.images);
            recipes.push({
              mesh: meshName,
              material: g.shader,
              kind: bake ? 'bake' : 'render',
              baseTag: rendered ? rendered.tag : 'MAIN',
              shader: exportShader(shader, registry, load),
              slots: (slots ?? []).map((sl) => ({ tag: sl.tag, file: sl.file, blueprint: exportBlueprint(vfs, sl.bp, ctx, registry, loadImage) })),
            });
          }
        } catch (err) {
          info.skipped.push(`${shaderPath}: no live recipe (${err.message})`);
        }
      }
    });
    if (kept.length) {
      const entry = { name: meshName, groups: kept, blendTargets: mgn.blendTargets };
      if (parts) {
        // What this mesh hides on the layers beneath it, and the zone names its triangles index.
        entry.extras = {
          occlusionLayer: mgn.occlusionLayer,
          occludes: mgn.occludes,
          zoneNames: mgn.occlusionZones,
          zoneCombinations: mgn.zoneCombinations,
          fullyOccludedBy: mgn.fullyOccludedBy,
          body: !!body,
        };
      }
      meshes.push(entry);
    }
    info.meshes.push({ file, shaders: kept.length, triangles: kept.reduce((a, g) => a + g.primitives[0].indices.length / 3, 0), hidden: hiddenTriangles, layer: mgn.occlusionLayer, occludes: mgn.occludes });
  }
  const clips = [];
  // `animations: false` leaves the table unread altogether: a mobile's model carries no clips of
  // its own, because its pack is baked once for every appearance that shares its table.
  const tableFile = sat.animationTables.get(skeletonFile.toLowerCase()) ?? [...sat.animationTables.values()][0];
  if (animations === false && tableFile) info.animationTable = tableFile;
  const latFile = animations === false ? null : tableFile;
  if (latFile && vfs.has(latFile)) {
    const latRoot = readIff(vfs, latFile);
    const lat = parseLat(latRoot);
    info.animationTable = latFile;
    const wanted = animations === 'all' || animations === 'list' ? null : animations.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const parsed = new Map();
    const loadAnimation = (e) => {
      const key = e.kind === 'file' ? e.file : e.form;
      if (parsed.has(key)) return parsed.get(key);
      let a = null;
      if (e.kind === 'inline') a = parseAnimation(e.form);
      else if (e.kind === 'file' && vfs.has(e.file)) a = parseAnimation(readIff(vfs, e.file));
      parsed.set(key, a);
      return a;
    };
    const named = nameLocomotion(lat.entries, loadAnimation);
    // The mood branches of the named locomotion clips. They are asked for outright rather than
    // matched by name, because the table's own name for one carries the gender branch and the
    // speed index (the shipped flattener's naming) and the game asks for the friendly name.
    if (moods) {
      // A table the mood readers cannot walk (one with no INFO chunk where they expect one) must
      // cost this species its moods and not its whole conversion: the rule of this pass is that a
      // missing mood reads as "not yet" and never as an error.
      try {
        const found = moodEntries(latRoot, named);
        named.push(...found.entries);
        info.moodNotes = found.notes;
        info.moodClips = found.entries.map((e) => e.clip);
      } catch (err) {
        info.moodNotes = [`branches could not be read from ${latFile}: ${err.message}`];
        info.moodClips = [];
      }
    }
    info.available = named.map((e) => `${e.clip}${e.clip !== e.name ? ` (${e.name}${e.speed ? ` ${e.speed.toFixed(1)} m/s` : ''})` : ''}${e.kind === 'file' || e.kind === 'inline' ? '' : ` [${e.kind}]`}${e.variable ? ` (${e.variable}${e.isDefault ? ', default' : ''})` : ''}${e.timeScale && e.timeScale !== 1 ? ` x${e.timeScale.toFixed(2)}` : ''}`);
    if (animations === 'list') return info;
    const used = new Set();
    const cut = [];
    for (const e of named) {
      // A mood branch was asked for outright by the mood pass: the name filters are written
      // against the table's own names and would never match the friendly name it carries.
      if (!e.mood && wanted && !wanted.some((w) => (w.startsWith('=') ? e.clip.toLowerCase() === w.slice(1) || e.name.toLowerCase() === w.slice(1) : e.clip.toLowerCase().includes(w) || e.name.toLowerCase().includes(w)))) continue;
      if (used.has(e.clip)) continue;
      if (clips.length >= maxAnimations) {
        // Past the cap: say which wanted clips were left out rather than dropping them quietly.
        if (!used.has(e.clip)) cut.push(e.clip);
        used.add(e.clip);
        continue;
      }
      try {
        if (e.kind !== 'inline' && e.kind !== 'file') {
          info.skipped.push(`${e.name}: ${e.kind} animation templates are not converted`);
          continue;
        }
        if (e.kind === 'file' && !vfs.has(e.file)) {
          info.missing.push(e.file);
          continue;
        }
        const animation = { ...loadAnimation(e) };
        if (e.timeScale && e.timeScale !== 1 && e.timeScale > 0) animation.fps *= e.timeScale;
        used.add(e.clip);
        clips.push({ name: e.clip, animation });
        info.animations.push(e.clip);
        (info.clipSpeeds ??= {})[e.clip] = Number(((animation.locomotionSpeed ?? 0) * (e.timeScale || 1)).toFixed(3));
        // A selector branch and every value that picks it (a flourish shared by two dances, the
        // saddle pose two mounts share), so the game can ask for a clip by the value it knows.
        if (e.variable && e.values?.length) (info.variants ??= {})[e.clip] = { variable: e.variable, values: e.values };
        // How much of the skeleton this clip actually moves, for spotting name mismatches.
        const jointNames = new Set(skeleton.joints.map((j) => j.name.toLowerCase()));
        const matched = animation.transforms.filter((t) => jointNames.has(t.name.toLowerCase())).length;
        // A clip that moves only part of the skeleton (a fire on the arms, an emote on the face) is
        // noted with the joints it drives, so it can be layered over a full pose instead of T-posing the rest.
        if (matched < jointNames.size) {
          // The joints by the skeleton's own spelling, which is what the model's nodes are named.
          const canonical = new Map(skeleton.joints.map((j) => [j.name.toLowerCase(), j.name]));
          (info.partialClips ??= {})[e.clip] = animation.transforms.map((t) => canonical.get(t.name.toLowerCase())).filter((n) => n !== undefined);
        }
        const first = poseAtFrame(skeleton, animation, 0);
        const mid = poseAtFrame(skeleton, animation, Math.floor(animation.frameCount / 2));
        let moving = 0;
        first.forEach((a, i) => {
          const b = mid[i];
          const dq = Math.abs(a.rotation[0] - b.rotation[0]) + Math.abs(a.rotation[1] - b.rotation[1]) + Math.abs(a.rotation[2] - b.rotation[2]) + Math.abs(a.rotation[3] - b.rotation[3]);
          const dt = Math.abs(a.translation[0] - b.translation[0]) + Math.abs(a.translation[1] - b.translation[1]) + Math.abs(a.translation[2] - b.translation[2]);
          if (dq > 1e-3 || dt > 1e-3) moving++;
        });
        (info.clipStats ??= []).push(`${e.clip}: ${animation.frameCount} frames at ${animation.fps.toFixed(1)} fps, ${animation.transforms.length} transforms (${matched} match skeleton joints, ${animation.rotationChannels.length} rotation channels), ${moving} joints move by mid-clip${matched === 0 && animation.transforms.length ? `; e.g. animation "${animation.transforms[0].name}" vs skeleton "${skeleton.joints[0].name}", "${skeleton.joints[1]?.name}"` : ''}`);
      } catch (err) {
        info.skipped.push(`${e.name}: ${err.message}`);
      }
    }
    if (cut.length) {
      info.cut = cut;
      console.warn(`   ${cut.length} wanted clips left out by the --max-anims cap of ${maxAnimations}: ${cut.slice(0, 8).join(', ')}${cut.length > 8 ? ', ...' : ''}; raise --max-anims to keep them`);
    }
  } else if (latFile) info.missing.push(latFile);
  // The body's hardpoints ride their joints as hp:<name> nodes; the mount tables' own appearance
  // adds its saddle when this one lacks it (`extraHardpoints`). The first of a name wins.
  const wantedHardpoints = [];
  if (hardpoints) {
    const seen = new Set();
    for (const hp of [...bodyHardpoints, ...extraHardpoints]) {
      const key = String(hp.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      wantedHardpoints.push(hp);
    }
  }
  const skin = skinData(skeleton, clips, { flipX: true, hardpoints: wantedHardpoints });
  // A one-frame pose is written twice a frame apart. `skinData` gives such a clip a duration of
  // zero, three finishes a zero-length action on its first update, and a repeating one divides by
  // that length and poses the bones at NaN — which is what a still pose played as a state does.
  // The mobiles packs have padded theirs since they were written; these rigs now do the same, and
  // the call is a no-op on every clip of more than one key.
  skin.clips.forEach((clip, i) => M.padSingleFrame(clip, clips[i]?.animation?.fps || 30));
  if (hardpoints) {
    info.hardpoints = skin.hardpoints.map((h) => ({ name: h.name, joint: skin.joints[h.joint].name }));
    for (const name of skin.droppedHardpoints) info.skipped.push(`hardpoint ${name}: its joint is not in the skeleton`);
  }
  if (extraClips) {
    // Clips from elsewhere (Jedi Academy's), already retargeted onto this skeleton's joints.
    const extra = extraClips(skin.joints, info);
    for (const c of extra) {
      // One key from elsewhere is as zero-length as one from the table; the pad is a no-op above one.
      skin.clips.push(M.padSingleFrame(c, 30));
      info.animations.push(c.name);
    }
  }
  if (parts) {
    // One GLB per mesh, each carrying the same skeleton so they can be bound to one at run time,
    // plus a rig of skeleton and animations alone that every part and every species shares.
    mkdirSync(parts.dir, { recursive: true });
    info.parts = [];
    // The live customization recipes and the images they draw from.
    if (recipes.length) {
      const palettes = exportPalettes(vfs, recipes.flatMap((r) => palettesOf(r)));
      writeFileSync(join(parts.dir, 'customize.json'), JSON.stringify({ images: 'customize/', recipes, palettes }, null, 1));
      info.recipes = recipes.length;
      info.images = registry.ids.size;
    }
    const rigFile = join(parts.dir, `${parts.rig ?? 'rig'}.glb`);
    writeFileSync(rigFile, buildGlb([], { flipX: true, skin, animations: skin.clips }));
    info.rig = { file: relative(parts.dir, rigFile), joints: skin.joints.length, clips: skin.clips.length };
    for (const mesh of meshes) {
      const file = join(parts.dir, `${mesh.name}.glb`);
      const own = new Map();
      for (const g of mesh.groups) if (textures.has(g.shader)) own.set(g.shader, textures.get(g.shader));
      writeFileSync(file, buildGlb([mesh], { flipX: true, textures: own, skin, keepZones: true }));
      info.parts.push({
        name: mesh.name,
        file: relative(parts.dir, file),
        bytes: statSync(file).size,
        triangles: mesh.groups.reduce((a, g) => a + g.primitives[0].indices.length / 3, 0),
        ...(mesh.blendTargets?.length ? { morphs: mesh.blendTargets.map((b) => b.name) } : {}),
        ...(mesh.extras ?? {}),
      });
    }
    return info;
  }
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, buildGlb(meshes, { flipX: true, textures, skin, animations: skin.clips }));
  return info;
}

/** Copy a building template's terrain modification layer (.lay) into <out>/terrain/. Returns the pack-relative file or null. */
function copyTerrainLayer(vfs, template, outDir, cache) {
  const raw = resolveTemplateString(vfs, template, ['terrainModificationFileName'], cache);
  if (!raw) return null;
  const path = raw.replace(/\\/g, '/').replace(/^\//, '');
  const rel = `terrain/${basename(path)}`;
  const target = join(outDir, rel);
  if (!existsSync(target)) {
    if (!vfs.has(path)) {
      console.warn(`terrain layer missing: ${path} (for ${template})`);
      return null;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, vfs.read(path));
  }
  return rel;
}

/** Yaw (rotation about Y) of a w,x,y,z quaternion: the heading of its forward vector. */
function yawOf(q) {
  const [w, x, y, z] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

/** Compare generated terrain heights with the snapshot's object heights. Needs Node 22.18+ (runs the game's TypeScript directly). */
async function terrainCheck(dir, limit, opts = {}) {
  const { parseTerrainTemplate, parseLayerFile, TerrainSampler, bitmapFiles, attachBitmap } = await import('../../src/swg/terrain/trn.ts');
  const trnPath = join(dir, 'terrain.trn');
  if (!existsSync(trnPath)) throw new Error(`${trnPath} missing; run the snapshot (or terrain) command first`);
  const t0 = Date.now();
  const template = parseTerrainTemplate(new Uint8Array(readFileSync(trnPath)));
  const gen = template.generator;
  console.log(`terrain ${template.name}: map ${template.mapWidthInMeters} m, chunk ${template.chunkWidthInMeters} m, ${template.numberOfTilesPerChunk} tiles/chunk (${template.tileWidthInMeters} m tiles), version ${template.version}, water ${template.useGlobalWaterTable ? template.globalWaterTableHeight : 'none'}, loaded in ${Date.now() - t0} ms`);
  console.log(`  layer items: ${Object.entries(gen.summary()).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  fractal families: ${gen.fractalGroup.families.size}, shader families: ${gen.shaderGroup.families.size}`);
  for (const b of bitmapFiles(template)) {
    const file = join(dir, b.file);
    const ok = existsSync(file) && attachBitmap(template, b.familyId, new Uint8Array(readFileSync(file)));
    console.log(`  bitmap family ${b.familyId} ${b.name}: ${ok ? `loaded from ${b.file}` : `${b.file} missing (re-run snapshot or terrain to convert it); filter passes everywhere`}`);
  }
  if (opts.layers) {
    console.log('  fractals:');
    for (const [id, f] of gen.fractalGroup.families) {
      const m = f.fractal;
      console.log(`    ${id} ${f.name}: seed ${m.seed} rule ${m.combinationRule} octaves ${m.numberOfOctaves} freq ${m.frequency} amp ${m.amplitude} scale ${m.scaleX},${m.scaleY} offset ${m.offsetX},${m.offsetY}${m.useBias ? ` bias ${m.bias}` : ''}${m.useGain ? ` gain ${m.gain}` : ''}`);
    }
    console.log('  layers:');
    for (const line of gen.describe()) console.log(`    ${line}`);
  }
  const sampler = new TerrainSampler(template);
  if (opts.at) {
    const [ax, az] = opts.at.split(',').map(Number);
    console.log(`  height at ${ax},${az}: ${sampler.heightAt(ax, az).toFixed(3)} (base terrain, before building layers)`);
    for (const line of sampler.trace(ax, az)) console.log(`    ${line}`);
  }
  const layoutPath = join(dir, 'layout.json');
  if (!existsSync(layoutPath)) {
    console.log('no layout.json: nothing to compare');
    return;
  }
  const layout = JSON.parse(readFileSync(layoutPath, 'utf8'));
  const objects = layout.objects.filter((o) => !o.contained);
  // Buildings first: their modification layers flatten the ground for everything else.
  let layers = 0;
  const t1 = Date.now();
  for (const o of objects) {
    if (!o.layer) continue;
    const file = join(dir, o.layer);
    if (!existsSync(file)) continue;
    const layer = parseLayerFile(new Uint8Array(readFileSync(file)), gen);
    if (!layer) continue;
    sampler.addBuildingLayer(layer, o.x, o.z, yawOf(o.q));
    layers++;
  }
  console.log(`  ${layers} building terrain layers applied in ${Date.now() - t1} ms`);
  if (opts.at) {
    const [ax, az] = opts.at.split(',').map(Number);
    sampler.invalidateAll();
    console.log(`  height at ${ax},${az} with building layers: ${sampler.heightAt(ax, az).toFixed(3)}`);
    for (const line of sampler.trace(ax, az)) console.log(`    ${line}`);
  }
  const t2 = Date.now();
  const rows = [];
  for (const o of objects) {
    const h = sampler.heightAt(o.x, o.z);
    rows.push({ o, h, err: h - o.y });
  }
  const ms = Date.now() - t2;
  const signed = rows.map((r) => r.err).sort((a, b) => a - b);
  const q = (p) => signed[Math.min(signed.length - 1, Math.floor(signed.length * p))];
  if (!rows.length) {
    console.log('  no snapshot objects to compare against');
    return;
  }
  console.log(`  signed error (generated - object): 10% ${q(0.1).toFixed(2)}, 25% ${q(0.25).toFixed(2)}, median ${q(0.5).toFixed(2)}, 75% ${q(0.75).toFixed(2)}, 90% ${q(0.9).toFixed(2)} m`);
  const bins = new Map();
  for (const e of signed) {
    const b = Math.max(-10, Math.min(10, Math.round(e)));
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  console.log(`  histogram (m -> objects): ${[...bins.entries()].sort((a, b) => a[0] - b[0]).map(([b, n]) => `${b}:${n}`).join(' ')}`);
  const abs = rows.map((r) => Math.abs(r.err)).sort((a, b) => a - b);
  const pct = (p) => abs[Math.min(abs.length - 1, Math.floor(abs.length * p))];
  console.log(`  ${rows.length} objects sampled in ${ms} ms (${sampler.blockWidth} m blocks of ${sampler.numberOfPoles}x${sampler.numberOfPoles} poles)`);
  console.log(`  |height error| median ${pct(0.5).toFixed(2)} m, 90% ${pct(0.9).toFixed(2)} m, max ${abs[abs.length - 1].toFixed(2)} m; within 0.5 m: ${((abs.filter((a) => a <= 0.5).length / abs.length) * 100).toFixed(1)}%`);
  const nan = rows.filter((r) => !Number.isFinite(r.h)).length;
  if (nan) console.log(`  WARNING: ${nan} non-finite heights`);
  rows.sort((a, b) => Math.abs(b.err) - Math.abs(a.err));
  console.log(`  worst ${Math.min(limit, rows.length)}:`);
  for (const r of rows.slice(0, limit)) console.log(`    ${r.err >= 0 ? '+' : ''}${r.err.toFixed(2)} m  at ${r.o.x.toFixed(1)},${r.o.z.toFixed(1)} object y ${r.o.y.toFixed(2)} generated ${r.h.toFixed(2)}  ${r.o.template}${r.o.layer ? ` [${r.o.layer}]` : ''}`);
  const withLayer = rows.filter((r) => r.o.layer);
  if (withLayer.length) {
    const la = withLayer.map((r) => Math.abs(r.err)).sort((a, b) => a - b);
    console.log(`  buildings with layers: ${withLayer.length}, median |error| ${la[Math.floor(la.length / 2)].toFixed(2)} m`);
  }
}

/** A planet's objects from both placement sources: the world snapshot and the buildout areas. */
function loadPlanetObjects(vfs, planet) {
  // The launch planets ship a world snapshot; the expansions' planets place everything through
  // buildout tables and have none, so an empty snapshot is fine as long as buildouts exist.
  const wsPath = `snapshot/${planet}.ws`;
  const hasBuildouts = vfs.has(`datatables/buildout/areas_${planet}.iff`);
  if (!vfs.has(wsPath) && !hasBuildouts) throw new Error(`no ${wsPath} and no datatables/buildout/areas_${planet}.iff in archives`);
  const snap = vfs.has(wsPath) ? parseSnapshot(parseIff(vfs.read(wsPath))) : { version: 'none', templates: [], nodes: [] };
  // --ws-add=<archive>@x1,z1,x2,z2 brings back objects an older publish's snapshot placed inside a
  // rectangle (a city the final client no longer carries, such as pre-battle Restuss).
  if (options['ws-add']) {
    const [archive, rect] = options['ws-add'].split('@');
    const [x1, z1, x2, z2] = (rect ?? '').split(',').map(Number);
    if (![x1, z1, x2, z2].every(Number.isFinite)) throw new Error('--ws-add needs <archive>@x1,z1,x2,z2');
    const old = parseSnapshot(parseIff(vfs.readFrom(wsPath, archive)));
    const templateIndex = new Map(snap.templates.map((t, i) => [t, i]));
    let added = 0;
    const remap = (n) => {
      const template = old.templates[n.templateIndex];
      let ti = templateIndex.get(template);
      if (ti === undefined) {
        ti = snap.templates.length;
        snap.templates.push(template);
        templateIndex.set(template, ti);
      }
      added++;
      return { ...n, id: n.id + (1 << 28), containedBy: n.containedBy ? n.containedBy + (1 << 28) : 0, templateIndex: ti, children: (n.children ?? []).map(remap), wsAdd: true };
    };
    for (const n of old.nodes) {
      const [x, , z] = n.pos;
      if (x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && z >= Math.min(z1, z2) && z <= Math.max(z1, z2)) snap.nodes.push(remap(n));
    }
    console.error(`snapshot from ${archive}: ${added} objects added inside ${x1},${z1} to ${x2},${z2}`);
  }
  const snapshotCount = snap.nodes.length;
  const buildout = loadBuildouts(vfs, planet, { events: flags.has('--events') });
  mergeBuildouts(snap, buildout);
  // Server placements (SWGEmu's scripts) are a third source, when a checkout is given.
  const core3 = options.core3 ?? process.env.CORE3;
  let spawns = null;
  if (core3) {
    spawns = scanServerSpawns(core3, planet);
    let nextId = 1 << 29;
    const extra = spawns.objects.map((o) => ({ id: nextId++, containedBy: 0, template: o.template, cellIndex: 0, q: o.q, pos: o.pos, radius: 4, portalLayoutCrc: 0, children: [], area: `server:${o.file}` }));
    mergeBuildouts(snap, { nodes: extra });
  }
  const entries = flattenWithWorldTransforms(snap);
  return { snap, entries, snapshotCount, buildout: buildout.stats, spawns, core3 };
}

/** The creature each planet spawns (src/data/planets.ts) and the mobile template that draws it. */
const CREATURES = {
  bantha: 'object/mobile/shared_bantha.iff',
  kaadu: 'object/mobile/shared_kaadu.iff',
  durni: 'object/mobile/shared_durni.iff',
  bol: 'object/mobile/shared_bol.iff',
  kimogila: 'object/mobile/shared_kimogila.iff',
  boar_wolf: 'object/mobile/shared_boar_wolf.iff',
  rancor: 'object/mobile/shared_rancor.iff',
  mawgax: 'object/mobile/shared_mawgax.iff',
  kahmurra: 'object/mobile/shared_kahmurra.iff',
  torton: 'object/mobile/shared_torton.iff',
  lava_flea: 'object/mobile/som/shared_lava_flea.iff',
  webweaver: 'object/mobile/shared_webweaver.iff',
};
/** Logical animations (substrings) the game drives creatures with. */
const CREATURE_CLIPS = 'idle,walk,run,cbt_stand_combat_attack_light,rea_stand_get_hit_light,trn_stand_to_incapacitated,loop_incapacitated';

/** The player's clips: locomotion and posture by exact name (=), reactions by substring. */
/** What the player wears when --wear is not given: a plain shirt, trousers and shoes. */
const DEFAULT_WEAR = ['object/tangible/wearables/shirt/shared_shirt_s03.iff', 'object/tangible/wearables/pants/shared_pants_s01.iff', 'object/tangible/wearables/shoes/shared_shoes_s01.iff'];
const PLAYER_CLIPS = '=idle,=walk,=run,=idle_combat,=walk_combat,=run_combat,=jump,strafe,backward,walk_back,run_back,loop_crouched,loop_kneeling,loop_prone,trn_standing_to_crouched,trn_crouched_to_standing,trn_standing_to_kneeling,trn_kneeling_to_standing,trn_crouched_to_kneeling,trn_kneeling_to_prone,trn_prone_to_kneeling,trn_standing_to_prone,trn_prone_to_standing,loop_pistol_standing,loop_rifle:,loop_pistol_riding,loop_rifle_riding,loop_riding,loop_ride,loop_combat_standing,loop_pistol_kneeling,loop_rifle_kneeling,loop_pistol_prone,loop_rifle_prone,loop_pistol_combat_prone,loop_rifle_combat_prone,add_pistol_fire,add_rifle_fire,pistol_combat_prone_fire,rifle_combat_prone_fire,pistol_reload,rifle_reload,loop_pistol_combat_standing,loop_rifle_combat_standing,loop_rifle_a_combat,loop_pistol_combat_kneeling,loop_rifle_combat_kneeling,loop_rifle_kneeling_combat,loop_pistol_kneeling_combat,pistol_combat_standing_fire,rifle_combat_standing_fire,rifle_standing_aimed_fire,pistol_standing_aimed_fire,pistol_combat_kneeling_fire,rifle_combat_kneeling_fire,pistol_kneeling_fire,rifle_kneeling_fire,trn_pistol_standing_to_pistol_combat,trn_rifle_a_standing,trn_pistol_combat_to_pistol_combat_aimed,trn_pistol_combat_standing_aimed_to,trn_pistol_combat_standing_to,trn_rifle_combat_standing_to,trn_rifle_combat_standing_aimed_to,trn_pistol_combat_kneeling,trn_rifle_combat_kneeling,trn_pistol_combat_prone_to,trn_rifle_combat_prone_to,trn_pistol_combat_prone_aimed_to,trn_rifle_combat_prone_aimed_to,loop_sitting_chair,loop_sitting_ground,trn_sitting_chair_to_standing,trn_standing_to_sitting_ground,=loop_swimming:speed0,=loop_swimming:speed1,unarmed_standing_ready_,unarmed_combo_,trn_unarmed_standing_ready_to_standing,=sword_1h_standing_ready_hrz_slash_middle_r,=rea_get_hit_medium_mid_center,=trn_combat_standing_hit_to_incapacitated_face_up,=loop_incapacitated_face_up,=cbt_stand_combat_attack_light,=rea_stand_get_hit_light,=trn_stand_to_incapacitated,=loop_incapacitated' +
  // The emotes (every emt_ clip), the dances (loop_skill's speed2 branch is the dance and music
  // loops, one per style; skill_action_1..8 the flourishes, one per style each) and the sits.
  ',emt_,loop_skill:speed2,skill_action_,dance_';
/** Clips a player rig keeps at most: the locomotion, carries, emotes, dances and flourishes come to about a thousand. */
const PLAYER_MAX_CLIPS = 1400;
const PLAYER_TEMPLATE = 'object/creature/player/shared_human_male.iff';
/** A mood branch of a locomotion clip, as the mood pass names one: `idle:calm`, `walk:angry`. */
const MOOD_CLIP = /^(idle|walk|run)(_combat)?:[a-z0-9_]+$/i;
/** How many mood values a pack's mood clips carry between them, out of its own `variants`. */
function moodValues(variants, clips) {
  let n = 0;
  for (const c of clips) {
    const v = (variants ?? {})[c];
    if (v?.variable === 'mood') n += v.values?.length ?? 0;
  }
  return n;
}

/** Planet ids the game can load a pack for (see src/data/planets.ts). */
const GAME_PLANETS = ['tatooine', 'naboo', 'corellia', 'dantooine', 'lok', 'endor', 'dathomir', 'yavin4', 'talus', 'rori', 'mustafar', 'kashyyyk_main', 'kashyyyk_hunting', 'kashyyyk_dead_forest', 'kashyyyk_rryatt_trail', 'kashyyyk_north_dungeons', 'kashyyyk_south_dungeons', 'kashyyyk_pob_dungeons'];

/**
 * Report what the packs under <dir> hold (planets, creatures, player) and which command
 * would fill each gap, so a fresh checkout or a second machine knows what to run.
 */
/**
 * How many of a sky's effects (its weather and its blocks' camera effects) carry an effect the pack
 * has nothing to play for: an attachment with neither a converted `file` nor a reason it `failed`,
 * and no converted effect of that name in the pack. That is a sky converted before the converter
 * converted what particles carry (a light dust storm, falling leaves, Mustafar's lightning).
 */
function skyEffectsUncarried(packDir, sky) {
  const files = new Set();
  for (const list of Object.values(sky.weather?.effects ?? {})) for (const f of list ?? []) if (f) files.add(f);
  for (const b of sky.blocks ?? []) if (b.cameraEffect?.file) files.add(b.cameraEffect.file);
  let n = 0;
  for (const f of files) {
    let effect;
    try {
      effect = JSON.parse(readFileSync(join(packDir, f), 'utf8'));
    } catch {
      continue;
    }
    const bare = (a) => a?.path && !a.file && !a.failed && !existsSync(join(packDir, 'particles', `fx_${basename(a.path.replace(/\\/g, '/')).replace(/\.prt$/i, '')}.json`));
    if ((effect.groups ?? []).some((g) => (g.emitters ?? []).some((e) => (e.particle?.attachments ?? []).some(bare)))) n++;
  }
  return n;
}

function packStatus(dir) {
  // A file that is there but will not parse (a conversion stopped or a machine that lost power in
  // the middle of writing it) is taken as missing, so the step that writes it is asked for again,
  // and is named once, so the report says why: a stack trace here would leave nothing to resume by.
  const unreadable = new Set();
  const readJson = (file) => {
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      if (!unreadable.has(file)) {
        unreadable.add(file);
        console.log(`  ${relative(dir, file).split(sep).join('/')}: cannot be read (cut short while it was written?); taken as missing`);
      }
      return null;
    }
  };
  const todo = new Map();
  // Carried beside the to-do for `status --json`, whose caller sets those files aside before it runs anything.
  todo.unreadable = unreadable;
  const need = (cmd, why) => {
    if (!todo.has(cmd)) todo.set(cmd, []);
    todo.get(cmd).push(why);
  };
  console.log(`packs under ${dir}:`);
  let planets = 0;
  for (const planet of GAME_PLANETS) {
    const packDir = join(dir, planet);
    const manifest = readJson(join(packDir, 'manifest.json'));
    if (!manifest) {
      console.log(`  ${planet}: no pack`);
      need(`snapshot <swg-dir> all ${dir} --radius=all --retail-only`, `${planet} has no pack`);
      continue;
    }
    planets++;
    const layout = readJson(join(packDir, 'layout.json'));
    const objects = layout ? layout.objects.length : 0;
    const flora = Object.keys(manifest.categories?.flora ?? {}).length;
    const pois = readJson(join(packDir, 'pois.json'));
    const gates = readJson(join(packDir, 'gates.json'));
    const terrain = existsSync(join(packDir, 'terrain.trn'));
    const shaders = readJson(join(packDir, 'terrain/shaders.json'));
    const textured = shaders ? shaders.families.filter((f) => f.file).length : 0;
    const layers = existsSync(join(packDir, 'terrain')) ? readdirSync(join(packDir, 'terrain')).filter((f) => f.endsWith('.lay')).length : 0;
    const sky = readJson(join(packDir, 'sky.json'));
    const water = readJson(join(packDir, 'water.json'));
    // The cells' walkable floors, which a pack converted before they were read simply has not got:
    // the game falls back to walking straight at what it wants, so this asks rather than warns.
    const withCells = (manifest.categories?.layout ?? []).filter((m) => m.cells && m.cells.length);
    // Gated on the version the game reads, or a file written in an older shape would be counted
    // here and passed over there: the pack would read as floored and the game would have none.
    const floors = readJson(join(packDir, 'floors.json'));
    const floorsRead = floors?.models && floors.version === FLOOR_PACK_VERSION ? floors : null;
    const floored = floorsRead ? withCells.filter((m) => floorsRead.models[m.id]).length : 0;
    // An entry with no cells in it is a building that was read and has no floor in the archives,
    // which is not the same as one nobody has looked at and must not read as a gap forever.
    const floorless = floorsRead ? withCells.filter((m) => floorsRead.models[m.id] && !Object.keys(floorsRead.models[m.id]).length).length : 0;
    const graphOnly = !!floorsRead && floorsRead.mesh === false;
    // The ground this world can be walked on. Gated on the version the game reads, as the floors
    // are, or a file written in an older shape would read as done here and be passed over there.
    const navRead = readJson(join(packDir, 'nav.json'));
    const navGrid = navRead && navRead.version === NAV_GRID_VERSION && navRead.nx ? navRead : null;
    // Two things a grid can be wrong about in a way nothing else would ever notice.
    //
    // Its frame: every cell's place is derived from the pack's centre at the moment it was baked,
    // so a world re-snapshotted around a different centre leaves a grid that loads, reports its
    // size cheerfully and stands the whole difference away from the ground it describes. A grid
    // baked before the centre was written down cannot be checked and is not complained about.
    //
    // Its buildings: a bake whose manifest entries carried no `cells` marks not one indoor cell,
    // so every building's inside is open ground and a route may cut through one. The bake says so
    // at the time; this is the half that is still there tomorrow.
    const navMoved = navGrid && navGrid.center && layout?.center
      && (Math.abs(navGrid.center.x - layout.center.x) > 0.5 || Math.abs(navGrid.center.z - layout.center.z) > 0.5);
    const navNoIndoor = navGrid && navGrid.stats && navGrid.stats.buildings > 0 && !navGrid.stats.indoor;
    // Its towns: a town whose ground is not the main walkable region and which the main region does
    // not reach within `GOAL_SNAP` is a town every errand to is answered 'unreachable', and the one
    // thing the slope angle can do that nothing else would notice. It is said here and not asked
    // for, because re-running the same bake will not mend it -- only another angle will, which is
    // the owner's choice and not a job. A grid baked before towns were recorded has no list and is
    // not complained about, as a pack with no floors is not.
    const navCut = Array.isArray(navGrid?.towns)
      ? navGrid.towns.filter((t) => t.region !== 1 && (t.rank1 === null || t.rank1 > GOAL_SNAP))
      : [];
    const parts = [
      `${objects} objects`,
      `${flora} flora models`,
      // A pack written before the client's table was read carries no count of it at all, which is
      // not the same thing as having read it and found none: say which, and say how many when known.
      pois ? `${(pois.pois ?? pois).length ?? 0} places${pois.clientPlaces === undefined ? ' (the client\'s own not read yet)' : `, ${pois.clientPlaces} the client's own`}` : 'no pois.json',
      // Only worth a word where there are any: every world but one has none, and saying "0 gates"
      // on ten planets would bury the one line that matters.
      gates ? `${gates.gates.length} zone gates${gates.gates.filter((g) => !g.to).length ? `, ${gates.gates.filter((g) => !g.to).length} leading nowhere named` : ''}` : null,
      terrain ? `terrain${layers ? ` + ${layers} building layers` : ''}` : 'NO TERRAIN',
      shaders ? `ground textures ${textured}/${shaders.families.length}` : 'NO GROUND TEXTURES',
      sky ? `sky (${sky.blocks.length} blocks${sky.weather ? `, weather ${new Set(sky.blocks.map((b) => b.cameraEffect?.file).filter(Boolean)).size} effects` : ', NO WEATHER'})` : 'NO SKY',
      water ? `water (${Object.keys(water.shaders ?? {}).length} shaders, ${Object.values(water.shaders ?? {}).filter((s) => s.kind === 'lava').length} lava${waterPackNeedsHarm(water) ? ', NO WATER VALUES' : ''})` : terrain ? 'NO WATER LOOK' : null,
      withCells.length ? (floored ? `floors ${floored}/${withCells.length} buildings${graphOnly ? ', GRAPHS ONLY (no walkable meshes)' : ''}${floorless ? `, ${floorless} with none in the archives` : ''}` : 'NO FLOORS') : null,
      // The outdoor walkability grid. A world without one plays exactly as it always did, so this
      // says what is there rather than shouting, and asks for it once below.
      // The angle is in the line because it is the owner's own choice and moves what the grid
      // says: a world baked at one and its neighbour at another would steer two different ways
      // with nothing anywhere to show it.
      navGrid ? `nav grid ${navGrid.nx}x${navGrid.nz} at ${navGrid.cell} m, ${navGrid.slopeDegrees ?? '?'} deg${navMoved ? ', BAKED AROUND ANOTHER CENTRE' : ''}${navNoIndoor ? ', NO BUILDING FOOTPRINTS' : ''}${navCut.length ? `, ${navCut.length} TOWN${navCut.length === 1 ? '' : 'S'} OFF THE MAIN REGION` : ''}` : 'no nav grid',
    ].filter(Boolean);
    console.log(`  ${planet}: ${parts.join(', ')}`);
    if (navCut.length) {
      console.log(`    at ${navGrid.slopeDegrees} degrees the largest walkable region does not reach within ${GOAL_SNAP} m of ${navCut.map((t) => `${t.name} (${t.rank1 === null ? 'over 400' : t.rank1} m)`).join(', ')}: a body sent to one is told it cannot get there and steers the whole way, as it did before there was a grid. Only the angle moves this -- re-bake with --slope=<higher> to see what it costs.`);
    }
    if (!objects) need(`snapshot <swg-dir> ${planet} ${packDir} --center=auto --radius=all --retail-only`, `${planet} has no objects`);
    if (!terrain) need(`snapshot <swg-dir> ${planet} ${packDir} --center=auto --radius=all --retail-only`, `${planet} has no terrain`);
    else if (!shaders) need(`terrain <swg-dir> all ${dir} --retail-only`, `${planet} has no ground textures`);
    else if (!sky) need(`sky <swg-dir> all ${dir} --retail-only`, `${planet} has no sky`);
    else if (!sky.weather) need(`sky <swg-dir> all ${dir} --retail-only`, `${planet} sky has no weather effects`);
    else if (skyEffectsUncarried(packDir, sky)) need(`sky <swg-dir> all ${dir} --retail-only`, `${planet} sky's effects were converted before the effects their particles carry`);
    if (withCells.length && floored < withCells.length) need(`snapshot <swg-dir> ${planet} ${packDir} --center=auto --radius=all --retail-only`, `${planet}'s buildings have no walkable floors (${withCells.length - floored} of ${withCells.length})`);
    // A graph with no mesh under it looks complete and cannot funnel a body through a doorway, so
    // it is asked for again rather than counted as done. Drop --floors-graph-only to mend it.
    else if (withCells.length && graphOnly) need(`snapshot <swg-dir> ${planet} ${packDir} --center=auto --radius=all --retail-only`, `${planet}'s buildings were converted with --floors-graph-only: path graphs, no walkable meshes`);
    // Its own `if`, because it needs no archives at all and nothing above it can fill it.
    if (terrain && objects && !navGrid) need(`navgrid ${planet} ${dir}`, `${planet} has no outdoor walkability grid: bodies outdoors steer straight at their goal`);
    else if (navMoved) need(`navgrid ${planet} ${dir}`, `${planet}'s nav grid was baked around the centre ${navGrid.center.x},${navGrid.center.z} and the pack's is now ${layout.center.x},${layout.center.z}: every cell in it is that far from the ground it describes`);
    else if (navNoIndoor) need(`navgrid ${planet} ${dir}`, `${planet}'s nav grid has ${navGrid.stats.buildings} portal buildings and no footprints for any of them: a route may cut straight through one`);
    // Its own `if`: exportWater always writes the file, so its existence is the whole test.
    if (terrain && !water) need(`water <swg-dir> all ${dir} --retail-only`, `${planet} has no water.json`);
    // A lava entry written before the lava look has no `lava` block: the game draws it in a stand-in look.
    else if (water && Object.values(water.shaders ?? {}).some((s) => s.kind === 'lava' && !s.missing && s.lava === undefined && /lava/i.test(s.effect ?? ''))) need(`water <swg-dir> all ${dir} --retail-only`, `${planet}'s water.json has no lava look`);
    // And a pack with lava in it but no harm block was converted before the client's water values
    // were read; a pack with no lava is never asked, since nothing there could burn anyone.
    else if (waterPackNeedsHarm(water)) need(`water <swg-dir> all ${dir} --retail-only`, `${planet}'s water.json has lava but none of the client's water values`);
    if (!pois) need(`pois <swg-dir> all ${dir} --retail-only`, `${planet} has no pois.json`);
    // A file written before the client's own table was read carries no count of it at all; one that
    // read the table and found nothing there (the tree world's trail and dungeon zones) carries 0.
    else if (pois.clientPlaces === undefined) need(`pois <swg-dir> all ${dir} --retail-only`, `${planet}'s places were written before the client's own named places were read`);
    // A world whose layout carries gates between its zones but no gates.json was converted before the
    // join was written: those gates stand there doing nothing and nothing else would say so.
    if (!gates && layout && layout.objects.some((o) => isZoneGate(o.template))) need(`pois <swg-dir> all ${dir} --retail-only`, `${planet}'s zone gates have no destinations`);
    if (objects && (manifest.materialFormat ?? 1) < MATERIAL_FORMAT) need(`snapshot <swg-dir> all ${dir} --radius=all --retail-only`, `${planet}'s models were converted before animated and glowing surfaces`);
  }
  const creatures = readJson(join(dir, 'creatures/manifest.json'));
  if (!creatures) {
    console.log('  creatures: none');
    need(`creatures <swg-dir> ${dir} --retail-only`, 'no creatures converted');
  } else {
    const have = new Set(creatures.creatures.map((c) => c.id));
    const missing = Object.keys(CREATURES).filter((id) => !have.has(id));
    console.log(`  creatures: ${have.size} (${[...have].join(', ')})${missing.length ? `; missing ${missing.join(', ')}` : ''}`);
    if (missing.length) need(`creatures <swg-dir> ${dir} --retail-only`, `creatures missing: ${missing.join(', ')}`);
    // The mounts' saddles: hung on the creature's own saddle hardpoint, on the back where it is guessed, on its own rider point, or none in the tables.
    const saddles = saddleStatus(creatures.creatures, (f) => existsSync(join(dir, f)));
    console.log(`  saddles: ${saddles.onHardpoint} on the creature's own hardpoint, ${saddles.guessed} where the back is guessed, ${saddles.rider} on its own rider point, ${saddles.none} with none in the tables`);
    if (saddles.stale.length) need(`creatures <swg-dir> ${dir} --retail-only`, 'the mounts carry no saddles: converted before saddles were');
    if (saddles.missingFiles.length) need(`creatures <swg-dir> ${dir} --retail-only`, `saddle models missing: ${saddles.missingFiles.join(', ')}`);
  }
  const player = readJson(join(dir, 'player/manifest.json'));
  if (!player || !player.players?.length) {
    console.log('  player: none (the placeholder rig is used)');
    need(`player <swg-dir> ${dir} --retail-only`, 'no player character converted');
  } else {
    const p = player.players[0];
    const wear = p.wear?.length ? `${p.wear.length} wearables` : 'NO CLOTHES';
    const swims = p.clips.some((c) => /swim/i.test(c));
    console.log(`  player: ${p.id} (${p.template}), ${wear}, ${p.clips.length} clips${swims ? '' : ', NO SWIMMING CLIPS'}`);
    // The clips each posture and carry the game plays needs; a rig converted before they were listed lacks them.
    const POSTURE_CLIPS = [
      ['crouch', /^loop_crouched:speed[01]/],
      ['prone', /^loop_prone:speed[01]/],
      ['pistol', /^loop_pistol_(standing|combat)/],
      ['rifle', /^loop_rifle(_combat)?:speed/],
      ['prone blaster', /^loop_(pistol|rifle)_combat_prone/],
      ['combat stance', /^loop_combat_standing:speed/],
      ['kneel', /^loop_kneeling/],
      ['blaster shots', /^add_(pistol|rifle)_fire/],
    ];
    const lacking = (names) => POSTURE_CLIPS.filter(([, re]) => !names.some((c) => re.test(c))).map(([what]) => what);
    const playerLacks = lacking(p.clips);
    if (playerLacks.length) console.log(`  player clips missing: ${playerLacks.join(', ')}`);
    if (!Object.keys(p.jkaClips ?? {}).length) console.log('  player: no Jedi Academy clips (saber swings, jumps, rolls): add --jka=<jka-dir> to the player command, then re-run parts, clips-save and clips-apply');
    // The mood branches of the standing loop: `idle:<mood>` clips, with the values each carries in
    // `variants`. A pack converted before them has none and the body stands the same whatever
    // mood is set, which is a thing to say rather than a thing to leave the owner to notice.
    // `moods: false` in the manifest is --no-moods: the owner weighed the 5 MB against the pose
    // and left them out, which is an answer and not a gap, so nothing is asked for again.
    const moodClips = (names) => names.filter((c) => MOOD_CLIP.test(c));
    const playerMoods = moodClips(p.clips);
    const playerNoMoods = p.moods === false;
    if (playerNoMoods) console.log('  player: moods left out on purpose (--no-moods); the body stands the same whatever mood is set');
    else if (!playerMoods.length) console.log('  player: no mood branches (the body stands the same whatever mood is set)');
    else console.log(`  player moods: ${playerMoods.length} branches over ${moodValues(p.variants, playerMoods)} values`);
    // The bundle itself, which is what carries the Jedi Academy clips onto every rig the conversion
    // writes: the parts rig through clips-apply, and each playable species through the species
    // command, which reads it directly. It is asked for here rather than only beside the parts rig
    // (below), because `status` cannot see the parts rig on the round the player pack first appears
    // and the bundle is what everything downstream waits on.
    const jkaBundle = join(dir, 'player', 'jka.clips');
    if (Object.keys(p.jkaClips ?? {}).length && !existsSync(jkaBundle)) {
      need(`clips-save ${join(dir, p.file)} ${jkaBundle} --only=BOTH_`, 'the player pack has Jedi Academy clips and no bundle to carry them to the rigs');
    }
    if (!p.wear?.length) need(`player <swg-dir> ${dir} --retail-only`, 'the player has no clothes');
    else if (!swims) need(`player <swg-dir> ${dir} --retail-only`, 'the player lacks the swimming clips');
    else if (playerLacks.length) need(`player <swg-dir> ${dir} --retail-only${p.jkaClips ? ' --jka=<jka-dir>' : ''}`, `the player lacks the ${playerLacks.join(', ')} clips`);
    else if (!playerMoods.length && !playerNoMoods) need(`player <swg-dir> ${dir} --retail-only${p.jkaClips ? ' --jka=<jka-dir>' : ''}`, 'the player has no mood branches: converted before the moods');
    // The parts pack the game prefers: it must carry the named locomotion clips, and the Jedi Academy clips travel to it by bundle.
    const partsFile = join(dir, 'characters', p.id, 'parts.json');
    const partsManifest = readJson(partsFile);
    if (partsManifest) {
      const clipNames = new Set([...(partsManifest.clips ?? []), ...Object.keys(partsManifest.clipSpeeds ?? {}), ...Object.keys(partsManifest.jkaClips ?? {})]);
      const walks = clipNames.has('walk') && clipNames.has('run') && clipNames.has('idle');
      const jkaCount = Object.keys(partsManifest.jkaClips ?? {}).length;
      const playerJka = Object.keys(p.jkaClips ?? {}).length;
      console.log(`  parts: ${partsManifest.parts?.length ?? 0} parts, rig ${partsManifest.rig?.clips ?? '?'} clips${walks ? '' : ', NO WALK/RUN/IDLE CLIPS (the game falls back to the single model)'}${jkaCount ? `, ${jkaCount} Jedi Academy clips` : ''}`);
      if (!walks && !partsManifest.clips) console.log('  (an older parts.json does not list its clips; re-run parts to be sure)');
      if (!walks) need(`parts <swg-dir> ${dir} --retail-only`, 'the parts rig lacks the named idle, walk and run clips');
      const partsLacks = lacking([...clipNames]);
      if (partsLacks.length) {
        console.log(`  parts clips missing: ${partsLacks.join(', ')} (the game plays the parts rig, so the player's clips do not reach it until parts is rerun)`);
        need(`parts <swg-dir> ${dir} --retail-only`, `the parts rig lacks the ${partsLacks.join(', ')} clips`);
      }
      if (playerJka && jkaCount < playerJka) need(`clips-save ${join(dir, p.file)} ${join(dir, 'player', 'jka.clips')} --only=BOTH_ && clips-apply ${join(dir, 'characters', p.id, 'rig.glb')} ${join(dir, 'player', 'jka.clips')}`, `the parts rig has ${jkaCount} of the player's ${playerJka} Jedi Academy clips`);
      // The parts rig is what the game plays, so a mood the player pack has and it has not is a
      // mood nobody ever sees.
      const partsMoods = moodClips([...clipNames]);
      if (partsManifest.moods === false) console.log('  parts: moods left out on purpose (--no-moods)');
      else if (!partsMoods.length) {
        console.log('  parts: no mood branches (the game plays the parts rig, so the player pack\'s moods do not reach it until parts is rerun)');
        need(`parts <swg-dir> ${dir} --retail-only`, 'the parts rig has no mood branches');
      } else console.log(`  parts moods: ${partsMoods.length} branches over ${moodValues(partsManifest.variants, partsMoods)} values`);
    }
  }
  const weapons = readJson(join(dir, 'weapons/manifest.json'));
  if (!weapons) {
    console.log('  weapons: none (the placeholder saber and rifle are used)');
    need(`weapons <swg-dir> ${dir} --retail-only`, 'no weapons converted for the rack (I in game, the Weapons tab)');
  } else {
    const items = itemPackStatus(weapons.weapons);
    // A weapon effect's sounds: the older packs kept one sound for the muzzle and one for a hit on a
    // creature, and nothing for the other four surfaces, the eight misses or the ricochet. A pack that
    // kept them all writes `hit` as the five columns rather than as one name.
    const withFx = (weapons.weapons ?? []).filter((w) => w.fx?.sounds);
    const perSurface = withFx.filter((w) => w.fx.sounds.hit && typeof w.fx.sounds.hit === 'object' && !Array.isArray(w.fx.sounds.hit)).length;
    console.log(`  weapons: ${weapons.weapons?.length ?? 0} on the rack, ${weapons.skipped?.length ?? 0} left out; ${items.named} named, ${items.slotted} with slots, ${items.iconed} icons, ${perSurface} of ${withFx.length} with every sound their effect names`);
    if (items.missingKeys) need(`weapons <swg-dir> ${dir} --retail-only`, 'the weapons carry no names, slots or icons (the backpack needs them)');
    else if (withFx.length && !perSurface) need(`weapons <swg-dir> ${dir} --retail-only`, 'the weapons keep one sound per effect (a bolt into water, into the ground or into nothing falls back on the plain blaster)');
    // The effects beyond the guns' own rows: the held triggers' beams and the burn a body wears when
    // it has been set alight. Every one of them is in the retail archives, so anything missing is a
    // rerun away and this asks rather than fails. One ask names all of them: the burn used to have a
    // branch of its own that swallowed the others, so a pack short of the ice beam as well was never
    // told about it until the burn was mended.
    const fx = extraEffectsStatus(weapons.effects);
    console.log(`  weapon effects: ${fx.line}`);
    if (fx.missing.length) {
      const alight = fx.missing.includes('onfire') ? '; a body set alight is drawn with no fire at all until it is there' : '';
      need(`weapons <swg-dir> ${dir} --retail-only`, `the pack has no ${fx.missing.join(', ')} effect${fx.missing.length > 1 ? 's' : ''}${alight}`);
    }
    // The Force's own effects travel in the same pack. A pack converted before them has no `powers`
    // block at all and every power throws the same spark; an older block is asked for again too.
    const force = forcePowersStatus(weapons.powers);
    console.log(`  the Force: ${force.line}`);
    if (!force.has) need(`weapons <swg-dir> ${dir} --retail-only`, 'the Force powers have none of the game\'s own effects (every power throws the same spark)');
    else if (force.old) need(`weapons <swg-dir> ${dir} --retail-only`, 'the Force powers were converted before the beams and the sounds were written');
  }
  // The wardrobe folders (optional, as the README says): what the backpack can show of each; the to-do comes from
  // the same table the mobiles block uses, so the two can never ask for different commands.
  const wardrobeRoot = join(dir, 'wardrobe');
  if (existsSync(wardrobeRoot)) {
    for (const folder of readdirSync(wardrobeRoot).sort()) {
      let wardrobe = null;
      try {
        wardrobe = readJson(join(wardrobeRoot, folder, 'wardrobe.json'));
      } catch {
        wardrobe = null;
      }
      if (!wardrobe) continue;
      const items = itemPackStatus(wardrobe.items);
      console.log(`  wardrobe ${folder}: ${items.items} items (${items.named} named, ${items.slotted} with slots, ${items.iconed} icons, ${items.fitted} with species rules, ${items.unseen} worn unseen)`);
      if (items.missingKeys && folder in M.WARDROBE_RUNS) need(`wardrobe <swg-dir> ${dir} --retail-only${M.WARDROBE_RUNS[folder]}`, `wardrobe/${folder} has no item names, slots or icons (the backpack needs them)`);
    }
  }
  const speciesIndex = readJson(join(dir, 'characters/index.json'));
  if (speciesIndex?.species?.length) {
    console.log(`  species: ${speciesIndex.species.map((sp) => `${sp.id} (${sp.morphs.length} sliders, ${sp.variables.length} variables${sp.jkaClips ? '' : ', NO Jedi Academy clips'})`).join(', ')}`);
    // A species rig takes its saber swings, jumps and rolls from the bundle, and the species command
    // carries on with a word when the bundle is not there yet -- which is what a first conversion
    // does, since the bundle is made after the player pack. Nothing ever asked for the species
    // again, so a conversion could report itself complete with the saber moves on the one rig
    // clips-apply writes and on no other, which is how a whole install can end up silently unable
    // to swing. The bundle on disk is the question and not the player pack's own count: a player
    // pack re-run without --jka carries none of its own while the rigs already have theirs.
    // Each rig's own parts.json and not the index's copy of the count: the index is written by the
    // species run and never again, so a rig that got its clips afterwards (which is exactly what
    // clips-apply does to the parts rig) still reads as having none there.
    const withoutJka = existsSync(join(dir, 'player', 'jka.clips'))
      ? speciesIndex.species.filter((sp) => !Object.keys(readJson(join(dir, 'characters', sp.id, 'parts.json'))?.jkaClips ?? {}).length)
      : [];
    if (withoutJka.length) {
      const names = withoutJka.slice(0, 4).map((sp) => sp.id).join(', ');
      need(`species <swg-dir> ${dir} --retail-only`, `${withoutJka.length} of the ${speciesIndex.species.length} playable species have no Jedi Academy clips (no saber swings, jumps or rolls): ${names}${withoutJka.length > 4 ? ' and more' : ''}`);
    }
    // And the aimed blaster poses, which are the same shape of hole from the other end. The
    // direction selector's tag was read wrong for years, so every standing and kneeling *aimed*
    // stance was dropped on the way out of the archives; the prone ones survived, because no
    // direction selector stands over them, which is why looking for "aimed" alone finds twelve
    // clips and proves nothing. `player`, `parts` and `species` keep **no format stamp at all**,
    // so unlike the mobiles pack there is nothing for `status` to compare and nothing would ever
    // ask for these again. And the game does not complain: it asks for the pose by pattern and
    // falls back on the last frame of a transition, which reads as a body that freezes rather
    // than one that is missing an animation.
    const aimedStanding = (m) => {
      const names = [...(m?.clips ?? []), ...Object.keys(m?.clipSpeeds ?? {})];
      return names.some((c) => /^loop_\w*combat_standing_aimed(:|$)/.test(c));
    };
    const withoutAimed = speciesIndex.species.filter((sp) => !aimedStanding(readJson(join(dir, 'characters', sp.id, 'parts.json'))));
    if (withoutAimed.length) {
      const names = withoutAimed.slice(0, 4).map((sp) => sp.id).join(', ');
      need(`player <swg-dir> ${dir} --retail-only --jka=<jka-dir> && parts <swg-dir> ${dir} --retail-only && clips-save ${join(dir, 'player', 'human_male.glb')} ${join(dir, 'player', 'jka.clips')} --only=BOTH_ && clips-apply ${join(dir, 'characters', 'human_male', 'rig.glb')} ${join(dir, 'player', 'jka.clips')} && species <swg-dir> ${dir} --retail-only`, `${withoutAimed.length} of the ${speciesIndex.species.length} species rigs have no aimed blaster pose (a body with a gun up freezes on a transition instead): ${names}${withoutAimed.length > 4 ? ' and more' : ''}`);
    }
  } else need(`species <swg-dir> ${dir} --retail-only`, 'no species index: only the one character can be played');
  const ships = readJson(join(dir, 'ships/manifest.json'));
  if (!ships) need(`ships <swg-dir> ${dir} --retail-only`, 'no ships converted for the garage (B in game, at the bottom)');
  else {
    // What hangs on the ships, decided per ship (a ship converted before has no `chassis`), so neither a
    // --match run nor a hand-merged manifest can hide an old one.
    const parts = assemblyStatus(ships);
    // The loadouts and paint (components.json, customize.json and each ship's `fit`), and the astromechs
    // the ships command links from the mobiles pack.
    let comps = null;
    try {
      comps = readJson(join(dir, 'ships/components.json'));
    } catch {
      comps = null;
    }
    const fits = fitStatus(ships, comps);
    const astromechModels = existsSync(join(dir, 'mobiles/models/astromech_r2.glb'));
    const droidNote = !fits.astromechs && comps && !astromechModels ? ' (the mobiles pack has no astromech models: run this command again after the mobiles)' : '';
    // The NPC ships and space combat (combat.json, written by the same command).
    let combatFile = null;
    try {
      combatFile = readJson(join(dir, 'ships/combat.json'));
    } catch {
      combatFile = null;
    }
    const combat = combatStatus(combatFile);
    console.log(`  ships: ${ships.ships.length} ships, ${ships.ships.filter((sh) => sh.interior && !sh.interior.failed).length} with an interior, ${ships.skipped.length} left out; ${parts.hung} parts hung, ${parts.winged} with wings that open; loadouts for ${fits.fitted}, paint on ${fits.painted}, ${fits.astromechs} astromechs${droidNote}; ${combat.clause}`);
    if (parts.old) need(`ships <swg-dir> ${dir} --retail-only`, `${parts.old} ships' parts do not ride their wings (converted before wings and attachments were assembled)`);
    if (fits.old || !comps || !existsSync(join(dir, 'ships/customize.json'))) need(`ships <swg-dir> ${dir} --retail-only`, 'the ships have no loadouts or paint (converted before ship customization)');
    else if (!fits.astromechs && astromechModels) need(`ships <swg-dir> ${dir} --retail-only`, 'the astromechs were converted after the ships; the ships command links them');
    if (combat.stale) need(`ships <swg-dir> ${dir} --retail-only`, combat.why);
    // The rooms' walkable floors, on the hulls that have rooms at all.
    const roomy = (ships.models ?? []).filter((m) => m.cells && m.cells.length);
    const shipFloors = readJson(join(dir, 'ships/floors.json'));
    const shipFloorsRead = shipFloors?.models && shipFloors.version === FLOOR_PACK_VERSION ? shipFloors : null;
    const floored = shipFloorsRead ? roomy.filter((m) => shipFloorsRead.models[m.id]).length : 0;
    const floorless = shipFloorsRead ? roomy.filter((m) => shipFloorsRead.models[m.id] && !Object.keys(shipFloorsRead.models[m.id]).length).length : 0;
    const shipGraphOnly = !!shipFloorsRead && shipFloorsRead.mesh === false;
    if (roomy.length) console.log(`     rooms' floors: ${floored}/${roomy.length} hulls${shipGraphOnly ? ', GRAPHS ONLY (no walkable meshes)' : ''}${floorless ? `, ${floorless} with none in the archives` : ''}`);
    if (roomy.length && floored < roomy.length) need(`ships <swg-dir> ${dir} --retail-only`, `${roomy.length - floored} hull(s) with rooms have no walkable floors`);
    else if (roomy.length && shipGraphOnly) need(`ships <swg-dir> ${dir} --retail-only`, "the ships' rooms were converted with --floors-graph-only: path graphs, no walkable meshes");
  }
  if (ships && (ships.materialFormat ?? 1) < MATERIAL_FORMAT) need(`ships <swg-dir> ${dir} --retail-only`, "ships' models were converted before animated and glowing surfaces");
  const gallery = readJson(join(dir, 'gallery/manifest.json'));
  if (gallery && (gallery.materialFormat ?? 1) < MATERIAL_FORMAT) need(`gallery <swg-dir> ${dir} --retail-only`, "the gallery's models were converted before animated and glowing surfaces");
  const readQuiet = (file) => {
    try {
      return readJson(file);
    } catch {
      return null;
    }
  };
  // The space zones, one line each (stations, scenery, objects, hyperspace points, arrival), and one to-do for
  // every zone missing or converted before hyperspace.
  const staleSpace = [];
  for (const zone of Object.keys(SPACE_ZONES)) {
    const s = spaceZoneStatus(zone, readQuiet(join(dir, zone, 'space.json')), readQuiet(join(dir, zone, 'layout.json'))?.objects?.length ?? 0);
    console.log(`  ${s.line}`);
    if (s.stale) staleSpace.push(zone);
  }
  if (staleSpace.length) need(`space <swg-dir> all ${dir} --retail-only`, `space zones missing, or converted before the nebulae, the fields and the docking lanes (${staleSpace.join(', ')})`);
  // The made-up system, if there is one: it is optional, so it is listed rather than asked for.
  const sandboxLine = sandboxStatus(readQuiet(join(dir, SANDBOX_ZONE, 'space.json')));
  console.log(`  ${sandboxLine.line}${sandboxLine.stale ? ` (sandbox <swg-dir> ${dir} --retail-only builds one)` : ''}`);
  // The creation and selection places. Asked for rather than merely listed, because with none of
  // them those two screens fall back to a doll on a dark stage and nothing says why. A scene is
  // built from a planet pack, so one built before its world was last converted is stale: the models
  // it shrank may no longer be the models that world places.
  {
    const sceneMan = readQuiet(join(dir, 'scenes', 'manifest.json'));
    const manPath = join(dir, 'scenes', 'manifest.json');
    const builtAt = existsSync(manPath) ? statSync(manPath).mtimeMs : 0;
    const stalePacks = (sceneMan?.packs ?? []).filter((p) => {
      const layout = join(dir, p, 'layout.json');
      return existsSync(layout) && statSync(layout).mtimeMs > builtAt;
    });
    // Not asked for before there is a world to build one from: a scene is made out of a planet
    // pack, so on a fresh folder the thing to do is convert a planet, and saying otherwise would
    // send somebody to a command that can only answer that none of those worlds is converted yet.
    const anyWorld = GAME_PLANETS.some((p) => existsSync(join(dir, p, 'layout.json')));
    if (!anyWorld) console.log('  places: none yet, and none asked for until a world is converted');
    else if (!sceneMan) need(`scenes ${dir}`, 'the creation and selection screens have no places to stand a character in (scenes/)');
    else if (sceneMan.format !== 1) need(`scenes ${dir}`, `the places were built in an older format (${sceneMan.format})`);
    else if (stalePacks.length) need(`scenes ${dir}`, `worlds converted since their places were built (${stalePacks.join(', ')})`);
    else console.log(`  places: ${sceneMan.places.length} for the creation and selection screens, ${sceneMan.models} models, ${(sceneMan.bytes / 1048576).toFixed(0)} MB`);
  }
  // The volumetric clouds. Asked for, although the setting itself is off by default, because with
  // them missing the switch in the menu is one that turns nothing on and says nothing about why.
  // Both halves are needed: the per-world measurement (what a sky covers and how dark it is, which
  // is in the client's art) and the noise volumes (which are ours and the same on every world).
  {
    const skyWorlds = GAME_PLANETS.filter((p) => existsSync(join(dir, p, 'sky.json')));
    const measured = skyWorlds.filter((p) => existsSync(join(dir, p, 'clouds.json')));
    const noise = readQuiet(join(dir, 'clouds', 'manifest.json'));
    const files = !!noise && existsSync(join(dir, 'clouds', noise.base?.file ?? '')) && existsSync(join(dir, 'clouds', noise.detail?.file ?? ''));
    // Version 2 is the one that carries the measured cover curve. The bytes of a version 1 volume
    // are the same, but the calibration that went with it gave a world asking for a quarter of the
    // sky about a twentieth, so it is asked for again rather than read.
    const volumes = files && noise.format === 2 && Array.isArray(noise.cover) && noise.cover.length > 1;
    if (!skyWorlds.length) console.log('  clouds: none yet, and none asked for until a world has a sky');
    else if (!volumes) need(`clouds ${dir}`, files ? `the noise the volumetric clouds march through was calibrated before the coverage was measured (format ${noise.format})` : 'the volumetric clouds have no noise to march through (clouds/)');
    else if (measured.length < skyWorlds.length) need(`clouds ${dir}`, `worlds whose sky has not been measured (${skyWorlds.filter((p) => !measured.includes(p)).join(', ')})`);
    else console.log(`  clouds: ${measured.length} worlds measured, and the volumes the march reads`);
  }
  const galaxyLine = galaxyStatus(readQuiet(join(dir, 'galaxy.json')));
  console.log(`  ${galaxyLine.line}`);
  if (galaxyLine.stale) need(`maps <swg-dir> ${dir} --retail-only`, 'the galaxy map has no shuttle routes (galaxy.json)');
  const mobiles = readQuiet(join(dir, 'mobiles/catalogue.json'));
  if (!mobiles) {
    console.log('  mobiles: none (the spawner has only the planet creatures)');
    need(`mobiles <swg-dir> ${dir} --retail-only`, 'no creature, droid or NPC catalogue for the spawner');
  } else {
    const sizeOf = (p) => {
      try {
        return statSync(join(dir, p)).size;
      } catch {
        return null;
      }
    };
    const code = mobilesCodeStamp();
    const units = M.unitList(mobiles).map((u) => {
      const record = readQuiet(join(dir, u.record));
      return { ...u, record, state: M.unitState(record, { sig: u.sig, source: mobiles.options.source }, sizeOf) };
    });
    const usable = (u) => u.state === 'current' || u.state === 'stale';
    const of = (kind) => {
      const us = units.filter((u) => u.kind === kind);
      return `${us.filter(usable).length}/${us.length}`;
    };
    const byKind = M.KINDS.map((k) => `${mobiles.entries.filter((e) => e.kind === k).length} ${k}`).join(', ');
    const ready = mobiles.entries.filter((e) => e.ready).length;
    const dressedWell = mobiles.entries.filter((e) => e.outfitReady).length;
    const stale = units.filter((u) => u.state === 'stale').length;
    console.log(`  mobiles: ${mobiles.entries.length} entries (${byKind}), ${ready} ready, ${dressedWell} with every outfit piece; models ${of('model')}, anims ${of('pack')}, wearables ${of('wearables')}${stale ? `, ${stale} out of date` : ''}${mobiles.failed.length ? `, ${mobiles.failed.length} failed` : ''}`);
    const nonRetail = units.filter((u) => u.record?.source && !u.record.source.retailOnly).length;
    const otherCode = units.filter((u) => u.record && u.record.code !== code).length;
    if (nonRetail) console.log(`  mobiles: ${nonRetail} units were converted without --retail-only`);
    if (otherCode) console.log(`  mobiles: ${otherCode} units were converted by other converter code of the same format (--skip-existing keeps them; run without it to redo them)`);
    if (mobiles.format !== M.MOBILES_FORMAT) need(`mobiles <swg-dir> ${dir} --retail-only`, 'the mobile catalogue is from an older converter');
    // The wardrobes the outfits wear from, each its own run; the Ithorian ones need species again after.
    const absent = Object.entries(mobiles.wardrobes ?? {}).filter(([w, x]) => x.references && !existsSync(join(dir, 'wardrobe', w, 'wardrobe.json')));
    for (const [w, x] of absent) if (w in M.WARDROBE_RUNS) need(`wardrobe <swg-dir> ${dir} --retail-only${M.WARDROBE_RUNS[w]}`, `${x.references} NPC outfit pieces wear from wardrobe/${w}`);
    if (absent.some(([w]) => w.startsWith('ithorian'))) need(`species <swg-dir> ${dir} --retail-only`, 'after the Ithorian wardrobes, so the species index names them');
    const noSpecies = [...new Set(mobiles.entries.filter((e) => e.kind === 'dressed' && !existsSync(join(dir, 'characters', e.species, 'parts.json'))).map((e) => e.species))];
    if (noSpecies.length) need(`species <swg-dir> ${dir} --retail-only`, `dressed NPCs need the species ${noSpecies.join(', ')}`);
    // Then the mobiles run that fills the rest; one command, with every reason it is needed.
    const rerun = `mobiles <swg-dir> ${dir} --retail-only --skip-existing`;
    // A model the game's own archives cannot give fails again on every rerun: listed, never counted as work.
    const permanent = M.permanentFailures(mobiles);
    if (permanent.size) console.log(`  mobiles: ${permanent.size} model${permanent.size === 1 ? '' : 's'} the game's own archives cannot give, not counted as work: ${[...permanent.values()].map((f) => `${f.id} (${f.why})`).join(', ')}`);
    const toDo = M.unitsToDo(units, permanent).length;
    const o = mobiles.options;
    const partial = [o.only && `--only=${o.only.join(',')}`, o.match && `--match=${o.match}`, o.limit && `--limit=${o.limit}`].filter(Boolean).join(' ');
    if (absent.length) need(rerun, 'after the wardrobes, so the NPC outfits are matched to them');
    if (nonRetail) need(rerun, `${nonRetail} mobile units came from archives outside the retail set`);
    if (toDo && partial) need(rerun, `the last mobiles run converted only ${partial}; this converts the other ${toDo} units and keeps the rest`);
    else if (toDo) need(rerun, `${toDo} mobile models, packs or wearable folders missing or out of date`);
  }
  // The sound bank: every sound the game may play, the samples, and where each one is used.
  const sound = soundStatus(dir, readJson);
  console.log(sound.line);
  if (sound.need) need(`sounds <swg-dir> ${dir} --retail-only`, sound.need);
  // Where each planet's sounds are: its placed emitters, its buildings' room beds and its surfaces.
  const places = placesStatus(dir, GAME_PLANETS, readJson);
  if (places.line) console.log(places.line);
  if (places.need) need(`sounds <swg-dir> ${dir} all --retail-only`, places.need);
  // When each animation marks a foot landing or a voice, which animation each species' clips play
  // (compared with the species packs, so a drift shows as a line rather than as silent feet), and
  // Jedi Academy's own marks and saber sounds.
  const clipEvents = clipEventStatus(dir, readJson, { packs: (id) => readJson(join(dir, 'characters', id, 'parts.json')) });
  console.log(clipEvents.line);
  // One line, not two. This used to ask for the species as well, on the reading that a pack whose
  // clips the sound table does not know must itself be the old one. It is the other way round every
  // time (the reasoning is in `clipEventStatus`), so that ask could never be satisfied: the two
  // lines contradicted each other in the same to-do list and the species one would have been asked
  // for again after every run of it, for ever.
  if (clipEvents.need) need(`sounds <swg-dir> ${dir} --retail-only --jka=<jedi-academy-gamedata>`, clipEvents.need);
  const jkaSounds = jkaSoundStatus(dir, readJson);
  if (jkaSounds.line) console.log(jkaSounds.line);
  if (jkaSounds.need) need(`sounds <swg-dir> ${dir} --retail-only --jka=<jedi-academy-gamedata>`, jkaSounds.need);
  // What each ship, ship part and vehicle sounds like, joined to the client data that speaks for it.
  // The ships manifest goes with it, since the hull half is keyed by the ids that manifest gives and
  // a ships pack converted since would otherwise leave these behind in silence.
  const shipSounds = shipSoundStatus(dir, readJson, { ships });
  if (shipSounds.line) console.log(shipSounds.line);
  if (shipSounds.need) need(`sounds <swg-dir> ${dir} --retail-only`, shipSounds.need);
  if (!todo.size) {
    console.log(`everything is in place: ${planets} planet packs, creatures and player`);
    return todo;
  }

  console.log('\nto fill the gaps (replace <swg-dir> with your SWG folder):');
  for (const [cmd, whys] of todo) console.log(`  npm run swg -- ${cmd}\n      ${whys.length > 4 ? `${whys.slice(0, 3).join('; ')}; and ${whys.length - 3} more` : whys.join('; ')}`);
  return todo;
}

/** Names of the world snapshots the archives hold (snapshot/<name>.ws). */
function snapshotPlanets(vfs) {
  const names = new Set(vfs.list('snapshot/').filter((n) => n.endsWith('.ws')).map((n) => basename(n, '.ws')));
  // Expansion planets have no snapshot, only buildout tables (and a terrain).
  for (const n of vfs.list('datatables/buildout/areas_')) {
    const planet = basename(n, '.iff').replace(/^areas_/, '');
    if (vfs.has(`terrain/${planet}.trn`)) names.add(planet);
  }
  return [...names].sort();
}

/**
 * Where to centre a planet when no centre is given: its starport (or shuttleport) if it has
 * one, else the middle of the 256 m square holding the most objects, which is a city.
 */
function autoCenter(snap, entries) {
  for (const want of ['starport', 'shuttleport']) {
    const hit = entries.find((e) => e.world && e.parentId === 0 && snap.templates[e.node.templateIndex].includes(want));
    if (hit) return { x: hit.world.pos[0], z: hit.world.pos[2], why: `${want} ${snap.templates[hit.node.templateIndex].split('/').pop()}` };
  }
  const cells = new Map();
  for (const e of entries) {
    if (!e.world || e.parentId !== 0) continue;
    const key = `${Math.floor(e.world.pos[0] / 256)},${Math.floor(e.world.pos[2] / 256)}`;
    const c = cells.get(key) ?? { n: 0, x: 0, z: 0 };
    c.n++;
    c.x += e.world.pos[0];
    c.z += e.world.pos[2];
    cells.set(key, c);
  }
  let best = null;
  for (const c of cells.values()) if (!best || c.n > best.n) best = c;
  if (!best) return { x: 0, z: 0, why: 'empty snapshot' };
  return { x: best.x / best.n, z: best.z / best.n, why: `busiest square, ${best.n} objects` };
}

/**
 * Points of interest for the in-game map, in SWG coordinates: the client's own named places
 * (`places.mjs`), the planet's named places from the emulator's region scripts
 * (regions/regions.json: cities, landmarks and areas, with names from the client's string
 * tables), the client's own region table when it has one, and every starport and shuttleport
 * in the snapshot named after the city it stands in.
 *
 * The client's table wins a name clash and the names only we have are kept (`mergePlaceLists`).
 */
function pointsOfInterest(vfs, planet, snap, entries, { regions: wantRegions = true, archive: wantArchive = true } = {}) {
  const strings = new Map();
  const ours = [];
  for (const r of REGIONS[planet] ?? []) {
    const name = (r.stringId && localize(vfs, r.stringId, strings)) || r.name;
    ours.push({ name, x: r.x, z: r.z, r: r.r, kind: r.kind });
  }
  const table = `datatables/clientregion/${planet}.iff`;
  if (wantRegions && vfs.has(table)) {
    const dt = parseDatatable(parseIff(vfs.read(table)));
    for (const row of dt.rows) {
      const [id, x, z, r] = dt.columns.map((c) => row[c]);
      if (typeof id !== 'string' || typeof x !== 'number') continue;
      ours.push({ name: localize(vfs, id, strings) ?? title(id.split(':').pop()), x, z, r, kind: r > 1000 ? 'area' : 'landmark' });
    }
  }
  const archive = wantArchive ? readClientPlaces(vfs, planet, strings) : { rows: [], unnamed: 0, missing: 0 };
  const merged = mergePlaceLists(archive.rows, ours);
  const places = merged.places;
  const seen = new Set(places.map((p) => placeKey(p.name)));
  // Whether the client's table is in the snapshot's own frame is measured, never assumed: the run
  // says how far its places are from the nearest thing the snapshot builds, as they stand and with
  // X mirrored, and the answer goes into the pack beside them.
  const frame = frameCheck(archive.rows, entries.filter((e) => e.world && e.parentId === 0).map((e) => ({ x: e.world.pos[0], z: e.world.pos[2] })));
  let namedAfterPlace = 0;
  for (const e of entries) {
    if (!e.world || e.parentId !== 0) continue;
    const template = snap.templates[e.node.templateIndex];
    const kind = template.includes('starport') ? 'starport' : template.includes('shuttleport') ? 'shuttleport' : null;
    if (!kind) continue;
    const [x, , z] = e.world.pos;
    const label = portLabel(x, z, places, kind === 'starport' ? 'Starport' : 'Shuttleport');
    if (label.from === 'place') namedAfterPlace++;
    const k = placeKey(label.name);
    if (seen.has(k)) continue;
    seen.add(k);
    places.push({ name: label.name, x, z, r: 0, kind });
  }
  const order = { city: 0, starport: 1, shuttleport: 2, place: 3, landmark: 4, area: 5 };
  places.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.name.localeCompare(b.name));
  return { places, stats: { ...merged, archive: archive.rows.length, unnamed: archive.unnamed, missing: archive.missing, ours: ours.length, namedAfterPlace, frame } };
}

/** Write <out>/pois.json for a planet; a broken table costs that table's places, never the snapshot. */
function writePois(vfs, planet, snap, entries, cx, cz, outDir) {
  let result = null;
  // Each step sheds one source, so one unreadable table never costs the others.
  for (const opts of [{}, { archive: false }, { regions: false }, { regions: false, archive: false }]) {
    try {
      result = pointsOfInterest(vfs, planet, snap, entries, opts);
      break;
    } catch (err) {
      console.warn(`points of interest: ${err.message}`);
    }
  }
  const pois = result ? result.places : [];
  const s = result ? result.stats : null;
  const file = { planet, center: { x: cx, z: cz }, clientPlaces: s ? s.archive : 0, ...(s && s.frame.rows ? { frameCheck: s.frame } : {}), pois };
  writeFileSync(join(outDir, 'pois.json'), JSON.stringify(file));
  const counts = `${pois.length} (${pois.filter((p) => p.kind === 'place').length} the client's own named places, ${pois.filter((p) => p.kind === 'city' || p.kind === 'landmark' || p.kind === 'area').length} regions, ${pois.filter((p) => p.kind === 'starport' || p.kind === 'shuttleport').length} travel points)`;
  console.log(`points of interest: ${counts} -> ${join(outDir, 'pois.json')}`);
  if (s) {
    console.log(`  places: the client's table gave ${s.archive}${s.unnamed ? ` (${s.unnamed} whose Name column names the wrong table, named by its own key instead)` : ''}${s.missing ? ` (${s.missing} whose name string the table is missing, labelled from its key)` : ''}, ours gave ${s.ours}, ${s.clashed} names were in both (the client's won${s.ringsKept ? `, except ${s.ringsKept} where ours is a ring with a reach and keeps its row` : ''})${s.repeats ? `, ${s.repeats} names the client's table itself repeats elsewhere` : ''}${s.sameSpot ? `, ${s.sameSpot} repeated in the same spot and dropped` : ''}${s.namedAfterPlace ? `, ${s.namedAfterPlace} port(s) named after a place rather than a city` : ''}`);
    if (s.frame.rows) {
      console.log(`  frame: ${s.frame.rows} places, nearest built thing ${s.frame.asIs} m away as they stand against ${s.frame.mirrored} m with X mirrored; worst ${s.frame.worst.m} m (${s.frame.worst.name})`);
      if (s.frame.mirrored < s.frame.asIs) console.warn(`  WARNING: ${planet}'s named places sit closer to the snapshot with X mirrored; the table may not be in the snapshot's frame`);
    }
  }
}

/** Convert one planet's snapshot (see the snapshot command). */
async function snapshotPlanet(vfs, planet, outDir) {
    surfaceUse = new Set();
    const radius = options.radius === 'all' ? Infinity : Number(options.radius ?? 400);
    const max = Number(options.max ?? Infinity);
    const wsPath = `snapshot/${planet}.ws`;
    const { snap, entries, snapshotCount, buildout, spawns, core3 } = loadPlanetObjects(vfs, planet);
    console.error(`${wsPath}: ${snapshotCount} top-level objects, ${entries.length} including contained and buildouts, ${snap.templates.length} templates`);
    if (spawns) {
      const st = spawns.stats;
      console.error(`server spawns (${core3}): ${st.objects} static objects placed, ${st.mobiles} creature and NPC spawns noted for spawns.json (${st.inCells + st.mobilesInCells} inside building cells skipped) from ${st.files} scripts`);
      // The static objects this placed are kept; the people it noted are not written here any more.
      // `spawns.json` has one owner, the `spawns` command, which reads the same scripts with a real
      // parser instead of a pattern: it finds 5,257 standing people to this reader's 3,094 (it takes
      // the whole screenplay tree, not the folder named for them), it keeps the 2,607 who stand
      // inside a building cell that this one counts and drops, and it carries the wildlife chain as
      // well. Both wrote the same path in different shapes, so whichever ran second won and nothing
      // said so.
    }
    console.error(`buildouts: ${buildout.objects} objects in ${buildout.areas} areas${buildout.eventAreas ? `, ${buildout.eventAreas} event-only areas skipped` : ''}${buildout.computedTemplates ? `, ${buildout.computedTemplates} rows named by hashing the archives' templates (the string table lacks them)` : ''}${buildout.unknownTemplates ? `, WARNING: ${buildout.unknownTemplates} rows with unknown templates (their objects are missing)` : ''}${buildout.missingTables ? `, ${buildout.missingTables} area tables missing` : ''}`);
    let cx;
    let cz;
    if (options.center && options.center !== 'auto') {
      [cx, cz] = options.center.split(',').map(Number);
    } else {
      const c = autoCenter(snap, entries);
      cx = Math.round(c.x);
      cz = Math.round(c.z);
      console.error(`centre ${cx},${cz}: ${c.why}`);
    }
    const inRegion = entries.filter((e) => e.world && Math.hypot(e.world.pos[0] - cx, e.world.pos[2] - cz) <= radius);
    console.error(`${inRegion.length} within ${radius} m of ${cx},${cz}`);
    const cache = new Map();
    const skipped = {};
    const examples = {};
    const skip = (reason, template) => {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
      (examples[reason] ??= new Set()).add(template);
    };
    const models = new Map();
    const objects = [];
    const layerCache = new Map();
    mkdirSync(outDir, { recursive: true });
    for (const e of inRegion) {
      const n = e.node;
      const template = snap.templates[n.templateIndex];
      const r = resolveTemplateMesh(vfs, template, cache);
      if (r.skip) {
        skip(r.skip, template);
        continue;
      }
      if (r.skeletal) {
        // Creatures and NPCs are the server's to spawn and animate; other skeletal things (the
        // Sarlacc, animated banners) are baked at their bind pose as static props.
        if (/^object\/(mobile|creature)\//i.test(template)) {
          skip('creature or NPC (skeletal, spawned by the server)', template);
          continue;
        }
        const sid = familyOf(r.skeletal);
        if (!models.has(sid)) {
          if (models.size >= max) break;
          try {
            const info = convertSat(vfs, r.skeletal, join(outDir, `${sid}.glb`), { animations: 'none' });
            const tris = info.meshes.reduce((a, m) => a + m.triangles, 0);
            models.set(sid, { id: sid, source: r.skeletal, file: `${sid}.glb`, bounds: info.bounds ?? { min: [-1, 0, -1], max: [1, 2, 1] }, triangles: tris, textured: info.meshes.length, shaders: info.meshes.reduce((a, m) => a + m.shaders, 0), parts: 1, skeletal: true });
            console.error(`  ${sid}: ${tris} tris, skeletal appearance baked at its bind pose`);
          } catch (err) {
            models.set(sid, { failed: err.message });
          }
        }
        const model = models.get(sid);
        if (!model || model.failed) {
          skip(`skeletal convert failed: ${model?.failed ?? 'unknown'}`, template);
          continue;
        }
        objects.push({ template, model: sid, x: e.world.pos[0], y: e.world.pos[1], z: e.world.pos[2], q: e.world.q, radius: n.radius, contained: e.parentId !== 0 });
        continue;
      }
      if (r.particle) {
        // A particle effect on its own (smoke, sparks, a campfire's flames): the pack keeps its
        // description and textures, and the game plays it where the snapshot places it.
        const p = convertParticle(vfs, r.particle, outDir);
        if (p.failed) {
          skip(`particle convert failed: ${p.failed}`, template);
          continue;
        }
        if (!models.has(p.id)) models.set(p.id, { ...p, source: r.source ?? r.appearance });
        objects.push({ template, model: p.id, x: e.world.pos[0], y: e.world.pos[1], z: e.world.pos[2], q: e.world.q, radius: Math.max(n.radius, p.bounds.max[0]), contained: e.parentId !== 0 });
        continue;
      }
      const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length && !r.parts[0].hardpoints?.length;
      const id = familyOf(single ? r.parts[0].mesh : r.appearance);
      if (!models.has(id)) {
        if (models.size >= max) break;
        try {
          const conv = convertOne(vfs, single ? r.parts[0].mesh : r.appearance, join(outDir, `${id}.glb`));
          const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
          const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
          const effects = attachedEffects(vfs, conv.effects, outDir);
          models.set(id, { id, source: r.source ?? r.appearance, file: `${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, parts: conv.partCount, ...(conv.cells ? { cells: conv.cells, portals: conv.portals ?? [] } : {}), ...(effects.length ? { effects } : {}) });
          console.error(`  ${id}: ${conv.tris} tris, ${conv.textured}/${conv.shaders.length} textured${conv.partCount > 1 ? `, ${conv.partCount} parts` : ''}${effects.length ? `, ${effects.length} attached particle effect(s)` : ''}`);
        } catch (err) {
          models.set(id, { failed: err.message });
        }
      }
      const model = models.get(id);
      if (!model || model.failed) {
        skip(`convert failed: ${model?.failed ?? 'unknown'}`, template);
        continue;
      }
      const obj = { template, model: id, x: e.world.pos[0], y: e.world.pos[1], z: e.world.pos[2], q: e.world.q, radius: n.radius, contained: e.parentId !== 0 };
      if (!obj.contained) {
        const layer = copyTerrainLayer(vfs, template, outDir, layerCache);
        if (layer) obj.layer = layer;
      }
      objects.push(obj);
    }
    const terrainFile = await copyTerrain(vfs, planet, outDir);
    const layout = { planet, center: { x: cx, z: cz }, radius: Number.isFinite(radius) ? radius : null, terrain: terrainFile, objects, skipped };
    writeFileSync(join(outDir, 'layout.json'), JSON.stringify(layout));
    const manifestPath = join(outDir, 'manifest.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { planet, categories: {} };
    manifest.categories.layout = [...models.values()].filter((m) => m && !m.failed);
    manifest.materialFormat = MATERIAL_FORMAT;
    const flora = lastTemplate ? convertFlora(vfs, lastTemplate, outDir, manifest) : { models: 0, missing: 0, families: 0 };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`flora: ${flora.models} models for ${flora.families} families${flora.missing ? `, ${flora.missing} appearances missing` : ''}${flora.particles ? `, ${flora.particles} particle effects skipped` : ''}`);
    writePois(vfs, planet, snap, entries, cx, cz, outDir);
    // The gates one world's zones are walked between, joined to the places beside them. It reads the
    // layout.json written a few lines above, so it needs nothing from the snapshot, and a world with
    // no gates in its layout writes no file and prints nothing at all.
    writeZoneGates(vfs, planet, outDir);
    const fx = manifest.categories.layout.filter((m) => m.particle);
    const attached = manifest.categories.layout.reduce((n, m) => n + (m.effects?.length ?? 0), 0);
    console.log(`layout: ${objects.length} objects, ${manifest.categories.layout.length} models -> ${join(outDir, 'layout.json')}`);
    console.log(surfaceCountsLine(surfaceCounts(surfaceUse)));
    surfaceUse = null;
    if (fx.length || attached) console.log(`particles: ${fx.length} effects placed on their own (${objects.filter((o) => fx.some((m) => m.id === o.model)).length} placements), ${attached} attached to models, ${particleTextures.get(resolve(outDir))?.size ?? 0} textures`);
    const withCells = manifest.categories.layout.filter((m) => m.cells);
    console.log(`buildings: ${withCells.length} models with cells, ${withCells.filter((m) => m.portals && m.portals.length).length} with portals`);
    writeFloors(outDir, manifest.categories.layout.map((m) => m.id));
    console.log(`terrain: ${terrainFile ?? 'not found'}, ${objects.filter((o) => o.layer).length} objects with terrain modification layers (${new Set(objects.map((o) => o.layer).filter(Boolean)).size} files)`);
    for (const [reason, count] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) {
      console.log(`  skipped ${count}: ${reason}`);
      for (const ex of [...(examples[reason] ?? [])].slice(0, 3)) console.log(`      e.g. ${ex}`);
    }
    printEffectSummary();
}

/** What the mobiles units' conversion code is, so a record written by other code is noticed. */
function mobilesCodeStamp() {
  const modules = ['mobiles.mjs', 'mobilescan.mjs', 'skeletal.mjs', 'glb.mjs', 'texrender.mjs', 'customize.mjs', 'sht.mjs', 'dds.mjs', 'tga.mjs', 'png.mjs', 'eff.mjs', 'iff.mjs', 'objtemplate.mjs', 'mounts.mjs'];
  const texts = modules.map((f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'));
  // cli.mjs changes for every command, so only the functions a unit runs are taken from it.
  for (const fn of [convertSat, skinnedTexture, textureFor, normalFor, surfaceFor, alphaFromEffect, noteVariables, customizationList, convertWearableMesh]) texts.push(String(fn));
  return M.codeStampOf(texts);
}

/** The disk a mobiles run writes to, as paths relative to <out-dir>. Writes are atomic. */
function mobilesIo(outRoot) {
  const at = (rel) => join(outRoot, rel);
  const walk = (rel, out = []) => {
    let names;
    try {
      names = readdirSync(at(rel), { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of names) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child, out);
      else out.push(child);
    }
    return out;
  };
  const io = {
    exists: (rel) => existsSync(at(rel)),
    size: (rel) => {
      try {
        return statSync(at(rel)).size;
      } catch {
        return null;
      }
    },
    readFile: (rel) => readFileSync(at(rel)),
    readJson: (rel) => {
      try {
        return JSON.parse(readFileSync(at(rel), 'utf8'));
      } catch {
        return null;
      }
    },
    writeFileAtomic: (rel, bytes) => {
      mkdirSync(dirname(at(rel)), { recursive: true });
      writeFileSync(`${at(rel)}.write`, bytes);
      renameSync(`${at(rel)}.write`, at(rel));
    },
    writeJsonAtomic: (rel, value, indent = 1) => io.writeFileAtomic(rel, JSON.stringify(value, null, indent || undefined)),
    remove: (rel) => rmSync(at(rel), { recursive: true, force: true }),
    rename: (from, to) => {
      mkdirSync(dirname(at(to)), { recursive: true });
      rmSync(at(to), { recursive: true, force: true });
      try {
        renameSync(at(from), at(to));
      } catch (err) {
        if (err.code !== 'EPERM') throw err;
        // Windows: something held it open for a moment (a file viewer, an unzip). One retry, then say so.
        const until = Date.now() + 200;
        while (Date.now() < until);
        try {
          renameSync(at(from), at(to));
        } catch {
          throw new Error(`could not replace ${to}: close anything holding it open (a file viewer, an unzip), then run again with --skip-existing`);
        }
      }
    },
    listFiles: (rel) => walk(rel),
  };
  return io;
}

/** The conversions a mobiles run needs: a plain model, a parts character, a wearable folder. */
function mobilesConvert(vfs, outRoot) {
  const at = (rel) => join(outRoot, rel);
  const warningsOf = (info) => [...info.missing.map((m) => `missing ${m}`), ...info.skipped];
  return {
    model(sat, outRel, values) {
      const info = convertSat(vfs, sat, at(outRel), { animations: false, variables: new Map(Object.entries(values)) });
      if (!info.meshes.some((m) => m.shaders > 0)) throw new Error('no mesh survived');
      return {
        joints: info.joints,
        triangles: info.meshes.reduce((a, m) => a + m.triangles, 0),
        meshes: info.meshes.filter((m) => m.shaders > 0).map((m) => basename(m.file).replace(/\.[^.]+$/, '')),
        bounds: info.bounds ?? null,
        warnings: warningsOf(info),
      };
    },
    parts(sat, dirRel, values, { id, anims, gender }) {
      const info = convertSat(vfs, sat, null, { animations: false, variables: new Map(Object.entries(values)), parts: { dir: at(dirRel), rig: 'rig' } });
      writeFileSync(join(at(dirRel), 'parts.json'), JSON.stringify({
        id, species: null, gender, template: null, skeleton: info.skeleton, rig: info.rig, anims, joints: info.joints,
        defaultWear: info.parts.filter((p) => p.occlusionLayer > 0).map((p) => p.name),
        clips: [], clipSpeeds: {}, parts: info.parts,
        customization: [...info.customization], variables: customizationList(vfs, info), values,
      }, null, 2));
      return {
        joints: info.joints,
        triangles: info.parts.reduce((a, p) => a + p.triangles, 0),
        meshes: info.parts.map((p) => p.name),
        bounds: info.bounds ?? null,
        recipes: info.recipes ?? 0,
        images: info.images ?? 0,
        warnings: warningsOf(info),
      };
    },
    wearables(dirRel, plan) {
      const dir = at(dirRel);
      mkdirSync(dir, { recursive: true });
      const skeleton = MS.loadSkeletonSet(vfs, plan.skeletons);
      const skin = skinData(skeleton, [], { flipX: true });
      const recipes = [];
      const recipeKeys = new Set();
      const registry = new ImageRegistry((id, bytes) => {
        mkdirSync(join(dir, 'customize'), { recursive: true });
        writeFileSync(join(dir, 'customize', id), bytes);
      });
      const items = [];
      const failed = [];
      for (const { lmg, part } of plan.meshes) {
        // A fresh render context per mesh, so the images one piece decoded are released before the next.
        const info = { missing: [], skipped: [], customization: new Set(), variables: new Map(), textureRenderers: [], shaderNotes: new Set() };
        const entry = convertWearableMesh(vfs, lmg, { skeleton, skin, outDir: dir, ctx: renderContext(), info, recipes, recipeKeys, registry });
        if (!entry) {
          failed.push(part);
          continue;
        }
        items.push({ id: `npc_${entry.name.replace(/_l\d+$/, '')}`, template: '', kind: /hair/.test(lmg) ? 'hair' : 'wearables', sat: '', gender: plan.gender, parts: [entry], variables: customizationList(vfs, info) });
      }
      writeFileSync(join(dir, 'wardrobe.json'), JSON.stringify({ species: plan.folder, gender: plan.gender, skeleton: plan.skeleton, items }, null, 2));
      if (recipes.length) writeFileSync(join(dir, 'customize.json'), JSON.stringify({ images: 'customize/', recipes, palettes: exportPalettes(vfs, recipes.flatMap((r) => palettesOf(r))) }, null, 1));
      return { items: items.map((i) => i.id), failed };
    },
    clearCaches() {
      textureCache.clear();
      surfaceCache.clear();
      normalCache.clear();
    },
  };
}

switch (cmd) {
  case 'verify': {
    if (!pos[1]) usage();
    console.error('hashing every archive; large installs take a few minutes');
    const results = await classifyDirectory(pos[1], (r, done, total) => {
      console.log(`[${String(done).padStart(3)}/${total}] ${r.file.padEnd(34)} ${String(r.size).padStart(12)}  ${r.verdict}`);
    });
    const retail = results.filter((r) => r.set).length;
    console.log(`\n${retail} retail archives, ${results.length - retail} unknown or modified, of ${results.length}`);
    break;
  }
  case 'headers': {
    if (!pos[1]) usage();
    for (const f of readdirSync(pos[1]).filter((x) => x.toLowerCase().endsWith('.tre')).sort()) {
      const h = readHeader(join(pos[1], f));
      let status = 'ok';
      try {
        const t = openTre(join(pos[1], f));
        if (t.dataOnly) status = 'data-only (6000), read through the .toc index';
        t.close();
      } catch (err) {
        status = `FAIL ${err.message}`;
      }
      console.log(`${f.padEnd(34)} ${JSON.stringify(h.magic)} ${h.fields.join(' ')}  ${status}`);
    }
    break;
  }
  case 'list': {
    // <swg-dir> <text>: every mounted file whose name contains the text, with the archive it comes from.
    const vfs = mount(pos[1]);
    for (const name of vfs.list(pos[2])) {
      const held = vfs.versions(name);
      console.log(`${name}${held.length ? `  (${held[held.length - 1].archive})` : ''}`);
    }
    break;
  }
  case 'extract': {
    const vfs = mount(pos[1]);
    mkdirSync(dirname(pos[3]), { recursive: true });
    writeFileSync(pos[3], vfs.read(pos[2]));
    console.log(`wrote ${pos[3]}`);
    break;
  }
  case 'dump': {
    let buf;
    if (pos[2]) buf = mount(pos[1]).read(pos[2]);
    else if (existsSync(pos[1]) && statSync(pos[1]).isFile()) buf = readFileSync(pos[1]);
    else usage();
    console.log(dump(parseIff(buf), 0, [], flags.has('--strings')).join('\n'));
    if (flags.has('--hex')) {
      // Every chunk's bytes as hex, the text they spell, and the floats each aligned four would be:
      // the way to decode a chunk whose layout is unknown (a client data file's, a cockpit's).
      const hex = (node, depth) => {
        const pad = '  '.repeat(depth);
        if (isForm(node)) {
          console.log(`${pad}FORM ${node.type}`);
          for (const c of node.children) hex(c, depth + 1);
          return;
        }
        const d = node.data;
        console.log(`${pad}${node.tag} ${d.length} bytes`);
        for (let o = 0; o < d.length; o += 16) {
          const slice = d.subarray(o, Math.min(o + 16, d.length));
          const bytes = [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ');
          const text = [...slice].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
          const floats = [];
          for (let i = 0; i + 4 <= slice.length; i += 4) floats.push(slice.readFloatLE(i).toPrecision(4));
          console.log(`${pad}  ${o.toString(16).padStart(4, '0')}  ${bytes.padEnd(48)} |${text.padEnd(16)}| ${floats.join(' ')}`);
        }
      };
      console.log('');
      hex(parseIff(buf), 0);
    }
    break;
  }
  case 'ash': {
    // <swg-dir> <appearance/x.sat | object/.../shared_x.iff | appearance/ash/x.ash>: the animation state
    // hierarchy behind a skeletal appearance, every state with the strings it carries, for reading how
    // the game picks its loops (a pistol's combat stance) from names the logical table alone does not show.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    let file = pos[2].replace(/\\/g, '/');
    if (/\.iff$/i.test(file)) {
      const a = resolveTemplateString(vfs, file, ['appearanceFilename'], new Map());
      if (!a) throw new Error(`${file}: no appearanceFilename in its template chain`);
      file = a.replace(/\\/g, '/').replace(/^\//, '');
    }
    let latNames = null;
    if (/\.sat$/i.test(file)) {
      const sat = parseSat(readIff(vfs, file));
      const latFile = sat.animationTables.get(sat.skeletons[0]?.file.toLowerCase()) ?? [...sat.animationTables.values()][0];
      const lat = parseLat(readIff(vfs, latFile));
      latNames = new Set(lat.logical.map((n) => n.toLowerCase()));
      console.log(`${file}: logical table ${latFile} (${lat.logical.length} logical names read of the ${lat.count} it declares, ${lat.entries.length} clips once the selectors are unwrapped), hierarchy ${lat.hierarchy}`);
      file = lat.hierarchy.replace(/\\/g, '/').replace(/^\//, '');
    }
    if (!vfs.has(file)) throw new Error(`${file}: not in the archives`);
    const strings = (data) => {
      const out = [];
      let cur = '';
      for (const b of data) {
        if (b >= 0x20 && b < 0x7f) cur += String.fromCharCode(b);
        else {
          if (cur.length >= 3) out.push(cur);
          cur = '';
        }
      }
      if (cur.length >= 3) out.push(cur);
      return out;
    };
    const walk = (node, depth, lines) => {
      const pad = '  '.repeat(depth);
      if (isForm(node)) {
        lines.push(`${pad}FORM ${node.type}`);
        for (const c of node.children) walk(c, depth + 1, lines);
      } else {
        const str = strings(node.data);
        const nums = node.data.length <= 16 ? ` [${[...node.data].map((b) => b.toString(16).padStart(2, '0')).join(' ')}]` : '';
        lines.push(`${pad}${node.tag} (${node.data.length} bytes)${str.length ? ` ${str.join(' | ')}` : nums}`);
      }
      return lines;
    };
    const root = parseIff(vfs.read(file));
    // The states, each with its idle's logical name, its actions and its links, and which of the
    // logical names the table lacks: those the game cannot play from this table.
    if (latNames) {
      const states = [];
      const missing = new Map();
      const known = (n) => latNames.has(n.toLowerCase());
      const note = (n, where) => { if (!known(n)) missing.set(n, (missing.get(n) ?? []).concat(where)); };
      const visit = (node, path) => {
        if (!isForm(node)) return;
        if (node.type === 'STAT') {
          const info = node.children.find((c) => !isForm(c) && c.tag === 'INFO');
          const [name, idle] = info ? strings(info.data) : ['?'];
          const here = [...path, name ?? '?'];
          const state = { path: here.join('/'), idle: idle ?? null, actions: [], links: [] };
          for (const c of node.children) {
            if (!isForm(c)) continue;
            if (c.type === 'ACTS') {
              const acts = (f) => { for (const a of f.children) { if (isForm(a)) acts(a); else if (a.tag === 'ACTN') { const [act, logical] = strings(a.data); state.actions.push(`${act}=${logical ?? '?'}`); if (logical) note(logical, `${state.path} action ${act}`); } } };
              acts(c);
            } else if (c.type === 'LNKS') {
              for (const l of c.children) if (!isForm(l) && l.tag === 'LINK') { const parts = strings(l.data); const last = parts[parts.length - 1]; const trn = parts.length > 1 && /^(trn_|rea_|add_|loop_)|_to_/.test(last) ? last : null; state.links.push(`${(trn ? parts.slice(0, -1) : parts).join('/')}${trn ? ` via ${trn}` : ''}`); if (trn) note(trn, `${state.path} link`); }
            } else if (c.type === 'CHLD') for (const child of c.children) visit(child, here);
          }
          if (idle) note(idle, `${state.path} idle`);
          states.push(state);
          return;
        }
        for (const c of node.children) visit(c, path);
      };
      visit(root, []);
      const find = options.find ? String(options.find).toLowerCase() : null;
      const shown = find ? states.filter((st) => st.path.toLowerCase().includes(find)) : states;
      console.log(`${file}: ${states.length} states${find ? `, ${shown.length} under "${find}"` : ''}`);
      for (const st of shown) {
        console.log(`${st.path}: idle ${st.idle ?? '(none)'}${st.idle && !known(st.idle) ? ' [NOT IN TABLE]' : ''}`);
        if (st.actions.length) console.log(`    actions: ${st.actions.map((a) => (known(a.split('=')[1]) ? a : `${a} [NOT IN TABLE]`)).join(', ')}`);
        if (st.links.length) console.log(`    links: ${st.links.join(', ')}`);
      }
      const relevant = [...missing.entries()].filter(([, w]) => !find || w.some((x) => x.toLowerCase().includes(find)));
      console.log(`\n${relevant.length} logical names the hierarchy uses that the table lacks${find ? ` (under "${find}")` : ''}:`);
      for (const [n, w] of relevant) console.log(`  ${n}  (${w.length} uses, e.g. ${w[0]})`);
      break;
    }
    const lines = walk(root, 0, []);
    const find = options.find ? String(options.find).toLowerCase() : null;
    console.log(`${file}: ${lines.length} lines${find ? `, those with "${find}" and their forms` : ''}`);
    if (!find) console.log(lines.join('\n'));
    else {
      const stack = [];
      for (const line of lines) {
        const depth = line.search(/\S/) / 2;
        stack.length = depth;
        stack[depth] = line;
        if (line.toLowerCase().includes(find)) {
          for (let d = 0; d <= depth; d++) if (stack[d] && !stack[d].printed) { console.log(stack[d]); stack[d] = Object.assign(new String(stack[d]), { printed: true }); }
        }
      }
    }
    break;
  }
  case 'template': {
    const vfs = mount(pos[1]);
    let path = pos[2];
    for (let depth = 0; depth < 8 && path; depth++) {
      if (!vfs.has(path)) {
        console.log(`${path}: missing`);
        break;
      }
      const t = readTemplate(parseIff(vfs.read(path)));
      console.log(`${path}  [${t.type}]  base: ${t.base ?? '(none)'}`);
      for (const [name, buf] of t.params) console.log(`  ${name} = ${stringParam(buf) ?? `<${buf.length} bytes, type ${buf[0]}>`}`);
      path = stringParam(t.params.get('sharedTemplate')) ?? t.base;
    }
    break;
  }
  case 'materials': {
    // Every shader an appearance uses, cell by cell for a portal building, with what the converter
    // makes of it: its effect, its alpha mode and whether it is glass by name. A window the runtime
    // does not clear is a shader without the mark: name it with --glass= and convert the ship again.
    if (!pos[2] && !options.ship) usage();
    const vfs = mount(pos[1]);
    let appearance = pos[2];
    if (options.ship || /\.iff$/i.test(appearance ?? '')) {
      // A ship by its garage id (--ship=yt2400) or any object template: its appearance is resolved as the ships command does.
      let template = appearance;
      if (options.ship) {
        const { shipLabelOf } = await import('./ships.mjs');
        const { galleryTemplates } = await import('./gallery.mjs');
        template = galleryTemplates(vfs, 'object/ship/player/').find((t) => shipLabelOf(t) === options.ship);
        if (!template) throw new Error(`no player ship is called ${options.ship} (the ids are the ships command's)`);
      }
      const r = resolveTemplateMesh(vfs, template, new Map());
      if (r.skip) throw new Error(`${template}: ${r.skip}`);
      const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length && !r.parts[0].hardpoints?.length;
      appearance = single ? r.parts[0].mesh : r.appearance;
      console.log(`${template} -> ${appearance}`);
    }
    const { mesh, cells } = loadAppearanceMesh(vfs, appearance);
    const use = new Map();
    const note = (g, where) => {
      const u = use.get(g.shader) ?? use.set(g.shader, { tris: 0, cells: new Set() }).get(g.shader);
      u.tris += g.primitives.reduce((m, p) => m + p.indices.length / 3, 0);
      u.cells.add(where);
    };
    if (cells) for (const c of cells) for (const g of c.groups) note(g, `${c.index}:${c.name}`);
    else for (const g of mesh.groups) note(g, '-');
    console.log(`${appearance}: ${use.size} shaders${cells ? `, ${cells.length} cells` : ''}`);
    for (const [shader, u] of [...use.entries()].sort((a, b) => b[1].tris - a[1].tris)) {
      let line = `  ${shader}  ${u.tris} tris`;
      try {
        // A flip-book's texture is its first frame and its effect its base's; an inline effect is read too.
        const described = describeSurface(vfs, shader, surfaceCache);
        const main = described.main;
        const effect = described.effect;
        const hasAlpha = main && vfs.has(main) ? decodeDds(vfs.read(main)).hasAlpha : null;
        const byEffect = described.inline ? alphaModeFor({ alphaBlend: !!described.pass?.anyBlend, alphaTest: !!described.pass?.anyTest }) : alphaFromEffect(vfs, effect, effectAlphaMode(effect));
        const invisible = /invisible/i.test(effect ?? '');
        const decided = invisible ? 'invisible (collision only)' : `${byEffect}${GLASS_NAMED.test(`${shader} ${main ?? ''}`) ? ' (glass by name: casts no shadow, clears while someone is aboard)' : ''}`;
        line += `\n      effect ${effect ?? (described.inline ? '(inline)' : '(none)')}  texture ${main ?? '(none)'}${hasAlpha === null ? '' : hasAlpha ? ' with alpha' : ' no alpha'}  -> ${decided}`;
        // A ship's paint shaders are drawn as the ships command bakes them: every pass at the shader's defaults.
        if (!invisible) line += `\n      surface: ${surfaceLine(textureFor(vfs, shader, { paint: !!options.ship }), described)}`;
        const painted = options.ship && isCustomizableShader(vfs, shader) ? loadShader(vfs, shader, paintContext) : null;
        // One line per variable: a pattern's TX1D operations (MAIN and HUEB) each name the same one.
        if (isPaintShader(painted)) line += `\n      paint: baked at its defaults (${painted.textureFiles.get('MAIN')}), ${[...new Set(describeVariables(painted.variables))].join('; ')}`;
      } catch (err) {
        line += `\n      unreadable: ${err.message}`;
      }
      if (cells) line += `\n      in cells ${[...u.cells].join(', ')}`;
      console.log(line);
    }
    // The hardpoints, cell by cell: the seats, the engines, and whatever names the way in.
    const hps = cells ? cells.map((c) => ({ where: `${c.index}:${c.name}`, hardpoints: c.hardpoints })) : [{ where: '-', hardpoints: mesh.hardpoints }];
    const count = hps.reduce((n, h) => n + h.hardpoints.length, 0);
    console.log(`${count} hardpoints`);
    for (const h of hps) if (h.hardpoints.length) console.log(`  ${h.where}: ${h.hardpoints.map((hp) => `${hp.name} (${hp.position.map((v) => v.toFixed(1)).join(',')})`).join('  ')}`);
    break;
  }
  case 'shader': {
    const vfs = mount(pos[1]);
    const { main, slots, effect, alphaMode } = shaderTextures(parseIff(vfs.read(pos[2])));
    console.log(`effect: ${effect ?? '(none)'}  alpha by name: ${alphaMode}  alpha by effect file: ${alphaFromEffect(vfs, effect, alphaMode)}`);
    for (const s of slots) console.log(`${s.slot}  ${s.path}${s.path === main ? '  (main)' : ''}`);
    // What the shader's forms and its effect's first pass say (flip-books, scroll, split alpha,
    // glow), and what the converter makes of it.
    const described = describeSurface(vfs, pos[2], surfaceCache);
    for (const l of describeLines(described)) console.log(l);
    const entry = textureFor(vfs, pos[2]);
    console.log(`decision: ${entry ? `${entry.alphaMode}; ${surfaceLine(entry, described)}` : 'no texture: drawn untextured'}`);
    break;
  }
  case 'loading': {
    // <swg-dir> <out-dir> [--match=...] [--list]: the client's loading-screen pictures, one per
    // planet, found by name among the UI textures (the archives name them after the planet), as
    // PNGs the game's loading screen colours in as the world arrives.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const match = options.match ? new RegExp(options.match, 'i') : /ui_(load|loading)|load(ing)?_?screen|loadscreen/i;
    const candidates = vfs.list('texture/').filter((n) => /\.dds$/i.test(n) && match.test(n));
    if (options.list || !candidates.length) {
      console.log(candidates.length ? `${candidates.length} loading-screen textures:` : `no texture matches ${match}; every UI texture with "load" in its name:`);
      for (const n of candidates.length ? candidates : vfs.list('texture/').filter((n) => /load/i.test(n))) console.log(`  ${n}`);
      if (!candidates.length) console.log('pick a pattern from these and run again with --match=<pattern>');
      if (options.list) break;
    }
    const outDir = join(pos[2], 'loading');
    mkdirSync(outDir, { recursive: true });
    const planets = [['tatooine', /tatooine|tat\b/], ['naboo', /naboo/], ['corellia', /corellia|corel/], ['dantooine', /dantooine|dant/], ['lok', /\blok|_lok/], ['endor', /endor/], ['dathomir', /dathomir|dath/], ['yavin4', /yavin/], ['talus', /talus/], ['rori', /rori/], ['mustafar', /mustafar|must/], ['kashyyyk', /kashyyyk|kash/]];
    const index = {};
    for (const [id, re] of planets) {
      // The largest matching texture: the client keeps a small and a large of some.
      const hits = candidates.filter((n) => re.test(basename(n)));
      if (!hits.length) continue;
      let best = null;
      for (const n of hits) {
        try {
          const dds = decodeDds(vfs.read(n));
          if (!best || dds.width * dds.height > best.dds.width * best.dds.height) best = { name: n, dds };
        } catch (err) {
          console.log(`  ${n}: ${err.message}`);
        }
      }
      if (!best) continue;
      const img = downscaleRgba(best.dds, 2048);
      // Loading screens have no transparency: whatever the alpha holds is not for the picture.
      for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = 255;
      writeFileSync(join(outDir, `${id}.png`), encodePng(img.width, img.height, img.rgba));
      index[id] = { file: `${id}.png`, source: best.name, width: img.width, height: img.height };
      console.log(`  ${id.padEnd(10)} <- ${best.name} (${best.dds.width}x${best.dds.height}${hits.length > 1 ? `, of ${hits.length}` : ''})`);
    }
    writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));
    const missing = planets.map(([id]) => id).filter((id) => !index[id]);
    console.log(`-> ${outDir}: ${Object.keys(index).length} planets${missing.length ? `; none found for ${missing.join(', ')} (the game draws its own)` : ''}`);
    break;
  }
  case 'texture': {
    const vfs = mount(pos[1]);
    const dds = decodeDds(vfs.read(pos[2]));
    mkdirSync(dirname(pos[3]), { recursive: true });
    writeFileSync(pos[3], encodePng(dds.width, dds.height, dds.rgba));
    console.log(`${pos[2]} ${dds.width}x${dds.height} ${dds.format}${dds.hasAlpha ? ' with alpha' : ''} -> ${pos[3]}`);
    break;
  }
  case 'msh': {
    const vfs = mount(pos[1]);
    const r = convertOne(vfs, pos[2], pos[3]);
    console.log(`${r.meshPath} -> ${pos[3]} (${r.tris} triangles, ${r.textured}/${r.shaders.length} shaders textured: ${r.shaders.join(', ')})`);
    for (const w of r.warnings) console.log(`  warning: ${w}`);
    break;
  }
  case 'pack': {
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const spec = JSON.parse(readFileSync(pos[2], 'utf8'));
    buildPack(vfs, spec, pos[3], (meshPath, out) => convertOne(vfs, meshPath, out));
    printEffectSummary();
    break;
  }
  case 'planets': {
    if (!pos[1]) usage();
    const vfs = mount(pos[1]);
    for (const planet of snapshotPlanets(vfs)) {
      const { snap, entries, buildout } = loadPlanetObjects(vfs, planet);
      const centre = autoCenter(snap, entries);
      const known = GAME_PLANETS.includes(planet);
      const events = buildout.eventList?.length ? `; event-only areas: ${buildout.eventList.map((e) => `${e.area} (${e.rows} rows, "${e.event}")`).join(', ')}` : '';
      console.log(`${planet.padEnd(12)} ${String(snap.nodes.length).padStart(6)} objects (${buildout.objects} from buildouts), terrain ${vfs.has(`terrain/${planet}.trn`) ? 'yes' : 'no '}, centre ${centre.x.toFixed(0)},${centre.z.toFixed(0)} (${centre.why})${known ? '' : '  [not a planet in the game]'}${events}`);
    }
    break;
  }

  case 'flora': {
    // Only the flora models, for packs converted already: <swg-dir> <planet>|all <out-dir>
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const { parseTerrainTemplate } = await import('../../src/swg/terrain/trn.ts');
    const planets = pos[2] === 'all' ? snapshotPlanets(vfs).filter((p) => GAME_PLANETS.includes(p)) : [pos[2]];
    for (const planet of planets) {
      const outDir = pos[2] === 'all' ? join(pos[3], planet) : pos[3];
      const trnPath = `terrain/${planet}.trn`;
      if (!vfs.has(trnPath)) {
        console.warn(`no ${trnPath} in archives`);
        continue;
      }
      const manifestPath = join(outDir, 'manifest.json');
      const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { planet, categories: {} };
      mkdirSync(outDir, { recursive: true });
      console.log(`=== ${planet} ===`);
      const flora = convertFlora(vfs, parseTerrainTemplate(new Uint8Array(vfs.read(trnPath))), outDir, manifest);
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`flora: ${flora.models} models for ${flora.families} families${flora.missing ? `, ${flora.missing} appearances missing` : ''}${flora.particles ? `, ${flora.particles} particle effects skipped` : ''}`);
    }
    printEffectSummary();
    break;
  }

  case 'creatures': {
    // <swg-dir> <out-dir>: the creature of every planet the game spawns, as skinned GLBs under <out-dir>/creatures/
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    // <swg-dir> <out-dir> [--no-mounts] [--match=bantha]: the planets' creatures, then every
    // creature the game's saddle map lists as mountable (the banthas, dewbacks, kaadu, cu pa,
    // varactyls, tauntauns and the rest), each converted with the clips the game drives and the
    // hardpoints its body carries (a mount's saddle point, under its joint), and every saddle the
    // mount tables name into <out-dir>/creatures/saddles/, once each.
    const outDir = join(pos[2], 'creatures');
    const saddlesDone = new Map(); // saddle appearance (lower-cased) -> { file, player }
    mkdirSync(outDir, { recursive: true });
    const wanted = Object.entries(CREATURES).map(([id, template]) => ({ id, template, mount: false }));
    const mounts = flags.has('--no-mounts') ? [] : mountCreatures(vfs);
    for (const m of mounts) {
      const have = wanted.find((w) => w.id === m.id);
      if (have) have.mount = true;
      else wanted.push({ id: m.id, template: m.template, mount: true });
    }
    const match = options.match ? new RegExp(options.match, 'i') : null;
    const list = [];
    // A matched run redoes some creatures and keeps the rest of the manifest as it was.
    const old = match && existsSync(join(outDir, 'manifest.json')) ? JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')).creatures ?? [] : [];
    for (const { id, template, mount } of wanted) {
      if (match && !match.test(id)) {
        const kept = old.find((c) => c.id === id);
        if (kept) list.push(kept);
        continue;
      }
      const out = join(outDir, `${id}.glb`);
      try {
        // How a rider sits on it, from the mount tables: the saddle its body takes, the riding clip's pose.
        const satRaw = resolveTemplateString(vfs, template, ['appearanceFilename'], new Map());
        const satPath = satRaw ? satRaw.replace(/\\/g, '/').replace(/^\//, '') : null;
        const ride = satPath ? riderPoseFor(vfs, satPath) : null;
        // Where its saddle hangs: its own mesh's saddle hardpoint, else the one the appearance the
        // tables list carries (bantha_hue.sat for bantha.sat) when both are built on one skeleton.
        let pick = null;
        if (satPath && vfs.has(satPath)) {
          const own = satHardpoints(vfs, satPath);
          const listedSat = ride?.sat ? String(ride.sat).replace(/\\/g, '/').replace(/^\//, '') : null;
          const listed = !own.hardpoints.some((h) => h.name.toLowerCase() === 'saddle') && listedSat && listedSat.toLowerCase() !== satPath.toLowerCase() && vfs.has(listedSat) ? satHardpoints(vfs, listedSat) : null;
          pick = pickSaddleHardpoint({ own: own.hardpoints, ownSkeleton: own.skeleton, ownSat: satPath, listed: listed?.hardpoints ?? [], listedSkeleton: listed?.skeleton ?? '', listedSat });
        }
        const info = convertSat(vfs, template, out, { animations: CREATURE_CLIPS, hardpoints: true, extraHardpoints: pick && pick.from !== satPath ? [pick.hardpoint] : [] });
        const hardpointNames = (info.hardpoints ?? []).map((h) => h.name);
        const onJoint = (info.hardpoints ?? []).find((h) => h.name.toLowerCase() === 'saddle') ?? null;
        // The saddle the tables name (an .apt; the basilisk's is its own .sat), converted once per run.
        let saddle = null;
        if (ride?.saddle && /\.apt$/i.test(ride.saddle)) {
          const appearance = String(ride.saddle).replace(/\\/g, '/').replace(/^\//, '');
          let conv = saddlesDone.get(appearance.toLowerCase());
          if (!conv) {
            conv = { file: null, player: null };
            const name = basename(appearance).replace(/\.[^.]+$/, '');
            if (!vfs.has(appearance)) console.warn(`${id}: its saddle ${appearance} is not in the archives`);
            else {
              try {
                const r = convertOne(vfs, appearance, join(outDir, 'saddles', `${name}.glb`));
                // Where the rider's pelvis goes, in the saddle's own frame (the game's space; saddleEntry mirrors it).
                conv = { file: `creatures/saddles/${name}.glb`, player: r.mesh.hardpoints.find((h) => String(h.name).toLowerCase() === 'player')?.position ?? null };
                console.log(`  saddle ${appearance}: ${r.tris} tris, ${conv.player ? `rider point ${conv.player.map((n) => n.toFixed(3)).join(', ')}` : 'NO RIDER POINT'}`);
              } catch (err) {
                console.warn(`${id}: its saddle ${appearance} did not convert: ${err.message}`);
              }
            }
            saddlesDone.set(appearance.toLowerCase(), conv);
          }
          saddle = saddleEntry({ appearance, file: conv.file, player: conv.player, joint: onJoint?.joint ?? null, from: onJoint ? (pick?.from ?? info.sat) : null });
        }
        list.push({ id, file: `creatures/${id}.glb`, template, clips: info.animations, clipSpeeds: info.clipSpeeds ?? {}, bounds: info.bounds, ...(ride ? { riderPose: ride.pose } : {}), ...(mount ? { mount: true } : {}), hardpoints: hardpointNames, ...(saddle ? { saddle } : {}) });
        const seated = saddle?.joint ? `, saddle on its ${saddle.joint} joint` : saddle ? ', saddle where the back is guessed' : hardpointNames.some((n) => n.toLowerCase() === 'player') ? ', rides its own player point' : '';
        console.log(`${id}: ${info.joints} joints, ${info.meshes.reduce((a, m) => a + m.triangles, 0)} tris, clips ${info.animations.join(', ')}${info.missing.length ? `, missing ${info.missing.length}` : ''}${ride ? `, ridden as ${ride.pose}` : ', not in the mount tables'}${mount ? ' (a mount)' : ''}${seated}`);
      } catch (err) {
        console.warn(`${id}: ${err.message}`);
      }
    }
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ creatures: list }, null, 2));
    console.log(`creatures: ${list.length} (${list.filter((c) => c.mount).length} mounts) -> ${join(outDir, 'manifest.json')}`);
    printEffectSummary();
    break;
  }

  case 'mobiles': {
    // <swg-dir> <out-dir> [--only=...] [--match=re] [--limit=N] [--skip-existing] [--core3=<dir>|none] [--max-variants=32] [--plan]
    // Every creature, droid and person the mobile templates describe, into <out-dir>/mobiles/.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const outRoot = pos[2];
    const source = M.sourceStampOf({ retailOnly: flags.has('--retail-only'), archives: vfs.archives.map((a) => [basename(a.path).toLowerCase(), statSync(a.path).size]) });
    const core3Dir = options.core3 === 'none' ? null : options.core3 ?? process.env.CORE3 ?? null;
    let core3Stats = null;
    if (core3Dir) {
      core3Stats = core3MobileStats(core3Dir);
      if (!core3Stats.size) {
        console.log(`core3: no scripts/mobile under ${core3Dir}; stats stay heuristic`);
        core3Stats = null;
      }
    }
    M.runMobiles({
      vfs,
      scan: MS,
      io: mobilesIo(outRoot),
      convert: mobilesConvert(vfs, outRoot),
      source,
      code: mobilesCodeStamp(),
      core3Stats,
      options: {
        plan: flags.has('--plan'),
        skipExisting: flags.has('--skip-existing'),
        only: options.only ? options.only.split(',').map((k) => k.trim()).filter(Boolean) : null,
        match: options.match ?? null,
        limit: options.limit ? Number(options.limit) : null,
        maxVariants: options['max-variants'] ? Number(options['max-variants']) : 32,
        core3: options.core3 === 'none' ? 'none' : core3Dir ? 'read' : null,
      },
    });
    printEffectSummary();
    break;
  }

  case 'sat': {
    // <swg-dir> <appearance/x.sat | object/mobile/shared_x.iff> <out.glb> [--anim=all|idle,walk,run]
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const info = convertSat(vfs, pos[2], pos[3], { animations: options.anim ?? 'all', variables: customizationValues(options.var), wear: (options.wear ?? '').split(',').map((w) => w.trim()).filter(Boolean) });
    console.log(`${info.sat}: skeleton ${info.skeleton} (${info.joints} joints${info.attached.length ? `, with ${info.attached.join('; ')}` : ''})`);
    for (const m of info.meshes) console.log(`  mesh ${m.file}: ${m.triangles} tris, ${m.shaders} shaders, layer ${m.layer}${m.hidden ? `, ${m.hidden} tris under clothing` : ''}${m.occludes.length ? `, hides ${m.occludes.join(' ')}` : ''}`);
    for (const t of info.textureRenderers) console.log(`  texture renderer ${t}`);
    const fmt = (v) => v.map((x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))).join(' ');
    if (info.bounds) console.log(`  bounds (x mirrored): min ${fmt(info.bounds.min)}, max ${fmt(info.bounds.max)}`);
    for (const e of info.meshExtents ?? []) console.log(`  extent ${e.file}: ${e.vertices} vertices, min ${fmt(e.min)}, max ${fmt(e.max)}`);
    if (info.jointExtent) console.log(`  joints: bind translations within ${fmt(info.jointExtent.min)} to ${fmt(info.jointExtent.max)}; root ${info.rootJoint}`);
    if (info.customization.size) console.log(`  customization (set with --var=name=value,...):\n    ${[...info.customization].join('\n    ')}`);
    console.log(`  animations (${info.animations.length})${info.animationTable ? ` from ${info.animationTable}` : ''}: ${info.animations.join(', ') || 'none'}`);
    if (info.available && (!info.animations.length || options.anim === 'list')) console.log(`  available (${info.available.length}): ${info.available.join(', ')}`);
    if (info.unknownTransforms) console.log(`  ${info.unknownTransforms} vertex weights named joints the skeleton lacks: ${[...info.unknownJoints ?? []].join(', ')}`);
    for (const c of info.clipStats ?? []) console.log(`  clip ${c}`);
    for (const m of info.missing) console.log(`  missing: ${m}`);
    for (const m of info.skipped) console.log(`  skipped: ${m}`);
    console.log(`-> ${pos[3]}`);
    printEffectSummary();
    break;
  }

  case 'player': {
    // <swg-dir> <out-dir> [--template=object/creature/player/shared_human_male.iff] [--wear=...] [--var=...] [--anim=...]
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const template = (options.template ?? PLAYER_TEMPLATE).replace(/\\/g, '/');
    const id = basename(template).replace(/^shared_/, '').replace(/\.[^.]+$/, '');
    const outDir = join(pos[2], 'player');
    const wear = options.wear === undefined ? DEFAULT_WEAR : options.wear === 'none' ? [] : options.wear.split(',').map((w) => w.trim()).filter(Boolean);
    // --jka=<Jedi Academy GameData or base folder>: its saber attacks, jumps and rolls retargeted onto this skeleton.
    let jka = null;
    const extraClips = options.jka
      ? (joints, info) => {
          const wanted = options['jka-anims'] ? options['jka-anims'].split(',').map((a) => a.trim().toUpperCase()).filter(Boolean) : defaultJkaClips();
          const r = importJkaClips(options.jka, joints, wanted, { log: (m) => console.log(`  jka: ${m}`) });
          jka = r.info;
          info.jkaClips = Object.fromEntries(r.clips.map((c) => [c.name, { loop: c.loop, fps: c.fps, frames: c.frames, ...(c.speed ? { speed: c.speed } : {}) }]));
          for (const c of r.clips) if (c.speed) (info.clipSpeeds ??= {})[c.name] = c.speed;
          if (r.info.grip) info.jkaGrip = r.info.grip;
          return r.clips;
        }
      : null;
    const info = convertSat(vfs, template, join(outDir, `${id}.glb`), { animations: options.anim ?? PLAYER_CLIPS, variables: customizationValues(options.var), wear, maxAnimations: options['max-anims'] ? Number(options['max-anims']) : PLAYER_MAX_CLIPS, extraClips, moods: !flags.has('--no-moods') });
    console.log(`${info.sat}: skeleton ${info.skeleton} (${info.joints} joints${info.attached.length ? `, with ${info.attached.join('; ')}` : ''})`);
    if (jka) console.log(`  jka: ${Object.keys(info.jkaClips).length} clips retargeted${jka.missing.length ? `; not in animation.cfg: ${jka.missing.join(', ')}` : ''}`);
    if (jka) console.log(`  jka: locomotion speeds from the feet: ${Object.entries(info.jkaClips).filter(([, c]) => c.speed).map(([n, c]) => `${n} ${c.speed.toFixed(2)} m/s`).join(', ') || 'none'}`);
    for (const m of info.meshes) console.log(`  mesh ${m.file}: ${m.triangles} tris, ${m.shaders} shaders, layer ${m.layer}${m.hidden ? `, ${m.hidden} tris under clothing` : ''}`);
    for (const t of info.textureRenderers) console.log(`  texture renderer ${t}`);
    if (info.customization.size) console.log(`  customization (set with --var=name=value,...):\n    ${[...info.customization].join('\n    ')}`);
    if (info.shaderNotes.size) console.log(`  shaders:\n    ${[...info.shaderNotes].join('\n    ')}`);
    console.log(`  animations (${info.animations.length}): ${info.animations.join(', ') || 'none'}`);
    for (const m of info.moodNotes ?? []) console.log(`  mood ${m}`);
    if (info.moodClips) console.log(`  moods (${info.moodClips.length}): ${info.moodClips.join(', ') || 'none'}`);
    if (!info.animations.length && info.available) console.log(`  available (${info.available.length}): ${info.available.join(', ')}`);
    for (const c of info.clipStats ?? []) console.log(`  clip ${c}`);
    if (info.unknownTransforms) console.log(`  ${info.unknownTransforms} vertex weights named joints the skeleton lacks: ${[...info.unknownJoints ?? []].join(', ')}`);
    for (const m of info.missing) console.log(`  missing: ${m}`);
    for (const m of info.skipped) console.log(`  skipped: ${m}`);
    const manifestFile = join(outDir, 'manifest.json');
    const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { players: [] };
    {
      const wantedGun = ['loop_pistol_combat_standing_aimed', 'pistol_combat_standing_fire_1', 'loop_pistol_combat_kneeling_aimed', 'loop_rifle_a_combat_standing_aimed', 'rifle_standing_aimed_fire_1', 'loop_rifle_kneeling_combat_aimed'];
      const have = new Set(info.animations.map((n) => n.split(':')[0]));
      const lacking = wantedGun.filter((n) => !have.has(n));
      // This used to say the retail table was the smaller one -- "870 logical names, the Legends
      // one 908; convert without --retail-only" -- and it was blaming the archives for a reader
      // bug of ours. The table in the retail archives declares 908 names, 4 of them duplicated;
      // the reader could not follow 34 of them because it matched the direction selector's tag as
      // three characters instead of four, and 908 - 4 - 34 is 870 exactly. There is no smaller
      // retail table and there never was. If these names are still missing, the archives really
      // have not got them, so say only that.
      if (lacking.length) console.log(`  the animation table in these archives lacks ${lacking.join(', ')}: the blaster's combat stances and aimed shots the state hierarchy names. Without them the player and the fighters hold the last frame of a transition instead of a real aimed pose.`);
    }
    // `moods: false` is --no-moods, a size baseline the owner chose; status must not ask again for it.
    const entry = { id, file: `player/${id}.glb`, template, wear, variables: Object.fromEntries(customizationValues(options.var)), clips: info.animations, clipSpeeds: info.clipSpeeds ?? {}, moods: info.moodsAsked === true,...(info.partialClips ? { partialClips: info.partialClips } : {}), ...(info.variants ? { variants: info.variants } : {}), bounds: info.bounds, scale: 1, ...(info.jkaClips ? { jkaClips: info.jkaClips } : {}), ...(info.jkaGrip ? { jkaGrip: info.jkaGrip } : {}) };
    if (!info.jkaClips && existsSync(join(outDir, 'manifest.json'))) {
      const before = (JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')).players ?? []).find((e) => e.id === id);
      const had = Object.keys(before?.jkaClips ?? {}).length;
      if (had) console.log(`\n  WARNING: the previous conversion carried ${had} Jedi Academy clips (saber swings, jumps, rolls) and this one has none.\n  Re-run with --jka=<Jedi Academy GameData or base folder> (@JKA), then parts, clips-save and clips-apply, or the game loses them.\n`);
    }
    manifest.players = [entry, ...(manifest.players ?? []).filter((p) => p.id !== id)];
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    console.log(`-> ${join(outDir, `${id}.glb`)} and ${manifestFile}; the game uses the first entry`);
    printEffectSummary();
    break;
  }

  case 'wardrobe': {
    // <swg-dir> <out-dir> [--gender=male|female] [--kind=wearables,hair] [--match=armor] [--limit=N]
    // Every wearable and hairstyle built for the humanoid skeleton, as parts a character can put on.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const gender = (options.gender ?? 'male').toLowerCase().startsWith('f') ? 'f' : 'm';
    const kinds = (options.kind ?? 'wearables,hair').split(',').map((k) => k.trim()).filter(Boolean);
    const match = options.match ? new RegExp(options.match, 'i') : null;
    const limit = options.limit ? Number(options.limit) : Infinity;
    const template = (options.template ?? PLAYER_TEMPLATE).replace(/\\/g, '/');
    // The wardrobe is per gender: human_male, human_female (the --gender wins over the template's own).
    const speciesId = basename(template).replace(/^shared_/, '').replace(/\.[^.]+$/, '').replace(/_(male|female)$/, gender === 'f' ? '_female' : '_male');
    const outDir = join(pos[2], 'wardrobe', speciesId);
    mkdirSync(outDir, { recursive: true });

    // The species' merged skeleton: everything worn has to be weighted to these joints.
    const speciesSat = parseSat(readIff(vfs, resolveTemplateString(vfs, template, ['appearanceFilename'], new Map()).replace(/\\/g, '/').replace(/^\//, '')));
    const loadSkeleton = (file) => parseSkeleton(readIff(vfs, file), (f) => (vfs.has(f) ? readIff(vfs, f) : null));
    const baseSkeletonFile = speciesSat.skeletons[0].file;
    const extraSkeletons = speciesSat.skeletons.slice(1).filter((k) => vfs.has(k.file)).map((k) => ({ skeleton: loadSkeleton(k.file), attachTo: k.attachTo, file: k.file }));
    const skeleton = mergeSkeletons(loadSkeleton(baseSkeletonFile), extraSkeletons);
    const skin = skinData(skeleton, [], { flipX: true });
    const allowed = new Set([baseSkeletonFile.toLowerCase(), ...extraSkeletons.map((e) => e.file.toLowerCase())]);

    const templates = [...vfs.list()].filter((n) => kinds.some((k) => new RegExp(`^object/tangible/${k}/.*/shared_.*\\.iff$`).test(n))).sort();
    const ctx = renderContext(customizationValues(options.var));
    const catalogue = [];
    const failed = [];
    // The live recipes for the items whose look a colour changes (a shirt's palette factors, a
    // hairstyle's colour), one per material and mesh, with their images beside them.
    const recipes = [];
    const recipeKeys = new Set();
    const registry = new ImageRegistry((id, bytes) => {
      mkdirSync(join(outDir, 'customize'), { recursive: true });
      writeFileSync(join(outDir, 'customize', id), bytes);
    });
    // What the backpack shows of each item (its name, description, body slots and picture) and who may wear it:
    // the client's appearance table, a column per species and gender, read for this folder's own column (a
    // species' own cut of an item is converted for it) and recorded for the others as `fit`.
    const itemCaches = newItemCaches();
    const appearanceTable = readAppearanceTable(vfs);
    const column = speciesColumn(Object.keys(appearanceTable.values().next().value ?? {}), speciesId);
    if (appearanceTable.size && !column) console.log(`   the appearance table has no column for ${speciesId}: every item is worn as its template says`);
    const has = (p) => vfs.has(p);
    const icons = !flags.has('--no-icons');
    // The texture entries carry a reduced copy of their picture only while pictures are drawn.
    wantThumbs = icons;
    if (icons) mkdirSync(join(outDir, 'icons'), { recursive: true });
    const seenIds = new Set();
    const arrangementSlots = new Set();
    let took = 0, tableMissing = 0, unconverted = 0, unseen = 0, duplicates = 0;
    let done = 0;
    for (const tpl of templates) {
      if (done >= limit) break;
      const id = basename(tpl).replace(/^shared_/, '').replace(/\.[^.]+$/, '');
      if (match && !match.test(tpl)) continue;
      const kind = tpl.split('/')[2];
      const desc = describeItem(vfs, tpl, id, itemCaches);
      for (const alt of desc.slots ?? []) for (const slot of alt) arrangementSlots.add(slot);
      const row = appearanceTable.get(`shared_${id}`) ?? null;
      try {
        let satPath = resolveTemplateString(vfs, tpl, ['appearanceFilename'], new Map());
        if (!satPath) throw new Error('no appearance in its template chain');
        satPath = satPath.replace(/\\/g, '/').replace(/^\//, '');
        // The gender swap below, as the template alone would have had it: what "took the table's appearance" counts against.
        const ownWanted = satPath.replace(/_[fm](\.sat)$/i, `_${gender}$1`);
        const ownChoice = ownWanted !== satPath && vfs.has(ownWanted) ? ownWanted : satPath;
        const wantIcon = icons && kind !== 'hair' && !seenIds.has(id);
        // One appearance converted for this folder: the gender swap, the skeleton test, every mesh.
        const wearFrom = (path) => {
          let satPath = path;
          // A template names one gender's appearance; the client swaps the suffix for the other.
          // Take the wearer's if it exists, and note when only the other was authored.
          const wanted = satPath.replace(/_[fm](\.sat)$/i, `_${gender}$1`);
          let usedOtherGender = false;
          if (wanted !== satPath && vfs.has(wanted)) satPath = wanted;
          else if (/_[fm]\.sat$/i.test(satPath) && !satPath.toLowerCase().endsWith(`_${gender}.sat`)) usedOtherGender = true;
          if (!vfs.has(satPath)) throw new Error(`${satPath} not in archives`);
          const sat = parseSat(readIff(vfs, satPath));
          if (!sat.skeletons.some((k) => allowed.has(k.file.toLowerCase()))) throw new Error(`built for ${sat.skeletons.map((k) => basename(k.file)).join(', ') || 'no skeleton'}`);
          const entries = [];
          // The item's variables (a shirt's colour 1 and 2), noted per mesh as its shaders are read.
          const info = { missing: [], skipped: [], customization: new Set(), variables: new Map(), textureRenderers: [], shaderNotes: new Set() };
          // Every mesh's groups and textures, for the picture; hair gets none (it is chosen on the Appearance tab).
          const drawn = { groups: [], textures: new Map() };
          const onMesh = wantIcon ? (_name, kept, textures) => {
            drawn.groups.push(...kept);
            for (const [shader, t] of textures) drawn.textures.set(shader, t);
          } : undefined;
          for (const name of sat.meshes) {
            const entry = convertWearableMesh(vfs, name, { skeleton, skin, outDir, ctx, info, recipes, recipeKeys, registry, onMesh });
            if (entry) entries.push(entry);
          }
          if (!entries.length) throw new Error('no mesh survived');
          return { satPath, usedOtherGender, entries, info, drawn };
        };
        // The table's verdict for this folder's own column (items.mjs wardrobeChoice): a species' own cut wins over the
        // template (the men's bracelets, the Ithorian pieces); a path the archives lack, or misspelt, is the template's
        // own; a cut that will not convert (six Ithorian camouflage pieces whose meshes the archives hold stripped) is
        // worn as the template names it; an item that cannot be built where the column says ':hide' is worn unseen.
        const choice = wardrobeChoice(column ? row?.[column] : undefined, satPath, ownChoice, has, wearFrom);
        if (choice.missing) tableMissing++;
        if (choice.unseen) {
          // Worn unseen: this species takes the item's slots and nothing is drawn (the Ithorians' 172, built for the
          // humanoid skeleton), so the entry is written with no meshes rather than left out.
          catalogue.push({ id, template: tpl, kind, sat: null, gender, name: desc.name, description: desc.description, slots: desc.slots, icon: null, fit: { hide: [speciesId] }, parts: [], variables: [] });
          if (seenIds.has(id)) duplicates++;
          seenIds.add(id);
          unseen++;
          done++;
          continue;
        }
        if (choice.error) throw choice.error;
        const made = choice.made;
        if (choice.fellBack) unconverted++;
        // Counted against what the template alone gave: the table took over only where the mesh changed.
        if (choice.took) took++;
        const { entries, info, drawn, usedOtherGender } = made;
        satPath = made.satPath;
        // One picture per id: a repeated id (five templates are appearance_invisible_s01) keeps the first entry's.
        let icon = null;
        if (seenIds.has(id)) duplicates++;
        else if (wantIcon) {
          try {
            const pic = renderThumbnail(iconMeshes(drawn.groups, drawn.textures), { view: 'wear' });
            if (pic) {
              writeFileSync(join(outDir, 'icons', `${id}.png`), encodePng(pic.width, pic.height, pic.rgba));
              icon = `icons/${id}.png`;
            }
          } catch (err) {
            console.log(`   ${id}: no picture (${err.message})`);
          }
        }
        seenIds.add(id);
        // The rest of the gender's species; this folder's own wears the entry's `sat`, whatever its cell names.
        const fit = wardrobeFit(row, gender, satPath, has, speciesId);
        catalogue.push({ id, template: tpl, kind, sat: satPath, gender: usedOtherGender ? (gender === 'm' ? 'f' : 'm') : gender, name: desc.name, description: desc.description, slots: desc.slots, icon, ...(fit ? { fit } : {}), parts: entries, variables: customizationList(vfs, info) });
        done++;
        if (done % 50 === 0) console.log(`  ${done} converted...`);
      } catch (err) {
        failed.push(`${id}: ${err.message}`);
      }
    }
    const bytes = catalogue.reduce((a, c) => a + c.parts.reduce((b, p) => b + p.bytes, 0), 0);
    writeFileSync(join(outDir, 'wardrobe.json'), JSON.stringify({ species: speciesId, gender, skeleton: baseSkeletonFile, items: catalogue }, null, 2));
    if (recipes.length) {
      const palettes = exportPalettes(vfs, recipes.flatMap((r) => palettesOf(r)));
      writeFileSync(join(outDir, 'customize.json'), JSON.stringify({ images: 'customize/', recipes, palettes }, null, 1));
    }
    console.log(`-> ${outDir}: ${catalogue.length} items, ${catalogue.reduce((a, c) => a + c.parts.length, 0)} meshes, ${(bytes / 1e6).toFixed(1)} MB${recipes.length ? `; ${recipes.length} live colour recipes over ${registry.ids.size} images` : ''}`);
    const withMorphs = catalogue.filter((c) => c.parts.some((p) => p.morphs.length)).length;
    const otherGender = catalogue.filter((c) => c.gender !== gender).length;
    console.log(`   ${withMorphs} carry body-shape morphs; ${otherGender} exist only in the other gender's mesh`);
    const counted = itemPackStatus(catalogue);
    console.log(`   ${counted.named} named, ${counted.slotted} with slots, ${counted.iconed} icons, ${counted.fitted} with species rules, ${unseen} worn unseen, ${took} took the table's appearance (${tableMissing} of its paths missing, ${unconverted} would not convert), ${duplicates} repeated ids`);
    // Slots the arrangements name that the player has not (a door or a strut in a file that is no garment).
    try {
      if (vfs.has(PLAYER_SLOTS)) {
        const playerSlots = new Set(parseSlotDescriptor(parseIff(vfs.read(PLAYER_SLOTS))));
        const foreign = [...arrangementSlots].filter((s) => !playerSlots.has(s)).sort();
        if (foreign.length) console.log(`   slots the arrangements name that the player has not: ${foreign.join(', ')}`);
      }
    } catch (err) {
      console.log(`   the player's slot descriptor did not read: ${err.message}`);
    }
    if (failed.length) {
      // The reasons, most common first, so a bug that fails every item shows as one line rather than hiding behind the usual few.
      const reasons = new Map();
      for (const f of failed) {
        const why = f.replace(/^[^:]*: /, '').replace(/[a-z0-9_/.]+\.(sat|iff|mgn|lmg|sht)/gi, 'â€¦');
        reasons.set(why, (reasons.get(why) ?? 0) + 1);
      }
      console.log(`   ${failed.length} skipped: ${[...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([why, n]) => `${n} Ã— ${why}`).join('; ')}`);
    }
    break;
  }

  case 'parts': {
    // <swg-dir> <out-dir> [--template=...] [--wear=...]: body, head and each worn item as its own
    // GLB against one shared skeleton, with the occlusion zones left for the game to apply.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const template = (options.template ?? PLAYER_TEMPLATE).replace(/\\/g, '/');
    const wear = options.wear === undefined ? DEFAULT_WEAR : options.wear === 'none' ? [] : options.wear.split(',').map((w) => w.trim()).filter(Boolean);
    convertParts(vfs, pos[2], template, { wear, variables: customizationValues(options.var), anim: options.anim, maxAnims: options['max-anims'] });
    writeSpeciesIndex(pos[2]);
    break;
  }

  case 'species': {
    // <swg-dir> <out-dir> [--only=human,twilek_female] [--wear=...] [--var=...]: every playable species and
    // gender (object/creature/player/shared_<species>_<gender>.iff) as a parts pack, the Jedi Academy
    // clip bundle applied to each rig when the player has one, and characters/index.json listing them
    // with their customization variables (palette colours, index ranges) and shape sliders.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const only = options.only ? options.only.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : null;
    const templates = [...vfs.list('object/creature/player/')].filter((n) => /\/shared_[a-z_]+_(male|female)\.iff$/i.test(n)).sort();
    const picked = templates.filter((t) => !only || only.some((o) => basename(t).toLowerCase().includes(o)));
    if (!picked.length) {
      console.log(`no player species templates${only ? ` matching ${only.join(', ')}` : ''}; the archives hold: ${templates.map((t) => basename(t)).join(', ') || 'none'}`);
      break;
    }
    const wear = options.wear === undefined ? DEFAULT_WEAR : options.wear === 'none' ? [] : options.wear.split(',').map((w) => w.trim()).filter(Boolean);
    const bundle = join(pos[2], 'player', 'jka.clips');
    const done = [];
    const failed = [];
    for (const template of picked) {
      const id = basename(template).replace(/^shared_/, '').replace(/\.[^.]+$/, '');
      console.log(`\n${id} (${template})`);
      try {
        const r = convertParts(vfs, pos[2], template, { wear, variables: customizationValues(options.var), anim: options.anim, maxAnims: options['max-anims'] });
        if (existsSync(bundle)) {
          const n = applyBundleToRig(join(r.outDir, 'rig.glb'), bundle);
          if (n) console.log(`   ${n} Jedi Academy clips applied from ${bundle}`);
        } else console.log('   no player/jka.clips bundle to apply: run the player command with --jka and clips-save first for the saber, jump and roll clips');
        done.push(id);
      } catch (err) {
        failed.push(`${id}: ${err.message}`);
        console.log(`   failed: ${err.message}`);
      }
    }
    const index = writeSpeciesIndex(pos[2]);
    console.log(`\n-> ${join(pos[2], 'characters', 'index.json')}: ${index.species.length} characters (${done.length} converted now${failed.length ? `, ${failed.length} failed: ${failed.join('; ')}` : ''})`);
    for (const sp of index.species) console.log(`   ${sp.id.padEnd(22)} ${sp.parts} parts, ${sp.morphs.length} shape sliders, ${sp.variables.filter((v) => v.kind === 'palette').length} colour palettes, ${sp.variables.filter((v) => v.kind === 'index').length} choices, ${sp.jkaClips} Jedi Academy clips${sp.wardrobe ? `, wardrobe ${sp.wardrobe}` : ''}`);
    break;
  }

  case 'clips-save': {
    // <model.glb> <out.clips> [--only=BOTH_,TORSO_]: lift a model's animations out into a bundle
    if (!pos[2]) usage();
    const buf = readFileSync(pos[1]);
    const prefixes = options.only ? options.only.split(',').map((x) => x.trim()).filter(Boolean) : null;
    const keep = prefixes ? (name) => prefixes.some((p) => name.toUpperCase().startsWith(p.toUpperCase())) : () => true;
    const bundle = extractClips(buf, keep);
    if (!bundle.clips.length) throw new Error(`${pos[1]} has no animations matching ${prefixes ? prefixes.join(', ') : 'anything'}`);
    // A GLB cannot say whether a clip loops or how fast it plays; the manifest beside it can,
    // and that is exactly the part a re-conversion would otherwise throw away.
    const srcManifest = join(dirname(pos[1]), 'manifest.json');
    if (existsSync(srcManifest)) {
      const m = JSON.parse(readFileSync(srcManifest, 'utf8'));
      const entry = (m.players ?? []).find((e) => basename(e.file) === basename(pos[1]));
      if (entry) {
        const names = new Set(bundle.clips.map((c) => c.name));
        bundle.meta = {
          jkaClips: Object.fromEntries(Object.entries(entry.jkaClips ?? {}).filter(([n]) => names.has(n))),
          clipSpeeds: Object.fromEntries(Object.entries(entry.clipSpeeds ?? {}).filter(([n]) => names.has(n))),
          scale: entry.scale,
          ...(entry.jkaGrip ? { grip: entry.jkaGrip } : {}),
        };
      }
    }
    const packed = packClips(bundle);
    writeFileSync(pos[2], packed);
    if (bundle.meta) console.log(`   carrying ${Object.keys(bundle.meta.jkaClips).length} Jedi Academy loop flags and ${Object.keys(bundle.meta.clipSpeeds).length} clip speeds`);
    const frames = bundle.clips.reduce((n, c) => n + c.times.length, 0);
    console.log(`-> ${pos[2]}: ${bundle.clips.length} clips, ${frames} frames, ${bundle.joints.length} joints, ${(packed.length / 1e6).toFixed(1)} MB`);
    console.log(`   ${bundle.clips.slice(0, 6).map((c) => c.name).join(', ')}${bundle.clips.length > 6 ? ', ...' : ''}`);
    break;
  }

  case 'clips-apply': {
    // <model.glb> <in.clips> [--drop=BOTH_]: put a bundle's animations onto a model, matching joints by name
    if (!pos[2]) usage();
    const glbFile = pos[1];
    const buf = readFileSync(glbFile);
    const { json } = readGlb(buf);
    const joints = skinJoints(json);
    const bundle = unpackClips(readFileSync(pos[2]));
    const { clips, missing } = retargetClips(bundle, joints);
    const prefixes = options.drop ? options.drop.split(',').map((x) => x.trim()).filter(Boolean) : null;
    const incoming = new Set(clips.map((c) => c.name));
    // Replace clips of the same name, and anything the caller names by prefix.
    const drop = (name) => incoming.has(name) || (prefixes ? prefixes.some((p) => name.toUpperCase().startsWith(p.toUpperCase())) : false);
    const backup = `${glbFile}.bak`;
    if (!existsSync(backup)) writeFileSync(backup, buf);
    writeFileSync(glbFile, replaceClips(buf, clips, drop));
    // Put the loop flags and speeds back on the manifest the game reads.
    let restored = '';
    // A parts rig keeps the same animation metadata, in its own manifest.
    const partsManifest = join(dirname(glbFile), 'parts.json');
    if (bundle.meta && existsSync(partsManifest)) {
      const m = JSON.parse(readFileSync(partsManifest, 'utf8'));
      const { json: after } = readGlb(readFileSync(glbFile));
      const present = new Set((after.animations ?? []).map((a) => a.name));
      m.rig = { ...(m.rig ?? {}), clips: present.size };
      m.jkaClips = Object.fromEntries(Object.entries(bundle.meta.jkaClips ?? {}).filter(([n]) => present.has(n)));
      m.clipSpeeds = { ...(m.clipSpeeds ?? {}), ...(bundle.meta.clipSpeeds ?? {}) };
      if (bundle.meta.scale !== undefined) m.scale = bundle.meta.scale;
      if (bundle.meta.grip) m.jkaGrip = bundle.meta.grip;
      writeFileSync(partsManifest, JSON.stringify(m, null, 2));
      restored = `; parts.json updated with ${Object.keys(m.jkaClips).length} loop flags`;
    }
    const outManifest = join(dirname(glbFile), 'manifest.json');
    if (bundle.meta && existsSync(outManifest)) {
      const m = JSON.parse(readFileSync(outManifest, 'utf8'));
      const entry = (m.players ?? []).find((e) => basename(e.file) === basename(glbFile));
      if (entry) {
        const { json: after } = readGlb(readFileSync(glbFile));
        const present = new Set((after.animations ?? []).map((a) => a.name));
        entry.clips = [...present];
        entry.jkaClips = { ...(entry.jkaClips ?? {}), ...Object.fromEntries(Object.entries(bundle.meta.jkaClips ?? {}).filter(([n]) => present.has(n))) };
        entry.clipSpeeds = { ...(entry.clipSpeeds ?? {}), ...(bundle.meta.clipSpeeds ?? {}) };
        if (bundle.meta.scale !== undefined) entry.scale = bundle.meta.scale;
        if (bundle.meta.grip) entry.jkaGrip = bundle.meta.grip;
        writeFileSync(outManifest, JSON.stringify(m, null, 2));
        restored = `; manifest updated with ${Object.keys(entry.jkaClips).length} loop flags`;
      }
    }
    console.log(`-> ${glbFile}: ${clips.length} clips applied${restored}${missing.length ? `; the bundle had no track for ${missing.length} joints (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''}), which hold their bind pose` : ''}`);
    break;
  }

  case 'jka-clips': {
    // <player.glb> <jka-dir|folder with _humanoid.gla + animation.cfg> [--jka-anims=...]: swap the GLB's Jedi Academy clips for freshly retargeted ones
    if (!pos[2]) usage();
    const glbFile = pos[1];
    const buf = readFileSync(glbFile);
    const { json } = readGlb(buf);
    const joints = skinJoints(json);
    const wanted = options['jka-anims'] ? options['jka-anims'].split(',').map((a) => a.trim().toUpperCase()).filter(Boolean) : defaultJkaClips();
    const r = importJkaClips(pos[2], joints, wanted, { log: (m) => console.log(`  jka: ${m}`) });
    const backup = `${glbFile}.bak`;
    if (!existsSync(backup)) writeFileSync(backup, buf);
    writeFileSync(glbFile, replaceClips(buf, r.clips, (name) => /^BOTH_/i.test(name)));
    const manifestFile = join(dirname(glbFile), 'manifest.json');
    if (existsSync(manifestFile)) {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      const entry = (manifest.players ?? []).find((p) => basename(p.file) === basename(glbFile));
      if (entry) {
        entry.clips = [...(entry.clips ?? []).filter((c) => !/^BOTH_/i.test(c)), ...r.clips.map((c) => c.name)];
        entry.jkaClips = Object.fromEntries(r.clips.map((c) => [c.name, { loop: c.loop, fps: c.fps, frames: c.frames, ...(c.speed ? { speed: c.speed } : {}) }]));
        entry.clipSpeeds = { ...(entry.clipSpeeds ?? {}), ...Object.fromEntries(r.clips.filter((c) => c.speed).map((c) => [c.name, c.speed])) };
        if (r.info.grip) entry.jkaGrip = r.info.grip;
        writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
      }
    }
    console.log(`-> ${glbFile}: ${r.clips.length} Jedi Academy clips${r.info.missing.length ? `; not in animation.cfg: ${r.info.missing.join(', ')}` : ''} (the previous file is kept as ${basename(backup)})`);
    break;
  }

  case 'weapons': {
    // <swg-dir> <out-dir> [--limit=N]: every weapon the game can hold, as models under <out-dir>/weapons
    // with a manifest naming each one's class (pistol, carbine, rifle, heavy, one-hand sword, knife,
    // two-hand sword, polearm, lightsaber); the kinds the game does not play yet are listed with why.
    // The same manifest carries the Force's own effects as its `powers` block (weapons.mjs).
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const outDir = join(pos[2], 'weapons');
    mkdirSync(outDir, { recursive: true });
    const { buildForcePowers, buildWeapons, forceBeamImage, EXTRA_EFFECTS, WEAPON_CLASSES, wornOnABody } = await import('./weapons.mjs');
    // The backpack's names, descriptions, hands and pictures (items.mjs, thumbnail.mjs); --no-icons draws none, and
    // then no texture entry carries the reduced copy the pictures are drawn from.
    const itemCaches = newItemCaches();
    const icons = !flags.has('--no-icons');
    wantThumbs = icons;
    if (icons) mkdirSync(join(outDir, 'icons'), { recursive: true });
    const { galleryTemplates } = await import('./gallery.mjs');
    const models = new Map();
    const cache = new Map();
    const convert = (template) => {
      const r = resolveTemplateMesh(vfs, template, cache);
      if (r.skip) return { skip: r.skip };
      if (r.particle) return { skip: 'particle effect' };
      if (r.skeletal) return { skip: 'skeletal appearance' };
      const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length && !r.parts[0].hardpoints?.length;
      const id = familyOf(single ? r.parts[0].mesh : r.appearance);
      if (!models.has(id)) {
        try {
          const conv = convertOne(vfs, single ? r.parts[0].mesh : r.appearance, join(outDir, `${id}.glb`));
          const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
          const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
          // The backpack's picture of the model, side on with its far end up and to the right.
          let icon = null;
          if (icons && conv.tris) {
            try {
              const textures = new Map();
              for (const g of conv.mesh.groups) {
                const t = textureFor(vfs, g.shader);
                if (t) textures.set(g.shader, t);
              }
              // Drawn in the frame the GLB was written in (--no-flip keeps the client's own), never its mirror.
              const pic = renderThumbnail(iconMeshes(conv.mesh.groups, textures), { view: 'weapon', flipX: conv.flipX });
              if (pic) {
                writeFileSync(join(outDir, 'icons', `${id}.png`), encodePng(pic.width, pic.height, pic.rgba));
                icon = `icons/${id}.png`;
              }
            } catch (err) {
              console.log(`   ${id}: no picture (${err.message})`);
            }
          }
          models.set(id, { id, file: `${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, icon, ...(conv.tris ? {} : { failed: 'no triangles' }) });
        } catch (err) {
          models.set(id, { id, failed: err.message });
        }
      }
      const def = models.get(id);
      if (!def || def.failed) return { skip: def?.failed ?? 'failed' };
      return { model: id, file: def.file, bounds: def.bounds, blade: r.saber ?? null, icon: def.icon ?? null };
    };
    // The client's weapon effects: each gun's template names a family (bolt, rocket, projectile_rifle,
    // ...) and an index into datatables/weapon/weapon.iff, whose row names the shot's particle
    // effect, the muzzle flash and the hit and miss effects (client effect files naming a particle
    // and a sound). The shot, the flash and the hit on a creature are converted into the pack.
    const { resolveTemplateParam, intParam: readInt } = await import('./objtemplate.mjs');
    const { boltReach } = await import('./ships.mjs');
    const { parseClientEffect } = await import('./shipdata.mjs');
    const fxCache = new Map();
    let fxTable = null;
    try {
      fxTable = parseDatatable(parseIff(vfs.read('datatables/weapon/weapon.iff')));
    } catch (err) {
      console.warn(`weapons: the weapon effect table did not read: ${err.message}`);
    }
    const cefParts = (cef) => {
      const path = (cef ?? '').replace(/\\/g, '/').replace(/^\//, '');
      if (!path || !vfs.has(path)) return { particle: null, sound: null, sounds: [] };
      try {
        const fx = parseClientEffect(parseIff(vfs.read(path)));
        // Every sound the effect names, not only its first: the game plays one of them, and which
        // it is is the effect's business, not ours.
        return { particle: fx.particles[0] ?? null, sound: fx.sounds[0] ?? null, sounds: fx.sounds };
      } catch {
        return { particle: null, sound: null, sounds: [] };
      }
    };
    const particleFile = (prt) => {
      if (!prt) return null;
      const p = convertParticle(vfs, prt.replace(/\\/g, '/'), outDir);
      return p.failed ? null : p.file;
    };
    const paramCache = new Map();
    const fxFor = (template) => {
      if (!fxTable) return null;
      const id = resolveTemplateParam(vfs, template, 'weaponEffect', stringParam, paramCache) ?? 'bolt';
      const index = resolveTemplateParam(vfs, template, 'weaponEffectIndex', readInt, paramCache) ?? 0;
      const key = `${id}|${index}`;
      if (fxCache.has(key)) return fxCache.get(key);
      const row = fxTable.rows.find((r) => r['Weapon Effect Id'] === id && r['Weapon Effect Index'] === index);
      let out = { id, index };
      if (row) {
        const shot = (row['Projectile Appearance Template'] ?? '').replace(/\\/g, '/');
        const fire = cefParts(row['Fire Client Effect']);
        const hit = cefParts(row['Hit (Creature) Client Effect']);
        const miss = cefParts(row['Miss (Hit Nothing) Client Effect']);
        // What the shot sounds like striking each of the five surfaces the table has a column for,
        // and coming to nothing in each of the eight ways it can: the particles drawn are still the
        // creature's hit and the plain miss, which are the two the game draws. Several columns
        // often name one effect (the light blaster's metal, stone, wood and other are all its
        // "other" effect), which is the table as the game shipped it.
        const hitSound = (what) => cefParts(row[`Hit (${what}) Client Effect`]).sounds;
        const missSound = (what) => cefParts(row[`Miss (Hit ${what}) Client Effect`]).sounds;
        let reach = 0;
        if (/\.prt$/i.test(shot) && vfs.has(shot)) {
          try {
            reach = boltReach(parseParticleEffect(parseIff(vfs.read(shot))));
          } catch {
            reach = 0;
          }
        }
        out = {
          id,
          index,
          shot: /\.prt$/i.test(shot) ? particleFile(shot) : null,
          reach: Number(reach.toFixed(2)),
          fire: particleFile(fire.particle),
          hit: particleFile(hit.particle),
          miss: particleFile(miss.particle),
          sounds: {
            fire: fire.sounds,
            hit: { creature: hitSound('Creature'), metal: hitSound('Metal'), stone: hitSound('Stone'), wood: hitSound('Wood'), other: hitSound('Other') },
            miss: { water: missSound('Water'), terrain: missSound('Terrain'), creature: missSound('Creature'), metal: missSound('Metal'), stone: missSound('Stone'), wood: missSound('Wood'), other: missSound('Other'), nothing: missSound('Nothing') },
            ricochet: cefParts(row['Ricochet Client Effect']).sounds,
          },
        };
      }
      fxCache.set(key, out);
      return out;
    };
    const limit = options.limit ? Number(options.limit) : Infinity;
    const { weapons, skipped } = buildWeapons(galleryTemplates(vfs, 'object/weapon/'), { convert, fxFor, describe: (template, id) => describeItem(vfs, template, id, itemCaches) }, { log: console.log, limit });
    // Effects beyond the guns' own rows (EXTRA_EFFECTS in weapons.mjs): the held triggers' beams,
    // the lightning's muzzle, and the burn a body that has been set alight wears.
    const effects = {};
    for (const { name, path: prt, worn } of EXTRA_EFFECTS) {
      if (!vfs.has(prt)) continue;
      const file = particleFile(prt);
      if (!file) continue;
      effects[name] = file;
      // An effect that is hung on a living body has to be one a body at rest can be seen wearing.
      // Read back what was just written and say so plainly if it is not: the fault is invisible by
      // eye (an effect that draws nothing looks exactly like a burn that is not working at all), so
      // it is worth one small file read per entry on a command that writes hundreds.
      if (!worn) continue;
      try {
        const check = wornOnABody(JSON.parse(readFileSync(join(outDir, file), 'utf8')));
        if (!check.ok) console.warn(`  ${name}: WARNING — this effect cannot be worn by a body: ${check.why}. A body set alight will not be drawn with it properly; the game will need another.`);
      } catch (err) {
        console.warn(`  ${name}: could not be checked as a body's effect: ${err.message}`);
      }
    }
    // The blade colours the game offers (palette/wp_lightsaber.pal), as hex.
    let saberColors = [];
    try {
      const { parsePalette } = await import('./texrender.mjs');
      if (vfs.has('palette/wp_lightsaber.pal')) saberColors = parsePalette(vfs.read('palette/wp_lightsaber.pal')).map(([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
    } catch (err) {
      console.warn('weapons: the saber palette did not read', err);
    }
    // The Force's own effects, which are in the archives: every `appearance/pt_force_*.prt`
    // converted, every `clienteffect/pl_force_*.cef` read for the particle and sound it names
    // together, and the beam appearances through the nebulae's own LEFX reader. Which effect goes
    // with which power is ours, because the game's power table was its server's; every row of the
    // block says whether its pairing is the game's, ours, or missing from the archives entirely.
    const { parseLightning } = await import('./nebula.mjs');
    const beamRead = (path) => {
      try {
        return vfs.has(path) ? parseLightning(parseIff(vfs.read(path))) : null;
      } catch (err) {
        console.log(`  beam ${path}: ${err.message}`);
        return null;
      }
    };
    const beamImage = (shader) => {
      const t = textureFor(vfs, shader);
      if (!t?.png) return null;
      const file = forceBeamImage(shader);
      mkdirSync(join(outDir, dirname(file)), { recursive: true });
      writeFileSync(join(outDir, file), t.png);
      return file;
    };
    const powers = buildForcePowers(
      {
        list: (prefix) => vfs.list(prefix),
        has: (path) => vfs.has(path),
        particle: (path) => convertParticle(vfs, path, outDir),
        clientEffect: (path) => (vfs.has(path) ? parseClientEffect(parseIff(vfs.read(path))) : null),
        beam: beamRead,
        image: beamImage,
      },
      { log: console.log },
    );
    const manifest = { classes: WEAPON_CLASSES, weapons, skipped, saberColors, effects, powers };
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`-> ${outDir}: ${weapons.length} weapons in ${models.size} models, ${skipped.length} left out (listed in manifest.json; I in game opens the rack, the Weapons tab); ${fxCache.size} weapon effect rows, ${particleCountFor(outDir)} particle effects; ${weapons.filter((w) => w.name).length} named, ${weapons.filter((w) => w.icon).length} with icons`);
    if (powers.skipped.length) console.log(`   the Force's files left out:\n${powers.skipped.map((s) => `     ${s.file}  (${s.why})`).join('\n')}`);
    const unknown = skipped.filter((s) => /unknown|melee kind/.test(s.why));
    if (unknown.length) console.log(`   kinds without a style yet:\n${unknown.map((s) => `     ${s.template}  (${s.why})`).join('\n')}`);
    printEffectSummary();
    break;
  }
  case 'ships': {
    // <swg-dir> <out-dir> [--limit=N]: every ship a player can fly (object/ship/player/), as models under
    // <out-dir>/ships with a manifest naming each one's class and, for the multi-crew ships, its interior
    // (the ship template's interiorLayoutFileName, a portal building converted alongside with its cells).
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const outDir = join(pos[2], 'ships');
    mkdirSync(outDir, { recursive: true });
    const shipsModule = await import('./ships.mjs');
    const { buildShips, SHIP_CLASSES } = shipsModule;
    const { galleryTemplates } = await import('./gallery.mjs');
    const models = new Map();
    const cache = new Map();
    // Every model's shaders (the GLB's material names), for the paint: which of them a customization repaints.
    const modelShaders = new Map();
    const convert = (template) => {
      const r = resolveTemplateMesh(vfs, template, cache);
      if (r.skip) return { skip: r.skip };
      if (r.particle) return { skip: 'particle effect' };
      if (r.skeletal) return { skip: 'skeletal appearance' };
      const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length && !r.parts[0].hardpoints?.length;
      const id = familyOf(single ? r.parts[0].mesh : r.appearance);
      if (!models.has(id)) {
        try {
          // Paint shaders are baked at their defaults (every pass), as the client draws a ship nobody painted.
          const conv = convertOne(vfs, single ? r.parts[0].mesh : r.appearance, join(outDir, `${id}.glb`), { paint: true });
          modelShaders.set(`${id}.glb`, conv.shaders);
          const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
          const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
          const effects = attachedEffects(vfs, conv.effects, outDir);
          // A hull that is a portal building (the yacht) carries its rooms as cells; the game boards them.
          models.set(id, { id, file: `${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, parts: conv.partCount, hardpoints: conv.mesh.hardpoints.map((h) => h.name), ...(conv.cells ? { cells: conv.cells, portals: conv.portals ?? [] } : {}), ...(effects.length ? { effects } : {}), ...(conv.tris ? {} : { failed: 'no triangles' }) });
        } catch (err) {
          models.set(id, { id, failed: err.message });
        }
      }
      const def = models.get(id);
      if (!def || def.failed) return { skip: def?.failed ?? 'failed' };
      return { model: id, file: def.file, bounds: def.bounds, cells: def.cells ? def.cells.filter((c) => c.index > 0).length : 0, hardpoints: def.hardpoints ?? [] };
    };
    // The interior the template names, whether or not the archives hold it: a missing one is
    // reported as such rather than passed over as if the ship had none.
    const interiorOf = (template) => {
      const pob = resolveTemplateString(vfs, template, ['interiorLayoutFileName', 'interiorLayoutFilename'], cache);
      if (!pob) return null;
      return pob.replace(/\\/g, '/').replace(/^\//, '');
    };
    const convertInterior = (template, pob) => {
      const id = `${familyOf(pob)}_interior`;
      if (!vfs.has(pob)) {
        // Which archive the file is in, or would be: the retail filter can leave one out.
        const held = vfs.versions(pob);
        return { skip: `${pob} not in the mounted archives${held.length ? ` (held by ${held.map((v) => v.archive).join(', ')})` : ''}` };
      }
      if (!models.has(id)) {
        try {
          const conv = convertOne(vfs, pob, join(outDir, `${id}.glb`), { paint: true });
          models.set(id, { id, file: `${id}.glb`, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, cells: conv.cells, portals: conv.portals ?? [], interior: true, ...(conv.tris ? {} : { failed: 'no triangles' }) });
        } catch (err) {
          models.set(id, { id, failed: err.message });
        }
      }
      const def = models.get(id);
      if (!def || def.failed) return { skip: def?.failed ?? 'failed' };
      return { file: def.file, cells: def.cells?.length ?? 0 };
    };
    // A model of an appearance for something that hangs on a hull (a wing, an engine, a cockpit frame).
    const { parseClientData, parseCockpit, parseClientEffect } = await import('./shipdata.mjs');
    // What hangs on a hull and on what (shipparts.mjs): the ship's own client data, each part's own in
    // turn, and the stock parts from the hull's chassis looks table (shipfit.mjs).
    let chassisRows = new Map();
    let slotNames = [];
    try {
      const chassisTable = parseDatatable(parseIff(vfs.read('datatables/space/ship_chassis.iff')));
      chassisRows = new Map(chassisTable.rows.map((r) => [r.name, r]));
      // name, flyby_sound, hit_sound_group, wing_open_speed_factor, then each slot with its hit weight and whether it is targetable.
      slotNames = chassisTable.columns.slice(4).filter((c) => !/_hitweight$|_targetable$/.test(c));
    } catch (err) {
      console.error(`chassis table not read (${err.message}): parts are found by name as before`);
    }
    // The customization tables (shipfit.mjs): every component with its type, class and name
    // (ship_components; the name is space/space_item:<name>_n, else the template's objectName, else made
    // from the key) and each gun's bolt (ship_weapon_components). Without them no ship gets a fit, and
    // the stock parts are each slot's most common look as before.
    const labelCache = new Map();
    const paramCache = new Map();
    let weaponRows = new Map();
    let components = null;
    try {
      weaponRows = new Map(parseDatatable(parseIff(vfs.read('datatables/space/ship_weapon_components.iff'))).rows.map((r) => [componentKey(r.name), r]));
      const labelOf = (name, row) => {
        const own = localize(vfs, `space/space_item:${name}_n`, labelCache);
        if (own) return own;
        const template = String(row.shared_object_template ?? '').trim().replace(/\\/g, '/');
        const sid = template ? resolveTemplateParam(vfs, template, 'objectName', setStringId, paramCache) : null;
        return sid ? localize(vfs, `${sid.table}:${sid.key}`, labelCache) : null;
      };
      components = componentList(parseDatatable(parseIff(vfs.read('datatables/space/ship_components.iff'))).rows, { labelOf, weaponRow: (n) => weaponRows.get(n) ?? null });
    } catch (err) {
      console.error(`ship component tables not read (${err.message}): no loadouts or paint, stock parts by the most common look`);
      components = null;
    }
    const weaponNames = [...weaponRows.keys()];
    const projectileOf = (name) => weaponRows.get(name)?.projectile_index;
    const attachmentTemplates = new Map(vfs.list('object/tangible/ship/attachment/').filter((f) => f.startsWith('object/tangible/ship/attachment/') && f.endsWith('.iff')).map((f) => [f.replace(/^.*\/shared_/, '').replace(/\.iff$/, ''), f]));
    const childrenCache = new Map();
    /**
     * A template's client data as assembly children: wings, then carriers in file order, then on/off
     * appearances. `quiet`: a missing file is not printed (a hull's, which extrasOf notes in the ship's notes).
     */
    const childrenOf = (template, quiet = false) => {
      const cdf = resolveTemplateString(vfs, template, ['clientDataFile'], cache);
      if (!cdf) return [];
      const path = cdf.replace(/\\/g, '/').replace(/^\//, '');
      if (!childrenCache.has(path)) {
        let kids = [];
        if (!vfs.has(path)) {
          if (!quiet) console.error(`  client data ${path} (of ${template}) not in the archives`);
        }
        else {
          try {
            kids = clientChildren(parseClientData(parseIff(vfs.read(path))));
          } catch (err) {
            console.error(`  client data ${path}: ${err.message}`);
          }
        }
        childrenCache.set(path, kids);
      }
      return childrenCache.get(path);
    };
    /** A part's model in the pack, from its appearance or its template's (convertAppearance, below, at call time). */
    const modelOf = (desc) => {
      let app = desc.appearance ?? null;
      if (!app && desc.template) {
        const r = resolveTemplateMesh(vfs, desc.template, cache);
        if (r.skip) return { skip: String(r.skip).replace(/ \(params: .*$/, '') };
        if (r.particle) return { skip: 'particle effect' };
        app = r.appearance ?? null;
      }
      if (!app) return { skip: 'no appearance' };
      if (/\.prt$/i.test(app)) return { skip: 'particle effect' };
      const m = convertAppearance(app);
      return m.skip ? m : { file: m.file, hardpoints: m.hardpoints, appearance: app.replace(/\\/g, '/').replace(/^\//, '') };
    };
    const convertAppearance = (appearance, suffix = '') => {
      const path = appearance.replace(/\\/g, '/').replace(/^\//, '');
      const id = `${familyOf(path)}${suffix}`;
      if (!models.has(id)) {
        try {
          if (!vfs.has(path)) throw new Error(`Not in archives: ${path}`);
          const conv = convertOne(vfs, path, join(outDir, `${id}.glb`), { paint: true });
          modelShaders.set(`${id}.glb`, conv.shaders);
          models.set(id, { id, file: `${id}.glb`, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, parts: conv.partCount, hardpoints: conv.mesh.hardpoints.map((h) => h.name), ...(conv.tris ? {} : { failed: 'no triangles' }) });
        } catch (err) {
          models.set(id, { id, failed: err.message });
        }
      }
      const def = models.get(id);
      return !def || def.failed ? { skip: def?.failed ?? 'failed' } : { file: def.file, hardpoints: def.hardpoints ?? [] };
    };
    // Only for a hull with no chassis looks table (none of the retail ships), the old guess by name.
    // The components a ship is fitted with: the game's engines, guns and boosters are objects of
    // their own (object/tangible/ship/components/), hung on the hull's and wings' hardpoints named
    // for them (engine_pos1, weapon1_neg1, booster_pos1). The first of the components made for
    // the ship's family and side is taken, its hardpoint's index picking among the guns.
    // Wherever the archives keep them and however they are named (the wings are
    // attachment/wing/shared_xwing_wing_pos_s01, so an engine is likely shared_xwing_engine_pos_s01
    // beside them): every template under object/tangible/ship/ that names the ship's family and the kind.
    const componentTemplates = galleryTemplates(vfs, 'object/tangible/ship/').filter((t) => !/\/shared_.*wing(_|$)/i.test(t) || /engine|weapon|booster|gun/i.test(t));
    const componentKinds = { engine: /(^|_)(eng|engine|engines)(_|$|\d)/i, weapon: /(^|_)(wpn|weapon|weapons|gun|guns|cannon|blaster)(_|$|\d)/i, booster: /(^|_)(bst|booster|boosters)(_|$|\d)/i };
    const componentsFor = (id, hardpoints, notes) => {
      const out = [];
      const family = partFamilyOf(id);
      for (const hp of hardpoints) {
        const m = /^(engine|weapon|booster)(\d*)_?([a-z]+)?_?(\d*)$/i.exec(hp);
        if (!m) continue;
        const [, kind, slot, side] = m;
        const kindRe = componentKinds[kind.toLowerCase()];
        let candidates = componentTemplates.filter((t) => {
          const base = t.replace(/^.*\/shared_/, '').replace(/\.iff$/, '');
          return base.includes(family) && kindRe.test(base) && !/(^|_)wing(_|$)/.test(base);
        });
        if (side) {
          const sided = candidates.filter((t) => t.includes(`_${side.toLowerCase()}`));
          if (sided.length) candidates = sided;
          else candidates = candidates.filter((t) => !/_(pos|neg)(_|$|\d)/.test(t));
        }
        if (!candidates.length) {
          notes.push(`no ${kind} component for ${hp} (none named for ${family} under object/tangible/ship/)`);
          continue;
        }
        // The hardpoint's own slot (weapon1 for weapon1_pos1) when the names carry one, else the
        // unnumbered ones; the lowest style (s01) of those; and every part of that style, since a
        // gun comes as its parts (â€¦_0, â€¦_1) on the one hardpoint.
        const base = (t) => t.replace(/^.*\/shared_/, '').replace(/\.iff$/, '');
        const numbered = slot ? candidates.filter((t) => new RegExp(`${kind}${slot}(_|$)`, 'i').test(base(t))) : [];
        const pool = numbered.length ? numbered : candidates.filter((t) => !new RegExp(`${kind}\\d`, 'i').test(base(t)));
        const chosen = pool.length ? pool : candidates;
        const styleOf = (t) => {
          const m2 = /_s(\d+)/.exec(base(t));
          return m2 ? Number(m2[1]) : 0;
        };
        const lowest = Math.min(...chosen.map(styleOf));
        const parts = chosen.filter((t) => styleOf(t) === lowest).sort();
        for (const template of parts) {
          const r = resolveTemplateMesh(vfs, template, cache);
          if (r.skip || !r.appearance) {
            notes.push(`${kind} ${template}: ${r.skip ?? 'no appearance'}`);
            continue;
          }
          const conv = convertAppearance(r.appearance);
          if (conv.skip) notes.push(`${kind} ${template}: ${conv.skip}`);
          else out.push({ kind: 'component', slot: kind.toLowerCase(), file: conv.file, template, hardpoint: hp });
        }
      }
      return out;
    };
    // Ship customization (shipfit.mjs): each hull's chassis slots with the components the game lets
    // each take, grouped by the model each shows on this hull; the stock component per slot; the droid
    // socket; and the paint, a recipe per customizable hull shader for the game to render again with
    // other values. The fits by ship id, for the gun each fires as sold.
    const fits = new Map();
    /** A hull's slots with their stock: the bolt it was always given (defaultWeaponFor) preferred in the gun slots. */
    const slotsOf = (id, chassis, hullTable) => {
      const slots = buildSlots(chassisRows.get(chassis), slotNames, hullTable, components);
      const tokens = hullTokens(chassis);
      const preferName = shipsModule.defaultWeaponFor(id, weaponNames);
      const preferProjectile = preferName ? projectileOf(preferName) ?? null : null;
      for (const s of slots) s.stock = pickStock(s, components, /^weapon_/.test(s.slot) ? { tokens, preferName, preferProjectile, weaponOf: projectileOf } : { tokens });
      return slots;
    };
    // The paint recipes (customize.json), one per paint shader, with their images under customize/.
    const recipes = new Map();
    const paintShaders = new Map();
    // Each paint shader's variables, kept from its first load: paintContext is emptied after every
    // ship's fit, so the images the bakes decoded are not held for the whole run.
    const paintVariables = new Map();
    const customizeDir = join(outDir, 'customize');
    const paint = { images: 0, bytes: 0, registry: null };
    const NO_IMAGE = {};
    /** An image for the recipes' registry: read afresh (never kept), or nothing when the registry has written it already. */
    const imageLoad = (file) => (paint.registry?.ids.has(file.toLowerCase()) ? NO_IMAGE : loadImage(vfs, file, new Map()));
    const registryFor = () => {
      if (paint.registry) return paint.registry;
      mkdirSync(customizeDir, { recursive: true });
      paint.registry = new ImageRegistry((file, bytes) => {
        writeFileSync(join(customizeDir, file), bytes);
        paint.images++;
        paint.bytes += bytes.length;
      });
      // A --match run adds to the recipes already there: its images are numbered past every one those
      // name, so none of theirs is overwritten.
      if (options.match) {
        let highest = -1;
        try {
          const old = JSON.parse(readFileSync(join(outDir, 'customize.json'), 'utf8'));
          for (const f of recipeImages(old.recipes)) highest = Math.max(highest, Number(/_(\d+)\.png$/.exec(f)?.[1] ?? -1));
        } catch {
          /* no recipes yet */
        }
        for (let i = 0; i <= highest; i++) paint.registry.ids.set(`\0kept:${i}`, null);
      }
      return paint.registry;
    };
    /** The static shader's own MAIN under a customizable one: the look before customization, kept for the game to show on request. */
    const staticMainOf = (shaderPath) => {
      try {
        const v = parseIff(vfs.read(shaderPath.replace(/\\/g, '/'))).children.find(isForm);
        const base = v?.children.find((c) => (isForm(c) ? c.type === 'SSHT' : c.tag === 'NAME'));
        if (!base) return null;
        return loadShader(vfs, isForm(base) ? base : readCString(base.data).value.replace(/\\/g, '/'), paintContext)?.textureFiles.get('MAIN') ?? null;
      } catch {
        return null;
      }
    };
    /**
     * Whether a model's shader is ship paint; the first time one is, its recipe: the shader trimmed to
     * the textures its passes read (and a glow's mask), every pattern and palette its variables choose
     * from, the static MAIN, and how it glows (describeSurface), so a repaint splits the glow from the
     * painted colour. A glow is written only when the converted material glows (its mask is not too
     * faint to split): the game puts a repaint's glow on the material's own emissive map, and a
     * material without one would need a new program. A shader whose recipe cannot be written is not
     * counted as paint.
     */
    const isPaint = (shaderPath) => {
      if (paintShaders.has(shaderPath)) return paintShaders.get(shaderPath);
      let yes = false;
      try {
        const loaded = isCustomizableShader(vfs, shaderPath) ? loadShader(vfs, shaderPath, paintContext) : null;
        if (isPaintShader(loaded)) {
          const glow = textureFor(vfs, shaderPath, { paint: true })?.emissive ? paintGlow(describeSurface(vfs, shaderPath, surfaceCache)) : null;
          const t = trimPaintShader(loaded, { staticMain: staticMainOf(shaderPath), keep: glow ? [glow.maskTag] : [] });
          const registry = registryFor();
          recipes.set(shaderPath, { mesh: 'ship', material: shaderPath, kind: 'bake', baseTag: 'MAIN', shader: exportShader(t.shader, registry, imageLoad), slots: [], staticMain: t.staticMain ? registry.idFor(t.staticMain, imageLoad(t.staticMain)) : null, ...(glow ? { glow } : {}) });
          paintVariables.set(shaderPath, loaded.variables);
          yes = true;
        }
      } catch (err) {
        console.error(`  paint recipe for ${shaderPath} not written: ${err.message}`);
      }
      paintShaders.set(shaderPath, yes);
      return yes;
    };
    const paletteSizes = new Map();
    const paletteSize = (p) => {
      if (!paletteSizes.has(p)) {
        let n = 0;
        try {
          n = vfs.has(p) ? parsePalette(vfs.read(p)).length : 0;
        } catch {
          n = 0;
        }
        paletteSizes.set(p, n);
      }
      return paletteSizes.get(p);
    };
    /**
     * A fit's slots from buildSlots' slots (with their stock): each look's parts converted with
     * `children`, the part's own subtree (expandPart: parents relative to the part, and by name what the
     * part does not carry, hung over the whole ship once the ship's parts are on). `carriedBy` is every
     * hardpoint the stock assembly carries, which bounds where a by-name child may go; `note` records a
     * note once. A player hull's fit (fitOf) and an NPC tier chassis's fit (combat.json) are both made here.
     */
    const looksToParts = (slots, carriedBy, deps, note) => {
      const partHardpoints = new Map();
      // Every look's pairs as parts; a pair whose template names no model (the TIE engines) is left out.
      const resolved = slots.map((s) =>
        s.looks.map((l) => {
          const parts = [];
          for (const p of l.pairs) {
            const template = attachmentTemplates.get(p.attachment);
            if (!template) {
              note(`look ${s.slot}: ${p.attachment} has no template`);
              continue;
            }
            const m = modelOf({ template });
            if (m.skip) {
              note(`look ${s.slot}: ${p.attachment}: ${m.skip}`);
              continue;
            }
            partHardpoints.set(m.file, m.hardpoints ?? []);
            parts.push({ file: m.file, hardpoint: p.hardpoint, template });
          }
          return parts;
        }),
      );
      const expand = (part, slot, shipHardpoints) => expandPart(part.template, partHardpoints.get(part.file) ?? [], deps, { slot, hardpoint: part.hardpoint || null, shipHardpoints });
      // Every hardpoint the ship can carry: the hull and what the stock assembly hung, every look's
      // parts, and what each of those carries in turn.
      const carried = new Set(carriedBy);
      for (const hps of partHardpoints.values()) for (const h of hps) carried.add(h);
      slots.forEach((s, i) => resolved[i].forEach((parts) => parts.forEach((part) => expand(part, s.slot, null).carried.forEach((h) => carried.add(h)))));
      const shipHardpoints = [...carried];
      return slots.map((s, i) => ({
        slot: s.slot,
        compat: s.compat,
        looks: s.looks.map((l, j) => {
          const parts = resolved[i][j].map((part) => {
            const kids = expand(part, s.slot, shipHardpoints);
            for (const n of kids.notes) if (!/hung by name$/.test(n)) note(`look part ${part.file}: ${n}`);
            return kids.attachments.length ? { ...part, children: kids.attachments } : part;
          });
          return { parts, components: l.components, ...(parts.length ? {} : { noModel: true }) };
        }),
        stock: s.stock ?? null,
        ...(s.fixed ? { fixed: true } : {}),
      }));
    };
    /**
     * A ship's fit (the manifest's `fit`): its slots (looksToParts); the droid socket (an astromech on a
     * hull with `hp:astromech`, else a flight computer); and the paint (every paint shader on the hull,
     * what the assembly hung and every look's parts, with one variable list). `built` is the stock
     * assembly, whose `carried` hardpoints bound where a by-name child may go.
     */
    const fitOf = (chassis, slots, hull, built, deps, notes) => {
      const seen = new Set();
      const note = (n) => {
        if (!seen.has(n)) {
          seen.add(n);
          notes.push(n);
        }
      };
      const fitSlots = looksToParts(slots, built.carried, deps, note);
      const files = new Set([hull?.file, ...built.attachments.map((a) => a.file)]);
      for (const s of fitSlots) for (const l of s.looks) for (const p of l.parts) for (const f of [p.file, ...(p.children ?? []).map((c) => c.file)]) files.add(f);
      const shaders = [];
      for (const f of files) for (const sh of modelShaders.get(f) ?? []) if (!shaders.includes(sh) && isPaint(sh)) shaders.push(sh);
      let painted = null;
      if (shaders.length) {
        const merged = mergePaintVariables(shaders.map((p) => ({ path: p, variables: paintVariables.get(p) ?? [] })), paletteSize);
        for (const n of merged.notes) note(`paint: ${n}`);
        painted = { shaders, variables: merged.variables };
      }
      // Every bake and recipe of this ship's paint is done (textureFor and isPaint keep their answers),
      // so the images paintContext decoded for them are let go rather than held to the end of the run.
      paintContext.images.clear();
      paintContext.shaders.clear();
      return { chassis, openSpeedFactor: wingOpenSpeedFactorOf(chassisRows.get(chassis)), droid: (hull?.hardpoints ?? []).includes('astromech') ? 'astromech' : 'computer', slots: fitSlots, paint: painted };
    };
    // What the ship's client data hangs on the hull, and its cockpit frame: the wings (templates
    // of their own, their appearances converted like the hull), an appearance shown while the
    // drive runs, the thruster and contrail hardpoints, and the cockpit's frame with its offsets.
    const extrasOf = (template, hull) => {
      const out = { attachments: [], thrusters: [], contrails: [], cockpit: null, notes: [] };
      const cdf = resolveTemplateString(vfs, template, ['clientDataFile'], cache);
      if (cdf) {
        const cdfPath = cdf.replace(/\\/g, '/').replace(/^\//, '');
        if (!vfs.has(cdfPath)) out.notes.push(`client data ${cdfPath} not in archives`);
        else {
          try {
            // The wings, carriers and on/off appearances are assembled below with the stock parts; the
            // hull's own client data gives the thrusters, contrails, damage and destruction here.
            const data = parseClientData(parseIff(vfs.read(cdfPath)));
            out.thrusters = data.thrusters.map((t) => t.hardpoint).filter(Boolean);
            out.contrails = data.contrails.map((c) => c.hardpoint).filter(Boolean);
            if (data.damage.length) out.damage = data.damage.map((d) => ({ from: d.from, to: d.to, hardpoint: d.hardpoint, position: d.transform ? d.transform.slice(0, 3) : null, particle: d.appearance || null }));
            if (data.destroyed) out.destroyed = data.destroyed;
          } catch (err) {
            out.notes.push(`client data ${cdfPath}: ${err.message}`);
          }
        }
      }
      // Everything the game hangs on the hull, as a tree (shipparts.mjs): the ship's own client data,
      // each part's own in turn, and the stock parts. With the component tables those are the fit's
      // stock (each slot's pickStock, whose look is the one the most compatible components show; a
      // modification slot starts empty, its one reward look never the ship as sold); without them, each
      // slot's most common look in the hull's chassis looks table, modifications left out.
      const { shipLabelOf } = shipsModule;
      const id = shipLabelOf(template);
      const base = template.replace(/^.*\/shared_/, '').replace(/\.iff$/, '');
      const chassis = chassisNameFor(base, (n) => chassisRows.has(n));
      const looksPath = chassis ? `datatables/space/ship_chassis_${chassis}.iff` : null;
      let hullTable = null;
      if (looksPath && vfs.has(looksPath)) {
        try {
          hullTable = parseDatatable(parseIff(vfs.read(looksPath)));
        } catch (err) {
          out.notes.push(`chassis looks ${looksPath}: ${err.message}`);
        }
      }
      let slots = null;
      if (chassis && components) {
        try {
          slots = slotsOf(id, chassis, hullTable);
        } catch (err) {
          out.notes.push(`chassis slots ${chassis}: ${err.message}`);
        }
      }
      let stock = null;
      if (hullTable) stock = slots ? stockPairs(slots, components, hullTable.columns) : modalLooks(hullTable).flatMap((l) => l.pairs.map((p) => ({ slot: l.slot, ...p })));
      const partDeps = { childrenOf: (t) => childrenOf(t), model: modelOf, templateOf: (n) => attachmentTemplates.get(n) ?? null };
      const built = assembleShip({ hardpoints: hull?.hardpoints ?? [] }, childrenOf(template, true), stock ?? [], partDeps);
      out.attachments.push(...built.attachments);
      out.notes.push(...built.notes);
      // No looks table: the old guess by name, written without `parent`, so the game hangs these by
      // name. None of the 63 retail ships takes this path.
      if (!stock) out.attachments.push(...componentsFor(shipLabelOf(template), built.carried, out.notes));
      out.chassis = chassis;
      out.wingOpenSpeedFactor = chassis ? wingOpenSpeedFactorOf(chassisRows.get(chassis)) : 1;
      // The loadout and paint the Edit page offers (null for a hull with no chassis row); none at all
      // when the component tables could not be read.
      if (components) {
        out.fit = null;
        if (slots) {
          try {
            out.fit = fitOf(chassis, slots, hull, built, partDeps, out.notes);
          } catch (err) {
            out.notes.push(`fit ${chassis}: ${err.message}`);
            console.error(`  fit of ${id} not written: ${err.stack ?? err.message}`);
          }
        }
        fits.set(id, out.fit);
      }
      const cockpit = resolveTemplateString(vfs, template, ['cockpitFilename'], cache);
      if (cockpit && !/noframe/i.test(cockpit)) {
        const cpPath = cockpit.replace(/\\/g, '/').replace(/^\//, '');
        if (!vfs.has(cpPath)) out.notes.push(`cockpit ${cpPath} not in archives`);
        else {
          try {
            const cp = parseCockpit(parseIff(vfs.read(cpPath)));
            if (cp.appearance) {
              const m = convertAppearance(cp.appearance, '_cockpit');
              if (m.skip) out.notes.push(`cockpit ${cp.appearance}: ${m.skip}`);
              else out.cockpit = { file: m.file, zoom: cp.zoom, first: cp.first, firstOffset: cp.firstOffset, thirdOffset: cp.thirdOffset };
            }
          } catch (err) {
            out.notes.push(`cockpit ${cpPath}: ${err.message}`);
          }
        }
      }
      return out;
    };
    // The game's projectiles (datatables/projectile/projectile.iff): each index names the bolt's
    // particle effect, the effect played when it fires (a sound) and the one played where it
    // strikes, per surface (a particle effect and a sound, through a client effect file). The
    // weapon table (datatables/space/ship_weapon_components.iff) gives each gun its projectile,
    // speed and range. The bolt and hit effects are converted into the pack's particles/, and the
    // tables written as projectiles.json; each ship's manifest entry names the gun it fires.
    const { defaultWeaponFor, boltReach } = shipsModule;
    const projectiles = [];
    const weapons = [];
    const effectOf = (cef) => {
      const path = (cef ?? '').replace(/\\/g, '/').replace(/^\//, '');
      if (!path || !vfs.has(path)) return { particle: null, sound: null };
      try {
        const fx = parseClientEffect(parseIff(vfs.read(path)));
        return { particle: fx.particles[0] ?? null, sound: fx.sounds[0] ?? null };
      } catch (err) {
        console.error(`  client effect ${path}: ${err.message}`);
        return { particle: null, sound: null };
      }
    };
    const particleFile = (prt) => {
      if (!prt) return null;
      const p = convertParticle(vfs, prt, outDir);
      return p.failed ? null : p.file;
    };
    try {
      const table = parseDatatable(parseIff(vfs.read('datatables/projectile/projectile.iff')));
      for (const row of table.rows) {
        const bolt = (row.appearanceTemplateName ?? '').replace(/\\/g, '/');
        if (!/\.prt$/i.test(bolt)) continue; // the tractor and lightning beams are not bolts
        const file = particleFile(bolt);
        if (!file) continue;
        const reach = boltReach(parseParticleEffect(parseIff(vfs.read(bolt))));
        const fire = effectOf(row.fireClientEffectTemplateName);
        const metal = effectOf(row.hitMetalClientEffectTemplateName);
        const other = effectOf(row.hitOtherClientEffectTemplateName);
        const shield = effectOf(row.hitShieldClientEffectTemplateName);
        projectiles.push({
          index: row.index,
          effect: file,
          reach: Number(reach.toFixed(2)),
          hit: { metal: particleFile(metal.particle), other: particleFile(other.particle), shield: particleFile(shield.particle) },
          sounds: { fire: fire.sound, hitMetal: metal.sound, hitOther: other.sound },
        });
      }
      const wt = parseDatatable(parseIff(vfs.read('datatables/space/ship_weapon_components.iff')));
      for (const row of wt.rows) weapons.push({ name: row.name, projectile: row.projectile_index, speed: row.speed, range: row.range, missile: !!row.missile });
      console.log(`projectiles: ${projectiles.length} bolts with their hit effects, ${weapons.length} weapons`);
    } catch (err) {
      console.error(`projectiles not converted: ${err.message}`);
    }
    // The gun a ship fires as sold: its fit's first stock bolt, else the old guess by name.
    const weaponOf = (id) => {
      const stock = fits.get(id) ? stockWeapon(fits.get(id), components) : null;
      if (stock) return stock;
      const name = defaultWeaponFor(id, weapons.map((w) => w.name));
      const w = weapons.find((x) => x.name === name);
      return w ? { name: w.name, projectile: w.projectile, speed: w.speed, range: w.range } : null;
    };
    const limit = options.limit ? Number(options.limit) : Infinity;
    const match = options.match ? new RegExp(options.match, 'i') : null;
    const allTemplates = galleryTemplates(vfs, 'object/ship/player/');
    const templates = allTemplates.filter((t) => !match || match.test(t));
    const { ships, skipped } = buildShips(templates, { convert, interiorOf, convertInterior, extrasOf, weaponOf }, { log: console.log, limit });
    // components.json: every component a slot can take (with its name and, for a gun, its bolt), and the
    // droids: the flight computers, and each astromech the mobiles pack holds, with the heads a hull draws
    // it as instead (the N-1's), converted here with the ships (so before the manifest's models are listed).
    let droids = [];
    if (components) {
      let droidTemplates = [];
      let headRows = [];
      try {
        droidTemplates = parseDatatable(parseIff(vfs.read('datatables/space_command/programmable_droids.iff'))).rows.map((r) => r.object_template);
      } catch (err) {
        console.error(`droid table not read (${err.message}): no droids or flight computers`);
      }
      try {
        headRows = parseDatatable(parseIff(vfs.read('datatables/space/ship_droid_appearance_override.iff'))).rows;
      } catch (err) {
        console.error(`droid appearance table not read (${err.message}): astromechs keep their own look on every hull`);
      }
      const heads = droidHeadRows(headRows, allTemplates, shipsModule.shipLabelOf);
      const built = buildDroids(droidTemplates, {
        appearanceOf: (t) => resolveTemplateString(vfs, t, ['appearanceFilename'], cache),
        localize: (sid) => localize(vfs, sid, labelCache),
        hasModel: (p) => existsSync(join(pos[2], p)),
        headsFor: (appearance) => {
          const out = {};
          for (const h of heads.get(appearance) ?? []) {
            const m = convertAppearance(h.appearance);
            if (m.skip) console.error(`  droid head ${h.appearance}: ${m.skip}`);
            else out[h.ship] = `ships/${m.file}`;
          }
          return out;
        },
      });
      droids = built.droids;
      for (const n of built.notes) console.log(`   droids: ${n}`);
      writeFileSync(join(outDir, 'components.json'), JSON.stringify({ format: SHIP_FIT_FORMAT, components, droids }, null, 1));
      // The paint recipes; a --match run keeps the other materials' recipes already there.
      let list = [...recipes.values()];
      if (match) {
        try {
          list = mergeRecipes(JSON.parse(readFileSync(join(outDir, 'customize.json'), 'utf8')).recipes, list);
        } catch {
          /* no recipes yet */
        }
      }
      writeFileSync(join(outDir, 'customize.json'), JSON.stringify({ images: 'customize/', recipes: list, palettes: exportPalettes(vfs, list.flatMap((r) => palettesOf(r))) }, null, 1));
    }
    const manifest = { classes: SHIP_CLASSES, ships, skipped, models: [...models.values()].filter((m) => !m.failed), materialFormat: MATERIAL_FORMAT, assembly: SHIP_ASSEMBLY_FORMAT, ...(components ? { fitFormat: SHIP_FIT_FORMAT } : {}) };
    if (projectiles.length) writeFileSync(join(outDir, 'projectiles.json'), JSON.stringify({ projectiles, weapons }, null, 2));
    if (match) {
      // A matched run redoes some ships: the rest keep their place in the manifest.
      try {
        const old = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
        // The ships this run did not redo keep the material format they were converted with.
        manifest.materialFormat = old.materialFormat ?? 1;
        const done = new Set(ships.map((sh) => sh.id));
        const files = new Set(manifest.models.map((m) => m.file));
        manifest.ships = [...(old.ships ?? []).filter((sh) => !done.has(sh.id) && !match.test(sh.template)), ...ships].sort((a, b) => a.class.localeCompare(b.class) || a.id.localeCompare(b.id));
        manifest.skipped = [...(old.skipped ?? []).filter((sk) => !match.test(sk.template)), ...skipped];
        manifest.models = [...(old.models ?? []).filter((m) => !files.has(m.file)), ...manifest.models];
        // Ships kept from an older manifest keep its format: a partial run never marks them current.
        const kept = manifest.ships.length - ships.length;
        manifest.assembly = kept === 0 || old.assembly === SHIP_ASSEMBLY_FORMAT ? SHIP_ASSEMBLY_FORMAT : (old.assembly ?? 1);
        // Likewise the loadouts: the ships kept keep whatever fit (or none) they were converted with.
        if (manifest.fitFormat !== undefined && kept && old.fitFormat !== SHIP_FIT_FORMAT) {
          if (old.fitFormat === undefined) delete manifest.fitFormat;
          else manifest.fitFormat = old.fitFormat;
        }
        console.log(`(--match: ${ships.length} ships redone, ${manifest.ships.length - ships.length} kept from the manifest as they were)`);
      } catch {
        /* no manifest yet: this run's ships are all of it */
      }
    }
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const withInterior = ships.filter((sh) => sh.interior && !sh.interior.failed).length;
    console.log(`-> ${outDir}: ${ships.length} ships in ${models.size} models, ${withInterior} with an interior, ${skipped.length} left out (listed in manifest.json; B in game opens the garage, ships at the bottom)`);
    writeFloors(outDir, (manifest.models ?? []).map((m) => m.id));
    if (skipped.length) console.log(`   left out:\n${skipped.map((sk) => `     ${sk.template}  (${sk.why})`).join('\n')}`);
    if (components) console.log(loadoutsLine([...fits.values()], droids, { shaders: recipes.size, images: paint.images, bytes: paint.bytes }));
    // NPC ships and space combat (combat.json, npcships.mjs): every tiered NPC ship type a garage hull
    // draws (its template has the hull's appearance) with its name and faction; a fit per tier chassis,
    // made as a player hull's is (buildSlots, pickStock with the gun the hull fires as sold, looksToParts)
    // but with no paint, since an NPC wears the stock paint baked into the models; the formation and
    // taunt tables; the hit, target, damage and explosion effects, converted. It reads the manifest as
    // written (a --match run's merged one). A --limit run's manifest has only some hulls, so it writes none
    // and keeps the file there; a failure leaves the ships as they are and removes combat.json, which would
    // index the components.json this run wrote (the pack then has no NPC ships and status asks for this command).
    if (Number.isFinite(limit) && !match) {
      console.log('combat: not written with --limit (every NPC type needs its hull in the manifest); the combat.json there is kept');
    } else {
      try {
        const npcNotes = [];
        const tableRows = (path) => {
          try {
            return vfs.has(path) ? parseDatatable(parseIff(vfs.read(path))).rows : null;
          } catch (err) {
            npcNotes.push(`${path}: ${err.message}`);
            return null;
          }
        };
        const tauntTables = {};
        for (const t of TAUNT_TABLES) {
          const path = `string/en/space/taunts/${t}.stf`;
          try {
            if (vfs.has(path)) tauntTables[t] = parseStringTable(vfs.read(path));
          } catch (err) {
            npcNotes.push(`${path}: ${err.message}`);
          }
        }
        const combat = buildCombat({
          templates: vfs.list('object/ship/shared_').filter((p) => /^object\/ship\/shared_[^/]+_tier\d+\.iff$/.test(p)),
          appearanceOf: (t) => resolveTemplateString(vfs, t, ['appearanceFilename'], cache),
          ships: manifest.ships,
          chassisRows,
          slotNames,
          nameOf: (id) => localize(vfs, `space/space_mobile_type:${id}`, labelCache),
          formations: Object.fromEntries(FORMATIONS.map((n) => [n, tableRows(`datatables/space/formation/${n}.iff`)])),
          taunts: tauntTables,
          hitEffectRows: tableRows('datatables/space/ship_hit_effects.iff'),
          hitSoundRows: tableRows('datatables/space/ship_hit_sounds.iff'),
          targetRows: tableRows('datatables/space/ship_target_appearance.iff'),
          particle: (prt) => particleFile(prt),
          effect: (cef) => particleFile(effectOf(cef).particle),
        });
        npcNotes.push(...combat.notes);
        // The tier fits. A tier chassis's looks table is the same at every tier and lists every component
        // that shows a model; which ones an NPC carries is the game's pick at run time, so the fit is the
        // whole table, with each slot's stock as the fallback. By-name children are bounded by what every
        // hull flying the chassis carries (the Black Sun styles share one chassis).
        if (components) {
          const shipById = new Map(manifest.ships.map((sh) => [sh.id, sh]));
          const modelByFile = new Map(manifest.models.map((m) => [m.file, m]));
          const npcDeps = { childrenOf: (t) => childrenOf(t), model: modelOf, templateOf: (n) => attachmentTemplates.get(n) ?? null };
          for (const [name, hullIds] of combat.chassisWanted) {
            const record = combat.file.chassis[name];
            const hullShips = hullIds.map((id) => shipById.get(id)).filter(Boolean);
            if (!record || !hullShips.length) continue;
            const seen = new Set();
            const note = (n) => {
              if (!seen.has(n)) {
                seen.add(n);
                npcNotes.push(`${name}: ${n}`);
              }
            };
            try {
              const looksPath = `datatables/space/ship_chassis_${name}.iff`;
              const table = vfs.has(looksPath) ? parseDatatable(parseIff(vfs.read(looksPath))) : null;
              const row = chassisRows.get(name);
              const slots = buildSlots(row, slotNames, table, components);
              const gun = hullShips[0].weapon ?? null;
              const tokens = hullTokens(name);
              for (const s of slots) s.stock = pickStock(s, components, /^weapon_/.test(s.slot) ? { tokens, preferName: gun?.name ?? null, preferProjectile: gun?.projectile ?? null, weaponOf: projectileOf } : { tokens });
              const stock = table ? stockPairs(slots, components, table.columns) : [];
              const carried = new Set();
              for (const sh of hullShips) {
                const b = assembleShip({ hardpoints: modelByFile.get(sh.file)?.hardpoints ?? [] }, childrenOf(sh.template, true), stock, npcDeps);
                for (const h of b.carried) carried.add(h);
              }
              const droid = (modelByFile.get(hullShips[0].file)?.hardpoints ?? []).includes('astromech') ? 'astromech' : 'computer';
              record.fit = { chassis: name, openSpeedFactor: wingOpenSpeedFactorOf(row), droid, slots: looksToParts(slots, [...carried], npcDeps, note), paint: null };
            } catch (err) {
              npcNotes.push(`${name}: fit not built (${err.message})`);
            }
            // As after a player hull's fit: the images the bakes decoded are let go.
            paintContext.images.clear();
            paintContext.shaders.clear();
          }
        }
        combat.file.counts = combatCounts(combat.file);
        writeFileSync(join(outDir, 'combat.json'), JSON.stringify(combat.file));
        console.log(combatLine(combat.file));
        if (args.includes('--verbose')) for (const n of [...npcNotes, ...combat.skipped.map((s) => `left out ${s.id}: ${s.why}`)]) console.log(`   ${n}`);
        else if (npcNotes.length) console.log(`   ${npcNotes.length} notes on the NPC ships (--verbose lists them, and the types left out)`);
      } catch (err) {
        rmSync(join(outDir, 'combat.json'), { force: true });
        console.error(`combat: not written (${err.stack ?? err.message})`);
      }
    }
    printEffectSummary();
    break;
  }

  case 'gallery': {
    // <swg-dir> <out-dir> [--jka=<dir>] [--only=houses,vehicles,weapons,anims,interiors] [--limit=N]
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const outDir = join(pos[2], 'gallery');
    mkdirSync(outDir, { recursive: true });
    const { buildGallery, galleryTemplates, interiorLayouts, labelOf, GALLERY_SECTIONS } = await import('./gallery.mjs');
    const { parsePob } = await import('./pob.mjs');
    const models = new Map();
    const cache = new Map();
    const only = options.only ? options.only.split(',').map((s) => s.trim()) : GALLERY_SECTIONS;
    const limit = options.limit ? Number(options.limit) : Infinity;
    // One template into the pack's models, as the snapshot does it (static, portal building, or a skeletal thing at its bind pose).
    // With `appearance`, that file rather than the template's own: a station's portal layout, where the template names the hull.
    const convert = (template, appearance = null) => {
      let r = appearance ? resolveAppearanceToMesh(vfs, appearance) : resolveTemplateMesh(vfs, template, cache);
      if (r.skip) return { skip: r.skip };
      // A rideable vehicle's skeletal appearance (pv_<name>.sat) is a two-joint placeholder with a
      // 10 cm box for a mesh; the visible body is the static appearance of the same name, which the
      // client attaches at run time. Show that one.
      const pv = r.skeletal && /^appearance\/pv_(.+)\.sat$/i.exec(r.skeletal);
      // The skeletal appearance is what the mount tables key the rider's pose on, body or not.
      const ridden = r.skeletal;
      // A skeletal vehicle with an animation table of its own (the walkers, the basilisk) walks
      // with its clips; one on the shared placeholder table (monstrosity.lat: the pod racers,
      // the pv_ placeholders) is a still model.
      let animated = false;
      if (r.skeletal) {
        try {
          const lat = [...parseSat(readIff(vfs, r.skeletal)).animationTables.values()][0] ?? '';
          animated = !!lat && !/monstrosity\.lat$/i.test(lat);
        } catch {
          animated = false;
        }
      }
      if (pv && !animated) {
        const x = pv[1];
        const candidates = [`appearance/${x}.apt`, `appearance/${x}.lod`, `appearance/lod/${x}.lod`, `appearance/${x}.msh`, `appearance/mesh/${x}.msh`, `appearance/mesh/${x}_l0.msh`];
        const found = candidates.find((c) => vfs.has(c));
        const body = found ? resolveAppearanceToMesh(vfs, found) : null;
        if (body && !body.skip) r = { ...body, source: `${found} (the body of ${r.skeletal})` };
        else return { skip: `vehicle placeholder ${r.skeletal} with no body found (tried ${x}.apt/.lod/.msh)` };
      }
      if (r.particle) return { skip: 'particle effect' };
      let id;
      try {
        if (r.skeletal) {
          id = familyOf(r.skeletal);
          if (!models.has(id)) {
            const info = convertSat(vfs, r.skeletal, join(outDir, `${id}.glb`), { animations: animated ? CREATURE_CLIPS : 'none' });
            const tris = info.meshes.reduce((a, m) => a + m.triangles, 0);
            models.set(id, { id, source: r.skeletal, file: `${id}.glb`, bounds: info.bounds ?? { min: [-1, 0, -1], max: [1, 2, 1] }, triangles: tris, skeletal: true, ...(animated ? { clips: info.animations, clipSpeeds: info.clipSpeeds ?? {} } : {}), ...(tris ? {} : { failed: `no triangles (${[...info.missing, ...info.skipped].slice(0, 3).join('; ') || 'no meshes'})` }) });
            if (!tris) console.log(`  ${template}: ${r.skeletal} converted with no triangles: ${[...info.missing, ...info.skipped].slice(0, 3).join('; ') || 'no meshes in it'}`);
            else if (animated) console.log(`  ${template}: walks with its own clips (${info.animations.join(', ')})`);
          }
        } else {
          const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length && !r.parts[0].hardpoints?.length;
          id = familyOf(single ? r.parts[0].mesh : r.appearance);
          if (!models.has(id)) {
            const conv = convertOne(vfs, single ? r.parts[0].mesh : r.appearance, join(outDir, `${id}.glb`));
            const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
            const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
            const effects = attachedEffects(vfs, conv.effects, outDir);
            models.set(id, { id, source: r.source ?? r.appearance, file: `${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, parts: conv.partCount, ...(conv.cells ? { cells: conv.cells, portals: conv.portals ?? [] } : {}), ...(effects.length ? { effects } : {}), ...(conv.tris ? {} : { failed: 'no triangles' }) });
            if (!conv.tris) console.log(`  ${template}: converted with no triangles`);
          }
        }
      } catch (err) {
        console.log(`  ${template}: ${err.message}`);
        return { skip: err.message };
      }
      const def = models.get(id);
      if (!def || def.failed) return { skip: def?.failed ?? 'failed' };
      const b = def.bounds;
      // A vehicle's rider pose from the mount tables, by its skeletal appearance, for the riding clip.
      const ride = ridden ? riderPoseFor(vfs, ridden) : null;
      return { model: id, radius: Math.max(0.5, Math.abs(b.min[0]), Math.abs(b.max[0]), Math.abs(b.min[2]), Math.abs(b.max[2])), height: b.max[1], ...(ride ? { riderPose: ride.pose, seats: ride.seats } : {}) };
    };
    const convertAnims = (source) => {
      const file = `anims_${source}.glb`;
      if (source === 'swg') {
        const info = convertSat(vfs, PLAYER_TEMPLATE, join(outDir, file), { animations: 'all', maxAnimations: 5000, wear: DEFAULT_WEAR });
        return { file, clips: info.animations.map((n) => ({ name: n, speed: info.clipSpeeds?.[n] || undefined, joints: info.partialClips?.[n] })) };
      }
      if (!options.jka) {
        console.log('  no --jka=<dir>: the Jedi Academy animations are left out');
        return null;
      }
      let jkaInfo = null;
      const extraClips = (joints) => {
        const r = importJkaClips(options.jka, joints, 'all', { log: (m) => console.log(`  jka: ${m}`) });
        jkaInfo = r.clips.map((c) => ({ name: c.name, loop: c.loop, fps: c.fps, frames: c.frames, speed: c.speed || undefined }));
        return r.clips;
      };
      convertSat(vfs, PLAYER_TEMPLATE, join(outDir, file), { animations: '=idle', maxAnimations: 1, wear: DEFAULT_WEAR, extraClips });
      return { file, clips: jkaInfo ?? [] };
    };
    // What the pack already holds, so a partial build keeps the other sections.
    let existing = null;
    try {
      if (existsSync(join(outDir, 'gallery.json')) && existsSync(join(outDir, 'manifest.json'))) {
        existing = JSON.parse(readFileSync(join(outDir, 'gallery.json'), 'utf8'));
        existing.models = new Map((JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')).categories?.layout ?? []).map((m) => [m.id, m]));
      }
    } catch (err) {
      console.log(`  the last build could not be read (${err.message}); building only what --only names`);
      existing = null;
    }
    const g = buildGallery({ log: console.log, only, limit, existing }, {
      convert,
      convertAnims,
      keepModels: (ids) => {
        for (const id of ids) if (!models.has(id) && existing?.models?.has(id)) models.set(id, existing.models.get(id));
      },
      templates: (prefix) => galleryTemplates(vfs, prefix),
      // The structures with rooms: every building and ship template whose chain names a portal layout, one per layout.
      interiors: () => {
        const stringCache = new Map();
        const list = [...galleryTemplates(vfs, 'object/building/'), ...galleryTemplates(vfs, 'object/ship/')];
        const found = interiorLayouts(list, {
          pobOf: (t) => resolveTemplateString(vfs, t, ['portalLayoutFilename'], stringCache),
          cellsOf: (pob) => parsePob(parseIff(vfs.read(pob))).cells.map((c) => c.name),
        });
        console.log(`  interiors: ${found.length} layouts among ${list.length} templates, ${found.filter((f) => f.lifts.length).length} with lift cells (${found.filter((f) => f.lifts.length).map((f) => labelOf(f.template)).join(', ')})`);
        return found;
      },
      copySky: () => {
        try {
          exportSky(vfs, 'tatooine', outDir, { textureFor: (p) => textureFor(vfs, p), log: () => {} });
        } catch (err) {
          console.log(`  sky: ${err.message}`);
        }
      },
    });
    writeFileSync(join(outDir, 'layout.json'), JSON.stringify({ planet: 'gallery', center: { x: 0, z: 0 }, radius: null, objects: g.objects }));
    // A run of some sections keeps the others' models as they were, so it keeps their material format too.
    let galleryFormat = MATERIAL_FORMAT;
    if (options.only) {
      try {
        galleryFormat = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')).materialFormat ?? 1;
      } catch {
        galleryFormat = 1;
      }
    }
    const galleryModels = [...models.values()].filter((m) => m && !m.failed);
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ planet: 'gallery', materialFormat: galleryFormat, categories: { layout: galleryModels } }, null, 2));
    writeFileSync(join(outDir, 'gallery.json'), JSON.stringify({ sections: g.sections, anims: g.anims }));
    writeFloors(outDir, galleryModels.map((m) => m.id));
    console.log(`-> ${outDir}: ${g.objects.length} exhibits, ${models.size} models; play it with ?planet=gallery`);
    printEffectSummary();
    break;
  }

  case 'jka-extract': {
    // <jka-dir> <out-dir>: the humanoid skeleton and animation.cfg as loose files, for sharing a retarget problem
    if (!pos[2]) usage();
    const { openJkaBase } = await import('./jka.mjs');
    const base = openJkaBase(pos[1]);
    mkdirSync(pos[2], { recursive: true });
    for (const name of ['models/players/_humanoid/_humanoid.gla', 'models/players/_humanoid/animation.cfg']) {
      const out = join(pos[2], basename(name));
      writeFileSync(out, base.read(name));
      console.log(`${name} (${base.where(name)}) -> ${out}`);
    }
    base.close();
    break;
  }

  case 'trt': {
    // <swg-dir> <x.trt> <out.png> [--var=name=value,...]: bake a texture renderer blueprint with default (or given) customization values
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const file = pos[2].replace(/\\/g, '/');
    if (!vfs.has(file)) throw new Error(`${file}: not in archives`);
    const bp = parseBlueprint(readIff(vfs, file));
    const ctx = renderContext(customizationValues(options.var));
    console.log(`${file}: ${bp.width}x${bp.height}, ${bp.shaders.length} shaders, ${bp.textures.length} textures, ${bp.commands.length} commands, ${bp.prepare.length} prepare operations`);
    let prepared = [];
    try {
      prepared = preparedShaders(vfs, bp, ctx);
    } catch (err) {
      console.log(`  shaders unreadable: ${err.message}`);
    }
    prepared.forEach((sh, i) => console.log(`  shader ${i} ${bp.shaders[i].file ?? '(inline)'}: ${describeShader(sh)}`));
    for (const line of describeVariables(bp.variables)) console.log(`  variable ${line}`);
    bp.prepare.forEach((op) => console.log(`  prepare: ${op.kind} shader ${op.shader} ${op.tag}${op.palette ? ` from ${op.palette} via ${bp.variables[op.variable]?.name}` : ''}${op.kind === 'texture' ? ` = ${bp.textures[op.texture]}` : ''}${op.kind === 'texture1d' ? ` = ${bp.textures[op.base]}.. (${op.count}) via ${bp.variables[op.variable]?.name}` : ''}`));
    bp.commands.forEach((c) => console.log(`  draw: ${c.kind === 'clear' ? `clear ${c.clearColor ? (c.color >>> 0).toString(16) : '(colour kept)'}` : `shader ${c.shader}, ${c.primitives.map((pr) => (pr.kind === 'fan' ? `fan vb${pr.vb}` : `${pr.triangles} tris vb${pr.vb}`)).join(' + ')}`}`));
    const image = renderBlueprint(vfs, bp, ctx);
    for (const m of image.missing) console.log(`  missing texture: ${m}`);
    for (const u of image.unsupported) console.log(`  not drawn (no fixed-function effect): ${u}`);
    mkdirSync(dirname(pos[3]), { recursive: true });
    writeFileSync(pos[3], encodePng(image.width, image.height, image.rgba));
    console.log(`-> ${pos[3]}`);
    break;
  }

  case 'pois': {
    // Only the points of interest, for packs converted already: <swg-dir> <planet>|all <out-dir>
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const planets = pos[2] === 'all' ? snapshotPlanets(vfs).filter((p) => GAME_PLANETS.includes(p)) : [pos[2]];
    for (const planet of planets) {
      const outDir = pos[2] === 'all' ? join(pos[3], planet) : pos[3];
      // Not every planet ships a world snapshot: the expansions place everything through buildout
      // tables, which is why the lava world and the tree world's zones were skipped here (and so
      // never got the places their packs' own snapshot runs had written).
      if (!vfs.has(`snapshot/${planet}.ws`) && !vfs.has(`datatables/buildout/areas_${planet}.iff`)) {
        console.warn(`no snapshot/${planet}.ws and no buildout table in archives`);
        continue;
      }
      const { snap, entries } = loadPlanetObjects(vfs, planet);
      const layoutPath = join(outDir, 'layout.json');
      let cx;
      let cz;
      if (options.center && options.center !== 'auto') [cx, cz] = options.center.split(',').map(Number);
      else if (existsSync(layoutPath)) ({ x: cx, z: cz } = JSON.parse(readFileSync(layoutPath, 'utf8')).center);
      else {
        const c = autoCenter(snap, entries);
        cx = Math.round(c.x);
        cz = Math.round(c.z);
      }
      mkdirSync(outDir, { recursive: true });
      console.log(`=== ${planet} (centre ${cx},${cz}) ===`);
      writePois(vfs, planet, snap, entries, cx, cz, outDir);
      // And the zone gates, off the pack's own layout.json: this is the one rerun that gives a pack
      // converted before the join its gates' destinations.
      writeZoneGates(vfs, planet, outDir);
    }
    break;
  }

  case 'snapshot': {
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    if (pos[2] === 'all') {
      const planets = snapshotPlanets(vfs).filter((p) => GAME_PLANETS.includes(p));
      console.log(`converting ${planets.length} planets: ${planets.join(', ')}`);
      for (const planet of planets) {
        console.log(`\n=== ${planet} ===`);
        await snapshotPlanet(vfs, planet, join(pos[3], planet));
      }
    } else {
      await snapshotPlanet(vfs, pos[2], pos[3]);
    }
    break;
  }

  case 'pob': {
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const root = parseIff(vfs.read(pos[2]));
    console.log(dump(root).slice(0, 60).join('\n'));
    const { parsePob } = await import('./pob.mjs');
    const pob = parsePob(root);
    console.log(`${pob.cells.length} cells, ${pob.portals.length} portal polygons`);
    pob.portals.forEach(({ verts, indices }, i) => console.log(`  portal ${i}: ${verts.length} verts, ${indices.length / 3} triangles, centre ${verts.reduce((a, v) => a.map((c, k) => c + v[k] / verts.length), [0, 0, 0]).map((v) => v.toFixed(2)).join(',')}`));
    pob.cells.forEach((c, i) => {
      console.log(`  cell ${i} "${c.name}" ${c.appearance} floor ${c.floor || '-'}: ${c.portals.map((p) => `#${p.geometry}->${p.target}${p.passable ? '' : ' closed'}${p.disabled ? ' disabled' : ''}`).join(' ') || 'no portals'}`);
      // The walkable floor the cell names, as the pack would read it.
      if (!c.floor) return;
      if (!vfs.has(c.floor)) {
        console.log(`     floor: not in the archives`);
        return;
      }
      try {
        const fl = parseFloor(parseIff(vfs.read(c.floor)));
        const doors = fl.triangles.reduce((n, t) => n + t.portals.filter((p) => p >= 0).length, 0);
        const cross = fl.triangles.reduce((n, t) => n + t.crossable.filter(Boolean).length, 0);
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of fl.vertices) {
          lo = Math.min(lo, v[1]);
          hi = Math.max(hi, v[1]);
        }
        console.log(`     floor: FLOR ${fl.version}, ${fl.vertices.length} vertices, ${fl.triangles.length} triangles, ${cross} crossable edges, ${doors} leading through a portal, y ${lo.toFixed(2)}..${hi.toFixed(2)}${fl.graph ? `, graph ${fl.graph.nodes.length} nodes (${fl.graph.nodes.filter((n) => n.type === 0).length} in a doorway) ${fl.graph.edges.length} edges` : ', no path graph'}${fl.warnings.length ? `; ${fl.warnings.join('; ')}` : ''}`);
      } catch (err) {
        console.log(`     floor: unreadable (${err.message})`);
      }
    });
    break;
  }

  case 'why': {
    // Why a snapshot object does or does not make it into a pack: <swg-dir> <planet> <pattern>
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const planet = pos[2];
    const pattern = new RegExp(pos[3], 'i');
    const { snap, entries, buildout, spawns } = loadPlanetObjects(vfs, planet);
    console.log(`${entries.length} objects (${buildout.objects} from ${buildout.areas} buildout areas)`);
    if (spawns) console.log(`server spawns: ${spawns.stats.objects} static objects, ${spawns.stats.mobiles} creature and NPC spawns (${spawns.stats.inCells + spawns.stats.mobilesInCells} inside cells skipped)`);
    if (flags.has('--areas')) {
      console.log('buildout areas (rows placed / rows in the table, unknown templates, extent in metres):');
      for (const a of buildout.areaList ?? []) console.log(`  ${a.area}: ${a.placed}/${a.rows}${a.unknown ? `, ${a.unknown} UNKNOWN` : ''}, ${a.x.toFixed(0)},${a.z.toFixed(0)} to ${a.x2.toFixed(0)},${a.z2.toFixed(0)}${a.event ? `, event "${a.event}"` : ''}`);
    }
    if (buildout.eventList?.length) {
      console.log(`event-only buildout areas (${flags.has('--events') ? 'included with --events' : 'left out; add --events to include them'}):`);
      for (const e of buildout.eventList) console.log(`  ${e.area}: ${e.rows} rows, event "${e.event}"`);
    }
    const cache = new Map();
    const hits = new Map();
    // --near=x,z,r narrows the search to objects within r metres of a point.
    const near = options.near ? options.near.split(',').map(Number) : null;
    for (const e of entries) {
      const template = snap.templates[e.node.templateIndex];
      if (!pattern.test(template)) continue;
      if (near && (!e.world || Math.hypot(e.world.pos[0] - near[0], e.world.pos[2] - near[1]) > (near[2] ?? 500))) continue;
      const h = hits.get(template) ?? { count: 0, contained: 0, buildout: 0, radius: e.node.radius, example: e };
      h.count++;
      if (e.node.buildout) h.buildout++;
      if (e.parentId !== 0) h.contained++;
      hits.set(template, h);
    }
    if (!hits.size) {
      console.log(`no objects on ${planet} match /${pos[3]}/i; templates containing "${pos[3].slice(0, 4)}":`);
      for (const t of snap.templates.filter((t) => t.toLowerCase().includes(pos[3].slice(0, 4).toLowerCase())).slice(0, 20)) console.log(`  ${t}`);
      break;
    }
    const tmpDir = join(pos[4] ?? '.', '.why');
    mkdirSync(tmpDir, { recursive: true });
    for (const [template, h] of hits) {
      const p = h.example.world?.pos ?? [0, 0, 0];
      console.log(`\n${template}`);
      console.log(`  ${h.count} placed (${h.buildout} by buildouts, ${h.contained} inside buildings), radius ${h.radius}, e.g. at ${p[0].toFixed(0)}, ${p[2].toFixed(0)}`);
      const r = resolveTemplateMesh(vfs, template, cache);
      if (r.skeletal) {
        console.log(`  skeletal appearance: ${r.skeletal}${/^object\/(mobile|creature)\//i.test(template) ? ' (a creature or NPC: the server spawns these, snapshot leaves them out)' : ' (baked at its bind pose as a static prop)'}`);
        continue;
      }
      if (r.skip) {
        console.log(`  SKIPPED: ${r.skip}`);
        continue;
      }
      if (r.particle) {
        console.log(`  appearance: ${r.appearance}${r.source ? ` (via ${r.source})` : ''}: a particle effect`);
        try {
          const p = exportParticle(vfs, r.particle, tmpDir, { textureFor: (sh) => textureFor(vfs, sh), passFor: (sh) => passFor(vfs, sh), write: () => {}, log: (m) => console.log(m) });
          console.log(`  converts: ${p.quads} quad emitter(s), ${p.meshes} mesh emitter(s), reach ${p.bounds.max[0]} m${p.missingTextures.length ? `, textures missing: ${p.missingTextures.join(', ')}` : ''}`);
        } catch (err) {
          console.log(`  CONVERSION FAILED: ${err.message}`);
        }
        continue;
      }
      const appearance = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length ? r.parts[0].mesh : r.appearance;
      console.log(`  appearance: ${r.appearance ?? '-'}${r.source ? ` (via ${r.source})` : ''}, ${r.parts.length} part(s)${r.effects?.length ? `, ${r.effects.length} attached particle effect(s)` : ''}`);
      const st = vfs.stat(appearance);
      console.log(`  ${appearance}: ${st ? `${st.size} bytes from ${basename(st.archive)}` : 'NOT IN ARCHIVES'}`);
      try {
        const conv = convertOne(vfs, appearance, join(tmpDir, `${familyOf(appearance)}.glb`));
        console.log(`  converts: ${conv.tris} tris, ${conv.textured}/${conv.shaders.length} textured${conv.partCount > 1 ? `, ${conv.partCount} parts` : ''}${conv.cells ? `, ${conv.cells.length} cells, ${conv.portals?.length ?? 0} portal polygons` : ''}`);
      } catch (err) {
        console.log(`  CONVERSION FAILED: ${err.message}`);
      }
    }
    break;
  }

  case 'stat': {
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const st = vfs.stat(pos[2]);
    console.log(st ? `${pos[2]}: ${st.size} bytes from ${st.archive}` : `${pos[2]}: not in archives`);
    if (flags.has('--all')) {
      const versions = vfs.versions(pos[2]);
      console.log(`every copy, oldest first (the last one wins):`);
      for (const v of versions) console.log(`  ${basename(v.archive)}: ${v.deleted ? 'deletion marker' : `${v.size} bytes`}`);
    }
    break;
  }

  case 'terrain': {
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    // "all" refreshes the terrain of every planet pack that exists under <out-dir> already.
    const targets = pos[2] === 'all' ? GAME_PLANETS.filter((p) => existsSync(join(pos[3], p, 'manifest.json'))).map((p) => [p, join(pos[3], p)]) : [[pos[2], pos[3]]];
    if (!targets.length) console.log(`no planet packs under ${pos[3]} yet; run snapshot first`);
    for (const [planet, outDir] of targets) {
      mkdirSync(outDir, { recursive: true });
      const file = await copyTerrain(vfs, planet, outDir);
      console.log(file ? `${planet}: terrain -> ${join(outDir, file)}` : `${planet}: no terrain/${planet}.trn in archives`);
    }
    break;
  }

  case 'sky': {
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const targets = pos[2] === 'all' ? GAME_PLANETS.filter((p) => existsSync(join(pos[3], p, 'manifest.json'))).map((p) => [p, join(pos[3], p)]) : [[pos[2], pos[3]]];
    if (!targets.length) console.log(`no planet packs under ${pos[3]} yet; run snapshot first`);
    for (const [planet, outDir] of targets) {
      mkdirSync(outDir, { recursive: true });
      console.log(`${planet}:`);
      exportSky(vfs, planet, outDir, { textureFor: (p) => textureFor(vfs, p), particleFor: (p) => convertParticle(vfs, p, outDir), log: console.log });
    }
    printEffectSummary();
    break;
  }

  case 'water': {
    // <swg-dir> <planet>|all <out-dir>: each planet's water shaders (colour, opacity, ripple,
    // drift and cube map) as water.json, plus the cube faces under water/; each lava shader's look
    // (flow, colour ramp, bloom factor) goes in its entry, its crust and noise volume under water/.
    // The client's own water value tables (what being in each kind of water does, and who takes
    // none of it) are read once and written into every planet's water.json as its `harm` block.
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const targets = pos[2] === 'all' ? GAME_PLANETS.filter((p) => existsSync(join(pos[3], p, 'manifest.json'))).map((p) => [p, join(pos[3], p)]) : [[pos[2], pos[3]]];
    if (!targets.length) console.log(`no planet packs under ${pos[3]} yet; run snapshot first`);
    const harmNotes = [];
    const harm = readWaterHarm(vfs, harmNotes);
    for (const line of waterHarmLines(harm)) console.log(line);
    for (const n of harmNotes) console.log(`  ${n}`);
    const { parseTerrainTemplate, waterShaderUses } = await import('../../src/swg/terrain/trn.ts');
    for (const [planet, outDir] of targets) {
      const path = `terrain/${planet}.trn`;
      if (!vfs.has(path)) {
        console.log(`${planet}: no ${path}`);
        continue;
      }
      let t;
      try {
        t = parseTerrainTemplate(new Uint8Array(vfs.read(path)));
      } catch (err) {
        console.log(`${planet}: terrain does not parse (${err.message}); no water.json`);
        continue;
      }
      mkdirSync(outDir, { recursive: true });
      console.log(`${planet}:`);
      exportWater(vfs, planet, waterShaderUses(t), t, outDir, { log: console.log, harm });
    }
    break;
  }

  case 'space': {
    // <swg-dir> <zone>|all <out-dir>: a space zone as a pack: the stations its station table
    // places (drawn as the faction stations the client has), every asteroid of its fields
    // (scattered from each field's seed through its style table), the planets and moons its
    // terrain file hangs in the sky (as space.json, with each one's surface texture), and its
    // sky from the same file (the six-sided nebula skybox, the lights, the star field, the dust
    // and the star sprites) into sky.json with the environment tables' blocks. space.json (version
    // 2) also carries the system's title, its hyperspace points with their names and descriptions,
    // the stations' titles, the zone's arrival and the jump scene with its warp effects' timings,
    // and the frame check of the points against the stations. Kessel (space_light1), Deep Space
    // (space_heavy1) and Ord Mantell are systems of their own; what the client never had (Kessel's
    // and Deep Space's point positions, Deep Space's fields and its Star Destroyer) is made up in
    // space.mjs's INVENTED_* tables and marked as such in the pack.
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const {
      stationTemplate, parseSpacePlanets, parsePlanetAppearance, spaceBody, parseSpaceEnvironment, scatterField, parseHyperspaceScene, warpTimings, cleanText, cleanZoneTitle, stationStrings,
      INVENTED_FIELDS, INVENTED_SCENERY, hyperspacePoints, placeScenery, arrivalOf, stationApproachEnd, checkPointFrame, nearestObject,
      dockEffects, fieldShapes, laneNodes, ZONE_MAP_ICONS, zoneIconPaths,
    } = await import('./space.mjs');
    const { LIGHTNING_IMAGE, NEBULA_SHADERS, lightningFilesOf, nebulaLook, nebulaSummary, nebulaTableFor, parseLightning, parseNebulaTable } = await import('./nebula.mjs');
    const { parseClientEffect } = await import('./shipdata.mjs');
    const zones = pos[2] === 'all' ? Object.keys(SPACE_ZONES).filter((z) => vfs.has(`terrain/${z}.trn`)) : [pos[2]];
    // What every zone shares: the hyperspace table, the point and zone names, the jump scene and its warp effects.
    const shared = (p) => (vfs.has(p) ? parseDatatable(parseIff(vfs.read(p))).rows : []);
    const stf = (name) => (vfs.has(`string/en/${name}.stf`) ? parseStringTable(vfs.read(`string/en/${name}.stf`)) : new Map());
    const hsRows = shared('datatables/space/hyperspace/hyperspace_locations.iff');
    const pointNames = stf('hyperspace_points_n');
    const pointDescs = stf('hyperspace_points_d');
    const zoneNames = stf('planet_n');
    const refusals = stf('shared_hyperspace');
    const hsScene = vfs.has('scene/hyperspace.iff') ? parseHyperspaceScene(parseIff(vfs.read('scene/hyperspace.iff'))) : null;
    const warpFx = (p) => {
      try {
        return p && vfs.has(p) ? parseParticleEffect(parseIff(vfs.read(p))) : null;
      } catch (err) {
        console.log(`hyperspace: ${p}: ${err.message}`);
        return null;
      }
    };
    const timing = hsScene ? warpTimings(warpFx(hsScene.enter.particle), warpFx(hsScene.exit.particle)) : null;
    console.log(`hyperspace: ${hsRows.length} table points, ${pointNames.size} point names; ${hsScene ? `the jump scene: enter ${hsScene.enter.seconds} s, exit ${hsScene.exit.seconds} s, leaving at ${hsScene.transit.speed} m/s` : 'no jump scene (scene/hyperspace.iff)'}${timing ? `; warp timings: peak ${timing.enterPeak} s, tunnel ${timing.tunnelAt} s, burst ${timing.exitBurstAt} s, clear ${timing.exitClearAt} s` : ''}`);
    // The zone map's own icons, once for the whole run: every zone's map shows the same six.
    let icons = 0;
    for (const name of ZONE_MAP_ICONS) {
      const { texture, file } = zoneIconPaths(name);
      if (!vfs.has(texture)) {
        console.log(`zone map icon ${name}: no ${texture} in the archives`);
        continue;
      }
      const img = decodeDds(vfs.read(texture));
      mkdirSync(join(pos[3], dirname(file)), { recursive: true });
      writeFileSync(join(pos[3], file), encodePng(img.width, img.height, img.rgba));
      icons++;
    }
    console.log(`zone map icons: ${icons} of ${ZONE_MAP_ICONS.length} into ${join(pos[3], 'space_ui')}`);
    // What every dock plays. Each of these client effects names a sound and no particle at all.
    const dockFx = dockEffects((p) => {
      if (!vfs.has(p)) return null;
      try {
        return parseClientEffect(parseIff(vfs.read(p)));
      } catch (err) {
        console.log(`dock effect ${p}: ${err.message}`);
        return null;
      }
    });
    console.log(`dock effects: ${Object.entries(dockFx).map(([part, fx]) => `${part} ${fx.sound ?? 'no sound'}`).join(', ')}`);
    for (const zone of zones) {
      if (!vfs.has(`terrain/${zone}.trn`)) {
        console.log(`${zone}: no terrain/${zone}.trn in the archives`);
        continue;
      }
      const outDir = join(pos[3], zone);
      mkdirSync(join(outDir, 'space'), { recursive: true });
      console.log(`${zone}:`);
      const models = new Map();
      // The docking lanes, drydocks and hangar mouths each converted model carries, by model id: a
      // placed object is drawn as an instanced mesh with no hardpoint nodes, so they have to be in
      // the pack.
      const lanes = {};
      const cache = new Map();
      const convert = (template) => {
        const r = resolveTemplateMesh(vfs, template, cache);
        if (r.skip) return { skip: r.skip };
        if (r.particle || r.skeletal) return { skip: r.particle ? 'particle effect' : 'skeletal appearance' };
        const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length && !r.parts[0].hardpoints?.length;
        const id = familyOf(single ? r.parts[0].mesh : r.appearance);
        if (!models.has(id)) {
          try {
            const conv = convertOne(vfs, single ? r.parts[0].mesh : r.appearance, join(outDir, `${id}.glb`));
            const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
            const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
            models.set(id, { id, file: `${id}.glb`, bounds, triangles: conv.tris, ...(conv.cells ? { cells: conv.cells, portals: conv.portals ?? [] } : {}), ...(conv.tris ? {} : { failed: 'no triangles' }) });
            const lane = laneNodes(conv.mesh.hardpoints, conv.flipX);
            if (lane) {
              lanes[id] = lane;
              const bays = lane.bays.length ? `, ${lane.bays.length} hangar mouth${lane.bays.length === 1 ? '' : 's'}` : '';
              const dry = lane.drydocks.length ? `, ${lane.drydocks.length} drydocks` : '';
              console.log(`  ${id}: ${lane.lanes.length} docking lane${lane.lanes.length === 1 ? '' : 's'}${lane.lanes.length ? ` (${lane.lanes.map((l) => `${l.lane}: ${l.approach.length} in, ${l.exit.length} out${l.dock ? '' : ', no dock'}`).join('; ')})` : ''}${dry}${bays}`);
            }
          } catch (err) {
            models.set(id, { id, failed: err.message });
          }
        }
        const def = models.get(id);
        if (!def || def.failed) return { skip: def?.failed ?? 'failed' };
        const bb = def.bounds;
        // In space an object is met from every side: its radius is its whole extent.
        return { model: id, radius: Math.max(0.5, ...bb.min.map(Math.abs), ...bb.max.map(Math.abs)) };
      };
      const table = (path) => {
        const p = String(path ?? '').replace(/\\/g, '/');
        return p && vfs.has(p) ? parseDatatable(parseIff(vfs.read(p))).rows : null;
      };
      const objects = [];
      const stations = [];
      // Each station's own object, so its approach's clearance leaves the station itself out.
      const stationObjects = new Map();
      for (const row of table(`datatables/space/spacestation/${zone}.iff`) ?? []) {
        const template = stationTemplate(row.Name);
        const r = convert(template);
        if (r.skip) {
          console.log(`  station ${row.Name}: ${template}: ${r.skip}`);
          continue;
        }
        const o = { template, model: r.model, x: row.LocationX, y: row.LocationY, z: row.LocationZ, q: [1, 0, 0, 0], radius: r.radius };
        objects.push(o);
        const s = { name: row.Name, ...stationStrings(row.Name, pointNames, pointDescs), model: r.model, x: row.LocationX, y: row.LocationY, z: row.LocationZ, radius: r.radius, approachClearance: null };
        stations.push(s);
        stationObjects.set(s, o);
        console.log(`  station ${row.Name} ("${s.title}"): ${template.replace(/^.*\//, '')} at ${row.LocationX}, ${row.LocationY}, ${row.LocationZ} (${Math.round(r.radius)} m across)`);
      }
      // The zone's own fields, then any made up for it (Deep Space has no field table).
      const fieldRows = [...(table(`datatables/space/asteroidfield/${zone}.iff`) ?? []).map((row) => [row, false]), ...(INVENTED_FIELDS[zone] ?? []).map((row) => [row, true])];
      let asteroids = 0;
      for (const [row, invented] of fieldRows) {
        const styles = table(row.FieldStyleTable) ?? [];
        let kept = 0;
        for (const a of scatterField(row, styles)) {
          const r = convert(a.template);
          if (r.skip) continue;
          objects.push({ template: a.template, model: r.model, x: a.x, y: a.y, z: a.z, q: a.q, radius: r.radius });
          kept++;
        }
        asteroids += kept;
        console.log(`  field "${row.Name}"${invented ? ' (invented)' : ''}: ${kept} of ${row.NumAsteroids} asteroids${styles.length ? '' : ` (no style table ${row.FieldStyleTable})`}${Number(row.Type) === 2 ? ', along a spline' : ''}, radius ${row.Radius} m at ${row.CenterLocationX}, ${row.CenterLocationY}, ${row.CenterLocationZ}`);
      }
      // The hyperspace points: the table's, any borrowed from a sister scene, any made up.
      const points = hyperspacePoints(zone, hsRows, pointNames, pointDescs);
      const pointById = new Map(points.map((p) => [p.id, p]));
      // Scenery (made up): a model near a point, broadside to a ship arriving there.
      const scenery = [];
      for (const s of INVENTED_SCENERY[zone] ?? []) {
        const p = pointById.get(s.near);
        const r = p ? convert(s.template) : { skip: `no point ${s.near}` };
        if (r.skip) {
          console.log(`  scenery ${s.name}: ${s.template}: ${r.skip}`);
          continue;
        }
        const at = placeScenery(p, s, r.radius);
        objects.push({ template: s.template, model: r.model, x: at.x, y: at.y, z: at.z, q: at.q, radius: r.radius });
        scenery.push({ name: s.name, template: s.template, model: r.model, x: at.x, y: at.y, z: at.z, q: at.q, radius: Math.round(r.radius), near: s.near, invented: true });
        console.log(`  scenery ${s.name} (invented): ${s.template.replace(/^.*\//, '')} at ${at.x}, ${at.y}, ${at.z}, ${Math.round(r.radius)} m round, near ${s.near}`);
      }
      // The jump's two warp effects, converted into the pack (cached per pack) for the game to play.
      const warpFile = (p) => {
        if (!p) return null;
        const e = convertParticle(vfs, p, outDir);
        if (e.failed) console.log(`  warp effect ${p}: ${e.failed}`);
        return e.file ?? null;
      };
      const effects = { enter: warpFile(hsScene?.enter.particle), exit: warpFile(hsScene?.exit.particle), timing };
      const arrival = arrivalOf(zone, SPACE_ZONES[zone] ?? null, points);
      // Clearances: how far each point, the arrival and each station's approach end are from anything placed.
      const clear = (label, at, except = null) => {
        const { object, clearance } = nearestObject(at, objects, except);
        if (object && clearance < 300) console.log(`  warning: ${label} is ${Math.round(clearance)} m from ${object.template}`);
        return Number.isFinite(clearance) ? Math.round(clearance) : null;
      };
      for (const p of points) p.clearance = clear(p.id, p);
      if (arrival.kind === 'launch') clear('the arrival (launch point)', arrival);
      for (const s of stations) s.approachClearance = clear(`${s.name}'s approach end`, stationApproachEnd(s, arrival), stationObjects.get(s));
      // The frame check: the table's points against the stations, by the distances their descriptions give.
      const frameCheck = checkPointFrame(points.filter((p) => p.source === 'table'), stations);
      if (frameCheck.checked) console.log(`  hyperspace frame: ${frameCheck.sameCloser} of ${frameCheck.checked} distances fit the unmirrored pairing (mean ${frameCheck.meanErrorSame} m; mirrored ${frameCheck.meanErrorMirrored} m)`);
      if (frameCheck.mirroredCloser > frameCheck.sameCloser) console.log(`  warning: ${frameCheck.mirroredCloser} of ${frameCheck.checked} described distances fit the points with X mirrored: the hyperspace table is not in the stations' frame here`);
      const title = cleanZoneTitle(zoneNames.get(zone) ?? '') || zone;
      const planets = [];
      const trnRoot = parseIff(vfs.read(`terrain/${zone}.trn`));
      for (const p of parseSpacePlanets(trnRoot)) {
        let texture = null;
        let look = null;
        try {
          if (vfs.has(p.appearance)) {
            // A planet appearance: its surface shader and its radius, the body's size (parsePlanetAppearance).
            look = parsePlanetAppearance(parseIff(vfs.read(p.appearance)));
            const t = look ? textureFor(vfs, look.shader) : null;
            if (t?.png) {
              texture = `space/${basename(p.appearance).replace(/\.pln$/i, '')}.png`;
              writeFileSync(join(outDir, texture), t.png);
            }
          }
        } catch (err) {
          console.log(`  planet ${p.appearance}: ${err.message}`);
        }
        const body = spaceBody(p, look, texture);
        planets.push(body);
        const inside = body.radius !== null && body.radius >= body.distance ? ', WARNING: the camera is inside it' : '';
        console.log(`  planet ${basename(p.appearance)}: toward ${body.direction.map((v) => v.toFixed(0)).join(', ')}, ${body.radius === null ? 'no radius in its appearance' : `radius ${body.radius} at ${body.distance}`}, size ${body.size}${body.sizeFrom === 'invented' ? ' (invented)' : ''}${body.halo ? `, halo ${body.halo.scale}` : ''}${texture ? '' : ', no surface texture'}${inside}`);
      }
      // The zone's nebulae, the one lightning appearance they name, and the look the two kinds of
      // sheet are drawn with. Both `_no_z` shell shaders name the same texture as their sheet
      // shader, so a pack writes one image per kind and the shell points at it.
      const nebulae = parseNebulaTable(table(nebulaTableFor(zone)) ?? []);
      const nebulaImage = (kind) => {
        const s = NEBULA_SHADERS[kind];
        const t = textureFor(vfs, s.sheet);
        if (!t?.png) return null;
        mkdirSync(join(outDir, 'nebula'), { recursive: true });
        writeFileSync(join(outDir, s.image), t.png);
        return s.image;
      };
      const shaderEffect = (path) => {
        try {
          return shaderTextures(parseIff(vfs.read(path))).effect?.replace(/\\/g, '/') ?? null;
        } catch {
          return null;
        }
      };
      const look = nebulae.length ? nebulaLook({ image: nebulaImage, effect: shaderEffect }) : null;
      let lightning = null;
      const ltnFiles = lightningFilesOf(nebulae);
      if (ltnFiles.length) {
        const first = ltnFiles[0];
        const ltn = vfs.has(first) ? parseLightning(parseIff(vfs.read(first))) : null;
        if (!ltn) console.log(`  lightning ${first}: not read`);
        else {
          let image = null;
          const t = ltn.texture ? textureFor(vfs, ltn.texture.shader) : null;
          if (t?.png) {
            mkdirSync(join(outDir, 'nebula'), { recursive: true });
            writeFileSync(join(outDir, LIGHTNING_IMAGE), t.png);
            image = LIGHTNING_IMAGE;
          }
          const prt = (p) => {
            if (!p) return null;
            const e = convertParticle(vfs, p, outDir);
            if (e.failed) console.log(`  lightning effect ${p}: ${e.failed}`);
            return e.file ?? null;
          };
          lightning = { source: first, flipbook: ltn.texture, texture: image, waveforms: ltn.waveforms, value: ltn.value, start: prt(ltn.start), end: prt(ltn.end), trailingBytes: ltn.trailingBytes };
          if (ltnFiles.length > 1) console.log(`  lightning: ${ltnFiles.length} appearances named; ${first} converted, the rest share it`);
        }
      }
      const nsum = nebulaSummary(nebulae);
      console.log(`  nebulae: ${nsum.count} (${nsum.glow} glow, ${nsum.mist} mist), ${nsum.striking} with lightning, shake up to ${nsum.jitter}, farthest edge ${(nsum.farthest / 1000).toFixed(1)} km${lightning ? `; lightning ${lightning.flipbook?.frames ?? '?'} frames at ${lightning.flipbook?.fps ?? '?'}/s` : ''}`);
      // The fields' shapes (the map draws these; the asteroids themselves are in layout.json).
      const fields = fieldShapes(fieldRows);
      const hyperspace = {
        points,
        scene: hsScene ? { source: 'scene/hyperspace.iff', ...hsScene } : null,
        effects,
        messages: { alreadyAtPoint: cleanText(refusals.get('already_at_point') ?? '') || null },
        frameCheck,
      };
      writeFileSync(join(outDir, 'space.json'), JSON.stringify({ version: SPACE_PACK_VERSION, zone, planet: SPACE_ZONES[zone] ?? null, title, stations, scenery, planets, arrival, hyperspace, nebulae, nebulaLook: look, lightning, fields, lanes, dockEffects: dockFx }, null, 2));
      const zoneModels = [...models.values()].filter((m) => !m.failed);
      writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ planet: zone, categories: { layout: zoneModels } }, null, 2));
      writeFileSync(join(outDir, 'layout.json'), JSON.stringify({ planet: zone, center: { x: 0, z: 0 }, radius: null, objects, skipped: [] }));
      writeFloors(outDir, zoneModels.map((m) => m.id));
      const env = parseSpaceEnvironment(trnRoot);
      exportSky(vfs, zone, outDir, { textureFor: (p) => textureFor(vfs, p), particleFor: (p) => convertParticle(vfs, p, outDir), log: console.log, space: env });
      const made = points.filter((p) => p.source === 'invented').length;
      const borrowed = points.filter((p) => p.source === 'borrowed').length;
      const pointNotes = [made && `${made} invented`, borrowed && `${borrowed} borrowed`].filter(Boolean).join(', ');
      console.log(`-> ${outDir}: ${title}, ${stations.length} station${stations.length === 1 ? '' : 's'}, ${asteroids} asteroids in ${models.size} models, ${planets.length} planets and moons${env.skybox ? `, skybox ${env.skybox}` : ', no skybox named'}, ${env.lights.length} lights, ${env.celestials.length} star sprites, ${env.stars?.count ?? 0} stars, ${env.dust?.count ?? 0} dust${scenery.length ? `, ${scenery.length} scenery` : ''}, ${nebulae.length} nebulae, ${fields.length} fields, ${Object.values(lanes).reduce((n, l) => n + l.lanes.length, 0)} docking lanes, ${points.length} hyperspace points${pointNotes ? ` (${pointNotes})` : ''}, arrival at ${arrival.kind === 'launch' ? 'launch point' : `point ${arrival.point ?? 'the origin'}`}`);
    }
    printEffectSummary();
    break;
  }

  case 'sandbox': {
    // <swg-dir> <out-dir> [--seed=N]: a made-up system to fly in, written from a seed out of what
    // is already in the archives: one space zone's sky, that zone's own planet appearances, and the
    // asteroid field styles the real fields are scattered from. Nothing in it is the game's. Every
    // place, size, distance and count is ours, and the pack says so: its jump points carry
    // `source: 'invented'`, its fields `invented: true`, and a `sandbox` block names the seed it was
    // drawn from, how far the system reaches and whose sky it borrowed.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const { cleanText, parseHyperspaceScene, parsePlanetAppearance, parseSpaceEnvironment, parseSpacePlanets, scatterField, warpTimings } = await import('./space.mjs');
    const skyZone = pickSkyZone((p) => vfs.has(p));
    if (!skyZone) {
      console.log('sandbox: there is no space zone in the archives to borrow a sky from');
      break;
    }
    const outDir = join(pos[2], SANDBOX_ZONE);
    mkdirSync(join(outDir, 'space'), { recursive: true });
    const table = (path) => {
      const p = String(path ?? '').replace(/\\/g, '/');
      return p && vfs.has(p) ? parseDatatable(parseIff(vfs.read(p))).rows : null;
    };
    // The jump scene and its warp effects, which every zone shares.
    const hsScene = vfs.has('scene/hyperspace.iff') ? parseHyperspaceScene(parseIff(vfs.read('scene/hyperspace.iff'))) : null;
    const warpFx = (p) => {
      try {
        return p && vfs.has(p) ? parseParticleEffect(parseIff(vfs.read(p))) : null;
      } catch (err) {
        console.log(`  warp effect ${p}: ${err.message}`);
        return null;
      }
    };
    const warpFile = (p) => {
      if (!p) return null;
      const e = convertParticle(vfs, p, outDir);
      return e.failed ? null : (e.file ?? null);
    };
    const refusals = vfs.has('string/en/shared_hyperspace.stf') ? parseStringTable(vfs.read('string/en/shared_hyperspace.stf')) : new Map();
    // The pictures the system's bodies may wear: the borrowed zone's own planet appearances. Only
    // the surface image is taken; how big a body is and where it stands are the generator's, so the
    // appearance's own radius is neither read nor wanted.
    const trnRoot = parseIff(vfs.read(`terrain/${skyZone}.trn`));
    const looks = [];
    for (const p of parseSpacePlanets(trnRoot)) {
      let look = null;
      try {
        if (vfs.has(p.appearance)) look = parsePlanetAppearance(parseIff(vfs.read(p.appearance)));
      } catch (err) {
        console.log(`  ${p.appearance}: ${err.message}`);
      }
      let texture = null;
      const t = look ? textureFor(vfs, look.shader) : null;
      if (t?.png) {
        texture = `space/${basename(p.appearance).replace(/\.pln$/i, '')}.png`;
        writeFileSync(join(outDir, texture), t.png);
      }
      looks.push({ appearance: p.appearance, texture });
    }
    // The asteroid styles the real fields use, from whichever zones the archives have.
    const styleTables = [];
    for (const z of Object.keys(SPACE_ZONES)) {
      for (const row of table(`datatables/space/asteroidfield/${z}.iff`) ?? []) {
        const p = String(row.FieldStyleTable ?? '').replace(/\\/g, '/');
        if (p && vfs.has(p) && !styleTables.includes(p)) styleTables.push(p);
      }
    }
    const models = new Map();
    const cache = new Map();
    const convert = (template) => {
      const r = resolveTemplateMesh(vfs, template, cache);
      if (r.skip || r.particle || r.skeletal) return { skip: r.skip ?? 'not a mesh' };
      const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length && !r.parts[0].hardpoints?.length;
      const id = familyOf(single ? r.parts[0].mesh : r.appearance);
      if (!models.has(id)) {
        try {
          const conv = convertOne(vfs, single ? r.parts[0].mesh : r.appearance, join(outDir, `${id}.glb`));
          const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
          const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
          models.set(id, { id, file: `${id}.glb`, bounds, triangles: conv.tris, ...(conv.tris ? {} : { failed: 'no triangles' }) });
        } catch (err) {
          models.set(id, { id, failed: err.message });
        }
      }
      const def = models.get(id);
      if (!def || def.failed) return { skip: def?.failed ?? 'failed' };
      const bb = def.bounds;
      // In space an object is met from every side: its radius is its whole extent.
      return { model: id, radius: Math.max(0.5, ...bb.min.map(Math.abs), ...bb.max.map(Math.abs)) };
    };
    console.log(`sandbox: sky borrowed from ${skyZone}, ${looks.length} bodies to wear, ${styleTables.length} asteroid styles`);
    const built = buildSandbox({
      seed: options.seed ? Number(options.seed) >>> 0 : undefined,
      skyZone,
      planetLooks: () => looks,
      styleTables: () => styleTables,
      styleRows: (p) => table(p) ?? [],
      scatter: (row, styles) => scatterField(row, styles),
      convert,
      models: () => [...models.values()],
      hyperspace: () => ({
        scene: hsScene ? { source: 'scene/hyperspace.iff', ...hsScene } : null,
        effects: {
          enter: warpFile(hsScene?.enter.particle),
          exit: warpFile(hsScene?.exit.particle),
          timing: hsScene ? warpTimings(warpFx(hsScene.enter.particle), warpFx(hsScene.exit.particle)) : null,
        },
        messages: { alreadyAtPoint: cleanText(refusals.get('already_at_point') ?? '') || null },
        frameCheck: { checked: 0, sameCloser: 0, mirroredCloser: 0, meanErrorSame: 0, meanErrorMirrored: 0 },
      }),
      sky: (zone) => exportSky(vfs, zone, outDir, { textureFor: (p) => textureFor(vfs, p), particleFor: (p) => convertParticle(vfs, p, outDir), log: console.log, space: parseSpaceEnvironment(trnRoot) }),
      write: (rel, text) => writeFileSync(join(outDir, rel), text),
      log: console.log,
    });
    console.log(`-> ${outDir}: ${built.planets.length} planets, ${built.asteroids} asteroids in ${models.size} models, ${built.fields.length} fields, ${built.points.length} jump points, ${Math.round((built.pack.sandbox?.edge ?? 0) / 1000)} km across, drawn from seed ${built.seed} (everything in it invented)`);
    printEffectSummary();
    break;
  }

  case 'maps': {
    // <swg-dir> <out-dir>: the client's own planet map (texture/ui_map_<planet>.dds) as map.png in
    // every converted planet pack under <out-dir>, with map.json saying how wide a ground it
    // covers (the terrain's width, from the pack's terrain.trn; the map shows the whole of it).
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const { parseTerrainTemplate } = await import('../../src/swg/terrain/trn.ts');
    // The zones whose map is not named for the pack.
    const MAP_NAMES = { kashyyyk_north_dungeons: 'ui_map_kashyyyk_north_dungeons_slaver', kashyyyk_south_dungeons: 'ui_map_kashyyyk_south_dungeons_hracca' };
    let done = 0;
    for (const planet of GAME_PLANETS) {
      const outDir = join(pos[2], planet);
      if (!existsSync(join(outDir, 'layout.json'))) continue;
      const texture = `texture/${MAP_NAMES[planet] ?? `ui_map_${planet}`}.dds`;
      if (!vfs.has(texture)) {
        console.log(`${planet}: no ${texture} in the archives`);
        continue;
      }
      let width = 16384;
      const trn = join(outDir, 'terrain.trn');
      if (existsSync(trn)) {
        try {
          width = parseTerrainTemplate(new Uint8Array(readFileSync(trn))).mapWidthInMeters || width;
        } catch (err) {
          console.log(`${planet}: terrain.trn not read (${err.message}); the map is taken as ${width} m wide`);
        }
      }
      const img = decodeDds(vfs.read(texture));
      writeFileSync(join(outDir, 'map.png'), encodePng(img.width, img.height, img.rgba));
      writeFileSync(join(outDir, 'map.json'), JSON.stringify({ image: 'map.png', width, texture }, null, 2));
      console.log(`${planet}: ${texture} ${img.width}x${img.height} over ${width} m -> ${join(outDir, 'map.png')}`);
      done++;
    }
    // galaxy.json: the game's own shuttle routes and each planet's ground width, for the galaxy map.
    // Where a system hangs in the galaxy is not in the archives and is not written here.
    const travelTable = (p) => (vfs.has(p) ? parseDatatable(parseIff(vfs.read(p))).rows : []);
    const galaxy = galaxyData(travelTable('datatables/travel/travel.iff'), travelTable('datatables/travel/planet_width.iff'));
    writeFileSync(join(pos[2], 'galaxy.json'), JSON.stringify(galaxy, null, 2));
    console.log(`galaxy.json: ${galaxy.planets.length} planets, ${galaxy.routes.length} shuttle routes -> ${join(pos[2], 'galaxy.json')}`);
    console.log(`${done} planet maps written`);
    break;
  }

  case 'clouds': {
    // <out-dir>: measure every converted world's own cloud sheets and write what they say about
    // its sky into <pack>/clouds.json -- how much of the sky each row covers and how dark that
    // cover is, both of which are in the client's art and neither of which is anywhere as a number.
    // It reads converted packs and no archive, so it takes no <swg-dir>.
    if (!pos[1]) usage();
    const { bakeClouds } = await import('./clouds.mjs');
    const packs = GAME_PLANETS.filter((p) => existsSync(join(pos[1], p, 'sky.json')));
    if (!packs.length) {
      console.log(`no converted world under ${pos[1]} has a sky yet; run snapshot and sky first`);
      break;
    }
    const out = bakeClouds(pos[1], packs, (line) => console.log(line));
    console.log(`clouds: ${out.done.length} worlds measured${out.skipped.length ? `, ${out.skipped.length} with no sky` : ''}`);
    // And the two noise volumes the march reads. Nothing in them comes out of the archives -- they
    // are generic cloud noise, the same on every world, and the client drew its sky as flat sheets
    // and had none -- so the pack says `invented` on the made-up system's own precedent.
    if (!options['no-noise']) {
      const { billowRange, buildBase, buildDetail, coverCurve, CLOUD_NOISE } = await import('./cloudnoise.mjs');
      const rule = await import('../../src/core/fx/cloudMath.ts');
      const dir = join(pos[1], 'clouds');
      mkdirSync(dir, { recursive: true });
      const say = (what) => (n, of) => {
        if (n === of || n % 32 === 0) process.stdout.write(`\rclouds: ${what} ${n}/${of}   `);
      };
      const t0 = Date.now();
      const base = buildBase(CLOUD_NOISE.baseSize, CLOUD_NOISE, say('base volume'));
      const detail = buildDetail(CLOUD_NOISE.detailSize, CLOUD_NOISE, say('detail volume'));
      process.stdout.write('\r');
      writeFileSync(join(dir, 'noise_base.rgba'), base);
      writeFileSync(join(dir, 'noise_detail.rgba'), detail);
      // The calibration, measured off the volumes just written: coverage is a share of sky, and
      // what a share of sky costs in threshold is three things at once that none of them is
      // arithmetic. `coverCurve` says why it is marched rather than reasoned about.
      const billow = billowRange(base, CLOUD_NOISE.baseSize);
      process.stdout.write('clouds: measuring what each threshold really covers   ');
      const cover = coverCurve(base, detail, CLOUD_NOISE.baseSize, CLOUD_NOISE.detailSize, rule.CLOUD_MARCH, rule);
      process.stdout.write('\r');
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({ format: 2, source: 'invented', base: { size: CLOUD_NOISE.baseSize, channels: 4, file: 'noise_base.rgba' }, detail: { size: CLOUD_NOISE.detailSize, channels: 4, file: 'noise_detail.rgba' }, billow, cover, frequencies: { base: CLOUD_NOISE.baseFrequencies, detail: CLOUD_NOISE.detailFrequencies } }, null, 1),
      );
      const reach = cover.filter((c) => c.sky > 0);
      console.log(`clouds: noise volumes written (${(base.length / 1048576).toFixed(1)} MB + ${(detail.length / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(0)}s; the billow lies between ${billow.lo} and ${billow.hi}, and a cut of ${reach.length ? reach[0].cut : '-'} to ${reach.length ? reach[reach.length - 1].cut : '-'} covers ${reach.length ? `${Math.round(reach[0].sky * 100)}% down to ${Math.round(reach[reach.length - 1].sky * 100)}%` : 'nothing'} of the sky`);
    }
    break;
  }
  case 'spawns': {
    // <out-dir> [--core3=<dir>]: where the world's creatures and its standing people really were,
    // read out of the owner's own emulator checkout. It opens no game archive, so it takes no
    // <swg-dir> and nothing about `--retail-only` applies to it; it must run after the worlds and
    // after `mobiles`, since it joins what the server named to the models this game has.
    //
    // **Nothing it writes may ever reach the repository.** The checkout is a third-party project
    // under its own licence: this reads its data, never its code, and everything written here lands
    // in the git-ignored output folder exactly as the packs converted from the game's own archives
    // do. `tools/swg/core3.mjs` says what the four-file chain is and where it is not what it looks
    // like.
    if (!pos[1]) usage();
    const core3 = options.core3 ?? process.env.CORE3 ?? '';
    if (!core3 || !existsSync(join(core3, 'managers', 'planet'))) {
      console.log(`spawns: no emulator scripts folder (--core3=<dir>, or CORE3 in .env); looked at ${core3 || '(nothing)'}`);
      break;
    }
    const c3 = await import('./core3.mjs');
    const trn = await import('../../src/swg/terrain/trn.ts');
    // Mounted once when the archives are offered: the nests are converted from it and every world's
    // snapshot is read from it to put the indoor people where they really stand.
    const spawnVfs = options.swg ? mount(options.swg) : null;
    /**
     * The pack's own ground, as a function of x and z, for the frame check.
     *
     * It is the client's own terrain rules with the buildings' own flattening layers on top, which
     * is what `navgrid` walks a world with, and it works in the snapshot's space. That is exactly
     * what makes it the right witness: it has nothing whatever to do with the scripts being read.
     * A world whose terrain is not converted answers NaN and is simply not measured.
     */
    const terrainHeights = (dir) => {
      try {
        const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8'));
        const trnPath = join(dir, layout.terrain ?? 'terrain.trn');
        if (!existsSync(trnPath)) return () => NaN;
        const template = trn.parseTerrainTemplate(new Uint8Array(readFileSync(trnPath)));
        for (const b of trn.bitmapFiles(template)) {
          const f = join(dir, b.file);
          if (existsSync(f)) trn.attachBitmap(template, b.familyId, new Uint8Array(readFileSync(f)));
        }
        const sampler = new trn.TerrainSampler(template);
        for (const o of layout.objects ?? []) {
          if (!o.layer) continue;
          const f = join(dir, o.layer);
          if (!existsSync(f)) continue;
          const L = trn.parseLayerFile(new Uint8Array(readFileSync(f)), template.generator);
          if (L) sampler.addBuildingLayer(L, o.x, o.z, o.q ? Math.atan2(2 * (o.q[3] * o.q[1] + o.q[0] * o.q[2]), 1 - 2 * (o.q[1] * o.q[1] + o.q[2] * o.q[2])) : 0);
        }
        return (x, z) => sampler.heightAt(x, z);
      } catch {
        return () => NaN;
      }
    };
    const started = Date.now();
    const regions = c3.readRegions(core3);
    const groups = c3.readSpawnGroups(core3);
    const lairs = c3.readLairs(core3);
    const creatures = c3.readCreatures(core3);
    const { statics, dropped } = c3.readStatics(core3);
    const catFile = join(pos[1], 'mobiles', 'catalogue.json');
    if (!existsSync(catFile)) {
      console.log(`spawns: no mobiles catalogue at ${catFile}; run mobiles first, since every name here has to reach a model`);
      break;
    }
    const cat = JSON.parse(readFileSync(catFile, 'utf8'));
    const { joined, missing } = c3.joinCatalogue(creatures, cat.entries ?? []);

    // The shared half: the creatures, what each lair stands and what each group may put down. One
    // copy for the fleet, since a creature is the same animal on every world that has it.
    const dir = join(pos[1], 'spawns');
    mkdirSync(dir, { recursive: true });
    const creatureOut = {};
    for (const [who, c] of joined) {
      creatureOut[who] = {
        id: c.id,
        level: c.level,
        hp: c.hp,
        hpMax: c.hpMax,
        damage: c.damage,
        armour: c.armour,
        xp: c.xp,
        diet: c.diet.toLowerCase(),
        kind: c.mob.replace(/^MOB_/, '').toLowerCase(),
        aggressive: c.aggressive,
        attackable: c.attackable,
        herd: c.herd,
        pack: c.pack,
        stalker: c.stalker,
        social: c.social,
        faction: c.faction,
        tame: c.tame,
        ferocity: c.ferocity,
        hues: c.hues,
      };
    }
    const lairOut = {};
    for (const [name, l] of lairs) lairOut[name] = { kind: l.kind, mobiles: l.mobiles, boss: l.boss, cap: l.cap, nest: l.nest, building: l.building, people: l.people };

    // Where the indoor people really stand, when the archives are to hand.
    //
    // **A person inside a building carries a position in that room's own frame and a number naming
    // the room**, and that number is the client's own object id for the cell -- the emulator kept
    // the world snapshot's ids, so the two join. Without the join those 2,524 rows are unusable:
    // a position of (-3.5, -12.7, -6.7) is a spot in a cantina and nowhere on a planet.
    //
    // The snapshot's own structure is what makes it work, and it is the structure CLAUDE.md already
    // records: an object indoors is contained by a **cell object** whose transform is identity and
    // whose `cellIndex` is the room, and that cell is contained by the building. So the cell's
    // world transform is the building's, and a person's world place is that transform applied to
    // the position they were written with. The room number travels with them so the runtime knows
    // which cell to put them in rather than guessing from a point.
    const roomsOf = (world) => {
      const out = new Map();
      if (!options.swg) return out;
      try {
        const ws = `snapshot/${world}.ws`;
        if (!spawnVfs.has(ws)) return out;
        const snap = parseSnapshot(parseIff(spawnVfs.read(ws)));
        const flat = flattenWithWorldTransforms(snap);
        for (const { node, world } of flat) {
          if (!node || !world || !(node.cellIndex > 0)) continue;
          const tpl = snap.templates[node.templateIndex] ?? '';
          if (!/\/cell\//.test(tpl)) continue;
          // `world` is the flattener's own answer for this node, which for a cell is its building's
          // -- a cell's own transform is identity. Reading `node.q`/`node.pos` instead gives exactly
          // that identity and leaves every person standing at the middle of the world.
          out.set(node.id, { cellIndex: node.cellIndex, q: world.q, pos: world.pos });
        }
      } catch {
        /* a world whose snapshot will not read simply keeps its people indoors and unplaced */
      }
      return out;
    };
    /** A point in a room's own frame, put into the world by that room's transform. */
    const intoWorld = (room, p) => {
      const [w, x, y, z] = room.q;
      const t = [2 * (y * p.z - z * p.y), 2 * (z * p.x - x * p.z), 2 * (x * p.y - y * p.x)];
      return {
        x: room.pos[0] + p.x + w * t[0] + (y * t[2] - z * t[1]),
        y: room.pos[1] + p.y + w * t[1] + (z * t[0] - x * t[2]),
        z: room.pos[2] + p.z + w * t[2] + (x * t[1] - y * t[0]),
      };
    };

    // The nests themselves, when the archives are to hand.
    //
    // A lair is a thing you walk up to and knock down, so it needs a model, and its model is in no
    // planet pack: the client never placed one, the server stood them. They are converted here
    // rather than by the snapshot for that reason, and only the ones a spawn area can really reach.
    // Without `--swg` the rest of the command still runs and the pack simply has no nests, which is
    // a world of herds and no lairs rather than a broken one.
    const nests = {};
    if (options.swg) {
      const cache = new Map();
      const nestDir = join(dir, 'nests');
      mkdirSync(nestDir, { recursive: true });
      // Everything a region can reach, of both kinds. A lair's `buildings*` column names either a
      // tangible nest -- a mound, an antpile, a bramble, the thing an animal lives in -- or a whole
      // POI building, which is a camp or a base that people live in. Taking only the first leaves
      // every camp in the world as four thieves standing round nothing, which is 270 of the 851.
      const wanted = new Set();
      for (const [, r] of regions) {
        for (const a of r.spawn) {
          for (const g of a.groups) {
            for (const s of groups.get(g) ?? []) {
              const l = lairs.get(s.lair);
              if (l?.nest) wanted.add(l.nest);
            }
          }
        }
      }
      let made = 0;
      let failed = 0;
      for (const template of wanted) {
        try {
          const r = resolveTemplateMesh(spawnVfs, template, cache);
          if (r.skip || !r.parts?.length) {
            failed++;
            continue;
          }
          const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length && !r.parts[0].hardpoints?.length;
          const id = familyOf(single ? r.parts[0].mesh : r.appearance);
          if (!nests[template]) {
            if (!existsSync(join(nestDir, `${id}.glb`))) {
              const conv = convertOne(spawnVfs, single ? r.parts[0].mesh : r.appearance, join(nestDir, `${id}.glb`));
              const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
              nests[template] = { id, file: `nests/${id}.glb`, bounds: conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b, triangles: conv.tris };
            } else nests[template] = { id, file: `nests/${id}.glb` };
            made++;
          }
        } catch {
          failed++;
        }
      }
      console.log(`spawns: ${made} nest models written${failed ? `, ${failed} that would not convert` : ''}`);
    }
    const groupOut = {};
    for (const [name, g] of groups) groupOut[name] = g;
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify(
        {
          format: 1,
          source: 'core3',
          converted: new Date().toISOString(),
          counts: { creatures: joined.size, unmatched: missing.length, lairs: lairs.size, groups: groups.size, nests: Object.keys(nests).length },
          creatures: creatureOut,
          lairs: lairOut,
          groups: groupOut,
          nests,
          // Named rather than dropped in silence: a creature the server stood that this game has no
          // body for is a hole in the world, and the only way anybody finds out is if it is written.
          unmatched: missing.slice(0, 400).map((m) => `${m.who} (${m.template})`),
        },
        null,
        1,
      ),
    );

    // The per-world half: the areas, the people who stand still, and the frame measured again.
    let areas = 0;
    let people = 0;
    let worlds = 0;
    const noWorld = [];
    for (const [world, r] of regions) {
      const out = join(pos[1], world);
      if (!existsSync(out)) {
        noWorld.push(world);
        continue;
      }
      const rooms = roomsOf(world);
      let placedIndoors = 0;
      let lostIndoors = 0;
      const rows = (statics.get(world) ?? [])
        .filter((s) => joined.has(s.who))
        .map((s) => {
          const row = { ...s, id: joined.get(s.who).id };
          if (!s.cell) return row;
          const room = rooms.get(s.cell);
          if (!room) {
            // Their position is a spot in a room and nowhere on a planet, so it is not a place.
            lostIndoors++;
            return { ...row, room: null };
          }
          placedIndoors++;
          const at = intoWorld(room, { x: s.x, y: s.y, z: s.z });
          return { ...row, ...at, room: room.cellIndex, local: [s.x, s.y, s.z] };
        })
        .filter((s) => s.cell === 0 || s.room !== null);
      if (rooms.size) console.log(`spawns: ${world} — ${placedIndoors} people put in their own rooms${lostIndoors ? `, ${lostIndoors} whose room is in no snapshot and are left out` : ''}`);
      // Which frame the numbers are in, asked of the ground rather than of anything built from the
      // same scripts. `heightCheck` says why that distinction is the whole of it.
      const frame = c3.heightCheck(rows, terrainHeights(out));
      if (frame.reading !== 'snapshot' && frame.outdoors > 20) {
        console.log(`spawns: ${world} READS MIRRORED (ground is ${frame.mirrored} m out as-is and ${frame.asIs} m mirrored) — every coordinate in it is on the wrong side of the world`);
      }
      writeFileSync(
        join(out, 'spawns.json'),
        JSON.stringify(
          {
            format: 1,
            planet: world,
            // Which half of this came from where, because the two halves are not the same kind of
            // thing. Every standing person is a real place the real server used. Not one creature
            // coordinate exists anywhere in that data: an area is a shape with a weighted list and
            // a cap, and where each animal stands is drawn from a seed on this side.
            source: { areas: 'core3', statics: 'core3', creaturePlaces: 'invented' },
            frameCheck: frame,
            counts: { areas: r.spawn.length, noSpawn: r.noSpawn.length, statics: rows.length, staticsDropped: dropped.get(world) ?? 0 },
            areas: r.spawn,
            noSpawn: r.noSpawn,
            statics: rows,
          },
          null,
          1,
        ),
      );
      areas += r.spawn.length;
      people += rows.length;
      worlds++;
    }
    console.log(
      `spawns: ${worlds} worlds, ${areas} spawn areas, ${people} standing people, ${joined.size} creatures with the server's own level, health and damage (${missing.length} named a body we have not got), ${lairs.size} lairs, ${groups.size} groups in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    if (noWorld.length) console.log(`spawns: not converted yet, so left out: ${noWorld.join(', ')}`);
    break;
  }
  case 'scenes': {
    // <out-dir> [--places=a,b] [--quality=0.35] [--aspect=3.8] [--cull=6]: the small worlds the
    // creation and selection screens stand a character in, built from the planet packs that are
    // already converted. It opens no archive -- the snapshots, the models and their textures are
    // all in the packs -- so it takes no <swg-dir> and nothing about `--retail-only` applies.
    //
    // It must run **after** the worlds it draws from, and it only ever writes under
    // <out-dir>/scenes: the packs themselves are read and never touched, so deleting that one
    // folder puts the install back exactly as it was.
    if (!pos[1]) usage();
    const { sceneSpots } = await import('../../src/data/scenes.ts');
    const { CREATOR_KEYS } = await import('../../src/world/scenePlaces.ts');
    const { bakeScenes } = await import('./scenes.mjs');
    const { SCENE_BAKE_TUNE } = await import('./scenebake.mjs');
    const tune = { ...SCENE_BAKE_TUNE };
    if (options.quality) tune.quality = Number(options.quality);
    if (options.aspect) tune.aspect = Number(options.aspect);
    if (options.cull) tune.cullPixels = Number(options.cull);
    const only = options.places ? String(options.places).split(',').map((s) => s.trim()).filter(Boolean) : null;
    const started = Date.now();
    const out = bakeScenes({ root: pos[1], spots: sceneSpots(), creatorKeys: CREATOR_KEYS, only, tune, log: (line) => console.log(line) });
    const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
    console.log(`scenes: ${out.manifest.places.length} places, ${out.manifest.models} models, ${mb(out.bytesBefore)} of pack read down to ${mb(out.bytesAfter)} (${out.shrunk} textures shrunk) in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    if (out.missingPacks.length) console.log(`scenes: not converted yet, so left out: ${out.missingPacks.join(', ')}`);
    for (const f of out.failed.slice(0, 10)) console.log(`scenes: ${f.key} failed — ${f.why}`);
    if (out.failed.length > 10) console.log(`scenes: and ${out.failed.length - 10} more`);
    break;
  }
  case 'navgrid': {
    // <planet>|all <out-dir> [--cell=2] [--skip-existing]: the outdoor walkability grid, baked from
    // a pack that is already converted. It opens no archive at all -- the terrain template, the
    // building terrain layers, the placements and the models' own triangles are all in the pack --
    // so it takes no <swg-dir> and nothing about `--retail-only` applies to it.
    if (!pos[2]) usage();
    const targets = pos[1] === 'all'
      ? GAME_PLANETS.filter((p) => existsSync(join(pos[2], p, 'layout.json'))).map((p) => [p, join(pos[2], p)])
      : [[pos[1], join(pos[2], pos[1])]];
    if (!targets.length) console.log(`no planet packs under ${pos[2]} yet; run snapshot first`);
    const cell = options.cell ? Number(options.cell) : undefined;
    // The angle the grid calls climbable. The default is 47, which is what a catalogue mobile --
    // a dynamic body, not a character controller -- was measured to climb at a hard run; the
    // player's own controller and every fighter climb 55, so the grid is cut to the body that can
    // do least. `SLOPE_CLIMB_DEGREES` in navgrid.mjs carries the whole of the owner's reasoning.
    const slope = options.slope ? Number(options.slope) : undefined;
    let built = 0;
    for (const [planet, outDir] of targets) {
      if (!existsSync(join(outDir, 'layout.json'))) {
        console.log(`${planet}: no layout.json under ${outDir}; run snapshot first`);
        continue;
      }
      // `--skip-existing` resumes a run that stopped, so what it must skip is a world that is
      // really **done**, not one that merely has a file. A grid of an older version is one the
      // game does not read at all, and a grid baked at another angle is a different grid; skipping
      // either leaves the tree looking converted and the game with no pathing on that world, with
      // `status` in the same session asking for the very bake this just declined to do.
      if (flags.has('--skip-existing')) {
        const there = readJson(join(outDir, 'nav.json'));
        const want = slope ?? SLOPE_CLIMB_DEGREES;
        if (there && there.version === NAV_GRID_VERSION && there.nx && Number(there.slopeDegrees) === Number(want)) {
          console.log(`${planet}: nav.json is there already, version ${there.version} at ${there.slopeDegrees} degrees`);
          continue;
        }
        if (there) {
          console.log(`${planet}: re-baking: the nav.json there is ${there.version === NAV_GRID_VERSION ? `at ${there.slopeDegrees} degrees, not ${want}` : `version ${there.version}, which this build does not read`}`);
        }
      }
      try {
        const grid = await buildNavGrid(outDir, { cell, slope, log: (line) => console.log(line) });
        const out = writeNavGrid(outDir, grid);
        const stats = out.stats;
        console.log(`  blocked before the body's ${stats.margin} m margin: slope ${stats.slope}, objects ${stats.objects}, water ${stats.water}; after it ${stats.blocked} (${((100 * stats.blocked) / (out.nx * out.nz)).toFixed(2)}%), plus ${stats.indoor} cells inside ${stats.buildings} portal buildings, which the rooms' own pathing has`);
        console.log(`  the largest walkable region holds ${out.regions[0] ? out.regions[0].km2 : 0} km^2; ${out.regions.length} are ranked and ${out.otherRegions} more are smaller still`);
        // How much room this world has to stand a route off anything, which is the whole of what
        // the clearance plane is for: a world whose walkable ground is nearly all at the cap can
        // buy a berth almost everywhere, and one that is mostly one and two cannot.
        const walkable = stats.clearance.slice(1).reduce((a, b) => a + b, 0);
        const roomy = stats.clearance[stats.clearance.length - 1];
        console.log(`  clearance: ${((100 * roomy) / Math.max(1, walkable)).toFixed(1)}% of the walkable ground stands ${out.clearMax} cells or more off anything, at ${(100 * stats.clearance[1]) / Math.max(1, walkable) < 0.05 ? '<0.1' : ((100 * stats.clearance[1]) / Math.max(1, walkable)).toFixed(1)}% hard against it`);
        console.log(`${planet}: ${(out.packedBytes / 1e6).toFixed(2)} MB -> ${join(outDir, 'nav.bin')} in ${stats.seconds} s`);
        built++;
      } catch (err) {
        console.log(`${planet}: ${err.message}`);
      }
    }
    console.log(`${built} worlds baked`);
    break;
  }

  case 'audit': {
    // <swg-dir> <out-dir> [planet]: everything the archives place on each converted planet against what its pack holds
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const planets = pos[3] && !pos[3].startsWith('--') ? [pos[3]] : GAME_PLANETS.filter((p) => existsSync(join(pos[2], p, 'layout.json')));
    // Everything printed also goes to <out-dir>/audit.txt, for sharing.
    const lines = [];
    const log = (line) => {
      console.log(line);
      lines.push(line);
    };
    log(`audit of ${pos[2]} on ${new Date().toISOString()}; ${vfs.summary}${flags.has('--retail-only') ? ' (retail only)' : ''}${flags.has('--events') ? ', event areas included' : ''}`);
    for (const planet of planets) {
      const packDir = join(pos[2], planet);
      const layout = JSON.parse(readFileSync(join(packDir, 'layout.json'), 'utf8'));
      const manifest = existsSync(join(packDir, 'manifest.json')) ? JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8')) : { categories: {} };
      const models = new Map((manifest.categories?.layout ?? []).map((m) => [m.id, m]));
      let entries;
      try {
        const loaded = loadPlanetObjects(vfs, planet);
        entries = loaded.entries.map((e) => ({ template: loaded.snap.templates[e.node.templateIndex], e }));
      } catch (err) {
        log(`${planet}: ${err.message}`);
        continue;
      }
      const placed = new Map();
      for (const o of layout.objects) placed.set(o.template, (placed.get(o.template) ?? 0) + 1);
      const inArchives = new Map();
      for (const { template, e } of entries) {
        const h = inArchives.get(template) ?? { count: 0, example: e };
        h.count++;
        inArchives.set(template, h);
      }
      const cache = new Map();
      const missing = [];
      let missingObjects = 0;
      for (const [template, h] of inArchives) {
        const have = placed.get(template) ?? 0;
        if (have >= h.count) continue;
        const r = resolveTemplateMesh(vfs, template, cache);
        const reason = r.skip ? r.skip : r.skeletal ? (/^object\/(mobile|creature)\//i.test(template) ? 'creature or NPC (server spawns it)' : 'skeletal prop: reconvert to bake it') : r.particle ? 'particle effect: reconvert to add it' : 'converted, but the pack lacks it (radius filter, or an older conversion)';
        missing.push({ template, want: h.count, have, reason, at: h.example.world?.pos });
        missingObjects += h.count - have;
      }
      const glbMissing = [...models.values()].filter((m) => !existsSync(join(packDir, m.file))).map((m) => m.id);
      const noModel = layout.objects.filter((o) => !models.has(o.model)).length;
      log(`${planet}: archives place ${entries.length} objects, pack has ${layout.objects.length}; ${missingObjects} not in the pack across ${missing.length} templates${noModel ? `; ${noModel} placed objects name a model the manifest lacks` : ''}${glbMissing.length ? `; ${glbMissing.length} manifest models have no file: ${glbMissing.slice(0, 5).join(', ')}` : ''}`);
      const byReason = new Map();
      for (const m of missing) byReason.set(m.reason, (byReason.get(m.reason) ?? 0) + (m.want - m.have));
      for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(6)}  ${reason}`);
      const limit = Number(options.limit ?? 60);
      for (const m of missing.sort((a, b) => b.want - b.have - (a.want - a.have)).slice(0, limit)) log(`    ${m.want - m.have} of ${m.want} missing  ${m.template}  (${m.reason})${m.at ? ` e.g. ${m.at[0].toFixed(0)},${m.at[2].toFixed(0)}` : ''}`);
      log('');
    }
    writeFileSync(join(pos[2], 'audit.txt'), lines.join('\n') + '\n');
    console.log(`written to ${join(pos[2], 'audit.txt')}`);
    break;
  }

  case 'extras': {
    // <swg-dir>: what the archives outside the retail manifests add or replace, by category, without converting any of it
    if (!pos[1]) usage();
    const dir = pos[1];
    const isRetail = (f) => isRetailByName(f, statSync(join(dir, f)).size) !== null;
    const all = openVfs(dir, { log: () => {} });
    const retail = openVfs(dir, { filter: isRetail, log: () => {} });
    const extra = all.archives.map((a) => basename(a.path)).filter((f) => !isRetail(f));
    console.log(`archives outside the retail manifests: ${extra.length ? extra.join(', ') : 'none'}`);
    const category = (name) => {
      if (name.startsWith('snapshot/')) return 'world snapshots';
      if (name.startsWith('datatables/buildout/')) return 'buildout tables';
      if (/^terrain\/.*\.(trn|lay|tga)$/.test(name)) return 'terrain rules, building layers and heightmaps';
      if (name.startsWith('terrain/environment/') || name.startsWith('datatables/environment/')) return 'sky and environment';
      if (name.startsWith('datatables/clientregion/') || /^string\/en\/.*region/.test(name)) return 'named regions';
      if (name.startsWith('object/')) return 'object templates';
      if (name.startsWith('appearance/')) return 'appearances (meshes, portals, skeletons, animations)';
      if (name.startsWith('texture/')) return 'textures';
      if (name.startsWith('shader/') || name.startsWith('effect/')) return 'shaders and effects';
      if (name.startsWith('datatables/')) return 'other datatables';
      if (name.startsWith('string/')) return 'strings';
      if (name.startsWith('ui/')) return 'user interface';
      if (name.startsWith('sound/') || name.startsWith('music/')) return 'sound and music';
      return 'other';
    };
    const detail = new Set(['world snapshots', 'buildout tables', 'terrain rules, building layers and heightmaps', 'sky and environment', 'named regions']);
    const groups = new Map();
    for (const name of all.list()) {
      const st = all.stat(name);
      if (!st || isRetail(basename(st.archive))) continue;
      const cat = category(name);
      const g = groups.get(cat) ?? { added: [], replaced: [] };
      (retail.has(name) ? g.replaced : g.added).push(`${name} (${basename(st.archive)})`);
      groups.set(cat, g);
    }
    const order = [...groups.entries()].sort((a, b) => b[1].added.length + b[1].replaced.length - (a[1].added.length + a[1].replaced.length));
    for (const [cat, g] of order) {
      console.log(`\n${cat}: ${g.added.length} new, ${g.replaced.length} replacing retail files`);
      const show = (label, list) => {
        if (!list.length) return;
        const limit = detail.has(cat) ? list.length : 12;
        console.log(`  ${label}:`);
        for (const n of list.slice(0, limit)) console.log(`    ${n}`);
        if (list.length > limit) console.log(`    ... and ${list.length - limit} more`);
      };
      show('replaced', g.replaced);
      show('new', g.added);
    }
    break;
  }

  case 'sounds': {
    // <swg-dir> <out-dir> [planet|all]: the sound bank. Every sound template the game may play (all but the
    // background music and the instrument parts, plus the music the world places in a room), the
    // samples they name copied as they are, the client data that says which sound belongs to which
    // event, and the tables that put a sound in a room, on a door, on a melee or ranged weapon, on a
    // ship's power and its flyby, and under a foot. --only=<text> converts just the templates whose
    // path holds that text and --no-samples writes the JSON without the audio, both for quick checks.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    mkdirSync(pos[2], { recursive: true });
    // Jedi Academy first, so a wrong path is found before the long work: its saber hums, the files
    // its animation events name, and the frames those events mark.
    const jkaSounds = options.jka ? convertJkaSounds(options.jka, pos[2], { log: console.log }) : null;
        convertSounds(vfs, pos[2], { only: options.only ?? null, samples: !flags.has('--no-samples'), log: console.log });
    // When each of the game's own animations marks a footstep, a voice or a blow landing, which
    // animation each species' clips play, and which client data each body reads its events from.
    convertClipEvents(vfs, pos[2], { jka: jkaSounds, log: console.log });
    // What a ship, a ship part and a vehicle sound like: the engine loop the fitted engine part
    // carries, the booster, a hull's own thrusters and the sound it blows up with, and every
    // vehicle's idle, run and water sounds, each joined to the client data that speaks for it.
    convertShipSounds(vfs, pos[2], { log: console.log });
    // A planet argument (or `all`) also writes where that planet's sounds are: the emitters its
    // world places, the room beds of the buildings it places, and what is underfoot on each of them.
    // A name that is not a planet is a typo, not a planet with nothing in it, so it says so.
    if (pos[3] && pos[3] !== 'all' && !GAME_PLANETS.includes(pos[3])) usage();
    if (pos[3]) convertSoundPlaces(vfs, pos[2], { planets: pos[3] === 'all' ? GAME_PLANETS : [pos[3]], log: console.log });
    break;
  }

  case 'convert': {
    // [out-dir] [--swg=<dir>] [--jka=<dir>] [--only=<command>,...] [--jobs=N] [--dry-run] [--yes]:
    // the whole conversion, in one command. Nothing here holds the list of conversions and nothing
    // here decides an order: `status` says what is missing, convertPlan.mjs says what may run beside
    // what, convertRun.mjs runs those steps as children of this node, and convertDrive.mjs joins the
    // three and asks `status` again until it asks for nothing -- the same driver the launcher's own
    // Convert runs, so the two cannot drift apart. This is a way in, not a way out: every command
    // below still runs on its own exactly as it did, and this one only ever starts those same commands.
    const outDir = resolve(pos[1] ?? 'assets-private');
    // What `--jobs=` comes to is the runner's own `jobsFor`, and nobody else's: the launcher hands in
    // whatever its settings hold and this hands in whatever was typed, so `--jobs=0`, `--jobs=lots` and
    // `--jobs=64` mean one thing in both. Said out loud when what was asked for is not what is used.
    const jobsAsked = options.jobs === undefined ? null : options.jobs;
    const only = options.only ? options.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
    // A name that is no command of this converter's would otherwise be a run that does nothing and
    // calls itself finished. The list is read from this file's own usage lines, which is the list
    // `usage()` prints, so a command added later needs nothing done here.
    if (only) {
      const known = readFileSync(new URL(import.meta.url))
        .toString()
        .split('\n')
        .map((l) => /^\/\/\s+node tools\/swg\/cli\.mjs (\S+)/.exec(l))
        .filter(Boolean)
        .map((m) => m[1]);
      const wrong = only.filter((c) => !known.includes(c));
      if (wrong.length) {
        console.error(`--only= does not know ${wrong.join(', ')}. The commands are: ${known.join(', ')}`);
        process.exit(1);
      }
    }
    const dryRun = flags.has('--dry-run');
    // Nothing is asked when there is nobody to answer: a script, a launcher or anything else whose
    // input is not a console is told what is wrong rather than left waiting at a prompt for ever.
    const quiet = flags.has('--yes') || !process.stdin.isTTY;
    // The driver reads this machine and starts children, and every step it starts is another run of
    // this very file: it is loaded only when convert is asked for, so no other command, and none of
    // those children, carries any of it.
    let driver;
    let plan;
    try {
      driver = await import('./convertDrive.mjs');
      plan = await driver.loadPlan();
    } catch (err) {
      console.error(`convert needs tools/swg/convertDrive.mjs, convertPlan.mjs and convertRun.mjs, and this checkout has not got all three (${err.message}).`);
      console.error('Every command still runs on its own; the list is in README.md under "Converting your own SWG install".');
      process.exit(1);
    }

    const askLine = async (question) => {
      const { createInterface } = await import('node:readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return String(await new Promise((res) => rl.question(question, res))).trim();
      } finally {
        rl.close();
      }
    };
    // Where the two installs are: what the command line named, else .env, else what Windows itself
    // records, else the usual places. Nothing is ever taken on trust: every candidate is checked, and
    // when none is right the search itself is printed rather than a guess being made quietly.
    let found = plan.findInstalls({ swg: options.swg ?? null, jka: options.jka ?? null });
    while (!found.swg.ok) {
      console.error(found.swg.sentence);
      for (const where of found.searched) console.error(`  looked: ${where}`);
      if (quiet) process.exit(1);
      const typed = await askLine("The folder holding the client's .tre archives (blank to give up): ");
      if (!typed) process.exit(1);
      found = plan.findInstalls({ swg: typed, jka: options.jka ?? null });
    }
    console.log(`Star Wars Galaxies: ${found.swg.path}${found.swg.from ? ` (${found.swg.from})` : ''}`);
    console.log(found.jka.ok ? `Jedi Academy: ${found.jka.path}${found.jka.from ? ` (${found.jka.from})` : ''}` : `Jedi Academy: ${found.jka.sentence}`);
    console.log(`Converted content: ${outDir}`);
    const atOnce = driver.jobsFor(jobsAsked);
    if (jobsAsked !== null && String(atOnce) !== String(jobsAsked).trim()) {
      console.log(`--jobs=${jobsAsked} is not a number of steps this machine can run at once; ${atOnce} at once instead.`);
    }
    if (!dryRun && !quiet) {
      const answer = await askLine('Convert now? A first full run takes hours and about 14 GB. [Y/n] ');
      if (/^n/i.test(answer)) process.exit(0);
    }

    const { fileURLToPath } = await import('node:url');
    // One moving display for the whole run rather than ten children shouting at once: while it is
    // drawing it is the only thing that writes to the screen, and every child's own output is in its
    // own file. On anything that is not a terminal it prints a line as each step starts and ends
    // instead, so a piped run reads as a log rather than as a screenful of cursor moves.
    let display = null;
    const show = (line) => {
      if (!display || !process.stdout.isTTY) console.log(line);
    };
    // Ctrl+C stops cleanly: the driver kills whatever is running and says what was finished and what
    // was not, and running convert again carries on from what status says is left. A second press is
    // the ordinary way out, for a child that will not go -- and it stops the display first, since the
    // display hides the cursor while it draws and only its own stop puts it back.
    const stopper = new AbortController();
    let presses = 0;
    const onInterrupt = () => {
      presses++;
      if (presses > 1) {
        if (display) display.stop();
        process.exit(130);
      }
      console.log('\nstopping: what is running is being stopped; run convert again to carry on');
      stopper.abort();
    };
    process.on('SIGINT', onInterrupt);
    let summary;
    try {
      summary = await driver.runConvert({
        cli: fileURLToPath(import.meta.url),
        plan,
        out: outDir,
        swg: found.swg.path,
        jka: found.jka.ok ? found.jka.path : '',
        jobs: jobsAsked,
        only,
        dryRun,
        signal: stopper.signal,
        onPass: ({ state }) => {
          display = driver.startDisplay(state);
        },
        onEvent: (e) => {
          if (display) display.event(e);
          switch (e.kind) {
            case 'status':
              show(e.done ? 'nothing is missing' : `${e.steps} thing${e.steps === 1 ? ' is' : 's are'} missing${e.seeded ? `, ${e.seeded} of them work status has no way of asking for` : ''}`);
              break;
            case 'pass':
              show(`${e.steps.length} step${e.steps.length === 1 ? '' : 's'} to run, up to ${e.jobs} at once; logs in ${e.logDir}`);
              for (const p of e.problems) show(`  ${p}`);
              break;
            // Nothing is said here about a step starting, ending or being passed over: the display says
            // it, in whichever of its two ways this screen wants, and the summary says it again at the
            // end. Said here as well it would be said twice on anything that is not a terminal.
            case 'note':
              show(e.line);
              break;
            case 'pass-end':
              if (display) display.stop();
              display = null;
              break;
            default:
              break;
          }
        },
      });
    } catch (err) {
      if (display) display.stop();
      console.error(`the conversion could not go on: ${err.message}`);
      process.exitCode = 1;
      break;
    } finally {
      process.off('SIGINT', onInterrupt);
    }
    console.log('');
    for (const line of summary.lines) console.log(line);
    if (!summary.ok) process.exitCode = 1;
    break;
  }

  case 'status': {
    // <out-dir>: what the converted packs hold, and the command that fills each gap. Needs no archives.
    if (!pos[1]) usage();
    if (flags.has('--json')) {
      // The same report for a program (the launcher): the steps still to run, in order, each with its
      // arguments split and its reasons, and the report's own lines beside them. The folder is resolved
      // so every path in a step begins with exactly the text the steps are split around.
      const dir = resolve(pos[1]);
      const lines = [];
      const keep = console.log;
      console.log = (...a) => lines.push(a.map(String).join(' '));
      let todo;
      try {
        todo = packStatus(dir);
      } finally {
        console.log = keep;
      }
      process.stdout.write(`${JSON.stringify(statusJson(todo, dir, lines), null, 2)}\n`);
      break;
    }
    packStatus(pos[1]);
    break;
  }

  case 'terrain-check': {
    if (!pos[1]) usage();
    await terrainCheck(pos[1], Number(options.limit ?? 30), { layers: args.includes('--layers'), at: options.at });
    break;
  }

  case 'batch': {
    const vfs = mount(pos[1]);
    const outDir = pos[2];
    const filter = pos[3] ?? 'appearance/mesh/';
    let ok = 0;
    const failures = [];
    for (const name of vfs.list(filter)) {
      if (!name.endsWith('.msh')) continue;
      const out = join(outDir, name.replace(/\.msh$/, '.glb'));
      try {
        convertOne(vfs, name, out);
        ok++;
      } catch (err) {
        failures.push(`${name}: ${err.message}`);
      }
    }
    console.log(`converted ${ok} meshes, ${failures.length} failed`);
    if (failures.length) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'failures.log'), failures.join('\n'));
      console.log(`see ${join(outDir, 'failures.log')}`);
    }
    break;
  }
  default:
    usage();
}
