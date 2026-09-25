import * as THREE from 'three';
// The display's own rules, apart from the panels'. The stylesheet in index.html carries the named
// colours on `:root`; this one carries what is drawn from them.
import './ui/hud.css';
const torchDir = new THREE.Vector3();
import { BountyHunterKit } from './combat/bountyHunter';
import { Effects } from './combat/effects';
import { JediKit } from './combat/jedi';
import type { ClassId, Kit, KitContext } from './combat/kit';
import { ThirdPersonCamera } from './core/camera';
import { PortalRenderer, SHADOW_STRAYS } from './world/portalRender.ts';
import { Input, type Action } from './core/input';
import { Physics } from './core/physics';
import { PLANETS, packIdOf, planetBelow, planetById, spaceZoneOf, type PlanetDef } from './data/planets';
import { DEFAULT_SABER_COLOR, Player } from './player/player';
import { MARK_WORLD, marks, type MarkPlace } from './world/marks.ts';
import { collectBlades, lightAt, litCeiling, type LitSources } from './combat/bladeLights';
import { CLASH, clashes } from './combat/clash.ts';
import { SCARS, scarReport, setScars, tuneScars } from './combat/scars.ts';
import { gunSpeedReport, type GunSpeedTune } from './combat/guns.ts';
import { footprints } from './world/footprints.ts';
import { loosePropsGroup, propsDebug } from './world/looseProps.ts';
import { saberHitReport, type SaberHitTune } from './combat/saberHit.ts';
import { createBladeList } from './core/fx/bladeList';
import { BLADE_GLOW_TUNE, segmentDistanceSq, type BladeGlowTune } from './core/fx/bladeGlowMath.ts';
import { BLADE_GLOW_VIEWS, type BladeGlowPass } from './core/fx/bladeGlow';
import { SSAO_TUNE_DEFAULTS, type SsaoPass } from './core/fx/ssao';
import { SSAO_BASE_POWER } from './core/fx/ssaoMath.ts';
import type { FighterGlow } from './world/npcs';
import { DEFAULT_TIER } from './world/npcs.ts';
import { captureScene, headingDegrees, sceneLine } from './world/sceneCapture.ts';
import { framePlace, orbitFor, packPlanet, FRAME_ASPECT, ORBIT_EYE_HEIGHT } from './world/scenePlaces.ts';
import { buildPlace, disposePlace, sceneManifest, type BuiltPlace } from './world/sceneWorld.ts';
import { clampView, dragView, restView, viewPose, zoomBy, type SceneView } from './world/sceneView.ts';
import { sceneSpots } from './data/scenes.ts';
/**
 * How near a named place has to be for `__debug.scene` to call the shot that place's. Ours, and
 * generous on purpose: it is a label on a captured line and not a rule anything obeys.
 */
const SCENE_PLACE_REACH = 400;
/**
 * How far a parked ship may be from the camera and still be taken as part of a captured shot.
 *
 * This is **not** the mount range and must never be it again. The capture first asked
 * `nearestVehicle`, which is the test for what the player could climb into: 3.6 m from the hull's
 * own edge, and nothing more than 4 m above or below them. A ship parked where it actually looks
 * right in a picture is nowhere near that, so of sixty-seven captures with a ship parked in shot,
 * exactly one recorded it -- and only because that test subtracts the hull's radius and a big hull
 * has enough of one to cover the difference. The question a capture asks is what is in the
 * picture, not what is within arm's reach.
 */
const SCENE_SHIP_REACH = 250;
/**
 * How much world a captured place builds, and how long it may take about it. Ours, every one.
 *
 * A scene's camera never moves, so unlike a walking player it has a known, finite view and nothing
 * needs to arrive later. The near radius is cut well below the game's own because the far tiles are
 * what carry a vista -- Theed's mountains are eleven kilometres out and are far tiles, not chunks --
 * and the object reach does nothing at all here, since a scene has no streamer to reach with.
 */
const SCENE_REACH = { objects: 0, terrain: 3, far: 6, waitMs: 40000 };
import { loadPlayerRig } from './player/rig';
import { LOOK, lookReport, packPitch, wrapAngle } from './player/lookAt.ts';
import { Character, loadSpeciesIndex, type SpeciesEntry } from './player/character';
import { GalaxyMap, type Poi } from './ui/galaxyMap';
import { MapUi } from './ui/mapUi';
import { groupMapFeed } from './ui/spaceMapLayers.ts';
import { WardrobeUi } from './ui/wardrobeUi';
import { WeaponsUi } from './ui/weaponsUi';
import { GIVE_TUNE } from './ui/giveModel.ts';
import { BackpackUi, type BackpackCell } from './ui/backpackUi';
import { Equipment } from './player/equipment';
import { itemInfo, WEAPON_ORDER, type ItemContext } from './player/items';
import { OFF_HAND_CLASSES, normalizeOwned, slotRank, slotWords, speciesWords } from './core/inventory';
import { ForceUi } from './ui/forceUi';
import { DEFAULT_LOADOUT, POWERS, forceFxReport, type ForceFxTune } from './combat/forcePowers';
import { setForceBeamLook } from './combat/forceLightning.ts';
import { DEFAULT_GADGETS, GADGETS } from './combat/gadgets';
import { RAGDOLL } from './combat/ragdoll';
import { WeaponCatalogue, type WeaponDef } from './player/weapons';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// `distanceWords` is the interface's own spelling of a distance, threshold and all, so the death
// card's rows read exactly as the group roster's do.
import { distanceWords, Hud, hudBindingsChanged, Roster, ROSTER_TUNE } from './ui/hud';
import { specFor, type DriveInput } from './vehicles/vehicle';
import { interceptTime, leadPoint } from './combat/intercept';
import { PostFX, type FxFrameInput, type SunInfo } from './core/postfx';
import { fxPassDef, isFxSettingKey, type FxPassId } from './core/fxRegistry.ts';
import { installEffects } from './core/fx/install';
import { addPointLight, createFxLights, setSpotLight } from './core/fx/lights';
import { createCloudLayers, createSkyLights, flareLook, tuneFlareLook } from './core/fx/lensFlare';
import { MAX_CLOUD_LAYERS, MAX_FLARE_SOURCES } from './core/fx/flareMath';
import { SPACE_SKY_TUNE, tuneSpaceSky, type SunRule } from './space/suns';
import { heatTuning, type HeatProduct } from './core/fx/heat';
import { CLOUD_MARCH, type CloudsPass } from './core/fx/clouds';
import { CLOUD_TUNE, cloudLook, loadCloudPack, loadCloudVolumes, worthDrawing, type CloudPack } from './world/cloudLook.ts';
import { tuneUnderwater, unknownUnderwaterKeys, type UnderwaterTune } from './core/fx/underwaterMath.ts';
import type { UnderwaterPass } from './core/fx/underwater';
import { FIGURE_SPHERE, followDepth, measureLocalSphere, type FxMoverList, type LocalSphere, type VelocityProduct } from './core/fx/velocity';
import { MOTION_TUNING, MOVER_LIMITS } from './core/fx/velocityMath.ts';
import type { MotionBlurPass } from './core/fx/motionBlur';
import { HeatSources, plumeNoiseFrequency } from './world/heatSources';
import { MobileAssets } from './world/mobiles/assets';
import { vehiclePlumes } from './vehicles/enginePlumes';
import { Notice } from './ui/notice';
import { MESSAGES, MessageLine, plain, tuneMessages } from './ui/messages';
import { COL, colourOf } from './core/palette';
import { HudCanvas, OVERLAY_TUNE } from './ui/hudCanvas';
import { layout, makeLayout, tuneSizes, type HudLayout, type HudSizes } from './ui/hudMath';
import { ActionBar } from './ui/prompt';
import { PROMPT, newPromptState, resetPromptState, tunePrompt, type PromptState } from './ui/promptRules';
import { FEEDBACK_TUNE, HudFeedback, type FeedbackTune, type ScreenPoint } from './ui/hudFeedback';
import { Nameplates, PLATE_TUNE } from './ui/nameplate';
import { VehiclesUi } from './ui/vehiclesUi';
import { ShipEditUi } from './ui/shipEditUi';
import { DROID_SHOWN, DROID_SHOWN_BY_HULL, droidShown, droidSink, fitKey, packFit, partsOf, slotLabel, stockFit, type ResolvedFit, type ShipFit } from './vehicles/shipFit';
import { NpcUi } from './ui/npcUi';
import { CATALOGUE_COMMAND } from './world/mobiles/catalogue';
import { ambientOverrides, lookBounds, spawnDistance } from './world/mobiles/spawning';
import { AppearanceUi } from './ui/appearanceUi';
import { CharacterSelect } from './ui/characterSelect';
import { CreatorBar } from './ui/creatorBar';
import { PlaceBar } from './ui/placeBar.ts';
import { Menu, keyName, onBindingsChanged, notifyBindingsChanged } from './ui/menu';
import { ShipMenu, type ShipCruise, type ShipStatus } from './ui/shipMenu';
import { BOARD_TUNE, Docking, boardRow, onPeerHullGone, peerHullGone, peerRooms, setPeerRooms, type BoardState, type CrossSide, type CrossTo, type PeerRooms, type SpotKind } from './space/docking';
import { CLAMP_TUNE, DOCK_TUNE } from './space/dockingMath';
import { HyperspaceUi } from './ui/hyperspaceUi';
import { Hyperspace } from './space/hyperspace';
import { CRUISE_KEY, CRUISE_TUNE, Cruise, tuneCruise } from './space/cruise';
import { HyperspaceTunnel } from './space/hyperspaceTunnel';
import { STAND_ENEMY, STAND_FRIEND, STAND_NEUTRAL, ShipHud, WING_CLOSED, WING_HELD, WING_NONE, WING_OPEN, WING_OPENING, newFlightView, newTargetView, type FlightTune, type FlightView, type MessageKind as ShipMessageKind, type TargetView } from './ui/shipHud';
import { TargetFx } from './space/targetFx';
import { FACTION_COLOR, FACTION_LABEL, shipStanding, type ShipFaction } from './space/factions';
import { NpcBrain } from './space/npcBrain';
import { MOUSE_FLIGHT, aimCursor, circleRadius, coneClamp, flightTune, gunAim, hullRay, insideCircle, moveCursor, ringRadius, stickFromCursor, type Cursor, type FlightStick, type FlightTuneInput } from './space/mouseFlight';
import { ZONE_TIER } from './space/roster';
import { fillTaunt, pickLine } from './space/taunts';
import { componentLine } from './space/shipStats';
import { targetable, type CombatStatus } from './space/shipCombat';
import type { ShipSpawner } from './ui/npcUi';
import { HyperspaceCatalogue, arrivalAt, landmarksOf, loadSpacePack, type Destination } from './space/spaceData';
import { TUNNEL_TIMES, arrivalPose, jumpChaseBack, lookRotation, sceneOf, toGame, tunnelCameraFar, tunnelSize } from './space/hyperspaceMath';
import { LiftMenu } from './ui/liftMenu';
import { stopLabel, type LiftStop } from './world/lifts';
import { draggable, windowsDebug } from './ui/drag.ts';
import { LoadingScreen } from './ui/loading';
import { EmoteWheel } from './ui/emoteWheel';
import { Net, type Hello, type PeerVehicle } from './net/net';
import { SESSION, Session, tuneSession } from './net/session.ts';
import { clockKnob } from './world/sharedClock.ts';
// The group and the chat: the browser's half of what the server holds, and the two panels over it.
import { sharedClock } from './world/sharedClock.ts';
import { GROUP_RANGE, GROUP_TUNE, Groups, tuneGroups } from './net/groups.ts';
import { GROUP_UI_TUNE, GroupUi, tuneGroupUi } from './ui/groupUi.ts';
import { TRADE_TUNE, Trade, tuneTrade, type TradeItem } from './net/trade.ts';
import { TRADE_UI_TUNE, TradeUi, tuneTradeUi } from './ui/tradeUi.ts';
import { CHAT_TUNE, ChatUi, tuneChat } from './ui/chatUi.ts';
// The moods: one word that is two things at once, the body's branch and the chat's mark.
import { MOOD_TUNE, cleanMoodName, findMood, isMoodOff, moodListLine, moodNote, moodReport, tuneMoods } from './player/moods.ts';
import { COMBAT_TUNE, CombatNet, tuneCombat } from './net/combatNet.ts';
// Travelling together: what a leader's trip means on this side, and where to come out to be beside them.
import { TOGETHER_TUNE, TravelTogether, tuneTogether, type TogetherMove } from './net/travelTogether.ts';
// The world's creatures: nothing stands on its own, an admin stands them, and one browser thinks for each.
import { OWN_TUNE, owned, tuneOwned, type SpawnRow } from './net/owned.ts';
// The world's creatures as they cross: a keeper's batch, and a blow asked of whoever keeps one.
import { NPC_TUNE, NpcNet, tuneNpcs } from './net/npcNet.ts';
import { peerBodies } from './net/remoteBodies.ts';
// One creature stood by hand, as everything that talks about it says it.
import { recordFor, type SpawnRecord } from './world/spawnSeed.ts';
import type { Bolt } from './combat/bolts';
import { applyAppearance, dress, packLook } from './player/look';
import { RemotePlayers, watchPeers } from './net/remotePlayers';
import { remoteBlades } from './net/remoteBlades.ts';
import { danceOf, defaultEmotes, emoteChoices, FLOURISHES, isDanceClip, isFlourishClip, loadEmotes, loopsEmote, saveEmotes } from './core/emotes';
import { HUD_DPR_RANGE, HUD_LINES_RANGE, HUD_SCALE_RANGE, loadSettings, type Settings } from './core/settings';
import { deleteCharacter, knownToServer, loadCharacters, markKnownToServer, newCharacterId, upsertCharacter, type Appearance, type SavedCharacter } from './core/characters';
import { FRAME_NUDGE, Garage, type VehicleDef } from './vehicles/garage';
import { WINGS_KEY, WING_RULE, dropPilotChoices } from './vehicles/wings';
import { CUT_ENGINES_KEY, LANDING, SHIP_GROUND, SHIP_ROOM, SPACE_LANDING } from './vehicles/landing';
import { SURFACE_ROOM, SurfaceRoom, isSurfaceRoom, probeSurface, roomFrame, roomTurn, type WalkableRoom } from './vehicles/surfaceRoom';
import type { Vehicle, VehicleKind } from './vehicles/vehicle';
import { HEAD_TO_EYE, SEATED_EYE_FALLBACK, SEAT_RULE, cockpitYawStep, frameFileName, mirroredOffset, seatDropUsed } from './vehicles/cockpitSeat';
import { World } from './world/world';
import { worldNav } from './world/nav/nav.ts';
import { outdoorNav } from './world/nav/outdoorNav.ts';
// The long walk: its numbers and its knob. The order itself is `NpcManager.send`; this file only
// has to turn a place name or a pair of coordinates into a point, because the world's own named
// places are the App's (`placesHere`) and nothing under `src/world/` can see them.
import { ERRAND_TUNE, tuneErrand, type ErrandTune } from './world/errand.ts';
// Cover: the one shared searcher and its numbers, the ladder's three cover columns and the brain's
// own reach for a blocked shot. `__debug.cover()` is the only way any of it can be read from a tab
// that draws no frames; the knob itself is also on `__debug.fighters({ cover: Ã¢â‚¬Â¦ })`.
import { coverSearch, tuneCover } from './world/cover.ts';
import { GROUND_SKILL } from './world/groundSkill.ts';
import { GROUND_STEP } from './world/groundStep.ts';
import { BRAIN_TUNE } from './world/mobiles/brain.ts';
import { tuneAfloat } from './world/afloat.ts';
import type { FacilityChoice, NamedPlace } from './world/cloning.ts';
import { GATE_TUNE, ZoneGates, gateAction, gateSaid, tuneGates, zoneOfPack } from './world/zoneGates.ts';
import { AudioSystem, type ListenerPose } from './audio/audio.ts';
import { OUTSIDE, type SoundSpace } from './audio/distance.ts';
import type { AmbienceTune } from './audio/ambience.ts';
import type { WorldSourceTune } from './audio/emitters.ts';
import { BodySounds, type BodyLists, type FootTune, type PlayerBody } from './audio/footsteps.ts';
import { combatSounds, GENERIC_GUN, type CombatTables, type CombatTune } from './audio/combatSounds.ts';
import { vehicleSounds, type SoundVehicle, type VehicleTables, type VehicleTune } from './audio/vehicleSounds.ts';
import { sabers } from './audio/saberSounds.ts';
import { CLIP_EVENT_TUNE, type ClipEventTune } from './audio/clipEvents.ts';
import { FAMILY_TUNE } from './world/terrain';
import { RoomAir, type RoomAirDebugOptions, type RoomAirInput } from './world/roomAir';
import { UnderwaterSpecksPass, type UnderwaterSpeckDebugOptions } from './world/underwaterSpecks.ts';
import type { LavaHarmTune } from './world/lavaHarmMath.ts';
import type { SeaFeedTune } from './world/seaFeed.ts';
import type { PlayerBurnTune } from './combat/burnMath.ts';
import type { BreathTune } from './player/breathMath.ts';
import { FLORA_CLEAR } from './world/floraClear.ts';
import type { LavaSinkTune } from './player/lavaSinkMath.ts';
import { configureWaterSim, pokeWaterSim, waterSimDebug, WATER_SIM_DRAFT, WATER_SIM_IMPACT, WATER_SIM_SPEED } from './world/waterSim';
import { setWaterSurface, WATER_SURFACE_BAND, WATER_SURFACE_HIDE } from './world/water';
import type { WaterSurfaceTune } from './world/waterSurfaceMath.ts';
import { RANGE } from './world/gallery';
import { castsShadow, surfaces } from './world/surfaces';
import { compilerVerdict, groupPrograms, loadingLine, machineAside, measureCompiler, ProgramWatch, readKey, SHADER_TUNE, verdictLine, type ProgramPhase, type ProgramRow } from './core/shaderWatch.ts';
import { census as programFamilies } from './core/fx/programCensus.ts';

/** The keys for the vehicle ridden, by its kind. */
function mountPrompt(v: import('./vehicles/vehicle').Vehicle, wingsKey: string = WINGS_KEY): string {
  const k = v.spec.kind;
  const bar = (f: number) => 'Ã¢â€“Â®'.repeat(Math.round(f * 8)) + 'Ã¢â€“Â¯'.repeat(8 - Math.round(f * 8));
  const boost = v.spec.boost === 'heat' ? ` Ã‚Â· <b>Shift</b> boost Ã‚Â· heat ${bar(v.meter)}${v.overheated > 0 ? ' BURNT OUT' : ''}` : v.spec.boost === 'burst' ? ` Ã‚Â· <b>Shift</b> boost ${bar(v.meter)}` : '';
  const hop = v.spec.hop ? ' Ã‚Â· <b>Space</b> hop' : '';
  const fly = v.spec.fly ? ' Ã‚Â· look up/down or <b>Space</b>/<b>X</b> to climb and sink' : '';
  if (k === 'ship') {
    // Down on the ground: what gets it up again, and why a put-down was refused.
    if (v.landed) return `${v.space ? 'set down Ã‚Â· <b>W</b> lifts off along the surface' : 'landed Ã‚Â· <b>W</b> or <b>Space</b> lifts off'} Ã‚Â· <b>E</b> leave${v.space ? ' (the boots take hold of what it stands on)' : ''}${v.landNote ? ` Ã‚Â· ${v.landNote}` : ''}`;
    if (v.holding) return 'setting downÃ¢â‚¬Â¦';
    // Hovering, the ship is a VTOL: it holds still until the throttle opens, rises and sinks on the keys, slides sideways. In flight the mouse flies it.
    const down = SHIP_GROUND.rule === 'landing' ? ` Ã‚Â· <b>Ctrl</b> brings it down, held at the bottom to set it down Ã‚Â· <b>${keyName(CUT_ENGINES_KEY)}</b> cuts the engines` : '';
    // Out in space there is no ground: the same key sets the hull down on whatever it has come to a stop over.
    const setDown = v.space && SHIP_GROUND.rule === 'landing' ? (v.setDownNear ? ` Ã‚Â· <b>${keyName(CUT_ENGINES_KEY)}</b> sets it down on what is under you` : Math.abs(v.speed) <= SPACE_LANDING.speed ? ' Ã‚Â· nothing under it to set down on' : '') : '';
    const hover = `<b>W</b> throttle up into flight Ã‚Â· mouse turns Ã‚Â· <b>Space</b>/<b>Ctrl</b> rise and sink Ã‚Â· <b>A/D</b> slide${v.space ? setDown : down}`;
    // Stopped in the air the ship holds its height, so the way down belongs on the flight line too.
    const flight = `<b>W</b>/<b>S</b> throttle up and down Ã‚Â· mouse: in the circle aims the guns, out of it keeps turning the ship Ã‚Â· <b>A/D</b> roll Ã‚Â· <b>Space</b>/<b>X</b> pitch${v.powered ? '' : ' Ã‚Â· <b>ENGINES CUT</b>'}${v.space ? setDown : Math.abs(v.speed) < 2 ? down : ''}`;
    // A ship whose wings open: the wings key and which way a press would take the pilot's choice; an open chosen while a
    // low wing waits for room says so.
    const wings = v.wings.length ? ` Ã‚Â· <b>${keyName(wingsKey)}</b> ${v.wings.chosen ? 'close' : 'open'} the wings${v.wings.pilot && !v.wings.target ? ' (they open with room under them)' : ''}` : '';
    return `<b>E</b> leave Ã‚Â· ${v.airborne ? flight : hover} Ã‚Â· <b>wheel</b> zoom, all the way in for the cockpit Ã‚Â· <b>Alt</b> look around${v.guns.length ? ' Ã‚Â· <b>click</b> fires Ã‚Â· <b>Tab</b> next target' : ''}${wings} Ã‚Â· <b>Shift</b> burn Ã‚Â· ${v.airborne ? 'flying' : 'hovering'} Ã‚Â· ${Math.round(Math.abs(v.speed) * 3.6)} km/h${v.hp < v.maxHp ? ` Ã‚Â· hull ${Math.round((v.hp / v.maxHp) * 100)}%` : ''}${v.landNote ? ` Ã‚Â· ${v.landNote}` : ''}`;
  }
  const turn = k === 'ground' ? 'mouse or <b>A/D</b> turn' : 'mouse or <b>A/D</b> steer';
  const hull = v.hp < v.maxHp ? ` Ã‚Â· hull ${Math.round((v.hp / v.maxHp) * 100)}%${v.hp / v.maxHp < 0.34 ? ' LIMPING' : v.hp / v.maxHp < 0.67 ? ' smoking' : ''}` : '';
  return `<b>E</b> dismount Ã‚Â· <b>W/S</b> throttle Ã‚Â· ${turn} Ã‚Â· <b>Alt</b> look around${boost}${hop}${fly} Ã‚Â· ${k} Ã‚Â· ${Math.round(Math.abs(v.speed) * 3.6)} km/h${hull}`;
}

const MOUNT_RANGE = 3.6;
type InventoryTab = 'backpack' | 'wardrobe' | 'appearance' | 'weapons' | 'force';
/**
 * What `__debug.send` takes beside a destination: which body walks, the walk whose rows to print,
 * calling the orders off, and the account's own invented numbers. It may be given as the first
 * argument on its own (`__debug.send({ stop: true })`), or after a destination.
 */
interface SendOpts {
  /** Which fighter, by its place in `__debug.fighters()`; the nearest to you by default. */
  fighter?: number;
  /** Call every running order off. */
  stop?: boolean;
  /** Print a walk's one-second rows for `console.table`: which walk, or `true` for the first. */
  track?: number | boolean;
  /** Move the account's invented numbers (`ERRAND_TUNE`); the two that are the game's own are refused. */
  tune?: Partial<ErrandTune>;
}
/** The camera pitch a flyer holds its height at: the default view, a little above level. */
const CAMERA_REST_PITCH = 0.32;

/**
 * The two readings the display's flight struct needs that no file of the game's carries. Both are
 * invented, both are kept here together, and both are live through `__debug.hud({ wiring: { ... } })`.
 *
 * `gunBits` is how many gun slots can be marked down at once: the struct carries them as a bitfield
 * and a bitwise operand is 32 bits wide, so 32 is the ceiling rather than a judgement (no hull in
 * the archives fits more than eight). `heatIsHeadroom` is a reading of a hull with no fight of its
 * own, whose single meter is either a burst that fills as it charges or a heat gauge that fills as
 * it overheats: true shows the heat gauge as the booster's headroom, so a full arc means "ready" on
 * both kinds. Flip it to see the gauge itself.
 *
 * `promptHz` and `nearbyHz` are the two rates this file gathers state at instead of every frame,
 * and both are invented. Eight times a second is fast enough that walking up to a vehicle changes
 * the bar before the hand reaches the key and slow enough that the asking Ã¢â‚¬â€ the lift underfoot, the
 * elevators near, the doorless building near, the nearest vehicle Ã¢â‚¬â€ costs an eighth of what it did;
 * four is the rate the corner line it feeds is written at anyway, so asking oftener could not show.
 * Raising either to sixty puts the old per-frame cost back, which is how to measure what they save.
 *
 * `hurtRange` is how far a blow may have come from and still draw an arc, in metres. A blow from
 * further off than this is taken as having no useful direction (a sniper across a valley points at a
 * pixel), and shows the red flash alone.
 */
const HUD_WIRING = { gunBits: 32, heatIsHeadroom: true, promptHz: 8, nearbyHz: 4, hurtRange: 400 };

/** Debug counters, readable from the console as window.__stats. */
const stats = { frameMs: 0, physicsMs: 0, renderMs: 0, rawDt: 0, grounded: false, vel: [0, 0, 0] as number[], calls: 0, triangles: 0, pack: '', terrain: '', chunks: 0 };
(window as unknown as { __stats: typeof stats }).__stats = stats;
const tmp = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const roomLightSpots: import('./vehicles/interior').RoomLight[] = [];
/** Handed to the feet where a manager has no list yet, so no frame makes an empty array of its own. */
const EMPTY_BODIES: readonly never[] = [];
/** Where a fighter's blade is heard swinging or striking; one kept record, refilled per event. */
const saberAt = { x: 0, y: 0, z: 0 };
/** Where a lift's own sound is heard: the stop the player was put at, in the world. */
const liftAt = new THREE.Vector3();
/** The fighters' glows the pool is asked for when the effects do not light the blades: the nearest two, within 25 m of the camera. */
const FIGHTER_GLOW_RANGE = 25;
const npcGlow: FighterGlow[] = [0, 1].map(() => ({ pos: new THREE.Vector3(), color: 0, d2: 0 }));
/** How near the controls in a ship's bridge E takes them, metres in the hull's frame. */
const CONTROLS_RANGE = 2.5;
/**
 * A ship's guns: seconds between shots of one gun, their damage, the bolt's speed (m/s) and range
 * (m) for a ship whose manifest names no weapon (the weapon table's light blaster), how far off
 * the nose a target may sit for the guns to lead it (rad), and how far off to be picked at all.
 */
const SHIP_GUN_INTERVAL = 0.55;
const SHIP_GUN_DAMAGE = 45;
const SHIP_BOLT_SPEED = 600;
const SHIP_BOLT_RANGE = 512;
const SHIP_GUN_CONE = THREE.MathUtils.degToRad(12);
const SHIP_TARGET_CONE = THREE.MathUtils.degToRad(70);
const SHIP_TARGET_RANGE = 2500;
/** How high over the ground a ship must climb to be offered space (the sky's ceiling is 1500 m), and how high it arrives back over the planet. */
const SPACE_GATE_HEIGHT = 1100;
const SPACE_ARRIVAL_HEIGHT = 700;
/** Where someone stood in a ship's rooms as it crossed between a planet and space: in the hull's frame, facing this way, at the controls or not. */
interface ShipCrew {
  local: THREE.Vector3;
  heading: number;
  piloting: boolean;
}
/** A ship carried across: spawned again over the arrival point at `height`, launched at `speed`, its crew put back. */
interface ShipCrossing {
  def: VehicleDef;
  speed: number;
  height: number;
  crew?: ShipCrew | null;
  /** Where the ship comes out and which way it faces (game frame), instead of over the spawn at heading Ãâ‚¬. */
  arrival?: { pos: THREE.Vector3; quaternion: THREE.Quaternion } | null;
  /** The ship's fight as it left (shields, armour, chassis, parts down, boost, as shares), put on the new hull once it is adopted; null or absent: whole. */
  condition?: import('./space/shipCombat').CarriedCondition | null;
}
const tmp2 = new THREE.Vector3();
/** Where a thrown blade is in the world, for the state that carries it; written once a message. */
const thrownAt = new THREE.Vector3();
/** Where the view looks, for the head that follows it; written once a frame and never made. */
const headLook = new THREE.Vector3();
/** Scratch for putting a walker out of a hull another player flies: where that hull is, and what it is doing. */
const goneAt = new THREE.Vector3();
const goneVel = new THREE.Vector3();
/**
 * Scratch for the look round the other players' hulls (which one is near enough to board, and where
 * one stands). Its own, because the action bar asks that every frame and the answer is read while the
 * pair above is still wanted.
 */
const peerAt = new THREE.Vector3();
const peerVel = new THREE.Vector3();
const peerTurn = new THREE.Quaternion();
/** Scratch for the gravity boots' look round for something to stand on: the ways looked and the best of them. */
const bootScratch = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => new THREE.Vector3());
const bootDir: THREE.Vector3[] = [];
const bootAt = new THREE.Vector3();
const bootPoint = new THREE.Vector3();
const bootUp = new THREE.Vector3();
let bootBody: import('@dimforge/rapier3d-compat').RigidBody | null = null;
const boltFrom = new THREE.Vector3();
/** A ship's shot: where it leaves and which way (bolts.fire and effects.flash copy what they are given). */
const shotFrom = new THREE.Vector3();
const shotDir = new THREE.Vector3();
/** A kept ship fit copied, so a change is made on the copy and handed to saveFit whole. */
function copyShipFit(f: ShipFit): ShipFit {
  return { components: { ...f.components }, paint: { ...f.paint }, ...(f.droid ? { droid: f.droid } : {}) };
}

class App {
  private torch!: THREE.SpotLight;
  private torchOn = false;
  private lastPrograms = 0;
  /**
   * Which shader programs the renderer holds, and which appeared on which frame. The renderer's own
   * `info.programs.length` is a net figure, so a frame that made one and dropped another reads as a
   * quiet one; the watch compares by program id instead, and can say what was made rather than only
   * how many. `__debug.shaders()` is the whole of it.
   */
  private readonly shaderWatch = new ProgramWatch();
  /** Said once a session, after the machine has been measured behind the first loading screen. */
  private shaderVerdictSaid = false;
  private readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  private readonly ui = document.getElementById('ui') as HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam: ThirdPersonCamera;
  private readonly input: Input;
  private readonly world: World;
  private readonly player: Player;
  private readonly effects: Effects;
  /** The marks the world keeps: a blade's burn, a bolt's scar, a foot's print. One set for the page. */
  private readonly marks = marks;
  /** Scratch for the prints the feet lay: a foot landing allocates nothing. */
  private readonly printAt = { x: 0, y: 0, z: 0 };
  private readonly printAlong = { x: 0, y: 0, z: 0 };
  private readonly printUp = { x: 0, y: 1, z: 0 };
  private readonly printOpts: MarkPlace = { along: null, mirror: false, aspect: 1, owner: MARK_WORLD };
  private readonly bladeSegments = [0, 1, 2].map(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3() }));
  private readonly markPoint = new THREE.Vector3();
  private readonly markNormal = new THREE.Vector3();
  /** Console: give the blades their pooled flash lights back while the glow pass is on, to compare. */
  private bladeGlowFlashes = false;
  /** __debug.fpHead(true/false) holds the head hidden or shown whatever the camera; null follows it. */
  private fpHeadForce: boolean | null = null;
  private kit!: Kit;
  private readonly hud: Hud;
  private readonly map: MapUi;
  private readonly wardrobe: WardrobeUi;
  private readonly weaponsUi: WeaponsUi;
  private readonly forceUi: ForceUi;
  private readonly vehiclesUi: VehiclesUi;
  /** A ship's edit page, opened from the garage's edit button (components, droid and paint). */
  private readonly shipEdit: ShipEditUi;
  /** The garage as it loads, so the panel, the edit page and the console share one load. */
  private garageLoading: Promise<Garage> | null = null;
  /** The ship whose fit the last hello carried ('' none): a change of ship sends the hello again. */
  private helloShipId = '';
  /** Garage ids being prepared for a spawn: a second press waits for the first. */
  private readonly spawning = new Set<string>();
  /** The debounced write of the ships' fits (the edit page saves on every change). */
  private fitSaveTimer = 0;
  /** Each spawned ship's refit in flight: the next waits for it, so two never stage from the same fit. */
  private readonly refitting = new Map<Vehicle, Promise<unknown>>();
  private garage: Garage | null = null;
  private npcUi: NpcUi;
  private appearanceUi: AppearanceUi;
  private characterId = 'human_male';
  private speciesList: SpeciesEntry[] = [];
  private breakFrames = false;
  private inventoryTab: InventoryTab = 'backpack';
  /** What the character owns, wears and holds, and the one way anything goes on or in hand (the backpack, the give tabs, the console). */
  private readonly equipment: Equipment;
  /** The backpack panel, the inventory's first tab. */
  private readonly backpack: BackpackUi;
  /**
   * Where an item given or destroyed here is told to the server's ledger. The trade wiring sets it
   * when there is a server to tell; until then, and for ever in a game played alone, it is null and
   * the backpack is local storage exactly as it always was.
   */
  private tradeLedger: ((what: 'add' | 'drop', kind: 'wear' | 'weapon', id: string) => void) | null = null;
  /** Where "this is what I am wearing and holding" goes, for the same reason and by the same wiring. */
  private tradeUsing: (() => void) | null = null;
  /** Where the group roster's Trade button goes; the trade wiring fills it in. */
  private tradeAsk: ((id: number, name: string) => string) | null = null;
  /** The weapons rack as it loads (null when none is converted); the equipment waits on it. */
  private weaponsLoaded!: Promise<WeaponCatalogue | null>;
  /** The hello resend after a change of clothes or weapon, debounced so several pieces send one. */
  private helloTimer = 0;
  private spawnerTab: 'garage' | 'npcs' = 'garage';
  private weapons: WeaponCatalogue | null = null;
  private readonly fade: HTMLElement;
  private readonly death: HTMLElement;
  /** The line over the death card's list of facilities, shown only while there is a list. */
  private readonly deathHint: HTMLElement;
  /** The death card's list of facilities: filled on the death and emptied on the way out. */
  private readonly deathList: HTMLElement;
  private readonly select: CharacterSelect;
  private readonly creatorBar: CreatorBar;
  private readonly menu: Menu;
  private readonly shipMenu: ShipMenu;
  /**
   * Docking at a station: the lane asked for from the ship menu, flown by its own autopilot. Made in
   * the constructor beside the menu it belongs to, since the world it reads is made there first.
   */
  private readonly docking: Docking;
  /**
   * The ultra cruise, for the ship menu's own row. Whatever owns the cruise sets it; until something
   * does, the row says the cruise is not built.
   */
  cruiseControl: ShipCruise | null = null;
  /** The ultra cruise itself: a straight run at kilometres a second, only where a system is big enough for one. */
  private readonly ultraCruise: Cruise;
  /** The System Map (the destinations of a jump) and the countdown line. */
  private readonly hyperspaceUi: HyperspaceUi;
  /** The jump: its countdown, its phases, and the hull it flies. */
  private readonly hyperspace: Hyperspace;
  /** The tunnel the jump flies through (one mesh for the session, in the scene hidden). */
  private readonly jumpTunnel: HyperspaceTunnel;
  /** The hull whose rooms the player stood in as the jump began: kept aboard it until the jump ends. */
  private jumpCrew: Vehicle | null = null;
  /** The zoom the pilot had before the jump's view took it (put back after), and the camera's far plane while the tunnel hides the world. */
  private jumpZoomKept: number | null = null;
  private jumpFarKept: number | null = null;
  private jumpTunnelFar = 0;
  /** Every space zone's pack and destinations, fetched on the first opening of the System Map (or the first `__debug.jumps`). */
  private hyperspaceCatalogue: Promise<HyperspaceCatalogue> | null = null;
  /** The same catalogue once it has arrived, for the jump's own reads (null until then). */
  private loadedCatalogue: HyperspaceCatalogue | null = null;
  private readonly liftMenu: LiftMenu;
  private readonly loadingScreen: LoadingScreen;
  private readonly emoteWheel: EmoteWheel;
  /** Playing together: the relay's client and the other players it tells of. */
  private readonly net = new Net();
  private readonly remotes: RemotePlayers;
  /** Going where the group goes: what a leader's trip means here, and where to come out to be beside them. */
  private readonly together = new TravelTogether();
  private netStatus = 'off';
  private lastStateSent = 0;
  /** The wheel's eight slots, clip names; filled from the rig's own emotes the first time. */
  private emotes: (string | null)[] = loadEmotes();
  /** An emote is playing on the player: any movement ends it. */
  private emoting = false;
  /** The dance loop playing, kept so a flourish (the number keys) goes back to it when it ends. */
  private dance: string | null = null;
  /** The ship the pilot's guns lead (Tab cycles the ships ahead), and this frame's lead point and the way to aim for it. */
  private shipTarget: Vehicle | null = null;
  private readonly shipLead = new THREE.Vector3();
  private readonly shipAim = new THREE.Vector3();
  private shipLeadValid = false;
  /**
   * Mouse flight (space/mouseFlight.ts): the cursor the mouse moves under pointer lock, in half-heights from the hull's
   * boresight, which stays where it is left; the stick it asks for; the flown hull it was started for (another hull, the
   * ground or a loose pointer puts it back in the middle).
   */
  private readonly flightCursor: Cursor = { x: 0, y: 0 };
  private readonly flightStick: FlightStick = { x: 0, y: 0, turn: 0 };
  private flightCursorOf: Vehicle | null = null;
  /** The guns aim through the cursor this frame (a ship in flight, the pointer locked, Alt not held). */
  private flightAiming = false;
  /**
   * This frame's aim: the cursor kept to the circle, the pilot's eye it is measured from (world), the ray through it about
   * the hull's nose (world), the nose, how far out the guns cross, and whether it sits on the target's lead.
   */
  private readonly flightAimCursor: Cursor = { x: 0, y: 0 };
  private readonly flightEye = new THREE.Vector3();
  private readonly flightRay = new THREE.Vector3();
  private readonly flightNose = new THREE.Vector3();
  private flightRange = 0;
  private flightOnLead = false;
  /** What the HUD's flight display is handed, kept and refilled; and its scratch for projecting the boresight and the cursor. */
  private readonly flightView: FlightView = newFlightView();
  private readonly flightShow = new THREE.Vector3();
  private readonly flightShowEye = new THREE.Vector3();
  /** Whether the ship targeted is one that attacks the pilot, as the target effects were last told (they change on a change). */
  private shipTargetHostile = false;
  /** The target block handed over every frame, refilled in place, and the ship its two strings were joined for. */
  private readonly targetView: TargetView = newTargetView();
  private targetWordsOf: Vehicle | null = null;
  /** The game's targeting effects on the ship targeted. Made right after the world, whose ship effects it places. */
  private readonly targetFx: TargetFx;
  /** The NPC pilots' comms and the flown ship's condition. Made right after the HUD. */
  private readonly shipHud: ShipHud;
  /** The picture's effects chain, while the Effects setting is on. */
  private postfx: PostFX | null = null;
  /**
   * What gives off heat for the heat haze: the planet's lava tables (World hands them over) and the
   * plume providers. A field initialiser, so it exists before the constructor builds the effects chain.
   */
  private readonly heat = new HeatSources();
  /** The lit blades handed to the effects each frame (declared before fxInput, whose initialiser reads it). */
  private readonly fxBlades = createBladeList();
  /** The frame's lights handed to the effects, refilled in drawFrame (declared before fxInput, whose initialiser reads it). */
  private readonly fxLights = createFxLights();
  /** What the blades' light ceiling reads, kept and refilled each frame; the world and the pool are set in the constructor. */
  private readonly litSources: LitSources = { world: null!, effects: null!, torch: null, eye: new THREE.Vector3() };
  /** What the effects are told about each frame, refilled in drawFrame rather than made again. */
  private readonly fxInput: FxFrameInput = { camera: null as unknown as THREE.PerspectiveCamera, dt: 1 / 60, sun: null, portalView: false, cameraInHull: false, inside: false, aboard: false, space: false, fog: null, daylight: 1, dayIndex: 0, lighting: null, planetId: '', aiming: false, aimAmount: 0, firstPerson: false, orbitDistance: 0, skyLights: createSkyLights(MAX_FLARE_SOURCES), skyLightCount: 0, clouds: createCloudLayers(MAX_CLOUD_LAYERS), cloudCount: 0, cameraUnderwater: false, cameraSubmerged: false, underwaterDepth: 0, underwaterColor: new THREE.Color(0x2e7fbb), underwaterOpacity: 0.75, underwaterReach: 0, waterInView: false, blades: this.fxBlades, lights: this.fxLights, room: null, followFar: 0, weather: null };
  private readonly fxSun: SunInfo = { dir: new THREE.Vector3(), color: new THREE.Color(), intensity: 0 };
  /**
   * Each world's measured sky, kept for the session once it has been fetched (a few hundred bytes,
   * and a travel usually returns to a world already measured). A key with a null value is one whose
   * fetch is in flight or whose pack was converted before the `clouds` command existed.
   */
  private readonly cloudPacks = new Map<string, CloudPack | null>();
  /** The noise volumes, which are the same on every world: asked for once and shared by every chain. */
  private cloudVolumes: Awaited<ReturnType<typeof loadCloudVolumes>> = null;
  private cloudVolumesAsked = false;
  /** What the console is overriding the world's own sky with, so a clear world can be flown under an overcast. */
  private readonly cloudForce: { coverage: number | null; brightness: number | null; drift: number | null } = { coverage: null, brightness: null, drift: null };
  /** What the debug mask draws: the player and whatever they ride or are aboard. */
  private readonly fxMaskObjects: THREE.Object3D[] = [];
  /** Work going on in the background: the Effects switch compiling every shader for the other path. */
  private readonly notice = new Notice(this.ui);
  /**
   * Everything the game says once, bottom left, held long enough to be read. Until now these went to
   * the prompt, which the frame loop rewrites from outside every guard, so each of them lived one
   * frame. A field initialiser, because the panels built in the constructor already say things.
   */
  private readonly messages = new MessageLine(this.ui);
  /**
   * The group down the side of the display. A field initialiser beside the message line, so it
   * exists before anything in the constructor could ask for it; until the group wiring gives it
   * somewhere to read the group from it pulls nothing, and with no group it stands down.
   */
  private readonly roster = new Roster(this.ui);
  /**
   * The line keeps a lifetime count of its DOM writes; the other two displays report a rate. These
   * sample it once a second into the same unit, so `__debug.hud().lineWrites.lastSecond` can be read
   * beside them and a line's fade can be told from a session's history.
   */
  private lineWriteMark = 0;
  private lineWriteWindow = 0;
  private lineWritesLast = 0;
  /**
   * The overlay the display's shapes are drawn on, over the picture and under every panel. A plain 2D
   * canvas: it touches no WebGL context, so nothing compiles because of it.
   */
  private readonly overlay = new HudCanvas(this.ui);
  /**
   * The short bar of things you can press here, bottom centre. A field initialiser beside the
   * message line, so it exists before anything in the constructor could ask for it.
   */
  private readonly actions = new ActionBar(this.ui);
  /**
   * Where the player is standing, as the bar's rules want it: one struct, filled in place a few
   * times a second and never rebuilt. `promptClock` counts down to the next fill and `promptLive`
   * is what the bar was last told, so a frame that stops simulating empties it once rather than
   * waiting for the next fill (a bar of things you cannot press over the death card is the fault).
   */
  private readonly promptState: PromptState = newPromptState();
  private promptClock = 0;
  private promptLive = false;
  /**
   * The arc on the side a blow came from, the tick on the crosshair when one of your shots tells,
   * and the rising numbers. Its shapes go on the same overlay; its words go to the message line.
   */
  private readonly feedback = new HudFeedback(this.ui);
  /** The name and health of whatever the crosshair rests on, over its head; the corner's "nearby" gone. */
  private readonly plates = new Nameplates(this.ui);
  /** Where the crosshair is cast from and where it points: two kept vectors, refilled each frame. */
  private readonly plateEye = new THREE.Vector3();
  private readonly plateDir = new THREE.Vector3();
  /** Where a world point lands on the screen, for the rising numbers: filled in place, never new. */
  private readonly feedbackPoint = new THREE.Vector3();
  /**
   * Where the blow being dealt to the player right now came from, held for the length of one call.
   * It is set by the wrapper in the constructor and read by the frame loop's damage closure as the
   * second source: the player's own record hands the direction to its callback itself, and this
   * catches anything that reaches the record by a path that does not.
   */
  private hurtSource: THREE.Vector3 | null = null;
  /** The nearest living thing's name, found at `HUD_WIRING.nearbyHz` rather than on the frame path. */
  private nearbyName = '';
  private nearbyClock = 0;
  /**
   * The two words the long prompt line needs that the bar's own state has no room for: how many
   * levels the lift underfoot has, and what the building with no way in on foot is called. Gathered
   * with the rest, so the long line asks the world for nothing at all on the frame path.
   */
  private promptLiftStops = 0;
  private promptDoorless = '';
  /**
   * The gates this world's zones are walked between, pointed at the pack by `arrive` and by the
   * jump's own crossing, and the clock that keeps a fight out of them. A world with no gates.json
   * Ã¢â‚¬â€ which is every world but one, and every pack converted before the join was written Ã¢â‚¬â€ has no
   * gates and everything below answers "no gate".
   */
  private readonly zoneGates = new ZoneGates();
  /** Where the gate you are standing at leads, in full, for the long line; empty where there is none. */
  private promptGate = '';
  /** Where every piece of the display sits, refilled on a resize or a change of scale and never in a frame. */
  private readonly hudLayout: HudLayout = makeLayout();
  private fxQueued = false;
  private fxBusy = false;
  private fxAgain = false;
  /** The ship last flown, spawned again on arriving in space (or back from it). */
  private lastShipDef: VehicleDef | null = null;
  /** The way between a planet and its space, offered on E: up near the top of the sky, down anywhere in space. */
  private spaceGate: 'up' | 'down' | null = null;
  private readonly settings: Settings = loadSettings();
  /**
   * The mixer. Declared after `settings`, whose value its constructor reads, and assigned at the
   * top of the constructor so anything made later can ask it to play. Its context is made
   * suspended and unlocked on the first press, as browsers require.
   */
  private readonly audio: AudioSystem;
  /**
   * Feet and voices: what every body's own animation marks, what it is standing on, and the sounds
   * its client data gives it. Made with the mixer and handed the world's surfaces once there is a
   * world; it reads the lists below and nothing in the world knows it exists.
   */
  private readonly feet: BodySounds;
  /** The player as the feet see it, refilled each frame rather than made. */
  private readonly footPlayer: PlayerBody = {
    x: 0,
    y: 0,
    z: 0,
    inside: false,
    deck: null,
    space: null,
    dead: false,
    species: '',
    activeClips: (out) => this.player.rig?.activeClips(out) ?? 0,
  };
  /** The three lists handed over each frame; the arrays are the managers' own. */
  private readonly footBodies: BodyLists = { player: null, mobiles: [], fighters: [] };
  /** The planet the feet were last told about, so a travel hands them the new one. */
  private feetPack = '';
  /** The bank's own tables the feet were last given, so the surface table is handed over once. */
  private feetTables: object | null = null;
  /** The listener handed to the mixer each frame, refilled rather than made. */
  private readonly listenerPose: ListenerPose = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, space: { building: OUTSIDE.building, cell: OUTSIDE.cell } };
  private readonly listenerDir = new THREE.Vector3();
  private readonly listenerUp = new THREE.Vector3();
  /** The character being played, as kept in this browser; null on the select screen and in the creator. */
  private current: SavedCharacter | null = null;
  /** The creator is up: the appearance and wardrobe panels at full size over no world at all. */
  private creating = false;
  /**
   * The captured place a character is being stood in, or null for the plain doll on a dark stage.
   *
   * While this is set the frame loop takes a short path of its own (`stepScene`): the world draws,
   * the sky runs, the weather blows and the figure breathes, and none of the rest of being alive
   * happens. It is deliberately **not** `inWorld`, which some twenty places read to mean "the
   * player is somewhere" -- the pointer lock, Escape, every panel's `canOpen`, `savePlace`, the
   * class record. Borrowing that flag would have changed all of them at once.
   */
  private scene3d: { key: string; built: BuiltPlace; stand: THREE.Vector3; facing: number; orbit: { yaw: number; pitch: number; distance: number }; view: SceneView } | null = null;
  /** A planet is loaded and the loop runs the world; false on the select screen and in the creator, where nothing streams. */
  private inWorld = false;
  private lastPlaceSave = 0;
  private readonly timer = new THREE.Timer();
  private started = false;
  private traveling = false;
  private dying = false;
  /** The last frame's length, for the effects that smear by how far the camera moved in it. */
  private lastDt = 1 / 60;
  private spawn = new THREE.Vector3();
  /**
   * The world's own named places, read once when a world loads off the very list the map reads, so
   * that the death card can call a facility by the town it stands in. Empty until it lands, and
   * empty for a world whose pack has no list, which costs the rows their names and nothing else.
   */
  private placeNames: Poi[] = [];
  /** Which pack `placeNames` was read for: a travel's own read is the one that counts. */
  private placeNamesFor = '';
  /** The map's own place loader, captured from the galaxy tab so nothing here has to open the map. */
  private poisOf: (packId: string) => Promise<Poi[]> = async () => [];
  /** The facilities the death card is offering just now, in the order its rows stand. */
  private deathChoices: FacilityChoice[] = [];
  /** Animation mixers of models shown through the debug hook. */
  private readonly shown: THREE.AnimationMixer[] = [];
  private readonly portals: PortalRenderer;
  /** The air of the room the camera is in (daylight through its doorways, its lamps' glow, dust motes), and what it is told each frame. */
  private readonly roomAir: RoomAir;
  private readonly roomAirInput: RoomAirInput;
  private readonly roomAirBuffer = new THREE.Vector2();
  /** The eye in the world, for the camera's building choice each frame (nothing cloned per frame). */
  private readonly cameraEye = new THREE.Vector3();

  constructor(private readonly physics: Physics) {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: true });
    // ?lowfx=1 is the cheap preset for this session; otherwise the settings kept in this browser.
    const lowfx = new URLSearchParams(location.search).get('lowfx') === '1';
    if (lowfx) Object.assign(this.settings, { renderScale: 0.5, shadows: false, effects: false });
    const S = this.settings;
    // The mixer first, so everything built after it can ask for a sound. Its context is made
    // suspended: the browser lets nothing sound until the first press, which the unlock below
    // catches. Until then the beds keep their own clocks and come in where they have reached.
    this.audio = new AudioSystem(import.meta.env.BASE_URL, S);
    this.audio.install();
    // The clip events and every body's client data, fetched once and never awaited: until they
    // land nothing has feet, which is what a game with no sound pack does anyway.
    this.feet = new BodySounds(this.audio, import.meta.env.BASE_URL);
    this.feet.load();
    // The guns. Every place a bolt is fired reaches this through the module it lives in, so a shot
    // deep in a creature's brain or a turret's aim needs no mixer of its own to be heard.
    combatSounds.attach(this.audio, import.meta.env.BASE_URL);
    // The machines. A hull struck, a hull blown up and a hull in hyperspace are three different
    // systems away from here, so they reach the same module rather than carrying a mixer down.
    vehicleSounds.attach(this.audio, import.meta.env.BASE_URL);
    this.renderer.setPixelRatio(S.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = S.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    World.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.renderer.toneMappingExposure = S.exposure;

    this.cam = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.cam.sensitivity = S.sensitivity;
    this.cam.invertY = S.invertY;
    this.cam.baseFov = S.fov;
    this.cam.camera.fov = S.fov;
    this.cam.camera.updateProjectionMatrix();
    this.input = new Input(this.canvas);
    this.world = new World(this.scene, physics);
    // The target effects place the world's ship effects (made in the World constructor).
    this.targetFx = new TargetFx(this.world.shipFx);
    this.world.renderer = this.renderer;
    // The sound of the place: the area's beds, the game's placed sound objects and the loops its
    // particle effects name. The numbering of buildings and boarded hulls is this class's, so that a
    // sound and the ear agree on what counts as the same room.
    this.world.attachAudio(this.audio, (of) => this.spaceIdOf(of));
    // Where the feet ask what they have landed on: the water, the room, the thing stood on and the
    // ground, all of which only the world can say.
    this.feet.attachWorld(this.world.footSurfaces);
    // A bolt asks the same four questions of the world a foot does: what it struck is what a foot
    // landing there would have landed on.
    combatSounds.attachWorld(this.world.footSurfaces);
    // The blades: the mixer they play through, the clip events that say which frames of a move
    // whoosh (the feet already read them, so the same index is shared rather than fetched twice),
    // and the world, which is asked only what room the ear is in and whether it is raining on the
    // blade or the blade is under water.
    sabers.attach(this.audio, { clips: this.feet.index, world: this.world, baseUrl: import.meta.env.BASE_URL });
    // A fighter's blade is the sabers' to speak for: the guns hold the hook and the fighters ask
    // through it, so nothing in the world has to know what a lit blade sounds like.
    combatSounds.useSaber({
      swing: (style, x, y, z, clip) => {
        saberAt.x = x;
        saberAt.y = y;
        saberAt.z = z;
        sabers.swing(style, saberAt, clip ?? undefined);
      },
      contact: (kind, x, y, z) => {
        saberAt.x = x;
        saberAt.y = y;
        saberAt.z = z;
        sabers.contact(kind, saberAt);
      },
    });
    // The lava tables World loads go to the heat haze from here on.
    this.world.heat = this.heat;
    // Plumes the heat haze draws, asked for once a frame from inside the effects chain (after the
    // world is assigned, which the first provider reads): every running engine, and a flame thrower
    // held this frame.
    this.heat.addProvider((sink) => vehiclePlumes(this.world.vehicles, sink));
    this.heat.addProvider((sink) => {
      if (this.kit?.id === 'bounty_hunter') this.hunterKit().heatPlumes(sink, performance.now());
    });
    // Before any planet loads: every water body needs an environment of one size from the moment
    // it exists, or the first real sky map to arrive recompiles its shader mid-play.
    this.world.waterBodies.attach(this.renderer);
    // The effects chain is built only now: the water reflections pass is handed the world's water
    // bodies, so a chain made before the world exists throws on boot.
    if (S.effects) this.postfx = this.makePostFX();
    // The wardrobe and creator dolls take their lens from the same settings (a static, so no panel need exist yet).
    this.syncPreviewEffects();
    // Shaders are warmed for the target the frames are actually drawn into: with the effects on,
    // a program compiled with nothing bound is the wrong variant and is thrown away on first use.
    this.world.compileTarget = () => this.postfx?.compileTarget ?? null;
    // A vehicle (a spawn, a refit's parts, a ship's paint copies, a peer's ride) is prepared by the world
    // and then for the motion blur's variants (the skinned droid needs its own); postfx is read at call time.
    this.world.vehiclePrepare = async (roots) => {
      await this.world.prepareVehicle(roots);
      await this.postfx?.product<VelocityProduct>('velocity')?.prepareRoots(roots);
    };
    this.world.userFog = S.fog;
    this.world.normalScale.set(S.normalStrength, S.normalStrength);
    Character.normalScale.set(S.normalStrength, S.normalStrength);
    this.world.setShadowLook(S.shadowSoftness, undefined, S.shadowMapSize);
    this.world.setShadows(S.shadowDistance, S.shadowCasterRadius);
    this.world.setReach(S.objectReach, S.terrainRadius, S.farRadius);
    // The spawner's cap and the creatures' animation range, kept by the world for every planet's manager.
    this.world.setMobileDetail(S.mobileCap, S.mobileAnimRange);
    // The weather's settings (the world made it; the HUD, made below, shows its note from the loop).
    this.world.weather.configure(S);
    // A hand torch: a spot light carried at the camera, pointing where it looks. F toggles it.
    // Always in the scene and visible, turned up and down: a light that comes and goes changes the
    // light count, and that recompiles every shader in the world.
    this.torch = new THREE.SpotLight(0xfff1d6, 0, 70, 0.42, 0.45, 1.6);
    this.scene.add(this.torch, this.torch.target);
    this.portals = new PortalRenderer(this.renderer);
    // The cascades exist even with shadows off, so turning them on later in the menu needs no rebuild.
    this.world.attachCamera(this.cam.camera, true, this.portals);
    if (!S.shadows) this.world.setShadowsEnabled(false);
    this.player = new Player(this.scene, physics);
    this.effects = new Effects(this.scene);
    // The ships' muzzle and hit flashes borrow the pool from here on, without waiting for the weapons rack (which sets it again).
    this.world.npcDeps.effects = this.effects;
    // What a fighter's blade finds when it sweeps: the lookup the bolts are given, with the player's
    // own capsule answering for the player, who is in no manager's collider map. Without it no swing
    // can name what it touched, and every one of them falls back on the blow the timer used to land
    // (`__debug.blades().lookup` says so, and the first such swing says so in the console).
    this.world.npcDeps.hittableAt = (h) => (h === this.player.collider.handle ? this.world.playerTarget : this.world.hittableAt(h));
    // The room's air reads the world, the portal renderer and the player, all assigned above; its
    // motes join the scene now, hidden, so the loading screen's warm-up compiles them.
    this.roomAir = new RoomAir(this.scene, this.world, this.portals, this.settings);
    // The water's height field reads these each step, so the menu's knobs need no apply case.
    configureWaterSim(this.settings);
    this.roomAirInput = { dt: 0, camera: this.cam.camera, view: null, cell: null, aboard: null, cameraInHull: false, playerPos: this.player.pos, sun: null, overcast: 0, dust: 0, bufferHeight: 1 };
    this.litSources.world = this.world;
    this.litSources.effects = this.effects;
    this.scene.add(this.marks.group);
    // What lays the mark a bolt leaves where it stops (`src/combat/scars.ts`). The combat code has
    // no way to reach the marks system and no business knowing what builds a mark, so it asks
    // through a seam and this is the one line that fills it in. The marks system lives for the
    // session -- a world being left clears its ring rather than taking it down -- so it is
    // registered once here and never again.
    setScars(this.marks);
    // Where a foot lands leaves a print: the footprint listener works out where it goes, which way
    // round it is, how big it is and how long it lasts, and the marks system draws it as its own
    // kind. One closure, made once, and the record it is handed is read here and never held.
    footprints.sink = (m) => {
      this.printAt.x = m.x;
      this.printAt.y = m.y;
      this.printAt.z = m.z;
      // The heading, horizontal: `place` flattens it into the surface itself.
      this.printAlong.x = m.fx;
      this.printAlong.y = 0;
      this.printAlong.z = m.fz;
      // The ground's own slope, so the print lies in a dune's face rather than through it. Laid
      // flat, a print's toe is under the sand past about two and a half degrees: the lift is 6 mm
      // against a half-length of 140 mm, and a dune face is ten to twenty degrees.
      this.printUp.x = m.nx;
      this.printUp.y = m.ny;
      this.printUp.z = m.nz;
      this.printOpts.along = this.printAlong;
      this.printOpts.mirror = m.left;
      this.printOpts.aspect = m.length / m.width;
      // What it was laid on, so a print on a placed object goes down when that object streams out.
      // Null is the world itself, which is the marks system's own `MARK_WORLD` and is -1, not 0.
      this.printOpts.owner = m.owner === null ? MARK_WORLD : m.owner;
      this.marks.place('print', this.printAt, this.printUp, m.width, m.life, this.printOpts);
    };
    this.hud = new Hud(this.ui);
    // The crosshair, the charge ring and a slot's cooldown sweep are shapes and go on the overlay;
    // the keys on the slot caps and in the help block come from the bindings, read once here and
    // again whenever the Controls page moves one, so nothing reads them on the frame path.
    this.hud.attach(this.overlay, COL);
    this.hud.setInput(this.input);
    onBindingsChanged(hudBindingsChanged);
    // What is in each hand: the live object the player keeps, and the rack's own picture for an item.
    this.hud.setHandSource({ equipped: this.player.equipped, icon: (item) => (this.weapons ? this.weapons.iconUrl(item as WeaponDef) : null) });
    // The comms and the ship's status line; the world (assigned above) hands the taunts over.
    this.shipHud = new ShipHud(this.ui);
    // Its shapes go on the overlay, in the palette's own colours; its one-shot lines and the pilots'
    // taunts go to the message line, which is where everything that happens once is said.
    this.shipHud.attach(this.overlay, COL);
    this.shipHud.messages = (kind, text, colour) => this.sayShipLine(kind, text, colour);
    this.world.ships.onTaunt = (who, text, faction) => this.shipHud.say(who, text, FACTION_COLOR[faction]);
    // The damage feedback draws on the same overlay and says its lines on the same message line. Its
    // projector is the one piece of three it cannot own: a world point onto this frame's screen,
    // through one kept vector, so twelve rising numbers allocate nothing between them.
    this.feedback.attach(this.overlay, COL);
    this.feedback.messages = (kind, text, colour) => this.sayShipLine(kind, text, colour);
    this.feedback.setProjector((x, y, z, out) => this.projectToScreen(x, y, z, out));
    // Where a blow on the player came from. Every striker already passes it Ã¢â‚¬â€ a creature, a fighter,
    // a mobile and a bolt all call `damage(amount, from, push, source)` Ã¢â‚¬â€ and the record now hands it
    // on to its callback, so the closure below reads it directly. This wrapper caught it before that
    // and stays as the second source, because it costs nothing: the record is one object for the life
    // of the session, so this is a single wrapper and not a per-frame anything.
    const target = this.world.playerTarget;
    const innerDamage = target.damage.bind(target);
    target.damage = (amount: number, from?: THREE.Vector3): void => {
      this.hurtSource = from ?? null;
      // Put back whatever happens: a direction left standing would be worn by the next blow that
      // has none of its own, and a fall would flash with an arc on the side of whatever last shot.
      try {
        innerDamage(amount, from);
      } finally {
        this.hurtSource = null;
      }
    };
    // Every blow the player lands, whatever struck and whichever file called it: the world wraps each
    // living thing's own `damage` once as it joins the list, so this is one hook rather than a dozen.
    this.world.watchPlayerHits((hit, amount, killed) => this.landedHit(hit, amount, killed));
    // What the world says once, in words: standing in a flow, and stepping out of one. It goes to the
    // message line like every other one-shot notice and never to the prompt, which is rewritten every
    // frame from outside every guard. One line when a burn starts and one when it stops, never a
    // number per blow: the line merges a repeat within two seconds into a count, and a count that
    // climbed once a second would bury everything else the game says.
    this.world.onNote = (text) => this.messages.system(text);
    // The bar reads the keys you have bound straight out of the input, which the Controls page edits
    // in place: a rebind reaches the caps on the bar's next fill with nothing having to be told.
    this.actions.setBindings(this.input.bindings);
    // The wardrobe says what it refused in its own panel; the line it used to clear here was rewritten
    // by the frame loop before anyone could see either it or the clear, so there is nothing to clear.
    this.wardrobe = new WardrobeUi(this.ui, () => {});
    this.wardrobe.setBaseUrl(import.meta.env.BASE_URL);
    this.weaponsUi = new WeaponsUi(this.ui, (def, hand) => void this.equip(def, hand));
    // The equipment: its deps are closures read only when an operation runs (after the constructor); the
    // one value it holds is the player, assigned above.
    this.equipment = new Equipment({
      character: () => this.player.rig?.character ?? null,
      player: this.player,
      weaponsLoaded: () => this.weaponsLoaded ?? Promise.resolve(null),
      prepare: (root) => this.prepareRoot(root),
      record: () => (this.creating ? null : this.current),
      persist: (c) => {
        upsertCharacter(c);
      },
      changed: (what) => this.onEquipmentChanged(what),
      // An item this browser gave itself or destroyed goes to the server's ledger as well, so its
      // rows and this cache do not drift. It is set by the trade wiring and is null until then, and
      // with no server it stays quiet: a game played alone writes to local storage and nowhere else.
      ledger: (what, kind, id) => this.tradeLedger?.(what, kind, id),
      baseUrl: import.meta.env.BASE_URL,
    });
    // The Skills tab: the Force powers or the gadgets in the number slots, given to the class's kit and kept with the character.
    this.forceUi = new ForceUi(this.ui);
    // The backpack: a double-click uses an item, Destroy (twice) destroys it; its tabs swap the inventory's panels.
    this.backpack = new BackpackUi(this.ui);
    this.backpack.onTab = (id) => this.toggleInventory(id as InventoryTab);
    this.backpack.onUse = (key, hand) => void this.useItem(key, hand);
    this.backpack.onDestroy = (key) => void this.destroyItem(key);
    this.forceUi.loadout = [...DEFAULT_LOADOUT];
    this.forceUi.onChange = (loadout) => this.setSkills(this.kit.id, loadout);
    // A blade colour picked on the rack goes on the blades now and into the character's record.
    this.weaponsUi.onSaberColor = (hex) => {
      this.player.setSaberColor(hex);
      if (this.current && !this.creating) {
        this.current.saber = { color: hex };
        upsertCharacter(this.current);
      }
    };
    this.vehiclesUi = new VehiclesUi(this.ui, (def, kind) => void this.spawnVehicle(def, kind), () => this.world.removeVehicles(this.player.mounted ?? this.player.aboard?.vehicle ?? null));
    // The ship's edit page: DOM only here (its preview's WebGL context is made the first time it opens);
    // every dependency is an arrow read at click time, after the constructor.
    this.shipEdit = new ShipEditUi(this.ui, {
      garage: () => this.loadGarage(),
      saved: (id) => this.savedFit(id),
      save: (id, fit) => this.saveFit(id, fit),
      spawn: (def) => void this.spawnVehicle(def),
      closed: (def) => void this.refitSpawned(def),
      // The preview's compile of a garage material the world set up for its shadow cascades must not take the cascades' record from the world's program.
      keepShadows: (mats) => this.world.keepShadowRecords(mats),
    });
    // Each component's stats on the edit page (invented numbers, shipStats.ts); pure, read when the page draws.
    this.shipEdit.statsFor = (slot, c) => componentLine(slot, c);
    this.vehiclesUi.onEdit = (def) => this.openShipEdit(def);
    this.shipEdit.onTab = (id) => this.toggleSpawner(id as 'garage' | 'npcs');
    // A fit changed in the last 300 ms is written before the page goes.
    window.addEventListener('beforeunload', () => this.flushFits());
    // Docking reads the world only (its pack, what it places and what its dock effects play), and is
    // made before the menu that asks it for its row.
    this.docking = new Docking(this.world);
    this.shipMenu = new ShipMenu(
      this.ui,
      {
        status: () => this.shipStatus(),
        goToSpace: () => void this.goToSpace(),
        land: () => void this.landShip(),
        eject: () => void this.eject(),
        hyperspace: () => this.hyperspaceButton(),
        dock: () => this.dockButton(),
        board: () => this.boardButton(),
        cruise: () => this.cruiseControl?.toggle(),
      },
      () => keyName(this.input.bindings.ship[0] ?? ''),
    );
    this.shipMenu.onClose = () => this.toggleShipMenu();
    // Boarding: whoever makes a hull somebody else flies into a place to stand in tells this before it
    // takes one down, so a walker standing in it is put out into the world while its physics is still
    // there. Registered once for the page; with nobody building such rooms it is never called.
    onPeerHullGone((id) => this.peerHullGone(id));
    // And the other way: what this browser can make of another player's hull speaks its own language
    // -- pictures, peers and little Rapier worlds -- and boarding speaks in rooms and relay ids. This
    // is the one place the two meet, and nothing in it builds anything: it asks. Everything it reads
    // it reads at call time, so it is registered here, long before the peers themselves exist.
    {
      const rooms = this.world.remoteRooms();
      /** Which player's hull a room is, kept as each one is handed over. Weak: an entry goes with the room it names. */
      const whose = new WeakMap<WalkableRoom, number>();
      const note = (id: number, room: WalkableRoom | null | undefined): WalkableRoom | null => {
        if (room) whose.set(room, id);
        return room ?? null;
      };
      /** The hull whose rooms are being taken down at this instant, while that call is on the stack; 0 otherwise. */
      let leaving = 0;
      setPeerRooms({
        roomOf: (id) => note(id, rooms.roomOf(id)?.interior),
        idOf: (room) => (room ? whose.get(room) ?? 0 : 0),
        open: async (id) => note(id, (await rooms.board(id))?.interior),
        aboard: (id, yes) => {
          // Not back into a room that is in the middle of being taken down: that word is answered
          // there by hand, below, and saying it again from inside the call would re-enter a teardown
          // already on the stack.
          if (leaving === id && !yes) return;
          rooms.enter(id, yes);
        },
        close: (id) => {
          // Never under the walker. A room somebody is standing in is given back when they step out
          // of it, and freeing its physics world with a body in it is the one mistake here that is
          // not survivable.
          const room = this.player.aboard;
          if (room && whose.get(room) === id) return;
          rooms.enter(id, false);
          rooms.release(id);
        },
        why: (id) => this.peerHullWhy(id),
        nearest: (at, range) => this.nearestPeerHull(at, range),
        label: (id) => this.remotes.vehicleOf(id)?.label ?? 'ship',
        hullAt: (id, pos, vel) => (this.remotes.vehiclePose(id, pos, peerTurn, vel) ? this.remotes.vehicleOf(id)?.radius ?? 0 : 0),
      });
      // A room about to be freed with somebody in it. Once this has returned nobody is in it --
      // stepped out here, or never in it at all and the flag left over from a travel -- so it is
      // theirs to free rather than to cut loose and keep standing where the hull was.
      rooms.onMustLeave = (id, room) => {
        leaving = id;
        try {
          peerHullGone(id);
        } finally {
          leaving = 0;
          room.held = false;
        }
      };
      // Which picture each player's ride is, so boarding can tell a hull with rooms in it from a
      // speeder before it offers anything. One write per player per frame and nothing allocated.
      watchPeers({
        peerMoved: (p) => void this.peerHulls.set(p.id, p.ship),
        peerRemoved: (id) => void this.peerHulls.delete(id),
      });
    }
    // The System Map and the jump. What these read is assigned above: this.ui (a field initialiser),
    // this.input, this.world, this.cam, this.player, this.scene (a field initialiser, where the tunnel
    // goes); this.postfx may be null and is read with ?. at call time. Neither constructor calls anything
    // on the host, and the catalogue is fetched on the panel's first opening. Assigned here, anyPanelOpen
    // and closePanels (which read hyperspaceUi.open) are safe from now on.
    this.hyperspaceUi = new HyperspaceUi(this.ui, () => keyName(this.input.bindings.ship[0] ?? ''));
    this.hyperspaceUi.onClose = () => this.toggleShipMenu();
    this.hyperspaceUi.onJump = (d) => this.startJump(d);
    // The jump's tunnel, in the scene for the whole session and hidden: every loading screen's compile
    // (settle's compileAllAsync walks hidden objects too) builds its program, so no jump ever does.
    this.jumpTunnel = new HyperspaceTunnel();
    this.scene.add(this.jumpTunnel.mesh);
    this.hyperspace = new Hyperspace({
      zone: () => this.world.planet.id,
      ship: () => this.pilotedShip(),
      alive: (h) => this.world.vehicles.includes(h as Vehicle),
      catalogue: () => this.loadedCatalogue,
      packHere: () => this.world.spaceData,
      placeEffect: (file, local, frame) => this.world.placeZoneEffect(file, local, frame),
      removeEffect: (h) => this.world.removeZoneEffect(h),
      effects: () => this.world.hyperspaceEffects(),
      moveWorld: (to) => this.world.jumpTo(to),
      readyAround: (to, ms) => this.world.readyAround(to, ms),
      settleCarried: (to, envMs, ms) => this.world.settleCarried(to, envMs, ms),
      afterTeleport: (at) => {
        this.cam.release();
        this.postfx?.reset();
        this.spawn.copy(at);
      },
      crossZone: (zone, hull, pose) => this.carryAcross(zone, hull as Vehicle, pose),
      holdCrew: (hull) => {
        // Whoever stands in this hull's rooms as the jump begins is kept aboard until it ends.
        const v = hull as Vehicle | null;
        this.jumpCrew = v && this.player.aboard?.vehicle === v ? v : null;
      },
      keepCrew: () => this.keepJumpCrew(),
      prepareTunnel: () => {
        void this.world.prepareExtras([this.jumpTunnel.mesh]).catch((err) => console.warn('hyperspace: the tunnel could not be prepared', err));
      },
      programs: () => this.renderer.info.programs?.length ?? 0,
      tunnel: {
        attach: (hull) => {
          const back = jumpChaseBack(hull.radius);
          const size = tunnelSize(hull.radius, back, this.jumpTunnel.look);
          this.jumpTunnel.attach(hull.group, size);
          this.jumpTunnelFar = tunnelCameraFar(size, back, hull.radius);
        },
        set: (cover, opening, dt) => {
          this.jumpTunnel.set(cover, opening);
          this.jumpTunnel.step(dt);
        },
        detach: () => {
          this.jumpTunnel.detach();
          this.restoreJumpFar();
        },
      },
      closePanels: () => {
        const was = this.anyPanelOpen() || this.map.open;
        this.closePanels();
        this.map.hide();
        if (was && !this.menu.open) this.freeMouse(false);
      },
      ui: this.hyperspaceUi,
    });
    // The ultra cruise: a straight run at kilometres a second, in a system big enough to need one.
    // It reads the same things the jump does and writes nothing the jump writes, so the two can
    // never both have the hull: each asks whether the other is flying it before it starts.
    this.ultraCruise = new Cruise({
      zone: () => this.world.planet.id,
      packHere: () => this.world.spaceData,
      ship: () => this.pilotedShip(),
      alive: (h) => this.world.vehicles.includes(h as Vehicle),
      jumping: () => this.hyperspace.phase !== 'idle',
      // A jump only counting down has not touched the hull yet, and would not release it if it were
      // called off; from the enter phase on it holds and ghosts the hull itself.
      jumpHasHull: () => this.hyperspace.phase !== 'idle' && this.hyperspace.phase !== 'countdown',
      holdStream: (on) => {
        this.world.streamHold = on;
      },
      // The run's own notices: why it would not start, that it is running, why it stopped. Every one of
      // them was said once and gone the same frame before the message line existed.
      note: (text) => this.messages.system(plain(text)),
      readyAround: (at, ms) => this.world.readyAround(at, ms),
      effects: () => this.world.hyperspaceEffects(),
      placeEffect: (file, local, frame) => this.world.placeZoneEffect(file, local, frame),
      removeEffect: (h) => this.world.removeZoneEffect(h),
      programs: () => this.renderer.info.programs?.length ?? 0,
    });
    // The ship menu's own row, which the menu asks for by this shape.
    this.cruiseControl = this.ultraCruise;
    // The lift menu: E in a shaft lists its levels; a pick, or a number key, rides there.
    this.liftMenu = new LiftMenu(this.ui);
    this.liftMenu.onClose = () => {
      this.liftMenu.hide();
      this.freeMouse(false);
    };
    this.liftMenu.onPick = (i) => this.rideLift(i);
    this.npcUi = new NpcUi(this.ui);
    this.appearanceUi = new AppearanceUi(this.ui, () => this.saveAppearance());
    this.appearanceUi.onTab = (id) => this.toggleInventory(id as InventoryTab);
    // The tabs: a click on the other tab of a panel swaps to it, the key toggles whichever was last open.
    this.wardrobe.onTab = (id) => this.toggleInventory(id as InventoryTab);
    // The Clothes (give) tab dresses through the equipment: the game's slots, the compile before the
    // piece shows, and in the world the piece given. In the creator nothing is given (no record).
    this.wardrobe.onWear = (id) => this.equipment.wear(id, { give: true, force: true }).then((note) => !/cannot|not in|no wardrobe|single model|dropped|could not/.test(note));
    this.wardrobe.onRemove = (parts) => this.equipment.takeOffParts(parts);
    this.weaponsUi.onTab = (id) => this.toggleInventory(id as InventoryTab);
    this.forceUi.onTab = (id) => this.toggleInventory(id as InventoryTab);
    this.vehiclesUi.onTab = (id) => this.toggleSpawner(id as 'garage' | 'npcs');
    this.npcUi.onTab = (id) => this.toggleSpawner(id as 'garage' | 'npcs');
    // Kept as a promise: the equipment waits on it (a weapon restored at play() before the rack is in).
    this.weaponsLoaded = WeaponCatalogue.load(import.meta.env.BASE_URL);
    void this.weaponsLoaded.then((c) => {
      this.weapons = c;
      // The rack, so that something holding a weapon by its id alone (a person from the catalogue,
      // whose hands are given a copy of the model and not the record) is heard with its own gun.
      combatSounds.useCatalogue(c?.weapons ?? null);
      this.weaponsUi.attach(c);
      this.world.npcDeps.weapons = c;
      this.world.npcDeps.effects = this.effects;
      // Before a fighter is shown: its own shaders, then the motion blur's for its outfit's morph counts.
      this.world.npcDeps.compile = async (objects) => {
        await this.world.compileReady(objects);
        await this.postfx?.product<VelocityProduct>('velocity')?.prepareRoots(objects);
      };
      this.world.npcs?.attach(this.world.npcDeps);
      if (c) console.info(`weapons: ${c.weapons.length} on the rack, ${c.skipped.length} left out`);
      // The Force beam's own appearance out of the weapons pack (a `.ltn`, FORM LEFX, converted
      // beside the powers' particles, keyed by its own file name in the pack's `powers.beams`).
      // The catalogue and the first world's load race each other, so this both keeps it for the
      // next world and gives it to a pool that is already up; a texture is not part of a program's
      // key, so the swap compiles nothing, and the look's own two particles are prepared before
      // the pool takes it.
      setForceBeamLook((c?.manifest as { powers?: { beams?: Record<string, unknown> } } | undefined)?.powers?.beams?.force_lightning ?? null, (file) => `${import.meta.env.BASE_URL}assets-private/weapons/${file}`);
      // The peers' weapons waiting for the rack go in their hands now (remotes is assigned later in the constructor).
      this.remotes?.refreshHeld();
    });
    const galaxy = new GalaxyMap(
      this.ui,
      (p, zone) => void this.travel(p, zone),
      (p, poi, zone) => void this.teleport(p, poi, zone),
      {
        baseUrl: import.meta.env.BASE_URL,
        piloting: () => !!this.world.planet.space && !!this.pilotedShip(),
        catalogue: () => this.catalogue(),
        why: (d) => this.hyperspace.why(d),
        onHyperspace: (d) => this.jumpFromGalaxy(d),
      },
    );
    // The galaxy tab keeps a world's named places once it has read them; the death card reads the
    // same list through this rather than reaching into the map.
    this.poisOf = (id) => galaxy.loadPois(id);
    // The map window: the world here (the planet's own map, or the space zone in three axes) and the galaxy to travel.
    this.map = new MapUi(this.ui, galaxy, {
      here: () => {
        const planet = this.world.planet;
        const zone = this.zone ? planet.zones?.find((z) => z.id === this.zone) : undefined;
        return { packId: packIdOf(planet, this.zone), name: zone ? `${planet.name}: ${zone.name}` : planet.name, space: !!planet.space };
      },
      player: () => {
        const p = this.player;
        const v = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
        const at = v ? v.pos : p.worldPos;
        const flying = !!v?.spec.ship && v.airborne && !this.world.planet.space;
        return { x: at.x, y: at.y, z: at.z, heading: v ? v.heading : p.heading, altitude: flying ? at.y - this.world.terrain.heightAt(at.x, at.z) : null };
      },
      center: () => this.world.layoutCenter,
      pois: (id) => galaxy.loadPois(id),
      // The zone's placed things, read once per zone into the list the map owns: its stations and the
      // rest of what it shows are marks from the pack, so only the rocks are wanted here.
      objects: (out) => {
        for (const o of this.world.placedObjects) out.add(o.x, o.y, o.z, o.radius, o.template.includes('spacestation'));
      },
      // The ships, written into the entries the map owns: this runs every frame the map draws, so it
      // makes no array, no quaternion and no label of its own.
      ships: (() => {
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const labels = new Map<string, string>();
        return (out: import('./ui/spaceMapLayers.ts').ShipList) => {
          const p = this.player;
          const mine = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
          // On foot (adrift), the player is the mark the view follows.
          if (!mine) {
            const at = p.worldPos;
            if (p.eva) q.copy(p.evaFrame);
            else q.setFromAxisAngle(up, p.heading);
            out.add(at.x, at.y, at.z, q.x, q.y, q.z, q.w, true, 'you');
          }
          for (const v of this.world.vehicles) {
            if (!v.spec.ship) continue;
            v.quaternion(q);
            const isMine = v === mine;
            let label = labels.get(v.spec.label);
            if (!label) {
              label = `a ship (${v.spec.label})`;
              labels.set(v.spec.label, label);
            }
            out.add(v.pos.x, v.pos.y, v.pos.z, q.x, q.y, q.z, q.w, isMine, isMine ? 'your ship' : label);
          }
        };
      })(),
      // The people you are grouped with, for the map's own layer on whichever world you are on.
      // Whoever holds the group hands it over here; with nobody holding one this reads nothing, the
      // map draws no group, and its box is not shown at all. It is asked once a frame the map draws,
      // so it must make nothing and do no work beyond reading what is already known.
      group: (out) => groupMapFeed.fill?.(out),
      pack: () => this.world.spaceData,
      piloting: () => !!this.world.planet.space && !!this.pilotedShip(),
      // The map's Hyperspace button: the map closes and the System Map opens on this system, where
      // the place picked on the map is in the list. The System Map has no "pick this one" of its
      // own yet, so it opens with the first place in that list picked and the map's pick is not
      // carried. Closing the map asks for the mouse back and the System Map frees it again in the
      // same click: that is deliberate, because the Hyperspace row refuses the jump in several
      // cases (a countdown, no ship's controls) and the mouse must be right either way.
      onHyperspace: () => {
        if (this.map.open) this.toggleMap();
        this.hyperspaceButton();
      },
      onTeleport: (poi) => void this.teleport(this.world.planet, poi, this.zone),
    });
    this.map.onClose = () => this.toggleMap();
    // Every window moves by its header and sizes by its corner and far edges, and stays as it was left;
    // the overlay round it is clear, so the world shows behind. The group's and the trade window are
    // wired where they are built, further down.
    draggable(this.map.root, '.map-panel', '.map-header', 'map');
    draggable(this.shipMenu.root, '.ship-panel', '.ship-header', 'ship');
    draggable(this.hyperspaceUi.root, '.ship-panel', '.ship-header', 'hyperspace');
    draggable(this.liftMenu.root, '.ship-panel', '.ship-header', 'lift');
    for (const [id, ui] of [['wardrobe', this.wardrobe], ['weapons', this.weaponsUi], ['garage', this.vehiclesUi], ['npcs', this.npcUi], ['appearance', this.appearanceUi], ['backpack', this.backpack], ['shipedit', this.shipEdit], ['force', this.forceUi]] as const) draggable(ui.root, '.wardrobe-panel', '.wardrobe-header', id);
    // Console hooks for driving the game from tests: window.__debug.teleport(x, z, yaw), .look(yaw, pitch), .cell().
    (window as unknown as { __debug: unknown }).__debug = {
      /**
       * Every window's box, its minimum, what storage holds for it, whether it is wholly on the screen and
       * whether anything in it would scroll sideways. `{ set: { id: 'map', x: 40, y: 30, w: 900, h: 600 } }`
       * sizes one as a drag would (no w/h: its own size), `{ reset: true }` forgets them all, `{ reset: 'map' }` one.
       */
      windows: (o?: Parameters<typeof windowsDebug>[0]) => windowsDebug(o),
      /** Put the player at x, z on the ground (or at `y`); a point inside a building's room, once that building's interior is built, counts as being in it. Returns the cell. */
      teleport: (x: number, z: number, yaw?: number, y?: number) => {
        const at = new THREE.Vector3(x, y ?? this.world.terrain.heightAt(x, z) + 0.3, z);
        this.player.reset(at);
        if (yaw !== undefined) this.cam.yaw = yaw;
        return { cell: this.world.enterCellAt(at) };
      },
      /** Teleport to a point in the original game's coordinates (the inverse of `swg()`); null when no layout is loaded. */
      teleportSwg: (x: number, z: number, yaw?: number) => {
        const c = this.world.layoutCenter;
        if (!c) return null;
        // Through `teleport` itself (the entry above, on this same object), so a change to it reaches this too.
        const dbg = (window as unknown as { __debug: { teleport(x: number, z: number, yaw?: number): { cell: unknown } } }).__debug;
        return dbg.teleport(c.x - x, z - c.z, yaw);
      },
      /** The animated surfaces (flip-book screens, scrolling falls): counts and the records whose material name holds the string; `{ speed, freeze }` retunes the clock first. */
      animTex: (arg?: string | { speed?: number; freeze?: boolean }) => {
        if (arg && typeof arg === 'object') {
          if (typeof arg.speed === 'number' && Number.isFinite(arg.speed)) surfaces.speed = arg.speed;
          if (typeof arg.freeze === 'boolean') surfaces.frozen = arg.freeze;
        }
        return { ...surfaces.describe(typeof arg === 'string' ? arg : undefined), programs: this.renderer.info.programs?.length ?? 0 };
      },
      /** Feed mouse movement to the real loop as if the pointer were locked (headless tests cannot lock it), and report the camera. */
      mouse: (dx = 0, dy = 0, wheel = 0) => {
        this.input.locked = true;
        this.input.mouseDX += dx;
        this.input.mouseDY += dy;
        this.input.wheel += wheel;
        const look = this.cam.camera.getWorldDirection(new THREE.Vector3());
        return { yaw: Number(this.cam.yaw.toFixed(3)), pitch: Number(this.cam.pitch.toFixed(3)), distance: Number(this.cam.distance.toFixed(2)), firstPerson: this.cam.firstPerson, at: this.cam.camera.position.toArray().map((v) => Number(v.toFixed(2))), look: look.toArray().map((v) => Number(v.toFixed(3))) };
      },
      /** Make every frame throw after the camera has moved (for testing that a failing frame cannot make the view drift). */
      breakFrames: (on: boolean) => {
        this.breakFrames = on;
        return this.breakFrames;
      },
      look: (yaw: number, pitch: number) => {
        this.cam.yaw = yaw;
        this.cam.pitch = pitch;
      },
      zoom: (distance: number) => {
        this.cam.distance = distance;
      },
      cell: () => (this.world.cellState ? { model: this.world.cellState.building.model.def.id, cell: this.world.cellState.cell } : null),
      /** The room's air (see the README): the room, its doorway beams, its lamps and motes. With options, retunes or switches the debug views first. */
      /**
       * The water's height field: `ripples()` reports it. `ripples({ speed })` sets the coupling
       * between neighbouring texels in **metres a second** (1.423 as it ships), the same at every
       * detail setting; the grid caps it and the game says so in the console once when it holds it
       * there, so anything is safe to ask for. It is not the speed a ripple is seen to travel at Ã¢â‚¬â€
       * read `carryMs` in the report for that, because the damping is a spring as well as friction.
       * `draft` is how hard a hull holds the surface down and `impact` how hard a fast arrival
       * punches. These are content tuning rather than taste, which is why they are here and not in
       * the menu. `ripples({ poke: [x, z] })` drops a ring in at a world position.
       */
      ripples: (opts?: { speed?: number; draft?: number; impact?: number; poke?: [number, number] }) => {
        // Anything but a number is refused outright rather than clamped: a NaN in the wave term is
        // a NaN across the whole field, and one NaN pixel is a screen-sized black box once the
        // bloom has blurred it. The ceiling is far above every preset's own cap, which does the
        // real holding and warns as it does.
        if (opts?.speed !== undefined && Number.isFinite(opts.speed)) {
          WATER_SIM_SPEED.value = Math.min(Math.max(opts.speed, 0), 1000);
        }
        if (opts?.draft !== undefined && Number.isFinite(opts.draft)) WATER_SIM_DRAFT.value = Math.max(0, opts.draft);
        if (opts?.impact !== undefined && Number.isFinite(opts.impact)) WATER_SIM_IMPACT.value = Math.max(0, opts.impact);
        if (opts?.poke) pokeWaterSim(opts.poke[0], opts.poke[1], 0.6, 1.2);
        return waterSimDebug();
      },
      /**
       * Every shader program the renderer holds, what makes each one differ from the next, and what
       * has been built since the game started. This is the one hook for all of it; nothing else
       * should grow a second.
       *
       * With no argument: how many are live, how many were built and dropped in each phase of the
       * session, what this machine costs for one, the live programs counted by light signature, any
       * cache key built more than once (a key built twice is a program the cache let go and
       * something asked for straight back, which is the whole cost again), and what was built in
       * play, newest first.
       *
       * `shaders({ groups: true })` counts the live list by every dimension that can make one
       * program differ from another Ã¢â‚¬â€ the light signature, which face is drawn, fog, the shadow
       * maps, skinning, instancing, the alpha test, vertex colours, the environment cube and its
       * height, the cascades, the wet wrap and each material's own key. That is the figure to have
       * in hand before anything is collapsed: a signature with one program in it is a pass nothing
       * warmed.
       *
       * `shaders({ families: true })` asks the other question: not how many programs carry each
       * flag but which material family has more than one program at all, and what the second one
       * is *for* Ã¢â‚¬â€ the light set, a side, an alpha test, the cascades' defines, the wet wrap, a
       * material's own key. `combinedPrograms` comes out of the same census and is always
       * answered, because it is the guard rail and nobody will pass an option to find it: a light
       * set that holds two of the game's passes at once is a camera that was shown both, and every
       * program built under it is one no frame will ever draw with. **It must stay at nought**;
       * `combinedLights[0].of` names which two passes the offending set is holding together.
       *
       * `shaders({ full: true })` lists every live program with its facts, and with `raw` as well
       * the whole cache key of each, which is how to see what really differs between two programs
       * that look alike in the list (a key that could not be read is always printed whole).
       * `shaders({ since: true })` answers how many have been built since the last time it was
       * asked, which is how to tell what a run of `__debug.bench(n)` really cost: bench draws its
       * frames itself and never reaches the frame loop's own counter.
       *
       * `pace` is the paced queue: what is still to be compiled, what is holding something back
       * from being shown, the worst play frame so far and how many went over. In ordinary play
       * `pace.worstFrame` should be 1, `pace.overranFrames` 0 and `pace.idle` false; `idle` true
       * while the game is being played means no frame loop is running and every wait on the queue
       * is being answered outright instead.
       *
       * `strays` is the shadow pass's own record: `seen` is what its last pass met, `foreign` must
       * stay at nought, and `keep` says whether the old behaviour is on. `shaders({ keepStrays:
       * true })` turns it on live and `false` takes it back, which is how to see what the cut is
       * worth without a reload; `?shadowStrays=1` on the address does the same from a boot, which
       * is the way that cannot be fooled by a world already streamed in.
       */
      shaders: (opts?: { full?: boolean; groups?: boolean; families?: boolean; since?: boolean; raw?: boolean; keepStrays?: boolean }) => {
        if (opts?.keepStrays !== undefined) SHADOW_STRAYS.keep = opts.keepStrays;
        const rows = this.shaderRows();
        // Sampled here as well as in the frame loop, so a console call in a driven tab (where no
        // frame runs on its own) still sees what the last draw built. The phase is the frame loop's
        // own rule and never a second reading of it: asked at the select screen, this used to file
        // the session's first programs as built in play, which is the one thing the hook is read for.
        this.sampleShaders(this.shaderPhase());
        const totals = this.shaderWatch.totals;
        const grouped = groupPrograms(rows);
        // Worked out once, whether or not the family list is asked for: `combinedPrograms` below
        // comes out of it and is the one number this hook exists to keep at nought.
        const families = programFamilies(rows);
        const out: Record<string, unknown> = {
          live: rows.length,
          built: totals.made,
          dropped: totals.dropped,
          byPhase: totals.byPhase,
          // The per-key history is capped (a key is usually a hook's whole source text, kilobytes of
          // it, and nothing tells the watch when the renderer lets a program go). `remade` and
          // `builtInPlay` below are read out of the most recent `keys` of them; `forgotten` is how
          // many older ones the cap has dropped, and is 0 for any session short of a few worlds.
          keys: totals.keys,
          forgotten: totals.forgotten,
          machine: compilerVerdict(),
          // Kept on deliberately: reading a shader's error log was measured to cost nothing at all
          // (1569.8 ms against 1569.5 ms over four programs), and a broken shader must still say so.
          checkShaderErrors: this.renderer.debug.checkShaderErrors,
          parallelCompile: !!this.renderer.getContext().getExtension('KHR_parallel_shader_compile'),
          keysRead: grouped.read,
          keysUnread: grouped.unread,
          lights: grouped.groups.lights,
          // The guard rail, answered always: a light set that holds two of the game's passes at
          // once is a pass the game does not have, and every program under it is one no frame ever
          // draws with. Nought is the only right answer; `shaders({ families: true })` names which
          // two passes are being held together when it is not.
          combinedPrograms: families.combinedPrograms,
          // The shadow pass's stray draws: what its last pass met, whether the old behaviour is on,
          // and how many direct draws something other than that pass made while it ran (nought).
          strays: { keep: SHADOW_STRAYS.keep, seen: SHADOW_STRAYS.seen, foreign: SHADOW_STRAYS.foreign },
          // How the paced queue is doing: what is still to be compiled, what is holding something
          // back from being shown, and the worst play frame so far.
          pace: this.world.shaderPace(),
          remade: this.shaderWatch.remade(),
          builtInPlay: this.shaderWatch.builtInPlay(),
        };
        if (opts?.since) out.since = this.shaderWatch.takeSince();
        if (opts?.groups) out.groups = grouped.groups;
        if (opts?.families) {
          out.families = opts.full ? families.groups : families.groups.slice(0, 20);
          out.split = families.split;
          out.combinedLights = families.combined;
        }
        if (opts?.full) {
          out.programs = rows
            .map((p) => {
              const facts = readKey(p.cacheKey);
              return {
                name: p.name || p.type || '?',
                used: p.usedTimes ?? 0,
                lights: facts?.lights ?? 'key not read',
                side: facts?.side ?? '?',
                flags: facts ? [facts.fog && 'fog', facts.skinning && 'skinned', facts.instancing && 'instanced', facts.alphaTest && 'alphaTest', facts.vertexColors && 'vertexColors', facts.envMap && `env ${facts.envHeight}`, facts.cascades && 'cascades', facts.wet && 'wet'].filter(Boolean).join(' ') : '',
                custom: facts?.custom ?? '',
                // The raw key, whole: always for a program whose key could not be read, since that is
                // the one way to find out why, and for every program with `raw`, which is how to see
                // what really differs between two programs that look alike here. Whole rather than
                // clipped because the answer is usually in the tail, which a clipped key never
                // reaches: the tail is where a three that has moved its fields would show.
                key: facts && !opts?.raw ? undefined : p.cacheKey,
              };
            })
            .sort((a, b) => a.lights.localeCompare(b.lights) || a.name.localeCompare(b.name));
        }
        return out;
      },
      roomAir: (opts?: RoomAirDebugOptions) => {
        const d = opts ? this.roomAir.debug(opts) : this.roomAir.describe();
        const pass = this.postfx?.describe().passes.find((p) => p.id === 'lightShafts') ?? null;
        return { ...d, effects: !!this.postfx, pass };
      },
      /**
       * The specks drifting past the eye under water. With no argument, the listing: whether they
       * are wanted, whether the camera is really under a surface, how many were drawn, where the
       * ceiling under the swell stands and, when nothing was drawn, why not. With one, the knobs:
       * `__debug.specks({ count, amount, span, size, drift, sink, swirl, swirlRate, brightness,
       * tint, lightDepth, nightFloor, near, surfaceFade, fadeSeconds })`. Every number of them is
       * ours -- the game had no under water at all -- none is saved, and none rebuilds a program.
       * Nothing about them can be judged from a driven tab: this answers in numbers.
       */
      specks: (opts?: UnderwaterSpeckDebugOptions) => {
        const pass = this.postfx?.pass<UnderwaterSpecksPass>('underwaterSpecks');
        if (!pass) return 'the effects are off; turn Effects on in the menu';
        return opts ? pass.debug(opts) : pass.describe();
      },
      passes: () => this.portals.passes,
      /** The effects chain: every pass with its setting, whether it drew, why not, and what it cost. `postfx({ godRays: false })` forces one off, `{ godRays: null }` gives it back to the settings. */
      postfx: (changes?: Partial<Record<FxPassId, boolean | null>>) => {
        const fx = this.postfx;
        if (!fx) return 'the effects are off; turn Effects on in the menu';
        if (changes) for (const [id, value] of Object.entries(changes)) {
          if (value === null) delete fx.override[id as FxPassId];
          else fx.override[id as FxPassId] = value as boolean;
        }
        return fx.describe();
      },
      /** Start (true) or stop (false) timing every step of the chain on the GPU; with no argument, the report so far. */
      fxTiming: (on?: boolean) => {
        const fx = this.postfx;
        if (!fx) return 'the effects are off; turn Effects on in the menu';
        if (on === true) {
          fx.timer.reset();
          fx.timer.enabled = true;
          return `timing started (GPU timing ${fx.timer.hasGpu ? 'on' : 'not available here'})`;
        }
        if (on === false) fx.timer.enabled = false;
        return fx.timing();
      },
      /** Show one of the shared products instead of the picture: 'linearDepthHalf', 'normalsHalf', 'debugMask', 'waterMask' (the water's normals over the picture), 'waterMaskEnv' (the environment term the water hands the reflections), 'depth', 'scene', or a pass's own texture as 'ssao.ao'. No argument puts the picture back. */
      fxView: (name?: string | null) => {
        const fx = this.postfx;
        if (!fx) return 'the effects are off; turn Effects on in the menu';
        // Putting the picture back answers null, which is not a failure: say so in words.
        return fx.fxView(name ?? null) ?? 'the picture';
      },
      /** Draw one frame asking the driver for an error after every step: this is the test that no pass reads the depth of the target it is writing. */
      fxCheck: () => {
        const fx = this.postfx;
        if (!fx) return 'the effects are off; turn Effects on in the menu';
        fx.checkErrors = true;
        this.drawFrame();
        const errors = fx.lastCheck ?? [];
        return { clean: errors.length === 0, errors };
      },
      /**
       * Ambient occlusion: tune it live and report the lights it read and the values under the crosshair. `{ split: 0.5 }` left
       * half with it, right half without; `{ view: 'ao' | 'fraction' | 'ceiling' | 'multiplier' | 'region' }` shows its working
       * texture (null the picture); `radius`, `power`, `fade: [start, end]`, `falloff`, `thin`, `openBias`, `directShare` and
       * `region: false` (the sky's lights everywhere) compare. Null puts an option back.
       */
      ssao: (opts?: { split?: number | null; view?: 'ao' | 'fraction' | 'ceiling' | 'multiplier' | 'region' | null; radius?: number | null; power?: number | null; fade?: [number, number] | null; falloff?: number | null; thin?: number | null; openBias?: number | null; directShare?: number | null; region?: boolean | null }) => {
        const fx = this.postfx;
        if (!fx) return 'the effects are off; turn Effects on in the menu';
        const pass = fx.pass<SsaoPass>('ssao');
        if (!pass) return 'the ambient occlusion pass is not installed on this chain';
        const t = pass.tune;
        const D = SSAO_TUNE_DEFAULTS;
        if (opts) {
          if ('split' in opts) t.split = opts.split ?? 0;
          if ('radius' in opts) t.radius = opts.radius ?? null;
          if ('power' in opts) t.power = opts.power ?? null;
          if ('fade' in opts) [t.fadeStart, t.fadeEnd] = opts.fade ?? [D.fadeStart, D.fadeEnd];
          if ('falloff' in opts) t.falloff = opts.falloff ?? D.falloff;
          if ('thin' in opts) t.thin = opts.thin ?? D.thin;
          if ('openBias' in opts) t.openBias = opts.openBias ?? D.openBias;
          if ('directShare' in opts) t.directShare = opts.directShare ?? D.directShare;
          if ('region' in opts) t.region = opts.region ?? D.region;
          if ('view' in opts) {
            const v = opts.view ?? null;
            pass.setMultiplierView(v === 'multiplier');
            fx.fxView(v ? `ssao.${v}` : null);
          }
        }
        const ctx = fx.ctx;
        const row = fx.describe().passes.find((p) => p.id === 'ssao');
        return {
          on: row?.setting ?? false,
          drewLastFrame: pass.drewLastFrame(ctx),
          why: row?.why ?? null,
          resolution: pass.aoSize,
          radius: t.radius ?? ctx.settings.ssaoRadius,
          strength: ctx.settings.ssaoStrength,
          power: t.power ?? SSAO_BASE_POWER * Math.max(ctx.settings.ssaoStrength, 1),
          fade: [t.fadeStart, t.fadeEnd],
          openBias: t.openBias,
          directShare: t.directShare,
          lightSets: pass.last.lightSets,
          lights: pass.lightsReport(ctx),
          water: { inView: ctx.waterInView, mask: pass.last.waterMask },
          centre: pass.probe(ctx),
          gpuMs: fx.timer.enabled ? (fx.timing().rows['pass:ssao']?.gpuMs ?? null) : null,
        };
      },
      /**
       * Depth of field when aiming: live tuning of the lens (`aperture`, `apertureStop`, `maxCoc`, `keepShooterSharp`, `taps`, ...),
       * `force: true` to draw as if aimed, `view: 'coc' | 'blur' | 'tiles' | 'focus' | 'glow' | null`, and the glow mask's `glowLevel`.
       * Draws one frame, then reports the focus (one GPU read), the radii, the grid and the glow depth.
       */
      dof: (opts?: Partial<import('./core/fx/dofMath').DofTuning> & { force?: boolean; view?: import('./core/fx/dof').DofView; glowLevel?: number }) => {
        const fx = this.postfx;
        const pass = fx?.pass<import('./core/fx/dof').DepthOfFieldPass>('depthOfField');
        if (!fx || !pass) return 'effects are off';
        if (opts) pass.tune(opts);
        this.drawFrame();
        return pass.report(fx.ctx, fx.describe().passes.find((p) => p.id === 'depthOfField'));
      },
      /** The wardrobe and creator dolls' lens: `on`, `strength` for this session (a settings change resyncs), `view: 1` forces the lens and shows its CoC. */
      previewDof: (opts?: { on?: boolean; strength?: number; view?: 0 | 1 }) => {
        const fx = WardrobeUi.dollEffects;
        if (typeof opts?.on === 'boolean') fx.on = opts.on;
        if (typeof opts?.strength === 'number' && Number.isFinite(opts.strength)) fx.strength = Math.max(0, opts.strength);
        if (opts?.view === 0 || opts?.view === 1) fx.view = opts.view;
        return { effects: { ...fx }, wardrobe: this.wardrobe.doll.dofReport(), appearance: this.appearanceUi.doll.dofReport() };
      },
      /**
       * The volumetric clouds: what this world's sky measured, what the march is being asked for, and
       * every number of the march live. `{ steps, lightSteps, bottom, top }` and the look move on the
       * next frame; the rest (`baseScale`, `density`, `detailBite`, `gForward`, `powder`, ...) are
       * constants in the program, so moving one rebuilds it once. `baseScale` is how big one cloud
       * is, in metres: smaller puts more of them across the sky, and a value kept wants the `clouds`
       * command run again, since the coverage is calibrated against the volume at this scale.
       * `{ coverage }` overrides what the world says, so a clear world can be flown under an
       * overcast to time it; null gives it back. `drawn.where` says whether the eye is under the
       * deck, in it or over it, which is the one thing the picture cannot tell you.
       * `__debug.fxView('volumetricClouds.march')` shows what the ray gathered and `'.clear'` what it
       * let through (white where it found nothing), which is how to tell a march that drew nothing
       * from an upsample that threw it away.
       */
      clouds: (opts?: Partial<typeof CLOUD_MARCH> & { coverage?: number | null; brightness?: number | null; drift?: number | null; standDownDust?: number | null }) => {
        const fx = this.postfx;
        const pass = fx?.pass<CloudsPass>('volumetricClouds');
        if (!fx || !pass) return 'the effects are off; turn Effects on in the menu';
        let rebuild = false;
        if (opts) {
          for (const k of Object.keys(CLOUD_MARCH) as (keyof typeof CLOUD_MARCH)[]) {
            const v = opts[k];
            if (typeof v !== 'number' || !Number.isFinite(v)) continue;
            CLOUD_MARCH[k] = v;
            // The slab and the two step counts are uniforms; everything else is in the program.
            if (k !== 'bottom' && k !== 'top' && k !== 'steps' && k !== 'lightSteps') rebuild = true;
          }
          if ('standDownDust' in opts) CLOUD_TUNE.standDownDust = opts.standDownDust ?? 0.5;
          if ('coverage' in opts) this.cloudForce.coverage = opts.coverage ?? null;
          if ('brightness' in opts) this.cloudForce.brightness = opts.brightness ?? null;
          if ('drift' in opts) this.cloudForce.drift = opts.drift ?? null;
          if (rebuild) pass.retune();
        }
        const w = this.world.weather.state;
        const pack = this.cloudPacks.get(this.world.packId) ?? null;
        return {
          setting: this.settings.volumetricClouds,
          quality: this.settings.volumetricCloudQuality,
          amount: this.settings.volumetricCloudAmount,
          // The two things that must both be true before anything is drawn at all.
          volumes: pass.hasNoise ? 'loaded' : this.cloudVolumesAsked ? 'not converted (npm run swg -- clouds assets-private)' : 'not asked for yet',
          measured: pack ? `${pack.planet}: ${pack.levels.length} levels` : `${this.world.packId}: no clouds.json`,
          weather: { level: Number(w.level.toFixed(2)), wind: Number(w.windSpeed.toFixed(2)), heading: Math.round((w.windHeading * 180) / Math.PI), dust: Number(w.dust.toFixed(2)) },
          asked: { ...pass.look },
          forced: { ...this.cloudForce },
          sheets: this.world.swgSky?.sheets ?? null,
          drawn: pass.last,
          march: { ...CLOUD_MARCH },
          rebuilt: rebuild,
          gpuMs: fx.timer.enabled ? (fx.timing().rows['pass:volumetricClouds']?.gpuMs ?? null) : null,
        };
      },
      /** Compile every pass and product material again and say how many programs that made; a second call should say 0. */
      fxWarm: async () => (this.postfx ? await this.postfx.warmUp() : 'the effects are off; turn Effects on in the menu'),
      /** What the card is holding: how the dispose is checked, since turning the effects off and on three times must leave the texture count where it was. */
      renderInfo: () => ({ memory: { ...this.renderer.info.memory }, programs: this.renderer.info.programs?.length ?? 0, effects: !!this.postfx }),
      /** What the motion blur tracks this frame: every mover listed, what it drew and why not, the variants and the static cut. Null with the effects off. */
      movers: (list = true) => this.postfx?.product<VelocityProduct>('velocity')?.stats(list) ?? null,
      /** Draw a frame and read the blur's radius field at a pixel (from the top left; the crosshair by default): what a passing thing does, without a screenshot. */
      motionProbe: (x?: number, y?: number) => {
        const fx = this.postfx;
        if (!fx) return { off: 'the effects are off; turn Effects on in the menu' };
        const pass = fx.pass<MotionBlurPass>('motionBlur');
        if (!pass || typeof pass.readField !== 'function') return { off: 'this chain has no motion blur with a radius field' };
        this.drawFrame();
        const row = fx.describe().passes.find((p) => p.id === 'motionBlur');
        if (!row?.drewLastFrame) return { off: row?.why ?? 'the motion blur did not draw' };
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        const read = pass.readField(this.renderer, x ?? size.x / 2, y ?? size.y / 2);
        if (!read) return { off: 'the read failed' };
        return { ...read, cut: [pass.lastCut.x, pass.lastCut.y] };
      },
      /** Retune the motion blur for this session: `{ nearCut: [8, 25], radiusOfHeight, samples, limits: { maxDraws } }`. Returns the values in force; nothing is saved. */
      motionTune: (changes?: { nearCut?: [number, number]; radiusOfHeight?: number; samples?: number; limits?: Partial<typeof MOVER_LIMITS> }) => {
        if (changes?.nearCut) {
          const [a, b] = changes.nearCut;
          if (!(Number.isFinite(a) && Number.isFinite(b) && a >= 0 && a < b)) return `nearCut must be two distances in metres, the first below the second (got ${JSON.stringify(changes.nearCut)})`;
          MOTION_TUNING.nearCut = [a, b];
        }
        if (changes?.radiusOfHeight !== undefined && Number.isFinite(changes.radiusOfHeight) && changes.radiusOfHeight > 0) {
          MOTION_TUNING.radiusOfHeight = changes.radiusOfHeight;
          this.postfx?.pass<MotionBlurPass>('motionBlur')?.resizeTiles?.();
        }
        if (changes?.samples !== undefined && Number.isFinite(changes.samples)) MOTION_TUNING.samples = Math.min(32, Math.max(4, Math.round(changes.samples)));
        if (changes?.limits) {
          const L = MOVER_LIMITS as Record<string, number>;
          for (const [k, v] of Object.entries(changes.limits)) if (k in L && typeof v === 'number' && Number.isFinite(v)) L[k] = v;
        }
        return { nearCut: [...MOTION_TUNING.nearCut], radiusOfHeight: MOTION_TUNING.radiusOfHeight, samples: MOTION_TUNING.samples, shutter: MOTION_TUNING.shutter, tileSize: this.postfx?.pass<MotionBlurPass>('motionBlur')?.tileSize ?? null, limits: { ...MOVER_LIMITS } };
      },
      /**
       * Every pass of the last frame: what it was and what it drew, and beside it what the shadow
       * pass met. `strays` is the draws it found of meshes that opt out of frustum culling (every
       * actor's, every trail's, every glow's), which are dropped because that pass's camera is
       * shown the world's lights and a building's rooms' lights at once and its colour is cleared
       * the moment it ends; `straysKept` says whether the old behaviour is on, and `straysForeign`
       * counts a direct draw made during the pass by something other than the pass itself, which
       * must stay at nought.
       */
      passLog: () => {
        const log = this.portals.passLog;
        const byLabel = new Map<string, { passes: number; calls: number; triangles: number }>();
        for (const p of log) {
          const e = byLabel.get(p.label) ?? byLabel.set(p.label, { passes: 0, calls: 0, triangles: 0 }).get(p.label)!;
          e.passes++;
          e.calls += p.calls;
          e.triangles += p.triangles;
        }
        return { total: { passes: log.length, calls: log.reduce((a, p) => a + p.calls, 0) }, byLabel: Object.fromEntries(byLabel), strays: SHADOW_STRAYS.seen, straysKept: SHADOW_STRAYS.keep, straysForeign: SHADOW_STRAYS.foreign };
      },
      /**
       * What the planet has planted, and what it is stopping you with.
       *
       * With no argument: how many plants are standing, how many flora models the pack carries, and
       * the appearances it has none for (which are nearly all insects and birds -- particle effects
       * the converter skips on purpose -- so a long list here is not a fault).
       *
       * `flora({ near: 20 })` lists the flora **colliders** within that many metres of the player,
       * nearest first: each one's radius, how tall it stands, and how far off it is. That is the
       * reading for "I am caught on something I cannot see", because flora is generated from the
       * terrain rather than placed, so `__debug.near()` -- which lists the layout's own objects --
       * never shows it. A cylinder much wider than the plant drawn over it, or one with nothing
       * drawn there at all, is what to report.
       *
       * `clear` says how far each placed object keeps flora off: `'model'` is the model's own reach
       * and `'snapshot'` the streaming radius the game read for years, which on some worlds is
       * kilometres and left them with no flora whatsoever. `flora({ rule: 'snapshot' })` puts that
       * back for comparison at the next world load; it changes nothing already streamed in.
       */
      flora: (opts?: { near?: number; rule?: 'model' | 'snapshot'; pad?: number; cap?: number }) => {
        if (opts?.rule) FLORA_CLEAR.rule = opts.rule;
        if (typeof opts?.pad === 'number' && Number.isFinite(opts.pad)) FLORA_CLEAR.pad = Math.max(0, opts.pad);
        if (typeof opts?.cap === 'number' && Number.isFinite(opts.cap)) FLORA_CLEAR.cap = Math.max(1, opts.cap);
        const status = this.world.floraStatus;
        const out: Record<string, unknown> = { ...(status ?? {}), clear: { ...FLORA_CLEAR } };
        if (opts?.near !== undefined) {
          const p = this.player.pos;
          const r = Math.max(1, Math.min(200, opts.near));
          const ground = this.world.terrain.heightAt(p.x, p.z);
          out.colliders = this.world
            .collidersNear(p.x, p.z, r)
            .map((c) => ({ d: Number(Math.hypot(c.x - p.x, c.z - p.z).toFixed(2)), radius: Number(c.r.toFixed(2)), stands: Number((c.top - ground).toFixed(2)), x: Number(c.x.toFixed(1)), z: Number(c.z.toFixed(1)) }))
            .filter((c) => c.d <= r)
            .sort((a, b) => a.d - b.d);
        }
        return out;
      },
      /**
       * Load a character assembled from parts and stand it beside the player: one skeleton, a
       * body, a head and whatever is worn, each its own file. Then `.wear(name)`, `.remove(name)`,
       * `.setMorph(name, v)` and `.status()` on what comes back.
       */
      /** The character's appearance: every live variable (key, kind, palette size or choices, which mesh owns it), the shape sliders, and the values in force. */
      appearance: () => {
        const c = this.player.rig?.character;
        if (!c) return 'no parts character';
        return { live: !!c.customizer, variables: (c.customizer?.variables() ?? []).map((v) => `${v.key}: ${v.kind}${v.colors ? ` ${v.colors.length} colours` : v.count ? ` ${v.count} choices` : ''}${v.private ? ` (private to ${v.mesh})` : ''} default ${v.default}`), manifest: (c.manifest.variables ?? []).map((v) => `${v.private ? 'private ' : ''}${v.name}: ${v.kind} ${v.colors?.length ?? v.count ?? '?'} from ${v.sources.join(', ')}${v.meshes?.length ? ` on ${v.meshes.join(', ')}` : ''}`), morphs: c.morphValues(), values: c.variableValues(), height: c.height };
      },
      /** What a mesh's live textures are made of (`recipe('head')`): shader stages, texture choices, palettes, blueprint operations and the values in force. */
      recipe: (mesh = 'head') => {
        const c = this.player.rig?.character;
        if (!c?.customizer) return 'no live recipes on this character';
        return c.customizer.describe(mesh);
      },
      /** Every normal map's strength and way up, live, the world's and the character's: `normals(1, 1)` is the default (the green taken as it stands), `normals(1, -1)` the other way up, which is how the game had them for years, `normals(0, 0)` none. */
      normals: (x = 1, y = 1) => {
        const world = this.world.setNormalScale(x, y);
        const c = this.player.rig?.character;
        const own = c?.customizer?.setNormalScale(x, y) ?? 0;
        return `${world} materials in the world and ${own} of the character's set to (${x}, ${y})`;
      },
      /** Play as another species or gender (`species()` lists what the pack has): `species('twilek_female')`. */
      species: async (id?: string) => {
        if (!id) return this.speciesList.length ? this.speciesList.map((s) => `${s.id}: ${s.morphs.length} sliders, ${s.variables.length} variables, ${s.jkaClips} JKA clips`) : `no species index (run the converter's species command); playing ${this.characterId}`;
        return this.switchCharacter(id);
      },
      character: async (id = 'human_male') => {
        const c = await Character.load(import.meta.env.BASE_URL, id);
        const p = this.player.pos;
        c.group.position.set(p.x + 1.5, this.world.terrain.heightAt(p.x + 1.5, p.z), p.z);
        c.group.traverse((o) => o.layers.enable(31));
        this.scene.add(c.group);
        (window as unknown as { __character: Character }).__character = c;
        return { parts: c.status(), morphs: Object.keys(c.morphValues()).length, clips: c.clips.length, at: c.group.position.toArray() };
      },
      /**
       * The character's shape sliders, from the mesh's blend targets. With no arguments, every
       * slider and where it sits; with a name and a value in 0..1, move one.
       * Two-sided sliders come as pairs (blend_jaw_0 and blend_jaw_1 are one slider's two ends).
       */
      morph: (name?: string, value?: number) => {
        const rig = this.player.rig;
        if (!rig) return 'the character rig has not loaded';
        if (name === undefined) return rig.morphValues();
        if (value === undefined) return rig.morphValues()[name] ?? `no such shape: ${name}`;
        if (!rig.setMorph(name, value)) return `no such shape: ${name}`;
        return { [name]: value };
      },
      /** What the player is wearing, and what the pack offers. `wear`/`remove` change it. */
      wardrobe: () => {
        const c = this.player.rig?.character;
        if (!c) return 'the player is not assembled from parts';
        return { worn: c.status(), available: c.manifest.parts.filter((p) => p.occlusionLayer > 0).map((p) => p.name) };
      },
      wear: async (name: string) => {
        const c = this.player.rig?.character;
        if (!c) return 'the player is not assembled from parts';
        if (await c.wear(name)) return c.status();
        // Not one of the character's own parts: try the converted catalogue.
        return (await c.wearItem(name, import.meta.env.BASE_URL)) ? c.status() : `no such part or wardrobe item: ${name}`;
      },
      /** The wardrobe doll: what the last clone produced and how big its canvas is. */
      preview: () => this.wardrobe.previewState(),
      /**
       * The two give screens (Clothes and Weapons): every number they invent, live, and what each is
       * showing. `giveScreens({ page: 60 })` redraws both. `drawn` is how many cells are really in
       * the page and should stay inside `openCells` however much is worn; `marked` is how many cells
       * have to print the id's own part because their names alone would not tell them apart.
       * (`give` itself is the tool that hands the player an item, further down.)
       */
      giveScreens: (opts?: Partial<typeof GIVE_TUNE>) => {
        if (opts) {
          Object.assign(GIVE_TUNE, opts);
          this.wardrobe.refresh();
          this.weaponsUi.render();
        }
        return { tune: { ...GIVE_TUNE }, clothes: this.wardrobe.state(), weapons: this.weaponsUi.state() };
      },
      /** First person's head: what each worn part does (whole, split, none) and why; `fpHead(true)` hides it from any camera to look at, `fpHead(null)` follows the camera again. */
      fpHead: (force?: boolean | null) => {
        if (force !== undefined) this.fpHeadForce = force;
        return { firstPerson: this.cam.firstPerson, forced: this.fpHeadForce, parts: this.player.rig?.headStatus() ?? [] };
      },
      /** The converted wardrobe: every wearable and hairstyle. `find` narrows by id or category. */
      closet: async (find?: string) => {
        const c = this.player.rig?.character;
        if (!c) return 'the player is not assembled from parts';
        const w = await c.catalogue(import.meta.env.BASE_URL);
        const re = find ? new RegExp(find, 'i') : null;
        const hits = w.items.filter((i) => !re || re.test(i.id) || re.test(i.template));
        return { total: w.items.length, matched: hits.length, items: hits.slice(0, 40).map((i) => `${i.id} (${i.kind}, layer ${i.parts[0]?.occlusionLayer})`) };
      },
      remove: (name: string) => {
        const c = this.player.rig?.character;
        if (!c) return 'the player is not assembled from parts';
        return c.remove(name) ? c.status() : `cannot remove ${name}`;
      },
      /** Which sky-ramp row feeds ambient light, and its strength. Row 0 is black on every planet; try 8 and 9. */
      ambient: (row?: number, scale?: number) => this.world.setAmbient(row, scale),
      /** Shadow look: radius is the blur in shadow-map texels (1 crisp, 3 soft), intensity how dark a shadow goes. Reports the cascade splits. */
      shadowLook: (radius?: number, intensity?: number, mapSize?: number) => this.world.setShadowLook(radius, intensity, mapSize),
      /** Retune shadows: distance is how far the cascades reach, minRadius which objects cast. Shorter reach is cheaper and sharper. */
      shadows: (distance?: number, minRadius?: number) => this.world.setShadows(distance, minRadius),
      /** The ragdolls' numbers (springs, limits, sleep, how a piece turns, whether a body meets its own pieces), changed live: `ragdoll({ selfCollide: true })`, `ragdoll({ inertiaBlend: 1 })`; no argument reads them, with every fallen body's state and the contact filter's counts. */
      ragdoll: (tune?: Partial<typeof RAGDOLL>) => {
        if (tune) Object.assign(RAGDOLL, tune);
        return { ...RAGDOLL, hooks: { ...this.physics.hookStats }, bodies: [...this.world.creatures.creatures.map((c) => c.ragdoll?.status ?? null), ...this.world.npcs.npcs.map((n) => n.ragdoll?.status ?? null), this.player.ragdoll?.status ?? null].filter(Boolean) };
      },
      /**
       * The loose props: `props()` says how many are standing, awake and asleep; `props({ sleep: 4 })`
       * (every name in `PROPS`) moves a number live; `props({ reset: true })` stands them all back
       * where they began. Written in `src/world/looseProps.ts` and named here, so there is one of it.
       */
      props: propsDebug,
      /** Kill the player (the death card and the ragdoll), every creature, or every fighter, to see them fall. */
      kill: (what: 'player' | 'creatures' | 'fighters' | 'mobiles' | 'all' = 'player', filter?: string) => {
        // `filter` is a substring of a mobile's entry id or name, a creature's name, or a fighter's species.
        const f = filter?.toLowerCase();
        const picks = (...names: string[]) => !f || names.some((n) => n.toLowerCase().includes(f));
        if (what === 'player') this.player.takeDamage(1e9);
        if (what === 'creatures' || what === 'all') for (const c of this.world.creatures.creatures) if (picks(c.label)) c.damage(1e9);
        if (what === 'fighters' || what === 'all') for (const n of this.world.npcs.npcs) if (picks(n.species, n.name)) n.damage(1e9);
        if (what === 'mobiles' || what === 'all') for (const m of [...(this.world.mobiles?.live ?? [])]) if (picks(m.entry.id, m.entry.name)) m.damage(1e9);
        return { player: this.player.hp, creatures: this.world.creatures.creatures.filter((c) => c.dead).length, fighters: this.world.npcs.npcs.filter((n) => n.dead).length, mobiles: (this.world.mobiles?.live ?? []).filter((m) => m.dead).length };
      },
      /** The buildings around the player and whether each can be walked into (E offers a way into the ones that cannot). */
      doorless: () => this.world.describeDoorless(this.player.pos),
      /** Building interiors: how many are built against how many every loaded building would hold. `force` builds them all to compare. */
      interiors: (force = false) => this.world.interiorStats(force),
      /** Draw calls of the whole frame, summed over the portal renderer's passes. */
      drawCalls: () => ({ calls: stats.calls, passes: this.portals.passes, triangles: stats.triangles }),
      // The player's position in the original game's coordinates (for terrain-check --at and /way).
      swg: () => {
        const c = this.world.layoutCenter;
        const p = this.player.pos;
        return c ? { x: Number((c.x - p.x).toFixed(1)), z: Number((c.z + p.z).toFixed(1)), y: Number(p.y.toFixed(2)), ground: Number(this.world.terrain.heightAt(p.x, p.z).toFixed(2)) } : null;
      },
      // Show a converted model (path under assets-private/) in front of the player, playing a clip.
      show: async (file: string, clip?: string) => {
        let gltf;
        try {
          gltf = await surfaces.withPlugin(new GLTFLoader()).loadAsync(`${import.meta.env.BASE_URL}assets-private/${file}`);
        } catch (err) {
          console.error('show: failed to load', file, err);
          throw err;
        }
        const p = this.player.pos;
        gltf.scene.position.set(p.x + 3, this.world.terrain.heightAt(p.x + 3, p.z), p.z);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        gltf.scene.traverse((o) => {
          o.layers.enable(31);
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = castsShadow(m.material);
            m.frustumCulled = false;
          }
        });
        this.scene.add(gltf.scene);
        const mixer = new THREE.AnimationMixer(gltf.scene);
        const names = gltf.animations.map((a) => a.name);
        const wanted = clip ? gltf.animations.find((a) => a.name === clip) ?? gltf.animations.find((a) => a.name.includes(clip)) : gltf.animations[0];
        if (wanted) mixer.clipAction(wanted).play();
        this.shown.push(mixer);
        const bones: string[] = [];
        gltf.scene.traverse((o) => {
          if ((o as THREE.Bone).isBone) bones.push(o.name);
        });
        const result = { clips: names, playing: wanted?.name ?? null, joints: bones.length ? 'skinned' : 'static', bones, size: [size.x, size.y, size.z].map((v) => Number(v.toFixed(2))), at: [gltf.scene.position.x, gltf.scene.position.y, gltf.scene.position.z].map((v) => Number(v.toFixed(1))) };
        console.info('show:', file, result);
        return result;
      },
      scene: () => this.scene,
      find: (pattern: string) => {
        const out: unknown[] = [];
        this.scene.traverse((o) => {
          if (!new RegExp(pattern).test(o.name)) return;
          const g = (o as THREE.Mesh).geometry;
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          out.push({ name: o.name, visible: o.visible, y: o.position.y, indices: g?.getIndex()?.count ?? null, verts: g?.getAttribute('position')?.count ?? null, layers: o.layers.mask, material: m ? { opacity: m.opacity, transparent: m.transparent, color: m.color?.getHexString(), stencilRef: m.stencilRef, stencilFunc: m.stencilFunc, stencilWrite: m.stencilWrite } : null });
        });
        return out;
      },
      water: (x: number, z: number) => this.world.terrain.waterHeightAt(x, z),
      /**
       * The **second** water reader and its knobs: the sea with the swell in it, which is what
       * floats on it reads and what nothing else may. `sea()` reports the numbers in force, the
       * shader's own fade edges they lean on, the swell's reach on this planet and -- in `why` --
       * why nothing is bobbing when nothing is.
       *
       * `sea({ on: false })` puts the flat table back under every hull and makes the game exactly
       * what it was. `sea({ scale: 0.5 })` halves the bob without touching the picture, which is the
       * knob for a sea with the right rhythm and too much height -- and there is a reason it might
       * have: the near sea is 15 m a quad while its waves run 7.8 m to 33.5 m, so the mesh draws
       * about half the swell the hull is really floating on. `sea({ solve: 0 })` drops the inverse
       * solve back to the plain forward sum (0.047 m r.m.s. out, 0.29 m at worst, against 3 mm for
       * the one step that is the default), since a wave carries the surface sideways as well as up.
       * `sea({ farFade: true })` mirrors the shader's camera-distance fade as well: off by default,
       * because the mesh goes flat past 900 m for want of vertices rather than for want of waves,
       * and a ride that changes when the camera turns away is the worse fault of the two.
       *
       * `sea(x, z)` answers that reader at a point beside `water(x, z)`, which is the flat one: over
       * the open sea the two differ by the swell and everywhere else they are the same number. The
       * water's own clock only turns on a drawn frame, so in a driven tab -- and under
       * `__debug.advance`, which does not step the world -- the swell is a still shape and a hull
       * settles onto it rather than riding it.
       */
      sea: (x?: number | SeaFeedTune, z?: number) => {
        if (typeof x === 'number' && typeof z === 'number') return { flat: this.world.terrain.waterHeightAt(x, z), sea: this.world.seaAt(x, z) };
        return this.world.setSeaFeed(typeof x === 'object' && x !== null ? x : undefined);
      },
      /**
       * How a body holds a height nothing supports it at -- a swimmer lying on the surface, a flyer
       * at its cruising height -- which is one spring shared by the player and every creature
       * (`AFLOAT` in `src/world/afloat.ts`). `afloat()` reports it with where the player is against
       * its own float line now; `afloat({ track: 4 })` stiffens the chase for a run, `{ damp: 0 }`
       * lets it overshoot the crest and `{ speed: 1 }` shows what a body too slow to keep up looks
       * like. Nothing is saved. The swell itself is `__debug.sea`.
       */
      afloat: (tune?: Partial<import('./world/afloat').AfloatTune>) => {
        const p = this.player;
        const flat = this.world.waterColumnAt(p.pos.x, p.pos.z);
        const surface = flat + this.world.seaSwellOverFlat(p.pos.x, p.pos.z, flat);
        return {
          tune: tuneAfloat(tune),
          swimming: p.swimming,
          submerged: p.submerged,
          flat: Number.isFinite(flat) ? Number(flat.toFixed(3)) : null,
          surface: Number.isFinite(surface) ? Number(surface.toFixed(3)) : null,
          swell: Number.isFinite(surface) && Number.isFinite(flat) ? Number((surface - flat).toFixed(3)) : 0,
          y: Number(p.pos.y.toFixed(3)),
          // How far under the drawn surface the body is lying. It should sit at the swim depth and
          // stay there while the wave moves; a figure that wanders is the spring losing the wave.
          under: Number.isFinite(surface) ? Number((surface - p.pos.y).toFixed(3)) : null,
          rise: Number(p.vel.y.toFixed(3)),
          // What the last swimming frame actually did, which is the only way to tell a spring that
          // will not hold its line from one that is never asked to hold it, and both from one that
          // asks and is refused by the body's own character controller. `gap` is how far the body
          // was off its line before the frame and `moved` is what the controller allowed of it: a
          // `moved` far short of `gap`, or of the other sign, is something the body is touching.
          frame: { ...p.swimProbe, held: Number.isFinite(p.swimProbe.moved) ? Number((p.swimProbe.gap - p.swimProbe.moved).toFixed(4)) : null },
          // And every term the swell's own fade is built from, with the first one that took it to
          // nothing named. This is where a body holding a line the drawn water knows nothing about
          // shows up: the fade is on the water's depth, and the seabed this reads is not the one
          // the shader reads.
          why: this.world.seaSwellWhy(p.pos.x, p.pos.z),
        };
      },
      /**
       * The lava drawn now (tables, and each look with where its textures came from: "client",
       * "partial" or "stand-in"), the look every lava material shares, and what a flow does to
       * whoever stands in it. `lava({ intensity, glow, glowFrom, glowTo })` tunes the colour and
       * which veins glow; `lava({ axes: 'xzy' })` reads the client's texture coordinate the other
       * way round, `{ axes: 'xyz' }` restores it.
       *
       * The `harm` half is the other pass. `share` (of a whole life) and `interval` (seconds) are
       * the **client's own**, out of its terrain water values and into the pack by the water
       * command; `source` says whether this planet's pack carried them at all, and `harm.why` says
       * in words why nothing is burning when nothing is. `on`, `margin` (how far under a surface
       * counts as being in it), `hold` (the band you climb back out through), `rideReach` (how far
       * over a flow a ride's belly still burns) and `linger` (how long a verdict is held when it
       * goes false) are **ours**. `depth` is where the player -- or the belly of what they ride --
       * stands against the flow over them right now, and null where the water there is not a flow.
       * `lava({ on: false })` is the switch that makes the ground exactly what it was -- the sink
       * below included, since a flow with its switch off does nothing to anybody.
       *
       * `sink` is the third thing a flow does and every number of it is **ours**: how far it draws a
       * body down (to the waist and no further), how fast it does it, how fast it lets go once the
       * body is clear, and how much of the walk it keeps while it holds. Its `secondsToWaist` is
       * measured from the lip of a flow, which is the figure to hold against `harm.secondsToKillAt100`.
       * `lava({ sink: { on: false } })` is its own switch, and the figure and the view go back to
       * where the body really stands there and then.
       */
      lava: (tune?: { intensity?: number; glow?: number; glowFrom?: number; glowTo?: number; axes?: 'xyz' | 'xzy'; sink?: LavaSinkTune } & LavaHarmTune) => {
        if (tune) {
          this.world.setLavaLook(tune);
          this.world.setLavaHarm(tune);
          if (tune.sink) this.player.setLavaSink(tune.sink);
        }
        return { ...this.world.lavaStatus, sink: this.player.setLavaSink() };
      },
      /**
       * The player's own fire: the numbers in force and the burn as it stands. Every one of them is
       * **ours** -- the client had a fire state and a chime for it and said nothing whatever about
       * what it cost you or how often, because that was its server's and did not ship.
       *
       * `burn({ light: { dps: 8, seconds: 3 } })` sets the player alight now, which is the only way
       * to see one until something in the game calls `afflict` on the player; it goes through
       * `afflict`, so it is refused while the player may not be hurt and the greater of two burns
       * still wins. `burn({ out: true })` puts it out in silence. `tick` is how often a blow lands
       * (a fraction a frame would lock the regeneration out for ever and flash the screen sixty
       * times a second), `cap` the guard on how long one affliction may keep you alight, and
       * `on: false` the switch that makes the game exactly what it was, putting out a fire already
       * lit as it goes.
       *
       * Try it with `__debug.advance`: `__debug.burn({ light: { dps: 8, seconds: 3 } })` then
       * `__debug.advance(3)` spends the whole burn -- three blows of 8 and the two lines on the
       * message line. `advance` hands a blow straight to the body rather than through the frame's
       * own callback, so on that path there is no red flash and a rider is burnt rather than spared;
       * both of those want a visible frame to be seen at all.
       */
      burn: (tune?: PlayerBurnTune & { light?: { dps: number; seconds: number }; out?: boolean }) => this.world.setPlayerBurn(tune),
      /**
       * Breath: the numbers in force and the air as it stands. Every one of them is **ours** and
       * there was nothing to copy -- you could not go under water in the game at all, so there is no
       * table, no column and no default anywhere in the archives for any of it.
       *
       * `seconds` is a full lungful, `recoverSeconds` how long a full one takes to come back in air,
       * `tick` how often a blow lands once the air is gone, `damage` what one blow takes (0 is a
       * breath that costs nothing to run out of), and `sayAfter` the patience at both ends of a dive,
       * which is what keeps a swimmer bobbing for mouthfuls from saying two lines a bob. `full` fills
       * the lungs now. Nothing here is saved and nothing rebuilds a program.
       */
      breath: (tune?: BreathTune & { full?: boolean }) => this.player.setBreath(tune),
      /**
       * The heat haze: what drew last frame and why it did not, with console tuning (`show` tints the
       * hot air cyan, `clientOffset`, `gate`, `fadeStart`, `fadeEnd`, `lift`, `plumeRange`,
       * `minPlumePixels`, `lavaNoiseRate`, `plumeNoiseRate`). Reads stored values only.
       */
      heat: (tune?: Partial<typeof heatTuning>) => {
        if (tune) {
          const into = heatTuning as Record<string, unknown>;
          for (const [k, v] of Object.entries(tune)) {
            // Only the known keys, each with a value of its own kind (a finite number where a number goes).
            if (!(k in heatTuning) || typeof v !== typeof into[k] || (typeof v === 'number' && !Number.isFinite(v))) continue;
            into[k] = v;
          }
        }
        const S = this.settings;
        const sources = { lavaTables: this.heat.lava.length, providers: this.heat.providerCount };
        const fx = this.postfx;
        if (!fx) return { effects: false, note: 'the heat haze is drawn by the effects chain; turn Effects on', setting: S.heatHaze, strength: S.heatHazeStrength, tuning: { ...heatTuning }, sources };
        const product = fx.product<HeatProduct>('heat');
        const row = fx.describe().passes.find((p) => p.id === 'heatHaze');
        return {
          effects: true,
          setting: S.heatHaze,
          strength: S.heatHazeStrength,
          tuning: { ...heatTuning },
          sources,
          product: product ? product.describe() : null,
          why: !product || !row ? 'the heat haze is not installed on this chain' : row.drewLastFrame ? null : (row.why ?? null),
        };
      },
      /**
       * The look under water: what the pass was given the last time it drew, what that came to, and
       * why it did not draw, with console tuning (`sight`, `tint`, `minLength`, `bodyMurk`,
       * `bodyMurkRef`, `murkLight`, `lightRef`, `nightFloor`, `lightCeil`, `lightDepth`,
       * `deepFloor`, `veilMax`, `veilDepth`, `surfaceEase`, `ceiling`, `shimmerUv`, `shimmerCells`,
       * `shimmerRate`, `shimmerReach`, `shimmerSurface`, `shimmerDeep`) Ã¢â‚¬â€ every key of
       * `UNDERWATER_TUNE` and nothing else, since `tuneUnderwater` silently drops a name that is not
       * one of its own rather than saying so. Reads stored values only. There was no under water in
       * the game, so every one of these numbers is ours.
       *
       * `shimmerCells` counts cells down the screen's **height**; the reply's `shimmerLattice` says
       * what that comes to across the width of the window really in use, and the most it may be
       * there before the field repeats inside one view.
       */
      underwater: (tune?: Partial<UnderwaterTune>) => {
        // Worked out before the write, since the write is what makes a good key indistinguishable
        // from a bad one: a name the tune has never heard of is dropped in silence otherwise.
        const ignored = unknownUnderwaterKeys(tune);
        const T = tuneUnderwater(tune);
        const S = this.settings;
        const setting = { on: S.underwater, strength: S.underwaterStrength, shimmer: S.underwaterShimmerStrength };
        const fx = this.postfx;
        if (!fx) return { effects: false, note: 'the look under water is drawn by the effects chain; turn Effects on', setting, ignored, tuning: { ...T } };
        const pass = fx.pass<UnderwaterPass>('underwater');
        const row = fx.describe().passes.find((p) => p.id === 'underwater');
        const water = this.world.cameraWater;
        return {
          effects: true,
          setting,
          // Empty unless something typed was not written: a misspelling, a dead name, a word where
          // a number goes. It is not an error Ã¢â‚¬â€ the rest of the call went through.
          ignored,
          tuning: { ...T },
          under: { under: water.under, depth: water.depth, opacity: water.opacity },
          look: pass ? pass.describe() : null,
          why: !pass || !row ? 'the look under water is not installed on this chain' : row.drewLastFrame ? null : (row.why ?? null),
        };
      },
      /** A plume 5 m ahead of the camera, crossing the view left to right, for `seconds`: the haze without a vehicle or a gun. */
      heatPlume: (seconds = 10) => {
        const start = performance.now();
        const cam = this.cam.camera;
        const fwd = new THREE.Vector3();
        const right = new THREE.Vector3();
        const at = new THREE.Vector3();
        let remove = () => {};
        remove = this.heat.addProvider((sink) => {
          const elapsed = (performance.now() - start) / 1000;
          // The remover only marks it: the list drops it after the loop that is running.
          if (!(elapsed <= seconds)) {
            remove();
            return;
          }
          cam.getWorldDirection(fwd);
          right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
          at.setFromMatrixPosition(cam.matrixWorld).addScaledVector(fwd, 5).addScaledVector(right, -3);
          sink.push(at.x, at.y, at.z, right.x, right.y, right.z, 6, 0.3, 1.2, 1.4, (elapsed * 6 * plumeNoiseFrequency(1.2) + 0.25) % 1);
        });
        return { seconds, providers: this.heat.providerCount, effects: !!this.postfx, setting: this.settings.heatHaze };
      },
      /**
       * How much the water's own surface hides of what is under it, which is the owner's "I can see
       * as far as possible through the surface of the water". It is not an effect: it is uniforms on
       * the one program every lake and sea already wears, so it holds with the Effects setting off
       * exactly as with it on, and it is the one water knob that does.
       *
       * `waterSurface()` reports the tuning and what the card is holding. `{ hide: 0 }` is the
       * switch -- the water exactly as it was, every body and every depth -- and `{ hide: 1 }` puts
       * it back. `{ most: 0.88 }` lets more of the bed through over deep water and `{ deep: 9 }`
       * makes the water have to be deeper before it hides anything. Nothing is compiled by any of
       * it and nothing is read on a frame: the numbers are pushed into two shared uniform objects
       * when they are written. Every one of them is ours; the game had no such rule.
       */
      waterSurface: (tune?: Partial<WaterSurfaceTune>) => {
        const T = setWaterSurface(tune);
        const v = WATER_SURFACE_HIDE.value;
        return {
          tuning: { ...T },
          // What the card is holding, which is the tuning after its own clamps: the strength, the
          // opacity deep water reaches, and the two depths it runs between.
          uniform: { hide: v.x, most: v.y, shallow: v.z, deep: v.w, eyeBand: WATER_SURFACE_BAND.value },
          note: "the water's own material, so this holds with the Effects setting off as well",
        };
      },
      /**
       * Every water body with the shader it came from, its look, what it reflects and whether it
       * is on screen. `waterFx({ env: 'shader' })` switches every body to its own shader's cube
       * map, `{ env: 'sky' }` back to the area's day and night map; `{ envIntensity }` changes how
       * hard the water mirrors. With the effects on, `{ view }` shows what the reflections pass
       * traces ('confidence': red traced, blue fallback), adds ('added'), the fallback alone
       * ('envOnly', which must look exactly like the pass off) or the traced part alone
       * ('tracedOnly'); 'off' is the picture. The march takes `maxDistance`, `thickness`,
       * `thicknessPerMetre`, `minWeight`, `sky` and `strength`. Use it as `await __debug.waterFx(...)`.
       */
      waterFx: async (opts?: {
        env?: 'sky' | 'shader';
        envIntensity?: number;
        view?: 'off' | 'confidence' | 'added' | 'envOnly' | 'tracedOnly';
        maxDistance?: number;
        thickness?: number;
        thicknessPerMetre?: number;
        minWeight?: number;
        sky?: boolean;
        strength?: number;
      }) => {
        const bodies = this.world.waterBodies;
        if (opts?.envIntensity !== undefined) bodies.envIntensity = opts.envIntensity;
        if (opts?.env && opts.env !== bodies.envMode) await bodies.setEnvMode(opts.env);
        else bodies.refresh();
        const fx = this.postfx;
        type Tune = { maxDistance: number; thickness: number; thicknessPerMetre: number; minWeight: number; sky: boolean; strength: number; view: number };
        const pass = fx?.pass('waterReflections') as unknown as { tune: Tune; views: Record<string, number> } | undefined;
        if (pass && opts) {
          if (opts.view !== undefined) pass.tune.view = pass.views[opts.view] ?? 0;
          for (const k of ['maxDistance', 'thickness', 'thicknessPerMetre', 'minWeight', 'strength'] as const) if (typeof opts[k] === 'number') pass.tune[k] = opts[k];
          if (opts.sky !== undefined) pass.tune.sky = opts.sky;
        }
        const row = fx?.describe().passes.find((p) => p.id === 'waterReflections');
        const mask = fx?.product('waterMask') as unknown as { allocated: boolean; drawn: number; idleFor(ctx: unknown): number } | undefined;
        return {
          ...bodies.describe(this.cam.camera.position),
          pass: pass && row ? { drewLastFrame: row.drewLastFrame, why: row.why ?? null, gpuMs: row.gpuMs, tune: { ...pass.tune } } : null,
          mask: mask && fx ? { allocated: mask.allocated, drawn: mask.drawn, idleSeconds: Number(mask.idleFor(fx.ctx).toFixed(1)) } : null,
        };
      },
      /** Placed objects within r metres of the player: model, distance, tier, and whether the model and its region are loaded. */
      near: (r = 150) => {
        const list = this.world.objectsNear(this.player.pos.x, this.player.pos.z, r);
        const summary = { total: list.length, notInManifest: list.filter((o) => !o.inManifest).length, notLoaded: list.filter((o) => o.inManifest && !o.loaded).length, regionsNotLoaded: [...new Set(list.filter((o) => o.regionState !== 'loaded').map((o) => `${o.region}/tier${o.tier}:${o.regionState}`))] };
        console.table(list.slice(0, 60));
        return summary;
      },
      /** Movement rules: 'jka' (Jedi Academy's, the default on this branch) or 'swg' (the original numbers). Reports the current one. */
      profile: (name?: 'jka' | 'swg') => {
        if (name) this.player.moveProfile = name;
        return this.player.moveProfile;
      },
      /** Rebind an action to one or more keys (KeyboardEvent.code names, or Mouse0/Mouse1/Mouse2); no keys restores the default. Kept in local storage. */
      bind: (action: Action, ...codes: string[]) => {
        this.input.bind(action, codes);
        notifyBindingsChanged();
        return this.input.bindings[action];
      },
      /** Every action and the keys bound to it. */
      bindings: () => ({ ...this.input.bindings }),
      resetBindings: () => {
        this.input.resetBindings();
        notifyBindingsChanged();
      },
      /**
       * The mixer, and its live numbers. Nothing can be heard from a driven tab, so this is how
       * sound is checked headless: the context's state (`suspended` means nobody has clicked yet),
       * every voice with its layer, priority, slot and the gain the listener would hear it at, the
       * voices refused a slot, the grid's pass, the bank (templates, samples, memory) and the last
       * dozen sounds asked for with what became of each. With an object it also tunes, live:
       * `{ distance: { audible: 12 } }`, `{ voices: { positional: 24 } }`, `{ grid: { rate: 2 } }`
       * and `{ mixer: { writeRate: 60 } }`, each merged into the invented numbers of its kind. The
       * echo's own are in `mixer` too: `echoSend` (a pair), `echoEase`, and `echoRoom`, which
       * stands in for the interior table's room type so the two echoes can be compared anywhere.
       */
      audio: (opts: { distance?: Record<string, number>; voices?: Record<string, number>; grid?: Record<string, number>; mixer?: Record<string, number> } = {}) => {
        if (opts.distance) Object.assign(this.audio.distance, opts.distance);
        if (opts.grid) Object.assign(this.audio.grid.tune, opts.grid);
        if (opts.mixer) Object.assign(this.audio.tune, opts.mixer);
        // A source's reach and its cell are worked out when it is filed, so moving either the
        // audible radius or the cell edge has to file everything again or the change reaches
        // nothing already in the grid.
        if (opts.distance || opts.grid) this.audio.grid.rebuild();
        if (opts.voices) console.warn('audio: the voice pools are sized when the mixer is made; reload after changing them in voices.ts');
        return { ...this.audio.status(), tune: { distance: { ...this.audio.distance }, grid: { ...this.audio.grid.tune }, mixer: { ...this.audio.tune } } };
      },
      /**
       * Play one of the game's sound templates by its archive path, at the player (`sound(id)`),
       * at a point (`sound(id, [x, y, z])`) or with no place at all (`sound(id, false)`). Returns
       * the voice's key, or 0 with the reason in `audio().recent`.
       */
      sound: (id: string, where?: [number, number, number] | false) => {
        if (where === false) return this.audio.play(id);
        const at = where ?? this.player.worldPos.toArray();
        return this.audio.play(id, { x: at[0], y: at[1], z: at[2] });
      },
      /**
       * The per-category multiplier over the game's own volumes (an invented knob, 1 by default),
       * for settling how the very quiet one-shot beds are meant to read against their bed. The
       * categories are the game's own: 0 ambient, 1 explosion, 2 item, 3 movement, 4 interface,
       * 5 vehicle, 6 vocalization, 7 weapon, 10 machine, 13 voice-over. No argument lists them.
       */
      soundGain: (category?: number, value?: number) => {
        if (category !== undefined && value !== undefined && category >= 0 && category < this.audio.categoryGain.length) this.audio.categoryGain[category] = value;
        return [...this.audio.categoryGain];
      },
      /**
       * The sound of the place, headless: which of the sky's own rows are playing and at what share
       * of the frame, the day fraction the beds are crossfaded by, how much of the frame the room
       * the player is in has taken and which of the interior table's rows that is, the planet's
       * placed sound objects (how many the pack holds, how many are within earshot, how many hold a
       * voice), the loops its particle effects name, and each weather channel's own sound.
       *
       * With an object it tunes, live: `{ dayFade: 5 }` and `{ roomFade: 0.2 }` make the two
       * crossfades quick enough to see in one walk, and `{ weatherParticles: true }` adds the
       * thunder the rain sheets carry to the thunder the storm rows already play (the owner's
       * decision 5, which is off by default so the two do not double). The placed sound objects'
       * own three numbers (`cap`, `spaceTries`, `spaceGiveUp`) go in the same object and take from
       * the next grid pass; `cap` is read when a planet's places are put down, so it takes on the
       * next arrival.
       */
      ambience: (opts: Partial<AmbienceTune & WorldSourceTune> = {}) => {
        const a = this.world.ambience;
        if (!a) return { ok: false, why: 'the world has no mixer' };
        // Each number goes to the tune it belongs to: the two are separate objects, one on the
        // ambience and one on its sources, and a key named in neither is said rather than dropped.
        const unknown: string[] = [];
        for (const [key, value] of Object.entries(opts)) {
          if (key in a.tune) (a.tune as unknown as Record<string, unknown>)[key] = value;
          else if (key in a.sources.tune) (a.sources.tune as unknown as Record<string, unknown>)[key] = value;
          else unknown.push(key);
        }
        if (unknown.length) console.warn(`ambience: nothing here is tuned by ${unknown.join(', ')}`);
        return { ...a.status(), tune: { ...a.tune, ...a.sources.tune } };
      },
      /**
       * Renders a known sound through an offline context and checks it came out at the gain the
       * master and the Effects slider ask for: the one check of the audio path that needs neither a
       * click nor the sound pack. `ok` false with `peak` 0 is a broken chain; `suspended` in
       * `audio().state` is only an unlock, which this does not need.
       */
      audioSelfTest: () => this.audio.selfTest(),
      /**
       * Feet and voices, headless: the last foot events with the clip that marked each, what the
       * foot was taken to have landed on and which of the four sources said so (water, room,
       * object, terrain), the sound that was chosen and whether it got a voice; then which bodies
       * are being watched, which client data each speaks from, and how many events have been
       * crossed at all. `footsteps(n)` prints the last n as a table.
       *
       * With an object it tunes, live, every invented number of its kind: the watching range
       * (`range`), the idle loops' range (`loopRange`), the wading depths (`wade`, `swim`), the
       * ray that finds what is stood on (`probe`, `reach`, which the world reads from the same
       * object), the hunting call's spread (`call`), the fall after a death (`deathFall`) and the
       * default surface (`fallback`); the clip reader's own three (`maxStep`, `speakWeight`,
       * `footWeight`); and how many chunks' ground families are kept (`familyChunks`, reported
       * beside it as `ground`). A key named in none of the three is said rather than dropped.
       */
      footsteps: (n = 12, opts: Partial<FootTune & ClipEventTune & typeof FAMILY_TUNE> = {}) => {
        const unknown: string[] = [];
        for (const [key, value] of Object.entries(opts)) {
          if (key in this.feet.tune) (this.feet.tune as unknown as Record<string, unknown>)[key] = value;
          else if (key in CLIP_EVENT_TUNE) (CLIP_EVENT_TUNE as unknown as Record<string, unknown>)[key] = value;
          else if (key in FAMILY_TUNE) (FAMILY_TUNE as unknown as Record<string, unknown>)[key] = value;
          else unknown.push(key);
        }
        if (unknown.length) console.warn(`footsteps: nothing here is tuned by ${unknown.join(', ')}`);
        const log = this.feet.log.slice(-Math.max(1, n));
        console.table(log);
        return { ...this.feet.status(), ground: { familyChunksHeld: this.inWorld ? this.world.terrain.familyChunks : 0, familyChunks: FAMILY_TUNE.familyChunks }, recent: log };
      },
      /**
       * The prints feet leave, headless: the last dozen laid (the body, the ground, which foot,
       * where, how steep the ground was, what it was laid on and how long it will last), how many
       * steps were taken and what became of each -- laid, refused for hard ground, refused aboard a
       * hull, or too soon after the last one -- and which surfaces keep a print at all. `drawn`
       * false means nothing is wired to the marks system and nothing is being drawn.
       *
       * With an object it tunes, live, every invented number of its own: whether prints are laid at
       * all (`enabled`), a print's `length` and `width`, half the distance between a body's feet
       * (`stance`), how long one lasts (`life`), how much of that life the ground's own grading is
       * spent on (`strengthLife`), how far a body must move before it leaves another (`minStep`),
       * the most a creature's own size may grow one by (`maxScale`) and how many bodies' feet are
       * remembered (`bodies`). A key named in none of them is said rather than dropped. Which
       * ground keeps a print is a table, not a number: `PRINT_SURFACES` in `src/world/surfaces.ts`.
       */
      footprints: (opts: Partial<typeof footprints.tune> = {}) => {
        const unknown: string[] = [];
        for (const [key, value] of Object.entries(opts)) {
          if (key in footprints.tune) (footprints.tune as unknown as Record<string, unknown>)[key] = value;
          else unknown.push(key);
        }
        if (unknown.length) console.warn(`footprints: nothing here is tuned by ${unknown.join(', ')}`);
        return footprints.status();
      },
      /**
       * The guns, headless: the last shots, hits, misses, flybys, blows and blasts as a table, each
       * with the gun it came from, the surface it was taken to have struck and the voice it got
       * (`key` 0 means the mixer refused it, and `audio().recent` says why). Beside them: the two
       * tables the sounds are looked up in, whether the planet's own surfaces and the projectile
       * table have landed, whether the sabers have installed their hooks, and the counts (`fires`
       * against `firesPlayed`, `volleys` swallowed as one shot, `hits`, `misses`, `flybys`).
       *
       * With a gun's id (`gunSounds('carbine_dc15')`) it prints that weapon's whole set instead --
       * its shot, its five hit surfaces, its three misses -- which is how a gun that sounds wrong is
       * traced to the row it came from. With an object it retunes the invented numbers live:
       * `flyby` and `flybyGap` (how near a bolt must pass to whine, and how often), `volley` (how
       * close together two shots of one gun are one shot), `blast` (the radii at which an explosion
       * is small, medium or large) and `heldFade`. The ray that asks what a bolt struck is the
       * feet's own, tuned by `footsteps({ probe, reach })`: it is the same ray asking the same
       * question.
       */
      gunSounds: (which?: string | Partial<CombatTune>, n = 12) => {
        if (typeof which === 'object') {
          const unknown: string[] = [];
          for (const [key, value] of Object.entries(which)) {
            if (key in combatSounds.tune) (combatSounds.tune as unknown as Record<string, unknown>)[key] = value;
            else unknown.push(key);
          }
          if (unknown.length) console.warn(`gunSounds: nothing here is tuned by ${unknown.join(', ')}`);
        } else if (typeof which === 'string') {
          const def = this.weapons?.weapons.find((w) => w.id === which) ?? null;
          if (!def) return { ok: false, why: `the rack has no ${which}` };
          return { weapon: def.id, template: def.template, class: def.class, sound: combatSounds.gunOf(def) };
        }
        const log = combatSounds.log.slice(-Math.max(1, n));
        console.table(log);
        return { ...combatSounds.status(), recent: log };
      },
      /**
       * The machines, headless: every vehicle in the world with the engine sounds it chose and where
       * they came from (`part` the fitted engine part's own client data, `hull ASND` or `VSND` the
       * hull's, `flyby family` the run loop of the family its chassis's flyby names, `none` nothing
       * at all), its wing, flyby and hit-sound rows, and the last few things that sounded.
       * `from: 'none'` on a ship you can hear is the one number that says a hull is silent, and
       * `counts.silent` how many machines in the world now are. `voices` is what each of a
       * machine's three is playing at this moment and on which key, which is the only way to see
       * that a voice is holding the sound it was started with rather than the one wanted now.
       *
       * With an object it retunes the invented numbers live: `crossAt` (the share of top speed the
       * run loop is full at), `open`/`close` (the throttle's two edges), `pitchSpan`, `doppler` and
       * `soundSpeed` (the Doppler's arithmetic), `flyby`, `flybySpeed` and `flybyGap`, `parkedGain`,
       * `water`, the `swapUp`/`swapDown` band an unflown ship changes loop at, `swapFade`, `retry`
       * (how long a voice the mixer had none free for waits), `moveStep` (how far a machine moves
       * before its voice's place is written again), `lockGap` (how soon the lock tone may sound
       * again) and `liftLevel` (how far apart two lift stops must be for the pick to be a ride).
       * A number that changes how a voice sounds takes effect on that voice's next loop.
       */
      vehicleSounds: (tune?: Partial<VehicleTune>, n = 12) => {
        if (tune) {
          const unknown: string[] = [];
          for (const [key, value] of Object.entries(tune)) {
            if (key in vehicleSounds.tune) (vehicleSounds.tune as unknown as Record<string, unknown>)[key] = value;
            else unknown.push(key);
          }
          if (unknown.length) console.warn(`vehicleSounds: nothing here is tuned by ${unknown.join(', ')}`);
        }
        const status = vehicleSounds.status();
        console.table(status.machines as Record<string, unknown>[]);
        const log = vehicleSounds.log.slice(-Math.max(1, n));
        console.table(log);
        return { ...status, recent: log };
      },
      /**
       * What is under a point right now and which of the four sources says so: with no argument the
       * player's own feet, else a point. This is how a surface that sounds wrong is tracked down --
       * it names the room's row, the object template under the foot and the terrain's own surface
       * template, so the answer can be told from the data it came from.
       */
      surface: (at?: [number, number, number]) => {
        const p = at ? { x: at[0], y: at[1], z: at[2] } : this.player.worldPos;
        return this.feet.probe(p.x, p.y, p.z, at ? this.world.inside : this.world.inside || !!this.player.aboard);
      },
      /**
       * The saber system's state: style, current move, chain count, whether the rig has Jedi Academy's clips, the special
       * jump in progress, and the thrown saber's flight; and `hit`, which is where a blade lands -- this swing's hits, what
       * last frame's blades cost in casts and sub-steps, the brush's last victims and the tuning. Any of `SABER_HIT`
       * (`stepLength`, `maxSteps`, `jump`, `gap`, `carry`, `brushShare`, `brushEvery`, `brushRadius`, `brushPush`) moves it
       * live, and `hit.tune` is what to bake; `__debug.saber({ brushShare: 0 })` is the switch that makes the game what it was.
       */
      saber: (opts?: Partial<SaberHitTune>) => ({ hit: saberHitReport(opts), blade: (() => { const a = new THREE.Vector3(); const b = new THREE.Vector3(); this.player.bladeSegmentAt(0, a, b); return { hilt: a.toArray().map((v) => Number(v.toFixed(3))), tip: b.toArray().map((v) => Number(v.toFixed(3))) }; })(), blade2: (() => { if (this.player.bladeCount < 2) return null; const a = new THREE.Vector3(); const b = new THREE.Vector3(); this.player.bladeSegmentAt(1, a, b); return { hilt: a.toArray().map((v) => Number(v.toFixed(3))), tip: b.toArray().map((v) => Number(v.toFixed(3))) }; })(), style: this.player.saber.style, move: this.player.saber.move, chain: this.player.saber.chainCount, timer: Number(this.player.saber.timer.toFixed(2)), jkaClips: this.player.hasJkaClips, on: this.player.saberOn, special: this.player.jka.specialJump, thrown: this.player.thrown.inFlight ? { returning: this.player.thrown.returning, at: this.player.thrown.pos.toArray().map((v) => Number(v.toFixed(2))) } : null }),
      /** Particle effects within r metres of the player: file, distance, whether playing, live particles. With `verbose`, every emitter: texture, blend, whether the texture loaded, and the first particle's size, alpha, colour and screen position. */
      particles: (r = 200, verbose = false) => {
        const list = this.world.particlesNear(this.player.pos.x, this.player.pos.z, r);
        console.table(list.slice(0, 60));
        if (verbose) {
          const emitters = this.world.emittersNear(this.player.pos.x, this.player.pos.z, r);
          console.table(emitters.slice(0, 60));
          console.log(JSON.stringify(emitters.slice(0, 60)));
        }
        return { status: this.world.particleStatus, total: list.length, playing: list.filter((p) => p.playing).length };
      },
      /** Scale the sky's fog density (1 is the client's value) and report it. */
      fog: (scale?: number) => {
        if (scale !== undefined) this.world.fogScale = scale;
        return { scale: this.world.fogScale, density: (this.scene.fog as THREE.FogExp2 | null)?.density ?? null };
      },
      /** Set the time of day (0 midnight, 0.5 noon) and report the sky's current lighting. */
      time: (t?: number) => {
        if (t !== undefined) this.world.day.time = t;
        const L = this.world.swgSky?.lighting;
        return { time: this.world.day.time, clock: this.world.day.clock(), swg: this.world.day.swg, isDay: this.world.day.isDay, index: this.world.day.colorIndex, light: this.world.day.lightDir.toArray().map((v) => Number(v.toFixed(2))), lighting: L ? { main: L.main.getHexString(), mainScale: Number(L.mainScale.toFixed(2)), ambient: L.ambient.getHexString(), fog: L.fog.getHexString(), fogDensity: L.fogDensity, sunMoonAlpha: L.sunMoonAlpha, starAlpha: L.starAlpha } : null };
      },
      /** The clock the world shares and what the day is doing with it; see `__sharedDay`. */
      day: (opts?: Parameters<typeof clockKnob>[0]) => clockKnob(opts),
      /** Simulate `seconds` of play at 60 Hz with the given keys held (KeyboardEvent codes or Mouse0..2), without waiting on real frames: movement, the weapons, the bolts and the turrets. With `hold`, the keys stay down afterwards (a later call without it releases them), so a key is not pressed afresh each call. */
      advance: (seconds: number, keys: string[] = [], hold = false) => {
        for (const k of keys) this.input.force(k, true);
        const dt = 1 / 60;
        // Ten simulated seconds run in a fraction of a real one: whatever they would have sounded
        // is recorded and nothing is started, or a visible tab would burst with a minute of noise.
        this.audio.advancing = true;
        try {
          for (let i = 0; i < Math.round(seconds / dt); i++) {
            this.stepEmoteKeys();
            this.stepEmoteEnd();
            this.player.update(dt, this.input, this.cam, this.world);
            this.scorch(dt);
            this.stepCombat(dt);
            // The jump's clock (its countdown and phases); the transit itself waits on drawn frames and streaming, which this does not give.
            if (!this.traveling) this.hyperspace.update(dt, dt, false);
            // The ultra cruise's own clock, before the hulls step, as the frame loop has it: a run
            // can be started and watched to its stop with no frames drawn at all.
            this.ultraCruise.update(dt);
            this.stepVehicles(dt, true);
            if (!this.player.noclip && !this.player.mounted) this.world.turrets.update(dt, this.player, this.world.bolts);
            // Where the player stands first, then one step of everything alive: without the first,
            // the brains would all chase where the player was when the helper was called.
            this.world.setPlayerTarget(this.player.worldPos, !this.player.noclip && this.player.hp > 0, (dmg) => this.player.takeDamage(dmg));
            this.world.stepLiving(dt, this.player.worldPos, this.cam.camera);
            this.physics.step(dt);
            // The blades are drawn and then weighed against one another here as they are in the
            // frame loop. A driven tab draws no frames at all, and the clashes run on `simTime`
            // like everything else with a clock, so without these two lines `__debug.clash()`
            // could only ever report zeros -- including the owner's own check that `reach: 0`
            // changed nothing. The peers are not stepped by this helper, so their blades are not
            // drawn here either and only the player's, the fighters' and the catalogue's meet.
            this.player.drawBlades(dt, this.cam.camera);
            this.stepClashes();
            this.effects.update(dt);
            this.updateCamera(null);
            // The feet step with the simulation: the mixer is recording rather than playing, so a
            // helper can count the steps a walk took without the tab bursting into noise.
            const eye = this.cam.camera.position;
            this.stepFeet(dt, eye.x, eye.y, eye.z);
            // The machines step with them, for the same reason: a driven tab draws no frames at all,
            // so without this `vehicleSounds()` would list nothing after a simulated minute of flight.
            vehicleSounds.setListener(eye.x, eye.y, eye.z, this.listenerPose.space);
            this.stepVehicleSounds(dt);
            this.input.endFrame();
          }
        } finally {
          this.audio.advancing = false;
        }
        if (!hold) for (const k of keys) this.input.force(k, false);
      },
      /**
       * What `advance` costs: simulate `seconds` and say how long of the wall clock it really took.
       * This is one call rather than a line the owner has to type because it settles a question
       * nobody can answer from a hidden tab -- whether the helper can stand in for a long walk at
       * all. Above about 250 ms of real time per ten simulated seconds it cannot, and a walk should
       * be watched in a visible window with the owner following on a speeder instead.
       *
       * Note the second half of that answer, which timing cannot show: `advance` never calls
       * `world.update`, so **nothing streams** -- no chunk is built and no collider appears round
       * the walking body. A long walk driven by this helper is inconclusive by construction, and
       * `__debug.send()` will say so.
       */
      advanceCost: (seconds = 10) => {
        const dbg = (window as unknown as { __debug: { advance(s: number): void } }).__debug;
        const t0 = performance.now();
        dbg.advance(seconds);
        const ms = performance.now() - t0;
        const per10 = (ms / Math.max(0.001, seconds)) * 10;
        return {
          simulated: seconds,
          realMs: Math.round(ms),
          msPerTenSimulatedSeconds: Math.round(per10),
          fighters: this.world.npcs.npcs.length,
          verdict: per10 <= 250 ? 'the helper is cheap enough to drive a long walk with -- but it still streams nothing, so the walk proves nothing about collision' : 'too slow to drive a long walk: watch one in a visible window, following on a speeder',
        };
      },
      /** With the effects on: scan the frame for pixels that are not numbers (what the bloom smears into a black box) and name the object under the first one. */
      blackBox: () => {
        if (!this.postfx) return 'the effects are off (turn Effects on): the scan reads their frame';
        this.postfx.wantScan = true;
        this.drawFrame();
        const s = this.postfx.lastScan;
        if (!s) return 'no scan';
        let under: Record<string, unknown> | null = null;
        if (s.first) {
          const ray = new THREE.Raycaster();
          ray.setFromCamera(new THREE.Vector2((s.first[0] / s.width) * 2 - 1, -(s.first[1] / s.height) * 2 + 1), this.cam.camera);
          const hits = ray.intersectObjects(this.scene.children, true);
          const hit = hits.find((h) => h.object.visible);
          if (hit) {
            const o = hit.object as THREE.Mesh;
            const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material | undefined;
            let named: THREE.Object3D | null = o;
            while (named && !named.name) named = named.parent;
            under = { object: o.name || '(unnamed)', named: named?.name ?? null, parents: [o.parent?.name, o.parent?.parent?.name].filter(Boolean), material: mat?.type, materialName: mat?.name, distance: Number(hit.distance.toFixed(1)), userData: o.userData };
          }
        }
        return { ...s, under };
      },
      /** The colour grade now: what the sky gave, the planet's look, the terms and parameters, how far it still lags the sky, and the room weight. `grade({ compare: 0.5 })` splits the screen (ungraded on the left), `grade({ look: { gloom: 0.3 } })` tries a look live and logs the line for the table, `grade({ look: {} })` shows the planet with none and `grade({ look: null })` puts it back; `freeze`, `params` and `room` force the rest. */
      grade: (
        opts: {
          look?: import('./core/fx/gradeMath').GradeLook | null;
          freeze?: boolean;
          params?: Partial<import('./core/fx/gradeMath').GradeParams> | null;
          compare?: number | null;
          room?: number | null;
        } = {},
      ) => {
        const pass = this.gradePass();
        if (!this.postfx || !pass) return 'the effects are off (turn Effects on): the grade is one of their passes';
        if ('look' in opts) {
          pass.lookOverride = opts.look ?? null;
          if (opts.look) console.info(`GRADE_LOOKS: ${this.world.planet?.id ?? ''}: ${JSON.stringify(opts.look)},`);
        }
        if ('freeze' in opts) pass.frozen = !!opts.freeze;
        if ('params' in opts) pass.forcedParams = opts.params ?? null;
        if ('compare' in opts) pass.compare = opts.compare ?? null;
        if ('room' in opts) pass.forcedRoom = opts.room ?? null;
        if (!this.settings.colorGrade) return 'the colour grade is off (Menu, Graphics, Effects)';
        return pass.report(this.postfx.ctx);
      },
      /** Draw the grade's own shader over known colours and compare every texel with the JavaScript the node test sweeps: `ok` false means the two have drifted apart. */
      gradeSelfTest: () => {
        const pass = this.gradePass();
        if (!pass) return 'the effects are off (turn Effects on): the self test draws the gradeÃ¢â‚¬â„¢s own shader';
        return pass.selfTest(this.renderer);
      },
      /** An estimate of how far the grade moves the frame just drawn: `darkened` and `brightened` should both be 0. */
      gradeCheck: () => {
        const pass = this.gradePass();
        if (!this.postfx || !pass) return 'the effects are off (turn Effects on): the check reads their frame';
        this.drawFrame();
        return pass.check(this.renderer, this.postfx.sceneTarget);
      },
      /** Draw `n` frames back to back with the GPU waited on after each, and report the milliseconds one takes; `await bench(30, false)` first turns the effects off, `bench(30, true)` on. */
      bench: async (n = 30, effects?: boolean) => {
        if (effects !== undefined && effects !== this.settings.effects) {
          this.settings.effects = effects;
          await this.reconcileEffects();
        }
        const gl = this.renderer.getContext();
        this.drawFrame();
        gl.finish();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          this.drawFrame();
          gl.finish();
        }
        const ms = (performance.now() - t0) / n;
        return { effects: !!this.postfx, msPerFrame: Number(ms.toFixed(2)), fps: Math.round(1000 / ms), calls: this.frameCalls, passes: this.portals.passes };
      },
      /** Open or close the map window (M), on its `'here'` or `'galaxy'` tab. */
      map: (tab?: 'here' | 'galaxy') => {
        if (this.map.open && !tab) this.toggleMap();
        else if (!this.map.open) this.toggleMap();
        if (tab && this.map.open) this.map.show(tab);
        return this.map.open ? `map open on ${tab ?? 'here'}` : 'map closed';
      },
      /** The converted sky's parts (the dome, the skybox faces, the stars, space dust, the sun and star sprites) and its lighting now; `sky('skybox')` and the like toggle a part to see what it contributes. */
      sky: (toggle?: 'dome' | 'skybox' | 'stars' | 'dust' | 'sprites') => this.world.swgSky?.describe(toggle) ?? 'no converted sky on this world',
      /**
       * Which star lights this space zone, and what stops its rays. No argument: the pick, every
       * star the zone has, and how far the zone file's own light points from the one chosen.
       * `suns({ rule: 'disc' })` lights it from the largest disc instead of the brightest glow and
       * `{ rule: 'glow' }` puts it back, both at once, with the shadows, the flare and the rays
       * following. `{ companionDegrees }` changes how near a second star must be to flare beside the
       * sun, `{ skyShare }` where the rays count a pixel as open sky (a share of the far plane), and
       * `{ standInDistance }` how far out, in metres, a planet writes the depth that stops them,
       * which is read when a zone's bodies are built, so it shows on the next arrival. Nothing
       * here is saved.
       */
      /**
       * The ultra cruise. No argument: the run's state, its speed, how far it has gone, how many
       * stops it is watching, whether a program was built during the last run (which must be 0) and
       * why it cannot run here when it cannot. `'toggle'` starts a run or lets go of one, the same
       * as the key. An object tunes it live and nothing is saved: `{ top }` the top speed in m/s,
       * `{ spinUp, brake }` the seconds up and down, `{ standOff }` how far short of a planet's
       * surface it stops, `{ edge }` how far the system reaches, `{ countdown, settleWait }` the
       * two waits, `{ fxAhead, fxTurn }` where the streaks sit on the hull.
       */
      cruise: (arg?: 'toggle' | Partial<typeof CRUISE_TUNE>) => {
        if (arg === 'toggle') return this.ultraCruise.toggle();
        if (arg && typeof arg === 'object') tuneCruise(arg);
        return this.ultraCruise.describe();
      },
      suns: (opts?: { rule?: SunRule; companionDegrees?: number; skyShare?: number; standInDistance?: number; quadAt?: number; quadTan?: number; quadMargin?: number }) => {
        const sky = this.world.swgSky;
        // `quadAt`, `quadTan` and `quadMargin` are the depth stand-in of a body that stands somewhere
        // in the zone rather than hanging on the sky; they take effect on the next frame drawn.
        if (opts && (opts.companionDegrees !== undefined || opts.skyShare !== undefined || opts.standInDistance !== undefined || opts.quadAt !== undefined || opts.quadTan !== undefined || opts.quadMargin !== undefined)) tuneSpaceSky(opts);
        // Any of them can change which star keeps the sun company, so the pick is made again.
        if (opts) sky?.setSunRule(opts.rule ?? (sky.sunStar?.chosenBy === 'disc' ? 'disc' : 'glow'));
        const pick = sky?.sunStar ?? null;
        if (!pick) return { sun: 'no space zone here: a planet is lit by its day cycle', rays: { ...SPACE_SKY_TUNE } };
        return {
          rule: pick.chosenBy,
          ours: 'the game says nothing about which star is the sun; this rule is ours',
          sun: pick.sun ? { at: [pick.sun.yaw, pick.sun.pitch], disc: pick.sun.discSize, glow: pick.sun.glowSize } : null,
          companion: pick.companion ? { at: [pick.companion.yaw, pick.companion.pitch], glow: pick.companion.glowSize } : null,
          secondFlare: pick.second ? { at: [pick.second.yaw, pick.second.pitch], glow: pick.second.glowSize } : null,
          degreesFromFileLight: pick.lightOffDegrees === null ? null : Number(pick.lightOffDegrees.toFixed(1)),
          stars: pick.groups.length,
          lightDir: sky?.spaceLightDir?.toArray().map((v) => Number(v.toFixed(3))) ?? null,
          rays: { ...SPACE_SKY_TUNE },
        };
      },
      /**
       * The weather. No argument: the state (area, level, mix, effects, wetness, the roof grid, programs, cpuMs).
       * A number holds a level; 'rain' | 'dust' | 'snow' (and a level, 3 by default) forces a kind; null returns
       * to the schedule. An object: { level, kind, family, lifeDay, snap } force (merged with what is forced);
       * { wetness, puddles, snowCover } set at once; { timeScale, skip } run or skip the schedule's clock
       * (minutes); { find: 'moseisley' } where an area is (then __debug.teleport(x, z)); { windHeading } holds
       * the wind (radians, null frees it); { emitters: true } adds the falling effects' emitter rows;
       * { draw: false } skips the weather pass (to time it); { wrap: false | true } whether world materials
       * get the wet wrap (read at load: reload to apply).
       */
      weather: (arg?: number | 'rain' | 'dust' | 'snow' | null | Record<string, unknown>, level?: number) => {
        const w = this.world.weather;
        let emitters = false;
        if (arg === null) w.force(null);
        else if (typeof arg === 'number') w.force({ ...(w.forcedNow ?? {}), level: arg });
        else if (typeof arg === 'string') w.force({ ...(w.forcedNow ?? {}), kind: arg, level: level ?? 3 });
        else if (arg && typeof arg === 'object') {
          const o = arg as Record<string, unknown>;
          if (typeof o.find === 'string') return this.world.terrain.swg?.environmentAreaCentre(o.find) ?? 'no such area';
          if ('wrap' in o) {
            try {
              if (o.wrap === false) localStorage.setItem('swg.weather.wrap', '0');
              else localStorage.removeItem('swg.weather.wrap');
            } catch {
              return 'no storage in this browser';
            }
            return 'reload to apply';
          }
          const patch: Record<string, unknown> = {};
          for (const k of ['level', 'kind', 'family', 'lifeDay', 'snap']) if (k in o) patch[k] = o[k];
          if (Object.keys(patch).length) w.force({ ...(w.forcedNow ?? {}), ...(patch as import('./world/weather').WeatherForce) });
          const wet: Record<string, number> = {};
          for (const k of ['wetness', 'puddles', 'snowCover']) if (typeof o[k] === 'number') wet[k] = o[k] as number;
          if (Object.keys(wet).length) w.setWet(wet);
          if (typeof o.timeScale === 'number' || typeof o.skip === 'number') w.setClock({ timeScale: typeof o.timeScale === 'number' ? o.timeScale : undefined, skipMinutes: typeof o.skip === 'number' ? o.skip : undefined });
          if ('windHeading' in o) w.holdWind(typeof o.windHeading === 'number' ? o.windHeading : null);
          if (typeof o.draw === 'boolean') w.drawPass = o.draw;
          emitters = o.emitters === true;
        }
        this.hud.setWeatherNote(w.heldNote());
        return w.describe({ emitters });
      },
      /** The lens flare this frame: every source slot the sky has, whether it is on, its visibility ([smoothed, depth open, cloud transmittance]) and `turn`, the degrees right and up to face it whatever steers the view. */
      flare: () => {
        const fx = this.postfx;
        const pass = fx?.pass<import('./core/fx/lensFlare').LensFlarePass>('lensFlare');
        if (!fx) return 'the effects are off: the flare is one of them';
        if (!pass) return 'the lens flare is not registered on this chain';
        this.drawFrame();
        return { ...pass.report(fx.ctx), visibility: pass.readVisibility(), sky: this.world.swgSky?.describe().flare ?? null };
      },
      /** Change the flare's look live (`{ streak: 0.5 }`, `{ debugOnly: true }` for the flare alone on black, `{ nightSuns: false }`), or `'reset'`; kept across the Effects switch until a reload, never saved. */
      flareTune: (patch?: Partial<import('./core/fx/flareMath').FlareLook> | 'reset') => {
        // The module's live look: tuned with the effects off too, and read by the pass when they come on.
        return tuneFlareLook(patch);
      },
      /** Measure the next frame round the first sun on screen: pixels over white and over the flare's ceiling, before and after it (the counts must match). */
      flareProbe: () => {
        const fx = this.postfx;
        const pass = fx?.pass<import('./core/fx/lensFlare').LensFlarePass>('lensFlare');
        if (!fx || !pass) return 'the effects are off: the flare is one of them';
        pass.probeWanted = true;
        this.drawFrame();
        if (pass.probeWanted) {
          pass.probeWanted = false;
          return { error: `the flare did not draw: ${pass.reason(fx.ctx) ?? 'switched off'}` };
        }
        return pass.lastProbe;
      },
      /** Point the camera at sun `i` (by default the first one up: Mustafar's night sun is slot 1), `offset` radians of yaw aside so the head does not hide it; on foot or riding only (flying, aboard and adrift, steer by `flare().sources[i].turn`). */
      faceSun: (slot?: number, offset = 0.25) => {
        const p = this.player;
        const flown = p.mounted ?? p.piloting;
        const steer = `turn by hand: __debug.flare().sources[${slot ?? 0}].turn says how far right and up`;
        if (flown?.spec.ship && flown.airborne) return `flying: the view follows the ship; ${steer}`;
        if (p.aboard) return `aboard a ship: the view is in the hull's frame; ${steer}`;
        if (p.eva) return `adrift: the view is in the body's frame; ${steer}`;
        // The frame input's kept list, which drawFrame refills every frame: the effects need not be on.
        const lights = this.fxInput.skyLights;
        const n = this.world.skyLights(lights, flareLook.nightSuns);
        const up = (k: number) => k >= 0 && k < n && lights[k].alpha > 0.002;
        let i = 0;
        if (slot === undefined) {
          while (i < n && !up(i)) i++;
          if (i >= n) return `no sun up now (${n} flare slots)`;
        } else if (!Number.isInteger(slot) || !up(slot)) return `no sun ${slot} up now (${n} flare slots, numbered from 0)`;
        else i = slot;
        const d = lights[i].dir;
        this.cam.yaw = Math.atan2(-d.x, -d.z) + offset;
        this.cam.pitch = THREE.MathUtils.clamp(-Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), -1.25, 1.4);
        return { slot: i, direction: d.toArray().map((v) => Number(v.toFixed(3))), yaw: Number(this.cam.yaw.toFixed(3)), pitch: Number(this.cam.pitch.toFixed(3)) };
      },
      /** Bolts in the air: whose, where, which way, how fast, whether drawn as the game's projectile effect, how many have flown and been blocked, and the ship effects' state. */
      bolts: () => ({ fired: { ...this.world.bolts.fired }, blocked: this.player.blocks, inFlight: this.world.bolts.bolts.map((b) => ({ owner: b.owner, reflected: b.reflected, at: b.pos.toArray().map((v) => Number(v.toFixed(1))), dir: b.dir.toArray().map((v) => Number(v.toFixed(2))), speed: Math.round(b.speed), effect: b.fx?.file ?? null })), shipEffects: this.world.shipFx.status, target: this.shipTarget?.spec.id ?? null, lead: this.shipLeadValid ? this.shipLead.toArray().map((v) => Number(v.toFixed(1))) : null }),
      /** The turrets: where each stands, its health, whether it is down, and its shots. */
      turrets: () => this.world.turrets.turrets.map((t) => ({ at: t.pos.toArray().map((v) => Number(v.toFixed(1))), distance: Number(t.pos.distanceTo(this.player.pos).toFixed(1)), hp: t.hp, dead: t.dead, shots: t.shots })),
      /** Stand a turret `distance` metres ahead of the player, facing them, and report where. */
      turret: (distance = 20) => {
        this.cam.forward(tmp);
        const x = this.player.pos.x + tmp.x * distance;
        const z = this.player.pos.z + tmp.z * distance;
        const t = this.world.turrets.place(x, z, Math.atan2(-tmp.x, -tmp.z));
        return t.pos.toArray().map((v) => Number(v.toFixed(1)));
      },
      /** Fire a bolt at the player from `distance` metres in front, as an enemy would, for testing blocks. */
      shootPlayer: (distance = 15) => {
        this.cam.forward(tmp);
        boltFrom.copy(this.player.pos).addScaledVector(tmp, distance);
        boltFrom.y += 1.15;
        tmp.negate();
        // No gun stands behind it, so it is the plain blaster's: a test shot sounds like a shot.
        this.world.bolts.fire(boltFrom, tmp, { owner: 'enemy', damage: 15, sound: GENERIC_GUN });
        return this.world.bolts.bolts.length;
      },
      /** Full health, for tests that stand in front of the turrets. */
      heal: () => {
        this.player.heal(this.player.maxHp);
        return this.player.hp;
      },
      /** Play any clip the player's rig has, looping (or once), to see it on the player: `__debug.anim('BOTH_A2_SPECIAL')`; no name stops it. */
      anim: (name?: string, loop = true) => {
        const rig = this.player.rig;
        if (!rig) return 'no rig';
        if (!name) {
          rig.stopOverride();
          return 'stopped';
        }
        const clips = rig.clipsMatching(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        const exact = rig.has(name) ? name : clips[0];
        if (!exact) return `no clip matches ${name}`;
        if (/^add_/.test(exact)) {
          rig.playUpper(exact);
          return { playing: exact, note: 'an additive clip: played once as a delta over the current pose', matches: clips.slice(0, 20) };
        }
        rig.play(exact, { loop, hold: !loop });
        return { playing: exact, matches: clips.slice(0, 20) };
      },
      /** Mount the nearest vehicle, or dismount, as E does. */
      mount: () => {
        this.handleMount();
        return this.player.mounted ? `riding ${this.player.mounted.spec.id}` : 'on foot';
      },
      /** Aboard a ship's rooms: stand at the pilot's spot and take the controls, as walking there and pressing E does; `controls(false)` lets go. */
      controls: (take = true) => {
        const p = this.player;
        const room = p.aboard;
        if (!room) return 'not aboard a ship';
        if (!take) {
          p.piloting = null;
          return 'let go of the controls';
        }
        if (!room.pilotSpot) return 'this ship has no pilot spot in its rooms';
        p.pos.copy(room.pilotSpot);
        p.body.setTranslation({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, true);
        p.placeVisual();
        this.handleMount();
        return p.piloting ? `at the controls of the ${p.piloting.spec.id}` : 'could not take the controls';
      },
      /** The ship menu from the console: `ship()` or `ship('status')` reports what it would show; `ship('space')`, `ship('land')`, `ship('eject')` press its buttons; `ship('open')` opens it. */
      ship: (action: 'status' | 'open' | 'space' | 'land' | 'eject' = 'status') => {
        if (action === 'open') {
          this.toggleShipMenu();
          return this.shipMenu.open ? 'open' : 'not in a ship';
        }
        if (action === 'space') void this.goToSpace();
        else if (action === 'land') void this.landShip();
        else if (action === 'eject') void this.eject();
        const s = this.shipStatus();
        const p = this.player;
        return { ...s, gate: this.spaceGate, aboard: !!p.aboard, piloting: !!p.piloting, mounted: !!p.mounted, local: p.aboard ? p.pos.toArray().map((n) => Number(n.toFixed(2))) : null, heading: Number(p.heading.toFixed(2)) };
      },
      /** How a clip splits between the upper body and the legs (`split('BOTH_RUN2')`): the bones each half drives, the bone the split is at, and the weights of the actions playing now. */
      split: (clip: string) => this.player.rig?.splitInfo(clip) ?? 'no rig',
      /** The clip the rig's selector picks for a value: `variant('loop_riding', 'vehicle_hover_chair')`, `variant('skill_action_3', 'dance_18')`. */
      variant: (base: string, value: string) => this.player.rig?.variant(base, value) ?? 'no rig',
      /** Travel to a world by id (`travel('space_tatooine')`), as the galaxy map does; a space zone is arrived at in the ship last flown. */
      travel: (id: string) => {
        void this.travel(planetById(id));
        return `travelling to ${id}`;
      },
      /**
       * The System Map's lists (`await jumps()` for the zone flown in, `jumps('space_light1')` for another): every system's title,
       * and the zone's destinations with their keys for `jump`, how far each is from the ship (km, this zone only), whether it is
       * made up, and why it cannot be jumped to now.
       */
      jumps: async (zone?: string) => {
        const cat = await this.catalogue();
        const here = zone ?? this.world.planet.id;
        const sys = cat.systems.find((s) => s.id === here);
        const ship = this.pilotedShip();
        return {
          systems: cat.systems.map((s) => `${s.title}${s.pack?.hyperspace ? '' : ' (not converted)'}`),
          here,
          destinations: (sys?.destinations ?? []).map((d) => {
            let km: number | null = null;
            if (ship && d.zone === this.world.planet.id) {
              const g = toGame(d.at);
              km = Number((Math.hypot(g[0] - ship.pos.x, g[1] - ship.pos.y, g[2] - ship.pos.z) / 1000).toFixed(2));
            }
            return { key: d.key, name: d.name, kind: d.kind, km, invented: d.invented, why: this.hyperspace.why(d) };
          }),
        };
      },
      /**
       * Start a jump to a destination by its key (`jump('space_tatooine:space_tatooine_2')`); `{ now: true }` skips the countdown.
       * Answers why it cannot, or that it has begun: 'jumping' with `now` means the enter stage starts on the next frame (in a
       * hidden tab, the next `advance`), so `jumpState()` read at once still says `countdown`.
       */
      jump: async (key: string, opts: { now?: boolean } = {}) => {
        const cat = await this.catalogue();
        const d = cat.find(key);
        if (!d) return `no destination ${key}: see __debug.jumps(zone) for the keys`;
        const why = this.hyperspace.start(d, opts.now ? 0 : undefined);
        if (why !== null) return why;
        if (this.hyperspaceUi.open) {
          this.hyperspaceUi.hide();
          this.freeMouse(false);
        }
        return opts.now ? 'jumping' : 'counting down';
      },
      /**
       * The jump now: its phase, time in it, destination, the cruise it commands, the hull's ghosting, how closed the tunnel
       * is (`tunnel` 0..1, `covered` when closed), whether the others are told not to show the ship (`hidden`), whether the
       * hull came through another system itself (`carried`), programs made while the tunnel was closed, hits taken (should
       * be 0), how far off the arrival was, the worst frame seen while the tunnel was not closed; and the camera's far plane.
       */
      jumpState: () => ({ ...this.hyperspace.describe(), far: this.cam.camera.far, crew: this.jumpCrew ? (this.player.aboard?.vehicle === this.jumpCrew ? 'aboard' : 'outside') : null }),
      /**
       * The NPC ships: the cap and how many are out, the anchors (name, side, distance, their groups' states), the groups
       * (side, formation, members: type, tier, state, target, shields/armour/hull, shots, hits, distance, ready, paused),
       * NPC bolts in the air, the programs, the portal set's and the cascades' sizes (`materials`, the leak check), and
       * `ms: { think, physics }`. `{ patrols: false }` stops the patrols streaming in, `{ passive: true }` every NPC's fire,
       * `{ clear: true }` takes every NPC ship away.
       */
      npcShips: (opts: { patrols?: boolean; passive?: boolean; clear?: boolean } = {}) => {
        const mgr = this.world.npcShips;
        const data = this.world.ships.data;
        let cleared: number | null = null;
        if (mgr) {
          if (typeof opts.patrols === 'boolean') mgr.patrols = opts.patrols;
          if (typeof opts.passive === 'boolean') mgr.passive = opts.passive;
          if (opts.clear) cleared = mgr.clear();
        }
        return {
          combat: data ? { ...(data.file.counts ?? { types: data.file.types.length }) } : "no combat.json in the ships pack: no NPC ships (npm run swg -- ships '@SWG' assets-private --retail-only)",
          ...(cleared !== null ? { cleared } : {}),
          ...(mgr ? mgr.report() : { live: 0, note: 'no world loaded' }),
          contacts: this.world.ships.list.map((c) => `${c.label || c.vehicle.spec.id} (${c.faction}${c === this.world.ships.playerShip ? ', yours' : ''}${c.targetable ? '' : ', not targetable'})`),
          target: this.targetFx.describe(),
          programs: this.renderer.info.programs?.length ?? 0,
          materials: this.world.materialCounts(),
          ms: { think: Number((mgr?.ms.think ?? 0).toFixed(3)), physics: Number(stats.physicsMs.toFixed(3)) },
        };
      },
      /**
       * Stand NPC ships ahead of the view: `await npcShip('tiefighter_tier1', { distance: 400 })` one of a type, or a family
       * with `{ tier, count: 3 }` for a patrol in formation; 700 m ahead by default, facing you. Returns the sentence.
       */
      npcShip: async (what = 'tiefighter', opts: { tier?: number; count?: 1 | 3; distance?: number } = {}) => {
        const mgr = this.world.npcShips;
        const data = this.world.ships.data;
        if (!mgr) return 'no world loaded';
        if (!data) return "no combat.json in the ships pack: convert the ships again (npm run swg -- ships '@SWG' assets-private --retail-only)";
        const type = data.typeById(what);
        const family = type ? type.family : what;
        const tier = opts.tier ?? type?.tier ?? (this.world.planet.space ? (ZONE_TIER[this.world.planet.id] ?? 3) : 3);
        const p = this.player;
        const flown = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
        const from = (flown ? flown.pos : p.worldPos).clone();
        const dir = this.cam.camera.getWorldDirection(new THREE.Vector3());
        return mgr.spawnFamily(family, tier, opts.count === 3 ? 3 : 1, from, dir, opts.distance ?? 700);
      },
      /**
       * The flown ship's fight (or with `target: true` the target's): its stats, condition, components with grades, what is
       * down, and its top speed (`speed`, m/s where it flies). `{ hit: 'shield' | 'armor' | 'chassis' | '<slot>', amount: 0..1 }`
       * strikes it through the same path as a bolt; `{ repair: true }`; `{ god: true | false }` (it takes no damage);
       * `{ stats: { refire: 0.3 } }` overrides its numbers live.
       */
      shipCombat: (opts: { target?: boolean; hit?: string; amount?: number; repair?: boolean; god?: boolean; stats?: Record<string, number> } = {}) => {
        const p = this.player;
        const v = opts.target ? this.shipTarget : (p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null);
        if (!v) return opts.target ? 'no target: Tab onto a ship first' : 'not in a ship';
        const combat = v.combat;
        if (!combat) return `${v.spec.id} has no fight (a ship gets one when it is spawned; is there a combat.json?)`;
        if (opts.repair) combat.repair();
        if (typeof opts.god === 'boolean') combat.god = opts.god;
        if (opts.stats) {
          const s = combat.stats as unknown as Record<string, unknown>;
          for (const [k, n] of Object.entries(opts.stats)) if (typeof n === 'number' && Number.isFinite(n) && typeof s[k] === 'number') s[k] = n;
        }
        const hit = opts.hit ? combat.forceHit(opts.hit, THREE.MathUtils.clamp(opts.amount ?? 1, 0, 1)) : null;
        return { ship: v.spec.id, ...(hit ? { hit: { ...hit } } : {}), ...combat.report(), speed: Math.round(v.spec.maxSpeed * (v.space ? 2 : 1)), cruise: Math.round(v.cruise), hp: Math.round(v.hp) };
      },
      /**
       * The head-up display: what the overlay costs, what it drew last frame, and the DOM writes of
       * the last full second that were not by design Ã¢â‚¬â€ the number to look for is 0, and the 4 Hz
       * clock, `/loc` and frame-rate lines are counted apart as `byDesign`.
       *
       * `{ overlay: false }` turns the canvas off for a baseline and `{ overlay: true }` back on;
       * `{ scale: 1.25 }` and `{ dpr: 2 }` try the size and the sharper canvas at once (they move the
       * live settings, and are saved only if the menu is then touched); `{ boxes: true }` outlines
       * the region the overlay clears, which is how to see whether the union clear is doing its job.
       * Each piece is a switch of its own: `{ condition, target, arcs, line, fullPrompts }`, and
       * `{ lines: 4 }` is how many message lines stand at once. The three sets of invented numbers
       * are reachable as well: `{ flight: { arcRadius: 150 } }` for the reticle and the arcs,
       * `{ tune: { barPixels: 200 } }` for the on-foot write steps, `{ messages: { seconds: 3 } }`
       * for the message line, and `{ wiring: { heatIsHeadroom: false } }` for the two readings this
       * file invents on the way into the flight struct.
       *
       * `overlay.ops` is the canvas's own count and is what the budget is written against;
       * `overlay.shapes` is the flight display's count of its own calls, a different unit, reported
       * beside it. `lineWrites` is the message line's, counted apart because a line said or fading
       * is a write that is meant to happen.
       */
      hud: (opts: { overlay?: boolean; scale?: number; dpr?: number; boxes?: boolean; condition?: boolean; target?: boolean; arcs?: boolean; line?: boolean; lines?: number; fullPrompts?: boolean; damageArc?: boolean; damageNumbers?: boolean; nameplate?: boolean; jediCrosshair?: boolean; flight?: Partial<FlightTune>; tune?: Parameters<Hud['tune']>[0]; messages?: Partial<typeof MESSAGES>; wiring?: Partial<typeof HUD_WIRING>; under?: Partial<typeof OVERLAY_TUNE>; sizes?: Partial<HudSizes>; feedback?: Partial<FeedbackTune>; prompt?: Partial<typeof PROMPT>; plates?: Partial<typeof PLATE_TUNE> } = {}) => {
        const S = this.settings;
        let sized = false;
        // Clamped here, at the door, and not only on the way to the canvas: whatever is typed in the
        // console is written into the live settings, and the menu saves the live settings, so an
        // unclamped value tried once would be kept for good the next time a switch was touched.
        const clamp = (v: number, r: { min: number; max: number }) => Math.max(r.min, Math.min(r.max, v));
        if (typeof opts.scale === 'number' && Number.isFinite(opts.scale)) {
          S.hudScale = clamp(opts.scale, HUD_SCALE_RANGE);
          sized = true;
        }
        if (typeof opts.dpr === 'number' && Number.isFinite(opts.dpr)) {
          S.hudDpr = clamp(opts.dpr, HUD_DPR_RANGE);
          sized = true;
        }
        // The pieces, as the Escape menu will set them: the live settings, applied the same way.
        if (typeof opts.condition === 'boolean') S.hudShipCondition = opts.condition;
        if (typeof opts.target === 'boolean') S.hudTargetBlock = opts.target;
        if (typeof opts.arcs === 'boolean') S.hudArcs = opts.arcs;
        if (typeof opts.line === 'boolean') {
          S.hudMessages = opts.line;
          sized = true;
        }
        if (typeof opts.lines === 'number' && Number.isFinite(opts.lines)) {
          S.hudMessageLines = clamp(Math.round(opts.lines), HUD_LINES_RANGE);
          sized = true;
        }
        if (typeof opts.fullPrompts === 'boolean') {
          S.hudFullPrompts = opts.fullPrompts;
          sized = true;
        }
        // The four fighting switches, as the Interface page sets them.
        if (typeof opts.damageArc === 'boolean') {
          S.hudDamageArc = opts.damageArc;
          sized = true;
        }
        if (typeof opts.damageNumbers === 'boolean') {
          S.hudDamageNumbers = opts.damageNumbers;
          sized = true;
        }
        if (typeof opts.nameplate === 'boolean') {
          S.hudNameplate = opts.nameplate;
          sized = true;
        }
        if (typeof opts.jediCrosshair === 'boolean') {
          S.hudJediCrosshair = opts.jediCrosshair;
          sized = true;
        }
        if (sized) this.applyHudSettings();
        if (typeof opts.overlay === 'boolean') this.overlay.setEnabled(opts.overlay);
        if (typeof opts.boxes === 'boolean') this.overlay.setBoxes(opts.boxes);
        if (opts.flight) this.shipHud.tune(opts.flight);
        if (opts.tune) this.hud.tune(opts.tune);
        if (opts.messages) tuneMessages(opts.messages);
        // The overlay's own three invented numbers and the geometry table, live: the under-stroke's
        // alpha and width are the likeliest thing to want changed once it is seen on a bright desert
        // and against a starfield, and neither can be judged from here.
        if (opts.under) {
          if (typeof opts.under.widen === 'number' && Number.isFinite(opts.under.widen)) OVERLAY_TUNE.widen = opts.under.widen;
          if (typeof opts.under.alpha === 'number' && Number.isFinite(opts.under.alpha)) OVERLAY_TUNE.alpha = opts.under.alpha;
          if (typeof opts.under.clearSlop === 'number' && Number.isFinite(opts.under.clearSlop)) OVERLAY_TUNE.clearSlop = opts.under.clearSlop;
        }
        // A size only reaches the screen on the next layout, which `applyHudSettings` runs.
        if (opts.sizes && tuneSizes(opts.sizes) > 0) this.applyHudSettings();
        if (opts.feedback) this.feedback.tune(opts.feedback);
        if (opts.prompt) tunePrompt(opts.prompt);
        if (opts.plates) this.plates.tune(opts.plates);
        if (opts.wiring) {
          if (typeof opts.wiring.gunBits === 'number' && Number.isFinite(opts.wiring.gunBits)) HUD_WIRING.gunBits = Math.max(1, Math.min(32, Math.round(opts.wiring.gunBits)));
          if (typeof opts.wiring.heatIsHeadroom === 'boolean') HUD_WIRING.heatIsHeadroom = opts.wiring.heatIsHeadroom;
          // The two gather rates and the arc's range. A rate of 60 puts the old per-frame cost back,
          // which is how to measure what gathering at 8 and 4 saves; nothing may be 0, or the gather
          // would never come round again.
          if (typeof opts.wiring.promptHz === 'number' && Number.isFinite(opts.wiring.promptHz)) HUD_WIRING.promptHz = Math.max(1, Math.min(120, opts.wiring.promptHz));
          if (typeof opts.wiring.nearbyHz === 'number' && Number.isFinite(opts.wiring.nearbyHz)) HUD_WIRING.nearbyHz = Math.max(1, Math.min(120, opts.wiring.nearbyHz));
          if (typeof opts.wiring.hurtRange === 'number' && Number.isFinite(opts.wiring.hurtRange)) HUD_WIRING.hurtRange = Math.max(1, opts.wiring.hurtRange);
        }
        const c = this.overlay.stats;
        const body = this.hud.stats();
        const ship = this.shipHud.report();
        const line = this.messages.debug();
        const bar = this.actions.debug();
        const fb = this.feedback.report();
        const foot = this.hud.report();
        const plate = this.plates.report();
        const L = this.hudLayout;
        const s = this.promptState;
        return {
          // `ops` is the canvas's own count of everything drawn through it, the display's strokes
          // included, and is the figure the budget is written against; `shapes` is the display's own
          // count of the calls it made, which is a different unit and is reported beside, not added.
          overlay: { ms: Math.round(c.ms * 1000) / 1000, ops: c.ops, shapes: ship.ops, enabled: c.enabled, attached: ship.attached, dpr: c.dpr, clear: [c.clearX, c.clearY, c.clearW, c.clearH] },
          // Writes that should be 0 in a steady frame, and the ones that are meant to happen. Both
          // are the last full second's. The message line is counted apart: it writes only when
          // something was said or is fading, which is by design, and its own counter is a lifetime
          // total, so adding it here would put a rising number where a 0 is meant to stand.
          writes: body.writes + ship.writes + fb.writes,
          byDesign: body.byDesign,
          lineWrites: { lastSecond: this.lineWritesLast, total: line.writes },
          scale: L.scale,
          under: { ...OVERLAY_TUNE },
          layout: { arcR: Math.round(L.arcR), aimMax: Math.round(L.aimMax), condition: [L.condition.x, L.condition.y, L.condition.w, L.condition.h], message: [L.message.x, L.message.y, L.message.w, L.message.h] },
          pips: ship.pips,
          messages: { lines: line.lines, fading: line.fading, said: line.said, merged: line.merged, dropped: line.dropped, kept: MESSAGES.kept, styled: !this.messages.styleless },
          shows: { condition: S.hudShipCondition, target: S.hudTargetBlock, arcs: S.hudArcs, line: S.hudMessages, fullPrompts: S.hudFullPrompts, damageArc: S.hudDamageArc, damageNumbers: S.hudDamageNumbers, nameplate: S.hudNameplate, jediCrosshair: S.hudJediCrosshair },
          bodyBars: this.bodyShown,
          // The bar of things you can press: what it is showing, with the key on each cap, and what
          // the state behind it says. `writes` is the bar's own lifetime total, not a rate, since it
          // only writes when what it shows has changed; walking about is what makes it rise.
          actions: {
            shown: bar.shown,
            slots: this.actions.size,
            writes: bar.writes,
            changed: bar.changed,
            rebinds: bar.rebinds,
            styled: bar.styled,
            list: this.actionsList(bar.shown),
            state: { live: s.live, jump: s.jump, noclip: s.noclip, mounted: s.mounted, piloting: s.piloting, kind: s.vehicle.kind, lift: s.lift, elevator: s.elevator, doorless: s.doorless, gate: s.gate, gateTo: this.promptGate, boots: s.boots, bootsReach: s.bootsReach, aboard: s.aboard, atControls: s.atControls, eva: s.eva, near: s.near, shipMenu: s.shipMenu },
            hz: HUD_WIRING.promptHz,
          },
          // The damage feedback: the arcs standing, the numbers rising, and how long ago a shot of
          // yours told and killed (-1 for "not since the world loaded").
          feedback: { arcs: fb.arcs, numbers: fb.numbers, ops: fb.ops, writes: fb.writes, attached: fb.attached, projector: fb.projector, sinceHit: fb.tick, sinceKill: fb.kill, shown: this.feedback.shown, tune: { ...FEEDBACK_TUNE } },
          // On foot: the glyphs the sheet holds, the keys the number slots are showing (which is how
          // a rebind is checked from a tab nobody can see), what is in each hand, and whether the
          // crosshair is drawn for the class in play.
          onFoot: { icons: foot.icons, keys: foot.keys, hands: foot.hands, crosshair: foot.crosshair, attached: foot.attached, ops: foot.ops },
          // The plate over a head, and the line in the corner it replaced.
          plates: { shown: plate.shown, label: plate.label, writes: plate.writes, enabled: plate.enabled, tune: { ...PLATE_TUNE } },
          nearby: { name: this.nearbyName, hz: HUD_WIRING.nearbyHz },
          wiring: { ...HUD_WIRING },
        };
      },
      /**
       * Try the damage feedback without being shot at. The angle is degrees clockwise from straight
       * ahead: `hurt(0)` ahead, `hurt(90)` on the right, `hurt(180)` behind, `hurt(270)` on the left.
       * `hurt(null)` is a blow with no direction (the red flash alone). `hit(12)` ticks the crosshair
       * as one of your own shots landing, and `hit(12, true)` as the one that killed.
       */
      hurt: (deg: number | null = 0) => {
        if (deg === null) this.hurtFrom(null);
        else this.feedback.hurtAngle(deg);
        return this.feedback.report();
      },
      hit: (amount = 10, killed = false, label = 'a test') => {
        const p = this.player.worldPos;
        this.feedback.hit(amount, killed, 999, label, p.x, p.y + 1.6, p.z - 3);
        return this.feedback.report();
      },
      /** Say a line on the message line by hand, to see a kind's colour and the fade: `say('hit you', 'test')`. */
      say: (kind: ShipMessageKind = 'system', text = 'a test line') => {
        // The speaker's colour comes from the palette, not from a literal: no value has a second home.
        this.sayShipLine(kind, text, colourOf(COL.component));
        return this.messages.textAt(this.messages.debug().lines - 1);
      },
      /**
       * Mouse flight and the NPC pilots' skill, live (every number invented): `flight({ circleDeg: 6 })` and any of ringDeg,
       * deadZone, curve, snapDeg, convergeM, nearestM, speed; `flight({ npc: { 1: { stickMax: 0.8, response: 0.3 } } })` and
       * any of a tier's reaction, scatterDeg, gunConeDeg, lead, breakRange, evadeChance, stickMax, response. Returns them
       * all, with the cursor (half-heights from the boresight), the stick, and whether the guns aim through the cursor and
       * sit on the lead now.
       */
      flight: (opts: FlightTuneInput = {}) => ({ ...flightTune(opts), cursor: { ...this.flightCursor }, stick: { ...this.flightStick }, aiming: this.flightAiming, onLead: this.flightOnLead, range: Math.round(this.flightRange) }),
      /** Show an NPC pilot's line: `taunt('imperial', 'entercombat')` (a table that names you), `taunt('pirate', 'death')`. */
      taunt: (faction: ShipFaction = 'imperial', event: 'entercombat' | 'gothit' | 'hityou' | 'death' = 'entercombat') => {
        const data = this.world.ships.data;
        if (!data) return 'no combat.json in the ships pack';
        // A type of that side from tier 3 up (the tiers 1 and 2 tables name nobody), picked at random.
        const types = data.file.types.filter((t) => t.faction === faction && t.tier >= 3 && data.taunts(t.taunts));
        const type = types[Math.floor(Math.random() * types.length)];
        const lines = type ? data.taunts(type.taunts)?.[event] ?? [] : [];
        const line = pickLine(lines, Math.random);
        if (!type || !line) return `no ${event} line for ${faction}`;
        const text = fillTaunt(line, this.world.ships.playerName);
        this.shipHud.say(type.name, text, FACTION_COLOR[faction]);
        return `${type.name} (${type.taunts}): ${text}`;
      },
      /**
       * The warp effects' turn about the hull's Y (degrees) and how far ahead of the hull they are placed (metres along the
       * nose), for checking by eye; the next jump uses them. The tunnel's look, all invented and live: `radius` (over the
       * jump camera's distance behind the ship), `minRadius` (hull radii), `length` (half-length in radii; these three at
       * the next jump), `spin` (turns a second), `speed` (the streaks' run), `glow`, and `cull` (false: the camera's far
       * plane is left alone while the tunnel is closed, so the world is drawn behind it). The timing, invented and live:
       * `close` and `open` (seconds the tunnel takes to close round the ship and to open ahead of it), `min` (the least
       * seconds inside it) and `zoom` (the pilot's held view, 0.7 to 24; 7 is the camera's default).
       */
      jumpFx: (opts: { turn?: number; ahead?: number; radius?: number; minRadius?: number; length?: number; spin?: number; speed?: number; glow?: number; cull?: boolean; close?: number; open?: number; min?: number; zoom?: number } = {}) => {
        const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
        if (num(opts.turn)) this.hyperspace.fxTurn = opts.turn;
        if (num(opts.ahead)) this.hyperspace.fxAhead = opts.ahead;
        const look = this.jumpTunnel.look;
        for (const k of ['radius', 'minRadius', 'length', 'spin', 'speed', 'glow'] as const) {
          const v = opts[k];
          if (num(v)) look[k] = v;
        }
        if (typeof opts.cull === 'boolean') look.cull = opts.cull;
        const times = TUNNEL_TIMES;
        for (const k of ['close', 'open', 'min'] as const) {
          const v = opts[k];
          if (num(v)) times[k] = Math.max(0, v);
        }
        if (num(opts.zoom)) times.zoom = Math.min(24, Math.max(0.7, opts.zoom));
        return { ...this.world.hyperspaceEffects(), turn: this.hyperspace.fxTurn, ahead: this.hyperspace.fxAhead, times: { ...times }, tunnel: { ...look, size: { ...this.jumpTunnel.size }, far: this.jumpTunnelFar, shown: this.jumpTunnel.shown } };
      },
      /**
       * Nudge the ridden vehicle's seat by metres in its own frame (right, up, forward) and report where it now is, with the pose
       * playing and its root offset, for finding a seat by eye. In a ship seated by its cockpit eye the body moves under the eye
       * and the view stays put; `paste` is the line for COCKPIT_BODY_NUDGE in cockpitSeat.ts.
       */
      seat: (dx = 0, dy = 0, dz = 0) => {
        const v = this.player.mounted;
        if (!v) return 'not riding anything';
        if (v.eyeSeat) {
          v.bodyNudge[0] += dx;
          v.bodyNudge[1] += dy;
          v.bodyNudge[2] += dz;
          this.player.syncMount();
          const r = this.player.seatReport;
          const frame = frameFileName(v.def?.cockpit?.file);
          const eye = v.cockpitEye(tmp);
          const n3 = (n: number) => Number(n.toFixed(3));
          return { vehicle: v.spec.id, frame: frame || null, eye: eye ? eye.toArray().map(n3) : null, eyeSource: v.eyeSource, bodyNudge: v.bodyNudge.map(n3), seatDrop: v.seatDrop === null ? null : n3(v.seatDrop), lift: n3(r.lift), riderPose: v.riderPose, clip: r.clip, paste: `'${frame}': [${v.bodyNudge.map((n) => n3(n)).join(', ')}],` };
        }
        v.seat.position.x += dx;
        v.seat.position.y += dy;
        v.seat.position.z += dz;
        const clip = this.player.rig?.currentClip ?? null;
        const root = clip ? this.player.rig?.rootOffset(clip, tmp) : null;
        return { vehicle: v.spec.id, seat: v.seat.position.toArray().map((n) => Number(n.toFixed(2))), seatIsPelvis: v.seatPelvis, riderPose: v.riderPose, seatFrom: v.seatFrom, saddle: !!v.saddle, clip, clipRoot: root ? root.toArray().map((n) => Number(n.toFixed(2))) : null };
      },
      /** The garage: `vehicles('speeder')` lists what can be spawned; `spawn('speeder_ab1')` or `spawn('bantha', 'ground')` stands one in front of you; `vehicles.clear` is the panel's Remove all. */
      vehicles: (find?: string) => {
        const g = this.garage ?? this.world.garage;
        if (!g) return 'the garage is not loaded yet: open it with G once, or call spawn()';
        const f = find?.toLowerCase();
        return { onWorld: this.world.vehicles.map((v) => `${v.spec.id} (${v.spec.kind}${v === this.player.mounted ? ', ridden' : ''}) at ${v.pos.toArray().map((n) => n.toFixed(0)).join(',')}`), garage: g.vehicles.filter((v) => !f || v.id.toLowerCase().includes(f) || v.kind.includes(f)).map((v) => `${v.id}: ${v.kind}${v.inferred ? '' : ' (guessed)'}, ${v.source}`).slice(0, 80) };
      },
      /** Stand a plain box of the given size in front of you as a vehicle of `kind`, for handling tests without a model. */
      spawnBox: (w = 1, h = 1, l = 2.4, kind: VehicleKind = 'speederbike') => {
        const bounds = { min: [-w / 2, 0, -l / 2] as [number, number, number], max: [w / 2, h, l / 2] as [number, number, number] };
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), new THREE.MeshStandardMaterial({ color: 0x8899aa }));
        mesh.position.y = h / 2;
        const v = this.world.addVehicle(specFor(kind, 'box', 'box', bounds), mesh, this.player.pos, this.player.heading);
        return `box ${w}Ãƒâ€”${h}Ãƒâ€”${l} spawned as a ${kind} at ${v.pos.toArray().map((n) => n.toFixed(1)).join(',')}`;
      },
      /** Change the ridden (else the nearest) vehicle's handling live: `vehicleTune({ bank: 0, turnRate: 1.2 })`, a ship's `{ inertia: 1, turnRate: 0.8 }`; returns the spec. */
      vehicleTune: (patch: Partial<import('./vehicles/vehicle').VehicleSpec> = {}) => {
        const v = this.player.mounted ?? [...this.world.vehicles].sort((a, b) => a.pos.distanceTo(this.player.pos) - b.pos.distanceTo(this.player.pos))[0];
        if (!v) return 'no vehicle';
        Object.assign(v.spec, patch);
        return v.spec;
      },
      /** Every vehicle's state: where, how level (1 upright, 0 on its side), how fast it turns and moves, and how many corners find the ground. */
      /** Set the ship whose room the player is in (or the nearest ship) adrift: forward speed and a spin (rad/s) with no gravity or righting, so the room's physics can be tried; `shipDrift(0)` brings it to rest. */
      /** Move the cockpit frame over the seat of the ship you are in (metres right, up, forward), to find where it should sit; the numbers to report. */
      cockpitFrame: (dx = 0, dy = 0, dz = 0) => {
        FRAME_NUDGE.x += dx;
        FRAME_NUDGE.y += dy;
        FRAME_NUDGE.z += dz;
        const v = this.player.mounted;
        if (v?.cockpitFrame) {
          v.cockpitFrame.position.add(new THREE.Vector3(dx, dy, dz));
          // The frame's eye moves with it (its seat does too, so the seat's drop under the eye is unchanged).
          if (v.cockpit) v.cockpit = [v.cockpit[0] + dx, v.cockpit[1] + dy, v.cockpit[2] + dz];
          this.player.syncMount();
        }
        return `frame nudge ${FRAME_NUDGE.toArray().map((n) => n.toFixed(2)).join(', ')} (right, up, forward)`;
      },
      /**
       * The wings of the ship ridden, piloted or aboard (else the nearest ship): `wings('open')` / `wings('closed')` holds
       * them, `wings('toggle')` does what the wings key (U) does (the pilot's own choice, flipped), `wings('auto')` gives
       * them back to the flight rule (the console's hold and the pilot's choice both dropped), `wings('multiplier')` /
       * `wings('threshold')` picks how every ship reads its chassis's speed factor. Returns the report: the rule, the top
       * speed now, the drop and the clearance, each wing's share open and the hull hardpoint its mount stands on, each
       * moving collider's distance from its mesh, the guns and what was left off.
       */
      wings: (mode?: 'open' | 'closed' | 'toggle' | 'auto' | 'multiplier' | 'threshold') => {
        const p = this.player;
        const v = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? [...this.world.vehicles].filter((o) => o.spec.ship && !o.autopilot).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
        if (!v) return 'no ship: spawn one (spawn(\'xwing\')) or board one';
        if (mode === 'open' || mode === 'closed') v.wings.force = mode;
        else if (mode === 'toggle') v.wings.toggle();
        else if (mode === 'auto') {
          v.wings.force = null;
          v.wings.pilot = null;
        } else if (mode === 'multiplier' || mode === 'threshold') WING_RULE.speed = mode;
        else if (mode !== undefined) return `wings: '${String(mode)}' is none of open, closed, toggle, auto, multiplier, threshold`;
        if (mode === 'open' && !v.airborne && v.wingDrop > 0) console.warn(`wings: forced open on the ground: they reach ${v.wingDrop.toFixed(1)} m under the belly and may stand in the terrain (the game never opens them there)`);
        return v.wingReport();
      },
      /**
       * How the ship ridden, piloted or nearest stands on the ground: `landing()` reports it, `landing({ gap: 0.1 })`
       * sets any of the invented numbers (LANDING in vehicles/landing.ts: gap, tilt, settle, reach, catchLead, hold,
       * hard, floorReach, spread, bandSlack, and `wet`, which is how deep the water or the lava over the floor must
       * stand before a put-down is refused; the report's `under` says what is under the foot and how deep it is)
       * and `landing({ room: { spare: 4 } })` the ones for a ship in a building's
       * rooms (SHIP_ROOM: every, step, spare). `landing({ rule: 'springs' })` puts the older hover-only ride back for
       * every ship, `landing({ cut: true })` cuts its engines, so it comes down and settles where it stands (false
       * starts them again), and `landing({ up: true })` lifts it off. `__debug.advance` steps all of it, so a settle
       * can be watched from a hidden tab: `__debug.landing({ cut: true }); __debug.advance(4); __debug.landing()`.
       * Out in space `landing({ down: true })` asks the ship to set down on whatever is under it (and, once it
       * is down, to lift off again), and `landing({ space: { reach: 60 } })` sets the invented numbers for it
       * (SPACE_LANDING: reach, speed, spread, clear). The report's `space` block says whether anything is under it.
       */
      landing: (opts: { rule?: 'landing' | 'springs'; cut?: boolean; up?: boolean; down?: boolean; room?: Partial<typeof SHIP_ROOM>; space?: Partial<typeof SPACE_LANDING> } & Partial<typeof LANDING> = {}) => {
        const p = this.player;
        const v = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? [...this.world.vehicles].filter((o) => o.spec.ship && !o.autopilot).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
        if (opts.rule === 'landing' || opts.rule === 'springs') SHIP_GROUND.rule = opts.rule;
        for (const k of Object.keys(LANDING) as (keyof typeof LANDING)[]) {
          const n = opts[k];
          if (typeof n === 'number' && Number.isFinite(n)) LANDING[k] = n;
        }
        for (const k of Object.keys(SHIP_ROOM) as (keyof typeof SHIP_ROOM)[]) {
          const n = opts.room?.[k];
          if (typeof n === 'number' && Number.isFinite(n)) SHIP_ROOM[k] = n;
        }
        for (const k of Object.keys(SPACE_LANDING) as (keyof typeof SPACE_LANDING)[]) {
          const n = opts.space?.[k];
          if (typeof n === 'number' && Number.isFinite(n)) SPACE_LANDING[k] = n;
        }
        if (!v) return 'no ship: spawn one (spawn(\'xwing\')) or board one';
        if (opts.cut === true) v.cutEngines();
        if (opts.cut === false) v.enginesOn();
        if (opts.up) v.liftOff();
        if (opts.down) v.askSetDown();
        return v.landReport();
      },
      /**
       * The gravity boots: `boots()` reports whether they hold and what they hold to, `boots({ on: true })` takes
       * hold of whatever is within reach out in space (the same as pressing E adrift), `boots({ off: true })` lets
       * go, and any of the invented numbers (SURFACE_ROOM in vehicles/surfaceRoom.ts: patch, reach, feel, release,
       * turn, stray, triangles, lift, gravity) is set by name: `boots({ turn: 180 })` snaps the view onto the face
       * under the feet twice as fast. `__debug.advance` steps it all, so a walk round a rock can be taken from a
       * hidden tab: `__debug.boots({ on: true }); __debug.advance(2, ['KeyW']); __debug.boots()`.
       */
      boots: (opts: { on?: boolean; off?: boolean } & Partial<typeof SURFACE_ROOM> = {}) => {
        for (const k of Object.keys(SURFACE_ROOM) as (keyof typeof SURFACE_ROOM)[]) {
          const n = opts[k];
          if (typeof n === 'number' && Number.isFinite(n)) SURFACE_ROOM[k] = n;
        }
        if (opts.on) this.bootsTake(null);
        if (opts.off && isSurfaceRoom(this.player.aboard)) this.leaveShip(false);
        const room = this.player.aboard;
        const up = isSurfaceRoom(room) ? new THREE.Vector3(0, 1, 0).applyQuaternion(roomTurn(room)) : null;
        return {
          on: isSurfaceRoom(room),
          space: this.world.planet.space,
          note: this.bootsNote,
          up: up ? up.toArray().map((n) => Number(n.toFixed(3))) : null,
          at: this.player.worldPos.toArray().map((n) => Number(n.toFixed(2))),
          ...(isSurfaceRoom(room) ? room.report() : { tune: { ...SURFACE_ROOM } }),
        };
      },
      /**
       * Docking at a station: `dock()` reports where it stands and every hull in the zone with lanes,
       * `dock({ laneSpeed: 60 })` sets any of the invented numbers (DOCK_TUNE in space/dockingMath.ts:
       * ask, laneSpeed, dockSpeed, gain, arrive, standOff, linkCos, linkMax, bank, settle, repair,
       * sideCos, approachCos, nearLeg, flyBy, budget, faceCos) and `dock({ face: 'lane' })` chooses
       * what a parked ship faces (auto, hardpoint, lane). `sideCos` and `approachCos` are the two
       * bearings that decide whether a lane can be reached from where the ship stands without crossing
       * the hull: at -1 both are off and the row offers a lane from anywhere, as it used to.
       * `dock({ go: true })` asks for a lane in the ship flown, `{ go: false }` launches or breaks off.
       * `dock({ clamp: { gap: 3 } })` sets the ship-to-ship clamp's own numbers (CLAMP_TUNE, all invented)
       * and `dock({ allow: false })` turns away another player asking for room on this hull.
       * `__debug.advance` steps it, so a whole approach can be watched from a hidden tab.
       */
      dock: (opts: { go?: boolean; face?: 'auto' | 'hardpoint' | 'lane'; clamp?: Partial<typeof CLAMP_TUNE>; allow?: boolean } & Partial<typeof DOCK_TUNE> = {}) => {
        const p = this.player;
        const v = p.mounted ?? p.piloting ?? null;
        const out = this.docking.tune(opts);
        if (opts.go === true) return { asked: v ? this.docking.dock(v) : 'no ship is being flown', ...this.docking.report() };
        if (opts.go === false) return { said: this.docking.act(v), ...this.docking.report() };
        return out;
      },
      /**
       * The gates a world's zones are walked between: what the pack carries, which one is in reach, what the key would do
       * there and the two numbers, live. `gates({ reach: 20 })` and `gates({ calm: 1 })` move them (GATE_TUNE in
       * zoneGates.ts). Nothing here can be seen from a tab that draws no frames, which is why it answers in numbers.
       */
      gates: (opts: Partial<typeof GATE_TUNE> = {}) => {
        tuneGates(opts);
        const p = this.player;
        const at = p.worldPos;
        const near = this.zoneGates.nearest(at.x, at.y, at.z);
        const since = this.zoneGates.since(this.world.simTime);
        return {
          pack: this.world.packId,
          gates: this.zoneGates.gates.map((g) => ({ to: g.to, label: g.label, at: [Math.round(g.x), Math.round(g.y), Math.round(g.z)], d: Math.round(Math.hypot(g.x - at.x, g.y - at.y, g.z - at.z)) })),
          here: near ? { to: near.gate.to, label: near.gate.label, d: Math.round(near.d * 10) / 10 } : null,
          sinceABlow: Number.isFinite(since) ? Math.round(since * 10) / 10 : 'no blow in this world',
          would: gateAction({
            live: true,
            onFoot: !p.mounted && !p.piloting && !p.aboard && !p.noclip,
            free: !this.nearestVehicle(),
            since,
            d: near ? near.d : null,
            to: !!near?.gate.to,
          }),
          under: { ...GATE_TUNE },
        };
      },
      /**
       * The astromechs in their sockets: `droid({ shown: 0.4 })` sets the share of a droid's height shown over its socket
       * for every hull without its own, `droid({ shown: 0.5, hull: 'vwing' })` one hull's own (DROID_SHOWN and
       * DROID_SHOWN_BY_HULL in shipFit.ts); every droid on the world is sunk again at once. Returns each: its hull, the
       * share, how far it is sunk and its height.
       */
      droid: (opts: { shown?: number; hull?: string } = {}) => {
        if (typeof opts.shown === 'number' && Number.isFinite(opts.shown)) {
          if (opts.hull) DROID_SHOWN_BY_HULL[opts.hull] = opts.shown;
          else DROID_SHOWN.share = opts.shown;
        }
        const n3 = (n: number) => Number(n.toFixed(3));
        const out: { ship: string; shown: number; sunk: number; height: number }[] = [];
        for (const v of this.world.vehicles) {
          const id = v.def?.id;
          if (!id) continue;
          v.group.traverse((o) => {
            const span = o.userData.droidSpan as [number, number] | undefined;
            if (!o.userData.droid || !Array.isArray(span)) return;
            const shown = droidShown(id);
            const sunk = droidSink(span[0], span[1], shown);
            o.position.y = -sunk;
            out.push({ ship: id, shown: n3(shown), sunk: n3(sunk), height: n3(span[1] - span[0]) });
          });
        }
        return out.length ? out : 'no droid in a socket on the world: edit a ship with a socket (the X-wing), pick R2, spawn it';
      },
      /**
       * The cockpit of the ship ridden or piloted: where the eye is and where it came from, the seat under it, the body's lift
       * and how far the figure's eyes are from the camera, the view in use. `cockpit({ offset: false })` takes the cockpit
       * file's first-person offset off the view (true puts it back; the body stays where the whole offset puts it),
       * `cockpit({ share: 0.5 })` sets the share of that offset the view and the seated eyes take (COCKPIT_OFFSET_SHARE, this
       * ship until it is spawned again), `cockpit({ cushion: true })` seats every ship's pilot on the cushion under the eye as
       * before (false: the eyes on the eye), `cockpit({ bridgeHull: false })` hides the hull around a bridge pilot flying in
       * first person (true shows it again).
       */
      cockpit: (opts: { offset?: boolean; share?: number; cushion?: boolean; bridgeHull?: boolean } = {}) => {
        const p = this.player;
        const v = p.mounted ?? p.piloting;
        if (!v || !v.spec.ship) return 'not seated in a ship';
        if (opts.offset !== undefined) v.cockpitOffset = opts.offset ? mirroredOffset(v.def?.cockpit?.firstOffset) : [0, 0, 0];
        if (typeof opts.share === 'number' && Number.isFinite(opts.share)) v.cockpitShare = THREE.MathUtils.clamp(opts.share, 0, 1);
        if (opts.cushion !== undefined) {
          SEAT_RULE.place = opts.cushion ? 'cushion' : 'eyes';
          for (const o of this.world.vehicles) if (o.eyeSeat) o.seatDrop = seatDropUsed(o.cushionDrop);
        }
        if (opts.bridgeHull !== undefined) this.bridgeHullInFlight = opts.bridgeHull;
        p.syncMount();
        const n3 = (n: number) => Number(n.toFixed(3));
        const v3 = (a: THREE.Vector3 | readonly number[] | null) => (a ? (Array.isArray(a) ? a : (a as THREE.Vector3).toArray()).map(n3) : null);
        const seated = p.mounted === v && v.eyeSeat;
        const free = this.input.held('freeLook');
        const inCockpit = seated && this.cam.firstPerson;
        const view = free && (v.airborne || inCockpit) ? 'free look' : v.airborne ? 'chase' : inCockpit ? 'cockpit' : 'orbit';
        const eyeLocal = this.shipEyeLocal(v, new THREE.Vector3());
        const model = v.group.children[0];
        const authored = eyeLocal && model ? eyeLocal.clone().sub(model.position) : null;
        const off = v.def?.cockpit?.firstOffset ?? null;
        const want = mirroredOffset(off);
        const offsetOn = !!off && v.cockpitOffset.every((n, i) => Math.abs(n - want[i]) < 1e-9) && want.some((n) => n !== 0);
        const base = { ship: v.spec.id, seated, source: v.eyeSource, eye: v3(eyeLocal), authored: v3(authored), firstOffset: off ? [...off].map(n3) : null, offsetOn, share: n3(v.cockpitShare), seatRule: SEAT_RULE.place, view, locked: view === 'cockpit' && !v.airborne, bridgeHull: this.bridgeHullInFlight };
        if (!seated) return { ...base, seatDrop: null, lift: null, scale: null, bodyNudge: null, seatGap: null, eyeGapClip: null, eyeGapLive: null };
        const r = p.seatReport;
        const camEye = this.shipEyeWorld(v, new THREE.Vector3());
        // Where the seated clip's eyes land: the figure's matrix over the clip's first frame (or the stock seated figure).
        p.group.updateMatrixWorld(true);
        const clipEye = new THREE.Vector3();
        const clipPelvis = new THREE.Vector3();
        if (!(r.clip && p.rig?.seatedPoints(r.clip, clipEye, clipPelvis))) clipEye.fromArray(SEATED_EYE_FALLBACK).multiplyScalar(r.scale);
        clipEye.applyMatrix4(p.group.matrixWorld);
        // The live eyes: the eye joints' middle, else the head joint plus the head-to-eye step, scaled and turned with the figure.
        let liveEye: THREE.Vector3 | null = null;
        const rig = p.rig;
        if (rig) {
          const eyeBones = rig.boneNames.filter((n) => /^[lr]_?eye$/i.test(n)).map((n) => rig.bone(n)!);
          if (eyeBones.length >= 2) liveEye = eyeBones[0].getWorldPosition(new THREE.Vector3()).add(eyeBones[1].getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
          else {
            const head = rig.boneFor('head');
            if (head) liveEye = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(...HEAD_TO_EYE).multiplyScalar(r.scale).applyQuaternion(p.group.quaternion));
          }
        }
        return {
          ...base,
          seatDrop: v.seatDrop === null ? null : n3(v.seatDrop),
          lift: n3(r.lift),
          scale: n3(r.scale),
          bodyNudge: v.bodyNudge.map(n3),
          // How far the pelvis sits over the cushion measured under the eye (negative: in it), whichever rule placed the body.
          cushion: v.cushionDrop === null ? null : n3(v.cushionDrop),
          seatGap: v.cushionDrop === null ? null : n3(v.cushionDrop - r.eyeOverPelvis + r.lift + v.bodyNudge[1]),
          eyeGapClip: camEye ? n3(camEye.distanceTo(clipEye)) : null,
          eyeGapLive: camEye && liveEye ? n3(camEye.distanceTo(liveEye)) : null,
          clip: r.clip,
          firstPersonSeat: p.firstPersonSeat,
        };
      },
      /** Shadow casting by every mesh of the ship you are aboard (or the nearest ship): off, to see whether its own geometry is what keeps the sun out of the rooms. */
      shipShadows: (on = true) => {
        const p = this.player;
        const v = p.aboard?.vehicle ?? this.world.vehicles.filter((x) => x.spec.ship && !x.autopilot).sort((a, b) => a.pos.distanceTo(p.worldPos) - b.pos.distanceTo(p.worldPos))[0];
        if (!v) return 'no ship';
        let n = 0;
        const changed: string[] = [];
        v.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const was = m.castShadow;
          m.castShadow = on && !(Array.isArray(m.material) ? m.material : [m.material]).some((mat) => mat.userData.glass || mat.userData.invisible || (mat.transparent && mat.opacity < 1));
          if (m.castShadow !== was) changed.push(`${m.name || '(unnamed)'} [${(Array.isArray(m.material) ? m.material : [m.material]).map((mat) => mat.name).join('|')}] visible=${m.visible} ${was}->${m.castShadow}`);
          n++;
        });
        console.info(`shipShadows(${on}): ${changed.length} meshes changed\n  ${changed.join('\n  ')}`);
        return `${v.spec.id}: ${n} meshes ${on ? 'cast shadows again' : 'cast no shadow'}, ${changed.length} changed (listed in the console)`;
      },
      /** Whether the figure pushes the dynamic bodies it walks into (off: a hull's triangles as the pushed shape crashed the engine). */
      pushBodies: (on = true) => {
        this.player.setPushBodies(on);
        // The fighters carry the same controller and must be re-checked with it, or the knob
        // covers every body in the world except the ones there are most of.
        this.world.npcs?.setPushBodies(on);
        return on ? 'the figure and the fighters push bodies they walk into' : 'the figure and the fighters push nothing';
      },
      shipDrift: (speed = 2, spin = 0.4) => {
        const p = this.player;
        const v = p.aboard?.vehicle ?? this.world.vehicles.filter((x) => x.spec.ship && !x.autopilot).sort((a, b) => a.pos.distanceTo(p.worldPos) - b.pos.distanceTo(p.worldPos))[0];
        if (!v) return 'no ship';
        v.drift = speed !== 0 || spin !== 0;
        v.body.setGravityScale(v.drift ? 0 : 1, true);
        v.quaternion(tmpQ);
        tmp.set(0, 0, 1).applyQuaternion(tmpQ).multiplyScalar(speed);
        v.body.setLinvel({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
        v.body.setAngvel({ x: spin * 0.35, y: spin, z: spin * 0.5 }, true);
        return v.drift ? `${v.spec.id} adrift at ${speed} m/s, spinning ${spin} rad/s` : `${v.spec.id} at rest`;
      },
      vehicleState: () => this.world.vehicles.map((v) => {
        v.quaternion(tmpQ);
        const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQ).y;
        const a = v.body.angvel();
        const e = new THREE.Euler().setFromQuaternion(tmpQ, 'YXZ');
        const com = v.body.localCom();
        return { id: v.spec.id, kind: v.spec.kind, com: [com.x, com.y, com.z].map((n) => Number(n.toFixed(2))), at: v.pos.toArray().map((n) => Number(n.toFixed(2))), level: Number(upY.toFixed(3)), pitch: Math.round((e.x * 180) / Math.PI), roll: Math.round((e.z * 180) / Math.PI), spin: Number(Math.hypot(a.x, a.y, a.z).toFixed(3)), speed: Number(v.speed.toFixed(2)), corners: v.groundedPoints, ridden: v === this.player.mounted, hp: Math.round(v.hp), riderPose: v.riderPose, vel: [v.body.linvel().x, v.body.linvel().y, v.body.linvel().z].map((n) => Number(n.toFixed(2))), steer: Number(v.steer.toFixed(2)), heading: Number(v.heading.toFixed(2)), boosting: v.boosting, overheated: Number(v.overheated.toFixed(1)), meter: Number(v.meter.toFixed(2)), ...(v.wings.length ? { wingsOpen: Number(v.wingsOpen.toFixed(2)) } : {}), ...(v.spec.ship ? { airborne: v.airborne, target: this.shipTarget === v } : {}) };
      }),
      /** Remove every spawned vehicle except the one being ridden, as the garage's Remove all does. */
      unspawn: () => {
        this.world.removeVehicles(this.player.mounted ?? this.player.aboard?.vehicle ?? null);
        return this.world.vehicles.length;
      },
      spawn: async (name: string, kind?: VehicleKind) => {
        const def = (await this.loadGarage()).find(name);
        return def ? this.spawnVehicle(def, kind) : `no vehicle matches ${name}`;
      },
      /**
       * A ship's fit: `shipFit()` the ship ridden, flown or boarded (else the nearest spawned), as it stands: each slot's
       * component, its look of how many, the parts hung and those waiting for a carrier, the droid, the paint, and each
       * gun's slot, bolt and whether its muzzle is live; `shipFit('xwing')` a garage id's stock fit and its parts, with
       * what the character keeps.
       */
      shipFit: (id?: string) => this.shipFitReport(id),
      /**
       * Refit the ship ridden (else the nearest): `refit('engine', '<component>')`, `refit('weapon_0', 'wpn_light_blaster_green')`,
       * `refit('droid', 'r2')`; '' empties the slot. Kept with the character. Returns the refit's report and the programs the
       * swap made (`compiledOnSwap`, read two frames later, must be 0).
       */
      refit: (slot: string, component: string) => this.debugRefit(slot, component),
      /**
       * Repaint the ship ridden (else the nearest): `paint({ index_color_1: 20, index_texture_1: 2 })`, kept with the character;
       * `paint('static')` shows each shader's own texture from before customization, `paint('custom')` goes back. Returns the
       * same shape as `refit`.
       */
      paint: (values: Record<string, number> | 'static' | 'custom') => this.debugPaint(values),
      /** Open a ship's edit page: `shipEdit('xwing')`; `shipEdit()` reports what the page shows. */
      shipEdit: async (id?: string) => {
        if (!id) return this.shipEdit.report();
        const def = (await this.loadGarage()).find(id);
        if (!def) return `no vehicle matches ${id}`;
        this.openShipEdit(def);
        return def.fit ? `editing the ${def.label}` : `${def.id} has no fit in this pack (converted before ship customization); the page says so`;
      },
      /** The weapons rack: `weapons('dl44')` lists matches; `equip('dl44')` or `equip('dl44', 'left')` puts one in a hand, `equip(null, 'left')` empties it. */
      weapons: (find?: string) => {
        const c = this.weapons;
        if (!c) return 'no weapons converted (npm run swg -- weapons @SWG assets-private --retail-only)';
        const f = find?.toLowerCase();
        return { held: { right: this.player.equipped.right?.id ?? null, left: this.player.equipped.left?.id ?? null }, styles: this.player.allowedStyles, weapons: c.weapons.filter((w) => !f || w.id.toLowerCase().includes(f) || w.class.includes(f)).map((w) => `${w.id} (${w.class}, ${w.length} m)`).slice(0, 80), leftOut: c.skipped.length };
      },
      equip: (name: string | null, hand: 'right' | 'left' = 'right') => {
        if (name === null) return this.equip(null, hand);
        const def = this.weapons?.find(name);
        return def ? this.equip(def, hand) : `no weapon matches ${name}`;
      },
      /** The backpack's state: what is owned (with the game's name, where it is and the species' verdict), worn and held, what is being put on, the record's `inv`. */
      items: () => {
        const snap = this.equipment.snapshot();
        const ctx = this.equipment.lastContext;
        const where = (kind: 'wear' | 'weapon', id: string) => (kind === 'weapon' ? (snap.held.right === id ? 'right' : snap.held.left === id ? 'left' : 'pack') : id in snap.worn ? 'worn' : 'pack');
        return {
          inv: snap.inv,
          record: snap.record,
          species: snap.species,
          wardrobe: snap.wardrobe,
          weapons: snap.weapons,
          owned: snap.owned.map((o) => {
            const info = ctx ? itemInfo(o.kind, o.id, ctx) : null;
            return { id: o.id, kind: o.kind, name: info?.name ?? o.id, where: where(o.kind, o.id), fit: info?.fit ?? null, missing: info?.missing ?? null };
          }),
          worn: snap.worn,
          held: snap.held,
          busy: snap.busy,
        };
      },
      /** Give an item: `give('wear', 'jacket_s02')`, `give('weapon', 'baton_stun')`. It goes in the backpack, not on. */
      give: async (kind: 'wear' | 'weapon', id: string) => {
        if (kind !== 'wear' && kind !== 'weapon') return "kind is 'wear' or 'weapon'";
        const ctx = await this.equipment.itemContext();
        const info = itemInfo(kind, id, ctx);
        if (info.missing) return kind === 'wear' ? `${id} is not in this character's wardrobe` : `${id} is not on the weapons rack`;
        if (!this.current || this.creating) return 'no character is being played';
        return this.equipment.give(kind, id) ? `${info.name} is in the backpack` : `${info.name} is owned already`;
      },
      /** Use an item as a double-click does (on or off, in hand or put away); `use('sword_lightsaber_training', 'left')` for the left hand. */
      use: async (id: string, hand?: 'left') => {
        const kind = await this.kindOf(id);
        if (!kind) return `${id} is neither on the rack nor in the wardrobe`;
        return this.useItem(`${kind}:${id}`, hand);
      },
      /** Destroy an owned item (taken off or put away first). */
      destroy: async (id: string) => {
        const owned = this.equipment.owned().find((o) => o.id === id);
        if (!owned) return `${id} is not owned`;
        return this.destroyItem(`${owned.kind}:${id}`);
      },
      /** The backpack panel's state: open, how many cells, selected, how many without a picture. */
      backpack: () => this.backpack.state(),
      /** The kit a class would get, resolved against this character's catalogues; nothing is given. */
      startingKit: (cls?: ClassId) => this.equipment.kit(cls ?? this.current?.class ?? this.kit.id),
      /**
       * The head that looks where you look: where it has got to, in degrees, and every number it
       * has. `headLook({ yaw: 70 })` widens the cone, `headLook({ rate: 2 })` slows the ease so it
       * can be watched, `headLook({ ride: 1 })` lets it follow at a ship's controls (0, the default,
       * keeps it still on anything ridden) and `headLook({ yaw: 0, pitch: 0 })` is the switch that
       * puts the game back exactly as it was. `head.wantedPitch` is the degree that crosses to the
       * others; `look(yaw, pitch)` above is what aims the view itself from a driven tab.
       */
      headLook: (tune?: Partial<typeof LOOK>) => lookReport(tune, this.player.rig?.headLook ?? null),
      /** Whether the torso is held steady over running legs while a pose rides the upper body (on by default). */
      steady: (on?: boolean) => {
        if (this.player.rig && on !== undefined) this.player.rig.steady = on;
        return this.player.rig?.steady ?? null;
      },
      /** Play a clip once on the upper body over whatever the legs do (a shot, a gesture), as the game's shots play. */
      upper: (name: string) => {
        const rig = this.player.rig;
        if (!rig) return 'no rig';
        const d = rig.playUpper(name);
        return d === null ? `no clip ${name} (or a whole-body clip is playing)` : { playing: name, seconds: Number(d.toFixed(2)) };
      },
      /** The gallery world: how many mannequins are up and the animation slot nearest the player; `gallery(10)` widens the range they wake in (metres). */
      gallery: (range?: number) => {
        if (range !== undefined) RANGE.wake = Math.max(1, range);
        return this.world.gallery ? { ...this.world.gallery.status(), nearest: this.world.gallery.nearest(this.player.pos) } : 'not on the gallery planet (?planet=gallery)';
      },
      /**
       * Move the blade's axis in the hand to see where it looks right. `grip({ source: 'tags' })` swaps in the axis
       * the importer read from the game's own tag geometry (when it could), `grip({ source: 'solved' })` the one
       * solved from the swings; `grip({ tilt: 20, turn: -10 })` turns the axis by degrees about two axes at right
       * angles to it, for every clip alike (there is one true axis), and the result's `effective` field is the
       * axis to bake into the manifest. `stanceRoll` and `jkaRoll` roll the hilt about the forearm as before.
       */
      grip: (tune?: { jkaRoll?: number; stanceRoll?: number; source?: 'solved' | 'tags'; tilt?: number; turn?: number }) => {
        if (tune?.jkaRoll !== undefined) this.player.gripTune.jkaRoll = tune.jkaRoll;
        if (tune?.stanceRoll !== undefined) this.player.gripTune.stanceRoll = tune.stanceRoll;
        if (tune?.source !== undefined) this.player.gripTune.source = tune.source;
        if (tune?.tilt !== undefined) this.player.gripTune.tilt = tune.tilt;
        if (tune?.turn !== undefined) this.player.gripTune.turn = tune.turn;
        this.player.refitGrip();
        return { ...this.player.gripTune, effective: { right: this.player.tunedGrip('right'), left: this.player.tunedGrip('left') }, axes: this.player.rig?.grip ?? null };
      },
      /**
       * The ground guns' bolt speed: the multiplier in force, what a bolt is stretched to, and what
       * every trigger that fires a bolt now leaves the muzzle at in metres a second beside what it
       * left at before, slowest first. `__debug.guns({ speed: 1 })` puts every one of them back to
       * exactly the speed its own weapon data gives it, to the last bit, and draws its bolt exactly
       * the length it always was. A ship's guns are not here and are not touched: 600 m/s over
       * 512 m is the game's own number out of its own table.
       */
      guns: (opts?: Partial<GunSpeedTune> & { speed?: number }) => gunSpeedReport(opts),
      /**
       * The mark a bolt leaves: whether anything is laying them at all, whether they are switched
       * on, and how many of each family have been laid and refused. `__debug.scars({ on: 0 })` is
       * the switch that makes the game what it was. How a mark *looks* -- how wide each family is
       * drawn, how long it lasts, how much of the ring the scars have -- is `__debug.marks()`.
       */
      scars: (opts?: Partial<typeof SCARS>) => {
        if (opts) tuneScars(opts);
        return scarReport();
      },
      /**
       * The lightsaber glow. No argument: the blades lit now, whether the pass drew, the light ceiling and the flash pool.
       * `show`: 'light' the added light over a dim picture, 'normals' the normals it lit with, 'rect' the box it worked in
       * tinted, null the picture. Any number of BLADE_GLOW_TUNE (`power`, `core`, `knee`, `range`, `albedo`, `hue`,
       * `glowDim`, `wrap`, `walls`, `far`, `fadeFrom`, `whiteness`, `marchMin`) retunes live, and `tune` in the result is
       * what to bake. `flashes: true` gives the blades their pooled lights back to compare. `occlusion: false` turns the
       * wall march off, `jitter: true` offsets its taps. `at: [x, y, z]` adds up, from the CPU copy of the shader without
       * the march, the light a neutral surface there facing each blade gets.
       */
      bladeGlow: (opts?: { show?: 'light' | 'normals' | 'rect' | null; flashes?: boolean; occlusion?: boolean; jitter?: boolean; at?: [number, number, number] } & Partial<BladeGlowTune>) => {
        const fx = this.postfx;
        const pass = fx?.pass<BladeGlowPass>('bladeGlow') ?? null;
        const notes: string[] = [];
        const r3 = (v: number) => Number(v.toFixed(3));
        if (opts) {
          const live = (what: string, apply: (p: BladeGlowPass) => void) => (pass ? apply(pass) : notes.push(`${what}: the glow pass is not running (Effects off, or the pass not installed)`));
          if (opts.show !== undefined) live('show', (p) => (p.debug = Math.max(0, BLADE_GLOW_VIEWS.indexOf(opts.show ?? 'picture'))));
          if (opts.occlusion !== undefined) live('occlusion', (p) => (p.occlusion = !!opts.occlusion));
          if (opts.jitter !== undefined) live('jitter', (p) => (p.jitter = !!opts.jitter));
          if (opts.flashes !== undefined) this.bladeGlowFlashes = !!opts.flashes;
          // Floors that keep the curve finite: a zero core or knee divides by zero at the blade.
          const floor: Partial<Record<keyof BladeGlowTune, number>> = { core: 1e-4, knee: 1e-3, range: 0.01, power: 0, albedo: 0, far: 0.01 };
          for (const key of Object.keys(BLADE_GLOW_TUNE) as (keyof BladeGlowTune)[]) {
            const v = opts[key];
            if (typeof v === 'number' && Number.isFinite(v)) BLADE_GLOW_TUNE[key] = Math.max(floor[key] ?? -Infinity, v);
          }
          if (BLADE_GLOW_TUNE.fadeFrom > BLADE_GLOW_TUNE.far - 0.01) BLADE_GLOW_TUNE.fadeFrom = BLADE_GLOW_TUNE.far - 0.01;
        }
        const raw = this.settings as unknown as Record<string, unknown>;
        const strength = typeof raw.bladeGlowStrength === 'number' ? raw.bladeGlowStrength : null;
        const eye = this.cam.camera.position;
        const list = createBladeList();
        collectBlades(list, this.player.saberBlades, this.world.npcs.npcs, eye, remoteBlades.holders(this.world.mobiles?.live));
        const row = fx?.describe().passes.find((p) => p.id === 'bladeGlow') ?? null;
        const seen = pass?.lastBlades ?? null;
        const rect = pass?.lastRect ?? null;
        let at: { point: number[]; perBlade: number[]; total: number } | null = null;
        if (opts?.at) {
          const per: number[] = [];
          const total = lightAt(new THREE.Vector3(...opts.at), list, strength ?? 1, per);
          at = { point: opts.at, perBlade: per.map(r3), total: r3(total) };
        }
        return {
          effects: !!fx,
          installed: !!pass,
          setting: fxPassDef('bladeGlow').toggles.some((k) => !!this.settings[k]),
          strength,
          shadows: typeof raw.bladeGlowShadows === 'boolean' ? raw.bladeGlowShadows : null,
          drewLastFrame: row?.drewLastFrame ?? false,
          why: row ? (row.why ?? null) : fx ? 'the glow pass is not installed' : 'Effects are off',
          ownsLight: this.bladeGlowOwnsLight(),
          flashes: this.bladeGlowFlashes,
          occlusion: pass?.occlusion ?? null,
          jitter: pass?.jitter ?? null,
          show: pass ? BLADE_GLOW_VIEWS[pass.debug] ?? pass.debug : null,
          blades: list.items.slice(0, list.count).map((b) => ({
            own: b.own,
            from: b.a.toArray().map((v) => Number(v.toFixed(2))),
            to: b.b.toArray().map((v) => Number(v.toFixed(2))),
            ignition: r3(b.ignition),
            intensity: r3(b.intensity),
            color: `#${b.color.getHexString()}`,
            distance: Number(Math.sqrt(segmentDistanceSq(eye, b.a, b.b)).toFixed(1)),
          })),
          rect: rect ? [rect.x0, rect.y0, rect.x1, rect.y1].map((v) => Number(v.toFixed(2))) : null,
          litCeiling: seen ? r3(seen.litCeiling) : null,
          up: seen ? seen.up.toArray().map(r3) : null,
          pool: this.effects.poolState(),
          gpuMs: row?.gpuMs ?? null,
          tune: { ...BLADE_GLOW_TUNE },
          at,
          notes,
        };
      },
      /**
       * The Force powers. With a list it puts them in the number slots, as it always did:
       * `powers(['grip', 'pull', null, 'repulse'])` (ids from forcePowers.ts). With no argument it
       * lists the slots, every power, and **what each one draws** -- the game's own effect as it
       * fires, the one held while it lasts and the one where it lands, the beam it is drawn with,
       * the sound, and whether that pairing is the client's own (`game`), one of the client's
       * effects worn by a power the game never had (`invented`) or nothing at all (`none`, which is
       * push, repulse, jump and slow, each of which looks exactly as it always did). With an object
       * it moves `FORCE_FX`: `powers({ on: 0 })` places no Force effect at all, `powers({ fxSound:
       * 1 })` also plays the sounds a placed effect's own emitters name (which are left to the
       * power's own voice, so that a particle naming the sound its client effect already named is
       * not heard twice), and `hitEvery`, `handAhead`, `handUp`, `selfUp` and `targetShare` are the
       * rest. The beams themselves are `__debug.forceLightning()`.
       */
      powers: (ids?: (string | null)[] | Partial<ForceFxTune>) => {
        if (Array.isArray(ids)) this.setSkills('jedi', ids);
        return { slots: this.jediKit().loadout, all: POWERS.map((p) => `${p.id}: ${p.name} (${p.kind}, ${p.cost})`), ...forceFxReport(ids && !Array.isArray(ids) ? ids : null) };
      },
      /** The Bounty Hunter's gadgets in the slots: `gadgets(['cryoban', 'trip_mine', 'det_pack'])` sets them (ids from gadgets.ts), no argument lists them. */
      gadgets: (ids?: (string | null)[]) => {
        if (ids) this.setSkills('bounty_hunter', ids);
        return { slots: this.hunterKit().loadout, ...this.hunterKit().status(), all: GADGETS.map((p) => `${p.id}: ${p.name} (${p.kind}, ${p.cost})`) };
      },
      /** Stand a creature of the planet `metres` ahead, for trying the powers and guns on. */
      creature: (metres = 8) => {
        const list = () => this.world.creatures.creatures.map((c) => ({ hp: Number(c.hp.toFixed(1)), at: c.pos.toArray().map((n) => Number(n.toFixed(2))), dist: Number(c.pos.distanceTo(this.player.pos).toFixed(2)), dead: c.dead, slowed: Number(c.slowed.toFixed(1)), held: c.held, grounded: c.grounded, ragdoll: c.ragdoll?.status ?? null }));
        if (metres <= 0) return list();
        const p = this.player.pos;
        this.cam.forward(tmp);
        this.world.creatures.spawnAt(p.x + tmp.x * metres, p.z + tmp.z * metres);
        return list();
      },
      /** Stand `n` of a catalogue entry `metres` ahead (an exact id or name, else the best find); waits for their models, so the answer says whether they are up. */
      mobile: async (idOrFind: string, metres = 10, n = 1) => {
        const mobiles = this.world.mobiles;
        const cat = this.world.mobileCatalogue;
        if (!mobiles) return 'no world loaded';
        if (!cat) return 'the creature and NPC catalogue has not loaded yet (or is not converted: npm run swg -- mobiles @SWG assets-private --retail-only)';
        if (this.player.aboard) return 'nothing can be stood aboard a shipÃ¢â‚¬â„¢s rooms';
        const exact = cat.byId(idOrFind) ?? cat.resolve(idOrFind);
        const hits = exact ? [exact] : cat.search(idOrFind, { limit: 9 });
        const e = hits[0];
        if (!e) return `nothing in the catalogue matches "${idOrFind}"`;
        this.cam.forward(tmp);
        const r = mobiles.spawnAhead(e, this.player.pos, tmp, Math.max(1, Math.floor(n)), metres, this.world.inside);
        await Promise.all(r.mobiles.map((m) => mobiles.loaded(m)));
        return {
          entry: { id: e.id, name: e.name, kind: e.kind, group: e.group, pack: e.pack, appearance: e.appearance },
          spawned: r.spawned,
          note: r.note,
          matches: exact ? undefined : hits.slice(1).map((h) => h.id),
          mobiles: r.mobiles.map((m) => ({ ...m.describe(this.player.pos), error: mobiles.loadError(m) })),
        };
      },
      /** With no argument, every mobile out: state, health, distance, clip, target, tier, shadow. With a string, the catalogue search: the total and the first forty, with whether each can be stood and why not. */
      mobiles: (find?: string) => {
        const mobiles = this.world.mobiles;
        if (find === undefined) return (mobiles?.live ?? []).map((m) => m.describe(this.player.pos));
        const cat = this.world.mobileCatalogue;
        if (!cat) return 'the creature and NPC catalogue has not loaded yet (or is not converted: npm run swg -- mobiles @SWG assets-private --retail-only)';
        const all = cat.search(find, { limit: 100000 });
        return {
          total: all.length,
          first: all.slice(0, 40).map((e) => {
            const why = mobiles?.whyNot(e, cat) ?? null;
            return { id: e.id, name: e.name, kind: e.kind, group: e.group, ready: cat.ready(e).ok, standable: !why, why };
          }),
        };
      },
      /** An entry's pack and its roles by name, the gait speeds, the template's, and the walk and run the game will use: the feet check without spawning. */
      mobileRoles: async (id: string) => {
        const cat = this.world.mobileCatalogue;
        if (!cat || !this.world.mobiles) return 'the creature and NPC catalogue has not loaded yet';
        const e = cat.byId(id) ?? cat.resolve(id) ?? cat.search(id, { limit: 1 })[0];
        if (!e) return `nothing in the catalogue matches "${id}"`;
        return this.world.mobiles.rolesReport(e);
      },
      /** The model and pack cache: what is held, by whom, how many bytes, the referenced total against the budget, loads in flight. `mobileAssets(true)` trims now. */
      mobileAssets: (trim = false) => {
        const mobiles = this.world.mobiles;
        if (!mobiles) return 'no world loaded';
        const trimmed = trim ? mobiles.assets.trim() : null;
        const s = mobiles.assets.stats();
        const mb = (n: number) => Number((n / 1e6).toFixed(1));
        return { megabytes: mb(s.bytes), referencedMegabytes: mb(s.referenced), budgetMegabytes: mb(s.budget), loading: s.loading, failed: s.failed, trimmed, models: s.models, packs: s.packs };
      },
      /** Read or change live the brain's, the tiers' and the gaits' numbers, the cache budget (`{ budget: 260e6 }`), the cap and the animation range; `{ passMatrices: 'every' }` puts the portal renderer's scene walk back to once a pass, to measure what `'once'` saves. */
      mobileTune: (tune?: Parameters<import('./world/mobiles/manager').MobileManager['tune']>[0] & { passMatrices?: 'once' | 'every' }) => {
        if (tune?.passMatrices) this.portals.matrixOnce = tune.passMatrices === 'once';
        const mobiles = this.world.mobiles;
        if (!mobiles) return 'no world loaded';
        return { ...mobiles.tune(tune), passMatrices: this.portals.matrixOnce ? 'once' : 'every' };
      },
      /** Every mobile's cull sphere, whether it is on and near the screen, whether it is drawn and casts, and its tier: the check that the one sphere is in the frame it claims. */
      mobileCull: () => this.world.mobiles?.cullReport(this.cam.camera, this.player.pos) ?? 'no world loaded',
      /**
       * The indoor pathing: `nav()` says whether this pack carries floor meshes at all, how many
       * rooms name one, how many have been read, how many searches have been asked for and what
       * became of each, and what the last one cost; `nav({ reach: 0.6, every: 0.25 })` moves any of
       * the invented numbers live (they are `NAV_TUNE` in `src/world/nav/navMesh.ts`);
       * `nav({ describe: true })` reads every room's floor in the building you are standing in and
       * says what it came out as. `converted: false` is the whole of "nothing here is running":
       * that is a pack from before the floors, and every body indoors steers straight at its goal.
       *
       * The answer's `outdoor` is the other half: the world's baked walkability grid, what its
       * searches have come to and what the last one cost. `nav({ outdoor: { berth: 0 } })` moves
       * any of that side's invented numbers live (`OUTDOOR_TUNE` and `OUTDOOR_AGENT` in
       * `src/world/nav/outdoorGrid.ts` and `outdoorNav.ts`), which is where the berth lives: a
       * `berthCost` of 0 is the search exactly as it was before bodies gave anything a wide berth,
       * and `berth` cannot usefully be raised past `clearMax` cells, which is what the bake stored.
       * `ready: false` there is a world nobody has run `npm run swg -- navgrid` over, and every
       * body outdoors in it steers straight at its goal as it always did.
       */
      nav: (tune?: Partial<import('./world/nav/navMesh').NavTune> & {
        describe?: boolean;
        outdoor?: Partial<import('./world/nav/outdoorGrid').OutdoorTune & import('./world/nav/outdoorNav').OutdoorAgentTune>;
      }) => {
        const { outdoor, ...indoor } = tune ?? {};
        if (Object.keys(indoor).length) worldNav.set(indoor);
        if (outdoor) outdoorNav.set(outdoor);
        // `buildingAt` allocates a CellState, which is why this is a thing to type rather than
        // something a frame does.
        const here = tune?.describe ? this.world.buildingAt(this.player.worldPos) : null;
        return { ...worldNav.status(), outdoor: outdoorNav.status(), building: here ? worldNav.describe(here.building) : null };
      },
      /**
       * Where a body would get to, out of the line of fire, and what looking for it cost
       * (`src/world/cover.ts`, `Npc.stepCover`, and the rule itself in the shared
       * `decide`). None of this wave can be seen from a tab that draws no frames, so all of it
       * answers in numbers.
       *
       *   `__debug.cover()`               -- the account: the searcher's counters and what its
       *                                      last search cost, the ladder's three cover columns a
       *                                      tier, and a row per live fighter with its tier, its
       *                                      state, whether it wants cover and where its spot is
       *   `__debug.cover({ reach: 20 })`  -- moves the search's own numbers live (`COVER_TUNE`;
       *                                      the same knob as `__debug.fighters({ cover: Ã¢â‚¬Â¦ })`)
       *   `__debug.cover({ probe: true })`  -- runs one real search **now**, from the nearest live
       *                                      fighter's feet against you, and prints what was
       *                                      offered, what was refused and why, and the spot
       *   `__debug.cover({ probe: 2 })`   -- from fighter 2 in `__debug.fighters()`
       *   `__debug.cover({ probe: 'here' })` -- from **your own** feet against the nearest fighter,
       *                                      which is how to ask whether a place you have walked to
       *                                      is cover at all without standing a body on it
       *
       * Read `ground` before anything else: `colliders` is what the streamer has built round you
       * and `blockers` is how much of it has a shape to hide behind. Nought blockers in a town is
       * `NpcDeps.blockers` unwired or a streamer that has built nothing, and every counter below
       * reads exactly the same as a world with no crates in it. With blockers standing and the
       * searcher's `rays` at nought, the probe's own list says why: every entry `refused` for being
       * shorter than a crouched chest is a world of kerbstones, and one refused with a **negative**
       * `over` would be a model box read upside down.
       */
      cover: (opts?: Partial<import('./world/cover').CoverTune> & { probe?: boolean | number | 'here' }) => {
        const npcs = this.world.npcs;
        const { probe, ...tune } = opts ?? {};
        if (Object.keys(tune).length) tuneCover(tune);
        if (probe !== undefined && probe !== false) {
          const live = npcs.npcs.filter((n) => !n.dead);
          if (!live.length) return 'no fighter is out: __debug.fighter(1) stands one, and the probe needs one at either end (a body to search from, or a threat to search against)';
          let body = live[0];
          if (typeof probe === 'number') {
            if (!npcs.npcs[probe] || npcs.npcs[probe].dead) return `there is no live fighter ${probe}: __debug.fighters() lists ${live.length}`;
            body = npcs.npcs[probe];
          } else for (const n of live) if (n.pos.distanceToSquared(this.player.worldPos) < body.pos.distanceToSquared(this.player.worldPos)) body = n;
          const me = this.player.worldPos;
          // From your feet against the body, or from the body's feet against you. The threat is
          // always the other one's **aim point**, which is where its shots really leave from.
          return probe === 'here'
            ? npcs.coverProbe(me.x, me.y, me.z, body.pos.x, body.pos.y + body.halfHeight, body.pos.z, body.tier)
            : npcs.coverProbe(body.pos.x, body.pos.y, body.pos.z, me.x, me.y + this.world.playerTarget.halfHeight, me.z, body.tier);
        }
        return {
          search: coverSearch.status(),
          // **Read this first.** How many placed objects have collision just now and how many of
          // those have a shape to hide behind: nought blockers in a town is a wire that was never
          // connected rather than a world without crates, and every counter below reads the same
          // either way.
          ground: this.world.coverGround,
          // The three columns of the ladder this wave is about, so "a low tier barely uses cover"
          // is a number and not a claim: how often it looks, how far it will walk for a spot, and
          // how many extra metres one it can shoot back out of is worth to it.
          ladder: Object.fromEntries(Object.entries(GROUND_SKILL).map(([t, s]) => [t, { coverEvery: s.coverEvery, coverWalk: s.coverWalk, hardCost: s.hardCost }])),
          range: BRAIN_TUNE.coverRange,
          // And how long a body stays in a hole it cannot shoot out of, and how long afterwards it
          // will not take another: the two numbers that keep hard cover from being a one-way door.
          hole: { forSeconds: GROUND_STEP.hardFor, restSeconds: GROUND_STEP.hardRest },
          fighters: npcs.npcs.map((n, i) => ({ i, name: n.name, tier: n.tier, arm: n.arm, state: n.state, ...n.coverStatus() })),
        };
      },
      /** Blow up the vehicle ridden, piloted or stood in (its health to nothing), to see the rider thrown or the crew put out. */
      wreck: () => {
        const v = this.player.mounted ?? this.player.piloting ?? this.player.aboard?.vehicle ?? null;
        if (!v) return 'not on or in anything';
        v.hp = 0;
        return `${v.spec.id} wrecked`;
      },
      /** Stand `n` fighters ahead (random species, look and weapon; they fight you and each other), or with 0 list the ones out. */
      fighter: (n = 1, species?: string) => {
        for (let i = 0; i < n; i++) {
          this.cam.forward(tmp);
          const d = 8 + Math.random() * 6;
          this.world.npcs.spawnAt(this.player.pos.x + tmp.x * d + (Math.random() - 0.5) * 6, this.player.pos.z + tmp.z * d + (Math.random() - 0.5) * 6, species);
        }
        return this.world.npcs.npcs.map((f) => ({ name: f.name, arm: f.arm, weapon: f.weapon?.id ?? null, outfit: f.outfit, hp: Number(f.hp.toFixed(0)), dead: f.dead, dist: Number(f.pos.distanceTo(this.player.pos).toFixed(1)), rig: !!f.rig }));
      },
      /**
       * Send a fighter somewhere it will not forget, and read the account of how it got on
       * (`src/world/errand.ts`). The order is the creatures' brain's own first rule with the body's
       * home moved onto the destination, so it runs there, takes no target, answers nobody and
       * stops when it arrives.
       *
       *   `__debug.send('bestine')`      -- the nearest fighter to you, to that named place
       *   `__debug.send(-158, -112)`     -- to a point, the same coordinates `__debug.teleport` takes
       *   `__debug.send()`               -- the account of every walk, running and last finished
       *   `__debug.send({ track: 0 })`   -- walk 0's one-second rows, for `console.table`
       *   `__debug.send({ stop: true })` -- call every order off (each body's home is left where it stands)
       *   `__debug.send({ fighter: 2 })` with a destination picks the body by its place in `fighters()`
       *   `__debug.send({ tune: { stallSeconds: 90 } })` moves the account's own invented numbers
       *
       * The two reading options answer on their own and are taken **before** any destination, so
       * `__debug.send('bestine', { track: 0 })` prints a track and sends nobody; `fighter` and `tune`
       * are the two that go beside a destination.
       *
       * **Read `proved` before believing an arrival.** Placed-object colliders exist only within
       * 170 m of you and terrain collision within about 192 m, so a body walking alone is stopped by
       * nothing and arrives having proved nothing. The walk counts its one-second samples against
       * those two distances and says `inconclusive` rather than `arrived` when it was mostly out
       * there. Follow it on a speeder; `__debug.advance` never calls `world.update`, so under it
       * nothing streams at all and every walk is inconclusive by construction.
       */
      send: (to?: string | number | SendOpts, z?: number | SendOpts, more?: SendOpts) => {
        const npcs = this.world.npcs;
        const o: SendOpts = (typeof to === 'object' && to !== null ? to : null) ?? (typeof z === 'object' && z !== null ? z : null) ?? more ?? {};
        if (o.tune) tuneErrand(o.tune);
        if (o.stop) return `${npcs.stopErrands()} order(s) called off; each body's home was left where it stands, so none of them will run back`;
        if (o.track !== undefined) {
          const list = npcs.errandList();
          const pick = list[typeof o.track === 'number' ? o.track : 0];
          if (!pick) return 'no walk has been given yet: __debug.send(\'<place>\') starts one';
          return pick.track();
        }
        if (to === undefined || typeof to === 'object') {
          const list = npcs.errandList();
          if (!list.length) return { walks: 0, how: "__debug.send('<place>') or __debug.send(x, z); __debug.send() reads it back", fighters: npcs.npcs.length, places: this.placesHere().map((p) => p.name).sort(), tune: { ...ERRAND_TUNE } };
          return list.map((e) => e.report());
        }
        // Where to. A place name first, because the owner's own sentence names towns: the world's
        // own list, already fetched for the death card and already in the world's frame.
        let x: number;
        let zz: number;
        let place: string | null = null;
        if (typeof to === 'number') {
          if (typeof z !== 'number') return 'give both x and z, or a place name: __debug.send(-158, -112)';
          x = to;
          zz = z;
        } else {
          const places = this.placesHere();
          const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
          const want = key(to);
          const hit = places.find((p) => key(p.name) === want) ?? places.find((p) => key(p.name).includes(want));
          // A world whose list is empty is not a world with no such place: the names are fetched
          // from the pack on every world load and never awaited, and a pack from before the places
          // command carries none at all. Say which of the two it is rather than "no such place".
          if (!hit && !places.length) return `this world has no named places to hand: either its pack carries none or the list has not arrived yet. Use coordinates: __debug.send(${Math.round(this.player.worldPos.x)}, ${Math.round(this.player.worldPos.z)})`;
          if (!hit) return { noSuchPlace: to, onThisWorld: places.length, names: places.map((p) => p.name).sort() };
          x = hit.x;
          zz = hit.z;
          place = hit.name;
        }
        // Which body. The nearest live fighter unless one is named by its place in `fighters()`.
        const live = npcs.npcs.filter((n) => !n.dead);
        if (!live.length) return 'no fighter is out: __debug.fighter(1) stands one, and a creature is deliberately not what this order is for';
        let body = live[0];
        if (o.fighter !== undefined) {
          if (!npcs.npcs[o.fighter] || npcs.npcs[o.fighter].dead) return `there is no live fighter ${o.fighter}: __debug.fighters() lists ${live.length}`;
          body = npcs.npcs[o.fighter];
        } else for (const n of live) if (n.pos.distanceToSquared(this.player.worldPos) < body.pos.distanceToSquared(this.player.worldPos)) body = n;
        // `worldPos` and not `pos`: aboard a hull's rooms `pos` is the hull's frame, and the whole
        // instrument is a distance from the player measured in the world's.
        return npcs.send(body, x, zz, place, this.player.worldPos).report();
      },
      /**
       * The facilities on this world where the dead come back, nearest first; with a row number it
       * comes round at that one now, without dying, which is the only way to try the choice from a
       * tab that draws no frames. The console lists **all** of them, where the card shows its first
       * few: a world with eight is one the card cannot show whole, and the row numbers here are the
       * ones this call itself takes.
       */
      cloning: (row?: number) => {
        const rows = this.world.planet?.space ? [] : this.world.cloningFacilities(this.player.worldPos, this.placesHere(), 0);
        if (row !== undefined) {
          if (!rows[row]) return `there is no row ${row}: this world offers ${rows.length}`;
          this.deathChoices = rows;
          void this.respawnAt(row);
          return `coming round at ${rows[row].name}`;
        }
        return {
          world: this.world.planet?.id ?? null,
          places: this.placeNames.length,
          named: this.placesHere().length,
          rows: rows.map((f, i) => ({ row: i, name: f.name, away: distanceWords(f.d), at: [Math.round(f.x), Math.round(f.z)] })),
        };
      },
      /**
       * Capture where you are standing, what the camera can see and what hour it is, as one line to
       * paste back: the backdrops the character creator and the selection screen will be baked from.
       *
       * Stand the character where it should stand, aim the camera until the shot looks right, and
       * run `__debug.capture('theed-terrace')`. It reads the world, the nearest place the pack has a
       * name for, both poses, the camera's field of view and the day's own hour -- **the hour is
       * captured on purpose**, because the day runs and a backdrop that did not carry one would be
       * the same place at noon one launch and at midnight the next.
       *
       * A ship is captured too, if one is parked within reach: park it where it looks right rather
       * than typing a number at it. `__debug.capture()` with no name makes one from the world and
       * the hour. The line it prints is JSON so a chat window, a text file and a copy button all
       * carry it without a stray newline changing what it means.
       */
      capture: (name?: string) => {
        const p = this.player;
        const cam = this.cam.camera;
        cam.getWorldDirection(tmp);
        const pack = packIdOf(this.world.planet, this.zone);
        // The nearest place this pack names, if one is near enough to be what the shot is of.
        let place: string | null = null;
        let near = SCENE_PLACE_REACH;
        for (const q of this.placesHere()) {
          const d = Math.hypot(q.x - p.pos.x, q.z - p.pos.z);
          if (d < near) {
            near = d;
            place = q.name;
          }
        }
        const v = this.shipInShot(cam.position, tmp);
        const shot = captureScene({
          name,
          pack,
          place,
          space: !!this.world.planet.space,
          stand: { x: p.pos.x, y: p.pos.y, z: p.pos.z, heading: p.heading },
          camera: { x: cam.position.x, y: cam.position.y, z: cam.position.z, forward: { x: tmp.x, y: tmp.y, z: tmp.z }, fov: cam.fov },
          dayTime: this.world.day.time,
          ship: v ? { x: v.group.position.x, y: v.group.position.y, z: v.group.position.z, heading: v.heading } : null,
        });
        const line = sceneLine(shot);
        // Printed as well as returned: the console collapses an object and the whole point is a
        // line that can be selected and copied in one go.
        console.log(line);
        return { ...shot, line, paste: line };
      },
      /**
       * Stand back in one of the captured places, with the view aimed the way that shot was framed:
       * `await goToShot('tyrena')` travels to its world if you are not on it and puts you on the spot.
       * With no key it lists every place, grouped by world, which is the route to walk. Park a ship in
       * view and `captureShip('tyrena')` writes down where it stands.
       *
       * The turn is exact; how far back and how high the camera sits are close rather than exact, because
       * the orbit hangs off the body's own focus point and not off the feet. It is for recognising the
       * shot and judging where a ship looks right, and the pictures themselves are framed by `shoot`.
       */
      /**
       * Stand the character in one of the baked places, in three dimensions, with the world's own sun,
       * sky and weather: `await place('tyrena')`, `await place(null)` to come out, `await place()` to list
       * what is built. Needs `npm run swg -- scenes assets-private` to have been run.
       *
       * The captured camera is as far out as it goes, because the bake carries only what that one frustum
       * can see. Move the view with `placeView`.
       */
      place: async (key?: string | null) => {
        if (key === undefined) {
          const man = await sceneManifest();
          return man ? { built: man.places.map((p) => `${p.key} (${p.pack}, ${p.instances} things)`), showing: this.scene3d?.key ?? null } : 'no places built; run: npm run swg -- scenes assets-private';
        }
        if (key === null) {
          await this.hideScene();
          return 'out';
        }
        const ok = await this.showScene(key);
        if (!ok) return `could not stand anyone in ${key}`;
        const s = this.scene3d!;
        return { place: s.key, world: s.built.place.pack, draws: s.built.draws, models: s.built.models, triangles: s.built.triangles, missing: s.built.missing, hours: s.built.place.hours.length };
      },
      /**
       * The creator's camera while a place is up: `placeView({ zoom: 0.7, pan: 0.3, spin: 3.14 })` spins the
       * figure half round, winds in and looks up at the face; nothing reads it back.
       */
      placeView: (v?: Partial<SceneView>) => {
        const s = this.scene3d;
        if (!s) return 'nobody is standing in a place';
        if (v) s.view = clampView({ ...s.view, ...v });
        const pose = viewPose(s.orbit, s.view, ORBIT_EYE_HEIGHT);
        return { ...s.view, metres: Number(pose.distance.toFixed(2)), farthest: Number(s.orbit.distance.toFixed(2)), looksAt: Number(pose.look.y.toFixed(2)) };
      },
      goToShot: async (key?: string) => {
        const spots = sceneSpots();
        if (!key || !spots.some((s) => s.key === key)) {
          const byWorld = new Map<string, string[]>();
          for (const s of spots) byWorld.set(s.pack, [...(byWorld.get(s.pack) ?? []), s.place ? `${s.key} (${s.place})` : s.key]);
          return { error: key ? `no place is called ${key}` : 'name a place', worlds: Object.fromEntries(byWorld) };
        }
        const spot = spots.find((s) => s.key === key)!;
        let travelled = false;
        if (this.world.packId !== spot.pack) {
          const where = packPlanet(spot.pack);
          if (!where) return { error: `no world is the ${spot.pack} pack`, place: key };
          await this.travel(planetById(where.planet), where.zone);
          travelled = true;
        }
        // The captured height, not the terrain's: the shot was taken standing exactly there, and a
        // resampled ground can sit a few centimetres off after a reconversion.
        const at = new THREE.Vector3(spot.stand.x, spot.stand.y, spot.stand.z);
        this.player.reset(at);
        this.player.heading = (spot.stand.heading * Math.PI) / 180;
        // The body's own view height, not the table's default: a posture that sinks the eyes moves
        // the orbit's centre with them, and the camera would otherwise sit that much off.
        const orbit = orbitFor(spot, this.player.eyeHeight);
        this.cam.yaw = orbit.yaw;
        this.cam.pitch = orbit.pitch;
        this.cam.distance = orbit.distance;
        this.cam.zoomTarget = orbit.distance;
        this.world.enterCellAt(at);
        const words = `at ${spot.place ?? spot.key}; park a ship in view, then __debug.captureShip('${key}')`;
        this.messages.system(words);
        return { place: key, world: spot.pack, travelled, stand: spot.stand, next: words };
      },
      /**
       * Record where a ship stands for one of the captured places: park it where it looks right and
       * `captureShip('tyrena')` prints one line to paste into `SCENE_SHIPS`. A place's ship is the same at
       * every hour of it, so this is seventeen lines rather than sixty-seven captures. With no key, or one
       * nothing answers to, it lists the keys.
       *
       * What counts as "in the shot" is measured from **that shot's own camera**, not from wherever the
       * view happens to be pointing now, so you can fly the ship into place and look at it from anywhere
       * while you do. It refuses a ship on the wrong world outright.
       */
      captureShip: (key?: string) => {
        const spots = sceneSpots();
        const spot = key ? spots.find((s) => s.key === key) : undefined;
        if (!spot) return { error: key ? `no place is called ${key}` : 'name the place', places: spots.map((s) => s.key) };
        if (this.world.packId !== spot.pack) return { error: `${key} is on ${spot.pack} and you are on ${this.world.packId}; __debug.goToShot('${key}') first`, place: key };
        const camAt = new THREE.Vector3(spot.camera.x, spot.camera.y, spot.camera.z);
        const fwd = new THREE.Vector3(spot.camera.look.x - camAt.x, spot.camera.look.y - camAt.y, spot.camera.look.z - camAt.z).normalize();
        const v = this.shipInShot(camAt, fwd);
        if (!v) return { error: `no ship in front of the shot's camera within ${SCENE_SHIP_REACH} m; park one where the shot looks`, place: key };
        const g = v.group.position;
        const pose = { x: Number(g.x.toFixed(2)), y: Number(g.y.toFixed(2)), z: Number(g.z.toFixed(2)), heading: headingDegrees(v.heading) };
        const line = `  '${key}': { x: ${pose.x}, y: ${pose.y}, z: ${pose.z}, heading: ${pose.heading} },`;
        console.log(line);
        // Where it will really sit on the screen. A ship parked by eye can land exactly on the
        // frame's edge without anybody seeing it, because it is drawn live rather than baked into
        // the picture: a window narrower than the one it was judged in cuts it in half for real.
        const on = framePlace(spot.camera, pose, FRAME_ASPECT);
        const edge = Math.max(Math.abs(on.x), Math.abs(on.y));
        const framing = !on.ahead ? 'behind the shot' : edge > 1 ? 'OFF SCREEN on an ordinary window; move it toward the middle' : edge > 0.85 ? 'right on the edge; nudge it toward the middle' : 'well in frame';
        if (edge > 0.85 || !on.ahead) this.messages.system(`${key}: the ship is ${framing}`);
        return { place: key, ship: v.def?.id ?? null, pose, metres: Number(camAt.distanceTo(g).toFixed(1)), framing, screen: { x: Number(on.x.toFixed(2)), y: Number(on.y.toFixed(2)) }, line, paste: line };
      },
      /** The gun in hand: its Jedi Academy type and numbers. */
      gunType: () => {
        const p = (this.kits.bounty_hunter as BountyHunterKit | undefined ?? new BountyHunterKit(this.scene)).profile({ player: this.player } as KitContext);
        return { type: p.type, label: p.label, primary: p.blurb, alt: p.altBlurb || 'none', fx: this.player.equipped.right?.fx ?? null };
      },
      /** The blaster in hand, 'pistol' or 'rifle': which of the game's carries play. `gun('carbine', { aim: 30, aimKneel: 30, ready: 30 })` sets how far right, in degrees, that kind's torso turns while aiming standing or moving, aiming kneeling or crouched, and in the hip-fire carry, as a starting point; the barrel is then measured against the crosshair every frame and the torso turned the rest of the way (`fix`, in degrees; `gun(undefined, { fix: false })` turns that off to see the poses bare). */
      gun: (kind?: 'pistol' | 'carbine' | 'rifle' | 'heavy', tune?: { ready?: number; aim?: number; aimKneel?: number; fix?: boolean }) => {
        if (kind) {
          this.player.gunClass = kind;
          this.player.gunKind = kind === 'pistol' ? 'pistol' : 'rifle';
        }
        if (tune) {
          const t = this.player.gunTune[(kind as 'pistol' | 'carbine' | 'rifle' | 'heavy' | undefined) ?? this.player.gunClass];
          if (tune.ready !== undefined) t.ready = tune.ready;
          if (tune.aim !== undefined) t.aim = tune.aim;
          if (tune.aimKneel !== undefined) t.aimKneel = tune.aimKneel;
          if (tune.fix !== undefined) this.player.aimFix.on = tune.fix;
        }
        const fix = this.player.aimFix;
        return { kind: this.player.gunKind, class: this.player.gunClass, tune: this.player.gunTune, fix: { on: fix.on, yaw: Number(((fix.yaw * 180) / Math.PI).toFixed(1)), pitch: Number(((fix.pitch * 180) / Math.PI).toFixed(1)) }, aiming: this.player.aiming, ready: this.player.gunReady, sinceShot: Number(this.player.sinceShot.toFixed(1)), clips: this.player.rig?.clipsMatching(/pistol|rifle/) ?? [] };
      },
      /** The saber defence rank (1..3): how bolts are turned away. */
      saberDefense: (rank?: number) => {
        if (rank !== undefined) this.player.saberDefense = Math.max(1, Math.min(3, Math.round(rank)));
        return this.player.saberDefense;
      },
      player: () => {
        const p = this.player;
        return { hp: Number(p.hp.toFixed(1)), blocking: p.blocking, aiming: p.aiming, gunReady: p.gunReady, prone: p.prone, kneeling: p.kneeling, crouching: p.crouching, jkaMode: p.jkaMode, rig: p.rig?.describe() ?? null, pos: p.pos.toArray().map((v) => Number(v.toFixed(2))), camera: this.cam.camera.position.toArray().map((v) => Number(v.toFixed(2))), vel: p.vel.toArray().map((v) => Number(v.toFixed(2))), grounded: p.grounded, heading: Number(((p.heading * 180) / Math.PI).toFixed(0)), cameraYaw: Number(((Math.atan2(this.cam.camera.getWorldDirection(new THREE.Vector3()).x, this.cam.camera.getWorldDirection(new THREE.Vector3()).z) * 180) / Math.PI).toFixed(0)), swimming: p.swimming, submerged: p.submerged, water: this.world.terrain.waterHeightAt(p.pos.x, p.pos.z), swimWater: this.world.waterColumnAt(p.pos.x, p.pos.z), footWater: this.world.footSurfaces.waterTop(p.pos.x, p.pos.y, p.pos.z), inRoom: this.world.indoorsAt(p.pos.x, p.pos.y, p.pos.z), trackedRoom: this.world.inside, ground: this.world.terrain.heightAt(p.pos.x, p.pos.z), captured: this.input.captured };
      },
    };

    this.fade = document.createElement('div');
    this.fade.id = 'fade';
    this.ui.appendChild(this.fade);
    // The death card: over the fallen body, with the way back.
    this.death = document.createElement('div');
    this.death.id = 'death';
    // The list of facilities is filled on the death itself and is empty on a world that has none,
    // where the card is exactly the card it always was.
    this.death.innerHTML = `<div class="death-card"><h2>You have become one with the Force</h2><div class="death-hint" hidden></div><div class="death-list" hidden></div><button class="respawn">Respawn</button></div>`;
    this.deathHint = this.death.querySelector('.death-hint') as HTMLElement;
    this.deathList = this.death.querySelector('.death-list') as HTMLElement;
    this.death.querySelector('.respawn')!.addEventListener('click', () => this.respawn());
    this.ui.appendChild(this.death);
    this.loadingScreen = new LoadingScreen(this.ui, import.meta.env.BASE_URL);
    // Whether a long frame would be seen just now: a loading screen over the world, or a jump's
    // closed tunnel in front of it. The world asks this before it decides to pace a shader compile
    // rather than do it outright, and it is the only thing that knows the answer -- it used to
    // guess from which of its own methods was on the stack, and guessed wrongly in both directions
    // (the Effects switch and the ultra cruise's stop both run with frames being drawn). Without
    // it the pacing is still safe -- nothing can hang, and nothing compiles on a drawn frame --
    // but a loading screen would build its programs one a frame instead of the screen's allowance,
    // which is slower for no gain. `this.hyperspace` is assigned earlier in this constructor.
    this.world.playerWaiting = () => this.loadingScreen.open || this.hyperspace.covered;
    this.emoteWheel = new EmoteWheel(this.ui);
    this.remotes = new RemotePlayers(this.scene, import.meta.env.BASE_URL, async () => {
      this.world.garage ??= await Garage.load(import.meta.env.BASE_URL);
      return this.world.garage;
    });
    // A peer dressed, or their look changed: the motion blur's shaders for their outfit, before it is drawn.
    this.remotes.onDressed = (root) => void this.postfx?.product<VelocityProduct>('velocity')?.prepareRoots([root]);
    // A peer's weapons come off the same rack, and anything of theirs is compiled before it shows.
    this.remotes.weapons = () => this.weapons;
    this.remotes.prepare = (root) => this.prepareRoot(root);
    // A peer's ride is compiled before it shows, parts, glows and all (this.world was assigned in the constructor, long before).
    this.remotes.prepareVehicle = (roots) => this.world.vehiclePrepare(roots);
    // A peer's painted ship owns copies of its materials: out of the world's sets when they go (read at call time).
    this.remotes.forget = (m) => this.world.forgetMaterials(m);
    // The other players' blades keep their renderers for the next peer; the ones over that go, and a
    // disposed material must leave the portal renderer's set and the cascades' map with them.
    remoteBlades.forget = (m) => this.world.forgetMaterials(m);
    // A new mobile prototype: the motion blur's shaders for its morph counts, after the world's own preparation.
    MobileAssets.for(import.meta.env.BASE_URL).alsoPrepare = (root) => this.postfx?.product<VelocityProduct>('velocity')?.prepareRoots([root]) ?? Promise.resolve();
    this.net.onJoin = (peer) => this.remotes.add(peer.id, peer.hello);
    this.net.onHello = (peer) => this.remotes.hello(peer.id, peer.hello);
    this.net.onLeave = (id) => this.remotes.remove(id);
    this.net.onState = (id, state) => this.remotes.state(id, state);
    this.net.onEmote = (id, clip) => this.remotes.emote(id, clip);
    // One ship clamped onto another, across the relay: the word meant for this player alone (a pilot
    // asking for room on this hull, and the answer), the peers a clamp may hold to, and the way out to
    // one of them. `carrierPose` answers for this player's own ship, which is no peer's picture: a peer
    // docked onto the ship this player is on hangs from where that hull really is.
    this.net.onAsk = (from, word) => this.docking.clamp.heard(from, word, this.pilotedShip());
    this.docking.clamp.peers = this.remotes;
    this.docking.clamp.link = { id: () => this.net.id, send: (to, word) => this.net.sendAsk(to, word) };
    // The places two players can both want: a station's dock lane and the spot on a hull that one
    // ship rides another on. The claim is put to the server and the ship flies on this browser's own
    // answer meanwhile; an answer that says the place was somebody else's breaks the approach off,
    // and one that never comes leaves the local answer standing, which is the answer this browser
    // gives itself when there is no server at all. Nothing here runs in a frame.
    this.docking.spotLink = {
      active: () => this.net.session.authority === 'server',
      send: (kind, what, take) => this.net.sendWord({ t: 'claimSpot', kind, what, do: take ? 'take' : 'free' }),
    };
    // Losing the race for a dock is the one thing docking has to say that the row nobody is looking
    // at would swallow, so it goes to the message line, never to the prompt (rewritten every frame).
    this.docking.onNote = (text) => this.messages.system(text);
    // Whatever else reads the server's own words reads them first and this takes what is left, so
    // nothing hung on the same hook is unplugged.
    const spotWordWas = this.net.onWord;
    this.net.onWord = (msg) => {
      spotWordWas(msg);
      // The kind goes with the name: the server holds a spot under its world, its kind and its name,
      // so throwing the kind away here would leave two halves keyed differently and a kind added
      // later landing its answers on another kind's claim. `LaneClaims.answer` is where the two are
      // made to agree; a word with no kind on it is taken as it always was.
      if (msg?.t === 'spot') this.docking.spotAnswer(String(msg.what ?? ''), msg.granted === 1, String(msg.why ?? ''), msg.kind as SpotKind | undefined);
    };
    this.remotes.carrierPose = (to, pos, quat) => {
      const p = this.player;
      const v = to === this.net.id ? p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null : null;
      if (!v || v.disposed) return false;
      pos.copy(v.pos);
      v.quaternion(quat);
      return true;
    };
    this.net.onStatus = (status, detail) => {
      this.netStatus = detail ? `${status} (${detail})` : status;
    };
    // The join word carried on the address (?server=... &word=...) is the one this browser joins with
    // from now on, exactly as the address's server is the one it keeps.
    const joinWord = Session.savedWord();
    if (joinWord) this.net.session.setWord(joinWord);
    // Everything the session has to tell the player -- joining, which kind of line this is, a character
    // opened in another browser, a refusal -- goes to the message line, which holds it long enough to be
    // read. Nothing of this goes to the prompt, which is rewritten every frame.
    this.net.onNotice = (text) => this.messages.system(text);
    // What the server made of this character. Nothing applies it yet: the server holds a character's
    // name, where it is and its change counter, and what it owns comes with the ledger later.
    this.net.session.onSettled = (what, record) => {
      if (what === 'server') console.info('the server holds its own copy of this character:', record);
    };
    // The session's numbers and what it has made of the line, live: `__debug.session()` reads them and
    // `__debug.session({ hailWait: 2000 })` sets the one number this side invents (how long to wait for
    // a server to speak first before deciding this is the relay that came before). The clock's numbers
    // are not here; they are `__debug.day()`'s.
    const debugRoot = (window as unknown as { __debug?: Record<string, unknown> }).__debug;
    if (debugRoot) debugRoot.session = (o?: Partial<typeof SESSION>) => (o ? { ...tuneSession(o), ...this.net.session.debug() } : this.net.session.debug());

    // ---- The world's creatures, and whose browser thinks for each of them. ----
    //
    // Nothing appears in a world on its own: an admin stands a creature by hand and what they stand
    // belongs to the world, so everyone connected sees it and exactly one browser runs its brain.
    // Which browser that is, is the server's answer and nobody else's (server/ownership.mjs); this
    // side holds the answer and asks `owned.mine(id)`. With no address set the whole thing is quiet
    // and every creature is this browser's, which is the game exactly as it is played alone.
    //
    owned.send = (msg) => this.net.sendWord(msg);
    owned.authority = () => this.net.session.authority;
    owned.admin = () => this.net.session.isAdmin;
    owned.onNote = (text) => this.messages.system(text);
    // Whether this tab is being drawn at all. The module never reads the document itself; it asks,
    // and says what it is on the first word it hears on a line, which is what covers a page opened
    // in a background tab -- `visibilitychange` fires on a change and there has not been one.
    owned.visible = () => !document.hidden;
    // Whatever else reads the server's own words reads them first and this takes what is left, so
    // nothing hung on the same hook is unplugged.
    const ownedWordWas = this.net.onWord;
    this.net.onWord = (msg) => {
      ownedWordWas(msg);
      owned.handle(msg);
    };
    // A line that dropped, was put down or was taken over leaves none of this behind: what this
    // browser kept was the server's to give, and with no line there is nothing to say a creature has
    // died. The handler already on the hook is kept and called first.
    const ownedStatusWas = this.net.onStatus;
    this.net.onStatus = (status, detail) => {
      ownedStatusWas(status, detail);
      if (status !== 'online') owned.clear();
    };
    // A tab put to sleep draws no frames and sends nothing at all, so it says so on its way out and
    // whatever it was thinking for goes to somebody who is awake; saying nothing would leave those
    // creatures standing still until the server's own minute of silence ran out.
    document.addEventListener('visibilitychange', () => owned.sayAwake(!document.hidden));
    if (debugRoot) {
      // `__debug.owned()` says what this browser keeps: how many the world holds here, how many are
      // this browser's, which by id, how many have changed hands either way, and how long ago the
      // last one did. All numbers: none of it can be seen from a driven tab. `{ asksPerSecond: 2 }`
      // sets one of this side's own manners; the rule's own numbers are the server's and are printed
      // on its status page, because the server is what decides and two copies of a rule is one too
      // many.
      debugRoot.owned = (o?: Partial<typeof OWN_TUNE>) => (o ? { ...owned.debug(), tune: tuneOwned(o) } : { ...owned.debug(), tune: OWN_TUNE });
    }

    // ---- Where the world's creatures have got to. ----
    //
    // `owned` above says what stands in this world and which browser thinks for each of them; this
    // says where the ones this browser thinks for have got to, four times a second, and carries a
    // blow struck against one it does not keep to the browser that does. A creature nobody here
    // keeps runs no brain and no physics: it is eased toward what it is told and plays the clip its
    // told pace asks for (`src/world/mobiles/mobile.ts`). With no server none of it runs and every
    // creature is this browser's own, which is the game exactly as it is played alone.
    const creatures = new NpcNet();
    creatures.send = (msg) => this.net.sendWord(msg);
    creatures.authority = () => this.net.session.authority;
    creatures.keeps = (id) => owned.mine(id);
    // Which creatures the server has granted this browser, asked once a batch and never in a frame.
    // `keeps` answers about a creature something here already holds; this is what finds the one
    // nothing here holds at all -- a grant for a species this browser's catalogue does not know, or
    // one whose model never landed -- which is handed back rather than left frozen on every screen
    // in the world. The array is refilled rather than rebuilt, so the asking allocates nothing.
    const grantedIds: string[] = [];
    creatures.granted = () => {
      grantedIds.length = 0;
      for (const r of owned.list) if (owned.mine(r.id)) grantedIds.push(r.id);
      return grantedIds;
    };
    // A death has one word, and it is the spawn list's: this browser's own creature dying goes out
    // as the list's `dead` rather than as a second word of this module's.
    creatures.died = (id) => {
      owned.sayDead(id);
      return owned.active;
    };
    creatures.buried = (id) => owned.dead(id);
    // Who struck, so a creature turns on the right person: the blow carries a relay id, the peers'
    // bodies turn that into the key everything alive is known by, and the one list of the living is
    // where the body itself is. Nobody found is a blow that lands with nobody to blame. It is only
    // ever asked for a blow that said the player at that browser struck it themselves, since that is
    // the only person over there this side can name.
    creatures.attacker = (id) => {
      const key = peerBodies().keyOf(id);
      if (!key) return null;
      for (const t of this.world.targets()) if (t.key === key) return t;
      return null;
    };
    // The two things worth a word: a grant this browser cannot honour and has handed back, and rows
    // about more creatures than it is keeping track of. Both happen on a clock, so the module holds
    // them to one word every `NPC_TUNE.noteEvery` seconds of its own accord.
    creatures.onNote = (text) => this.messages.system(text);
    // Read after whatever is already on the hook, so neither unplugs the other.
    const creatureWordWas = this.net.onWord;
    this.net.onWord = (msg) => {
      creatureWordWas(msg);
      creatures.handle(msg);
    };
    // A line that dropped, was put down or was taken over: every creature goes back to being this
    // browser's own, because a body left driven would stand still for ever with nobody to drive it.
    const creatureStatusWas = this.net.onStatus;
    this.net.onStatus = (status, detail) => {
      creatureStatusWas(status, detail);
      if (status !== 'online') creatures.clear();
    };
    if (debugRoot) {
      // `__debug.npcs()` says what this browser thinks for and what is being driven at it: `kept`
      // and `driven` with their ids, the batches and rows said and heard, blows asked and applied,
      // how many are waiting for a body, how many keepers have gone quiet and how many grants were
      // handed back. All numbers: none of it can be seen from a driven tab. `{ batchHz: 10 }` sets
      // one of this side's own manners.
      debugRoot.npcs = (o?: Partial<typeof NPC_TUNE>) => (o ? { ...creatures.rows(), tune: tuneNpcs(o) } : creatures.rows());
    }

    // What the world's list says stands here is what is stood here. The list's own shape is not the
    // manager's, so it is turned into a record on the way in; everything else about standing one --
    // the catalogue entry, the ground under it, everything it rolls -- is the record's own.
    const recordOf = (r: SpawnRow): SpawnRecord => ({ id: r.id, world: r.world, species: r.species, x: r.at[0], y: r.at[1], z: r.at[2], heading: r.h, seed: r.seed, inside: r.inside });
    // Stand one of the world's, and put on it what has been done to it. The share is the one thing
    // about a creature that is not in the record: a creature that has been fought is not the creature
    // that was stood, and a browser walking up to a half-killed animal must not stand it up whole. A
    // row with no share at all is one nobody has said anything about, which is a whole one.
    const standRow = (r: SpawnRow, here: string): void => {
      const mobiles = this.world.mobiles;
      if (!mobiles) return;
      const m = mobiles.standRecord(recordOf(r), here);
      if (typeof m !== 'string' && r.hp !== undefined && r.hp < 1) m.hp = Math.max(0, Math.min(m.maxHp, r.hp * m.maxHp));
    };
    owned.onList = (rows) => {
      const mobiles = this.world.mobiles;
      if (!mobiles) return;
      // A list is a world handed over whole: it arrives on reaching one and after every travel. What
      // was remembered about where the last world's creatures stood is not about this one and goes
      // now, or a page that has travelled enough times holds its whole allowance of parked rows in
      // worlds that are gone and refuses the rows of the world it is standing in.
      creatures.freshWorld();
      const here = this.worldKey();
      const wanted = new Set<string>();
      for (const r of rows) {
        wanted.add(r.id);
        standRow(r, here);
      }
      // A list is the whole truth about a world: whatever is not in it is not there any more.
      for (const m of [...mobiles.live]) {
        const id = mobiles.worldIdOf(m);
        if (id && !wanted.has(id)) mobiles.removeById(id);
      }
    };
    owned.onAdd = (row) => standRow(row, this.worldKey());
    owned.onGone = (id, why) => {
      // A death is played out where the body stands and the manager takes it down in its own time;
      // one taken down by an admin goes at once.
      creatures.noteGone(id, why === 'dead' ? 'dead' : 'gone');
      if (why !== 'dead') this.world.mobiles?.removeById(id);
    };

    // ---- The group and the words players type at each other. ----
    //
    // The server holds who is in a group and who hears what; this side shows it and asks for things.
    // Everything below asks the session, never the socket, so with no address set -- or against the
    // relay that came before -- the group is empty, the chat sends nothing, no panel opens and the
    // game is exactly what it is without a server. The panels are made here and nothing of them runs
    // in a frame: the roster changes when the server says so, the distances are worked out four times
    // a second, and the only loop is the one that carries a bubble over a speaker's head, which runs
    // while there is a bubble and stops when there is not.
    const groups = new Groups();
    groups.send = (msg) => this.net.sendWord(msg);
    groups.authority = () => this.net.session.authority;
    groups.selfId = () => this.net.id;
    // The countdowns on an invitation are the server's own clock, which the shared clock estimates:
    // two machines with a minute between their own clocks would otherwise show two different waits.
    groups.serverNow = () => sharedClock.now();
    groups.meAt = (out) => {
      const at = this.player?.worldPos;
      if (!at) return false;
      out.x = at.x;
      out.y = at.y;
      out.z = at.z;
      return true;
    };
    // Where a member's figure last was: their own state, which is a world place whatever they are in
    // or on. A member on another world has no distance worth showing, and says so by answering false.
    const onThisWorld = (hello: Hello): boolean => (hello.planet ?? '') === (this.world.planet?.id ?? '') && (hello.zone ?? '') === (this.zone ?? '');
    groups.peerAt = (id, out) => {
      const peer = this.net.peers.get(id);
      const s = peer?.state;
      if (!peer || !s || !onThisWorld(peer.hello)) return false;
      out.x = s.p[0];
      out.y = s.p[1];
      out.z = s.p[2];
      return true;
    };
    groups.peerByName = (name) => {
      const want = name.toLowerCase();
      for (const peer of this.net.peers.values()) if (onThisWorld(peer.hello) && peer.hello.name.toLowerCase() === want) return peer.id;
      for (const peer of this.net.peers.values()) if (onThisWorld(peer.hello) && peer.hello.name.toLowerCase().startsWith(want)) return peer.id;
      return 0;
    };
    // The maps' own group layer: the roster, each member where their own state last put them. A
    // member on another world has no place on this map and is left to the roster on the display; the
    // local player is left out, because their own mark is already on both maps. The map calls this
    // once for every frame its window draws, so nothing here makes anything: the point is filled in
    // place, and a member is named by the id the group knows them by, which does not change when
    // they reconnect and is not 0 while they are away. A group that has gone leaves no roster, so
    // the layer and its box go with it and nothing has to be unset.
    const groupMapAt = { x: 0, y: 0, z: 0 };
    groupMapFeed.fill = (out) => {
      const roster = groups.roster;
      if (!roster) return;
      for (const m of roster.members) {
        if (m.me) continue;
        const here = groups.peerAt(m.id, groupMapAt);
        out.add(m.mid, m.name, m.leader, here, groupMapAt.x, groupMapAt.y, groupMapAt.z);
      }
    };
    groups.onNote = (text) => this.messages.system(text);

    // ---- Going where the group goes. ----
    //
    // The offer is the group's: a leader crossing to another world hands everybody else the same
    // trip, with a countdown on it, and nobody is moved without saying yes. What is wired here is
    // what a trip means on this side -- which crossing keeps it, and where to come out so that a
    // group that left together is still together when the loading screen lifts. A member standing
    // in somebody else's hull is not moved at all and is asked to step out first: nothing here
    // carries a passenger out of another browser's rooms, so nothing here pretends to.
    const together = this.together;
    together.send = (msg) => this.net.sendWord(msg);
    together.authority = () => this.net.session.authority;
    together.note = (text) => this.messages.system(text);
    // The same clock the group's own countdowns are measured against: two machines a minute apart
    // on their own clocks would otherwise wait different lengths for the same word.
    together.now = () => sharedClock.now();
    together.offerTrip = (where) => groups.offerTrip(where);
    together.leading = () => groups.leading;
    together.others = () => (groups.roster ? groups.roster.members.reduce((n, m) => n + (m.me ? 0 : 1), 0) : 0);
    together.myMid = () => groups.roster?.you ?? '';
    together.leaderId = () => groups.roster?.members.find((m) => m.leader)?.id ?? 0;
    // Only somebody still on the roster is somebody to arrive beside: a member who left, or a group
    // that has gone, would otherwise go on being followed until their place aged out.
    together.inGroup = (id) => !!groups.roster?.members.some((m) => m.id === id);
    together.isSpace = (id) => !!PLANETS.find((p) => p.id === id)?.space;
    together.here = () => {
      const p = this.player;
      // A hull whose rooms this player is standing in and which this browser does not fly is
      // somebody else's: they carry their passengers, and a passenger who travelled by themselves
      // would step out of a ship still parked where it was.
      const hull = p.aboard?.vehicle ?? null;
      const mine = !hull || this.world.vehicles.includes(hull);
      return {
        planet: this.world.planet?.id ?? '',
        zone: this.zone ?? '',
        inSpace: !!this.world.planet?.space,
        flying: !!this.pilotedShip(),
        aboardOther: !!hull && !mine,
        busy: this.traveling || this.dying || !this.started || !this.inWorld || this.hyperspace.phase !== 'idle',
      };
    };
    together.onGo = (move) => void this.crossWithGroup(move);
    // The server has taken this browser's yes: from here it is a crossing like any other.
    groups.onTravel = (where) => void together.take(where);
    // Saying yes is asked about before it is said. The server counts an acceptance once and for
    // all, and refuses a second one, so a member who said yes while a loading screen was still up,
    // or while standing in a friend's cabin, would be locked out of a trip that is still standing
    // for the rest of the group. Refused here, the offer is left where it is, with its countdown
    // running, and can be taken the moment the reason has gone.
    const acceptWas = groups.acceptTrip.bind(groups);
    groups.acceptTrip = () => {
      const trip = groups.trip;
      if (trip) {
        const plan = together.canTake({ planet: trip.planet, zone: trip.zone, how: trip.how, at: trip.at });
        if (plan.do === 'stay') {
          this.messages.system(plan.why || 'that is not a trip to take from here');
          return;
        }
      }
      acceptWas();
    };
    // A jump is a crossing the travel path never sees: inside a system nothing is loaded at all, and
    // to another system the hull is carried across rather than arrived in. So the jump says for
    // itself where it is going, as the countdown starts, and where it came out when it ends. Where
    // it will come out is asked for only when there is somebody to tell, since working that out is
    // a pass over the system's landmarks and a game played alone must pay nothing for a word it
    // never sends; what it came to is in `__debug.together().lastTrip`.
    this.hyperspace.onJump = (zone, endOf) => {
      if (together.telling) together.leaving(zone, '', 'jump', endOf());
    };
    this.hyperspace.onArrived = (zone, at) => together.arrived(zone, '', [at[0], at[1], at[2]]);
    // The words the group says about crossing reach this browser through the same hook the roster
    // and the chat do; whatever was on it is kept and called first, so nothing is unplugged.
    const crossWordWas = this.net.onWord;
    this.net.onWord = (msg) => {
      crossWordWas(msg);
      together.handle(msg);
    };
    // A line that dropped or was taken over leaves no trip and no places behind: what the group held
    // is the server's, and a place somebody reported before the line went is not worth standing at.
    const crossStatusWas = this.net.onStatus;
    this.net.onStatus = (status, detail) => {
      crossStatusWas(status, detail);
      if (status !== 'online') together.clear();
    };
    if (debugRoot) {
      // `__debug.together()` says what it is doing and `__debug.together({ spreadSpace: 300 })` sets
      // one of this side's own numbers; `{ take: true }` takes the offer up without the panel, which
      // is how a script with no mouse answers one, and `{ offer: true }` offers the group the world
      // this browser is on. A trip this browser could not keep is refused before the yes is sent,
      // here as at the panel, and says why in the message line. Every number here is ours; the
      // group's own ranges are the game's and are printed by `__debug.group()`.
      debugRoot.together = (o?: Partial<typeof TOGETHER_TUNE> & { take?: boolean; offer?: boolean }) => {
        if (o) tuneTogether(o);
        if (o?.offer === true) together.leaving(this.world.planet?.id ?? '', this.zone ?? '', this.world.planet?.space ? 'space' : 'ground', null);
        if (o?.take === true) {
          const trip = groups.trip;
          if (trip) groups.acceptTrip();
          else this.messages.system('there is no trip to take');
        }
        return { ...together.debug(), tune: TOGETHER_TUNE, trip: groups.trip };
      };
    }
    // Whatever else reads the server's own words reads them first and this takes what is left, so a
    // later wave hanging its own words on the same hook does not unplug the group's.
    const wordWas = this.net.onWord;
    this.net.onWord = (msg) => {
      wordWas(msg);
      groups.handle(msg);
    };
    // A line that dropped, was put down or was taken over leaves nothing of the group behind: the
    // server is what holds it, and a roster left on the screen with no line under it is a lie. The
    // handler the relay wiring set is kept and called first, so nothing it does is lost.
    const statusWas = this.net.onStatus;
    this.net.onStatus = (status, detail) => {
      statusWas(status, detail);
      if (status !== 'online') groups.clear();
    };
    // Where a peer's figure is *drawn* this frame, which is not where their last message put them:
    // the figure glides toward that point over the tenth of a second between messages, and a
    // passenger in somebody else's hull is drawn from the carrier's own pose. A label over a head has
    // to hang on the drawn place or it swims and snaps ten times a second; the distances and the 90 m
    // check read the message's own place, where that lag does not matter. `peerAnchor` is
    // `RemotePlayers`', and while it is not there yet this falls back on the message's place, which
    // is what the labels used before.
    const drawnAt = this.remotes as RemotePlayers & { peerAnchor?: (id: number, out: { x: number; y: number; z: number }) => boolean };
    const peerAnchor = (id: number, out: { x: number; y: number; z: number }): boolean => (drawnAt.peerAnchor ? drawnAt.peerAnchor(id, out) : groups.peerAt(id, out));
    // A mood, set from the chat line. It is one word that writes two things: the body takes the
    // animation table's branch through the rig's own selector machinery when the pack has one, and
    // the name is kept on the character and sent in the hello whether it has one or not, so that
    // what this player says is marked with it on every screen. A pack converted before the moods
    // simply has no branch, which is said in words and is never an error.
    const setMood = (arg: string): string => {
      const rig = this.player.rig;
      const known = { body: rig ? rig.moodValues() : [] };
      if (!arg.trim()) return moodListLine(this.current?.mood ?? '', known);
      const off = isMoodOff(arg);
      const mood = off ? null : findMood(arg, known);
      if (!off && !mood) {
        const word = cleanMoodName(arg);
        return word ? `there is no mood called ${word}` : 'a mood is one word';
      }
      const inBody = rig ? rig.setMood(mood ? mood.id : null) : false;
      if (this.current && !this.creating) {
        this.current.mood = mood ? mood.id : '';
        upsertCharacter(this.current);
      }
      // Resent as a change of clothes is, so the others see it; with no server there is nobody to tell.
      this.queueHello();
      return moodNote(mood, inBody);
    };
    const chatUi = new ChatUi(this.ui, {
      groups,
      say: (speaker, text, colour) => (speaker ? this.messages.spatial(speaker, text, colour) : this.messages.note(text)),
      project: (x, y, z, out) => this.projectToScreen(x, y, z, out),
      anchor: peerAnchor,
      meAt: (out) => groups.meAt(out),
      canOpen: () => this.started && this.inWorld && !this.traveling && !this.menu.open && !this.map.open && !this.anyPanelOpen(),
      // Typing takes the keyboard from the game without taking the mouse: the field has the keys (the
      // game's own input stands aside for a field), and the view is not thrown out of its lock for a
      // line of chat. `captured` is also what keeps the Escape that closes the line from opening the menu.
      typing: (on) => {
        this.input.captured = on;
      },
      // Escape shuts the line, and the browser takes the pointer lock back on the same press: ask for
      // it again. `requestLock` already knows a browser refuses one straight after Escape and asks
      // again a moment later, so this is the whole of it.
      relock: () => this.input.requestLock(),
      mood: setMood,
      // Whose mood marks a line: a peer's own word for it out of their hello, and this player's out
      // of the record being played. Never read from anything drawn, and '' for anybody in none. A
      // negative id is a speaker the server did not name, which is nobody: it takes no mark at all
      // rather than this player's, which would put a mood on a stranger that was never theirs.
      moodOf: (id) => (id > 0 ? (this.net.peers.get(id)?.hello.mood ?? '') : id === 0 ? (this.current?.mood ?? '') : ''),
    });
    const groupUi = new GroupUi(this.ui, {
      groups,
      note: (text) => this.messages.system(text),
      // The trade wiring is built after this panel, so the ledger is reached through the holder it
      // fills in rather than captured here; with none there is no button at all.
      trade: (id, name) => this.tradeAsk?.(id, name) ?? 'trading is not wired here',
      project: (x, y, z, out) => this.projectToScreen(x, y, z, out),
      anchor: peerAnchor,
      // Where the eye is and which way it looks, out of the camera's own matrix: column 3 is where it
      // stands and column 2 negated is where it looks, as the nameplates already read it.
      view: (eye, dir) => {
        const pm = this.cam.camera.matrixWorld.elements;
        eye.x = pm[12];
        eye.y = pm[13];
        eye.z = pm[14];
        dir.x = -pm[8];
        dir.y = -pm[9];
        dir.z = -pm[10];
        return this.started && this.inWorld;
      },
      peersHere: (out) => {
        let n = 0;
        for (const peer of this.net.peers.values()) {
          const s = peer.state;
          if (!s || !onThisWorld(peer.hello)) continue;
          const slot = out[n] ?? (out[n] = { id: 0, name: '', x: 0, y: 0, z: 0 });
          slot.id = peer.id;
          slot.name = peer.hello.name;
          slot.x = s.p[0];
          slot.y = s.p[1];
          slot.z = s.p[2];
          n++;
        }
        return n;
      },
      canOpen: () => this.started && this.inWorld && !this.traveling && !this.menu.open && !this.map.open && !this.anyPanelOpen(),
      freeMouse: (free) => this.freeMouse(free),
    });
    // The group's panel moves by its title and sizes by its corner, as every other window does.
    draggable(groupUi.root, '.group-panel', 'h3', 'group');
    if (debugRoot) {
      // `__debug.group()` reads what the group is doing and `__debug.group({ chevron: 60 })` sets one
      // of this side's own numbers; `{ ui: { panelKey: 'KeyY' } }` sets the panel's. The distances an
      // invitation, a trade and a duel reach are the game's own table's and are printed, not settable.
      debugRoot.group = (o?: Partial<typeof GROUP_TUNE> & { ui?: Partial<typeof GROUP_UI_TUNE> }) => {
        if (o?.ui) tuneGroupUi(o.ui);
        if (o) tuneGroups(o);
        return { ...groups.debug(), roster: groups.roster, tune: GROUP_TUNE, ui: { ...GROUP_UI_TUNE, ...groupUi.debug() }, ranges: GROUP_RANGE };
      };
      // `__debug.chat()` reads the line and the bubbles; `__debug.chat({ bubbleWidth: 320 })` sets one;
      // `__debug.chat({ open: true })` opens the line, which is how a script with no keyboard types.
      debugRoot.chat = (o?: Partial<typeof CHAT_TUNE> & { open?: boolean; send?: string; scope?: 'say' | 'group' }) => {
        if (o) tuneChat(o);
        if (o?.open === true) chatUi.show(o.scope);
        if (o?.open === false) chatUi.close();
        const answer = typeof o?.send === 'string' ? groups.type(o.send, o.scope ?? 'say') : '';
        return { ...chatUi.debug(), answer, tune: CHAT_TUNE, log: groups.log.map((l) => `${l.scope === 'group' ? '[group] ' : ''}${l.name}: ${l.text}`) };
      };
      // `__debug.mood()` says what mood is on, whether the pack really had a branch for it and which
      // moods the pack carries; `__debug.mood({ set: 'angry' })` sets one without the chat line, which
      // is how a script with no keyboard tries them; `__debug.mood({ body: 0 })` is the switch that
      // leaves the body exactly as it was and keeps only the chat's mark.
      debugRoot.mood = (o?: Partial<typeof MOOD_TUNE> & { set?: string }) => {
        const rig = this.player.rig;
        if (o) tuneMoods(o);
        // The body switch takes effect on the mood already worn rather than at the next one.
        if (o && rig) rig.setMood(rig.mood, true);
        const answer = typeof o?.set === 'string' ? setMood(o.set) : '';
        const report = moodReport(null, { mood: this.current?.mood ?? '', inBody: rig?.moodInBody ?? false, pack: rig ? rig.moodValues() : [] });
        return { ...report, answer, body: rig?.mood ?? '' };
      };
    }

    // Where the display's roster reads the group from. The same array between changes, so nothing is
    // allocated to read it, and the roster writes only the values that have moved.
    this.roster.source = () => (groups.roster ? groups.roster.members : null);

    // ---- The things you own, and trading them. ----
    //
    // The server holds a row per item and moves two rows in one step (server/ledger.mjs). This side
    // holds a cache of that list and a window showing what each of you has put in; it moves nothing
    // itself, ever. An item leaves this backpack only when the server's own list comes down, which
    // is what makes it impossible for one browser to end a trade holding both halves of it.
    //
    // Everything asks the session, never the socket, so with no address set -- or against the relay
    // that came before -- nothing is sent, no window opens, the backpack is local storage exactly as
    // it always was and the game is what it is without any of this.
    const trade = new Trade();
    trade.send = (msg) => this.net.sendWord(msg);
    trade.authority = () => this.net.session.authority;
    trade.selfId = () => this.net.id;
    // The countdown on a question is the server's own clock, which the shared clock estimates.
    trade.serverNow = () => sharedClock.now();
    // The 8 m is measured from where the two figures last stood, which is the same pair of answers
    // the group's own 90 m is measured from; the server measures it again and is what decides.
    trade.meAt = (out) => groups.meAt(out);
    trade.peerAt = (id, out) => groups.peerAt(id, out);
    trade.owns = (kind, id) => this.equipment.owns(kind, id);
    trade.inUse = (kind, id) => this.equipment.inUse(kind, id);
    // What this browser holds for the character in play, for the one moment it hands its list up.
    // The first time a character is handed up this is what the server writes down; after that its
    // own rows stand and this browser is told them instead of being merged with.
    trade.mine = () => {
      const rec = this.creating ? null : this.current;
      if (!rec) return null;
      const items: TradeItem[] = [];
      for (const o of rec.items ?? []) items.push({ kind: o.kind, id: o.id, got: o.got });
      return items;
    };
    // What the record says about itself, which goes up with the list: "a server has taken this
    // character down before". An empty list under that mark is a browser whose storage was cleared,
    // not a character that owns nothing, and it is what keeps a cache from being written back over
    // a server that has never held this character (a fresh one, or one restored from an older
    // snapshot). A server that knows nothing of the mark ignores it and nothing changes.
    trade.mark = () => {
      const rec = this.creating ? null : this.current;
      if (!rec) return null;
      return { known: knownToServer(rec), rev: rec.rev ?? 0 };
    };
    // What is on the body and in the hands, which is what the server refuses an offer of a worn
    // shirt with. The whole of it each time, and only when it has moved.
    trade.using = () => {
      const snap = this.equipment.snapshot();
      const worn: TradeItem[] = [];
      for (const id of Object.keys(snap.worn)) worn.push({ kind: 'wear', id, got: 0 });
      const held: TradeItem[] = [];
      for (const id of [snap.held.right, snap.held.left]) if (id) held.push({ kind: 'weapon', id, got: 0 });
      return { worn, held };
    };
    // The server's list, which stands: the record is marked as the server's, and the equipment
    // writes the backpack, the body and the hands from it in one step. Nothing else in the game may
    // write the items while there is a server holding them. `take` is the server's own word for
    // which copy stood -- `browser` the first time this character was handed up, `server` after.
    trade.onList = (items, take) => {
      const rec = this.creating ? null : this.current;
      if (!rec) return;
      const wasKnown = knownToServer(rec);
      markKnownToServer(rec, this.net.session.counterOf(rec.id));
      if (take === 'server' && !wasKnown) this.messages.system('this server holds its own list of what this character owns, and it is the one that stands');
      void this.equipment.reconcile(items).then((note) => {
        if (note !== 'dropped' && note !== 'nothing in the backpack changed') this.messages.system(note);
        if (this.backpack.open) void this.refreshBackpack();
        // What is worn and held goes up after the list, because it is named by the server's own row
        // ids and those are only known once a list has arrived.
        trade.tellUsing();
      });
    };
    trade.onNote = (text) => this.messages.system(text);
    // An item given or destroyed here goes to the ledger as well, and what is on the body and in the
    // hands is said whenever it moves, since that is what the server refuses an offer of a worn
    // shirt with. Neither is how an item moves between two players: that is a trade, and only the
    // server moves those.
    this.tradeLedger = (what, kind, id) => {
      if (what === 'add') trade.noteAdded(kind, id, Date.now());
      else trade.noteDropped(kind, id);
    };
    this.tradeUsing = () => trade.tellUsing();
    // The moment the server has taken this browser's claim, its list goes up: a character the server
    // has never seen is written down from it, and after that the server's list is the truth.
    this.net.session.onClaimed = () => trade.tell();
    const tradeUi = new TradeUi(this.ui, {
      trade,
      note: (text) => this.messages.system(text),
      look: (kind, id) => {
        const ctx = this.equipment.lastContext;
        if (!ctx) return { name: id.replace(/_/g, ' '), icon: null };
        const info = itemInfo(kind, id, ctx);
        return { name: info.name, icon: info.icon };
      },
      owned: () => {
        const rows: { item: TradeItem; use: 'worn' | 'right' | 'left' | null }[] = [];
        for (const o of this.equipment.owned()) rows.push({ item: { kind: o.kind, id: o.id, got: o.got }, use: this.equipment.inUse(o.kind, o.id) });
        return rows;
      },
      view: (eye, dir) => {
        const pm = this.cam.camera.matrixWorld.elements;
        eye.x = pm[12];
        eye.y = pm[13];
        eye.z = pm[14];
        dir.x = -pm[8];
        dir.y = -pm[9];
        dir.z = -pm[10];
        return this.started && this.inWorld;
      },
      peersHere: (out) => {
        let n = 0;
        for (const peer of this.net.peers.values()) {
          const s = peer.state;
          if (!s || !onThisWorld(peer.hello)) continue;
          const slot = out[n] ?? (out[n] = { id: 0, name: '', x: 0, y: 0, z: 0 });
          slot.id = peer.id;
          slot.name = peer.hello.name;
          slot.x = s.p[0];
          slot.y = s.p[1];
          slot.z = s.p[2];
          n++;
        }
        return n;
      },
      canOpen: () => this.started && this.inWorld && !this.traveling && !this.menu.open && !this.map.open,
      freeMouse: (free) => this.freeMouse(free),
      // Whether anything else is holding the mouse. The trade window is deliberately allowed over
      // the backpack (that is where its own Trade button is), so the panel asks before it hands the
      // mouse back -- and, the other way round, it knows that nobody will hand it back for it when
      // what refused the window was a travel, a death or a jump rather than another panel.
      elseHasMouse: () => this.anyPanelOpen() || this.map.open,
    });
    // The trade window moves by its head (its find field still takes a click) and sizes by its corner.
    draggable(tradeUi.root, '.trade-panel', '.trade-head', 'trade');
    // The backpack's own Trade button: ask whoever this player is standing by and looking at. It is
    // the same rule the chat line's /trade comes to, and the ledger is what refuses it when there is
    // no server, nobody there, or they are past the game's own 8 m.
    this.backpack.onTrade = () => this.messages.system(tradeUi.askLookedAt());
    // The group roster's own Trade button, which names a member by the connection they are on rather
    // than by who is being looked at: the panel was built before this block, so it reaches the
    // ledger through the holder it fills in here.
    this.tradeAsk = (id, name) => trade.askTrade(id, name);
    // The window's names and pictures are the backpack's own, so the catalogues are read once when a
    // trade opens rather than on the frame a cell is drawn (they are cached by the equipment).
    const hadTradeWindow = trade.onWindow;
    trade.onWindow = (w) => {
      hadTradeWindow(w);
      // The panel has already drawn by now (it chained onto this hook first), so with no catalogue
      // read yet it is showing raw ids and no pictures: it is told to draw again when the read
      // lands rather than waiting for the other side to move something.
      if (w && !this.equipment.lastContext) void this.equipment.itemContext().then(() => tradeUi.refresh());
    };
    // Whatever else reads the server's own words reads them first and this takes what is left.
    const tradeWordWas = this.net.onWord;
    this.net.onWord = (msg) => {
      tradeWordWas(msg);
      trade.handle(msg);
    };
    // A line that dropped, was put down or was taken over leaves no trade and no list behind: the
    // server cancels its own side, nothing ever moved, and what is in local storage is the backpack
    // again. The handler already on the hook is kept and called first.
    const tradeStatusWas = this.net.onStatus;
    this.net.onStatus = (status, detail) => {
      tradeStatusWas(status, detail);
      if (status !== 'online') {
        trade.clear();
        tradeUi.clearAll();
      }
    };
    if (debugRoot) {
      // `__debug.trade()` says what the ledger and the window are doing; `__debug.trade({ offerMax: 6 })`
      // sets one of this side's own numbers and `{ ui: { hz: 2 } }` one of the panel's. The rest is
      // how a script with no mouse plays a trade: `{ ask: <a peer's id> }` or `{ ask: true }` for
      // whoever is being looked at, `{ accept: true }`, `{ put: 'weapon:baton_stun' }`, `{ take: ... }`,
      // `{ ready: true }`, `{ cancel: true }`, and `{ sync: true }` to ask the server for the list
      // again. The 8 m a trade reaches is the game's own and is printed, not settable.
      debugRoot.trade = (o?: Partial<typeof TRADE_TUNE> & { ui?: Partial<typeof TRADE_UI_TUNE>; ask?: number | boolean; accept?: boolean; decline?: boolean; put?: string; take?: string; ready?: boolean; cancel?: boolean; sync?: boolean; tell?: boolean; open?: boolean }) => {
        if (o?.ui) tuneTradeUi(o.ui);
        if (o) tuneTrade(o);
        let answer = '';
        const split = (key: string): ['wear' | 'weapon', string] | null => {
          const i = key.indexOf(':');
          const kind = key.slice(0, i);
          if (kind !== 'wear' && kind !== 'weapon') return null;
          return [kind, key.slice(i + 1)];
        };
        if (typeof o?.ask === 'number') answer = trade.askTrade(o.ask) || `asked ${o.ask} to trade`;
        else if (o?.ask === true) answer = tradeUi.askLookedAt();
        if (o?.accept === true) trade.accept();
        if (o?.decline === true) trade.decline();
        if (typeof o?.put === 'string') {
          const at = split(o.put);
          answer = at ? trade.putIn(at[0], at[1]) || `${o.put} is in the trade` : `no item ${o.put}`;
        }
        if (typeof o?.take === 'string') {
          const at = split(o.take);
          answer = at ? trade.takeOut(at[0], at[1]) || `${o.take} is out of the trade` : `no item ${o.take}`;
        }
        if (typeof o?.ready === 'boolean') answer = trade.setReady(o.ready) || (o.ready ? 'you are happy with it' : 'you took that back');
        if (o?.cancel === true) trade.cancel();
        if (o?.sync === true) trade.sync();
        if (o?.tell === true) trade.tell();
        if (o?.open === true) answer = tradeUi.show() ? 'the window is up' : 'no window may take the screen here';
        return { ...trade.debug(), answer, window: trade.window, items: trade.list.length, tune: TRADE_TUNE, ui: { ...TRADE_UI_TUNE, ...tradeUi.debug() }, range: GROUP_RANGE.trade };
      };
    }

    // ---- Shots, hits and health between players. ----
    //
    // A shot fired on one screen is flown again on every other one, as a picture that hurts nothing:
    // the browser that fired is the only one whose bolt is real, and it is the one that says where
    // that bolt landed, so the mark is in the same place everywhere rather than in a place each
    // browser guessed from its own streamed world. Who decides a hit is the shooter; the one hit is
    // the only place a number is ever taken off, and their own health is what everyone else reads.
    // Whether one player may hurt another at all is the server's switch, off unless it was started
    // with it, with the game's own duel inside it.
    //
    // Everything here asks the session, never the socket, so with no address set -- or against the
    // relay that came before -- nothing is sent, no bolt crosses, nobody can be hurt and the game is
    // exactly what it is today. Nothing of it runs in a frame: a shot is an event, and this player's
    // own health is looked at ten times a second and sent only when it has moved.
    const combat = new CombatNet();
    combat.send = (msg) => this.net.sendWord(msg);
    combat.authority = () => this.net.session.authority;
    combat.selfId = () => this.net.id;
    combat.friendlyFire = () => this.net.session.friendlyFire;
    combat.peerName = (id) => this.remotes.peerName(id);
    // Whose shots cross: this player's own, on foot and in the ship they fly. Everything else in the
    // air here -- a creature's spit, a fighter's rifle, a turret, another browser's bolt flown again
    // -- is this browser's own business and is not sent. Blame is compared by key, which is what
    // every other part of the game remembers a shooter by.
    combat.isMine = (bolt) => {
      const key = bolt.source?.key ?? 0;
      if (!key) return false;
      if (key === this.world.playerTarget.key) return true;
      const ship = this.pilotedShip();
      return !!ship && key === (this.world.ships.of(ship)?.key ?? 0);
    };
    // Whose hull's rooms this player is standing in: their own while they fly it, the carrier's while
    // they are a passenger, and 0 in the open world. A bolt fired in a hull's rooms flies in that
    // hull's frame, so it is only a shot for somebody standing in the same hull.
    combat.hullNow = () => {
      const room = this.player.aboard;
      if (!room) return 0;
      return this.remotes.hullCarrier(room.vehicle.group) || this.net.id;
    };
    // Out of the world -- the select screen, the creator, a travel under way -- a player is neither
    // hurt nor dead, whatever the figure standing in the scene happens to say.
    combat.healthNow = () => (this.started && this.inWorld ? { hp: this.player.hp / Math.max(1, this.player.maxHp), down: this.dying || this.player.hp <= 0 } : { hp: 1, down: false });
    // The frame a picture of somebody else's bolt flies in, and the vectors it is fired from: module
    // fields, so a fight allocates nothing per shot. `fire` copies both.
    const shotFrom = new THREE.Vector3();
    const shotAlong = new THREE.Vector3();
    const shotAt = new THREE.Vector3();
    combat.fly = (shot) => {
      if (!this.started || !this.inWorld || this.traveling) return null;
      const room = shot.in ? this.player.aboard : null;
      if (shot.in && !room) return null;
      shotFrom.set(shot.p[0], shot.p[1], shot.p[2]);
      shotAlong.set(shot.d[0], shot.d[1], shot.d[2]);
      return this.world.bolts.fire(shotFrom, shotAlong, {
        owner: 'enemy',
        // The whole of it: it is drawn, it is heard, it can be turned away by a blade, and it takes
        // nothing from anybody. Without this one flag, one trigger pull would be paid for twice.
        inert: true,
        // What it carries is not what it takes: an inert bolt never reaches anything that could be
        // hurt. It is read in one place only -- a blade here turning it away fires one back in its
        // place, and that one is a real bolt and must hit as hard as the one that came in.
        damage: shot.a ?? 0,
        metresPerSecond: shot.s,
        life: shot.l,
        color: shot.c,
        size: shot.z,
        gravity: shot.g ?? 0,
        bounces: shot.b ?? 0,
        projectile: shot.fx ? { effect: shot.fx, reach: shot.rc ?? 0, hit: shot.hx ?? null, pack: shot.pk ?? 'ships' } : null,
        frame: room ? { matrix: room.vehicle.group.matrixWorld, physics: room.physics } : null,
        source: null,
      });
    };
    // Whether a peer's weapon can be drawn as the game's own effect yet. A weapon nobody here has
    // fired has never had its effect loaded or its batch made, and both are main-thread work: asked
    // for on the frame a stranger's bolt arrives, they are a stutter in the middle of a fight. So
    // the first such bolt is flown as a plain one (the same two materials every bolt here already
    // uses) while the effect is made ready behind it, and every bolt after it is the real thing.
    const fxKnown = new Set<string>();
    const fxWarming = new Set<string>();
    combat.fxReady = (file, pack) => {
      const key = `${pack}/${file}`;
      if (fxKnown.has(key)) return true;
      if (fxWarming.has(key)) return false;
      const fxPack = pack === 'weapons' ? this.world.bolts.weaponVisuals : this.world.bolts.visuals;
      if (!fxPack) return false;
      fxWarming.add(key);
      void fxPack
        .prepare(file, this.renderer)
        .then((ok) => {
          fxWarming.delete(key);
          if (ok) fxKnown.add(key);
        })
        .catch(() => fxWarming.delete(key));
      return false;
    };
    // What the fight is holding is the very bolt the game gave it: the shape it travels as leaves
    // three.js out so the rules can be run by a test that has none of it.
    combat.cut = (bolt, x, y, z) => {
      this.world.bolts.cutShort(bolt as unknown as Bolt, shotAt.set(x, y, z), this.effects);
    };
    // Somebody hurt this player. It is the only place a number comes off, which is what keeps two
    // browsers from ever disagreeing about how much of anybody is left.
    combat.onHurt = (amount, x, y, z, from, what) => {
      const p = this.player;
      if (!this.started || !this.inWorld || p.noclip || this.dying) return;
      // Struck on the hull rather than on the person: a bolt that met the ship this player is flying
      // takes it off the ship, through its shields and armour, exactly as one fired here would.
      const ship = what === 'ship' ? (this.pilotedShip() ?? p.mounted ?? null) : null;
      if (ship && !ship.disposed) {
        ship.damage(amount, shotAt.set(x, y, z), 0, null);
        return;
      }
      p.takeDamage(amount);
      this.hurtFrom(shotAt.set(x, y, z));
      void from;
    };
    // A peer's health, as their own browser said it: nothing on this side ever subtracts anything,
    // so this is the only way the figure standing over there knows how much of them is left. Their
    // health is a share of the whole on the wire and a number out of a hundred here, which is what
    // everything that draws a peer is built on.
    combat.onPeerHealth = (id, hp, down) => {
      this.remotes.setHealthShare(id, hp);
      this.remotes.setDown(id, down);
    };
    // A peer died. The figure goes down and plays the clip rather than falling in a heap, which is
    // the owner's decision: nothing carries bone motion across, so a ragdoll would end up in a
    // different heap on every screen. Setting it here as well as from their health means a death
    // that arrives ahead of the next look at their health still puts them down at once.
    combat.onPeerDied = (id, by) => {
      this.remotes.setDown(id, true);
      const name = this.remotes.peerName(id);
      this.messages.system(by ? (by === this.net.id ? `you killed ${name}` : `${name} was killed by ${this.remotes.peerName(by)}`) : `${name} died`);
    };
    combat.onNote = (text) => this.messages.system(text);
    // Everything this browser lands on another player goes out from here, and nothing whatever is
    // taken off on this side: the player who was shot is the only one who subtracts, which is what
    // keeps two screens from ever disagreeing about how much of anybody is left. Only this player's
    // own blows cross -- a creature of this browser's mauling somebody is this browser's business,
    // and a message about it would carry this player's name. The second arrow is what decides
    // whether anything here may pick a fight with a peer at all: with damage between players
    // switched off and no duel on, a peer is solid to a bolt and is nobody for the local wildlife
    // to chase, since nothing here could ever finish them.
    this.remotes.sendBlowsTo(
      (blow) => {
        const key = blow.source?.key ?? 0;
        if (!key) return;
        const ship = this.pilotedShip();
        if (key !== this.world.playerTarget.key && !(ship && key === (this.world.ships.of(ship)?.key ?? 0))) return;
        combat.sendHit(blow.id, blow.amount, blow.from?.x ?? 0, blow.from?.y ?? 0, blow.from?.z ?? 0, blow.what);
      },
      (id) => combat.mayHurt(id),
    );
    // Somebody arrived. Nothing they are told about the people already here carries health -- not
    // the greeting, not the states -- so everyone says theirs again at the next look and the newcomer
    // reads them as they are rather than as whole. It is one small message per player per arrival.
    const combatJoinWas = this.net.onJoin;
    this.net.onJoin = (peer) => {
      combatJoinWas(peer);
      combat.announceHealth();
    };
    // Every bolt in the air passes through these three: one as it leaves a muzzle, one as it leaves
    // the air, and one where a lit blade turns one away. The fight decides which of them are worth a
    // word; a bolt that is nobody else's business costs a comparison and nothing more.
    this.world.bolts.onFire = (bolt) => combat.fired(bolt);
    this.world.bolts.onGone = (bolt, at) => combat.ended(bolt, at);
    this.world.bolts.onBlocked = (bolt, at, out) => {
      if (!combat.blockedHere(bolt, at.x, at.y, at.z)) return false;
      // The blocker's own shot from the block point, which crosses as any other shot of theirs does.
      // One bolt in, one bolt out: the one that came in is ending on every screen, this one's word
      // is on its way, and neither browser has to guess what the other did with it.
      // A bolt turned away by a blade is still that gun's bolt where it finally lands, so the mark
      // it will leave is the incoming bolt's own and not a plain blaster's.
      this.world.bolts.fire(at, out, { owner: 'player', damage: bolt.damage, metresPerSecond: bolt.speed, life: bolt.life, color: bolt.color, size: bolt.size, scar: bolt.scar, projectile: bolt.projectile, exclude: this.player.aboard ? this.player.aboard.vehicle.body : this.player.body, frame: this.player.aboard ? { matrix: this.player.aboard.vehicle.group.matrixWorld, physics: this.player.aboard.physics } : null, source: this.world.playerTarget });
      return true;
    };
    // This player's own health is looked at ten times a second and sent at `healthHz`, which is why
    // that number is held at ten or under; a death is said once. It is a clock of its own and not
    // the frame's: a tab that is not being drawn stops its frames and keeps its timers, so a player
    // who walked away is still seen to be where and how they are.
    window.setInterval(() => combat.step(0.1), 100);
    // The group's words are read first and the fight takes what is left, so neither unplugs the other.
    const combatWordWas = this.net.onWord;
    this.net.onWord = (msg) => {
      combatWordWas(msg);
      combat.handle(msg);
    };
    // A line that dropped, was put down or was taken over leaves nothing behind: no duel outlives a
    // line, and nothing is left being held for a bolt that belongs to a world that has gone.
    const combatStatusWas = this.net.onStatus;
    this.net.onStatus = (status, detail) => {
      combatStatusWas(status, detail);
      if (status !== 'online') combat.clear();
    };
    if (debugRoot) {
      // `__debug.combat()` reads what is crossing and `__debug.combat({ shotsPerSecond: 30 })` sets
      // one of this side's own numbers. The duel is the game's own word at the game's own distance:
      // `{ ask: <the relay id of a player> }` asks for one, `{ accept: true }` takes one up and
      // `{ peace: true }` ends every one, which is how a script with no keyboard tries the whole path.
      debugRoot.combat = (o?: Partial<typeof COMBAT_TUNE> & { ask?: number; accept?: boolean; decline?: boolean; peace?: boolean }) => {
        if (o) tuneCombat(o);
        let answer = '';
        if (typeof o?.ask === 'number') answer = combat.askDuel(o.ask);
        if (o?.accept) combat.acceptDuel();
        if (o?.decline) combat.declineDuel();
        if (o?.peace) combat.peace();
        return { ...combat.debug(), answer, tune: COMBAT_TUNE, duelRange: GROUP_RANGE.duel };
      };
    }

    this.select = new CharacterSelect(this.ui);
    // The select screen's figure is the player's own rig, put in the character's species, look and
    // clothes by the very steps `play` takes, so Play finds all of it already loaded. One at a time:
    // `useSpecies` hangs a rig on the player the moment it lands, so two loads in flight together could
    // leave whichever finished last on the player. Play and Create wait their turn behind the load in
    // flight rather than racing it, and a load whose choice has been overtaken stops at its next step.
    let figureTurn: Promise<unknown> = Promise.resolve();
    const inTurn = <T,>(job: () => Promise<T>): Promise<T> => {
      const run = figureTurn.then(job, job);
      figureTurn = run.catch(() => undefined);
      return run;
    };
    // `applyAppearance` sets only the colours that differ from the pack's own, which is right on a
    // fresh rig and wrong on one that another character of the same species has just worn: the first
    // one's hair would stay on the second wherever the second kept the default. So every colour the
    // rig holds is put back to what this record asks, or to the pack's own where it asks nothing.
    const putBackLook = (character: Character, a: SavedCharacter['appearance'] | undefined) => {
      const want = a?.values ?? {};
      const back: Record<string, number> = {};
      for (const [k, v] of Object.entries(character.variableValues())) {
        const target = k in want ? want[k] : (character.manifest.values?.[k] ?? character.manifest.values?.[k.replace(/^.*\//, '')]);
        if (typeof target === 'number' && target !== v && character.canCustomize(k)) back[k] = target;
      }
      if (Object.keys(back).length) character.customizer?.setAll(back);
    };
    this.select.loadFigure = (c, alive) =>
      inTurn(async () => {
        if (!alive()) return null;
        const words = c.species.replace(/_/g, ' ');
        const missing = { error: `The ${words} body is not converted on this machine, so there is nothing to stand here. The character still plays. To add it: npm run swg -- species @SWG assets-private --retail-only` };
        // Known to be missing: said at once, and the player's rig is left as it is.
        if (this.speciesList.length && !this.speciesList.some((s) => s.id === c.species)) return missing;
        const character = await this.useSpecies(c.species);
        if (!character || character.manifest.id !== c.species) return missing;
        if (!alive()) return null;
        putBackLook(character, c.appearance);
        this.applyAppearance(character, c.appearance);
        await this.dress(character, c.outfit ?? []);
        if (!alive()) return null;
        // The colour renders finish before the clone is taken, so the figure fades in finished.
        await character.customizer?.settled();
        if (!alive()) return null;
        // The mood's own idle where this pack has a branch for it, as `setMood` would choose; else the plain idle.
        const mood = (c.mood ?? '').trim().toLowerCase();
        const name = (mood && this.player.rig ? this.player.rig.variant('idle', mood) : null) ?? 'idle';
        const idle = character.clips.find((k) => k.name === name) ?? character.clips.find((k) => k.name === 'idle') ?? null;
        return { character, idle };
      });
    this.select.weaponName = async (id) => {
      const weapons = await (this.weaponsLoaded ?? Promise.resolve(null)).catch(() => null);
      return itemInfo('weapon', id, { wardrobe: null, wardrobeDir: null, weapons, species: '', packParts: [] }).name;
    };
    this.select.onPlay = (c) =>
      void inTurn(async () => {
        // Enter pressed before the figure was asked for finds the rig still in the last character's colours.
        const worn = this.player.rig?.character;
        if (worn && worn.manifest.id === c.species) putBackLook(worn, c.appearance);
        await this.play(c);
      }).catch((err) => console.warn('could not enter the world', err));
    this.select.onCreate = () => void inTurn(() => this.openCreator()).catch((err) => console.warn('creator', err));
    if (debugRoot) debugRoot.select = () => this.select.report();
    this.select.onDelete = (c) => {
      deleteCharacter(c.id);
      this.select.show(loadCharacters());
    };
    this.creatorBar = new CreatorBar(this.ui);
    this.creatorBar.onBack = () => {
      this.leaveCreator();
      this.select.show(loadCharacters());
    };
    this.creatorBar.onTab = (id) => this.showCreatorTab(id);
    this.creatorBar.onCreate = (name, cls, planet) => void this.finishCreation(name, cls, planet).catch((err) => console.warn('creator', err));
    this.menu = new Menu(this.ui, this.input, this.settings);
    draggable(this.menu.root, '.menu-panel', '.menu-nav', 'menu');
    this.menu.net = {
      url: () => Net.savedUrl(),
      status: () => this.netStatus,
      peers: () => this.remotes.here(),
      connect: (url) => {
        Net.saveUrl(url);
        if (url) this.net.connect(url, this.helloNow());
        else this.net.disconnect();
      },
      disconnect: () => this.net.disconnect(),
      // Who this browser is, and what it has made of the server on the other end. All of it is read at
      // click time, so the page never holds a stale copy of any of it.
      mode: () => this.net.session.mode,
      player: () => this.net.session.player,
      exportKey: () => this.net.session.exportKey(),
      importKey: (text) => this.net.session.importKey(text),
      word: () => this.net.session.word,
      setWord: (word) => this.net.session.setWord(word),
      ask: () => this.net.session.ask,
      resolveAsk: (take) => this.net.session.resolveAsk(take),
    };
    this.menu.onResume = () => this.resume();
    this.menu.onSwitchCharacter = () => this.switchToSelect();
    // The menu's own clicks, from the game's interface table.
    this.menu.onUiSound = (action) => void this.audio.ui.play(action);
    this.menu.onSetting = (key) => this.applySetting(key);
    // Escape: in the world it opens the menu (the browser drops the pointer lock on it, which is
    // caught below); with the menu up it resumes; with a panel or the map up it closes that.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.inWorld || !this.started || this.traveling) return;
      // The Escape that dropped the lock (and so opened the menu) must not close it again in the same breath.
      if (this.menu.open) {
        if (performance.now() - this.menuOpenedAt > 300) this.resume();
      }
      else if (this.anyPanelOpen() || this.map.open) {
        this.closePanels();
        this.map.hide();
        this.freeMouse(false);
      } else this.openMenu();
    });

    // Releasing the mouse leaves the game running and the world visible, so the wardrobe and the
    // map can be used with a cursor. Clicking the world takes the mouse back; the menu is only
    // for arriving and for dying, not for every Escape.
    document.addEventListener('pointerlockchange', () => {
      if (!this.started || this.traveling) return;
      // The lock went without a panel asking for it: Escape, or a click away. The menu, not a bare cursor.
      if (!this.input.locked && !this.input.captured && this.inWorld && !this.map.open && !this.anyPanelOpen()) this.openMenu();
      this.hud.setMouseFree(!this.input.locked && !this.map.open && !this.anyPanelOpen());
    });
    this.canvas.addEventListener('click', () => {
      if (this.started && !this.input.locked && !this.map.open && !this.anyPanelOpen() && !this.traveling) this.input.requestLock();
    });

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.postfx?.setSize();
      this.cam.camera.aspect = window.innerWidth / window.innerHeight;
      this.cam.camera.updateProjectionMatrix();
      this.world.onCameraResized();
      // The overlay sizes its own canvas on the same event; its layout is worked out here, once,
      // rather than by every frame that reads it.
      this.hudLayoutFor(this.hudLayout.scale);
    });
    // The display's own settings, before the first frame: the scale on `:root` and in the layout, the
    // overlay's backing store, and how many message lines stand.
    this.applyHudSettings();

    // Sound starts on the first press, which is what browsers require; the game already needs a
    // click for the pointer lock, so nothing extra is asked of the player. Both listeners are
    // passive and stay on, since `unlock` after the first time does nothing.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });
    // Away to another tab: silent, and the context stopped, unless the player asked otherwise.
    document.addEventListener('visibilitychange', () => this.audio.setHidden(document.hidden));

    // Nothing loads until a character is chosen: the select screen first, the creator or the
    // world after. The species list is small and feeds both the creator and the console.
    void loadSpeciesIndex(import.meta.env.BASE_URL).then((list) => {
      this.speciesList = list;
      this.world.npcDeps.species = list.map((s) => s.id);
      this.world.npcs?.attach(this.world.npcDeps);
      this.appearanceUi.setSpecies(list, this.characterId);
    });
    // The creature and NPC catalogue: about 8 MB, fetched and indexed once while the select
    // screen is up. Nothing waits on it in a frame; until it lands a spawn says so.
    void this.world.loadMobileCatalogue().then((c) => {
      if (c) console.info(`mobiles: ${c.entries.length} in the catalogue`);
    });
    // Aboard a ship's rooms nothing is stood, whoever asks (the console, the spawner, the wildlife).
    this.world.refuseMobiles = () => (this.player?.aboard ? 'nothing can be stood aboard a shipÃ¢â‚¬â„¢s rooms' : null);
    this.appearanceUi.onSpecies = (id) => void this.switchCharacter(id);
    const params = new URLSearchParams(location.search);
    this.setClass(params.get('class') === 'bounty_hunter' ? 'bounty_hunter' : 'jedi');
    this.select.show(loadCharacters());
    // Where the character stands is written back now and then, and when the page goes.
    window.addEventListener('pagehide', () => this.savePlace(true));
  }

  // ---- The Escape menu and its settings. ----

  private menuOpenedAt = 0;

  private openMenu(): void {
    if (this.menu.open) return;
    this.menuOpenedAt = performance.now();
    this.menu.show();
    this.freeMouse(true);
  }

  private resume(): void {
    this.menu.hide();
    this.freeMouse(false);
  }

  /** Whether the pointer has been wired to the world behind a place; done once and then kept. */
  private placeInputBound = false;
  /** The creator's row of places and hours; built once and shown only while a place is up. */
  private readonly placeBar = new PlaceBar(
    (key) => void this.switchPlace(key),
    (hour) => {
      // Only the clock moves. The sky reads it every frame and blends its own rows to it, so an
      // hour costs nothing at all -- which is the whole reason a place is one camera and a list of
      // hours rather than a scene per hour.
      this.world.day.time = hour / 24;
    },
  );
  /** The words under the world saying what turns the figure and what moves the view. */
  private readonly placeHint = ((): HTMLElement => {
    const el = document.createElement('div');
    el.id = 'place-hint';
    el.hidden = true;
    el.textContent = 'drag to turn · right-drag to look up and down · wheel to zoom · double-click to frame again';
    return el;
  })();

  /**
   * The pointer, while a character is standing in a place.
   *
   * Bound to the game's own canvas rather than to a panel, because that is what is behind the
   * editor's window: the overlay is set to let events through (`.in-place` in the stylesheet) so a
   * drag on the world arrives here, while the panel itself takes its own back.
   *
   * Every listener does nothing at all unless a place is up, so this is bound once and never
   * unbound. A right drag is also stopped from opening the browser's own menu, since holding the
   * right button is how the view is slid.
   */
  private bindPlaceInput(): void {
    if (this.placeInputBound) return;
    this.placeInputBound = true;
    const canvas = this.renderer.domElement;
    let dragging = 0;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.scene3d) return;
      dragging = e.button === 2 ? 2 : 1;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const s = this.scene3d;
      if (!s || !dragging) return;
      s.view = dragView(s.view, e.clientX - lastX, e.clientY - lastY, dragging === 2);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const up = (e: PointerEvent) => {
      dragging = 0;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => {
      if (this.scene3d) e.preventDefault();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        const s = this.scene3d;
        if (!s) return;
        s.view = zoomBy(s.view, e.deltaY > 0 ? -1 : 1);
        e.preventDefault();
      },
      { passive: false },
    );
    // Back to the shot you captured, which is the one framing that is certainly good.
    canvas.addEventListener('dblclick', () => {
      if (this.scene3d) this.scene3d.view = restView();
    });
  }

  /**
   * Stand the character in one of the captured places, loading the world behind the screen.
   *
   * Answers false and changes nothing when there are no places built on this install, which is the
   * ordinary state of a fresh checkout: the screen then shows the doll on its dark stage exactly as
   * it always did. That fallback is the whole safety of this -- a scene is an improvement on a
   * screen that already works, never a thing the screen needs.
   */
  private async showScene(key: string): Promise<boolean> {
    const man = await sceneManifest();
    if (!man || !man.places.some((p) => p.key === key)) return false;
    const row = man.places.find((p) => p.key === key)!;
    const where = packPlanet(row.pack);
    if (!where) return false;
    await this.hideScene();
    // The streamer is what a scene skips, and only that: the ground, the sky, the water and the
    // weather all load as they always do, since those are what make the hour real.
    this.bindPlaceInput();
    if (!this.placeHint.parentElement) this.ui.appendChild(this.placeHint);
    if (!this.placeBar.element.parentElement) this.ui.appendChild(this.placeBar.element);
    this.world.sceneOnly = true;
    this.world.load(planetById(where.planet), row.pack);
    const built = await buildPlace(key, {
      adopt: (root) => this.world.adoptMaterials(root),
      breath: () => this.world.breath(),
    });
    if (!built) {
      this.world.sceneOnly = false;
      return false;
    }
    // The place is put back where it was captured. Its models are baked in their own frame with
    // the feet at the origin -- which keeps the file's numbers small and lets a place describe
    // itself -- and the ground is the planet's own at the planet's own heights, so one offset on
    // the group is what brings the two together.
    const stand = new THREE.Vector3(built.place.stand.x, built.place.stand.y, built.place.stand.z);
    built.group.position.copy(stand);
    this.world.scene.add(built.group);
    // Nothing about a scene streams, so nothing is left to arrive after it is shown.
    //
    // The camera never moves, so the ground it can see is known before a frame is drawn and there
    // is no reason to build it a chunk at a time the way a walking player needs. Left to stream it
    // showed the procedural stand-in heights first and the world's own ground after, which is
    // exactly the seam the owner saw. The reach is cut to what one fixed frustum can want -- the
    // far tiles carry the vista, so the near radius can be small -- and the whole of it is waited
    // for below before anybody is shown anything.
    this.world.setReach(SCENE_REACH.objects, SCENE_REACH.terrain, SCENE_REACH.far);
    // The ground under it is the planet's own, generated as it is in play. It is streamed around
    // the **captured** standing spot, in the world's own coordinates, because that is where the
    // terrain's heights really are; the place's models are in their own frame at the origin, and
    // the two are brought together by standing the figure at the origin and putting the ground
    // there too (see `sceneGroundOffset`).
    await this.world.loadPack(stand);
    // And the wait. `readyAround` is the same one a jump makes inside its closed tunnel: it builds
    // what is left and links every program still queued, so the first frame drawn is the finished
    // picture rather than the first instalment of it.
    const whole = await this.world.readyAround(stand, SCENE_REACH.waitMs);
    if (!whole) console.info(`place: ${key} was still building after ${(SCENE_REACH.waitMs / 1000) | 0}s; showing it as it stands`);
    this.scene3d = { key, built, stand, facing: (built.place.stand.heading * Math.PI) / 180, orbit: orbitFor(built.place), view: restView() };
    // The hour the place was captured at. Held, so the day does not walk off it while somebody is
    // choosing a face; given back when the scene goes.
    const hour = built.place.hours[Math.floor((built.place.hours.length - 1) / 2)]?.hour;
    if (hour !== undefined) this.world.day.time = hour / 24;
    return true;
  }

  /** Let go of the place, its models and the world behind it, and give the day back. */
  private async hideScene(): Promise<void> {
    const s = this.scene3d;
    this.scene3d = null;
    if (s) disposePlace(s.built, (mats) => this.world.forgetMaterials(mats));
    this.world.sceneOnly = false;
    // The player's own settings back, or the next world played would be built at a scene's reach.
    const S = this.settings;
    this.world.setReach(S.objectReach, S.terrainRadius, S.farRadius);
    clockKnob({ release: true });
    if (s) this.world.leave();
  }

  /**
   * One frame of a character standing in a captured place.
   *
   * Everything here is either what makes the picture or what makes the figure look alive, and
   * nothing else. `world.update` is not gameplay -- it is the draw's own engine: the day, the sky's
   * blend, the lighting, the fog, the water's clock, the weather, the terrain streaming in around
   * the spot and the animated surfaces all live in it, which is exactly the list of things the
   * owner asked for when they said they wanted three dimensions rather than a photograph.
   *
   * What is **not** here is the whole of being alive: no input, no character controller, no
   * physics step, no combat, no relay, no prompts and no display. A creator is a place to choose a
   * hat in.
   */
  private stepScene(dt: number): void {
    const s = this.scene3d;
    if (!s) return;
    // Everything here is in the world's own coordinates, not the place's.
    //
    // The bake writes a place in its own frame with the feet at the origin, which keeps its numbers
    // small and lets a place describe itself. But the **ground** is the planet's own, generated at
    // the planet's own heights, so the two only meet if the place is put back where it came from.
    // It is one offset on the group, and it costs no precision: a world is at most twelve
    // kilometres across, where a float still resolves a millimetre.
    const stand = s.stand;
    // `placeVisual` writes the drawn body from `pos` and `heading`, so those are what is driven
    // here; writing the group directly would be undone by the next frame's own placement.
    this.player.pos.copy(stand);
    this.player.heading = s.facing + s.view.spin;
    this.player.group.visible = true;
    this.player.standStill(dt);

    // The camera: the shot's own line, as far along it as the view has been wound. The pose is
    // reckoned from the feet, so it is carried to where the feet really are.
    const pose = viewPose(s.orbit, s.view, ORBIT_EYE_HEIGHT);
    const cam = this.cam.camera;
    cam.fov = s.built.place.camera.fov;
    cam.position.set(stand.x + pose.camera.x, stand.y + pose.camera.y, stand.z + pose.camera.z);
    cam.lookAt(stand.x + pose.look.x, stand.y + pose.look.y, stand.z + pose.look.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // The world's own engine, at the place's own feet. Nothing is hurt and nothing is targeted.
    this.world.update(dt, stand, cam.position, false, () => {}, null);
    this.effects.update(dt);
    this.world.updateWeatherView(dt);
    this.world.updateShadows(performance.now());
    this.player.drawBlades(dt, cam);
    this.stepAudio(dt);
    this.drawFrame();
  }

  /** Back to the select screen: the place is written, the world unloaded, nothing streams until a character is chosen. */
  private switchToSelect(): void {
    // A jump lets go of everything it holds (the hull, the white, its effects) before the ship is left.
    this.hyperspace.abort('leaving');
    // So does a run: it holds the hull and the streamer, and both would be left behind.
    this.ultraCruise.abort();
    // Every voice and every looping source goes with the world, or a planet's beds would follow
    // the player onto the select screen and into the next character's world.
    this.audio.stopAll();
    this.savePlace(true);
    this.menu.hide();
    this.closePanels();
    // The hands are emptied on the way out, or the next character played (of the same species) would start with this one's weapon.
    this.equipment.reset();
    this.map.hide();
    if (this.player.mounted) this.handleMount();
    // Off the ship before its room's physics world goes with the world.
    if (this.player.aboard) this.leaveShip(true);
    this.player.noclip = false;
    this.inWorld = false;
    // The world is going and the group with it: the strip comes down here, because the frame that
    // would notice stops being run the moment there is no world, and a roster left standing behind
    // the select screen is last night's group with last night's distances on it.
    this.roster.clear();
    this.started = false;
    this.current = null;
    this.net.disconnect();
    this.world.leave();
    this.shipHud.clear();
    this.messages.clear();
    // No frame runs outside the world, so the overlay is taken off here rather than waiting for one,
    // and with it the damage feedback and the bar of things you could press in a world you have left.
    this.overlay.idle();
    this.feedback.clear();
    this.plates.clear();
    this.hud.idle();
    this.actions.clear();
    this.promptLive = false;
    resetPromptState(this.promptState);
    // The three readings kept beside the struct, and the two clocks: the struct's own reset does not
    // reach them, and a name or a building's label left standing would be written into the corner of
    // the next world for as long as it takes the clock to come round again.
    this.nearbyName = '';
    this.nearbyClock = 0;
    this.promptClock = 0;
    this.promptLiftStops = 0;
    this.promptDoorless = '';
    this.promptGate = '';
    this.zoneGates.clear();
    this.showBodyBlock(true);
    this.hud.setPrompt('');
    this.hud.setMouseFree(false);
    this.input.captured = false;
    this.input.releaseLock();
    this.select.show(loadCharacters());
  }

  /** A setting moved in the menu: it takes effect now. */
  private applySetting(key: keyof Settings): void {
    const S = this.settings;
    switch (key) {
      case 'renderScale':
        this.renderer.setPixelRatio(S.renderScale);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.postfx?.setSize();
        this.world.onCameraResized();
        break;
      case 'fov':
        this.cam.baseFov = S.fov;
        break;
      case 'exposure':
        this.renderer.toneMappingExposure = S.exposure;
        break;
      case 'fog':
        this.world.userFog = S.fog;
        break;
      case 'normalStrength':
        Character.normalScale.set(S.normalStrength, S.normalStrength);
        this.world.setNormalScale(S.normalStrength, S.normalStrength);
        this.player.rig?.character?.customizer?.setNormalScale(S.normalStrength, S.normalStrength);
        break;
      case 'shadows':
        this.world.setShadowsEnabled(S.shadows);
        break;
      case 'shadowMapSize':
      case 'shadowSoftness':
        this.world.setShadowLook(S.shadowSoftness, undefined, S.shadowMapSize);
        break;
      case 'shadowDistance':
      case 'shadowCasterRadius':
        this.world.setShadows(S.shadowDistance, S.shadowCasterRadius);
        break;
      case 'objectReach':
      case 'terrainRadius':
      case 'farRadius':
        this.world.setReach(S.objectReach, S.terrainRadius, S.farRadius);
        break;
      case 'mobileCap':
      case 'mobileAnimRange':
        this.world.setMobileDetail(S.mobileCap, S.mobileAnimRange);
        break;
      case 'sensitivity':
        this.cam.sensitivity = S.sensitivity;
        break;
      case 'invertY':
        this.cam.invertY = S.invertY;
        break;
      case 'weather':
      case 'weatherDensity':
      case 'rainOpacity':
      case 'wetSurfaces':
      case 'weatherShadows':
      case 'weatherForce':
      case 'weatherKind':
      case 'lifeDay':
        // Uniforms and rates only: nothing here compiles a shader.
        this.world.weather.configure(S);
        this.hud.setWeatherNote(this.world.weather.heldNote());
        break;
      case 'soundMaster':
      case 'soundAmbience':
      case 'soundEffects':
      case 'soundVoices':
      case 'soundFootsteps':
      case 'soundVehicles':
      case 'soundInterface':
      case 'soundMusic':
      case 'soundHeadphones':
      case 'soundRoomEcho':
      case 'soundInBackground':
      case 'soundSabers':
        // Gains only: nothing here rebuilds the graph, and nothing compiles.
        this.audio.apply(S);
        break;
      case 'hudScale':
      case 'hudDpr':
      case 'hudShipCondition':
      case 'hudTargetBlock':
      case 'hudArcs':
      case 'hudMessages':
      case 'hudMessageLines':
      case 'hudFullPrompts':
      case 'hudDamageArc':
      case 'hudDamageNumbers':
      case 'hudNameplate':
      case 'hudJediCrosshair':
        // A size, a backing store and a few switches: no shader and no element is made.
        this.applyHudSettings();
        break;
      default:
        // Anything in the effects registry: the chain takes them all in one go on the next
        // microtask, so resetting the graphics is one reconcile rather than two dozen.
        if (isFxSettingKey(key)) this.queueEffects();
        break;
    }
  }

  /**
   * The display's own settings, all at once: the overlay's size and backing store, how many message
   * lines stand and whether they stand at all, and the long prompt line. Called whenever one of them
   * changes and once at boot; it moves numbers and toggles classes, and nothing in it compiles.
   */
  private applyHudSettings(): void {
    const S = this.settings;
    const scale = Math.max(HUD_SCALE_RANGE.min, Math.min(HUD_SCALE_RANGE.max, S.hudScale));
    document.documentElement.style.setProperty('--hud-scale', String(scale));
    this.overlay.setScale(scale);
    this.overlay.setDpr(Math.max(HUD_DPR_RANGE.min, Math.min(HUD_DPR_RANGE.max, S.hudDpr)));
    this.shipHud.setScale(scale);
    this.feedback.setScale(scale);
    this.hud.setScale(scale);
    this.plates.setScale(scale);
    // A crosshair is drawn for every class; whether the Jedi is one of them is the player's, since a
    // permanent crosshair changes how a saber fight feels.
    this.hud.setCrosshair(true, S.hudJediCrosshair);
    this.plates.setEnabled(S.hudNameplate);
    this.hudLayoutFor(scale);
    // The message column the layout worked out, so a long line cannot run under the centred blocks on
    // a narrow window. One property write, on a resize and a change of scale, never in a frame.
    document.documentElement.style.setProperty('--hud-msg-w', `${Math.round(this.hudLayout.message.w)}px`);
    MESSAGES.kept = Math.max(HUD_LINES_RANGE.min, Math.min(HUD_LINES_RANGE.max, Math.round(S.hudMessageLines)));
    this.messages.setEnabled(S.hudMessages);
    // The four feedback switches. The tick on the crosshair has no switch of its own: it is the
    // cheapest thing on the screen and the only sign that a shot told at all, so it is always on.
    // What it says in words follows the message line, since that is where the words would go.
    this.feedback.setShown(S.hudDamageArc, true, S.hudDamageNumbers, S.hudMessages);
    // Turned off, the long line would otherwise stand at whatever it last said: the frame loop stops
    // writing it, so it is emptied here.
    if (!S.hudFullPrompts) this.hud.setPrompt('');
  }

  /**
   * A line from the flight display. Its kinds are spelled its own way (two words with a space), so
   * they are turned into the message line's names here; a spoken line comes joined as "who: words"
   * and is split back, so the speaker keeps the faction's colour.
   */
  private sayShipLine(kind: ShipMessageKind, text: string, colour?: string): void {
    if (kind === 'spatial') {
      const i = text.indexOf(': ');
      if (i > 0) this.messages.spatial(text.slice(0, i), text.slice(i + 2), colour ?? '');
      else this.messages.say('spatial', text, undefined, colour);
      return;
    }
    if (kind === 'you hit') this.messages.youHit(text);
    else if (kind === 'hit you') this.messages.hitYou(text);
    else if (kind === 'note') this.messages.note(text);
    else this.messages.system(text);
  }

  /** The overlay's layout at a scale, worked out on a resize or a change of scale and never in a frame. */
  private hudLayoutFor(scale: number): void {
    layout(window.innerWidth, window.innerHeight, scale, this.hudLayout);
    // The damage feedback lays its arcs out against the same window. Told here, on the resize and on
    // a change of scale, it never reads the window from a frame again.
    this.feedback.setLayout(this.hudLayout.w, this.hudLayout.h);
  }

  /**
   * A world point onto this frame's screen, in pixels from the top left, for the rising damage
   * numbers. One kept vector, so the whole pool costs no allocation; false when the point is behind
   * the camera, which is the number's signal to stand aside rather than to be thrown away.
   */
  private projectToScreen(x: number, y: number, z: number, out: ScreenPoint): boolean {
    const v = this.feedbackPoint.set(x, y, z).project(this.cam.camera);
    if (!(v.z <= 1) || !Number.isFinite(v.x)) return false;
    out.x = (v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (0.5 - v.y * 0.5) * window.innerHeight;
    return true;
  }

  /**
   * You hurt something: the tick on the crosshair, the line in words and Ã¢â‚¬â€ with the setting on Ã¢â‚¬â€ a
   * number over its head. The world calls this for every blow of the player's, whatever landed it.
   * The point is the body's head rather than its feet, since that is where a number belongs.
   */
  private landedHit(target: { pos: THREE.Vector3; halfHeight: number; key: number; label: string }, amount: number, killed: boolean): void {
    // A blow of yours on something living: the zone gates stand aside for a few seconds, so a fight
    // beside one cannot end in another zone because E was pressed to mount a speeder. This watches
    // the living only Ã¢â‚¬â€ a shot at a hull or a turret never reaches it Ã¢â‚¬â€ so the whole of the rule is
    // this and `hurtFrom`, which is every blow taken, from anything at all.
    this.zoneGates.fought(this.world.simTime);
    const p = target.pos;
    this.feedback.hit(amount, killed, target.key, target.label, p.x, p.y + target.halfHeight, p.z);
  }

  /**
   * A blow landed on the player, and where it came from in the world: the red flash, which every
   * blow gets, and the arc on that side of the screen, which only a blow with a direction gets. A
   * fall, a burn and a jolt through a hull pass nothing and show the flash alone.
   *
   * Aboard a ship's rooms the player's own place is the hull's frame and the world's is `worldPos`,
   * so the direction is measured in the world, where everything that strikes from outside stands.
   */
  private hurtFrom(from: THREE.Vector3 | null | undefined): void {
    // Every blow taken, with a direction or without: the zone gates stand aside for a few seconds.
    this.zoneGates.fought(this.world.simTime);
    this.hud.hurt();
    if (!from) return;
    const at = this.player.worldPos;
    const dx = from.x - at.x;
    const dy = from.y - at.y;
    const dz = from.z - at.z;
    // A blow from the far side of a valley points at a pixel: past the range it is no direction at all.
    const r = HUD_WIRING.hurtRange;
    if (dx * dx + dy * dy + dz * dz > r * r) return;
    this.feedback.hurt(dx, dy, dz);
  }

  /**
   * The bar as it stands, in words, for the console: a key-cap and its label per slot shown. Only
   * the slots that are actually on the bar are joined, so a two-action bar reads "E mount | Space
   * hop" rather than trailing a pair of bare separators for the cells that are hidden. It is built
   * on demand from the console and never in a frame, which is the only reason it may build a string.
   */
  private actionsList(shown: number): string {
    let out = '';
    for (let i = 0; i < shown; i++) out += `${out ? ' | ' : ''}${this.actions.keyAt(i)} ${this.actions.labelAt(i)}`;
    return out;
  }

  /**
   * Where the player is standing, as the action bar's rules want it, into the one struct this file
   * keeps. Nothing is built: the struct is reset in place and filled in place.
   *
   * It is called a few times a second rather than every frame, and that is the whole point of it.
   * The words the bar shows never cost anything; the *asking* does Ã¢â‚¬â€ the lift underfoot, the
   * elevators near, the doorless building near and the nearest vehicle are all walks of a list or a
   * physics lookup, and the long line this replaces did every one of them on every frame, the
   * elevators twice on one line. Gathering them eight times a second is the saving.
   *
   * The order the states are asked in is the long prompt line's own, which is not quite the bar's:
   * the line asks for the lift underfoot before it asks what is being flown, so the lift is asked
   * for while a bridge's controls are held too. That costs one lookup eight times a second and it
   * keeps the line saying exactly what it said before. The bar's rules read the same struct in their
   * own order and offer the ship there, which is theirs to decide. A jump and noclip decide the
   * whole of it and return before anything at all is asked for.
   */
  private gatherPrompt(simulate: boolean): PromptState {
    const s = resetPromptState(this.promptState);
    const p = this.player;
    s.live = simulate;
    if (!simulate) return s;
    const room = p.aboard;
    // The ship menu: near the top of a planet's sky it is news, in space it is simply there.
    s.shipMenu = this.spaceGate === 'up' ? 'altitude' : this.world.planet.space ? 'here' : '';
    // A jump holds the controls, and its own few actions are the whole bar while it does.
    const jump = this.hyperspace.prompt;
    if (jump) {
      s.jump = !this.hyperspace.crewFree || !room ? 'waiting' : this.liftHere() ? 'lift' : p.piloting ? 'piloting' : room.pilotSpot && p.pos.distanceTo(room.pilotSpot) < CONTROLS_RANGE ? 'controls' : 'waiting';
      s.lift = s.jump === 'lift';
      return s;
    }
    s.noclip = p.noclip;
    if (s.noclip) return s;
    // On foot, and standing at a bridge's controls too: the long line asks for the lift underfoot
    // before it asks what is flown, and both readings are gathered here so that the long line can
    // read them rather than ask for them again on every frame it is written.
    if (!p.mounted) {
      const lift = this.liftHere();
      s.lift = !!lift;
      this.promptLiftStops = lift ? lift.stops.length : 0;
      if (!lift && !room) {
        // One call, not two: the long line asked twice on one line, once to test and once to read.
        const lifts = this.world.elevatorsNear(p.pos, MOUNT_RANGE);
        if (lifts.length) s.elevator = lifts[0].kind === 'down' ? 'down' : 'up';
        else {
          const doorless = this.world.doorlessNear(p.pos);
          s.doorless = !!doorless;
          this.promptDoorless = doorless ? doorless.label : '';
        }
      }
    }
    const flown = p.mounted ?? p.piloting;
    if (flown) {
      s.mounted = !!p.mounted;
      s.piloting = !p.mounted;
      const v = s.vehicle;
      v.kind = flown.spec.kind;
      v.ship = !!flown.spec.ship;
      v.space = flown.space;
      v.landed = flown.landed;
      v.holding = flown.holding;
      v.airborne = flown.airborne;
      v.canLand = SHIP_GROUND.rule === 'landing';
      v.setDownNear = !!flown.setDownNear;
      v.powered = flown.powered;
      v.wings = flown.wings.length > 0;
      v.wingsOpen = flown.wings.chosen;
      v.guns = flown.guns.length > 0;
      v.hop = !!flown.spec.hop;
      v.boost = flown.spec.boost === 'heat' || flown.spec.boost === 'burst';
      v.cutKey = CUT_ENGINES_KEY;
      // A speeder or a mount has no ship menu of its own to offer.
      if (!v.ship) s.shipMenu = '';
      return s;
    }
    if (isSurfaceRoom(room)) {
      s.boots = true;
      s.bootsReach = !!this.reachFromBoots();
      return s;
    }
    if (room) {
      s.aboard = true;
      // Aboard a hull another player flies there is nothing here to take the controls of and no ship
      // menu to open: their ship is theirs, and E is both the way in and the way out of it.
      const theirs = (peerRooms()?.idOf(room) ?? 0) !== 0;
      s.atControls = !theirs && !!room.pilotSpot && p.pos.distanceTo(room.pilotSpot) < CONTROLS_RANGE;
      if (theirs) s.shipMenu = '';
      // Aboard a hull in space the menu is reached from the rooms; on a planet it is not.
      return s;
    }
    // One walk of the vehicles for all three of the questions the long line asked separately: is
    // one in reach, has it a room to step into, and is it on its back.
    const near = this.nearestVehicle();
    // Nothing of this world's within reach, but a hull another player flies may be: E boards that.
    s.near = near ? (near.interior ? 'board' : near.upsideDown ? 'flip' : 'mount') : peerRooms()?.nearest(p.pos, BOARD_TUNE.reach) ? 'board' : '';
    s.eva = p.eva;
    this.gatherGate(s);
    return s;
  }

  /**
   * The gate between two of a world's zones, into the same struct as everything else: whether the
   * key would take you through it, and the destination in full for the long line. It is asked for
   * eight times a second like the rest, and on a world with no gates at all Ã¢â‚¬â€ which is every world
   * but one Ã¢â‚¬â€ it is one comparison and nothing more.
   *
   * The two rules it applies are `zoneGates.ts`'s own: the gate never takes the key from anything
   * else within reach, and it stands aside for a few seconds after any blow either way. Which
   * pack's gates these are was settled when the world loaded, not here.
   *
   * It is also where the game says where a gate leads: the bar's caps come from one frozen table of
   * words and none of them is a place name, so the name goes on the message line, once, the first
   * time each gate is offered in this world.
   */
  private gatherGate(s: PromptState): void {
    const p = this.player;
    const at = p.worldPos;
    const near = this.zoneGates.nearest(at.x, at.y, at.z);
    const act = gateAction({
      live: s.live,
      onFoot: !p.mounted && !p.piloting && !p.aboard && !p.noclip,
      free: !s.lift && !s.elevator && !s.doorless && !s.near && !s.boots && !s.eva,
      since: this.zoneGates.since(this.world.simTime),
      d: near ? near.d : null,
      to: !!near?.gate.to,
    });
    s.gate = act === 'none' ? '' : act;
    this.promptGate = act === 'none' ? '' : gateSaid(near?.gate);
    if (act !== 'none' && this.zoneGates.fresh(near?.gate)) {
      this.messages.system(act === 'travel' ? `a gate to ${this.promptGate}` : 'a gate this pack names nowhere for');
    }
  }

  /**
   * One call a frame, after the world is drawn: every shape of the display, on the overlay. It draws
   * nothing at all and takes what it drew off the canvas once while the game is not simulating, and
   * it allocates nothing Ã¢â‚¬â€ the primitives take numbers and colour indices only.
   */
  private drawOverlay(simulate: boolean): void {
    const o = this.overlay;
    // Both counters go to nothing on a frame that draws nothing, the canvas's own and the display's
    // shape count: left at the last flying frame's, the console would say the overlay was busy over
    // an open panel, the map or the death card, which is the one thing it is meant to prove it is not.
    if (!simulate || !o.begin()) {
      o.idle();
      this.shipHud.idle();
      this.feedback.idle();
      this.hud.idle();
      return;
    }
    this.hud.draw();
    this.shipHud.draw();
    this.feedback.draw();
    o.end();
  }

  // ---- Sound. ----

  /**
   * A number per space the ear or a sound can be in, so "are these two in the same room" is one
   * comparison and nothing holds a reference to a building that the world may unload: -1 is the
   * open world, and every building and every boarded hull gets a number of its own the first time
   * it is met. The map is weak, so an unloaded building's number simply goes with it.
   */
  private readonly spaceIds = new WeakMap<object, number>();
  private nextSpaceId = 1;

  private spaceIdOf(of: object | null | undefined): number {
    if (!of) return -1;
    let id = this.spaceIds.get(of);
    if (id === undefined) {
      id = this.nextSpaceId++;
      this.spaceIds.set(of, id);
    }
    return id;
  }

  /**
   * The ear at the camera, and the mixer's own step. Called after the frame's last camera move, so
   * a cockpit view hears from the cockpit and a chase view from behind the hull. Nothing is
   * allocated: the pose and the two vectors are fields.
   */
  private stepAudio(dt: number): void {
    const cam = this.cam.camera;
    cam.updateMatrixWorld();
    const pose = this.listenerPose;
    pose.x = cam.matrixWorld.elements[12];
    pose.y = cam.matrixWorld.elements[13];
    pose.z = cam.matrixWorld.elements[14];
    // Three's camera looks down its own -Z, and its +Y is up.
    this.listenerDir.set(-cam.matrixWorld.elements[8], -cam.matrixWorld.elements[9], -cam.matrixWorld.elements[10]).normalize();
    this.listenerUp.set(cam.matrixWorld.elements[4], cam.matrixWorld.elements[5], cam.matrixWorld.elements[6]).normalize();
    pose.fx = this.listenerDir.x;
    pose.fy = this.listenerDir.y;
    pose.fz = this.listenerDir.z;
    pose.ux = this.listenerUp.x;
    pose.uy = this.listenerUp.y;
    pose.uz = this.listenerUp.z;
    const aboard = this.player.aboard;
    const cell = this.world.cellState;
    // A surface the boots hold to is out of doors: the ear is beside a rock, not inside the hull that the
    // room happens to be named by, so the zone's own bed keeps playing rather than crossfading away.
    const inHull = aboard && !isSurfaceRoom(aboard) ? aboard.vehicle : null;
    pose.space.building = inHull ? this.spaceIdOf(inHull) : this.spaceIdOf(cell?.building ?? null);
    // Which room of a hull the player stands in is not tracked yet; a building's is.
    pose.space.cell = inHull ? -1 : (cell?.cell ?? -1);
    // The world's own sound reads the same two numbers: its beds sit wherever the ear does, so
    // walking into a cantina crossfades the street away rather than cutting it off at the door.
    this.world.listenerSpace.building = pose.space.building;
    this.world.listenerSpace.cell = pose.space.cell;
    // The guns' own ear: a bolt whines past where the camera is, and a shot belongs to the room the
    // camera stands in unless the world can name a nearer one.
    combatSounds.setListener(pose.x, pose.y, pose.z, pose.space);
    // The machines hear from the same place, and a ship's own engine belongs to whatever room the ear
    // is in: aboard a hull that is the hull, so the engine is not muffled by its own walls.
    vehicleSounds.setListener(pose.x, pose.y, pose.z, pose.space);
    // Feet and voices before the mixer's own step, so a step that lands this frame is given a voice
    // on the same frame it lands rather than the next.
    this.stepFeet(dt, pose.x, pose.y, pose.z);
    this.stepVehicleSounds(dt);
    this.audio.update(dt, pose);
  }

  /**
   * What every body's clips marked since the last frame: the feet, the voices, and the loops a
   * standing body makes. The three lists are the managers' own arrays and the player's record is a
   * field, so this allocates nothing.
   */
  private stepFeet(dt: number, lx: number, ly: number, lz: number): void {
    // The guns' own clock, stepped here beside the feet's rather than with the shooting, because
    // this is the one thing both the frame loop and `__debug.advance` run every step. Stepped with
    // the shooting it would stand still while the player is dead, in a panel or in the map, and
    // every shot fired at them in that time after the first would be swallowed as one volley.
    combatSounds.update(dt);
    // A planet handed over once, and taken away on the way out: the feet fetch what that planet's
    // own objects are made of.
    const pack = this.inWorld ? this.world.packId : '';
    if (pack !== this.feetPack) {
      this.feetPack = pack;
      if (pack) this.feet.begin(pack);
      else this.feet.leave();
      // The guns ask the same planet what its things are made of, and let go of the last one's.
      if (pack) combatSounds.begin(pack);
      else combatSounds.leave();
      // The second listener beside the sound: the world lays a print where a foot lands, on the
      // frame the clip's own mark says it lands and never on a clock of its own. The hook is the
      // same bound function every time, so nothing is made here, and the feet a body had last put
      // down go with the planet, as the marks themselves do.
      this.feet.onStep = footprints.stepHook;
      footprints.leave();
    }
    // The shared table that names the nine terrain surfaces arrives with the sound bank, some
    // frames after the game starts. Handed over when it changes rather than read through a cast,
    // so a rename in the bank is a type error here and not a silent fall back to file names.
    const tables = this.audio.bank.sources;
    if (tables !== this.feetTables) {
      this.feetTables = tables;
      this.feet.setSurfaceTable(tables?.surfaces as Record<string, { type?: string }> | undefined);
      // The guns' two tables come out of the same file: what each weapon's muzzle and blow sound
      // like, and the nine terrain surfaces, which is what tells a bolt's stone from its sand.
      combatSounds.setTables(tables as CombatTables | null);
    }
    const player = this.player;
    const rig = player.rig;
    const lists = this.footBodies;
    if (rig && this.inWorld && !this.creating) {
      const p = this.footPlayer;
      const at = player.worldPos;
      p.x = at.x;
      p.y = at.y;
      p.z = at.z;
      p.inside = this.world.inside || (!!player.aboard && !isSurfaceRoom(player.aboard));
      // A ship's rooms are a physics world of their own that no ray of the planet's reaches, so the
      // deck is the interior table's own floor for that hull, and metal where the table names no row
      // for it (it names three, two of them metal and the third carpet). Standing on a surface with
      // the boots on is not a deck: the world's own ray answers there, so a rock stays a rock.
      const hull = player.aboard && !isSurfaceRoom(player.aboard) ? player.aboard : null;
      p.deck = hull ? (vehicleSounds.deckSurface(hull.vehicle.def?.id ?? hull.vehicle.spec.id) ?? 'metal') : null;
      // Aboard, the body's own sounds belong to the hull the ear is in. Without this the muffling
      // rule puts a low-pass over every step the player takes on the deck, because there is no
      // streamed building at the point and the world would answer "outside".
      this.footSpace.building = hull ? this.spaceIdOf(hull.vehicle) : OUTSIDE.building;
      this.footSpace.cell = OUTSIDE.cell;
      p.space = hull ? this.footSpace : null;
      p.dead = this.dying || player.hp <= 0;
      // Which way the body faces, which the sound has no use for and a print does: it points the
      // way the walker was going.
      p.heading = player.heading;
      p.species = this.characterId;
      this.feet.playerTemplate = rig.character?.manifest.template ?? null;
      lists.player = p;
    } else lists.player = null;
    lists.mobiles = this.inWorld && this.world.mobiles ? this.world.mobiles.live : EMPTY_BODIES;
    lists.fighters = this.inWorld ? this.world.npcs.npcs : EMPTY_BODIES;
    this.listenerAt.x = lx;
    this.listenerAt.y = ly;
    this.listenerAt.z = lz;
    this.feet.update(dt, this.listenerAt, lists);
    this.stepRideSounds();
  }

  /**
   * Getting on and off. The game has three sounds of its own for it and nothing in the archives
   * says which goes where, so the reading is ours: climbing onto a mount or a speeder is
   * `pl_all_mount`, stepping aboard a ship's rooms is `pl_all_embark`, and leaving either is
   * `pl_all_disembark`. Watched as a change rather than called from the mount code, so every way on
   * and off (the key, the menu, a travel, a death) sounds the same.
   */
  private stepRideSounds(): void {
    const on = !!this.player.mounted;
    const aboard = !!this.player.aboard;
    if (on !== this.rodeLast) {
      this.rodeLast = on;
      if (this.started) this.playAtPlayer(on ? 'sound/pl_all_mount.snd' : 'sound/pl_all_disembark.snd');
    }
    if (aboard !== this.aboardLast) {
      this.aboardLast = aboard;
      if (this.started) this.playAtPlayer(aboard ? 'sound/pl_all_embark.snd' : 'sound/pl_all_disembark.snd');
    }
  }

  private rodeLast = false;
  private aboardLast = false;
  /** The ship tables from `sounds/sources.json` as the machines last had them. */
  private vehicleTables: unknown = undefined;

  /**
   * Every machine in the world this frame. The vehicles are the world's own list and the two the
   * player is on are fields, so nothing is allocated; outside a world the whole thing is let go, or
   * the next planet would start with the last one's engines still running.
   */
  private stepVehicleSounds(dt: number): void {
    if (!this.inWorld) {
      if (this.vehicleTables !== undefined) {
        vehicleSounds.leave();
        this.vehicleTables = undefined;
      }
      return;
    }
    // The chassis tables (each hull's flyby, its hit-sound group, the power sets and the interior
    // table's rooms) come out of the same shared file the feet and the guns read.
    const tables = this.audio.bank.sources;
    if (tables !== this.vehicleTables) {
      this.vehicleTables = tables;
      vehicleSounds.setTables(tables as VehicleTables | null);
    }
    const p = this.player;
    // Standing on a hull with the boots on is out of doors, not aboard: the ear is beside a rock and
    // the hull under it is one more machine in the world, with its flyby, its Doppler and its one
    // voice. Only a hull whose rooms the player is inside is theirs, and only those rooms hum.
    const inHull = p.aboard && !isSurfaceRoom(p.aboard) ? p.aboard.vehicle : null;
    // What the player is on: the mount, the ship they fly, or the hull whose rooms they stand in.
    const own = (p.mounted ?? p.piloting ?? inHull ?? null) as SoundVehicle | null;
    vehicleSounds.update(dt, this.world.vehicles as readonly SoundVehicle[], own, inHull as SoundVehicle | null);
  }

  /**
   * One of the game's sounds where the player stands, in whatever space the player is in: stepping
   * aboard a hull is heard from inside it, not through the muffle the mixer puts over another room.
   */
  private playAtPlayer(id: string): void {
    const at = this.player.worldPos;
    this.audio.play(id, { x: at.x, y: at.y, z: at.z, space: this.listenerPose.space });
  }

  /** Where the ear is, for the feet; a field, so the frame allocates nothing. */
  private readonly listenerAt = { x: 0, y: 0, z: 0 };
  /** The weapon last seen in the right hand, so its sounds are asked for once when it is taken up. */
  private heldGun: WeaponDef | null = null;
  /** The space the player's own feet and voice belong to while aboard a hull; a kept record. */
  private readonly footSpace: SoundSpace = { building: OUTSIDE.building, cell: OUTSIDE.cell };

  /** The look of the character as it is now. */
  private appearanceOf(c: Character): Appearance {
    return { morphs: c.morphValues(), values: c.variableValues(), height: c.height };
  }

  /** The sliders and colours changed on the appearance tab: written into the character's record while one is being played. */
  private saveAppearance(): void {
    const c = this.player.rig?.character;
    if (!c || !this.current || this.creating) return;
    this.current.appearance = this.appearanceOf(c);
    this.current.outfit = this.outfitOf(c);
    upsertCharacter(this.current);
  }

  /**
   * Whether the effects light what is around the lit blades this frame. The blades then ask for no
   * pooled flash lights, which stay with shots, hits and ship rooms. With Effects or the glow off,
   * the blades glow from the pool as before. It follows the setting (or a console override), not
   * whether a blade is on screen this frame, so a blade crossing the screen's edge never swaps one
   * light for the other; and not the strength, since at 0 the owner asked for no glow at all.
   */
  private bladeGlowOwnsLight(): boolean {
    const fx = this.postfx;
    if (!fx || this.bladeGlowFlashes || !fx.pass('bladeGlow')) return false;
    const forced = fx.override.bladeGlow;
    if (forced !== undefined) return forced;
    const toggles = fxPassDef('bladeGlow').toggles;
    for (let i = 0; i < toggles.length; i++) if (this.settings[toggles[i]]) return true;
    return false;
  }

  /**
   * A lit lightsaber through a wall or the ground burns it: each blade is cast along its length against
   * the world's fixed surfaces, and where it meets one a mark is laid in the blade's colour, spaced along
   * the blade's path. Swords and polearms burn nothing, nor does a blade aboard a ship's rooms.
   */
  private scorch(dt: number): void {
    this.marks.update(dt);
    const player = this.player;
    if (player.aboard || player.noclip || !player.saberOn) return;
    const n = player.saberSegments(this.bladeSegments);
    if (!n) return;
    // Any mesh burns but flesh: the creatures, the mobiles and the fighters are skipped.
    const flesh = (h: number) => this.world.creatures.byCollider.has(h) || this.world.npcs.byCollider.has(h) || !!this.world.mobiles?.byCollider.has(h);
    for (let i = 0; i < n; i++) {
      const seg = this.bladeSegments[i];
      const hit = this.physics.surfaceHit(seg.a, seg.b, player.body, this.world.inside, flesh);
      if (!hit) continue;
      this.markPoint.fromArray(hit.point);
      this.markNormal.fromArray(hit.normal);
      this.marks.touch(i, this.markPoint, this.markNormal);
    }
  }

  /** What the character wears, by the names it wears them under. */
  private outfitOf(c: Character): string[] {
    return c.status().filter((p) => p.worn && !p.body).map((p) => p.name);
  }

  private applyAppearance(c: Character, a: Appearance | null): void {
    applyAppearance(c, a);
  }

  /** Dress the character in a saved outfit: everything else comes off, each piece goes on by the name it was worn under. */
  private async dress(c: Character, outfit: string[]): Promise<void> {
    await dress(c, outfit, import.meta.env.BASE_URL, (key) => console.warn(`outfit: ${key} is not in the wardrobe any more`));
  }

  /** Put the rig of a species on the player (the placeholder body, or another species, comes off). */
  private async useSpecies(id: string): Promise<Character | null> {
    if (this.player.rig?.character?.manifest.id === id) return this.player.rig.character;
    const rig = await loadPlayerRig(import.meta.env.BASE_URL, id);
    this.player.unequip('right');
    this.player.unequip('left');
    this.player.detachRig();
    this.player.attachRig(rig);
    this.characterId = rig.character?.manifest.id ?? id;
    this.wireEmotes(rig.clipNames);
    this.appearanceUi.setSpecies(this.speciesList, this.characterId);
    return rig.character;
  }

  /** Who and where this player is, for the relay, and how they look, so the others draw them as they are. */
  private helloNow(): Hello {
    const c = this.current;
    // The weapons in hand, so the others see them (the outfit is the record's, which the equipment keeps current).
    const r = this.player.equipped.right?.id;
    const l = this.player.equipped.left?.id;
    const held = r || l ? { ...(r ? { r } : {}), ...(l ? { l } : {}) } : undefined;
    // The ship this player flies (or last flew or stood out), with its components, droid and paint.
    const ship = this.helloShip();
    if (ship) this.helloShipId = ship.id;
    const hello: Hello = { name: c?.name ?? 'someone', species: this.characterId, class: this.kit?.id ?? 'jedi', planet: this.world.planet?.id ?? '', zone: this.zone, look: c ? packLook(c.appearance, c.outfit ?? []) : undefined, held, ship, saber: this.player.bladeColor, mood: c?.mood || undefined };
    // Who the session is about: every connection and every change of world goes through here, so this is
    // where the session learns which character is in play, where it is and what its record holds now.
    this.net.session.noteCharacter(c, { species: hello.species, class: hello.class, planet: hello.planet, zone: hello.zone });
    return hello;
  }

  /** Send the hello again shortly (dressing several pieces sends one): a change of clothes or weapon reaches the others. */
  private queueHello(): void {
    // What the character owns, wears and flies has changed, whether or not anyone is connected: the
    // counter that settles an evening played offline rises here, and only when the record really moved.
    this.net.session.noteCharacter(this.current);
    if (!this.net.online) return;
    window.clearTimeout(this.helloTimer);
    this.helloTimer = window.setTimeout(() => {
      if (this.net.online && this.current) this.net.setHello(this.helloNow());
    }, 400);
  }

  /**
   * Compile something of the player's (or a peer's) before it is shown: the world's actor preparation,
   * then the motion blur's. Outside the world nothing is drawn by the main renderer, and arriving
   * compiles the whole scene behind the loading screen, so there is nothing to do.
   */
  private async prepareRoot(root: THREE.Object3D): Promise<void> {
    if (!this.inWorld) return;
    await this.world.prepareActor(root);
    await this.postfx?.product<VelocityProduct>('velocity')?.prepareRoots([root]);
  }

  /** The equipment changed what is owned, worn or held (or what is being put on): the panels follow, and the others are told. */
  private onEquipmentChanged(what: 'owned' | 'worn' | 'held' | 'busy'): void {
    if (this.backpack.open) void this.refreshBackpack();
    if (what === 'busy') return;
    // The server keeps what is worn and held so that it can refuse an offer of it; it is said here
    // because this is the one place that hears every change, and nothing is sent when it has not
    // moved or when there is no server to tell.
    this.tradeUsing?.();
    this.weaponsUi.held = { right: this.player.equipped.right?.id ?? null, left: this.player.equipped.left?.id ?? null };
    if (this.weaponsUi.open) this.weaponsUi.render();
    if (this.wardrobe.open && what === 'worn') this.wardrobe.refresh();
    this.queueHello();
  }

  /** Whether an id is a weapon or a wardrobe item: owned first, then the rack, then the wardrobe. */
  private async kindOf(id: string): Promise<'wear' | 'weapon' | null> {
    const owned = this.equipment.owned().find((o) => o.id === id);
    if (owned) return owned.kind;
    const ctx = await this.equipment.itemContext();
    if (!itemInfo('weapon', id, ctx).missing) return 'weapon';
    if (!itemInfo('wear', id, ctx).missing) return 'wear';
    return null;
  }

  /** The backpack's double-click (or Enter, or the console): on or off, in hand or put away; a weapon may switch the kit. */
  private async useItem(key: string, hand?: 'left'): Promise<string> {
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    const id = key.slice(i + 1);
    if (kind !== 'wear' && kind !== 'weapon') return `no item ${key}`;
    const r = await this.equipment.use(kind, id, hand);
    if (r.wants && r.wants !== this.kit.id && this.inWorld) this.setClass(r.wants);
    if (r.note !== 'dropped') this.messages.note(r.note);
    return r.note;
  }

  /** Destroy an owned item for good. */
  private async destroyItem(key: string): Promise<string> {
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    const id = key.slice(i + 1);
    if (kind !== 'wear' && kind !== 'weapon') return `no item ${key}`;
    const note = await this.equipment.destroy(kind, id);
    if (note !== 'dropped') this.messages.note(note);
    return note;
  }

  /** What the class fights with while a hand is empty, for the backpack's hand cells. */
  private standIns(): { right: string | null; left: string | null } {
    const p = this.player;
    if (p.fists) return { right: null, left: null };
    if (this.kit?.id === 'bounty_hunter') return { right: 'the plain rifle', left: null };
    return { right: 'the plain saber', left: p.saber.style === 'dual' ? 'the plain saber' : null };
  }

  /** Build the backpack from the equipment's snapshot and what the game says about each item. */
  private async refreshBackpack(): Promise<void> {
    const ctx: ItemContext = await this.equipment.itemContext();
    if (!this.backpack.open) return;
    const snap = this.equipment.snapshot();
    const now = Date.now();
    const busy = new Set(snap.busy);
    const newest = snap.owned.reduce((m, o) => Math.max(m, o.got), 0);
    const character = this.player.rig?.character ?? null;
    const cell = (kind: 'wear' | 'weapon', id: string, got: number): BackpackCell => {
      const info = itemInfo(kind, id, ctx);
      const where: BackpackCell['where'] = kind === 'weapon' ? (snap.held.right === id ? 'right' : snap.held.left === id ? 'left' : 'pack') : id in snap.worn ? 'worn' : 'pack';
      const first = info.slots?.[0];
      const slotsText = kind === 'weapon' ? (first ? slotWords(first) : '') : info.slots?.length ? `takes: ${info.slots.map((a) => slotWords(a)).join(' or ')}` : '';
      const classRank = info.cls ? WEAPON_ORDER.indexOf(info.cls) : WEAPON_ORDER.length;
      const order = where === 'worn' ? slotRank(first?.[0]) : kind === 'weapon' ? classRank : 100 + slotRank(first?.[0]);
      const fitNote = info.missing
        ? kind === 'weapon'
          ? 'not on this machine\'s weapons rack'
          : "not in this character's wardrobe"
        : info.fit === 'block'
          ? `${speciesWords(ctx.species, true)} cannot wear this`
          : info.fit === 'hide' || info.unseen
            ? `worn unseen on ${speciesWords(ctx.species, false)}`
            : undefined;
      return {
        key: info.key,
        kind,
        id,
        name: info.name,
        icon: info.icon,
        where,
        fit: info.fit,
        missing: info.missing,
        unseen: info.unseen,
        busy: busy.has(info.key),
        isNew: got > 0 && got === newest && now - got < 2000,
        kindText: info.kindText,
        slotsText,
        description: info.description,
        canLeft: kind === 'weapon' && !!info.cls && OFF_HAND_CLASSES.has(info.cls),
        order,
        fitNote,
      };
    };
    const cells = snap.owned.map((o) => cell(o.kind, o.id, o.got));
    // Anything worn or held that is not owned (it should not happen once a record is played) is shown all the same, so the panel matches the body.
    for (const id of Object.keys(snap.worn)) if (!cells.some((c) => c.kind === 'wear' && c.id === id)) cells.push(cell('wear', id, 0));
    for (const id of [snap.held.right, snap.held.left]) if (id && !cells.some((c) => c.kind === 'weapon' && c.id === id)) cells.push(cell('weapon', id, 0));
    this.backpack.render({
      cells,
      standIn: this.standIns(),
      noWardrobe: !!character && !ctx.wardrobe,
      note: !character ? 'this character is a single model: clothes cannot change' : !ctx.weapons ? 'no weapons converted' : undefined,
    });
  }

  /** Tell the relay where this player is, a few times a second, and move the others along. */
  private stepNet(dt: number): void {
    this.remotes.update(dt);
    if (!this.net.online) return;
    const now = performance.now();
    if (now - this.lastStateSent < 100) return;
    this.lastStateSent = now;
    const p = this.player;
    const rig = p.rig;
    const at = p.worldPos;
    const n2 = (n: number) => Number(n.toFixed(2));
    const n3 = (n: number) => Number(n.toFixed(3));
    // The vehicle this player is on, so the others see it with them on it; and the figure's
    // whole turn where a heading is not enough (aboard a banked hull, adrift in space).
    // Standing on a surface is not being aboard a ship: peers would otherwise draw the figure inside a hull
    // it is merely beside. The whole turn goes over as it already does for anyone adrift.
    const v = p.mounted ?? p.piloting ?? (isSurfaceRoom(p.aboard) ? null : p.aboard?.vehicle) ?? null;
    // Standing in a hull somebody else flies: say which hull and where in it, and send no copy of
    // the hull at all. Otherwise two people crewing one ship each send their own, and everyone else
    // builds two of it in the same place. The place is the hull's own frame, which is where `pos`
    // already is aboard; a world place would be glided on this browser's clock and the hull on
    // theirs, and the passenger would swim about the cabin and out through its walls. Naming
    // yourself is nobody's hull to draw, so it is refused here.
    const room = !p.mounted && !p.piloting && p.aboard && !isSurfaceRoom(p.aboard) ? p.aboard : null;
    const carrierId = room ? this.remotes.hullCarrier(room.vehicle.group) : 0;
    const inHull = room && carrierId > 0 && carrierId !== this.net.id ? { ship: carrierId, p: [n2(p.pos.x), n2(p.pos.y), n2(p.pos.z)] as [number, number, number], h: n3(p.heading) } : undefined;
    this.remotes.noteAboardSent(inHull ? inHull.ship : 0, p.pos.x, p.pos.y, p.pos.z, p.heading);
    // A hull you are only standing in is neither a ship you fly nor a ship to send: it is decided
    // first, so that nothing below asks about a hull that is somebody else's. Sending it is what
    // drew two of it; naming it in the hello would have every peer refit their picture of this
    // player's own ship with the fit of the ship they are a passenger in.
    const own = inHull ? null : v;
    // Another fitted ship taken: the hello (with that ship's fit) goes again once, debounced. Two strings compared, nothing allocated.
    const shipId = own?.def?.fit ? own.def.id : this.helloShipId;
    if (shipId !== this.helloShipId) {
      this.helloShipId = shipId;
      this.queueHello();
    }
    // Clamped onto another ship: whose, and where on it. The others then hang the picture of this hull
    // from that ship's own pose rather than gliding it about on the hull it rides.
    const dock = own ? this.docking.clamp.wire(own) : null;
    const veh: PeerVehicle | undefined = own ? { id: own.def?.id ?? own.spec.id, p: [n2(own.pos.x), n2(own.pos.y), n2(own.pos.z)], q: own.quaternion(tmpQ).toArray().map(n3) as [number, number, number, number], role: p.mounted ? 'ride' : p.piloting ? 'pilot' : 'aboard', pose: own.riderPose ?? undefined, ...(own.wings.length ? { w: own.wings.target ? 1 : 0 } as const : {}), ...(own.landed ? { landed: 1 } as const : {}), ...(dock ? { dock } : {}) } : undefined;
    const q = p.aboard || p.eva ? (p.group.quaternion.toArray().map(n3) as [number, number, number, number]) : undefined;
    // In a jump, from its start until the tunnel opens, the others do not see this player or the ship
    // (`j`). An ultra cruise is hidden the same way and for the same reason: at kilometres a second a
    // peer would be handed a place a kilometre from the last one ten times a second, which their side
    // glides through as a teleport and hands to their motion blur as a screen-wide smear.
    const hidden = this.hyperspace.hiddenToPeers || this.ultraCruise.running;
    // The blade when it is out of the hand: where it is in the world and how far it has spun, so the
    // others draw it in the air rather than in a hand it is not in. Aboard, `thrown.pos` is in the
    // hull's frame, as everything aboard is, and is carried into the world here.
    const th = p.thrown.inFlight ? thrownAt.copy(p.thrown.pos) : null;
    if (th && p.aboard) th.applyMatrix4(roomFrame(p.aboard));
    const tb = th ? ([n2(th.x), n2(th.y), n2(th.z), n3(p.thrown.spin)] as [number, number, number, number]) : undefined;
    // Where the head is looking, up or down: one byte, the middle of it level. Left and right is the
    // heading this message already carries. It is where the *view* looks and not where this
    // browser's ease has got to, because the peer's own browser eases it too and easing an eased
    // number would lag their head twice over; a frame in which the head is not looking at all
    // (a kata, a ride, a panel) sends the middle of the byte and their head is level.
    const pt = rig ? packPitch(rig.headLook.wantedPitch) : undefined;
    // One or the other, never both: the hull a passenger stands in is sent by whoever flies it.
    this.net.sendState({ p: [n2(at.x), n2(at.y), n2(at.z)], h: n3(p.heading), s: p.mounted ? 'seated' : (rig?.describe().state ?? 'idle'), v: n2(Math.hypot(p.vel.x, p.vel.z)), m: !!p.mounted, sab: p.saberOn, q, ...(pt === undefined ? {} : { pt }), ...(tb ? { tb } : {}), ...(inHull ? { in: inHull } : { veh }), ...(hidden ? { j: 1 as const } : {}) });
  }

  /** The wheel's slots from the rig's own emotes when none were kept yet, and the menu's Emotes page fed from it. */
  private wireEmotes(clips: string[]): void {
    if (this.emotes.every((e) => e === null)) this.emotes = defaultEmotes(clips);
    this.menu.emotes = {
      choices: () => emoteChoices(clips),
      slots: () => this.emotes,
      set: (i, clip) => {
        this.emotes[i] = clip;
        saveEmotes(this.emotes);
      },
    };
  }

  /**
   * Play an emote, a dance or a sit on the player: a dance or a sit loops until they move, an
   * emote plays once, and a flourish plays once over the dance, which comes back after it.
   */
  private playEmote(clip: string | null): void {
    const rig = this.player.rig;
    if (!clip || !rig || this.player.mounted) return;
    if (rig.play(clip, { fadeIn: 0.15, loop: loopsEmote(clip) }) === null) {
      this.messages.system(`the rig has no clip ${clip}`);
      return;
    }
    this.emoting = true;
    this.dance = isDanceClip(clip) ? clip : isFlourishClip(clip) ? this.dance : null;
    this.net.sendEmote(clip);
  }

  /** The emote ends (the player moved, mounted, or was told to stop): the figure goes back to what it was doing, here and on the relay. */
  private endEmote(): void {
    if (!this.emoting) return;
    this.player.rig?.stopOverride(0.2);
    this.emoting = false;
    this.dance = null;
    this.net.sendEmote('');
  }

  /** The emote keys: the arrows play the wheel's first four slots outright, and a dance takes the number keys. */
  private stepEmoteKeys(): void {
    for (let i = 1; i <= 4; i++) if (this.input.pressedAction(`emote${i}` as Action)) this.playEmote(this.emotes[i - 1]);
    this.stepDance();
  }

  /** Moving, jumping, attacking or mounting ends an emote; a dance or a sit would otherwise loop for good. */
  private stepEmoteEnd(): void {
    const { input, player } = this;
    if (this.emoting && (input.held('forward') || input.held('back') || input.held('left') || input.held('right') || input.held('jump') || input.held('attack') || player.mounted)) this.endEmote();
  }

  /**
   * Dancing: the number keys play the dance's flourishes (the game's /flourish 1 to 8, each
   * style's own), taken before the kit sees them as its slots, and the loop comes back when a
   * flourish ends.
   */
  private stepDance(): void {
    const rig = this.player.rig;
    if (!this.dance || !this.emoting || !rig) return;
    const style = danceOf(this.dance);
    for (let i = 1; i <= FLOURISHES; i++) {
      if (!this.input.consumeKey(`Digit${i}`)) continue;
      const clip = style ? rig.variant(`skill_action_${i}`, style) : null;
      if (clip) this.playEmote(clip);
      else this.messages.system(`this dance has no flourish ${i}`);
    }
    if (!rig.overriding) rig.play(this.dance, { fadeIn: 0.15, loop: true });
  }

  /** Play as another species or gender: the parts pack of that id replaces the rig, the wardrobe follows. */
  async switchCharacter(id: string): Promise<string> {
    const character = await this.useSpecies(id);
    if (!character || character.manifest.id !== id) return `no parts pack for ${id}: run the converter's species command`;
    if (this.creating) {
      // A fresh start for the species, with the look last tuned for it in this browser when there is one.
      this.applyAppearance(character, this.legacyAppearance(id));
    } else if (this.current) {
      this.current.species = id;
      this.current.appearance = this.appearanceOf(character);
      this.current.outfit = this.outfitOf(character);
      upsertCharacter(this.current);
    }
    // The new rig's worn pieces become owned, and the saved hands go back in the new rig's hands.
    if (!this.creating && this.current) await this.equipment.resync();
    if (this.wardrobe.open) void this.wardrobe.attach(character, import.meta.env.BASE_URL).catch((err) => console.warn('wardrobe', err));
    if (this.appearanceUi.open) this.appearanceUi.attach(character, import.meta.env.BASE_URL);
    if (this.inWorld) this.messages.system(`now playing as ${id.replace(/_/g, ' ')}`);
    return `playing as ${id}`;
  }

  /** The look kept per species before characters had records of their own, as a starting point in the creator. */
  private legacyAppearance(species: string): Appearance | null {
    try {
      const saved = localStorage.getItem(`swg.appearance.${species}`);
      return saved ? (JSON.parse(saved) as Appearance) : null;
    } catch {
      return null;
    }
  }

  // ---- The creator: the appearance and wardrobe panels at full size, no world behind them. ----

  private async openCreator(): Promise<void> {
    this.select.hide();
    this.creating = true;
    this.current = null;
    this.wardrobe.root.classList.add('creation');
    this.appearanceUi.root.classList.add('creation');
    this.creatorBar.show();
    const species = this.speciesList.find((s) => s.id === this.characterId)?.id ?? this.speciesList[0]?.id ?? 'human_male';
    const character = await this.useSpecies(species);
    // Whoever was played last leaves their weapons behind, even when the species is the same.
    this.equipment.reset();
    if (!this.creating) return;
    if (character) this.applyAppearance(character, this.legacyAppearance(species));
    this.showCreatorTab('appearance');
    // A place to stand in, if this install has any built. It is asked for after the panels are up
    // so the creator is usable the whole time the world is loading, and it answers false on a fresh
    // checkout, where the creator is then exactly the screen it always was.
    const man = await sceneManifest();
    const first = man?.creator[0];
    if (!first || !this.creating) return;
    if (await this.showScene(first)) {
      this.enterPlaceLayout(true);
      this.fillPlaceBar();
    }
  }

  /**
   * The creator's two shapes: the editor as a window down the right with the world behind it, or
   * the full-width panels over a dark backdrop when there is no place to stand in.
   *
   * One class on the two overlay roots, because everything that has to change -- the backdrop, the
   * panel's width, the doll's column going entirely, and the overlay letting a drag through to the
   * world -- is in the stylesheet beside the rules it is overriding.
   */
  private enterPlaceLayout(on: boolean): void {
    this.wardrobe.root.classList.toggle('in-place', on);
    this.appearanceUi.root.classList.toggle('in-place', on);
    this.placeHint.hidden = !on;
    this.placeBar.element.hidden = !on;
  }

  /**
   * Change which place the character is standing in, which is a world load and therefore not free.
   *
   * The row goes dead while it runs rather than the one button pressed: a second place asked for
   * while the first is still building would have two worlds loading over each other, and the second
   * would finish into a scene the first had already torn down.
   */
  private async switchPlace(key: string): Promise<void> {
    if (!this.creating) return;
    this.placeBar.setBusy(true);
    try {
      if (await this.showScene(key)) this.fillPlaceBar();
    } finally {
      this.placeBar.setBusy(false);
    }
  }

  /** Tell the row what is offered and what is up, from the manifest and the place that is loaded. */
  private fillPlaceBar(): void {
    void sceneManifest().then((man) => {
      if (!man) return;
      const offered = man.creator.length ? man.creator : man.places.map((p) => p.key);
      const s = this.scene3d;
      this.placeBar.setPlaces(
        offered.map((key) => {
          const row = man.places.find((p) => p.key === key);
          const here = s?.key === key ? s.built.place : null;
          return { key, place: here?.place ?? null, pack: row?.pack ?? '', hours: here?.hours ?? [] };
        }),
        s?.key ?? null,
      );
      if (s) this.placeBar.setHour(this.world.day.time * 24);
    });
  }

  private showCreatorTab(tab: 'appearance' | 'wardrobe'): void {
    if (!this.creating) return;
    this.closePanels();
    this.creatorBar.setStep(tab);
    this.inventoryTab = tab;
    const character = this.player.rig?.character ?? null;
    if (tab === 'appearance') {
      this.appearanceUi.show();
      if (character) this.appearanceUi.attach(character, import.meta.env.BASE_URL);
      else this.appearanceUi.explain('No parts pack for the player: run <code>npm run swg -- species @SWG assets-private --retail-only</code> and reload.');
    } else {
      // In the creator the Clothes tab only dresses: nothing is given (there is no record yet).
      this.wardrobe.developer = false;
      this.wardrobe.show();
      if (character) void this.wardrobe.attach(character, import.meta.env.BASE_URL).catch((err) => console.warn('wardrobe', err));
      else this.wardrobe.explain('No parts pack for the player: run the converter\'s <code>species</code> command and reload.');
    }
  }

  private leaveCreator(): void {
    this.creating = false;
    this.closePanels();
    this.creatorBar.hide();
    this.enterPlaceLayout(false);
    // The place goes with the creator, world and all. Not awaited: the caller either plays, which
    // loads a world of its own over the top, or goes back to the select screen, which loads none.
    void this.hideScene();
    this.wardrobe.root.classList.remove('creation');
    this.appearanceUi.root.classList.remove('creation');
    // The first I after making a character opens the backpack, not the creator's last tab.
    this.inventoryTab = 'backpack';
  }

  private async finishCreation(name: string, cls: ClassId, planet: string): Promise<void> {
    const c = this.player.rig?.character;
    // The class's starting kit, and what the creator dressed the character in, are its first items;
    // the kit's weapon goes in its hand when it arrives.
    const kit = await this.equipment.kit(cls);
    const outfit = c ? this.outfitOf(c) : [];
    const worn = outfit.map((part) => this.equipment.itemIdOf(part)).filter((id): id is string => !!id).map((id) => ({ id, kind: 'wear' as const, got: Date.now() }));
    const record: SavedCharacter = {
      id: newCharacterId(),
      name,
      species: this.characterId,
      class: cls,
      appearance: c ? this.appearanceOf(c) : { morphs: {}, values: {}, height: 0.5 },
      outfit,
      planet,
      created: Date.now(),
      played: 0,
      items: normalizeOwned([...worn, ...kit.items]),
      held: kit.held,
      inv: 1,
    };
    if (!upsertCharacter(record)) {
      this.creatorBar.note('No room for another character: delete one first.');
      return;
    }
    this.leaveCreator();
    await this.play(record);
  }

  // ---- Playing a character: its rig, look and outfit, then its world behind a loading screen. ----

  private async play(c: SavedCharacter): Promise<void> {
    this.select.hide();
    this.current = c;
    // The NPC pilots' taunts name the character played.
    this.world.ships.playerName = c.name;
    this.traveling = true;
    this.input.captured = false;
    const planet = PLANETS.find((p) => p.id === c.planet) ?? PLANETS[0];
    this.loadingScreen.show(planet, planet.name, `${c.name} is on the way`);
    const character = await this.useSpecies(c.species);
    if (character) {
      this.applyAppearance(character, c.appearance);
      await this.dress(character, c.outfit ?? []);
    }
    // What the character owns (a record from before the backpack is given what it wears and the kit),
    // with the hands emptied of whoever was played before; outside the `if`, so a single model gets its weapons too.
    await this.equipment.load(c);
    // The character's Force powers and gadgets in the slots (the defaults for a character from before there was a choice).
    this.jediKit().setLoadout(c.powers?.length ? c.powers.map((p) => p || null) : [...DEFAULT_LOADOUT]);
    this.hunterKit().setLoadout(c.gadgets?.length ? c.gadgets.map((p) => p || null) : [...DEFAULT_GADGETS]);
    this.forceUi.loadout = [...this.jediKit().loadout];
    this.setClass(c.class);
    const bladeColor = c.saber?.color ?? DEFAULT_SABER_COLOR;
    this.player.setSaberColor(bladeColor);
    this.weaponsUi.saberColor = bladeColor;
    // The mood the character was last in, back on the body: the idle takes its branch where this pack
    // has one, and the name goes out in the hello either way. A record from before the moods has none,
    // which takes nothing off nothing.
    this.player.rig?.setMood(c.mood ?? null);
    // The weapons in hand at logout, back in the same hands, blade unlit; behind the loading screen,
    // where arriving compiles the whole scene, the held models included.
    await this.equipment.restoreHeld();
    this.loadingScreen.setProgress(0.04);
    this.arrive(planet, c.zone, c.pos ? new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]) : undefined);
    if (c.heading !== undefined) {
      this.player.heading = c.heading;
      this.cam.yaw = c.heading + Math.PI;
    }
    // Space is never stood in: a character who was last there comes back flying a ship, where it was.
    if (planet.space) await this.arriveInSpace(c.pos ? new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]) : undefined);
    this.inWorld = true;
    this.started = true;
    await this.settle();
    c.played = Date.now();
    upsertCharacter(c);
    this.savePlace(true);
    this.remotes.setWorld(planet.id, this.zone);
    const relay = Net.savedUrl();
    if (relay) this.net.connect(relay, this.helloNow());
    await this.loadingScreen.hide();
    this.traveling = false;
    this.input.requestLock();
  }

  /**
   * Hold the loading screen until the world around the player is in: the pack, the ground
   * chunks under and around the feet, and the placed objects within working range. The player
   * is not simulated meanwhile, so nothing falls through ground that is not there yet. A world
   * that never settles (a pack missing) lets go after a while rather than never.
   */
  private async settle(timeoutMs = 30000): Promise<void> {
    const t0 = performance.now();
    // The world position: aboard a hull's rooms `player.pos` is in the hull's frame, near its origin, not where the hull is.
    while (performance.now() - t0 < timeoutMs) {
      if (this.world.settled(this.player.worldPos)) break;
      const { total, stage } = this.world.progress(this.player.worldPos);
      // The picture fills to 96% on the world's word; the last of it is the frame drawn below.
      this.loadingScreen.setProgress(0.04 + total * 0.92);
      this.loadingScreen.setWhat(`loading ${stage}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    // How dear a shader program is on this machine, measured once a session and only here, behind a
    // screen the player is already waiting at. It decides nothing about how the game looks: only how
    // hard it paces itself afterwards, and what this screen admits to while the wait is long.
    this.measureShaderCompiler();
    // Every shader compiles now, behind the screen: the effects, the bolts and the kit's own
    // visuals put one of themselves in the scene first, so the first shot, hit or throw finds its
    // shaders ready rather than compiling them on the frame it is needed.
    this.loadingScreen.setWhat('compiling shaders');
    this.effects.warmUp();
    this.world.bolts.warmUp();
    for (const id of ['jedi', 'bounty_hunter'] as ClassId[]) this.kitFor(id).warmUp?.();
    // Every pass and product too, whether it is on or not, so turning one on later or the sun
    // coming on screen for the first time never compiles on a live frame.
    if (this.postfx) {
      const warmed = await this.postfx.warmUp();
      if (warmed) console.info(`effects: ${warmed} programs warmed`);
    }
    // Space combat's effects (hits, target brackets, explosions, damage bands, every projectile): their batches
    // made hidden and their textures uploaded, so the first hit neither compiles nor uploads.
    this.loadingScreen.setWhat('preparing ship effects');
    await this.world.ships.prepareEffects(this.renderer);
    const tCompile = performance.now();
    // The line under the title is the one the screen always said on a machine where a program costs
    // a millisecond, and says why the wait is long on one where it costs a third of a second: a
    // thirty-second wait with a reason is a different thing from one that looks hung.
    const compiled = await this.world.compileAllAsync((done, total) => this.loadingScreen.setWhat(loadingLine(done, total, compilerVerdict())));
    if (compiled) console.info(`shaders: ${compiled} programs compiled behind the loading screen in ${(performance.now() - tCompile).toFixed(0)} ms`);
    // A frame with everything in, so the first thing seen is the world and not the screen lifting off a blank.
    this.drawFrame();
    this.lastPrograms = this.renderer.info.programs?.length ?? 0;
    // Everything built behind this screen is put on the watch's books as the loading screen's work,
    // so the first play frame reports the one program it really made rather than the two hundred
    // the screen made, and `__debug.shaders()` can tell the two apart afterwards.
    //
    // In a tab that is on screen the frame loop has been sampling all through the load and has said
    // `loading` for every one of those frames already, so this finds nothing left to file and costs
    // one pass over the live list. It is not idle: in a hidden tab, and in anything driving the game
    // without frames, no frame loop runs at all and this is the only sample the whole load gets.
    this.sampleShaders('loading');
    this.loadingScreen.setProgress(1);
    await new Promise((r) => setTimeout(r, 120));
  }

  /** The renderer's live program list, in the shape the watch reads. Nothing is copied. */
  private shaderRows(): readonly ProgramRow[] {
    return (this.renderer.info.programs ?? []) as unknown as readonly ProgramRow[];
  }

  /**
   * One sample of the renderer's program list. Called once a frame and again wherever programs are
   * built on purpose, so nothing is ever attributed to the wrong phase.
   */
  private sampleShaders(phase: ProgramPhase): { made: number; dropped: number; live: number; first: string } {
    return this.shaderWatch.sample(this.shaderRows(), phase, performance.now());
  }

  /**
   * What the game is doing, in the watch's own four words. Every sample asks this and nothing works
   * it out for itself, because the one figure the whole shader watch exists to get right is "what
   * was built during play", and a second opinion about what playing means corrupts it silently.
   *
   * It was two opinions and neither was right. The frame loop called every frame that was not a
   * travel, a jump or an effects switch `play`, which at the select screen Ã¢â‚¬â€ where there is no
   * world, no player and nothing playing Ã¢â‚¬â€ filed the session's first fourteen programs as built in
   * play and left them in that list for the rest of the session; and it called a frame behind the
   * loading screen `covered`, which is the word for a live frame the player cannot see, so
   * `loading` was never used by anything and the deliberate sample at the end of `settle` had
   * nothing left to file. The order below is the order the words mean: waiting on purpose first,
   * then a covered frame, then no world at all, and only what is left is play.
   */
  private shaderPhase(): ProgramPhase {
    if (this.loadingScreen.open || this.traveling) return 'loading';
    if (this.fxBusy || this.hyperspace.covered) return 'covered';
    if (!this.inWorld || !this.started) return 'boot';
    return 'play';
  }

  /**
   * Measure the machine once, behind a loading screen, and say what was found. The probe builds two
   * or three trivial programs nobody has built before and times the driver's own blocking answer;
   * on a machine where that is a millisecond it stops after one and costs nothing worth naming.
   */
  private measureShaderCompiler(): void {
    if (this.shaderVerdictSaid) return;
    let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
    try {
      gl = this.renderer.getContext();
    } catch {
      gl = null;
    }
    const verdict = measureCompiler(gl, { inPlay: this.started && !this.loadingScreen.open });
    // Not measured means the probe declined (it was asked in play); it may ask again next time.
    if (!verdict.measured && verdict.why.includes('in play')) return;
    this.shaderVerdictSaid = true;
    // One line, once a session. A machine with nothing wrong with it gets one cheerful line and is
    // never mentioned again.
    console.info(verdictLine(verdict));
  }

  /** Write where the character stands into its record, every few seconds or at once. */
  private savePlace(now = false): void {
    const c = this.current;
    if (!c || !this.inWorld || this.creating) return;
    const t = performance.now();
    if (!now && t - this.lastPlaceSave < 3000) return;
    this.lastPlaceSave = t;
    const p = this.player;
    // In a ship in flight over a planet, the place kept is the ground at the arrival point: the
    // ship is not kept, so a character put back in mid-air on foot would only fall.
    const flying = !!(p.mounted ?? p.aboard?.vehicle)?.airborne && !this.world.planet.space;
    const at = flying ? this.spawn : p.worldPos;
    c.planet = this.world.planet?.id ?? c.planet;
    c.zone = this.zone;
    c.pos = [Number(at.x.toFixed(2)), Number(at.y.toFixed(2)), Number(at.z.toFixed(2))];
    c.heading = Number(p.heading.toFixed(3));
    c.played = Date.now();
    upsertCharacter(c);
  }

  /** The kits, made once each and kept: a swap that built a kit anew would compile its shaders again, and its light coming and going recompiled everything. */
  private readonly kits: Partial<Record<ClassId, Kit>> = {};

  private kitFor(id: ClassId): Kit {
    return (this.kits[id] ??= id === 'jedi' ? new JediKit(this.scene) : new BountyHunterKit(this.scene));
  }

  private setClass(id: ClassId): void {
    // Leaving the Bounty Hunter: a flame held at the switch stops, heat and effect, since its kit stops updating.
    if (this.kit?.id === 'bounty_hunter' && id !== 'bounty_hunter') this.hunterKit().coolDown();
    this.kit = this.kitFor(id);
    this.player.setClass(id);
    this.player.speedMultiplier = 1;
    this.hud.setKit(this.kit);
    this.updateUrl();
    // The class is kept with the character, so the weapon saved in its hand comes back with the kit that fights with it.
    if (this.current && this.inWorld && !this.creating && this.current.class !== id) {
      this.current.class = id;
      upsertCharacter(this.current);
    }
  }

  private updateUrl(): void {
    if (!this.world.planet) return;
    const zone = this.zone ? `&zone=${this.zone}` : '';
    history.replaceState(null, '', `?planet=${this.world.planet.id}${zone}&class=${this.kit.id}`);
  }

  /** The zone of a multi-terrain planet the player is in, when the planet has zones. */
  private zone: string | undefined;

  /** Load a planet and stand the player at its spawn, or at `at` (where a character last stood). */
  private arrive(planet: PlanetDef, zoneId?: string, at?: THREE.Vector3): void {
    this.zone = planet.zones?.length ? (planet.zones.find((z) => z.id === zoneId) ?? planet.zones[0]).id : undefined;
    this.postfx?.reset();
    this.marks.clear();
    // No pilot's line or ship status from the world left behind, and no damage feedback either: it
    // ages on the real clock and runs through a travel, so a blow landed a fraction of a second
    // before one would otherwise say what it hurt on the planet arrived at.
    this.shipHud.clear();
    this.feedback.clear();
    this.world.load(planet, packIdOf(planet, this.zone));
    // This world's named places, off the same list the map reads and cached there: what the death
    // card calls each facility. Never awaited, and a world whose pack has no list simply has none.
    const placesFor = packIdOf(planet, this.zone);
    // The gates this world's zones are walked between, pointed at the pack the world is loading and
    // not at whatever the prompt last gathered: a gate belongs to the world arriving, and asked for
    // from the gather it would be the world left behind's gates, mirrored about the world left
    // behind's centre, for as long as it took a frame to reach the on-foot branch.
    this.zoneGates.use(import.meta.env.BASE_URL, placesFor);
    this.placeNames = [];
    this.placeNamesFor = placesFor;
    void this.poisOf(placesFor)
      .then((list) => {
        if (this.placeNamesFor === placesFor) this.placeNames = list;
      })
      .catch(() => {});
    this.spawn = this.world.spawnPoint();
    const stand = at ?? this.spawn;
    this.player.reset(stand);
    this.world.warmUp(stand);
    this.physics.stepOnce();
    this.cam.yaw = Math.PI;
    this.hud.setPlanet(planet);
    this.map.setCurrent(planet.id, this.zone);
    this.updateUrl();
    this.remotes.setWorld(planet.id, this.zone);
    this.net.setHello(this.helloNow());
    const arrivalSpawn = this.spawn.clone();
    void this.world.loadPack(stand).then((clearSpawn) => {
      const p = this.player;
      if (p.mounted || p.aboard || p.noclip) return;
      // Still standing where we arrived: move to open ground now that the real city is in.
      // A character back where it stood stays put.
      if (clearSpawn && !at && p.pos.distanceTo(arrivalSpawn) < 4) {
        this.spawn.copy(clearSpawn);
        p.reset(clearSpawn.clone().setY(clearSpawn.y + 0.1));
        return;
      }
      const ground = this.world.terrain.heightAt(p.pos.x, p.pos.z);
      if (p.pos.y < ground + 0.05) {
        p.pos.y = ground + 0.1;
        p.body.setTranslation({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, true);
      }
    }).catch((err) => console.warn('asset pack failed', err));
  }

  /**
   * Go to another world. With `ship`, arrive flying it: the ship carried up into space, or down
   * out of it, is spawned again over the arrival point at `height` and launched at `speed`, and
   * whoever was aboard its rooms stands in the new hull where they stood in the old (`crew`). A
   * space zone is always arrived at in a ship (the one last flown or fitted ship last stood out, else an X-wing).
   * A jump in flight ends first (a jump to another system does not come here: `carryAcross`). The ship arrived in is
   * returned, or null.
   */
  private async travel(planet: PlanetDef, zoneId?: string, ship?: ShipCrossing): Promise<Vehicle | null> {
    if (this.traveling) return null;
    this.hyperspace.abort('travel');
    this.ultraCruise.abort();
    this.traveling = true;
    this.map.hide();
    this.closePanels();
    this.input.captured = false;
    const zone = planet.zones?.find((z) => z.id === zoneId);
    console.info(`travel: to ${planet.name}${zone ? ` (${zone.name})` : ''}${ship ? ` flying the ${ship.def.id}${ship.crew ? ` from its rooms${ship.crew.piloting ? ' at the controls' : ''}` : ''}` : ''}`);
    // Leading a group, this is a trip the rest of them are offered, with a countdown of its own;
    // either way the group is told that this browser is on its way, which makes stale whatever it
    // last said about where it was standing, so that a group going back to a world it has already
    // been to is never sent to the point it came out at the time before. With no server it says
    // nothing and sends nothing.
    this.together.leaving(planet.id, zoneId ?? '', planet.space ? 'space' : 'ground');
    this.loadingScreen.show(planet, zone ? `${planet.name}: ${zone.name}` : planet.name, 'travelling');
    await new Promise((r) => setTimeout(r, 400));
    // Taking the group's trip up: come out beside whoever led it rather than at this world's own
    // spawn. It waits here, under the loading screen and before anyone steps out of a ship, for the
    // word saying where they came out -- bounded, and usually already in by the time it is asked.
    const beside = await this.together.followPoint(planet.id, zoneId ?? '', !!planet.space);
    const besideAt = beside ? new THREE.Vector3(beside[0], beside[1], beside[2]) : null;
    // A ship carried across comes out there facing the way a ship spawned at an arrival always has.
    const crossing = besideAt && ship && !ship.arrival ? { ...ship, arrival: { pos: besideAt, quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) } } : ship;
    // Into space with no ship carried (the galaxy map): arriveInSpace puts the ship at the zone's own arrival, so the world
    // streams from there. Read before anyone leaves a ship, so nothing waits between the leave and the unload.
    const spaceArrival = !crossing && planet.space ? arrivalAt(await loadSpacePack(import.meta.env.BASE_URL, packIdOf(planet, zoneId))) : null;
    const p = this.player;
    // Off the ship before the world it stands in goes: its room's physics world goes with it.
    if (p.aboard) {
      const room = p.aboard;
      room.reveal(false);
      // A corpse's pieces live in the room's own physics (startRagdoll builds them there): they go before the
      // room does, or the world is freed under bodies the next frame still reads. A hull somebody else flies
      // has a little world of its own too, and it is freed the moment this one is.
      if (p.ragdoll) p.endRagdoll();
      p.leave();
      // And whoever built that hull's rooms is told nobody is in them, or they are left marked as
      // held and are never given back.
      const peer = peerRooms()?.idOf(room) ?? 0;
      if (peer) peerRooms()?.aboard(peer, false);
      // A surface belongs to nothing but the boots: it is given up here, or its world would be left behind.
      if (isSurfaceRoom(room)) room.dispose();
    }
    if (p.mounted) p.dismount(p.pos.clone());
    // A jump's arrival, the group's, or the zone's (above) is where the world streams from, not the zone's spawn.
    this.arrive(planet, zoneId, crossing?.arrival?.pos ?? besideAt ?? (spaceArrival ? new THREE.Vector3(spaceArrival[0], spaceArrival[1], spaceArrival[2]) : undefined));
    const arrived = crossing
      ? await this.arriveInShip(crossing.def, crossing.speed, crossing.height, crossing.crew, crossing.arrival ?? null, crossing.condition ?? null)
      : planet.space
        ? await this.arriveInSpace(besideAt ?? undefined)
        : null;
    await this.settle();
    // Where this crossing came out, for anyone in the group taking the same trip after it. It is
    // said under the same name the trip was offered under, not the zone `arrive` settled on: a
    // planet with zones and none named resolves to its first, and a member following the world the
    // offer named would never match a word that came back with the resolved name on it.
    const cameOut = arrived?.pos ?? this.player.worldPos;
    this.together.arrived(planet.id, zoneId ?? '', [cameOut.x, cameOut.y, cameOut.z]);
    this.savePlace(true);
    await this.loadingScreen.hide();
    this.traveling = false;
    this.input.requestLock();
    return arrived;
  }

  /**
   * Arrive in space without a ship carried up: seated in the one last flown or fitted ship last stood out, else the default,
   * moving off gently. It comes out at `at` (where a character saved in space was), else the zone's own arrival (a planet's
   * launch point, or a system's first hyperspace point), facing the nearest station or landmark as a jump's arrival does.
   */
  private async arriveInSpace(at?: THREE.Vector3): Promise<Vehicle | null> {
    const def = this.lastShipDef ?? (await this.defaultShipDef());
    if (!def) return null;
    const pack = await loadSpacePack(import.meta.env.BASE_URL, this.world.packId);
    const arrival = arrivalAt(pack);
    const pos = at ? at.clone() : arrival ? new THREE.Vector3(arrival[0], arrival[1], arrival[2]) : this.spawn.clone();
    const pose = arrivalPose({ kind: 'point', at: [pos.x, pos.y, pos.z], radius: 0 }, pack ? landmarksOf(pack) : [], null, 40, sceneOf(pack));
    const q = lookRotation(pose.forward);
    return this.arriveInShip(def, 40, 0, null, { pos, quaternion: new THREE.Quaternion(q[0], q[1], q[2], q[3]) });
  }

  /** A ship to arrive in space with when none was flown: the first X-wing the garage has, else its first ship. */
  private async defaultShipDef(): Promise<VehicleDef | null> {
    this.world.garage ??= await Garage.load(import.meta.env.BASE_URL);
    const g = this.world.garage;
    return g.find('xwing') ?? g.vehicles.find((v) => v.kind === 'ship') ?? null;
  }

  /**
   * Spawn a ship over the arrival point, put the player in it and launch it, on the way into or
   * out of space. A ship with rooms is boarded: where the crew record says, at the controls if
   * they were there, else at its pilot's spot; a fighter is sat in. With `arrival` it comes out there, facing that way,
   * and a death afterwards respawns there (in Ord Mantell the zone's origin is inside its station). With `condition` the
   * new hull arrives as damaged as the one that left (World.spawnVehicle has adopted its fight by the time it returns).
   */
  private async arriveInShip(def: VehicleDef, speed: number, height: number, crew: ShipCrew | null = null, arrival: { pos: THREE.Vector3; quaternion: THREE.Quaternion } | null = null, condition: import('./space/shipCombat').CarriedCondition | null = null): Promise<Vehicle> {
    const p = this.player;
    const at = arrival ? arrival.pos.clone() : this.spawn.clone();
    at.y += height;
    const v = await this.world.spawnVehicle(def, at, Math.PI, def.kind, true, this.fitFor(def));
    if (condition) {
      if (v.combat) v.combat.restore(condition);
      else console.warn(`travel: the ${def.id} arrived with no fight to carry its damage onto`);
    }
    // Turned to the arrival's facing before anyone is put in it, so the rooms and the seat follow the hull's final frame.
    if (arrival) {
      v.teleport(at, arrival.quaternion, 0);
      this.spawn.copy(at);
    }
    const room = v.interior;
    if (room && (crew || room.pilotSpot)) {
      room.reveal(true);
      p.board(room, crew ? crew.local.clone() : room.pilotSpot!.clone());
      if (crew) p.heading = crew.heading;
      if (crew ? crew.piloting : true) p.piloting = v;
      this.cam.zoomTarget = Math.max(this.cam.zoomTarget, 6);
    } else {
      p.mount(v);
      this.cam.distance = Math.max(this.cam.distance, 9.5);
    }
    this.lastShipDef = def;
    v.launch(speed);
    this.physics.stepOnce();
    return v;
  }

  /** The ship the player flies, from its seat or its bridge, when it is one the garage knows and can spawn again. */
  private pilotedShip(): Vehicle | null {
    const p = this.player;
    const ship = p.mounted ?? p.piloting;
    return ship?.spec.ship && ship.def ? ship : null;
  }

  /** Where the player stands in the ship's rooms, to stand there again in the hull spawned on the other side. */
  private crewRecord(): ShipCrew | null {
    const p = this.player;
    return p.aboard ? { local: p.pos.clone(), heading: p.heading, piloting: !!p.piloting } : null;
  }

  /** The ship's fight as it stands, to put on the hull spawned on the other side of a crossing; null for a ship with none. */
  private conditionRecord(ship: Vehicle): import('./space/shipCombat').CarriedCondition | null {
    return ship.combat ? ship.combat.shares() : null;
  }

  /** The ship menu's way up: the flown ship, high enough over a planet with an orbit, goes into it with everyone aboard. */
  private async goToSpace(): Promise<void> {
    const ship = this.pilotedShip();
    const zone = spaceZoneOf(this.world.planet);
    // A destroyed ship crosses nowhere.
    if (!ship || ship.destroyed || !zone || this.traveling || this.spaceGate !== 'up') return;
    if (this.refuseWhileDocked()) return;
    this.closePanels();
    await this.travel(zone, undefined, { def: ship.def!, speed: Math.max(60, ship.speed), height: 0, crew: this.crewRecord(), condition: this.conditionRecord(ship) });
  }

  /**
   * The crossing a trip the group offered asks of this browser, once it has been taken up. A jump
   * is a jump -- the only crossing that keeps the hull, its rooms and whoever walks them -- and
   * everything else is the ordinary travel, carrying the ship being flown when there is one. The
   * world itself is looked up rather than trusted: what arrives is a name another browser sent.
   */
  private async crossWithGroup(move: TogetherMove): Promise<void> {
    const planet = PLANETS.find((p) => p.id === move.planet);
    if (!planet) {
      this.messages.system(`the group went to ${move.planet || 'nowhere'}, which is not a world here`);
      return;
    }
    // A ship at a dock, on a station's lane, or with another clamped to it is not its pilot's to
    // take anywhere, and a trip the group offered is no exception: two owners writing a pose onto
    // one hull is the reason, and it does not care who asked for the crossing. A crossing on foot
    // out of a docked ship is a different thing and is still allowed, as the ship menu's own way
    // off always has been.
    if ((move.withShip || move.do === 'jump') && this.refuseWhileDocked()) return;
    const zoneId = move.zone || undefined;
    if (move.do === 'jump') {
      if (!move.at) return;
      // The System Map's catalogue is what a jump reads another system's arrival out of, and it is
      // fetched the first time that map is opened: somebody who has never opened it would be told
      // to convert the space zones again. It is in hand within a moment and the countdown is longer.
      if (planet.id !== this.world.planet.id) await this.catalogue().catch(() => null);
      const why = this.hyperspace.followTo(planet.id, [move.at[0], move.at[1], move.at[2]], 'the group');
      if (why) this.messages.system(`cannot jump after the group: ${why}`);
      return;
    }
    if (move.do !== 'travel') return;
    // Carrying a hull up into a system is the ship menu's own way up and asks for the same height:
    // from the ground nobody's ship follows anybody into orbit. Leaving a system, and coming down
    // onto a planet, there is no such gate. Below it the crossing is still made -- being with the
    // group is the whole point of it -- but on foot, which is what the galaxy map has always done.
    const carry = !!this.world.planet.space || !planet.space || this.spaceGate === 'up';
    const ship = move.withShip && carry ? this.pilotedShip() : null;
    this.closePanels();
    if (ship && ship.def && !ship.destroyed) {
      // Up into a system at the speed the ship has, down onto a planet from the height a landing
      // comes in at: the same two crossings the ship menu's own rows make.
      const up = !!planet.space;
      await this.travel(planet, zoneId, {
        def: ship.def,
        speed: up ? Math.max(60, ship.speed) : 90,
        height: up ? 0 : SPACE_ARRIVAL_HEIGHT,
        crew: this.crewRecord(),
        condition: this.conditionRecord(ship),
      });
      return;
    }
    // On foot after all: said plainly, because a ship left on the other side of a crossing is not
    // something to find out about once the loading screen has lifted. A hull nobody is flying is
    // left where it stands, as the galaxy map's own travel has always left it.
    if (move.withShip || this.player.aboard) this.messages.system('going with the group; the ship stays here');
    await this.travel(planet, zoneId);
  }

  /** The ship menu's way down: the flown ship leaves orbit for the planet below, with everyone aboard. A system with no planet below has no way down. */
  private async landShip(): Promise<void> {
    const ship = this.pilotedShip();
    const below = planetBelow(this.world.planet);
    if (!ship || ship.destroyed || !below || this.traveling) return;
    if (this.refuseWhileDocked()) return;
    this.closePanels();
    await this.travel(below, undefined, { def: ship.def!, speed: 90, height: SPACE_ARRIVAL_HEIGHT, crew: this.crewRecord(), condition: this.conditionRecord(ship) });
  }

  /** The ship menu's way off: whoever is in a ship in space goes down to the planet on foot, the ship left behind. */
  private async eject(): Promise<void> {
    const p = this.player;
    const below = planetBelow(this.world.planet);
    if (!below || this.traveling || !(p.mounted || p.aboard)) return;
    // Never out of a hull another player flies. The way out of theirs is E, which takes the body out
    // of that room's own little physics world and stands the figure beside the hull; a travel from in
    // there would unload this world around a body that is not in it.
    if ((peerRooms()?.idOf(p.aboard) ?? 0) !== 0) return;
    this.closePanels();
    await this.travel(below);
  }

  /** The ship menu's Hyperspace row: cancels a countdown, else opens the System Map in place of the ship menu. */
  private hyperspaceButton(): void {
    if (this.hyperspace.phase === 'countdown') {
      this.hyperspace.cancel('cancelled');
      return;
    }
    if (this.hyperspace.locksControls || !this.world.planet.space || !this.pilotedShip()) return;
    // A ship at a dock or on a station's lane is not the pilot's to take anywhere: the map reaches this
    // by its own row as well as the ship menu, so the refusal lives here rather than on the label.
    const why = this.dockRefusal();
    if (why) {
      this.messages.system(why);
      return;
    }
    this.shipMenu.hide();
    this.hyperspaceUi.show({
      here: this.world.planet.id,
      catalogue: () => this.catalogue(),
      shipAt: () => this.pilotedShip()?.pos ?? null,
      why: (d) => this.hyperspace.why(d),
    });
    // The ship menu freed the mouse; the map keeps it free.
    this.freeMouse(true);
  }

  /**
   * The galaxy map's "Hyperspace to orbit": the same jump the System Map starts, from the other tab of
   * the map window. The map closes only once the countdown has begun, so a refusal is read where it
   * was asked for; the panel shows what comes back.
   */
  private jumpFromGalaxy(d: Destination): string | null {
    // A ship at a dock or on a station's lane is not the pilot's to take anywhere.
    const held = this.dockRefusal();
    if (held) return held;
    const why = this.hyperspace.start(d);
    if (why === null && this.map.open) this.toggleMap();
    return why;
  }

  /** The System Map's Hyperspace: the countdown begins and the map closes, or the refusal is shown on it. */
  private startJump(d: Destination): void {
    const why = this.hyperspace.start(d);
    if (why === null) {
      this.hyperspaceUi.hide();
      this.freeMouse(false);
    } else this.hyperspaceUi.note(why);
  }

  /**
   * Every space zone's pack and destinations, fetched once and kept. A zone not yet converted for hyperspace makes the
   * next call build the catalogue again, and `loadSpacePack` keeps neither a missing pack nor one from before hyperspace,
   * so those zones are fetched again and a reconversion mid-session shows on the System Map without a reload.
   */
  private catalogue(): Promise<HyperspaceCatalogue> {
    if (!this.hyperspaceCatalogue) {
      const systems = PLANETS.filter((p) => p.space).map((p) => ({ id: p.id, name: p.name, below: planetBelow(p)?.name ?? null }));
      const loading = HyperspaceCatalogue.load(import.meta.env.BASE_URL, systems);
      this.hyperspaceCatalogue = loading;
      loading.then(
        (c) => {
          this.loadedCatalogue = c;
          if (this.hyperspaceCatalogue === loading && c.systems.some((s) => !s.pack?.hyperspace)) this.hyperspaceCatalogue = null;
        },
        () => {
          if (this.hyperspaceCatalogue === loading) this.hyperspaceCatalogue = null;
        },
      );
    }
    return this.hyperspaceCatalogue;
  }

  /**
   * A jump to another system, called by the jump inside its closed tunnel: the world is swapped for the zone's with the hull
   * carried across it untouched (World.loadCarrying: its body, its rooms and whoever stands in them or sits in it), and
   * the hull put at the arrival's start `pose`, still held and ghosted. What `arrive` does for a zone, without a loading
   * screen and without standing the player anywhere: `traveling` is never set, so the frames go on (the tunnel draws, the
   * crew walks the rooms) while the pack loads; the jump then waits on `readyAround` as it does inside a system. The same
   * hull, or null when it cannot be carried (gone from the world, destroyed, or another travel under way).
   */
  private async carryAcross(zone: string, hull: Vehicle, pose: { pos: THREE.Vector3; quaternion: THREE.Quaternion }): Promise<Vehicle | null> {
    if (hull.destroyed || hull.disposed || this.traveling || !this.world.vehicles.includes(hull)) return null;
    const planet = planetById(zone);
    this.zone = planet.zones?.length ? planet.zones[0].id : undefined;
    this.postfx?.reset();
    this.marks.clear();
    // No pilot's line, ship status or target from the world left behind.
    this.shipHud.clear();
    this.shipTarget = null;
    this.targetFx.select(null, false, null);
    this.world.loadCarrying(hull, planet, packIdOf(planet, this.zone));
    // What `arrive` does for a zone: the gates go with the world, even here, where every zone a jump
    // reaches is a system with none. A world swapped under the hull with the last one's gates still
    // pointed at would be the one place they could be wrong and never show.
    this.zoneGates.use(import.meta.env.BASE_URL, packIdOf(planet, this.zone));
    if (!this.world.vehicles.includes(hull)) return null;
    // At the arrival's start, facing the arrival, before anything streams: the world streams round where the hull is.
    hull.teleport(pose.pos, pose.quaternion, 0);
    hull.held = true;
    this.spawn.copy(pose.pos);
    const p = this.player;
    if (p.aboard) p.placeVisual();
    else if (p.mounted) p.syncMount();
    this.world.warmUp(pose.pos);
    this.physics.stepOnce();
    this.hud.setPlanet(planet);
    this.map.setCurrent(planet.id, this.zone);
    this.updateUrl();
    this.remotes.setWorld(planet.id, this.zone);
    this.net.setHello(this.helloNow());
    await this.world.loadPack(pose.pos);
    if (this.world.planet !== planet || !this.world.vehicles.includes(hull)) return null;
    this.savePlace(true);
    return hull;
  }

  /**
   * E while a jump flies the ship: nothing, except in the closed tunnel for whoever stands in the hull's rooms, where it
   * works the lifts and takes or lets go of the controls, never the door (outside is the tunnel, or no world at all).
   */
  private pressJumpE(): void {
    const p = this.player;
    const room = p.aboard;
    if (!this.hyperspace.crewFree || !room) return;
    if (this.handleElevator()) return;
    if (p.piloting || (room.pilotSpot && p.pos.distanceTo(room.pilotSpot) < CONTROLS_RANGE)) this.handleMount();
  }

  /** The prompt line in a jump: the countdown, "jumping", or in the tunnel what the crew can do; null outside a jump. */
  private jumpPrompt(inLift: boolean): string | null {
    const hs = this.hyperspace;
    const line = hs.prompt;
    const p = this.player;
    const room = p.aboard;
    if (!line || !hs.crewFree || !room) return line;
    if (inLift) return 'in hyperspace Ã‚Â· <b>E</b> lift';
    if (p.piloting) return 'in hyperspace Ã‚Â· the ship comes out when the way ahead is ready Ã‚Â· <b>E</b> lets go of the controls';
    if (room.pilotSpot && p.pos.distanceTo(room.pilotSpot) < CONTROLS_RANGE) return 'in hyperspace Ã‚Â· <b>E</b> take the controls';
    return 'in hyperspace Ã‚Â· the ship comes out when the way ahead is ready';
  }

  /** The jump's crew kept aboard: someone who stepped out of the rooms in the tunnel (through a door) is boarded again at the entry. */
  private keepJumpCrew(): void {
    const v = this.jumpCrew;
    const p = this.player;
    const room = v?.interior;
    if (!v || !room || p.aboard || p.mounted || this.dying || !this.world.vehicles.includes(v)) return;
    this.postfx?.reset();
    room.reveal(true);
    p.board(room, room.entry.clone());
    this.cam.setFrame(v.group.quaternion);
  }

  /**
   * The jump's view for the pilot (`Hyperspace.holdsView`): the flight chase behind the ship at a fixed distance, the wheel
   * spent, whatever zoom they had (first person included) kept and put back when control returns. Allocates nothing.
   */
  private holdJumpZoom(on: boolean): void {
    const cam = this.cam;
    if (on) {
      if (this.jumpZoomKept === null) this.jumpZoomKept = cam.zoomTarget;
      cam.zoomTarget = TUNNEL_TIMES.zoom;
      cam.distance = TUNNEL_TIMES.zoom;
      this.input.wheel = 0;
    } else if (this.jumpZoomKept !== null) {
      cam.zoomTarget = this.jumpZoomKept;
      this.jumpZoomKept = null;
    }
  }

  /**
   * While the jump's tunnel is closed the world beyond it is not drawn: the camera's far plane comes in to just past the
   * tunnel's tip (three culls everything beyond), and goes back the frame it starts to open. `__debug.jumpFx({ cull: false })`
   * leaves the far plane alone.
   */
  private jumpFar(): void {
    const tunnel = this.jumpTunnel;
    if (!(this.hyperspace.covered && tunnel.shown && tunnel.look.cull && this.jumpTunnelFar > 0)) {
      this.restoreJumpFar();
      return;
    }
    const cam = this.cam.camera;
    if (this.jumpFarKept === null) this.jumpFarKept = cam.far;
    const far = Math.min(this.jumpFarKept, this.jumpTunnelFar);
    if (cam.far !== far) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  }

  /** The camera's own far plane back (and the cascades told, as after a resize). */
  private restoreJumpFar(): void {
    if (this.jumpFarKept === null) return;
    const cam = this.cam.camera;
    cam.far = this.jumpFarKept;
    this.jumpFarKept = null;
    cam.updateProjectionMatrix();
    this.world.onCameraResized();
  }

  /** Jump to a place on the map: travel first when it is on another planet. */
  private async teleport(planet: PlanetDef, poi: Poi, zoneId?: string): Promise<void> {
    this.hyperspace.abort('teleport');
    // A teleport within the same zone changes no zone, destroys no hull and starts no jump, so a run
    // would notice nothing: it would carry the empty ship off and keep the streamer frozen where the
    // player no longer is.
    this.ultraCruise.abort();
    if (this.traveling) return;
    if (planet.id !== this.world.planet.id || (planet.zones?.length && zoneId && zoneId !== this.zone)) {
      await this.travel(planet, zoneId);
      // The pack (and with it the snapshot's centre) loads after arrival; wait for it.
      for (let i = 0; i < 100 && !this.world.layoutCenter; i++) await new Promise((r) => setTimeout(r, 100));
    }
    const c = this.world.layoutCenter;
    if (!c) return;
    this.traveling = true;
    this.map.hide();
    this.input.captured = false;
    this.loadingScreen.show(planet, poi.name, `on ${planet.name}`);
    await new Promise((r) => setTimeout(r, 250));
    // Snapshot space is mirrored in X and centred on the layout centre.
    const gx = -(poi.x - c.x);
    const gz = poi.z - c.z;
    const pos = new THREE.Vector3(gx, this.world.terrain.heightAt(gx, gz) + 0.3, gz);
    const p = this.player;
    if (p.mounted) this.handleMount();
    p.reset(pos);
    this.spawn.copy(pos);
    this.world.jumpTo(pos);
    this.physics.stepOnce();
    await this.settle();
    this.savePlace(true);
    await this.loadingScreen.hide();
    this.traveling = false;
    this.input.requestLock();
  }

  /** The camera after everything has moved: chasing a ship in flight in its own frame, the cockpit, else orbiting the player. */
  private updateCamera(blocked: import('./core/camera').CameraBlocker | null, dt = 1 / 60): void {
    this.placeCamera(blocked, dt);
    // The jump's tunnel on the hull where this frame's step left it (after the physics, before the draw), and the world
    // beyond it not drawn while it is closed.
    this.jumpTunnel.follow();
    this.jumpFar();
    // The body's place in a cockpit depends on whether the view is inside it: re-seat on the frame that changes, after the
    // camera has decided, so the frame drawn has the body where that view wants it.
    const p = this.player;
    const fp = !!p.mounted?.eyeSeat && this.cam.firstPerson;
    if (fp !== p.firstPersonSeat) {
      p.firstPersonSeat = fp;
      p.syncMount();
    }
  }

  /**
   * Where the camera goes this frame. Seated in a ship's cockpit (by its eye) the first-person view is the cockpit eye,
   * hovering (locked to the hull, `cam.cockpit`) and flying (`cam.chase`) alike, so lift-off never moves it; Alt looks
   * round from that same eye. A bridge pilot's first person is their own eyes. Allocates nothing.
   */
  private placeCamera(blocked: import('./core/camera').CameraBlocker | null, dt: number): void {
    const { player, input } = this;
    const flown = player.mounted ?? player.piloting;
    // Off every vehicle: the next ride's hovering cockpit starts its heading target afresh, even on the same hull.
    if (!flown) this.cockpitYawOf = null;
    const ship = flown?.spec.ship ? flown : null;
    // A hull this view hid is shown again once it is no longer the one flown (landed and let go, left, travelled).
    if (this.hullHidden && this.hullHidden !== ship) {
      this.hullHidden.group.visible = true;
      this.hullHidden = null;
    }
    // A jump flying this ship: its pilot's view is the chase behind it at a fixed distance, as the client's was, with no free look.
    const jumpView = !!ship && this.hyperspace.holdsView(ship);
    this.holdJumpZoom(jumpView);
    const free = input.held('freeLook') && !jumpView;
    // Seated by the eye in a ship (not a bridge pilot): the cockpit view when zoomed all the way in, hovering or flying.
    const seated = ship && player.mounted === ship && ship.eyeSeat ? ship : null;
    const inCockpit = !!seated && this.cam.firstPerson;
    if (ship && (ship.airborne || inCockpit) && free) {
      // Alt: looking round from the cockpit eye (a bridge pilot's own eyes) in the ship's frame, starting at the nose, from the
      // eye itself (no step ahead); the wheel zooms out from there in steps sized to the ship.
      this.cam.release();
      this.cam.setFrame(ship.group.quaternion);
      if (!this.altLooking) {
        this.cam.yaw = Math.PI;
        this.cam.pitch = 0;
        this.altLooking = true;
      }
      const eye = this.shipEyeWorld(ship, this.shipEyeW);
      const head = eye ?? ship.pos;
      // The orbit's centre is the standing eye height under the head, the way the figure's camera is placed.
      this.orbitUnder.copy(head).addScaledVector(tmp2.set(0, 1, 0).applyQuaternion(ship.group.quaternion), -1.5);
      this.cam.update(input, this.orbitUnder, null, dt, eye, Math.max(1, (6 + ship.radius * 2.2) / 6), 1.5, 0);
      this.showHull(ship, true);
      return;
    }
    this.altLooking = false;
    if (ship?.airborne) {
      this.cam.chase(input, dt, ship.pos, ship.attitude, ship.heading, 6 + ship.radius * 2.2, this.shipEyeLocal(ship, this.shipEye));
      // Seated in the cockpit the hull would fill the view unless a frame is drawn there; a bridge pilot keeps the rooms
      // (unless __debug.cockpit({ bridgeHull: false }) asks for the hull hidden around them).
      this.showHull(ship, !this.cam.firstPerson || !!ship.cockpitFrame || (player.piloting === ship && this.bridgeHullInFlight));
      return;
    }
    if (inCockpit && seated) {
      this.cam.release();
      this.cam.setFrame(null);
      const eye = this.shipEyeWorld(seated, this.shipEyeW) ?? seated.pos;
      this.cam.cockpit(input, dt, eye, seated.group.quaternion, seated.heading);
      if (this.cam.firstPerson) {
        this.showHull(seated, !!seated.cockpitFrame);
        return;
      }
      // Wheeled out on this very frame: the head shows again and the body rises, so this frame is drawn from the orbit
      // below, never from the eye inside the skull. The orbit's own zoom finds the wheel already spent.
    }
    this.cam.release();
    // Mounted or piloted, a ship out of the cockpit and the chase is always drawn.
    if (ship) this.showHull(ship, true);
    // Aboard a ship the view is upright in the hull's frame, as the body is; adrift in space, in the body's own.
    this.cam.setFrame(player.aboard ? roomTurn(player.aboard) : player.eva ? player.evaFrame : null);
    // Seated in a ship the first-person eye is the cockpit's, so zooming in lands there.
    const eyes = seated ? this.shipEyeWorld(seated, this.shipEyeW) : this.eyes();
    this.cam.update(input, player.worldPos, blocked, dt, eyes, 1, player.eyeHeight);
    // The frame on which the wheel has just brought the orbit in is drawn as the cockpit, not from the orbit's tilt.
    if (seated && eyes && this.cam.firstPerson) {
      this.cam.cockpit(input, dt, eyes, seated.group.quaternion, seated.heading, false);
      this.showHull(seated, !!seated.cockpitFrame);
    }
  }

  /** Show or hide a flown hull for the view, remembering one left hidden so that it is shown again when the view moves on. */
  private showHull(v: Vehicle, shown: boolean): void {
    v.group.visible = shown;
    this.hullHidden = shown ? null : v;
  }

  /** The hovering cockpit's heading target (the mouse's sideways movement, kept near the hull), or null when not steering that way. */
  private cockpitYaw: number | null = null;
  /** The vehicle cockpitYaw was taken for. */
  private cockpitYawOf: Vehicle | null = null;
  /** Alt is held for looking round from a ship's eye: the look starts at the nose once per press. */
  private altLooking = false;
  /** A bridge pilot flying in first person keeps the hull and its rooms drawn (false: hidden around them, as before). */
  private bridgeHullInFlight = true;
  /** The flown hull placeCamera last hid (a frameless cockpit, or a bridge pilot's hull with bridgeHull off); shown again when no longer flown. */
  private hullHidden: Vehicle | null = null;
  private readonly shipEye = new THREE.Vector3();
  private readonly shipEyeW = new THREE.Vector3();
  private readonly orbitUnder = new THREE.Vector3();

  private readonly eyePoint = new THREE.Vector3();

  /** Where the player's eyes are this frame: a little above and ahead of the head's joint, as the animation places it; null without a head. */
  private eyes(): THREE.Vector3 | null {
    const rig = this.player.rig;
    const head = rig?.boneFor('head');
    if (!rig || !head) return null;
    head.getWorldPosition(this.eyePoint);
    // The joint sits at the skull's base; the eyes are a hand up and ahead in the head's own frame.
    this.eyePoint.add(tmp.set(0, 0.12, 0.09).applyQuaternion(this.player.group.quaternion));
    return this.eyePoint;
  }

  /** Where first person looks from in a ship, in the hull's frame: the cockpit eye for a seated pilot, a bridge pilot's own eyes. */
  private shipEyeLocal(v: Vehicle, out: THREE.Vector3): THREE.Vector3 | null {
    if (this.player.piloting === v) {
      const e = this.eyes();
      if (e) return v.group.worldToLocal(out.copy(e)); // worldToLocal uses a module temp: no allocation
    }
    return v.cockpitEye(out);
  }

  /** The same in the world. */
  private shipEyeWorld(v: Vehicle, out: THREE.Vector3): THREE.Vector3 | null {
    if (this.player.piloting === v) {
      const e = this.eyes();
      if (e) return out.copy(e);
    }
    return v.cockpitEye(out) ? v.group.localToWorld(out) : null;
  }

  private readonly hullLocal = new THREE.Vector3();
  private readonly hullInverse = new THREE.Matrix4();

  /**
   * The camera is among the rooms of the ship the player is aboard: in first person there, or
   * standing inside the rooms' bounds. False for the chase camera, for a free look zoomed out of
   * the hull, and for a fighter's pilot, who is aboard no rooms at all. The effects take it to
   * decide how much of the planet's colour grade the view keeps.
   */
  private cameraInHull(): boolean {
    const room = this.player.aboard;
    if (!room) return false;
    // Standing on a surface is out of doors, whatever the physics of it: no room's share of the grade there.
    if (isSurfaceRoom(room)) return false;
    if (this.cam.firstPerson) return true;
    // Seating the figure has already brought the hull's world matrix up to date this frame.
    this.hullInverse.copy(room.vehicle.group.matrixWorld).invert();
    return room.contains(this.hullLocal.copy(this.cam.camera.position).applyMatrix4(this.hullInverse));
  }

  /** The colour grade on the live chain, so every console hook reads the same pass; null with the effects off. */
  private gradePass(): import('./core/fx/grade').ColorGradePass | null {
    return this.postfx?.pass<import('./core/fx/grade').ColorGradePass>('colorGrade') ?? null;
  }

  /**
   * What a stepping vehicle reads of the world under it: the terrain's height, the surface of whatever
   * water stands over a column (lava tables and all, which is what the springs want -- a flow holds a
   * speeder up exactly as a lake does), and whether that liquid is a flow, which only ever chooses the
   * words a refused landing says. Bound fields rather than closures made in the loop: they were made
   * afresh for every vehicle on every step, and a step runs at the physics rate.
   */
  private readonly vehicleGroundAt = (x: number, z: number): number => this.world.terrain.heightAt(x, z);
  private readonly vehicleWaterAt = (x: number, z: number): number => this.world.terrain.waterHeightAt(x, z);
  private readonly vehicleLavaAt = (x: number, z: number): boolean => Number.isFinite(this.world.lavaAt(x, 0, z));

  /** Drive the ridden vehicle from the keys (the mouse or A/D steer, Alt frees the look, W/S throttle, Shift boost, Space hop, the view's tilt or Space and X climb and sink), step every vehicle, and seat the rider. */
  private stepVehicles(dt: number, simulate: boolean): void {
    const { player, input } = this;
    // Whether play runs, and the ship the player flies or is aboard: what the world's ship contacts and NPC ships
    // read in stepLiving, which runs after this in the loop and in __debug.advance alike.
    this.world.simulating = simulate;
    // A hull removed with someone still in its rooms (the garage's clear, the console): out into the world first.
    // A hull somebody else flies is in no such list -- it is a picture with rooms hung under it, and the rooms
    // themselves call the walker out (peerHullGone) when that player's ship goes.
    if (player.aboard && !peerRooms()?.idOf(player.aboard) && !this.world.vehicles.includes(player.aboard.vehicle)) this.thrownOutOfShip(player.aboard.vehicle);
    let drive: DriveInput | null = null;
    const pilot = player.mounted ?? player.piloting;
    const playerHull = pilot ?? player.aboard?.vehicle ?? null;
    this.world.playerShip = playerHull?.spec.ship ? playerHull : null;
    // What the world's own hazards reach beside the player: whatever they ride or drive, and how big
    // a whole life is, since a flow takes a share of one rather than a number of points. Here rather
    // than in the frame loop because this method runs in `__debug.advance` too, and in both it runs
    // before `stepLiving`, where the tick that reads them is. (`weatherRidden` is the same vehicle
    // but is written only in the drawn loop, so in a driven tab it is null for the whole session.)
    //
    // It must be written every step, including the step it becomes null: a rider the world still
    // thinks is mounted would be announced as burning while the loop's own damage closure, which
    // drops every blow on anyone mounted, quietly threw the blow away.
    this.world.playerRides = pilot;
    this.world.playerMaxHp = player.maxHp;
    if (simulate && pilot) {
      // The mouse steers: the vehicle turns toward where the camera looks, and a flyer climbs or
      // sinks as the view tilts up or down past a dead band around level. Alt frees the camera
      // to look around without steering.
      const free = input.held('freeLook');
      const tilt = -(this.cam.pitch - CAMERA_REST_PITCH);
      const vertical = free ? 0 : Math.sign(tilt) * THREE.MathUtils.clamp((Math.abs(tilt) - 0.12) / 0.45, 0, 1);
      // A ship in flight takes the mouse itself (the camera chases it); Alt hands it back to the orbit.
      const shipFlying = !!pilot.spec.ship && pilot.airborne && !free && input.locked;
      // Mouse flight (space/mouseFlight.ts): the mouse moves a cursor over the view that stays where it is left; inside the
      // aim circle it aims the guns and the ship holds its course, outside it the ship keeps turning toward it, harder the
      // further out, for as long as it is held there. Another hull, the ground, a loose pointer or a jump puts it back in the
      // middle; Alt leaves it where it is and holds the stick in the middle while the view looks round.
      const inFlight = !!pilot.spec.ship && pilot.airborne;
      if (this.flightCursorOf !== pilot || !inFlight || !input.locked || this.hyperspace.drives(pilot)) {
        this.flightCursor.x = 0;
        this.flightCursor.y = 0;
        this.flightCursorOf = pilot;
      }
      const steering = shipFlying && !this.hyperspace.drives(pilot);
      if (steering) {
        const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.cam.camera.fov) / 2);
        moveCursor(this.flightCursor, input.mouseDX, input.mouseDY, window.innerHeight / 2, this.cam.sensitivity, this.cam.invertY, tanHalf);
        stickFromCursor(this.flightCursor, tanHalf, this.flightStick);
      } else {
        this.flightStick.x = 0;
        this.flightStick.y = 0;
        this.flightStick.turn = 0;
      }
      // The mouse is the ship's in flight (the chase camera spends none of it), a jump's included.
      if (shipFlying) {
        input.mouseDX = 0;
        input.mouseDY = 0;
      }
      this.flightAiming = steering;
      // A ship not yet in flight hovers as a VTOL: the view's tilt does not lift it, Space and X
      // do, and A and D slide it sideways rather than turning it; in flight the keys roll it.
      const hovering = !!pilot.spec.ship && !pilot.airborne;
      const keys = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
      // Seated in a ship's cockpit and hovering: the view is the hull's, so the mouse's sideways movement moves a heading target
      // (as the orbit's yaw would) that the hull turns toward; up and down do nothing. At a bridge's controls hovering, the same
      // sideways steering (the view is in the hull's frame and turns with it; up and down still tilt it). Alt frees the view.
      // (`cam.firstPerson` is last frame's, the view being drawn; the cockpit spends the mouse again on its own frame.)
      const cockpitLocked = pilot.eyeSeat && pilot === player.mounted && !pilot.airborne && this.cam.firstPerson && !free;
      const bridgeSteer = !!pilot.spec.ship && pilot === player.piloting && !pilot.airborne && !free;
      // A target left from another ride (or from before a dismount) is never carried onto this one.
      if (this.cockpitYawOf !== pilot) {
        this.cockpitYaw = null;
        this.cockpitYawOf = pilot;
      }
      if (cockpitLocked || bridgeSteer) {
        this.cockpitYaw = cockpitYawStep(this.cockpitYaw, pilot.heading, input.locked ? input.mouseDX : 0, 0.0025 * this.cam.sensitivity);
        input.mouseDX = 0;
        if (cockpitLocked) input.mouseDY = 0;
      } else this.cockpitYaw = null;
      drive = {
        throttle: (input.held('forward') ? 1 : 0) - (input.held('back') ? 1 : 0),
        steer: hovering ? 0 : keys,
        strafe: hovering ? keys : 0,
        heading: free ? null : this.cockpitYaw ?? this.cam.yaw + Math.PI,
        // A ship with a fight boosts on its booster's energy.
        boost: input.held('walk') && (pilot.combat ? pilot.combat.boostLeft > 0 : true),
        hop: input.pressedAction('jump'),
        up: input.held('jump'),
        down: input.held('crouch'),
        vertical: pilot.spec.ship ? 0 : vertical,
        // In flight the stick is the cursor's, held for as long as it is left out (in the middle while Alt looks round or
        // the pointer is loose); flyShip reads a given stick as held, never drifting back.
        stickX: inFlight ? this.flightStick.x : undefined,
        stickY: inFlight ? this.flightStick.y : undefined,
      };
    }
    // A ship in a jump is flown by the jump (its cruise is `jumpCruise`), whether or not a panel is open: the pilot's keys do nothing.
    if (pilot && this.hyperspace.drives(pilot)) drive = null;
    // A dock: while its autopilot flies the ship down a station's lane, or back out along it, the drive
    // it gives is used in place of the pilot's own, and a hand on the controls hands the ship straight
    // back. Docked, it holds the hull and the pilot's drive is passed through untouched.
    if (simulate) drive = this.docking.step(pilot, dt, drive);
    // A ship's target and guns: the guns lead the target when it sits within their cone, else
    // fire along the nose; the bolts are the game's own and strike what a blaster's would, ships included.
    if (simulate && pilot?.spec.ship && !this.hyperspace.drives(pilot)) this.aimShip(pilot, dt);
    else this.shipLeadValid = false;
    for (const v of this.world.vehicles) {
      // Which building room the ship stands in, followed through the portals before it steps: in one, its
      // floor is the room's and its hull ignores the terrain and the shells.
      this.world.trackVehicleRoom(v, dt);
      // An NPC ship flies on its brain's drive while play runs (held, it goes nowhere anyway).
      // The seventh is the swell-aware sea reader, which only the hover springs take: a hull on the
      // open water floats on the surface that is drawn rather than on the table's flat height.
      if (!v.drift) v.update(dt, this.physics, v === pilot ? drive : simulate && v.autopilot ? v.autopilot.drive : null, this.vehicleGroundAt, this.vehicleWaterAt, this.vehicleLavaAt, this.world.seaAtFn);
      else {
        const t = v.body.translation();
        v.pos.set(t.x, t.y, t.z);
        v.group.position.copy(v.pos);
        v.quaternion(v.group.quaternion);
      }
      v.interior?.physics.step(dt);
    }
    if (player.aboard) {
      // A room with a step of its own: a surface eases its up onto the face under the feet before the walker
      // is drawn on it, and says so the moment the boots let go (a jump, or the edge of the patch).
      player.aboard.step?.(dt, player);
      // Fallen out of the room (through a door in flight), or let go of: back into the world with its motion.
      if (!player.aboard.contains(player.pos)) this.leaveShip(true);
      else player.placeVisual();
    }
    // Every vehicle's hits and its state: sparks on a hit, smoke from a battered hull, and the
    // end of one whose hull is gone (its rider thrown off first).
    for (const v of [...this.world.vehicles]) {
      // On its back for a moment: the rider is thrown, and hurt by it.
      if (v === player.mounted && v.flipped) {
        this.dismountBeside(v);
        player.takeDamage(10);
        // Thrown by the ground, not by anybody: no direction, so the red flash and no arc.
        this.hurtFrom(null);
        this.messages.hitYou('thrown off: the speeder is on its back');
      }
      if (v.justHit > 0) {
        this.effects.burst(v.pos, 0xffc070, 0.4 + Math.min(2, v.justHit * 0.08), 0.2);
        this.effects.flash(v.pos, 0xffa050, 6 + v.justHit, 5, 0.12);
        if (v === player.mounted) {
          player.takeDamage(Math.round(Math.min(40, (v.justHit - 6) * 1.5)));
          // A jolt through the hull under you: the hull keeps no record of what it ran into, so
          // there is no direction to point at and the flash is the whole of it.
          this.hurtFrom(null);
        }
      }
      if (v.struck > 0) {
        // Bolts in the hull: a jolt to whoever is at the controls, a little of it as hurt. A ship with a fight
        // takes them in its shields and armour: the pilot is jolted and keeps their health until it is destroyed.
        if (v === player.mounted || v === player.piloting) {
          if (!v.combat) player.takeDamage(Math.round(Math.min(12, v.struck * 0.2)));
          // Bolts in the hull: the hull counts them but does not keep where they came from, so this
          // one flashes without an arc. The ship's own bars flash in the layer's colour instead.
          this.hurtFrom(null);
        }
        v.struck = 0;
      }
      const condition = v.hp / v.maxHp;
      // A ship whose combat plays its own damage bands (the game's smoke and fire) shows no stand-in smoke.
      if (condition < 0.67 && condition > 0 && !(v.combat && (this.world.ships.data?.hullFx(v.spec.id)?.damage.length ?? 0) > 0) && Math.random() < dt * (condition < 0.34 ? 9 : 3)) {
        tmp.copy(v.pos).y += (v.spec.bounds.max[1] - v.spec.bounds.min[1]) * 0.4;
        tmp.x += (Math.random() - 0.5) * v.radius;
        tmp.z += (Math.random() - 0.5) * v.radius;
        this.effects.burst(tmp, condition < 0.34 ? 0x303030 : 0x505050, 0.5 + Math.random() * 0.5, 0.9);
        if (condition < 0.34 && Math.random() < 0.3) this.effects.tracer(tmp, tmp.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 0.8, (Math.random() - 0.5) * 1.5)), 0xffd080, 0.12);
      }
      if (v.destroyed) {
        // The game's own explosion, the death taunt for the player's kill, the NPC ships told; then the rest as before.
        this.world.ships.onDestroyed(v);
        if (v === this.shipTarget) this.shipTarget = null;
        if (v === player.mounted) {
          // Blown up under the rider: thrown clear with its speed and a kick upward, flailing, down prone.
          const lv = v.body.linvel();
          tmp.copy(v.pos).y += 0.6;
          player.fling(tmp, tmp2.set(lv.x, lv.y, lv.z));
          player.takeDamage(25);
          // Blown up under you: it is all round, so it has no side.
          this.hurtFrom(null);
        } else if (player.aboard?.vehicle === v) this.thrownOutOfShip(v);
        this.effects.ring(v.pos, 0xffa050, 6 + v.radius, 0.5);
        this.effects.burst(v.pos, 0xffc080, 2 + v.radius, 0.4);
        this.effects.flash(v.pos, 0xffa050, 60, 20, 0.35);
        // Through the world, so a painted ship's own material copies leave the portal set and the cascades with it.
        this.world.disposeVehicle(v);
      }
    }
    // The way up and the way down, for whoever flies the ship: near the top of a planet's sky its
    // space zone is within reach; in space, the planet below. Both are taken from the ship menu.
    const flown = player.mounted ?? player.piloting;
    this.spaceGate = null;
    if (flown?.spec.ship && flown.def) {
      if (this.world.planet.space) this.spaceGate = 'down';
      else if (flown.airborne && spaceZoneOf(this.world.planet) && flown.pos.y - this.world.terrain.heightAt(flown.pos.x, flown.pos.z) > SPACE_GATE_HEIGHT) this.spaceGate = 'up';
    }
    if (player.piloting?.crashed) {
      const m = player.piloting;
      player.takeDamage(Math.round(THREE.MathUtils.clamp((m.crashed - 8) * 1.2, 5, 95)));
      // Flown into the ground: no side to it.
      this.hurtFrom(null);
      m.crashed = 0;
    }
    if (player.mounted) {
      player.syncMount();
      const m = player.mounted;
      if (m.crashed) {
        // Flown into the ground: hurt by the speed, and the crash shown where it happened.
        const dmg = Math.round(THREE.MathUtils.clamp((m.crashed - 8) * 1.2, 5, 95));
        player.takeDamage(dmg);
        this.hurtFrom(null);
        this.effects.burst(m.pos, 0xffb070, 3 + m.radius, 0.35);
        this.effects.flash(m.pos, 0xff8a50, 20, 25, 0.3);
        this.messages.hitYou(`crashed at ${Math.round(m.crashed * 3.6)} km/h: ${dmg} damage`);
        m.crashed = 0;
      }
    }
  }

  /**
   * A ship's target and guns. The target is a ship ahead: Tab cycles the ships within the
   * target cone by how far off the nose they sit, and with none chosen the nearest to the nose
   * is taken. Its lead is worked out every frame (where a bolt fired now would meet it, in the
   * shooter's frame, since a bolt carries the ship's own velocity). The guns fire in turn while
   * the trigger is held, at the lead when it sits within their cone, else along the nose, with
   * the weapon table's speed and range and the projectile table's look.
   */
  private aimShip(pilot: Vehicle, dt: number): void {
    const { input } = this;
    // A target gone, destroyed, the pilot's own, or not to be picked now (a ship in a jump) is let go.
    if (this.shipTarget && (this.shipTarget.destroyed || this.shipTarget === pilot || !this.world.vehicles.includes(this.shipTarget) || !this.shipPickable(this.shipTarget))) this.shipTarget = null;
    const nose = tmp.set(0, 0, 1).applyQuaternion(pilot.group.quaternion);
    const ahead: { v: Vehicle; off: number; hostile: boolean }[] = [];
    for (const v of this.world.vehicles) {
      if (v === pilot || !v.spec.ship || v.destroyed || !this.shipPickable(v)) continue;
      tmp2.copy(v.pos).sub(pilot.pos);
      const d = tmp2.length();
      if (d > SHIP_TARGET_RANGE || d < 1) continue;
      const off = Math.acos(THREE.MathUtils.clamp(tmp2.dot(nose) / d, -1, 1));
      if (off < SHIP_TARGET_CONE) ahead.push({ v, off, hostile: this.shipHostileToPilot(pilot, v) });
    }
    ahead.sort((a, b) => a.off - b.off);
    // With nothing picked, the ships that attack the pilot come first (Tab and the pick alike), then the nearest to the nose.
    let first = 0;
    while (first < ahead.length && !ahead[first].hostile) first++;
    if (first >= ahead.length) first = 0;
    if (input.pressedAction('target') && ahead.length) {
      const i = this.shipTarget ? ahead.findIndex((a) => a.v === this.shipTarget) : -1;
      this.shipTarget = ahead[i < 0 ? first : (i + 1) % ahead.length].v;
    } else if (!this.shipTarget && ahead.length) this.shipTarget = ahead[first].v;
    // The game's target effects follow the pick (and its standing): a change places them, the same pick does nothing.
    this.shipTargetHostile = this.shipTarget ? this.shipHostileToPilot(pilot, this.shipTarget) : false;
    this.targetFx.select(this.shipTarget, this.shipTargetHostile, this.world.ships.data);
    // The lead is worked out for the gun that fires next: a fitted ship's guns may fire different bolts.
    const nextIndex = pilot.guns.length ? (pilot.combat ? pilot.combat.nextGun : pilot.gunNext) % pilot.guns.length : -1;
    const nextGun = nextIndex >= 0 ? pilot.guns[nextIndex] : undefined;
    const lw = nextGun?.weapon ?? pilot.weapon;
    const speed = lw?.speed ?? SHIP_BOLT_SPEED;
    const range = lw?.range ?? SHIP_BOLT_RANGE;
    const own = pilot.body.linvel();
    this.shipLeadValid = false;
    const t = this.shipTarget;
    if (t) {
      const tv = t.body.linvel();
      const rel = tmp2.copy(t.pos).sub(pilot.pos);
      const relVel = boltFrom.set(tv.x - own.x, tv.y - own.y, tv.z - own.z);
      const time = interceptTime(rel, relVel, speed);
      if (time !== null && time * speed < range * 1.5) {
        leadPoint(rel, relVel, time, this.shipAim);
        this.shipLead.copy(this.shipAim).add(pilot.pos);
        this.shipAim.normalize();
        this.shipLeadValid = true;
      }
    }
    // The game's own target tones, from the combat data: one when a ship is picked and one when the
    // pick goes. The "acquired" tone goes to the moment the guns first have a firing solution on it,
    // which is ours -- nothing in this game locks a missile -- and the data's is the game's.
    vehicleSounds.target(this.world.ships.data?.file.target?.sounds, this.shipTarget, this.shipLeadValid);
    // Mouse flight: the guns aim through the cursor, kept to the aim circle, measured about the hull's nose from the
    // pilot's eye (never from the chase camera, which lags a turn by up to a quarter of a second and looks a little under
    // the hull), and cross where the target's lead is, or where the target is, or MOUSE_FLIGHT.convergeM out; within
    // MOUSE_FLIGHT.snapDeg of the lead they take it exactly. Allocates nothing. (The eye first: `eyes()` spends `tmp`.)
    this.flightOnLead = false;
    if (this.flightAiming) {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.cam.camera.fov) / 2);
      const eye = this.shipEyeWorld(pilot, this.flightEye) ?? this.flightEye.copy(pilot.pos);
      this.flightNose.set(0, 0, 1).applyQuaternion(pilot.group.quaternion);
      aimCursor(this.flightCursor, tanHalf, this.flightAimCursor);
      hullRay(this.flightAimCursor, tanHalf, this.flightRay).applyQuaternion(pilot.group.quaternion);
      const far = this.shipLeadValid ? eye.distanceTo(this.shipLead) : t ? eye.distanceTo(t.pos) : MOUSE_FLIGHT.convergeM;
      this.flightRange = Math.max(MOUSE_FLIGHT.nearestM, far);
      if (this.shipLeadValid) {
        tmp2.copy(this.shipLead).sub(eye);
        const d = tmp2.length();
        this.flightOnLead = d > 1e-6 && tmp2.dot(this.flightRay) >= d * Math.cos(THREE.MathUtils.degToRad(MOUSE_FLIGHT.snapDeg));
      }
    }
    if (!pilot.guns.length) return;
    pilot.gunCooldown = Math.max(0, pilot.gunCooldown - dt);
    const combat = pilot.combat;
    if (!(input.held('attack') && input.locked && (combat || pilot.gunCooldown <= 0))) return;
    // A ship with a fight fires on its combat's turn and refire (its capacitor's, its live guns'); else the old interval.
    let gi: number;
    if (combat) {
      gi = combat.takeShot();
      if (gi < 0) return;
    } else {
      gi = pilot.gunNext % pilot.guns.length;
      pilot.gunNext++;
      pilot.gunCooldown = SHIP_GUN_INTERVAL / Math.max(1, Math.min(4, pilot.guns.length / 2));
    }
    const g = pilot.guns[gi];
    pilot.group.updateMatrixWorld(true);
    // From the muzzle as it stands now (a gun on a wing fires from where the wing has turned it).
    const from = pilot.muzzle(g, shotFrom, shotDir);
    const dir = shotDir;
    // In mouse flight the gun swings toward the cursor (every gun's bolt crossing under it), onto the lead when the cursor
    // is on it, and never further off the nose than the guns' cone (a gun far out on a wing crossing near the nose, a lead
    // snapped at the rim). Otherwise (hovering, Alt, a loose pointer) led onto the target when it sits within the guns'
    // cone. The lead is what the ship's frame sees, so the bolt's own velocity (the muzzle's plus the ship's) meets the
    // target there.
    if (this.flightAiming) {
      gunAim(from, this.flightEye, this.flightRay, this.flightRange, this.shipLeadValid ? this.shipLead : null, THREE.MathUtils.degToRad(MOUSE_FLIGHT.snapDeg), dir);
      coneClamp(dir, this.flightNose, SHIP_GUN_CONE);
    } else if (this.shipLeadValid && Math.acos(THREE.MathUtils.clamp(this.shipAim.dot(nose), -1, 1)) < SHIP_GUN_CONE) dir.copy(this.shipAim);
    from.addScaledVector(dir, 1.2);
    // What this gun fires: its own component's bolt on a fitted ship, else the ship's one weapon; with a fight, its combat's stat (invented damage).
    const w = g.weapon ?? pilot.weapon;
    const cw = combat ? combat.weaponOfGun(gi) : null;
    const gunSpeed = cw?.speed ?? w?.speed ?? SHIP_BOLT_SPEED;
    const gunRange = cw?.range ?? w?.range ?? SHIP_BOLT_RANGE;
    const projectileIndex = cw?.projectile ?? w?.projectile;
    const projectile = projectileIndex !== undefined ? this.world.garage?.projectileFor(projectileIndex) ?? null : null;
    // The shot is the pilot's ship's: whatever it hurts remembers that ship (and through it the player).
    // The gun's own sound is the projectile table's row for the bolt this gun fires, which is the
    // ship's own gun (the X-wing's, the TIE's) and not the bolt's colour.
    this.world.bolts.fire(from, dir, { owner: 'player', damage: cw ? cw.damage : SHIP_GUN_DAMAGE, metresPerSecond: gunSpeed, inherit: new THREE.Vector3(own.x, own.y, own.z), life: gunRange / gunSpeed + 0.05, color: pilot.boltColor, exclude: pilot.body, projectile, source: this.world.ships.of(pilot), sound: combatSounds.shipGun(projectileIndex) });
    this.effects.flash(from, pilot.boltColor, 5, 6, 0.06);
  }

  /**
   * The target block, filled into the one kept struct: where the target shows on screen and how wide
   * it projects, what to call it, and the shields, armour and hull of the face turned toward the
   * pilot. Nothing here is made afresh Ã¢â‚¬â€ the two strings are joined only when the target itself
   * changes, so following one costs no allocation at all.
   */
  private targetHud(pilot: Vehicle): TargetView | null {
    const t = this.shipTarget;
    if (!t) {
      this.targetWordsOf = null;
      return null;
    }
    const cam = this.cam.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const tv = this.targetView;
    // The projection exactly as it comes: behind the camera it is mirrored, and the display mirrors
    // it back itself before clamping the arrow to the edge, so nothing is corrected here.
    tmp2.copy(t.pos).project(cam);
    tv.behind = tmp2.z > 1;
    tv.x = (tmp2.x + 1) * 0.5 * w;
    tv.y = (1 - tmp2.y) * 0.5 * h;
    // How wide the hull projects: its own radius at its distance, through this frame's field of view.
    const dist = Math.max(1, t.pos.distanceTo(cam.position));
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    tv.size = (t.radius * h) / Math.max(1e-3, tanHalf * dist);
    tv.range = Math.round(t.pos.distanceTo(pilot.pos));
    tv.active = this.shipPickable(t);
    const c = this.world.ships.of(t);
    tv.standing = this.shipTargetHostile ? STAND_ENEMY : c && shipStanding(c.faction) === 'friend' ? STAND_FRIEND : STAND_NEUTRAL;
    // The words: the name, and the side and tier under it. Joined once per target, not once a frame.
    // A side or a tier that changed under a target already held would keep the old words until the
    // target was switched; neither changes in play, and joining them every frame is a string a frame.
    if (t !== this.targetWordsOf) {
      this.targetWordsOf = t;
      tv.name = c?.type?.name ?? t.spec.label;
      tv.kind = c ? `${FACTION_LABEL[c.faction]}${c.type ? ` Ã‚Â· tier ${c.type.tier}` : ''}` : t.spec.kind;
    }
    // The face turned toward the pilot, where the target has a fight of its own; else its plain hull.
    const s = c?.combat?.summary(pilot.pos) ?? null;
    tv.shield = s ? s.shield : NaN;
    tv.armour = s ? s.armour : NaN;
    tv.hull = s ? s.hull : t.hp / Math.max(1, t.maxHp);
    return tv;
  }

  /**
   * The rest of the flight view: the speeds the arc is scaled to, the guns' refire clock and which
   * slots are down, the booster and the wings. Every number is one the hull already carries; this
   * writes them into the kept struct and makes nothing. The fight's status comes in already filled,
   * so it is asked for once a frame and no more.
   */
  private fillFlightNumbers(v: Vehicle, fv: FlightView, st: CombatStatus | null): void {
    // Out in space a hull flies at twice its atmospheric top, which is what the arc must be scaled to.
    const over = v.space ? 2 : 1;
    fv.speed = Math.abs(v.speed);
    fv.topSpeed = v.spec.maxSpeed * over;
    fv.boostTop = Math.max(fv.topSpeed, v.spec.boostSpeed * over);
    fv.wingFactor = v.wings.length ? v.wingOpenFactor : 1;
    fv.boosting = v.boosting;
    const c = v.combat;
    fv.gunSlots = Math.min(HUD_WIRING.gunBits, v.guns.length);
    // The arc drains on a shot and fills again on the refire: the fight's own clock where there is
    // one (its capacitor's and its live guns'), else the plain interval the hull fires on.
    if (c && st) {
      const interval = Math.max(1e-3, c.interval());
      fv.gunReady = 1 - Math.max(0, Math.min(1, c.cooldown / interval));
      let bits = 0;
      for (let i = 0; i < fv.gunSlots; i++) {
        const slot = c.gunSlot(i);
        if (slot && st.down.includes(slot)) bits |= 1 << i;
      }
      fv.gunsDown = bits;
      fv.boostShare = st.boost;
      fv.hasBooster = c.stats.boostSeconds > 0;
    } else {
      fv.gunReady = 1 - Math.max(0, Math.min(1, v.gunCooldown / SHIP_GUN_INTERVAL));
      fv.gunsDown = 0;
      // No fight: the hull's own meter is the burst or the heat, which is the only booster it has.
      fv.boostShare = v.spec.boost === 'none' ? 0 : v.spec.boost === 'heat' && HUD_WIRING.heatIsHeadroom ? 1 - v.meter : v.meter;
      fv.hasBooster = v.spec.boost !== 'none';
    }
    // Closed, opening, open, or held shut because a low wing has no room under it yet.
    if (!v.wings.length) fv.wings = WING_NONE;
    else if (v.wings.pilot && !v.wings.target) fv.wings = WING_HELD;
    else {
      const open = v.wingsOpen;
      fv.wings = open >= 0.999 ? WING_OPEN : open <= 0.001 ? WING_CLOSED : WING_OPENING;
    }
  }

  /**
   * The body's bars and the class's slot row, shown or hidden, and with them the on-foot dot, which
   * would otherwise sit inside the reticle's own boresight. Both are found the first time they are
   * asked for, because the display builds its own markup in the constructor, and written only on a
   * change; shown again, the dot takes the rule it always had Ã¢â‚¬â€ it is the Bounty Hunter's.
   */
  private bodyBlock: HTMLElement | null = null;
  private crosshairEl: HTMLElement | null = null;
  private crosshairLooked = false;
  private bodyShown = true;

  private showBodyBlock(show: boolean): void {
    // The dot is judged afresh every call, not only when the block moves, because a class swapped in
    // flight writes it again from the class's own rule and would put it back inside the reticle.
    const dot = show && this.kit.id === 'bounty_hunter';
    if (show !== this.bodyShown) {
      this.bodyShown = show;
      if (!this.bodyBlock) this.bodyBlock = this.ui.querySelector<HTMLElement>('#hud .bottom');
      // The class, not the attribute: the block declares `display: flex` of its own, and an author
      // declaration beats the browser's `[hidden] { display: none }` whatever the specificity, so
      // setting `hidden` on it changes nothing at all. `.hidden` carries the `!important`.
      if (this.bodyBlock) this.bodyBlock.classList.toggle('hidden', !show);
    }
    // The dot is compared against the element rather than against a belief of our own: the class's
    // own rule writes the same property (a class swapped in flight), so a remembered value would
    // say "already right" about a dot that had been put back on the screen behind us.
    if (!this.crosshairLooked) {
      this.crosshairLooked = true;
      this.crosshairEl = this.ui.querySelector<HTMLElement>('#hud .crosshair');
    }
    if (this.crosshairEl && this.crosshairEl.hidden === dot) this.crosshairEl.hidden = !dot;
  }

  /** Whether a ship may be picked as a target now (`targetable`: alive and not in a jump); a ship without a contact yet, by its ghosting alone. */
  private shipPickable(v: Vehicle): boolean {
    const c = this.world.ships.of(v);
    return c ? targetable(c) : !v.ghosted && !v.destroyed;
  }

  /** Whether a ship attacks the pilot: its side does on sight, its brain has the pilot's ship as its target, or it struck that ship in the last 20 s. */
  private shipHostileToPilot(pilot: Vehicle, v: Vehicle): boolean {
    const c = this.world.ships.of(v);
    if (!c) return false;
    if (shipStanding(c.faction) === 'enemy') return true;
    const mine = this.world.ships.of(pilot);
    if (!mine) return false;
    if (v.autopilot instanceof NpcBrain && v.autopilot.target === mine) return true;
    return mine.lastAttacker === c.key && this.world.simTime - mine.lastAttackedAt < 20;
  }

  /** The class's weapon and abilities, then the bolts in the air (a bolt reaching the player meets the saber first). */
  private stepCombat(dt: number): void {
    const player = this.player;
    // The weapon in hand changed: ask the bank for its sounds now rather than when it is first
    // fired, so the shot that waits for them is never a shot the player hears. Never awaited.
    if (player.equipped.right !== this.heldGun) {
      this.heldGun = player.equipped.right;
      combatSounds.prepareGun(this.heldGun);
    }
    const ctx: KitContext = { dt, input: this.input, player, world: this.world, cam: this.cam, physics: this.physics, effects: this.effects, bolts: this.world.bolts, weapons: this.weapons };
    this.kit.update(ctx);
    this.world.bolts.update(dt, {
      physics: this.physics,
      effects: this.effects,
      hittableAt: (h) => this.world.hittableAt(h),
      player,
      // A bolt the saber turns away becomes the player's: what it then hurts turns on them.
      playerSource: this.world.playerTarget,
      // And the player as something a bolt can set alight, which is what makes an enemy's acid or a
      // fireball burn them as it burns every other body; a shot of their own is never handed it.
      playerHittable: this.world.playerTarget,
      block: (bolt, hit, out) => player.deflect(bolt.dir, hit, this.cam, out),
      // The bolt hands over where it was when it reached you, which is the direction it came from
      // closely enough for an arc: a bolt travels 600 m/s and the point is a frame old at most.
      onPlayerHit: (dmg, from) => {
        if (player.mounted || player.noclip) return;
        player.takeDamage(dmg);
        this.hurtFrom(from);
      },
    });
  }

  /**
   * Two blades that meet (`src/combat/clash.ts`), once every blade in the world has been drawn.
   * Nothing about a clash crosses the wire: both browsers draw both blades, so each strikes its
   * own sparks and neither takes damage from it.
   *
   * It is a method rather than a block in the frame loop because the loop is not the only thing
   * that has to turn this clock: `__debug.advance` drives a tab that draws no frames at all, and
   * without this call there `__debug.clash()` could only ever report zeros -- which is the one
   * report the owner has instead of the sparks they cannot see.
   */
  private stepClashes(): void {
    const player = this.player;
    // The player's blades as the clashes read them: one hand (so a staff's two halves never meet
    // each other), the style's weight, and the very swing the hit sweep hurts with -- which is
    // `onFoot && saberOn && bladeActive` there (`jedi.ts`), so a blade carried in a saddle or a
    // cockpit declares no swing it is not making.
    const mine = player.saberBlades;
    const weight = CLASH.weights[player.saber.style];
    const swinging = !player.mounted && player.saberOn && player.bladeActive;
    for (let i = 0; i < mine.length; i++) {
      mine[i].owner = this.world.playerTarget.key;
      mine[i].attacking = swinging;
      mine[i].clashWeight = weight;
    }
    if (clashes.update(this.world.simTime, mine, this.world.npcs?.npcs ?? EMPTY_BODIES, remoteBlades.holders(this.world.mobiles?.live))) clashes.place(this.effects, sabers);
  }

  /** One frame through the portal renderer: the camera's building in full, the world through its doors (or the reverse). */
  /** Draw calls and triangles of the last frame, summed over every pass. */
  private frameCalls = 0;
  private frameTriangles = 0;

  /**
   * What adds light at a shot and writes no depth, for the depth of field's glow depth: hit bursts and
   * the blades' cores (the player's, the fighters'). A field initialiser, so it exists before the
   * effects chain is built; it reads the world only when a frame asks, while the lens draws.
   */
  private readonly collectDofGlows = (out: THREE.Object3D[], n: number): number => {
    // The guns' bolts, muzzle flashes and hit sparks, and the ships' bolts and their hits.
    n = this.world.weaponFx.glowBatches(out, n);
    n = this.world.shipFx.glowBatches(out, n);
    n = this.effects.glowMeshes(out, n);
    n = this.player.glowCores(out, n);
    // The other players' blades, which write no depth either.
    n = remoteBlades.glowCores(out, n);
    // The fighters exist once a planet has loaded.
    if (this.world.npcs) n = this.world.npcs.glowCores(out, n);
    // The catalogue's people with a lightsaber (the dressed Jedi, Sith and Inquisitors).
    if (this.world.mobiles) n = this.world.mobiles.glowCores(out, n);
    return n;
  };

  /** The dolls follow the effects settings: Effects and Depth of field, and its strength; a change shows on their next frame. */
  private syncPreviewEffects(): void {
    const S = this.settings;
    const fx = WardrobeUi.dollEffects;
    fx.on = S.effects && S.depthOfField;
    fx.strength = S.depthOfFieldStrength;
  }

  /**
   * Hand the volumetric march this world's sky and this frame's weather, and take the flat sheets
   * down while it is really drawing.
   *
   * Three things it must not do. It must not be on a load path: the measured sky is fetched lazily,
   * once per pack, and a world with none (a pack converted before the `clouds` command) simply never
   * draws cloud, which is exactly what the pass answers to a coverage of 0. It must not hold the
   * pass in a field: the Effects switch builds a second chain and disposes the first, so the pass is
   * looked up each frame and the volumes, which belong to no chain, are handed to whichever pass
   * asks. And it must put the sheets back whenever the march is not drawing -- the setting off, the
   * effects off, indoors, in space, a world with no cloud -- or a switch taken mid-flight leaves a
   * sky with nothing in it at all.
   */
  private feedClouds(): void {
    const sky = this.world.swgSky;
    const pass = this.settings.volumetricClouds ? this.postfx?.pass<CloudsPass>('volumetricClouds') : undefined;
    if (!pass) {
      if (sky) sky.sheets = true;
      return;
    }
    if (!pass.hasNoise) {
      if (this.cloudVolumes) pass.setNoise(this.cloudVolumes.base, this.cloudVolumes.detail, this.cloudVolumes.cover);
      else if (!this.cloudVolumesAsked) {
        this.cloudVolumesAsked = true;
        void loadCloudVolumes(import.meta.env.BASE_URL).then((v) => {
          this.cloudVolumes = v;
        });
      }
    }
    const id = this.world.packId;
    if (id && !this.cloudPacks.has(id)) {
      this.cloudPacks.set(id, null);
      void loadCloudPack(id, import.meta.env.BASE_URL).then((p) => this.cloudPacks.set(id, p));
    }
    const w = this.world.weather.state;
    const on = w.enabled;
    // A dust storm has the sky already; rain and snow leave it, and a rainy sky wants its cloud.
    const look = cloudLook(this.cloudPacks.get(id) ?? null, on ? w.level : 0, on ? w.windSpeed : 0, on && w.dust >= CLOUD_TUNE.standDownDust);
    const l = pass.look;
    const force = this.cloudForce;
    l.coverage = force.coverage ?? (worthDrawing(look) ? look.coverage : 0);
    l.brightness = force.brightness ?? look.brightness;
    l.decks = look.decks;
    l.drift = force.drift ?? look.drift;
    l.heading = w.windHeading;
    if (sky) sky.sheets = !pass.wouldDraw(!!this.world.planet?.space, this.world.inside);
  }

  private drawFrame(): void {
    const cam = this.cam.camera;
    cam.updateMatrixWorld();
    // The eye in the world: aboard a ship's rooms `pos` is in the hull's frame, and the building the
    // camera is in must be walked from where the figure really stands. Kept in a field, so nothing is
    // cloned per frame.
    const at = this.player.worldPos;
    const eye = this.cameraEye.set(at.x, at.y + 1.5, at.z);
    const view = this.portals.cameraBuilding(this.world.cellState, eye, cam.position, this.world.buildings);
    // The room's air, before the scene is drawn (its motes are in it): which room this frame is
    // drawn from, its doorway beams, its lamps and its motes. The effects read it after, in the fill below.
    const ra = this.roomAirInput;
    ra.dt = this.lastDt;
    ra.camera = cam;
    ra.view = view;
    ra.cell = this.world.cellState;
    // A ship's rooms have air, lamps and motes; a surface in space has none of it, so it is not one of these.
    ra.aboard = isSurfaceRoom(this.player.aboard) ? null : (this.player.aboard as import('./vehicles/interior').ShipInterior | null);
    ra.cameraInHull = this.cameraInHull();
    ra.playerPos = this.player.pos;
    ra.sun = this.world.sunInfo(this.fxSun);
    // The weather's overcast and dust, 0 to 1 (0 while the weather is off).
    const wfx = this.world.weather.state.enabled ? this.world.weather.fx : null;
    ra.overcast = wfx ? wfx.overcast : 0;
    ra.dust = wfx ? wfx.dust : 0;
    ra.bufferHeight = this.renderer.getDrawingBufferSize(this.roomAirBuffer).y;
    this.roomAir.update(ra);
    const info = this.renderer.info.render;
    // Every renderer.render() resets these, so sum them as the passes go by.
    const auto = this.renderer.info.autoReset;
    this.renderer.info.autoReset = false;
    info.calls = 0;
    info.triangles = 0;
    // What the volumetric march is asked to draw, and whether the flat sheets stand down for it.
    // Before the scene is drawn, because the sheets are in it; the sky wrote their visibility in
    // `world.update`, so a toggle here is seen on the very frame it is made.
    this.feedClouds();
    // With the effects on, the passes draw into their target and the picture goes out through them.
    const postfx = this.postfx;
    // Decided before the scene is drawn, so the lit water and the reflections pass never disagree
    // about who adds the water's environment term this frame.
    this.world.beginWaterFrame(cam, this.postfx?.passWanted('waterReflections') ?? false);
    postfx?.begin();
    this.portals.render(this.scene, cam, view, this.world.buildings);
    // The falling weather, into whatever the scene was drawn into; from inside, only through the exits.
    this.world.weather.draw(this.renderer, cam, view !== null);
    if (postfx) {
      const f = this.fxInput;
      f.camera = cam;
      f.dt = this.lastDt;
      f.sun = this.world.sunInfo(this.fxSun);
      f.portalView = view !== null;
      f.cameraInHull = this.cameraInHull();
      f.inside = this.world.inside;
      f.aboard = !!this.player.aboard;
      f.space = !!this.world.planet?.space;
      f.fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : null;
      f.daylight = this.world.day.daylight;
      f.dayIndex = this.world.day.colorIndex;
      f.lighting = this.world.swgSky?.lighting ?? null;
      f.planetId = this.world.planet?.id ?? '';
      f.aiming = this.player.aiming;
      f.aimAmount = this.cam.aimAmount;
      f.firstPerson = this.cam.firstPerson;
      f.orbitDistance = this.cam.orbitDistance;
      f.waterInView = this.world.waterBodies.inView;
      // The lights the frame was just drawn with (the shadow matrices are this frame's): the world's
      // two sets, the flash pool on the actor layer, and the torch.
      const L = this.fxLights;
      this.world.fillFxLights(L);
      const pool = this.effects.lightPool;
      for (let i = 0; i < pool.length; i++) L.flashCount = addPointLight(L.flash, L.flashCount, pool[i]);
      setSpotLight(L.sky.torch, this.torchOn ? this.torch : null);
      f.lights = L;
      // The suns (in space, the stars) the sky drew this frame, its cloud sheets, and whether the camera is under water: the lens flare's sources.
      f.skyLightCount = this.world.skyLights(f.skyLights, flareLook.nightSuns);
      f.cloudCount = this.world.cloudLayers(f.clouds);
      // The camera's own water, worked out once in beginWaterFrame above and read here: the record
      // is the world's own and is refilled in place, so the colour is a reference, not a copy.
      // Two verdicts, and which is which matters. `cameraUnderwater` is the safe one -- water may be
      // over the eye, a passing crest included, which over the sea reaches more than a metre into
      // the air -- and is what the lens flare has always read. `cameraSubmerged` is the strict one,
      // and is what the look is drawn from, since the band between them is open air. The rest is how
      // deep the camera is, what colour the water over it is and how thick that body is (the
      // converter's own reading of the client's water texture, which is the only thing that tells a
      // silty pond from open sea).
      const water = this.world.cameraWaterAt(cam.position);
      f.cameraUnderwater = water.under;
      f.cameraSubmerged = water.submerged;
      f.underwaterDepth = water.depth;
      f.underwaterColor = water.color;
      f.underwaterOpacity = water.opacity;
      // And how far a crest can lift that surface here: the flat height the CPU knows is not where
      // the sea is drawn, and the specks keep this much clear of the line so none is ever in the air.
      f.underwaterReach = water.reach;
      // The room this frame is drawn from inside (RoomAir ran above, before the scene): the light shafts' input.
      f.room = this.roomAir.frame;
      // The far side of what the camera follows: nothing nearer smears with the camera.
      f.followFar = this.followFar(cam);
      // The weather the effects fade by (the god rays and the flare in overcast), while it is on.
      f.weather = wfx;
      // The lit blades as drawn this frame (drawBlades and the fighters' step have run), and how
      // bright a surface near them can be from every other light; aboard, floors are the hull's.
      const blades = this.fxBlades;
      // The catalogue's people and the other players are gathered as one list, so the eight the glow
      // pass keeps are the nearest eight whoever is holding them.
      // The fighters exist only once a planet has loaded, and a frame is drawn behind the loading
      // screen before that: without the guard the first such frame throws and the frame is lost.
      collectBlades(blades, this.player.saberBlades, this.world.npcs?.npcs ?? EMPTY_BODIES, cam.position, remoteBlades.holders(this.world.mobiles?.live));
      const lit = this.litSources;
      lit.torch = this.torchOn ? this.torch : null;
      lit.eye.copy(cam.position);
      blades.litCeiling = litCeiling(blades, lit);
      // Whatever the player is standing in, the hull's rooms or a surface in space: "up" is that room's.
      const standingIn = this.player.aboard;
      if (standingIn) blades.up.set(0, 1, 0).transformDirection(roomFrame(standingIn));
      else blades.up.set(0, 1, 0);
      postfx.end(f);
    }
    this.frameCalls = info.calls;
    this.frameTriangles = info.triangles;
    this.renderer.info.autoReset = auto;
  }

  /**
   * Everything that moves on its own, for the motion blur, once a frame: the player and what they
   * ride, fly or stand aboard (followed by the camera), other vehicles, the creatures, the fighters,
   * the catalogue's mobiles and the other players. A field, so it exists before the chain is built;
   * it reads the world only when called. Anything that moves and is not listed blurs with the camera only.
   */
  private readonly collectMovers = (out: FxMoverList): void => {
    const p = this.player;
    out.add(p.group, true, 'player');
    const carrier = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
    // Its rooms are its children, so standing aboard is riding it.
    if (carrier) out.add(carrier.group, true, 'ridden');
    const w = this.world;
    for (const v of w.vehicles) {
      if (v === carrier) continue;
      // A separate room model is always visible, but from outside it only shows through the hull, where it fails the depth test.
      const rooms = v.interior && v.interior.group !== v.group ? v.interior.group : null;
      out.add(v.group, false, 'vehicle', null, rooms);
    }
    if (w.creatures) for (const c of w.creatures.creatures) out.add(c.group, false, 'creature');
    if (w.npcs) for (const n of w.npcs.npcs) out.add(n.group, false, 'npc');
    if (w.mobiles) for (const m of w.mobiles.live) out.add(m.group, false, 'creature');
    // The loose props: one group for all of them, whose root never moves and whose children do, so
    // the classifier's "only the parts that move relative to it" branch is exactly right for them.
    // 'vehicle' rather than a kind of their own: `FxMoverKind` has no 'prop' and a crate is the
    // nearest thing to one of these -- a rigid thing that moves and turns as one.
    const props = loosePropsGroup();
    if (props) out.add(props, false, 'vehicle');
    this.remotes.collectMovers(out);
  };

  /** The follow sphere of the vehicle followed now, and what it was measured from: dropped when nothing is followed. */
  private followRoot: THREE.Object3D | null = null;
  private readonly followSphere: LocalSphere = { centre: new THREE.Vector3(), radius: 0 };
  private followChildren = -1;
  private followRooms: THREE.Object3D | null = null;
  private followAge = 0;

  /** The view depth of the far side of what the camera follows: the figure, and what it rides, flies or stands aboard. Nothing nearer smears with the camera. */
  private followFar(cam: THREE.PerspectiveCamera): number {
    const p = this.player;
    p.group.updateWorldMatrix(true, false);
    let far = followDepth(cam.matrixWorldInverse, p.group.matrixWorld, FIGURE_SPHERE);
    const v = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
    // Hidden in a cockpit with no frame: only the figure counts.
    if (!v) {
      // Nothing kept alive for a vehicle the player has left, which may be removed.
      this.followRoot = null;
      this.followRooms = null;
    }
    if (v && v.group.visible) {
      // With a tenth and a metre spare for wings that open past the box; measured again when the model
      // changes under it (rooms or attachments arriving after the first mount), and every 120 frames.
      const rooms = v.interior?.group ?? null;
      if (this.followRoot !== v.group || this.followChildren !== v.group.children.length || this.followRooms !== rooms || ++this.followAge >= 120) {
        this.followRoot = v.group;
        this.followChildren = v.group.children.length;
        this.followRooms = rooms;
        this.followAge = 0;
        measureLocalSphere(v.group, this.followSphere, 1.1, 1);
      }
      v.group.updateWorldMatrix(true, false);
      far = Math.max(far, followDepth(cam.matrixWorldInverse, v.group.matrixWorld, this.followSphere));
    }
    // The jump's tunnel goes with the hull the camera follows: nothing nearer than its far end smears with the camera.
    if (this.jumpTunnel.shown) far = Math.max(far, this.jumpTunnel.farDepth(cam.matrixWorldInverse));
    return far;
  }

  /** A new chain with every effect registered on it, ready to be warmed. */
  private makePostFX(): PostFX {
    const fx = new PostFX(this.renderer, this.settings);
    fx.debugMaskObjects = () => {
      const out = this.fxMaskObjects;
      out.length = 0;
      out.push(this.player.group);
      const ridden = this.player.mounted ?? this.player.aboard?.vehicle ?? null;
      if (ridden) out.push(ridden.group);
      return out;
    };
    // The specks are made per chain: a pass belongs to one, and switching Effects builds a second in
    // the background and disposes the first, which would take a shared pass's points with it.
    installEffects(fx, { water: this.world.waterBodies, heat: this.heat, collectMovers: this.collectMovers, collectDofGlows: this.collectDofGlows, specks: () => new UnderwaterSpecksPass() });
    return fx;
  }

  /** A setting in the effects registry moved: take all of them in one go on the next microtask. */
  private queueEffects(): void {
    if (this.fxQueued) return;
    this.fxQueued = true;
    queueMicrotask(() => {
      this.fxQueued = false;
      void this.reconcileEffects();
    });
  }

  /**
   * Bring the effects in line with the settings. Strengths and toggles are immediate. The master
   * switch changes which variant of every material is drawn, so the other variant is compiled in
   * the background with the frames still drawing the old way, and the picture changes over only
   * when the programs are ready.
   */
  private async reconcileEffects(): Promise<void> {
    if (this.fxBusy) {
      this.fxAgain = true;
      return;
    }
    this.fxBusy = true;
    try {
      do {
        this.fxAgain = false;
        const S = this.settings;
        this.postfx?.configure(S);
        this.syncPreviewEffects();
        if (S.effects === !!this.postfx) continue;
        if (!this.inWorld) {
          // Nothing is being drawn: arriving compiles for whichever path is in force then.
          if (S.effects) this.postfx = this.makePostFX();
          else {
            this.postfx?.dispose();
            this.postfx = null;
          }
          continue;
        }
        const want = S.effects;
        const next = want ? this.makePostFX() : null;
        const label = want ? 'Effects on' : 'Effects off';
        this.notice.set(`${label}: preparing shaders`);
        // The notice has to be on the screen before the compiling starts: the chain's own shaders
        // are built in one burst that holds the page, and awaiting only yields to microtasks, never
        // to a paint. Two frames is one to draw the notice and one to know it was drawn; the timer
        // is there because a hidden tab is given no frames at all.
        await new Promise<void>((done) => {
          const late = setTimeout(done, 100);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            clearTimeout(late);
            done();
          }));
        });
        if (next) await next.warmUp();
        // The aside is the loading screen's, in the same words: nothing at all on a machine that
        // builds a program in a millisecond, and what it really costs on one that does not, since
        // this notice is the only thing on the screen while the switch takes its seconds.
        await this.world.compileAllAsync((done, total) => this.notice.set(`${label}: shaders for ${done} of ${total} objects${machineAside(compilerVerdict())}`), { target: next ? next.compileTarget : null, keepQueue: true });
        if (this.settings.effects !== want) {
          // It moved again while we compiled: throw this one away and look at the settings afresh.
          next?.dispose();
          continue;
        }
        const old = this.postfx;
        this.postfx = next;
        next?.setSize();
        next?.reset();
        old?.dispose();
      } while (this.fxAgain || this.settings.effects !== !!this.postfx);
    } finally {
      this.fxBusy = false;
      this.notice.set(null);
      this.lastPrograms = this.renderer.info.programs?.length ?? 0;
    }
  }

  /**
   * Death: the body falls where it stood and the camera stays on it, with the respawn a button
   * away rather than a fade. A death without a rig (the placeholder figure) fades as before.
   */
  private die(): void {
    this.hyperspace.abort('died');
    this.ultraCruise.abort();
    if (this.dying) return;
    this.dying = true;
    this.closePanels();
    this.map.hide();
    this.player.startRagdoll();
    if (!this.player.ragdoll) {
      void this.fadeAndRespawn();
      return;
    }
    this.offerRespawn();
    this.death.classList.add('on');
    this.freeMouse(true);
  }

  /**
   * The world's own named places in the world's own frame: the pack writes them in the game's
   * coordinates, which are mirrored in X and centred on the snapshot's middle exactly as every
   * placed object is. Built on the death and nowhere else, so it is no frame's cost.
   */
  private placesHere(): NamedPlace[] {
    const c = this.world.layoutCenter;
    if (!c || this.placeNamesFor !== packIdOf(this.world.planet, this.zone)) return [];
    return this.placeNames.map((p) => ({ name: p.name, x: -(p.x - c.x), z: p.z - c.z, r: p.r }));
  }

  /**
   * Fill the death card with the facilities on this world, nearest first with how far each is from
   * where the body fell. A world with none (the lava planet, every zone of the tree planet, and
   * space, where there is no ground at all) keeps the card it always had, and the line says why
   * rather than leaving the player to wonder.
   */
  private offerRespawn(): void {
    const rows = this.world.planet?.space ? [] : this.world.cloningFacilities(this.player.worldPos, this.placesHere());
    this.deathChoices = rows;
    this.deathList.textContent = '';
    for (let i = 0; i < rows.length; i++) {
      const row = document.createElement('button');
      row.className = 'death-place';
      const where = document.createElement('span');
      where.className = 'where';
      where.textContent = rows[i].name;
      const far = document.createElement('span');
      far.className = 'far';
      far.textContent = distanceWords(rows[i].d);
      row.append(where, far);
      row.addEventListener('click', () => void this.respawnAt(i));
      this.deathList.appendChild(row);
    }
    this.deathList.hidden = rows.length === 0;
    this.deathHint.hidden = rows.length === 0;
    this.deathHint.textContent = rows.length ? 'come back at' : '';
    if (!rows.length && this.world.planet && !this.world.planet.space) {
      this.messages.system(`nothing on ${this.world.planet.name} brings the dead back, so you come round where you started`);
    }
  }

  /**
   * Off whatever was being ridden or stood in before the world is moved under it: a body that died
   * in a hull's rooms lives in that room's own physics, and a world moved around it would leave it
   * in a world nothing streams. These are the travel's own steps for the same reason, without the
   * ship, which is left where it stands and is a planet away once this is done. The ragdoll is
   * already gone by here, which is what the room's own physics needed taken out of it.
   */
  private stepOffForRespawn(): void {
    const p = this.player;
    if (p.aboard) {
      const room = p.aboard;
      room.reveal(false);
      p.leave();
      // And whoever built that hull's rooms is told nobody is in them, or they are left held for good.
      const peer = peerRooms()?.idOf(room) ?? 0;
      if (peer) peerRooms()?.aboard(peer, false);
      // A surface belongs to nothing but the boots: whoever lets go of it disposes it.
      if (isSurfaceRoom(room)) room.dispose();
    }
    if (p.mounted) p.dismount(p.pos.clone());
  }

  /**
   * Come back at one of the facilities the card offered. It is a teleport and is made like one: the
   * world is moved to the facility under a loading screen and waited for, and only then is the
   * player stood in its room -- a facility past the streamer's reach has no building here yet and so
   * no floor to stand on. Should the building still not be there when the wait gives up, they come
   * round on the ground where it stands and the line says so.
   *
   * Everything after the loading screen goes up is in a `try`, because this one reaches further than
   * the map's teleport does -- the streamer, the physics and a building's own cells -- and a throw
   * anywhere in it would otherwise leave `traveling` true, which is the loading screen up for good
   * with no way back to the game.
   */
  private async respawnAt(index: number): Promise<void> {
    const f = this.deathChoices[index];
    if (!f || this.traveling) return;
    this.deathChoices = [];
    this.death.classList.remove('on');
    this.traveling = true;
    this.input.captured = false;
    this.map.hide();
    this.loadingScreen.show(this.world.planet, f.name, 'coming round');
    const p = this.player;
    try {
      p.endRagdoll();
      this.stepOffForRespawn();
      this.dying = false;
      await new Promise((r) => setTimeout(r, 250));
      // On the ground where it stands first, which is what moves the streamer, and what the player is
      // left standing on if the building never arrives.
      const outside = new THREE.Vector3(f.x, this.world.terrain.heightAt(f.x, f.z) + 0.3, f.z);
      p.reset(outside);
      this.world.jumpTo(outside);
      this.physics.stepOnce();
      await this.settle();
      // A ray finds nothing until the world has stepped: the floor inside is read after this one.
      this.physics.stepOnce();
      const inside = this.world.cloneRoomAt(f.x, f.z, f.template);
      if (inside) p.reset(inside);
      else {
        // The real ground is in by now even when the building is not, so stand them on it rather than
        // on the height the stand-in terrain guessed while the pack was still loading. This is the
        // spot the facility itself is placed at, so the words say where they are and not that they
        // are clear of it: with no building here there is nothing to be outside of.
        const ground = this.world.terrain.heightAt(outside.x, outside.z);
        if (p.pos.y < ground + 0.05) p.reset(outside.setY(ground + 0.3));
        this.messages.system(`${f.name} has not come in yet, so you come round on the ground where it stands`);
      }
      this.physics.stepOnce();
      // Where you last came back is where a plain respawn puts you next time.
      this.spawn.copy(p.pos);
      this.savePlace(true);
    } finally {
      await this.loadingScreen.hide();
      this.traveling = false;
      this.freeMouse(false);
    }
  }

  private async fadeAndRespawn(): Promise<void> {
    this.fade.textContent = 'YOU HAVE BECOME ONE WITH THE FORCE';
    this.fade.classList.add('on');
    await new Promise((r) => setTimeout(r, 1400));
    this.respawn();
    this.drawFrame();
    await new Promise((r) => setTimeout(r, 200));
    this.fade.classList.remove('on');
  }

  /** Back at the spawn, whole; the ragdoll is taken away. */
  private respawn(): void {
    this.death.classList.remove('on');
    this.deathChoices = [];
    this.player.endRagdoll();
    this.player.reset(this.spawn);
    this.dying = false;
    this.freeMouse(false);
  }

  /** The panels' open state moved to the tabs: closing one panel of a pair and opening the other keeps the mouse free. */
  private anyPanelOpen(): boolean {
    return this.backpack.open || this.wardrobe.open || this.appearanceUi.open || this.weaponsUi.open || this.forceUi.open || this.vehiclesUi.open || this.shipEdit.open || this.npcUi.open || this.shipMenu.open || this.hyperspaceUi.open || this.liftMenu.open || this.menu.open;
  }

  private jediKit(): JediKit {
    return this.kitFor('jedi') as JediKit;
  }

  private hunterKit(): BountyHunterKit {
    return this.kitFor('bounty_hunter') as BountyHunterKit;
  }

  /** Put skills in a class's slots (the Jedi's powers, the Bounty Hunter's gadgets), the HUD following, and keep them with the character. */
  private setSkills(cls: ClassId, loadout: (string | null)[]): void {
    if (cls === 'jedi') this.jediKit().setLoadout(loadout);
    else this.hunterKit().setLoadout(loadout);
    if (this.kit.id === cls) this.hud.setKit(this.kit);
    if (this.current && !this.creating) {
      if (cls === 'jedi') this.current.powers = loadout.map((p) => p ?? '');
      else this.current.gadgets = loadout.map((p) => p ?? '');
      upsertCharacter(this.current);
    }
  }

  /** The Skills tab shown for the class in play: its skills on offer, and its slots. */
  private showSkills(): void {
    const jedi = this.kit.id === 'jedi';
    this.forceUi.defs = jedi ? POWERS : GADGETS;
    this.forceUi.loadout = [...(jedi ? this.jediKit().loadout : this.hunterKit().loadout)];
    this.forceUi.show();
  }

  private closePanels(): void {
    if (this.backpack.open) this.backpack.hide();
    if (this.wardrobe.open) this.wardrobe.hide();
    if (this.appearanceUi.open) this.appearanceUi.hide();
    if (this.weaponsUi.open) this.weaponsUi.hide();
    if (this.forceUi.open) this.forceUi.hide();
    if (this.vehiclesUi.open) this.vehiclesUi.hide();
    // Closing the edit page writes the fits, refits the spawned ships of that id and tells the others.
    if (this.shipEdit.open) this.shipEdit.hide();
    if (this.npcUi.open) this.npcUi.hide();
    if (this.shipMenu.open) this.shipMenu.hide();
    if (this.hyperspaceUi.open) this.hyperspaceUi.hide();
    if (this.liftMenu.open) this.liftMenu.hide();
  }

  /** P: the ship menu, for whoever is in a ship (at its controls, riding it, or aboard as a passenger). */
  private toggleShipMenu(): void {
    // From the jump's enter stage until control returns, P does nothing but say so.
    if (this.hyperspace.locksControls) {
      this.messages.system('jumping');
      return;
    }
    // The System Map is a page of the ship menu: the same key closes it.
    if (this.hyperspaceUi.open) {
      this.hyperspaceUi.hide();
      this.freeMouse(false);
      return;
    }
    if (this.shipMenu.open) {
      this.shipMenu.hide();
      this.freeMouse(false);
      return;
    }
    if (!this.shipStatus()) return;
    this.closePanels();
    this.map.hide();
    this.shipMenu.show();
    this.freeMouse(true);
  }

  /** The ship the player is in and their standing with it, for the ship menu; null on foot or on a ground vehicle. */
  private shipStatus(): ShipStatus | null {
    const p = this.player;
    // Aboard a hull another player flies there is no ship menu at all: not one row of it is this
    // browser's to press. The hull those rooms name is a stand-in nobody here flies, and a menu drawn
    // from it would offer to land, jump, dock and eject somebody else's ship. E is the way back out,
    // at the way in or anywhere else in the room.
    if (this.crossSideOf(p.aboard)?.kind === 'peer') return null;
    const ship = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
    if (!ship?.spec.ship) return null;
    const inSpace = !!this.world.planet.space;
    const role = ship === p.mounted || ship === p.piloting ? 'pilot' : 'passenger';
    const hs = this.hyperspace;
    const counting = hs.phase === 'countdown';
    return {
      ship: ship.spec.label,
      role,
      inSpace,
      flying: ship.airborne,
      altitude: inSpace ? null : ship.pos.y - this.world.terrain.heightAt(ship.pos.x, ship.pos.z),
      gateHeight: SPACE_GATE_HEIGHT,
      spaceName: spaceZoneOf(this.world.planet)?.name ?? null,
      // A system that is no planet's orbit (Kessel, Ord Mantell, Deep Space) has no planet below and is named for itself.
      planetName: inSpace ? (planetBelow(this.world.planet)?.name ?? null) : null,
      zoneName: inSpace ? (this.world.spaceData?.title && this.world.spaceData.title !== this.world.planet.id ? this.world.spaceData.title : this.world.planet.name) : null,
      jump: {
        // A ship at a dock or on a lane cannot jump: it is not the pilot's to fly until it is clear.
        canJump: !inSpace ? 'only in space' : (this.dockRefusal(ship) ?? (role !== 'pilot' || !ship.def ? "the pilot's call" : null)),
        counting: counting ? (hs.prompt ?? 'counting down') : null,
        busy: hs.phase !== 'idle' && !counting,
      },
      dock: this.docking.menuRow(ship, role, inSpace),
      board: boardRow(this.boardState()) ?? undefined,
      cruise: this.cruiseControl?.available(),
      speed: Math.round(Math.abs(ship.speed) * 3.6),
    };
  }

  /**
   * Why the flown ship cannot be taken anywhere just now, or null. A ship at a dock is held in the
   * station's own frame and the station is putting it right; one on a lane is being flown by the
   * station's autopilot. Either way the jump and both crossings must refuse, or two owners would write
   * a pose onto the same hull and the ship would be carried off the dock mid-repair.
   */
  private dockRefusal(of?: Vehicle | null): string | null {
    const ship = of ?? this.pilotedShip();
    if (this.docking.docked(ship)) return this.docking.clamp.carries(ship) ? 'let the other ship go first' : 'undock first';
    if (this.docking.flying(ship)) return "on the station's lane";
    return null;
  }

  /** The same refusal, said in the head-up display, for a row that has no words of its own. */
  private refuseWhileDocked(): boolean {
    const why = this.dockRefusal();
    if (why) this.messages.system(why);
    return why !== null;
  }

  /**
   * Where the walker stands for the ship menu's Board row, or null when there is nothing to cross
   * into and the row is not shown. Only a walker in a ship's rooms has anywhere to cross from -- from
   * a cockpit seat there is no way in to stand at -- and only into a hull another player flies, since
   * that is the crossing that can be waited on and refused; between two hulls of this world E at the
   * way in is instant, and a row about it would be a change to a game played alone.
   */
  private boardState(): BoardState | null {
    const rooms = peerRooms();
    if (this.crossingTo) return { across: rooms?.label(this.crossingTo) ?? null, theirs: true, atDoor: false, opening: true, why: null };
    const p = this.player;
    const room = p.aboard;
    const side = this.crossSideOf(room);
    if (!room || !side) return null;
    const pair = this.docking.clamp.crossPair(side);
    if (!pair) return null;
    return {
      across: pair.label,
      theirs: pair.kind === 'peer',
      atDoor: !!this.docking.clamp.crossing(side, p.pos),
      opening: false,
      // A hull whose rooms are not built yet is a crossing that waits, not one that is refused: a
      // reason here is whoever would build them saying they can never be a place at all.
      why: pair.kind === 'peer' ? rooms?.why(pair.id) ?? null : null,
    };
  }

  /** The ship menu's Board row: step across into the rooms of the ship clamped to this one. */
  private boardButton(): void {
    const p = this.player;
    const room = p.aboard;
    const side = this.crossSideOf(room);
    const across = room && side ? this.docking.clamp.crossing(side, p.pos) : null;
    if (!room || !across) return;
    this.shipMenu.hide();
    this.freeMouse(false);
    void this.crossTo(room, across);
  }

  /** The ship menu's docking row: ask for a lane, leave the dock, or break off, whichever it offers. */
  private dockButton(): void {
    const p = this.player;
    // Only whoever is at the controls: a passenger's row is dead, and nothing else may press it.
    const ship = p.mounted ?? p.piloting ?? null;
    if (!ship?.spec.ship) return;
    const said = this.docking.act(ship);
    if (said) this.messages.system(said);
  }

  private freeMouse(free: boolean): void {
    this.input.captured = free;
    if (free) this.input.releaseLock();
    else this.input.requestLock();
  }

  /** B: the spawner, the garage or the NPCs tab; the key toggles the last tab used, a tab click swaps. */
  private toggleSpawner(tab?: 'garage' | 'npcs'): void {
    const want = tab ?? this.spawnerTab;
    const wasOpen = tab === undefined && (this.vehiclesUi.open || this.npcUi.open || this.shipEdit.open);
    this.closePanels();
    this.audio.ui.play(wasOpen ? 'panelClose' : tab !== undefined ? 'select' : 'panelOpen');
    if (wasOpen) {
      this.freeMouse(false);
      return;
    }
    this.spawnerTab = want;
    if (want === 'garage') {
      this.vehiclesUi.show();
      if (!this.garage) void this.loadGarage().then((g) => this.vehiclesUi.attach(g));
      else this.vehiclesUi.attach(this.garage);
    } else {
      this.npcUi.attach(this.spawnerDeps());
      this.npcUi.show();
    }
    this.freeMouse(true);
  }

  /**
   * What the NPC tab spawns from and counts: the whole creature and NPC catalogue through the
   * mobiles (a getter, since it may land after the tab is first opened), and the machines above it.
   * Everything stands ahead of the player, on the floor when inside a building.
   */
  private spawnerDeps(): import('./ui/npcUi').SpawnerDeps {
    return {
      kinds: this.npcKinds(),
      catalogue: () => this.world.mobileCatalogue,
      counts: () => this.world.mobiles?.counts() ?? new Map(),
      live: () => this.world.mobiles?.spawnedOut ?? 0,
      cap: () => this.world.mobiles?.cap ?? this.settings.mobileCap,
      spawn: (entry, n = 1) => {
        const mobiles = this.world.mobiles;
        const cat = this.world.mobileCatalogue;
        if (!mobiles || !cat) return { spawned: 0, note: 'the creature and NPC catalogue has not loaded yet' };
        this.cam.forward(tmp);
        const bounds = lookBounds(entry, cat.file.appearances);
        const scale = entry.size?.scale?.[1] ?? 1;
        const inside = this.world.inside;
        // Indoors it stands a few metres off (a cantina is small), on the floor under that spot.
        const distance = inside ? Math.min(4, spawnDistance(bounds, scale)) : spawnDistance(bounds, scale);
        let r = mobiles.spawnAhead(entry, this.player.pos, tmp, Math.max(1, n), distance, inside);
        // A wall nearer than that (a room's floor ends at its walls): nearer, then at the player's feet.
        for (const d of inside ? [1.5, 0.5] : []) {
          if (r.spawned) break;
          r = mobiles.spawnAhead(entry, this.player.pos, tmp, Math.max(1, n), d, inside);
        }
        return { spawned: r.spawned, note: r.note };
      },
      clear: (filter) => this.world.mobiles?.clear((m) => filter(m.entry)) ?? 0,
      clearAll: () => (this.world.mobiles?.clear() ?? 0) + this.world.npcs.removeAll() + this.world.turrets.removeAll() + (this.world.npcShips?.clear() ?? 0),
      ships: this.shipSpawner(),
      world: this.worldSpawns(),
      clearMachines: () => {
        // What is this browser's own and nobody else's: the machines, the fighters, the NPC ships,
        // and any creature with no name in the world's list. What the world holds is left where it
        // is -- it is asked for over the wire instead (`askClearAll`), so one browser's "Clear all"
        // cannot empty a shared world off its own screen alone.
        const mobiles = this.world.mobiles;
        const mine = mobiles ? mobiles.clear((m) => !mobiles.worldIdOf(m)) : 0;
        return mine + this.world.npcs.removeAll() + this.world.turrets.removeAll() + (this.world.npcShips?.clear() ?? 0);
      },
      missing: `No creature and NPC catalogue yet. It loads at start; if it never does, convert it with ${CATALOGUE_COMMAND}.`,
    };
  }

  /**
   * The world's own rules about standing creatures, when a server is holding them. Nothing appears in
   * a world on its own any more: what is alive there was stood by an admin, and what an admin stands
   * belongs to the world -- so a spawn from the NPC tab is asked for over the wire and what comes back
   * is what is stood, the admin's own browser taking the same path as everybody else's. With no
   * server, or with the relay that came before one, `shared()` is false and the tab stands everything
   * here exactly as it did.
   *
   * It is built once, when the tab is opened, and every question it answers is asked again each time
   * it is put: connecting, disconnecting and being made an admin all happen while the tab is open,
   * and the tab follows the answer rather than the object.
   *
   * The counter the names are made from starts at the wall clock rather than at nought, so a browser
   * that is reloaded cannot give a new creature the name of one it stood before lunch.
   */
  private worldSpawns(): import('./ui/npcUi').WorldSpawns {
    return {
      shared: () => this.net.session.authority === 'server',
      maySpawn: () => this.net.session.isAdmin,
      why: () => 'only the worldÃ¢â‚¬â„¢s admin may stand creatures here',
      ask: (entry, n) => {
        const cat = this.world.mobileCatalogue;
        const mobiles = this.world.mobiles;
        if (!cat || !mobiles) return { spawned: 0, note: 'the creature and NPC catalogue has not loaded yet' };
        // Asked about as one of the world's: the hand-spawn cap is this browser's own limit on what
        // somebody may stand from the tab, and it must never refuse what the world holds.
        const why = mobiles.whyNot(entry, cat, 'world');
        if (why) return { spawned: 0, note: why };
        this.cam.forward(tmp);
        tmp.y = 0;
        tmp.normalize();
        const inside = this.world.inside;
        const bounds = lookBounds(entry, cat.file.appearances);
        const scale = entry.size?.scale?.[1] ?? 1;
        const want = Math.max(1, n);
        const far = inside ? Math.min(4, spawnDistance(bounds, scale)) : spawnDistance(bounds, scale);
        // The same ring a spawn stood here would take (the world's own spot finder is one ray
        // straight down, so asking it the same question `n` times would stack the lot inside each
        // other), and indoors the same two steps back toward the player's feet when a wall is
        // nearer than that.
        let spots = mobiles.spotsAhead(entry, this.player.pos, tmp, want, far, inside);
        for (const d of inside ? [1.5, 0.5] : []) {
          if (spots.length) break;
          spots = mobiles.spotsAhead(entry, this.player.pos, tmp, want, d, inside);
        }
        if (!spots.length) return { spawned: 0, note: inside ? 'there is no floor under that spot' : 'no ground there' };
        let asked = 0;
        for (const spot of spots) {
          const heading = Math.atan2(this.player.pos.x - spot.x, this.player.pos.z - spot.z);
          const rec = recordFor(this.worldKey(), this.net.session.player, this.worldSpawnCount++, entry.id, { x: spot.x, y: spot.y, z: spot.z, heading, inside });
          const why2 = this.askWorldSpawn(rec);
          if (why2) return { spawned: asked, note: why2 };
          asked++;
        }
        return { spawned: asked, note: asked === 1 ? `asked for a ${entry.name}` : `asked for ${asked} ${entry.name}` };
      },
      askClear: (filter) => {
        const mobiles = this.world.mobiles;
        if (!mobiles) return 0;
        let n = 0;
        for (const m of [...mobiles.live]) {
          if (m.origin !== 'spawned' || !filter(m.entry)) continue;
          const id = mobiles.worldIdOf(m);
          if (!id) {
            // One this browser stood for itself (a machine row's creature, or one stood before the
            // server was there): it is nobody else's, so the row's clear takes it down here. Without
            // this the only way to take such a body down is "Clear all".
            mobiles.remove(m);
            n++;
          } else if (!this.askWorldDespawn(id)) n++;
        }
        return n;
      },
      askClearAll: () => !this.askWorldClearAll(),
    };
  }

  /** How many the world has been asked to stand from here; the wall clock so a reload never repeats a name. */
  private worldSpawnCount = Date.now();

  /**
   * The world this browser is standing on, spelled exactly as the server keys its rooms
   * (`roomKey` in `server/rooms.mjs`): the planet, a character no id can hold, and the zone. It has
   * to be spelled the server's way and not ours, because it is what every spawn record the server
   * sends back carries -- and a record is refused unless it names the world it is being stood in,
   * which is the guard that stops a spawn word for the world just left being stood at this one's
   * metres. Spelled as the planet alone, every record the server sent would be refused.
   */
  private worldKey(): string {
    return `${this.world.planet?.id ?? ''}\0${this.zone ?? ''}`;
  }

  /**
   * Ask the server to stand one. The record is this browser's suggestion and nothing is stood by it:
   * what comes back over the wire is what is stood, here as everywhere else. The answer is a word for
   * the player, or '' when the asking went out.
   */
  private askWorldSpawn(rec: SpawnRecord): string {
    return owned.askSpawn(rec.species, [rec.x, rec.y ?? 0, rec.z], rec.heading, rec.seed, rec.id, !!rec.inside);
  }

  /** Ask the server to take one down by the name the world knows it by; '' when the word went out. */
  private askWorldDespawn(id: string): string {
    return owned.askRemove(id);
  }

  /** Ask the server to take down everything this world holds; '' when the word went out. */
  private askWorldClearAll(): string {
    return owned.askClear();
  }

  /**
   * The NPC tab's starships: the combat file's families by faction, stood 700 m ahead of the view (from the flown
   * ship, else the player), facing back; on a planet at least 150 m over the ground (the manager raises them).
   * Built when the tab opens; every call reads the world's manager then, so a travel between is followed.
   */
  private shipSpawner(): ShipSpawner {
    const labels: Record<ShipFaction, string> = { imperial: 'Imperial starships', rebel: 'Rebel starships', blacksun: 'Black Sun starships', pirate: 'Pirate starships', neutral: 'Other starships', player: 'Other starships' };
    const order: ShipFaction[] = ['imperial', 'rebel', 'blacksun', 'pirate', 'neutral'];
    const data = this.world.ships.data;
    return {
      missing: data ? null : "The ships pack has no combat.json (NPC ships and space combat): convert the ships again with npm run swg -- ships '@SWG' assets-private --retail-only",
      families: () => {
        const fams = this.world.ships.data?.families() ?? [];
        return order.map((f) => ({ faction: f, label: labels[f], rows: fams.filter((x) => (x.faction as ShipFaction) === f).map((x) => ({ family: x.family, label: x.name, tiers: x.tiers })) })).filter((g) => g.rows.length);
      },
      // The zone's tier in space (the roster's invented table), 3 on a planet.
      defaultTier: () => (this.world.planet.space ? (ZONE_TIER[this.world.planet.id] ?? 3) : 3),
      spawn: async (family, tier, count) => {
        const mgr = this.world.npcShips;
        if (!mgr) return 'no world to stand them in';
        const p = this.player;
        const flown = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
        const from = (flown ? flown.pos : p.worldPos).clone();
        const dir = this.cam.camera.getWorldDirection(new THREE.Vector3());
        return mgr.spawnFamily(family, tier, count, from, dir);
      },
      clear: (family) => this.world.npcShips?.clear(family ? (s) => s.type.family === family : undefined) ?? 0,
      count: (family) => this.world.npcShips?.count(family) ?? 0,
    };
  }

  /**
   * The HUD's "nearby": the nearest living thing's name within 40 m (a creature, a person, a
   * fighter), else the planet's own species. Read from the world's kept list of the living, which
   * is only rebuilt when something is added or taken away, so this walks a short array a frame.
   */
  private nearbyLabel(at: THREE.Vector3): string {
    let best = 40 * 40;
    let label: string | null = null;
    for (const t of this.world.targets()) {
      if (t.dead || t === this.world.playerTarget) continue;
      const dx = t.pos.x - at.x;
      const dz = t.pos.z - at.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        label = t.label;
      }
    }
    return label ?? this.world.planet.creatures.name;
  }

  /**
   * This planet's creature on the NPC tab: the catalogue's own (its model, clips and brain, with the
   * planet's health, blow and temper) when the catalogue has the species, else the old creature.
   */
  private planetCreatureKind(ahead: (distance: number) => { x: number; z: number; facing: number }): import('./ui/npcUi').NpcKind {
    const def = this.world.planet.creatures;
    const cat = this.world.mobileCatalogue;
    const entry = cat?.resolve(def.name);
    const temper = `${def.aggressive ? 'attacks on sight' : 'wanders, fights back when hit'}; ${def.hp} health`;
    if (cat && entry && cat.ready(entry).ok && this.world.mobiles) {
      return {
        id: 'creature',
        // This row stands a real creature out of the catalogue, so on a world whose creatures the
        // server holds it is the world's and not this browser's: the NPC tab gates it with the rest.
        world: true,
        label: `${def.name} (this planet)`,
        blurb: `${temper}; the catalogue's ${entry.id}`,
        count: () => this.world.mobiles?.count(entry.id) ?? 0,
        spawn: () => {
          this.cam.forward(tmp);
          tmp.y = 0;
          tmp.normalize();
          const inside = this.world.inside;
          const distance = spawnDistance(lookBounds(entry, cat.file.appearances), entry.size?.scale?.[1] ?? 1);
          const spot = this.world.spawnSpot(this.player.pos, tmp, inside ? Math.min(4, distance) : distance, inside);
          if (!spot) return inside ? 'there is no floor under that spot' : 'no ground there';
          const heading = Math.atan2(this.player.pos.x - spot.x, this.player.pos.z - spot.z);
          // The planet's own health, blow and temper, as its wildlife has them; still one stood by hand.
          const got = this.world.mobiles.spawn(entry, { x: spot.x, y: spot.y, z: spot.z, heading }, { inside, overrides: ambientOverrides(def) });
          return typeof got === 'string' ? got : `a ${def.name} ahead (${this.world.mobiles.count(entry.id)} out)`;
        },
        clear: () => this.world.mobiles?.clear((m) => m.entry.id === entry.id) ?? 0,
      };
    }
    return {
      id: 'creature',
      label: def.name,
      blurb: temper,
      count: () => this.world.creatures.creatures.length,
      spawn: () => {
        const p = ahead(12);
        this.world.creatures.spawnAt(p.x, p.z);
        return `a ${def.name} 12 m ahead (${this.world.creatures.creatures.length} out)`;
      },
      clear: () => this.world.creatures.removeAll(),
    };
  }

  /** What the NPC tab can stand in front of the player: a blaster turret, a fighter, and the planet's creature. */
  private npcKinds(): import('./ui/npcUi').NpcKind[] {
    // The grades a fighter can be stood at, named rather than numbered, because a row of bare
    // digits says nothing about what it is choosing. **Nought is the one worth knowing**: it is
    // not the bottom of the ladder but the fighter this game had before there was a ladder --
    // a flat shot clock, no burst, no slide and no cover at all -- so the whole of that work can
    // be stood beside itself in the same tab. `__debug.fighters({ tier: n })` still moves every
    // fighter already out; this picks what the next one is stood at and leaves the rest alone.
    const FIGHTER_TIERS = {
      values: [0, 1, 2, 3, 4, 5],
      start: DEFAULT_TIER,
      label: (t: number) => (t === 0 ? 'before tiers' : ['', 'raw', 'poor', 'fair', 'good', 'deadly'][t] ?? String(t)),
    };
    const ahead = (distance: number) => {
      this.cam.forward(tmp);
      return { x: this.player.pos.x + tmp.x * distance, z: this.player.pos.z + tmp.z * distance, facing: Math.atan2(-tmp.x, -tmp.z) };
    };
    return [
      {
        id: 'turret',
        label: 'Blaster turret',
        blurb: 'turns to face you within 45 m and fires; 120 health, stands again 25 s after it is destroyed',
        count: () => this.world.turrets.turrets.length,
        spawn: () => {
          const p = ahead(20);
          this.world.turrets.place(p.x, p.z, p.facing);
          return `a turret 20 m ahead (${this.world.turrets.turrets.length} out)`;
        },
        clear: () => this.world.turrets.removeAll(),
      },
      this.planetCreatureKind(ahead),
      {
        id: 'fighter',
        label: 'Fighter',
        blurb: 'a humanoid of a random species with a random look and a lightsaber, sword or gun off the rack; fights you and the other fighters; 160 health',
        count: () => this.world.npcs.npcs.filter((n) => !n.dead).length,
        tiers: FIGHTER_TIERS,
        spawn: (tier?: number) => {
          const inside = this.world.inside;
          let x = 0;
          let z = 0;
          let spot: THREE.Vector3 | null = null;
          if (inside) {
            // Inside a building it stands on the floor a few metres ahead, or nearer when a wall is
            // closer than that (a room's floor ends at its walls), in the room it is in.
            for (const d of [3, 1.5, 0.5]) {
              const p = ahead(d);
              spot = this.world.spawnSpot(tmp.set(p.x, this.player.pos.y, p.z), tmp2.set(0, 0, 0), 0, true);
              if (spot) break;
            }
            if (!spot) return 'there is no floor under that spot';
            x = spot.x;
            z = spot.z;
          } else {
            const p = ahead(8 + Math.random() * 4);
            x = p.x + (Math.random() - 0.5) * 4;
            z = p.z + (Math.random() - 0.5) * 4;
          }
          const n = this.world.npcs.spawnAt(x, z, undefined, { ...(spot ? { y: spot.y, inside: true } : {}), ...(tier === undefined ? {} : { tier }) });
          return `a ${n.name} ahead at ${FIGHTER_TIERS.label(n.tier)} (${this.world.npcs.npcs.length} out)`;
        },
        clear: () => this.world.npcs.removeAll(),
      },
    ];
  }

  /** Spawn a vehicle from the garage in front of the player, as its own kind or one chosen for the test. */
  async spawnVehicle(def: VehicleDef, kind?: VehicleKind): Promise<string> {
    // One ship at a time per garage id: it is prepared (and painted) before it stands, which can take a moment.
    // Creatures and speeders spawn as many as are asked for, as before.
    const guard = def.kind === 'ship';
    if (guard && this.spawning.has(def.id)) return `already preparing the ${def.label}`;
    if (guard) this.spawning.add(def.id);
    this.messages.note(`preparing the ${def.label}Ã¢â‚¬Â¦`);
    // The fit the edit page kept in the last few hundred milliseconds is written before it is read.
    this.flushFits();
    try {
      const v = await this.world.spawnVehicle(def, this.player.pos, this.player.heading, kind, false, this.fitFor(def));
      // A fitted ship stood out is the one the others are told of while none is flown.
      if (v.spec.ship && def.fit) this.lastShipDef = def;
      const b = v.spec.bounds;
      const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((n) => n.toFixed(1)).join('Ãƒâ€”');
      this.messages.note(`${def.label}: a ${v.spec.kind}, ${size} m (E to ride)`);
      return `${def.id} spawned as a ${v.spec.kind}: ${size} m at ${v.pos.toArray().map((n) => n.toFixed(1)).join(',')}, ${v.pos.distanceTo(this.player.pos).toFixed(1)} m away, seat ${v.spec.seat.map((n) => n.toFixed(2)).join(',')}, hardpoints: ${v.hardpoints.join(' ') || 'none'}, seated from ${v.seatFrom ?? 'its kind'}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`spawn: ${def.id}:`, err);
      this.messages.system(msg);
      return msg;
    } finally {
      if (guard) this.spawning.delete(def.id);
    }
  }

  /** The garage, loaded once whichever asks first (the panel, the edit page, the world or the console), and the world given the same one. */
  private loadGarage(): Promise<Garage> {
    const have = this.garage ?? this.world.garage;
    if (have) {
      this.garage = have;
      this.world.garage = have;
      return Promise.resolve(have);
    }
    this.garageLoading ??= Garage.load(import.meta.env.BASE_URL).then((g) => {
      // Something else may have loaded one meanwhile (a peer's ride, the world's own spawn): the first stays.
      const keep = this.garage ?? this.world.garage ?? g;
      this.garage = keep;
      this.world.garage = keep;
      this.garageLoading = null;
      return keep;
    });
    return this.garageLoading;
  }

  /** The fit kept with the character for a garage id, or null (stock). Outside the world there is no record. */
  private savedFit(id: string): ShipFit | null {
    return this.current?.ships?.[id] ?? null;
  }

  /** Keep a ship's fit with the character (a stock one is dropped: absent is stock), written on a 300 ms debounce. */
  private saveFit(id: string, fit: ShipFit): void {
    const c = this.current;
    if (!c || this.creating) return;
    const packed = packFit(fit);
    const ships = { ...(c.ships ?? {}) };
    if (!Object.keys(packed.components).length && !Object.keys(packed.paint).length && !packed.droid) delete ships[id];
    else ships[id] = packed;
    c.ships = ships;
    window.clearTimeout(this.fitSaveTimer);
    this.fitSaveTimer = window.setTimeout(() => this.flushFits(), 300);
  }

  /** Write a fit still waiting on the debounce now (closing the page, a spawn, leaving the page). */
  private flushFits(): void {
    if (!this.fitSaveTimer) return;
    window.clearTimeout(this.fitSaveTimer);
    this.fitSaveTimer = 0;
    if (this.current && !this.creating) upsertCharacter(this.current);
  }

  /** A ship's fit as the character keeps it, resolved against its chassis (null for anything without a fit). */
  private fitFor(def: VehicleDef): ResolvedFit | null {
    if (!def.fit) return null;
    const g = this.world.garage ?? this.garage;
    return g?.resolve(def, this.savedFit(def.id)) ?? null;
  }

  /** The garage's edit button: the page, over the world, with the mouse free. */
  private openShipEdit(def: VehicleDef): void {
    this.closePanels();
    void this.shipEdit.show(def).catch((err) => console.warn(`ship edit: ${def.id}`, err));
    this.freeMouse(true);
  }

  /**
   * The edit page closed: the fit written, every spawned ship of that id refitted in place (parts
   * staged, compiled and painted before one swap), and the others told once (the hello's debounce)
   * when it is the ship this player is known by.
   */
  private async refitSpawned(def: VehicleDef): Promise<void> {
    this.flushFits();
    const next = this.fitFor(def);
    // Leaving the world refits nothing: its vehicles are about to go. A character switch closes the panels
    // first and leaves the world in the same step, so the check waits that step out.
    await Promise.resolve();
    if (next && this.inWorld && !this.traveling) {
      const key = fitKey(next);
      for (const v of [...this.world.vehicles]) {
        // An NPC ship's def is a copy of the garage hull's: it keeps its own tier fit, never the player's.
        if (v.autopilot || v.def?.id !== def.id || !v.fit || fitKey(v.fit) === key || !this.world.vehicles.includes(v)) continue;
        try {
          // After any refit of this ship still in flight, to the fit kept when its turn comes.
          await this.queueRefit(v, async () => {
            const now = this.fitFor(def);
            if (!now || !v.fit || fitKey(v.fit) === fitKey(now) || !this.world.vehicles.includes(v)) return;
            const r = await this.world.refitVehicle(v, now);
            if (r.waiting.length) console.info(`ship edit: ${def.id}: waiting for a mount: ${r.waiting.join('; ')}`);
          });
        } catch (err) {
          console.warn(`ship edit: ${def.id}: the spawned ship could not be refitted`, err);
        }
      }
    }
    if (def.id === this.helloShipId) this.queueHello();
  }

  /**
   * Run a refit of one spawned ship after any still in flight for it. `Garage.refit` stages from the ship's
   * fit as it stands and only sets the new one at the swap, so two staged from the same fit could leave the
   * model showing one part and `v.fit` naming another; one after the other, each starts from the last.
   */
  private queueRefit<T>(v: Vehicle, work: () => Promise<T>): Promise<T> {
    const before = this.refitting.get(v) ?? Promise.resolve();
    const run = before.catch(() => {}).then(work);
    this.refitting.set(v, run);
    void run
      .catch(() => {})
      .finally(() => {
        if (this.refitting.get(v) === run) this.refitting.delete(v);
      });
    return run;
  }

  /** The ship this player is known by on the relay: the one ridden, flown or aboard, else the last fitted one stood out or flown, with its fit. */
  private helloShip(): { id: string; fit: ShipFit } | undefined {
    const p = this.player;
    const v = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
    const def = v?.def?.fit ? v.def : this.lastShipDef?.fit ? this.lastShipDef : null;
    if (!def) return undefined;
    return { id: def.id, fit: packFit(this.savedFit(def.id) ?? stockFit()) };
  }

  /** The ship ridden, flown or boarded, else the nearest ship spawned, for the console. */
  private nearShip(): Vehicle | null {
    const p = this.player;
    const own = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
    if (own?.spec.ship) return own;
    let best: Vehicle | null = null;
    let bestD = Infinity;
    for (const v of this.world.vehicles) {
      if (!v.spec.ship || v.autopilot) continue;
      const d = v.pos.distanceTo(p.worldPos);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  /** Up to `n` drawn frames (a hidden tab draws none: the wait ends after `timeoutMs`); how many were seen. */
  private waitFrames(n: number, timeoutMs = 2000): Promise<number> {
    return new Promise((resolve) => {
      let seen = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(seen);
      };
      const step = () => {
        if (done) return;
        if (++seen >= n) finish();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      window.setTimeout(finish, timeoutMs);
    });
  }

  /**
   * Run a refit or repaint of a ship and count the programs made by its swap over the two frames after it.
   * `compiledOnSwap` counts only the new programs that belong to what the ship draws (its model, parts,
   * glows and trails): a change of gun also warms the new bolt's fire and hit effects far below the world
   * (`World.warmShipFx`), which compile on those same frames and are the warm-up doing its work, not the
   * swap; they are in `programsAfter - programsBefore` and `warmed` says a warm-up was started.
   */
  private async measureSwap<T>(v: Vehicle, work: () => Promise<T>): Promise<{ report: T; programsBefore: number; programsAfter: number; compiledOnSwap: number; warmed: boolean; frames: number }> {
    const report = await work();
    const r = this.renderer;
    const programsBefore = r.info.programs?.length ?? 0;
    const known = new Set(r.info.programs ?? []);
    const frames = await this.waitFrames(2);
    const programsAfter = r.info.programs?.length ?? 0;
    // The ship's materials now (the swap's parts, the paint's copies, the glows and the trails' ribbons).
    const mats = new Set<THREE.Material>();
    const collect = (o: THREE.Object3D) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) mats.add(x);
    };
    v.group.traverse(collect);
    for (const t of v.trails) t.mesh.traverse(collect);
    const made = new Set<unknown>();
    for (const m of mats) {
      if (!r.properties.has(m)) continue;
      const programs = (r.properties.get(m) as { programs?: Map<string, unknown> }).programs;
      for (const p of programs?.values() ?? []) if (!known.has(p as THREE.WebGLProgram)) made.add(p);
    }
    const warmed = !!(report as { weaponsChanged?: boolean } | null)?.weaponsChanged;
    return { report, programsBefore, programsAfter, compiledOnSwap: made.size, warmed, frames };
  }

  /** The console's refit: a slot's component ('' empties it) or the droid, kept with the character, on the ship ridden (else the nearest). */
  private async debugRefit(slot: string, component: string): Promise<unknown> {
    const v = this.nearShip();
    const def = v?.def;
    if (!v || !def?.fit || !v.fit) return v ? `${v.spec.id} has no fit (a pack converted before ship customization)` : "no ship: spawn one (spawn('xwing')) or board one";
    const s = slot === 'droid' ? null : def.fit.slots.find((x) => x.slot === slot);
    if (slot !== 'droid' && (!s || s.fixed)) return `${def.id} has no slot ${slot} to fit; its slots: ${def.fit.slots.filter((x) => !x.fixed).map((x) => x.slot).join(', ')}, droid`;
    const fit = copyShipFit(this.savedFit(def.id) ?? stockFit());
    if (slot === 'droid') {
      if (component) fit.droid = component;
      else delete fit.droid;
    } else if (component === (s!.stock ?? '')) delete fit.components[slot];
    else fit.components[slot] = component;
    this.saveFit(def.id, fit);
    this.flushFits();
    const next = this.fitFor(def);
    if (!next) return 'the garage is not loaded';
    // After any refit of this ship still in flight (the page's close, an earlier call).
    const out = await this.queueRefit(v, () => this.measureSwap(v, () => this.world.refitVehicle(v, this.fitFor(def) ?? next)));
    // The other spawned ships of that id follow, and the others are told.
    void this.refitSpawned(def);
    return { ...out, fitted: slot === 'droid' ? next.droid : (next.components[slot] ?? null), notes: next.notes };
  }

  /** The console's repaint: paint values kept with the character (a repaint in place), or each shader's own texture ('static') and back ('custom'). */
  private async debugPaint(values: Record<string, number> | 'static' | 'custom'): Promise<unknown> {
    const v = this.nearShip();
    const def = v?.def;
    if (!v || !def?.fit || !v.fit) return v ? `${v.spec.id} has no fit (a pack converted before ship customization)` : "no ship: spawn one (spawn('xwing')) or board one";
    if (!v.paint || !def.fit.paint) return `${def.id}'s paint is fixed in the game: its shaders take no colours`;
    const paint = v.paint;
    if (values === 'static' || values === 'custom') return this.queueRefit(v, () => this.measureSwap(v, () => paint.showStatic(values === 'static')));
    const fit = copyShipFit(this.savedFit(def.id) ?? stockFit());
    for (const [k, n] of Object.entries(values)) fit.paint[k] = n;
    this.saveFit(def.id, fit);
    this.flushFits();
    const next = this.fitFor(def);
    if (!next) return 'the garage is not loaded';
    const out = await this.queueRefit(v, () => this.measureSwap(v, () => this.world.refitVehicle(v, this.fitFor(def) ?? next)));
    void this.refitSpawned(def);
    return { ...out, paint: next.paint, painted: next.painted, custom: paint.custom };
  }

  /** The console's view of a fit: a spawned ship's as it stands (parts hung, waiting, guns), or a garage id's stock. */
  private async shipFitReport(id?: string): Promise<unknown> {
    const g = await this.loadGarage();
    const describe = (def: VehicleDef, fit: ResolvedFit) => {
      const fd = def.fit!;
      const labelOf = (name: string | null | undefined) => (name ? (g.components[g.componentByName.get(name) ?? -1]?.label ?? name) : null);
      return {
        chassis: fd.chassis,
        slots: fd.slots.filter((s) => !s.fixed).map((s) => ({ slot: s.slot, label: slotLabel(s), component: fit.components[s.slot] ?? null, name: labelOf(fit.components[s.slot]), look: fit.looks[s.slot] ?? -1, looks: s.looks.length, stock: s.stock })),
        fixed: fd.slots.filter((s) => s.fixed).length,
        droid: fit.droid,
        socket: fd.droid,
        paint: fit.paint,
        painted: fit.painted,
        notes: fit.notes,
      };
    };
    if (id) {
      const def = g.find(id);
      if (!def) return `no vehicle matches ${id}`;
      if (!def.fit) return `${def.id} has no fit in this pack (converted before ship customization): npm run swg -- ships @SWG assets-private --retail-only`;
      const stock = g.resolve(def, null);
      if (!stock) return `${def.id}: the garage could not resolve its fit`;
      const parts = partsOf(def.fit, def.id, stock, g.droids);
      return { ship: def.id, fit: 'stock', ...describe(def, stock), parts: parts.map((p) => `${p.slot}: ${p.path.replace(/^.*\//, '')} on ${p.hardpoint || 'the origin'}`), partCount: parts.length, kept: this.savedFit(def.id) };
    }
    const v = this.nearShip();
    if (!v) return "no ship: spawn one, board one, or give a garage id (shipFit('xwing'))";
    const def = v.def;
    if (!def?.fit || !v.fit) return `${v.spec.id} has no fit (a pack converted before ship customization)`;
    const parts: string[] = [];
    for (const [slot, roots] of v.build?.fitParts ?? []) for (const r of roots) parts.push(`${slot}: ${r.name || r.userData.name || '(part)'}`);
    return {
      ship: def.id,
      fit: 'spawned',
      ...describe(def, v.fit),
      parts,
      partCount: parts.length,
      pending: (v.build?.pending ?? []).map((p) => `${p.slot}: ${p.label} waits for hardpoint ${p.hardpoint}`),
      custom: v.paint?.custom ?? false,
      guns: v.guns.map((gun) => ({ slot: gun.slot ?? null, hardpoint: gun.hardpoint ?? null, weapon: (gun.weapon ?? v.weapon)?.name ?? null, projectile: (gun.weapon ?? v.weapon)?.projectile ?? null, live: !!gun.node?.parent })),
      kept: this.savedFit(def.id),
    };
  }

  /** Put a weapon from the rack in a hand (null empties it), switching to the kit that fights with it. */
  async equip(def: WeaponDef | null, hand: 'right' | 'left'): Promise<string> {
    if (!def) return this.equipment.stow(hand);
    if (!this.weapons) return 'no weapons converted';
    // Through the equipment: the hands' rules, the model compiled before it is in hand, and the weapon given.
    const r = await this.equipment.hold(def, hand, { give: true });
    if (r.wants && r.wants !== this.kit.id) this.setClass(r.wants);
    if (r.note !== 'dropped') this.messages.note(r.wants ? `${r.note} (${def.class}, ${this.player.saber.style})` : r.note);
    return r.note;
  }

  /** I: the inventory (the backpack, the appearance, the skills and the give tabs); the key toggles the last tab used, a tab click swaps. */
  private toggleInventory(tab?: InventoryTab): void {
    if (this.creating) {
      if (tab === 'appearance' || tab === 'wardrobe') this.showCreatorTab(tab);
      return;
    }
    const want = tab ?? this.inventoryTab;
    const wasOpen = tab === undefined && (this.backpack.open || this.wardrobe.open || this.appearanceUi.open || this.weaponsUi.open || this.forceUi.open);
    this.closePanels();
    // The backpack's own open and close, from the game's interface table.
    this.audio.ui.play(wasOpen ? 'panelClose' : tab !== undefined ? 'select' : 'panelOpen');
    if (wasOpen) {
      this.freeMouse(false);
      return;
    }
    this.inventoryTab = want;
    const character = this.player.rig?.character ?? null;
    if (want === 'backpack') {
      this.backpack.show();
      void this.refreshBackpack();
    } else if (want === 'wardrobe') {
      // In the world the Clothes tab is a developer's give tool.
      this.wardrobe.developer = true;
      this.wardrobe.show();
      if (character) void this.wardrobe.attach(character, import.meta.env.BASE_URL).catch((err) => console.warn('wardrobe', err));
      else this.wardrobe.explain('This character is a single model, not a set of parts, so there is nothing to change. Convert it with <code>npm run swg -- parts</code>.');
    } else if (want === 'appearance') {
      this.appearanceUi.show();
      if (character) this.appearanceUi.attach(character, import.meta.env.BASE_URL);
      else this.appearanceUi.explain('This character is a single model, not a set of parts, so there is nothing to shape. Convert it with <code>npm run swg -- species</code>.');
    } else if (want === 'force') this.showSkills();
    else {
      this.weaponsUi.held = { right: this.player.equipped.right?.id ?? null, left: this.player.equipped.left?.id ?? null };
      this.weaponsUi.show();
    }
    this.freeMouse(true);
  }


  private toggleMap(): void {
    if (this.map.open) {
      this.map.hide();
      this.input.captured = false;
      this.input.requestLock();
    } else {
      this.map.show();
      this.input.captured = true;
      this.input.releaseLock();
    }
  }

  /**
   * E in a lift shaft (a room the building or ship names for its elevator): the lift menu, the
   * levels the shaft reaches by the rooms they open into; at an elevator terminal: up for an up
   * terminal, down for a down one, up then down for a plain one; beside a building that cannot
   * be walked into: inside it.
   */
  private handleElevator(): boolean {
    const p = this.player;
    const lift = this.liftHere();
    if (lift) {
      this.liftNow = lift;
      this.closePanels();
      this.map.hide();
      this.liftMenu.show(lift.title, lift.stops.map((s, i) => ({ label: stopLabel(lift.stops, i), current: i === lift.current })));
      this.freeMouse(true);
      return true;
    }
    if (p.aboard) return false;
    const near = this.world.elevatorsNear(p.pos, MOUNT_RANGE);
    if (near.length) {
      const kind = near[0].kind;
      const tryDir = (up: boolean) => {
        const next = this.world.useElevator(p.pos, up);
        if (!next) return false;
        p.reset(next);
        this.physics.stepOnce();
        return true;
      };
      if (kind === 'up') tryDir(true);
      else if (kind === 'down') tryDir(false);
      else if (!tryDir(true)) tryDir(false);
      return true;
    }
    if (this.world.doorlessNear(p.pos)) {
      const at = this.world.enterDoorless(p.pos);
      if (at) {
        p.pos.copy(at);
        p.vel.set(0, 0, 0);
        this.physics.stepOnce();
      }
      return true;
    }
    return false;
  }

  /**
   * E at one of the gates a world's zones are walked between: through it, to the zone the pack says
   * it opens on. Deliberately the last thing E can mean and the first thing a fight takes away Ã¢â‚¬â€
   * the lift, the elevator and the way into a building have already had the key by the time this is
   * called, a vehicle or another player's hull within reach keeps it here, and the gate stands
   * aside for a few seconds after any blow, so a fight beside one cannot end in another zone by
   * accident.
   *
   * A gate the converter would not name a destination for says so and does nothing, which the
   * conversion run prints too: it is the honest answer where the archives do not say where a gate
   * leads.
   */
  private handleZoneGate(): boolean {
    const p = this.player;
    // The same "on foot in the world" the gather works out: riding, at a bridge's controls, in a
    // ship's rooms or on its skin in the boots (both of which are `aboard`), adrift, or flying free.
    if (p.mounted || p.piloting || p.aboard || p.eva || p.noclip) return false;
    const at = p.worldPos;
    const near = this.zoneGates.nearest(at.x, at.y, at.z);
    if (!near) return false;
    const act = gateAction({
      live: !this.traveling && !this.dying,
      onFoot: true,
      free: !this.nearestVehicle() && !peerRooms()?.nearest(p.pos, BOARD_TUNE.reach),
      since: this.zoneGates.since(this.world.simTime),
      d: near.d,
      to: !!near.gate.to,
    });
    if (act === 'none') return false;
    if (act === 'nowhere' || !near.gate.to) {
      this.messages.system('this gate leads nowhere the pack names');
      return true;
    }
    const dest = zoneOfPack(near.gate.to);
    if (!dest) {
      this.messages.system(`this gate opens on ${near.gate.to}, which this build has no world for`);
      return true;
    }
    this.messages.system(`through the gate to ${near.gate.label ?? dest.zone.name}`);
    void this.travel(dest.planet, dest.zone.id);
    return true;
  }

  /** The lift shaft the player stands in, in a building or aboard a ship, with its stops. */
  private liftHere(): { stops: LiftStop[]; current: number; title: string } | null {
    const p = this.player;
    return p.aboard ? p.aboard.liftHere(p.pos) : this.world.liftHere(p.pos);
  }

  /** The lift the menu was opened for. */
  private liftNow: { stops: LiftStop[]; current: number; title: string } | null = null;

  /** A stop picked in the lift menu: the player steps out through that level's doorway. */
  private rideLift(index: number): void {
    const lift = this.liftNow;
    const p = this.player;
    const stop = lift?.stops[index];
    this.liftMenu.hide();
    this.freeMouse(false);
    if (!stop) return;
    const next = p.aboard ? p.aboard.rideLift(stop) : this.world.rideLift(stop);
    if (!next) return;
    // Which way the car went, before the player is moved: the level picked against the one they
    // stood at. A stop at the level they are already on is a step out, and is silent.
    const from = lift?.stops[lift.current]?.level;
    p.pos.copy(next);
    p.vel.set(0, 0, 0);
    if (from !== undefined && Math.abs(stop.level - from) > vehicleSounds.tune.liftLevel) {
      // Aboard, the place is in the hull's frame: the sound belongs where the player now stands.
      const at = p.aboard ? p.aboard.toWorld(p.pos, liftAt) : liftAt.copy(p.pos);
      vehicleSounds.lift(stop.level > from, at.x, at.y, at.z, this.listenerPose.space);
    }
    if (!p.aboard) this.physics.stepOnce();
  }

  private handleMount(): void {
    const p = this.player;
    if (isSurfaceRoom(p.aboard)) {
      // Standing on a surface: E climbs into a ship within arm's reach, and takes the boots off otherwise.
      const near = this.reachFromBoots();
      this.leaveShip(false);
      if (near?.interior) this.boardShip(near);
      else if (near) {
        p.mount(near);
        if (near.spec.ship && near.def) this.lastShipDef = near.def;
        this.cam.distance = Math.max(this.cam.distance, 9.5);
      }
      return;
    }
    if (p.aboard) {
      const room = p.aboard;
      const v = room.vehicle;
      if (p.piloting) {
        // Letting go of the controls, in flight too: the ship carries on as it was (there is no
        // landing place in space), and the room stays a still room around whoever is aboard.
        p.piloting = null;
        return;
      }
      // Which hull this is: one of this world's, or one another player flies. Read before the
      // controls, because you do not fly somebody else's ship -- aboard theirs there is no spot to
      // take the controls at, only the way in and the way out, and the hull the rooms name there is a
      // stand-in nothing in this browser flies.
      const side = this.crossSideOf(room);
      if (side?.kind !== 'peer' && room.pilotSpot && p.pos.distanceTo(room.pilotSpot) < CONTROLS_RANGE) {
        p.piloting = v;
        this.cam.zoomTarget = Math.max(this.cam.zoomTarget, 6);
        this.messages.note(`at the controls of the ${v.spec.label}`);
        return;
      }
      // The two hulls are clamped together and this walker stands at the room's own way in: E crosses
      // into the other ship's rooms rather than stepping out of a door that opens onto the hull it
      // rides. Either hull may be one another player flies. Anywhere else in the room E steps out as
      // it always did.
      const across = side && this.docking.clamp.crossing(side, p.pos);
      if (across) {
        void this.crossTo(room, across);
        return;
      }
      this.leaveShip(false);
      return;
    }
    if (p.mounted) {
      this.dismountBeside(p.mounted);
      return;
    }
    let best = null;
    let bestD = MOUNT_RANGE;
    for (const sp of this.world.vehicles) {
      const d = this.vehicleReach(sp);
      if (d < bestD) {
        bestD = d;
        best = sp;
      }
    }
    if (best?.interior) {
      this.boardShip(best);
      return;
    }
    if (best?.upsideDown) {
      // On its back: E turns it over rather than climbing on.
      best.rightSelf();
      this.physics.stepOnce();
      return;
    }
    if (best) {
      p.mount(best);
      if (best.spec.ship && best.def) this.lastShipDef = best.def;
      this.cam.distance = Math.max(this.cam.distance, 9.5);
      return;
    }
    // Nothing of this world's within reach, but a hull another player flies may be: E boards it, which
    // builds their rooms here the first time. A hull of our own always wins, so nothing about walking
    // up to your own ship changes, and with nobody building peers' rooms this answers 0 and the boots
    // below are what E does, exactly as before.
    const near = peerRooms()?.nearest(p.pos, BOARD_TUNE.reach) ?? 0;
    if (near) {
      void this.boardPeerShip(near);
      return;
    }
    // Nothing to climb into, and out in space: the gravity boots take hold of whatever is within reach.
    if (this.world.planet.space && p.eva) this.bootsTake(null);
  }

  /** A note the boots left (why they would not take hold), shown in the prompt for a moment. */
  private bootsNote = '';
  private bootsNoteAt = 0;
  /**
   * Why a landing was refused is a state string the hull rewrites every step, not an event: what was
   * said last is kept here so it is said once when it changes. Without this it lives only inside the
   * long prompt, which is behind a setting.
   */
  private landNoteSaid = '';

  /** The vehicle within arm's reach of someone standing on a surface, measured in the world, since `pos` is the room's there. */
  private reachFromBoots(): Vehicle | null {
    const at = this.player.worldPos;
    let best: Vehicle | null = null;
    let bestD = MOUNT_RANGE;
    for (const sp of this.world.vehicles) {
      if (sp.autopilot) continue;
      const d = at.distanceTo(sp.pos) - sp.radius;
      if (d < bestD) {
        bestD = d;
        best = sp;
      }
    }
    return best;
  }

  /**
   * Switch the gravity boots on: whatever is nearest along the ways looked (what `toward` says first, then
   * where the camera points, then the six ways out of the figure itself) becomes the ground, and the figure
   * stands on it with that face's own up. It holds to anything solid, a rock, a station or a hull, and to one
   * that moves as readily as to one that does not, since the room is read from what it stands on every step.
   */
  private bootsTake(toward: THREE.Vector3 | null, from?: THREE.Vector3): boolean {
    const p = this.player;
    if (p.aboard || p.mounted || p.noclip || this.dying) return false;
    const note = (why: string): false => {
      this.bootsNote = why;
      this.bootsNoteAt = performance.now();
      // Said once, where it can be read: interpolated into the long prompt it is behind a setting,
      // and with that setting off why the boots would not hold had nowhere on the screen to go.
      this.messages.system(why);
      return false;
    };
    if (!this.world.planet.space) return note('the boots only hold where there is no gravity');
    // The room is a room of a hull's: the ship stood beside, or the nearest one in the zone.
    const ship = this.reachFromBoots() ?? [...this.world.vehicles].filter((v) => !v.autopilot).sort((a, b) => a.pos.distanceToSquared(p.worldPos) - b.pos.distanceToSquared(p.worldPos))[0];
    if (!ship) return note('no ship out here to boot from');
    // The look starts at the waist, away from the face being looked for, so a ray never starts inside it.
    const at = bootAt.copy(from ?? p.worldPos);
    if (toward) at.addScaledVector(bootScratch[0].copy(toward).normalize(), -SURFACE_ROOM.waist);
    else at.addScaledVector(bootScratch[0].set(0, 1, 0).applyQuaternion(p.group.quaternion), SURFACE_ROOM.waist);
    let best: { d: number } | null = null;
    bootDir.length = 0;
    if (toward) bootDir.push(bootScratch[1].copy(toward));
    this.cam.camera.getWorldDirection(bootScratch[8]);
    bootDir.push(bootScratch[8]);
    for (let i = 0; i < 6; i++) {
      const v = bootScratch[i + 2].set(i === 0 ? 1 : i === 1 ? -1 : 0, i === 2 ? 1 : i === 3 ? -1 : 0, i === 4 ? 1 : i === 5 ? -1 : 0);
      bootDir.push(v.applyQuaternion(p.group.quaternion));
    }
    for (let i = 0; i < bootDir.length; i++) {
      const dir = bootDir[i];
      const hit = probeSurface(this.physics, at, dir, SURFACE_ROOM.reach, p.body);
      if (!hit || (best && hit.distance >= best.d)) continue;
      best = { d: hit.distance };
      bootPoint.copy(hit.point);
      bootUp.copy(hit.normal);
      bootBody = hit.body;
      // The way that was asked for wins outright rather than only by being nearest: a pilot climbing out is
      // looking along their hull's own down, and what the ship stands on is what they should stand on, even
      // though the hull they just left is nearer to them than the rock under it.
      if (i === 0 && toward) break;
    }
    if (!best) return note(`nothing within ${Math.round(SURFACE_ROOM.reach)} m to stand on`);
    const gravity = -this.physics.world.gravity.y;
    const room = SurfaceRoom.take(this.physics, bootPoint, bootUp, bootBody, ship, gravity, ship.body.isValid() ? ship.body : null);
    if (!room) return note('nothing there the boots can hold to (no surface was found in it)');
    this.postfx?.reset();
    p.board(room, room.entry.clone());
    this.cam.zoomTarget = Math.min(this.cam.zoomTarget, SURFACE_ROOM.zoom);
    this.bootsNote = '';
    return true;
  }

  /** Off the vehicle onto the floor beside it (in space, adrift beside it with its motion). */
  private dismountBeside(sp: Vehicle): void {
    // A frameless hull hidden by the cockpit or the flight chase must not stay hidden once no one is in it.
    sp.group.visible = true;
    const p = this.player;
    sp.quaternion(tmpQ);
    tmp.set(-(sp.spec.bounds.max[0] - sp.spec.bounds.min[0]) / 2 - 1.0, 0, 0).applyQuaternion(tmpQ).add(sp.pos);
    // A machine on its back has its side vector pointing down: beside it along the ground instead.
    if (sp.upsideDown) tmp.set(sp.pos.x + Math.cos(sp.heading) * (sp.radius + 1), sp.pos.y, sp.pos.z - Math.sin(sp.heading) * (sp.radius + 1));
    // The floor beside the vehicle, by a ray from its own height: in a hangar that is the
    // hangar's floor, not the terrain under the building, which put the rider outside it.
    const from = sp.pos.y + 0.5;
    if (this.world.planet.space) {
      // Out into space: beside the hull where it is, carrying its motion, adrift.
      tmp.y = sp.pos.y;
      p.dismount(tmp);
      const lv = sp.body.linvel();
      p.vel.set(lv.x, lv.y, lv.z);
      // Out of a ship set down on something: the boots take hold of it, so the pilot stands on it rather
      // than floating off the moment they climb out. The hull's own down is the way to look first.
      if (sp.landed) {
        sp.quaternion(tmpQ);
        this.bootsTake(tmp2.set(0, -1, 0).applyQuaternion(tmpQ), tmp);
      }
      return;
    }
    const hit = this.physics.groundDistance(tmp.x, from, tmp.z, 12, sp.body);
    tmp.y = hit !== null ? from - hit + 0.15 : Math.max(this.world.terrain.heightAt(tmp.x, tmp.z), this.world.terrain.waterLevel - 1) + 0.3;
    p.dismount(tmp);
  }

  /**
   * Which hull a room belongs to, as the clamp names hulls: one of this world's, or one another
   * player flies. Null for a surface the boots hold to, which is nobody's rooms.
   */
  private crossSideOf(room: WalkableRoom | null | undefined): CrossSide | null {
    if (!room || isSurfaceRoom(room)) return null;
    const id = peerRooms()?.idOf(room) ?? 0;
    return id ? { kind: 'peer', id } : { kind: 'ship', ship: room.vehicle };
  }

  /** The picture of the ride each other player is on, refilled by the peers themselves. Nothing but the boarding questions reads it. */
  private readonly peerHulls = new Map<number, THREE.Object3D | null>();
  /** Scratch for the walk of the peers, so asking every frame allocates nothing. */
  private readonly peerHullIds: number[] = [];

  /**
   * Whether the ride that player is on is a hull with rooms in it at all. The picture says which
   * vehicle it is and the garage says whether that one has rooms, which is the same test whoever
   * builds them makes -- they are the authority and refuse for themselves, but a question asked
   * before anything is built keeps the action bar from offering to board a speeder bike.
   */
  private peerHullRooms(id: number): boolean {
    const picture = this.peerHulls.get(id);
    const vehicleId = typeof picture?.userData.vehicleId === 'string' ? (picture.userData.vehicleId as string) : '';
    if (!vehicleId) return false;
    // A peer's picture was built by the garage, so by the time there is one the garage is loaded.
    const def = this.world.garage?.find(vehicleId);
    return !!def && (!!def.interior || (def.cells ?? []).some((c) => c.index > 0));
  }

  /**
   * The player whose hull's side is nearest this point and within `range` of it, or 0. A hull of this
   * world always wins before this is asked, so nothing about walking up to your own ship changes, and
   * with no relay there are no peers and this is one walk of an empty list.
   */
  private nearestPeerHull(at: THREE.Vector3, range: number): number {
    let best = 0;
    let bestD = range;
    for (const id of this.remotes.shipPeers(this.peerHullIds)) {
      if (!this.peerHullRooms(id)) continue;
      const info = this.remotes.vehicleOf(id);
      if (!info || !this.remotes.vehiclePose(id, peerAt, peerTurn, peerVel)) continue;
      const d = at.distanceTo(peerAt) - info.radius;
      if (d >= bestD) continue;
      bestD = d;
      best = id;
    }
    return best;
  }

  /**
   * Why that player's hull is not somewhere to stand, in words, or null when it is -- or will be once
   * it has been asked for, which is what the crossing's own wait is about. Only a hull that can never
   * be one is a refusal here.
   */
  private peerHullWhy(id: number): string | null {
    if (this.world.remoteRooms().roomOf(id)) return null;
    if (!this.remotes.vehicleOf(id)) return 'their ship is not here';
    if (!this.peerHullRooms(id)) return 'there are no rooms in their ship to stand in';
    return null;
  }

  /**
   * A crossing asked for and still being made ready: the hull it is into, so the row says so and a
   * second press does not ask twice. 0 when nothing is being made ready.
   */
  private crossingTo = 0;

  /**
   * Their rooms, built and made ready, or null when that takes longer than boarding is prepared to
   * wait for. A build is a load and a compile a drawable at a time, and a hidden tab compiles as it
   * polls, so the wait is generous; a build that lands after it is given back rather than left open.
   * `crossingTo` is held for the whole of it, so a second press asks nothing twice.
   */
  private async roomsOf(rooms: PeerRooms, id: number): Promise<WalkableRoom | null> {
    this.crossingTo = id;
    let timer = 0;
    const gaveUp = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), BOARD_TUNE.wait * 1000);
    });
    const job = rooms.open(id);
    try {
      const room = await Promise.race([job, gaveUp]);
      // Given back when it lands, not now: a build still running has nothing to close, and one closed
      // that way would finish afterwards and leave a room standing that nobody had asked for.
      if (!room) {
        void job.then(
          (late) => {
            if (late) rooms.close(id);
          },
          () => {},
        );
      }
      return room;
    } finally {
      window.clearTimeout(timer);
      this.crossingTo = 0;
    }
  }

  /**
   * Out of one clamped ship's rooms and into the other's, at its way in, whoever flies either of them.
   * A hull another player flies is only rooms once this browser has built them, which is a load and a
   * compile: the first crossing into one waits for that, and everything is asked again afterwards,
   * because a second or two is long enough for the pair to have come apart or the walker to have died.
   *
   * The body leaves the room it was in before it is put in the next (`Player.board` does that itself),
   * so it is never left in a physics world nothing steps; a flame held in the old hull's frame goes
   * out with it.
   */
  private async crossTo(from: WalkableRoom, to: CrossTo): Promise<void> {
    const p = this.player;
    const rooms = peerRooms();
    let room = to.kind === 'ship' ? to.ship.interior : rooms?.roomOf(to.id) ?? null;
    if (!room && to.kind === 'peer') {
      if (!rooms || this.crossingTo) return;
      this.messages.note(`building the rooms of the ${to.label}Ã¢â‚¬Â¦`);
      room = await this.roomsOf(rooms, to.id);
      // The wait is a second or two of real play: the walker may have stepped out, died or travelled,
      // and the two hulls may have come apart. Everything is asked again rather than assumed -- the
      // room itself included, since one built and then taken down between the two lines would be a
      // physics world that is gone.
      const side = this.crossSideOf(p.aboard);
      const still = side && this.docking.clamp.crossPair(side);
      if (!room || rooms.roomOf(to.id) !== room || p.aboard !== from || this.dying || this.traveling || !still || still.kind !== 'peer' || still.id !== to.id) {
        this.messages.system(rooms.why(to.id) ?? `the ${to.label} is no longer there to cross into`);
        if (room) rooms.close(to.id);
        return;
      }
    }
    if (!room) return;
    const leaving = rooms?.idOf(from) ?? 0;
    const entering = to.kind === 'peer' ? to.id : 0;
    // The camera steps from one hull's frame into another's: the effects have no history across it.
    this.postfx?.reset();
    (this.kits.bounty_hunter as BountyHunterKit | undefined)?.coolDown();
    // The room stepped into is shown first, then the body moves (`board` takes it out of the old
    // room's own physics), and only then is the room stepped out of told that nobody is in it --
    // which for a hull another player flies is also what lets it be taken down.
    if (entering && rooms) rooms.aboard(entering, true);
    else room.reveal(true);
    p.board(room, room.entry.clone());
    if (leaving && rooms) rooms.aboard(leaving, false);
    else from.reveal(false);
    this.cam.zoomTarget = Math.min(this.cam.zoomTarget, 4);
    this.messages.note(`across in the ${to.label}: E at the way in crosses back, E anywhere else steps out`);
  }

  /**
   * Step into the rooms of a ship another player flies, from outside it. Their hull is a picture until
   * this is asked for: the rooms are built, prepared and compiled before anything is shown, so the
   * first boarding of a hull waits a second or two and every one after it is at once.
   *
   * Everything is asked again after the wait: the walker may have mounted something, boarded something
   * else, died or travelled while their rooms were being built.
   */
  private async boardPeerShip(id: number): Promise<void> {
    const rooms = peerRooms();
    const p = this.player;
    if (!rooms || this.crossingTo) return;
    let room = rooms.roomOf(id);
    if (!room) {
      this.messages.note(`building the rooms of the ${rooms.label(id)}Ã¢â‚¬Â¦`);
      room = await this.roomsOf(rooms, id);
      if (!room) {
        this.messages.system(rooms.why(id) ?? 'their ship is not somewhere to stand just now');
        return;
      }
      if (p.aboard || p.mounted || this.dying || this.traveling || rooms.nearest(p.pos, BOARD_TUNE.reach) !== id) {
        this.messages.system(`stepped away while the ${rooms.label(id)} was being made ready`);
        rooms.close(id);
        return;
      }
    }
    this.postfx?.reset();
    rooms.aboard(id, true);
    p.board(room, room.entry.clone());
    this.cam.zoomTarget = Math.min(this.cam.zoomTarget, 4);
    this.messages.note(`aboard the ${rooms.label(id)}: E steps out, and the room has physics of its own`);
  }

  /**
   * A hull somebody else flies is about to stop being a place to stand in -- that player has gone, the
   * line dropped, or their ship was let go of -- and this browser is standing in it. The walker is put
   * out into the world beside the hull before anything of the room is freed: a body left in a physics
   * world that has been freed is the one mistake this path cannot survive.
   */
  private peerHullGone(id: number): void {
    const rooms = peerRooms();
    if (rooms && this.stepOutOfPeerHull(id)) this.messages.system(`the ${rooms.label(id)} is gone: you are outside it`);
  }

  /**
   * Out of the rooms of a hull another player flies, into the world beside it. True when the walker
   * really was in that hull, so the caller knows whether to say anything. Nothing of the peer's ship
   * is read but the picture's own place, motion and size, which is all this browser has of it.
   */
  private stepOutOfPeerHull(id: number, fell = false): boolean {
    const p = this.player;
    const rooms = peerRooms();
    const room = p.aboard;
    if (!rooms || !room || rooms.idOf(room) !== id) return false;
    room.toWorld(p.pos, tmp);
    const radius = rooms.hullAt(id, goneAt, goneVel);
    const hullY = goneAt.y;
    if (p.ragdoll) p.endRagdoll();
    p.leave();
    // A flame held in that hull's frame lived in a frame that is going: it stops here.
    (this.kits.bounty_hunter as BountyHunterKit | undefined)?.coolDown();
    this.postfx?.reset();
    // Whoever built the rooms is told nobody is in them any more, which is also what lets them go.
    rooms.aboard(id, false);
    // Clear of where the hull was, along the way out from its middle; standing exactly at that middle
    // (nothing to point away from) the figure simply goes sideways, which is as good as any other way.
    // Having fallen out of a door in flight, the figure stays exactly where the hull's frame put it,
    // as it does out of one of this world's: it fell out of that spot and is not being shown out.
    if (!fell && radius > 0) {
      goneAt.sub(tmp);
      if (goneAt.lengthSq() < 1e-6) goneAt.set(-1, 0, 0);
      tmp.addScaledVector(goneAt.normalize(), -(radius + 1.5));
    }
    // On a planet there is ground under that spot, and none of it is theirs to ignore: without this
    // a walker shown out of a friend's parked ship is left standing in the hillside, or in the air.
    if (!fell && !this.world.planet.space) {
      const from = Math.max(tmp.y, hullY) + 0.5;
      // The walker's own body is back in this world at the place it was left, which may be exactly
      // here: cast from inside a capsule, a ray finds that capsule and calls its middle the floor.
      const hit = this.physics.groundDistance(tmp.x, from, tmp.z, 40, p.body);
      tmp.y = hit !== null ? from - hit + 0.15 : Math.max(this.world.terrain.heightAt(tmp.x, tmp.z), this.world.terrain.waterLevel - 1) + 0.3;
    }
    p.stand(tmp);
    // Their hull's own motion, in space and in the air alike: it is all this browser has of it, and
    // a fall out of a hull at speed without it is a sideways teleport.
    if (radius > 0 && (fell || this.world.planet.space)) {
      p.vel.copy(goneVel);
      p.grounded = false;
    } else p.grounded = !this.world.planet.space && !fell;
    this.cam.setFrame(null);
    return true;
  }

  /** Step into a ship's room, at its entry. The seat inside is not there yet: E again steps out. */
  private boardShip(v: Vehicle): void {
    const room = v.interior;
    if (!room) return;
    // The camera jumps into the rooms: the effects have no history across it, and the grade takes
    // the rooms' share of the planet's look at once rather than easing into it. Below the guard,
    // so E at a ship with no rooms does not throw a frame of history away for nothing.
    this.postfx?.reset();
    room.reveal(true);
    this.player.board(room, room.entry.clone());
    this.cam.zoomTarget = Math.min(this.cam.zoomTarget, 4);
    this.messages.note('aboard: E steps out, and the room has physics of its own');
  }

  /**
   * The ship the player was aboard is gone (blown up, or removed): out of its rooms into the world where
   * the hull was, with the hull's motion, adrift in space or falling on a planet. Also the guard for any
   * path that removes a hull with someone still in it, so the body is never left in a freed room.
   */
  private thrownOutOfShip(v: Vehicle): void {
    const p = this.player;
    const room = p.aboard;
    if (!room || room.vehicle !== v) return;
    // Standing on a surface when a ship went. The boots hold to what is under the feet, not to the ship that
    // brought you: only a walker standing on that very hull is let go (adrift where they stood on the next
    // look, nothing thrown and nothing hurt). Standing on a rock beside it, the rock is untouched and the
    // room is merely pointed at a live hull, since it names one for the aboard path's sake.
    if (isSurfaceRoom(room)) {
      if (room.standsOn(v.body)) room.release();
      else room.renameTo(this.reachFromBoots() ?? this.world.vehicles.find((o) => o !== v && !o.autopilot) ?? null);
      return;
    }
    room.toWorld(p.pos, tmp);
    const lv = v.body.linvel();
    p.leave();
    // A flame held in the room lived in the hull's frame, which may be gone: its heat and its effect stop.
    (this.kits.bounty_hunter as BountyHunterKit | undefined)?.coolDown();
    p.fling(tmp, tmp2.set(lv.x, lv.y, lv.z));
    p.takeDamage(20);
    // Thrown out of a hull that has gone: nothing to point at.
    this.hurtFrom(null);
    this.cam.setFrame(null);
  }

  /** Out of a ship's room: beside the hull on the floor found there, or, having fallen out, where the hull's frame put the figure, with the hull's motion. */
  private leaveShip(fell: boolean): void {
    const p = this.player;
    const room = p.aboard;
    if (!room) return;
    // The figure is stood beside the hull, so this is a camera cut too. Below the guard: a call
    // made with nobody aboard changes nothing and should cut nothing.
    this.postfx?.reset();
    // Out of a hull somebody else flies: nothing of theirs is this game's to read -- no hull box to
    // step beside, no body to take a velocity off -- so the figure goes out by the room's own frame,
    // clear of the picture, and `reveal(false)` is what tells whoever built the rooms nobody is in
    // them. Everything below reads `room.vehicle`, which for their hull is a stand-in.
    const peer = peerRooms()?.idOf(room) ?? 0;
    if (peer) {
      // Stepping out says nobody is in them and no more. Taking them down here would build the whole
      // interior again on the next press, and this runs on any frame the walker is outside the room's
      // own box -- a step through a doorway in flight would rebuild their ship every frame. Whoever
      // built them lets them go once their hull stops being drawn.
      this.stepOutOfPeerHull(peer, fell);
      return;
    }
    const v = room.vehicle;
    // The boots: the figure is left adrift exactly where it stood, carrying what it was doing in the room
    // and what the room itself was doing, and the room goes with it (nothing else holds a surface).
    const surface = isSurfaceRoom(room) ? room : null;
    room.toWorld(p.pos, tmp);
    if (surface) surface.worldVelocity(p.vel, tmp2);
    // Dying in the boots builds the ragdoll in the surface's own physics world, and that world is freed a few
    // lines below: the corpse goes first, or the next frame's ragdoll step reads bodies that are gone.
    if (surface && p.ragdoll) p.endRagdoll();
    p.leave();
    // A flame held in the room lived in the hull's frame: it stops, and a trigger still held places it again outside.
    (this.kits.bounty_hunter as BountyHunterKit | undefined)?.coolDown();
    room.reveal(false);
    if (surface) {
      p.stand(tmp);
      p.vel.copy(tmp2);
      p.grounded = false;
      surface.dispose();
      return;
    }
    if (!fell) {
      v.quaternion(tmpQ);
      tmp.set(-(v.spec.bounds.max[0] - v.spec.bounds.min[0]) / 2 - 1.2, 0, 0).applyQuaternion(tmpQ).add(v.pos);
      const from = v.pos.y + 0.5;
      // In space there is no ground under the hull: the spot beside it is where the figure goes, boots and all.
      if (!this.world.planet.space) {
        const hit = this.physics.groundDistance(tmp.x, from, tmp.z, 20, v.body);
        tmp.y = hit !== null ? from - hit + 0.15 : this.world.terrain.heightAt(tmp.x, tmp.z) + 0.3;
      }
    }
    p.stand(tmp);
    if (fell) {
      const lv = v.body.linvel();
      p.vel.set(lv.x, lv.y, lv.z);
      p.grounded = false;
    }
    // Out of a ship set down on something in space: the boots take hold of what it is standing on.
    if (!fell && this.world.planet.space && v.landed) {
      const lv = v.body.linvel();
      p.vel.set(lv.x, lv.y, lv.z);
      p.grounded = false;
      v.quaternion(tmpQ);
      this.bootsTake(tmp2.set(0, -1, 0).applyQuaternion(tmpQ), tmp);
    }
  }

  /**
   * The vehicle within arm's reach, or nothing. It answers all three of the questions the prompt
   * used to ask separately, each with a walk of its own: is one in reach, has it a room to step
   * into (`interior`), and is it on its back (`upsideDown`).
   */
  private nearestVehicle(): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = MOUNT_RANGE;
    for (const sp of this.world.vehicles) {
      const d = this.vehicleReach(sp);
      if (d < bestD) {
        bestD = d;
        best = sp;
      }
    }
    return best;
  }

  /**
   * The ship a captured shot is composed around: the nearest one **in front of the camera**, not
   * the nearest one the player could climb into.
   *
   * Read `nearestVehicle` above and then this, because the difference is the whole point. That one
   * answers "what would E do here", and its reach is 3.6 m from the hull's skin with a four-metre
   * ceiling, which is right for a key press and hopeless for a photograph: a ship parked where it
   * looks good in a shot is tens of metres off and often on ground well above or below the figure.
   * This one takes plain distance from the camera and the one test that actually matters for a
   * picture, which is whether the thing is in front of it.
   */
  private shipInShot(camAt: THREE.Vector3, forward: THREE.Vector3): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = SCENE_SHIP_REACH;
    for (const v of this.world.vehicles) {
      // A patrol's hull is the zone's, never the shot's: nobody parked it.
      if (v.autopilot) continue;
      const dx = v.group.position.x - camAt.x;
      const dy = v.group.position.y - camAt.y;
      const dz = v.group.position.z - camAt.z;
      // Behind the camera is not in the picture, whatever the distance.
      if (dx * forward.x + dy * forward.y + dz * forward.z <= 0) continue;
      const d = Math.hypot(dx, dy, dz);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  /** How far a vehicle's side is from the player across the ground, or far when it is well above or below them (a flyer overhead, a bike up a cliff). */
  private vehicleReach(v: Vehicle): number {
    // An NPC ship is never mounted or boarded: this one test feeds E, the prompts and every "nearest".
    if (v.autopilot) return Infinity;
    const p = this.player.pos;
    const dy = Math.abs(v.pos.y - p.y);
    if (dy > 4) return Infinity;
    return Math.hypot(v.pos.x - p.x, v.pos.z - p.z) - v.radius;
  }

  run(): void {
    // A frame that throws is logged (once per distinct error every few seconds, so the console
    // stays readable) and the next one runs as usual, with nothing left half-applied from the
    // input: the game keeps going, and the message says what failed and where.
    const seen = new Map<string, number>();
    const frame = () => {
      requestAnimationFrame(frame);
      // The backdrop shoot drives its own frames and must be the only thing doing so. It yields to
      // the browser between them on purpose -- several effects answer only after control has gone
      // back, the water's occlusion query among them -- and the game's own step ran in those gaps:
      // it wrote `player.group.visible = true` every time, so the figure came back into shots it
      // had been taken out of. The step still runs, because the world must keep updating for the
      // sky to reach the hour being shot; what it no longer does is draw (see `this.shooting`
      // below) and what the shoot no longer trusts is that a hide set once stays set.
      try {
        step();
      } catch (err) {
        const key = String((err as Error)?.message ?? err);
        const now = performance.now();
        if ((seen.get(key) ?? -Infinity) < now - 5000) {
          seen.set(key, now);
          console.error('frame failed (the game carries on):', err);
        }
        this.input.endFrame();
      }
    };
    const step = () => {
      const tFrame = performance.now();
      this.timer.update();
      const rawDt = this.timer.getDelta();
      const dt = Math.min(0.05, rawDt);
      this.lastDt = dt;
      const input = this.input;
      const player = this.player;
      // A character standing in one of the captured places takes a path of its own: the world is
      // loaded and drawn and its sky runs, but nobody is playing, so none of the rest of this
      // frame -- the keys, the body, the fight, the streaming, the relay -- applies.
      if (this.scene3d) {
        this.stepScene(dt);
        input.endFrame();
        return;
      }
      // On the select screen and in the creator there is no world: nothing streams, nothing draws
      // but the panels, and the frame costs nothing.
      if (!this.inWorld) {
        // The mixer still steps: the select screen and the creator have their own clicks, and the
        // bank's slices and the loops' clocks must go on whether a world is up or not.
        this.stepAudio(dt);
        input.endFrame();
        return;
      }
      const active = this.started && !this.traveling && !this.dying && !this.menu.open;
      if (active) this.savePlace();
      // The jump's countdown (held still while the Escape menu is open) and its phases; during a crossing's travel it waits.
      if (!this.traveling) this.hyperspace.update(dt, rawDt, this.menu.open);
      // The lift menu takes the number keys while it is up, before the kit's slots see them.
      if (this.liftMenu.open) for (let n = 1; n <= 9; n++) if (input.consumeKey(`Digit${n}`)) this.liftMenu.pickKey(n);

      if (active) {
        // Not while a jump flies the ship: the map's teleport would abort it half way into another system's load.
        if (input.pressedAction('map') && !this.hyperspace.locksControls) this.toggleMap();
        // I and B wait out a jump from its countdown until control returns: closing the ship edit page refits the hull,
        // which would build parts (and maybe programs) on a live frame and could hand the ghosted hull live colliders.
        const jumpBusy = this.hyperspace.phase === 'countdown' || this.hyperspace.locksControls;
        if (input.pressedAction('inventory') && !jumpBusy) this.toggleInventory();
        if (input.pressedAction('spawner') && !jumpBusy) this.toggleSpawner();
        if (input.pressedAction('ship')) this.toggleShipMenu();
        if (input.pressedAction('help')) this.hud.toggleHelp();
        if (!this.map.open && !this.anyPanelOpen()) {
          if (input.pressedAction('saberToggle') && this.kit.id === 'jedi' && !player.mounted) player.toggleSaber();
          if (input.pressedAction('switchClass')) this.setClass(this.kit.id === 'jedi' ? 'bounty_hunter' : 'jedi');
          // Locked from the jump's enter stage until control returns, but for the crew in the tunnel (`pressJumpE`); the key only:
          // leaving for the select screen and the map's teleport abort the jump first.
          if (input.pressedAction('mount') && !player.noclip) {
            if (!this.hyperspace.locksControls) {
              if (!this.handleElevator() && !this.handleZoneGate()) this.handleMount();
            } else this.pressJumpE();
          }
          if (input.pressedAction('noclip') && !player.mounted && !this.hyperspace.locksControls) player.toggleNoclip();
          if (player.noclip && input.pressedAction('noclipFaster')) player.noclipSpeed = Math.min(2000, player.noclipSpeed * 1.5);
          if (player.noclip && input.pressedAction('noclipSlower')) player.noclipSpeed = Math.max(2, player.noclipSpeed / 1.5);
          if (input.pressedAction('flashlight')) this.torchOn = !this.torchOn;
          // The wings key: the pilot of a ship whose wings open picks open or closed over the flight rule, held until the key
          // is pressed again or the seat is left (a ship nobody flies goes back to the rule). Locked while a jump flies the ship.
          const wingsOf = player.mounted ?? player.piloting;
          if (input.pressedAction('wings') && wingsOf?.spec.ship && wingsOf.wings.length && !this.hyperspace.locksControls) wingsOf.wings.toggle();
          // Cut the engines: nothing holds the ship up, and it comes down and settles on the ground.
          // Not while a jump flies it, and not on the ground, where the throttle is what lifts it off.
          if (input.justPressed(CUT_ENGINES_KEY) && wingsOf?.spec.ship && !this.hyperspace.locksControls && !this.world.planet.space) {
            if (wingsOf.powered) wingsOf.cutEngines();
            else wingsOf.enginesOn();
          }
          // The same key out in space, where there is nothing to cut the engines over: set the hull down on
          // whatever is under it, and, once it is down, lift it off along that face's own up.
          if (input.justPressed(CUT_ENGINES_KEY) && wingsOf?.spec.ship && !this.hyperspace.locksControls && this.world.planet.space) wingsOf.askSetDown();
          // The ultra cruise: the same key starts a run and lets go of one. It says for itself where
          // it may run at all, so the only thing asked here is that a jump is not flying the hull.
          if (input.justPressed(CRUISE_KEY) && !this.hyperspace.locksControls) this.ultraCruise.toggle();
          dropPilotChoices(this.world.vehicles, wingsOf);
          // The emote wheel: held open, the mouse picks, the key's release plays; the arrows play the first four outright.
          if (input.pressedAction('emoteWheel') && !player.mounted) this.emoteWheel.show(this.emotes);
          this.stepEmoteKeys();
        }
      }
      if (this.emoteWheel.open) {
        this.emoteWheel.move(input.mouseDX, input.mouseDY);
        input.mouseDX = 0;
        input.mouseDY = 0;
        if (!input.held('emoteWheel') || !active) {
          const clip = this.emoteWheel.selected();
          this.emoteWheel.hide();
          if (active) this.playEmote(clip);
        }
      }
      this.stepEmoteEnd();

      const simulate = active && !this.map.open && !this.anyPanelOpen();
      // Nothing aims while the player is not simulated (dead, a panel, the map, the menu, travel):
      // player.update, which reads the mouse, does not run, so the shoulder view and the lens would
      // otherwise hold on under the death card. The next simulated frame reads the button afresh.
      if (!simulate && (player.aiming || this.cam.aim)) {
        player.aiming = false;
        this.cam.aim = false;
      }
      // Dead: the body keeps falling and settling under the camera while the respawn waits.
      if (this.dying && player.ragdoll) player.ragdollStep();
      if (simulate) {
        player.update(dt, input, this.cam, this.world);
        // The thrown and orbiting sabers and the hilt glow from the pooled flash lights (so no light comes
        // or goes with them), unless the effects light what is around the blades.
        if (!this.bladeGlowOwnsLight()) for (const spot of player.lightSpots()) this.effects.flash(spot.pos, player.saberColor, spot.intensity, spot.distance, 0.08);
        this.scorch(dt);
        this.stepCombat(dt);
      }

      // Before the hulls step: a run writes its hull's pose, and the hull's own update writes the
      // same pose again on the same frame, so nothing ever lags a step.
      this.ultraCruise.update(dt);
      this.stepVehicles(dt, simulate);
      this.stepNet(dt);
      // The rooms of a hull another player flies step themselves, here, once a frame: a room outlives
      // the player whose hull it was (somebody standing in a ship whose pilot has just dropped off the
      // line is standing in a floor that must go on being simulated), and the peers' own pass says
      // nothing at all about a player who is gone. Called twice in a frame it does the work once.
      this.world.remoteRooms().step();

      const fast = simulate && input.held('fastForward');
      for (const m of this.shown) m.update(dt);
      // Where the player stands, whether it may be attacked at all, and what a blow does: the one
      // record everything alive fights over. Mounted stays targetable, as it always has -- the
      // creatures chase a rider -- and the damage is dropped by the callback.
      // `from` is where whatever struck was standing: every creature, fighter, mobile and bolt already
      // passes it, and it is what turns the red flash into an arc on the side the blow came from.
      const hurt = (dmg: number, from?: THREE.Vector3) => {
        if (!simulate || player.mounted || player.noclip || player.aboard) return;
        player.takeDamage(dmg);
        this.hurtFrom(from ?? this.hurtSource);
      };
      // The weather's view of the player: aboard rooms nothing falls; a ridden ship's box keeps rain out of its canopy.
      this.world.aboard = !!player.aboard;
      this.world.weatherHull = player.mounted?.spec.ship ? player.mounted : null;
      this.world.weatherRidden = player.mounted;
      this.hud.setWeatherNote(this.world.weather.heldNote());
      this.world.setPlayerTarget(player.worldPos, simulate && !player.noclip && !player.aboard && !this.dying && player.hp > 0, hurt);
      this.world.update(dt, player.worldPos, this.cam.camera.position, fast, hurt, simulate && !player.mounted && !player.noclip && !player.aboard ? player : null);
      // The pool serves the latest request first when it is full (flashes age only in effects.update),
      // so the room lights go last and always keep their lights; the fighters' glows just before them,
      // farthest first, so the nearest win; this frame's shots, powers and muzzle flashes came earlier
      // and give way. Here the hull is where stepVehicles left it and the fighters where they moved to.
      if (simulate) {
        if (!this.bladeGlowOwnsLight()) {
          const glows = this.world.npcs.lightSpots(npcGlow, this.cam.camera.position, FIGHTER_GLOW_RANGE);
          // The catalogue's people's blades, merged into the same two nearest (keepNearestGlow keeps the list sorted).
          const all = this.world.mobiles ? this.world.mobiles.lightSpots(npcGlow, this.cam.camera.position, FIGHTER_GLOW_RANGE, glows) : glows;
          for (let i = all - 1; i >= 0; i--) this.effects.flash(npcGlow[i].pos, npcGlow[i].color, 2, 5, 0.08);
        }
        // Aboard, the room's own lights, the nearest few, through the same pool (no new lights, so nothing recompiles).
        if (player.aboard) for (const l of player.aboard.roomLights(player.pos, 3, roomLightSpots)) this.effects.flash(l.pos, l.color, l.intensity, l.distance, 0.08);
      }
      const tPhys = performance.now();
      this.physics.step(dt);
      stats.physicsMs = performance.now() - tPhys;
      this.effects.update(dt);

      if (simulate && player.hp <= 0) void this.die();

      player.inside = this.world.inside || !!player.aboard;
      const room = player.aboard;
      this.updateCamera(player.noclip ? null : room ? (from, to) => room.cameraBlock(from, to) : (from, to) => this.physics.cameraBlock(from, to, player.body, this.world.inside), dt);
      // The ear sits at the camera, set after the frame's last camera move: aboard a ship, in the
      // cockpit or on foot, what is heard is what the picture is drawn from.
      this.stepAudio(dt);
      this.torch.intensity = this.torchOn ? 260 : 0;
      if (this.torchOn) {
        this.torch.position.copy(this.cam.camera.position);
        this.cam.camera.getWorldDirection(torchDir);
        this.torch.target.position.copy(this.cam.camera.position).addScaledVector(torchDir, 12);
      }
      // Out of the eyes the body stays in the picture and the head, hair and headwear draw into the shadows only (headHide.ts).
      if (player.rig) {
        player.group.visible = true;
        player.rig.setHeadHidden(this.fpHeadForce ?? this.cam.firstPerson);
        // The head follows where the view looks (`src/player/lookAt.ts`). It is asked for here, after
        // the physics and the camera and after the figure's own pose, so the direction is this frame's
        // and the turn is measured from where `twistTorso` has just left the chest rather than from
        // the body's heading -- the torso keeps Jedi Academy's own quarter-turn toward the way the
        // legs go, and the head is a third thing beside it.
        //
        // It goes still, easing back at the same rate, through **any** one-off clip -- a kata, a
        // kick, a death, an emote, a dance, and an ordinary swing riding the upper body over running
        // legs, which is the common case in a fight and not the rare one. An upper-body clip drives
        // the spine, the arms and the head, so a head still tracking the crosshair through one is
        // turned on top of a pose the swing is writing, which is exactly the doll this is to avoid.
        // It goes still too while the player is down or not being simulated at all, and -- unless
        // `__debug.headLook({ ride: 1 })` says otherwise -- while they are on something they ride:
        // seated on a mount or in a cockpit, and standing at a bridge's controls as well, whose
        // pose is authored with the head where it wants it.
        // A body whose own pieces are posing it is not a body with a head to turn: while the
        // ragdoll has the bones the look is dropped outright rather than eased out, or a shrinking
        // turn is laid on top of the pieces' pose for a fifth of a second after every death.
        // `clearLook` puts a joint back only where the look itself left it, so a bone the ragdoll
        // has already written this frame is not touched; everywhere else the ease is what is wanted.
        const rig = player.rig;
        this.cam.forward(headLook);
        if (player.ragdoll) rig.clearLook();
        else {
          const still = rig.overriding || ((!!player.mounted || !!player.piloting) && LOOK.ride <= 0);
          rig.lookToward(wrapAngle(Math.atan2(headLook.x, headLook.z) - player.heading), this.cam.pitch, dt, simulate && !this.dying && player.hp > 0 && !still);
        }
      } else player.group.visible = !this.cam.firstPerson; // the primitive placeholder body, before any rig
      // Seated in a ship without a cockpit frame the game drew no pilot: the whole figure, shadow included, is hidden.
      if (player.mounted?.riderHidden) player.group.visible = false;
      // After the physics step and the camera: the falling weather around this frame's camera.
      this.world.updateWeatherView(dt);
      this.world.updateShadows(performance.now());

      // The short bar of things you can press. Its state is gathered a few times a second into one
      // kept struct, because the asking is what costs Ã¢â‚¬â€ the lift underfoot, the elevators near, the
      // doorless building near and the nearest vehicle Ã¢â‚¬â€ and never the words. It is emptied at once
      // on any frame that is not simulated, rather than waiting for the next gather: a row of things
      // you cannot press, standing over the death card, is exactly the fault to avoid.
      if (!simulate) {
        if (this.promptLive) {
          this.promptLive = false;
          this.actions.clear();
          resetPromptState(this.promptState);
          // The plate over a head goes with it: a name standing over a creature behind the death
          // card would be the same fault as a frozen reticle, and the plates are DOM, not canvas.
          this.plates.clear();
        }
      } else {
        this.promptClock -= rawDt;
        if (this.promptClock <= 0 || !this.promptLive) {
          this.promptClock = 1 / Math.max(1, HUD_WIRING.promptHz);
          this.promptLive = true;
          this.actions.set(this.gatherPrompt(true));
        }
      }
      // The ship menu is where space is gone to and come back from; the prompt says when the ship is high enough.
      // The long line of every key is what it always was, but it is now a setting, and it costs
      // nothing on the frame path either way: the *conditions* were always its cost, not the words,
      // and every one of them Ã¢â‚¬â€ the lift underfoot, the elevators near, the doorless building near,
      // the nearest vehicle, the ship in reach of the boots Ã¢â‚¬â€ is now read out of the bar's own
      // state, gathered a few times a second. The line's wording can therefore be an eighth of a
      // second behind what is underfoot, which is far less than it takes to reach for the key.
      const S8 = this.promptState;
      // The line is written only while the game is simulating, as the bar is emptied then. Half of
      // its branches read the eighth-of-a-second state, which is emptied on the frame the game stops,
      // and half read the player directly, which is not: written over an open panel the line would
      // disagree with itself, saying "E mount" where it had been saying "E lift". A jump's own line
      // goes over it either way, so a countdown is never lost to a panel.
      const full = this.settings.hudFullPrompts && simulate;
      const shipKey = full ? keyName(input.bindings.ship[0] ?? '') : '';
      const shipHint = !full ? '' : this.spaceGate === 'up' ? ` Ã‚Â· <b>at altitude for space: ${shipKey}</b> ship menu` : this.world.planet.space ? ` Ã‚Â· <b>${shipKey}</b> ship menu` : '';
      let prompt = '';
      if (full) {
        if (player.noclip) prompt = `<b>NOCLIP</b> ${Math.round(player.noclipSpeed)} m/s Ã‚Â· <b>WASD</b> fly Ã‚Â· <b>Space</b> up Ã‚Â· <b>Ctrl</b> down Ã‚Â· <b>Shift</b> fast Ã‚Â· <b>+</b>/<b>-</b> speed Ã‚Â· <b>N</b> off`;
        else if (player.mounted) prompt = mountPrompt(player.mounted, input.bindings.wings[0] ?? WINGS_KEY) + (player.mounted.spec.ship ? shipHint : '');
        else if (S8.lift) prompt = `<b>E</b> lift: ${this.promptLiftStops} levels`;
        else if (S8.elevator) prompt = `<b>E</b> elevator ${S8.elevator}`;
        else if (S8.doorless) prompt = `<b>E</b> enter ${this.promptDoorless} (no way in on foot)`;
        else if (player.piloting) prompt = `at the controls of the ${player.piloting.spec.label} Ã‚Â· ${player.piloting.landed ? `landed Ã‚Â· <b>W</b> or <b>Space</b> lifts off` : `<b>W</b>/<b>S</b> throttle Ã‚Â· mouse steers${player.piloting.spec.ship && SHIP_GROUND.rule === 'landing' ? ` Ã‚Â· hold <b>Ctrl</b> to set down Ã‚Â· <b>${keyName(CUT_ENGINES_KEY)}</b> cuts the engines` : ''}`} Ã‚Â· <b>Alt</b> looks around Ã‚Â· <b>E</b> lets go Ã‚Â· ${Math.round(Math.abs(player.piloting.speed) * 3.6)} km/h${shipHint}${player.piloting.landNote ? ` Ã‚Â· ${player.piloting.landNote}` : ''}`;
        // Standing on something out in space: the boots hold, a jump lets go, and E climbs into a ship beside you.
        else if (isSurfaceRoom(player.aboard)) prompt = `<b>gravity boots</b> on ${S8.bootsReach ? 'a surface Ã‚Â· <b>E</b> climbs into the ship' : 'a surface Ã‚Â· <b>E</b> takes them off'} Ã‚Â· <b>jump</b> lets go${player.aboard.atEdge ? ' Ã‚Â· <b>the surface underfoot runs out near here</b>' : ''} Ã‚Â· <b>${shipKey}</b> ship menu`;
        else if (player.aboard) prompt = (player.aboard.pilotSpot && player.pos.distanceTo(player.aboard.pilotSpot) < CONTROLS_RANGE ? `<b>E</b> take the controls` : `aboard ${player.aboard.vehicle.spec.label} Ã‚Â· <b>E</b> step out`) + (this.world.planet.space ? ` Ã‚Â· <b>${shipKey}</b> ship menu` : '');
        else if (player.eva) prompt = `adrift Ã‚Â· <b>W/S</b> thrust ahead and back Ã‚Â· <b>A/D</b> sideways Ã‚Â· <b>Space/Ctrl</b> up and down Ã‚Â· mouse turns Ã‚Â· <b>Z/V</b> roll Ã‚Â· <b>${keyName(input.bindings.brake[0] ?? '')}</b> brake Ã‚Â· ${Math.round(player.vel.length() * 3.6)} km/h${S8.near === 'board' ? ' Ã‚Â· <b>E</b> board' : S8.near ? ' Ã‚Â· <b>E</b> mount' : ' Ã‚Â· <b>E</b> gravity boots'}${performance.now() - this.bootsNoteAt < SURFACE_ROOM.note * 1000 && this.bootsNote ? ` Ã‚Â· ${this.bootsNote}` : ''}`;
        else if (S8.near) prompt = S8.near === 'board' ? '<b>E</b> board' : S8.near === 'flip' ? '<b>E</b> flip it upright' : '<b>E</b> mount';
        // The gate's own line, where the bar can only say that it is a gate: the long line has the
        // room for where it goes, and this is the one place the name is written every frame rather
        // than said once.
        else if (S8.gate) prompt = S8.gate === 'travel' ? `<b>E</b> go to ${this.promptGate}` : '<b>E</b> this gate leads nowhere the pack names';
      }
      // A jump's countdown, then "jumping", over whatever the prompt would say; in the tunnel, the crew's lifts and controls.
      prompt = this.jumpPrompt(S8.lift) ?? prompt;
      this.hud.setPrompt(prompt);
      // Mouse flight's display (seated or at a bridge's controls, in flight, Alt not held): the aim circle, the ring and the
      // cursor, in pixels, at this frame's field of view. The cursor is the hull's (about its nose, from the pilot's eye), so
      // the circle is drawn where the boresight lands on this camera's screen at the guns' range, and the cursor where its
      // own direction lands: in the cockpit that is the middle; in the chase view it drifts off the middle while the view
      // catches a turn up, and sits a little under it (the view looks under the hull). Unsimulated (a panel, the map,
      // death), nothing is on the lead. Allocates nothing.
      const flownShip = player.mounted ?? player.piloting;
      // One call a frame: `status` refills one kept object, and both the arcs' numbers and the
      // condition block are filled from this one fill rather than asking the fight twice.
      const flownFight = flownShip?.combat ?? null;
      const flownStatus = flownFight ? flownFight.status() : null;
      // Nothing flown: the cursor's hull is let go (a disposed hull is not kept), and the next one starts in the middle.
      if (!flownShip) this.flightCursorOf = null;
      const flying = !!flownShip?.spec.ship && flownShip.airborne && !input.held('freeLook') && !this.hyperspace.drives(flownShip);
      if (flying && flownShip) {
        const cam = this.cam.camera;
        cam.updateMatrixWorld();
        const halfW = window.innerWidth / 2;
        const half = window.innerHeight / 2;
        const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
        const fv = this.flightView;
        const q = flownShip.group.quaternion;
        const eye = this.shipEyeWorld(flownShip, this.flightShowEye) ?? this.flightShowEye.copy(flownShip.pos);
        const range = this.flightRange > 0 ? this.flightRange : MOUSE_FLIGHT.convergeM;
        // The boresight at the guns' range; the circle's scale is the eye's distance over the camera's (the chase view
        // sits behind the eye, so the circle there shows a little smaller).
        const p = this.flightShow.set(0, 0, 1).applyQuaternion(q).multiplyScalar(range).add(eye);
        const scale = range / Math.max(1e-3, cam.position.distanceTo(p));
        p.project(cam);
        const centred = p.z > 1 || !Number.isFinite(p.x);
        fv.ox = centred ? 0 : p.x * halfW;
        fv.oy = centred ? 0 : -p.y * half;
        const s = centred ? 1 : scale;
        fv.circle = circleRadius(tanHalf) * half * s;
        fv.ring = ringRadius(tanHalf) * half * s;
        hullRay(this.flightCursor, tanHalf, p).applyQuaternion(q).multiplyScalar(range).add(eye).project(cam);
        if (centred || p.z > 1 || !Number.isFinite(p.x)) {
          fv.cx = this.flightCursor.x * half * s;
          fv.cy = this.flightCursor.y * half * s;
        } else {
          fv.cx = p.x * halfW - fv.ox;
          fv.cy = -p.y * half - fv.oy;
        }
        fv.inside = insideCircle(this.flightCursor, tanHalf);
        fv.turn = this.flightStick.turn;
        fv.onLead = this.flightOnLead && this.world.simulating;
        // The lead marker, in pixels from the middle of the window, and the hull's own numbers.
        if (this.shipLeadValid) {
          tmp2.copy(this.shipLead).project(cam);
          fv.leadOn = tmp2.z <= 1 && Math.abs(tmp2.x) <= 1 && Math.abs(tmp2.y) <= 1;
          fv.leadX = tmp2.x * halfW;
          fv.leadY = -tmp2.y * half;
        } else fv.leadOn = false;
        this.fillFlightNumbers(flownShip, fv, flownStatus);
      }
      const aimed = flownShip;
      this.shipHud.setFlight(flying && this.settings.hudArcs ? this.flightView : null);
      const showTarget = aimed?.spec.ship && aimed.airborne && !input.held('freeLook') && !this.hyperspace.drives(aimed);
      this.shipHud.setTarget(showTarget && this.settings.hudTargetBlock ? this.targetHud(aimed) : null);
      // The target effects stand on the target while it is shown, and follow it; out of the ship they go.
      if (!aimed?.spec.ship) this.targetFx.select(null, false, null);
      this.targetFx.update();
      // The flown ship's shields, armour, hull, boost, its parts and what is down; the comms fading.
      const fight = flownFight;
      const condition = fight && this.settings.hudShipCondition ? fight : null;
      // The parts are watched whether the block is drawn or not, so a part going down still says so
      // in words with the block switched off; the last argument is what draws it.
      this.shipHud.setStatus(fight ? flownStatus : null, fight?.stats, fight ? fight.cond.parts : null, !!condition);
      // The body's own bars and the class's slot row stand down while the ship's condition is in their
      // place: a health bar that cannot change in flight read as a second, broken one.
      this.showBodyBlock(!condition);
      // Why a landing was refused, said once when it changes: on the hull it is a state string the
      // long prompt interpolated, and the long prompt is now a setting.
      const landNote = aimed ? aimed.landNote : '';
      if (landNote !== this.landNoteSaid) {
        this.landNoteSaid = landNote;
        if (landNote) this.messages.note(landNote);
      }
      this.shipHud.update(dt);
      // The damage feedback, after this frame's last camera move and after the flight display has
      // worked out where the reticle sits. It is handed the camera's three axes as nine plain
      // numbers, so nothing of three's reaches that file, and the middle it ticks: the flight
      // display's own boresight while it is up (in a chase view it drifts off the centre of the
      // window), else the middle. Both are writes into kept fields; nothing is made.
      const fcam = this.cam.camera.matrixWorld.elements;
      this.feedback.setCamera(fcam[0], fcam[1], fcam[2], fcam[4], fcam[5], fcam[6], -fcam[8], -fcam[9], -fcam[10]);
      if (flying) this.feedback.setCentre(window.innerWidth / 2 + this.flightView.ox, window.innerHeight / 2 + this.flightView.oy);
      else this.feedback.setCentre();
      // On the real clock, as the message line is: an arc that landed as a panel opened fades while
      // the panel is open rather than standing there when it closes.
      this.feedback.update(rawDt);
      // The message line ages on the real clock, not the simulation's Ã¢â‚¬â€ `rawDt`, not the step's
      // clamped `dt`: a notice sent as a panel opened must still fade while it is open, or it would
      // be standing there when the panel closes, and under a long stall a clamped delta would hold
      // every line far past its eight seconds.
      this.messages.update(rawDt);
      // The group's roster: it takes the list from the group module itself and writes only what has
      // changed Ã¢â‚¬â€ eight rows of number comparisons, nothing allocated, and nothing written at all
      // while nobody has moved.
      this.roster.update();
      // The line's write counter is a lifetime total; it is sampled here into the per-second rate the
      // other two displays report. Nothing is allocated, and the sample is taken once a second.
      this.lineWriteWindow += rawDt;
      if (this.lineWriteWindow >= 1) {
        const made = this.messages.debug().writes;
        this.lineWritesLast = made - this.lineWriteMark;
        this.lineWriteMark = made;
        this.lineWriteWindow = 0;
      }
      const at = player.worldPos;
      // "Nearby" walked every living thing on the planet Ã¢â‚¬â€ a few hundred in a busy town Ã¢â‚¬â€ on every
      // frame, for a line the corner block writes four times a second. The plate over a head says
      // what you are looking at, which is the better answer to the same question, so with the plate
      // on the line is empty and the walk does not happen at all; with it off the walk is at the
      // rate the line is written, so it happens once per line rather than fifteen times per line.
      this.nearbyClock -= rawDt;
      if (this.settings.hudNameplate) this.nearbyName = '';
      else if (this.nearbyClock <= 0) {
        this.nearbyClock = 1 / Math.max(1, HUD_WIRING.nearbyHz);
        this.nearbyName = this.nearbyLabel(at);
      }
      // The breath goes last: it is null on dry land and with a full lungful, and the row is not on
      // the page at all while it is, so an ordinary frame writes nothing for it.
      this.hud.update(dt, at.x, at.y, at.z, this.kit, player.hp, player.maxHp, this.world.day.clock(), this.nearbyName, player.saberOn, player.breath);
      // The tighter crosshair while a shot is aimed, and the plate over whatever it rests on. The
      // crosshair is cast from the camera, so the eye and the direction are read straight out of its
      // world matrix into two kept vectors: column 3 is where it stands, column 2 negated is where
      // it looks. The plate walks the world's kept list at its own rate, not this frame's.
      this.hud.setAiming(player.aiming);
      // The switch is asked here rather than left to the plates' own first line, so that with the
      // plate off nothing at all is done for it: the world's list is a kept array, but building the
      // argument list to be declined is the one place an "off" switch would not turn something off.
      if (simulate && this.settings.hudNameplate) {
        const pm = this.cam.camera.matrixWorld.elements;
        this.plateEye.set(pm[12], pm[13], pm[14]);
        this.plateDir.set(-pm[8], -pm[9], -pm[10]);
        this.plates.track(rawDt, this.world.targets(), this.plateEye.x, this.plateEye.y, this.plateEye.z, this.plateDir.x, this.plateDir.y, this.plateDir.z, this.cam.camera, window.innerWidth, window.innerHeight, this.world.playerTarget.key);
      }

      if (this.breakFrames) throw new Error('debug: the frame is broken on purpose');
      // The blades are drawn from where the hands ended up this frame, so they never trail the pose.
      player.drawBlades(dt, this.cam.camera);
      // The other players' blades, from where their hands ended up this frame as well (their figures
      // were moved and posed in stepNet above). With the glow pass on they light the world through
      // it, exactly as the player's do, and ask for no light at all. With it off they take a pooled
      // flash only when one is standing dark: nothing the player's own blade, a fighter's glow or a
      // ship's room lights asked for earlier in the frame loses one -- and equally, with a busy pool
      // a peer's blade goes unlit rather than taking somebody's. The clash step below is the only
      // thing that asks after this draw, and it asks the same way (`CLASH.flashBorrow`, 'free'), so
      // a clash in a lit cabin sparks without a light of its own rather than blanking the cabin.
      remoteBlades.draw(dt, this.cam.camera, this.bladeGlowOwnsLight() ? null : this.effects);
      // Two blades that meet. Every blade in the world has just been drawn -- the player's above,
      // the fighters' and the catalogue's in their own step, the peers' on the line above -- so the
      // nearest approach between each pair is worked out here, where every pose is this frame's,
      // rather than in the frame context's blade block below, which the Effects setting leaves out
      // altogether. Nothing sparks while play is paused.
      if (simulate) this.stepClashes();
      const tRender = performance.now();
      // While the backdrop shoot is running it draws the frames itself, from the shot's camera and
      // at the shot's size. The rest of this step still runs -- the world must go on updating or
      // the sky never re-blends to the hour a picture is being taken at -- but a draw from the
      // player's own camera in between would put that view into the motion blur's history and its
      // focus into the lens, which is what smeared every picture of the first run.
      this.drawFrame();
      stats.renderMs = performance.now() - tRender;
      // The display's shapes, over the picture and under every panel. Nothing is drawn and the canvas
      // is cleared once whenever the game is not simulating, so no reticle stands frozen over the
      // death card, an open panel or the map.
      this.drawOverlay(simulate);
      stats.frameMs = performance.now() - tFrame;
      // A shader compiled on a live frame is a stall: say which frame, how many, and WHAT, so the
      // cause can be found rather than only counted. The renderer's own `programs.length` cannot
      // answer that, nor even how many were made: it is a net figure, and a frame that built one
      // and let another go reads as a quiet one. The watch compares by program id instead.
      //
      // While the effects are switching over, programs are made on purpose and on frames that are not stalls.
      // Under the jump's white, the destination's programs are made on purpose (World.readyAround), unseen.
      // Behind a loading screen the player is waiting on purpose, and before the first world there is
      // nothing to play at all. Every one of those frames is sampled all the same, under the word
      // that fits it, so nothing goes uncounted, `__debug.shaders()` can still say what each of them
      // built, and the line below is written for a live frame of real play and for nothing else.
      const phase = this.shaderPhase();
      const made = this.sampleShaders(phase);
      if (made.made > 0 && phase === 'play' && this.lastPrograms > 0) {
        const churn = made.dropped > 0 ? `, ${made.dropped} dropped` : '';
        const over = made.made > SHADER_TUNE.playBudget ? ' Ã¢â‚¬â€ over the one a frame this game holds to' : '';
        console.info(`shaders: ${made.made} built during play${churn} (${stats.frameMs.toFixed(0)} ms frame, ${made.live} programs in all, first "${made.first}")${over} Ã¢â‚¬â€ __debug.shaders() for the rest`);
      }
      this.lastPrograms = made.live;
      stats.rawDt = rawDt;
      stats.grounded = player.grounded;
      stats.vel = [player.vel.x, player.vel.y, player.vel.z];
      stats.calls = this.frameCalls;
      stats.triangles = this.frameTriangles;
      stats.pack = this.world.packStatus;
      stats.terrain = this.world.terrain.swg ? `${this.world.terrain.swg.template.name}: ${this.world.terrain.swg.syncGenerations} sync grids` : 'procedural';
      stats.chunks = this.world.chunkCount;
      input.endFrame();
    };
    frame();
  }
}

async function boot(): Promise<void> {
  const physics = await Physics.create();
  new App(physics).run();
}

void boot();
