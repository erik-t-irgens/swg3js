// The speed classes' dials (src/ui/dials.ts): every number of `LOCO_TUNE` on a slider in the debug menu when `loco`
// is picked, and its two switches beside them. Each is set through `tuneLoco`, exactly as `__debug.loco({ tune })`
// sets it, so a slider and a typed line can never mean two things, and the line the menu copies out is that helper's
// own argument (`loco({ tune: { speed: { forward: { run: 5.2 } } } })`). Every number here is how moving on foot
// feels and is the owner's to judge by hand; a slider's range is ours, wide enough to try anything sensible.
//
// Pure: it imports the tune and the dials' own types and nothing of the page, so a node test moves every dial
// through the real table.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { LOCO_CHOICES, LOCO_RANGES, LOCO_TUNE, tuneLoco } from './locoTune.ts';

/** A nested patch for one path: `speed.forward.run`, 5 is `{ speed: { forward: { run: 5 } } }`. */
function patchOf(path: string, v: unknown): Record<string, unknown> {
  const parts = path.split('.');
  const root: Record<string, unknown> = {};
  let at = root;
  for (let i = 0; i < parts.length - 1; i++) at = at[parts[i]] = {} as Record<string, unknown>;
  at[parts[parts.length - 1]] = v;
  return root;
}

function read(path: string): unknown {
  let at: unknown = LOCO_TUNE;
  for (const p of path.split('.')) at = (at as Record<string, unknown>)[p];
  return at;
}

/** A number of `LOCO_TUNE`, by its path, set through `tuneLoco`. */
function dial(path: string, label: string, step: number, unit: string, note: string, text?: (v: number) => string): NumberDial {
  const range = LOCO_RANGES[path];
  return { kind: 'number', key: `tune.${path}`, label, note, min: range.min, max: range.max, step, unit, get: () => read(path) as number, set: (v) => tuneLoco(patchOf(path, v)), text };
}

function choice(path: string, label: string, choices: readonly string[], note: string, from: (v: unknown) => string, to: (s: string) => unknown): ChoiceDial {
  return { kind: 'choice', key: `tune.${path}`, label, note, choices, get: () => from(read(path)), set: (s) => tuneLoco(patchOf(path, to(s))) };
}

const onOff = (v: unknown) => (v ? 'on' : 'off');
const isOn = (s: string) => s === 'on';
const kmh = (v: number) => `${(v * 3.6).toFixed(1)} km/h`;
const speed = (path: string, label: string, note: string) => dial(`speed.${path}`, label, 0.05, 'm/s', note, kmh);
/** A speed by its whole path (wave 2b's groups are not under `speed`). */
const speedDial = (path: string, label: string, note: string) => dial(path, label, 0.05, 'm/s', note, kmh);

const LOCO_GROUPS: DialGroup[] = [
  {
    title: 'The classes',
    note: 'Off, moving on foot is what it was before the speed classes: one run, Shift walks, and the body turns the way it runs. The walk key (Alt unless rebound) is held: it walks only while it is down.',
    dials: [
      choice('on', 'Speed classes', ['on', 'off'], 'The whole of it: off is the movement before the classes.', onOff, isOn),
      choice('gunSquare', 'Blaster up: diagonals stay square', ['on', 'off'], 'With a blaster ready or aimed a diagonal plays its own jog clip at every class and the body stays square to the view (ours). Off is the brief\'s rule with a blaster up too: the strafe or the backward clip with the body turned 45 degrees.', onOff, isOn),
      choice('sprintFight', 'A fight key while sprinting', LOCO_CHOICES.sprintFight, 'ends: the attack, the other attack, a gun\'s other trigger, the saber\'s throw or the block ends the sprint on the press and goes through, whatever is in the hands (a key that does nothing with it too); the body drops to the run, and only a fresh double tap of Shift sprints again, a let-go from before the key not counting (the owner\'s word). muted: the rule before, the attack, the other trigger and the throw do nothing while sprinting, and a block or an aim holds the pace down only while held. The ability keys and the jump never end it.', (v) => String(v), (s) => s),
      choice('sideWalkClip', 'Walking sideways plays', LOCO_CHOICES.sideWalkClip, 'diagonal: the walked forward diagonal\'s own clip (the strafe walk), the body turned 45 degrees further toward the way it goes than in the diagonal, so it stands square to the view with its legs stepping straight across. forward: the forward walk with the body turned the whole 90 degrees toward the way it goes, the torso taking back its share toward the view. strafe: the slow strafe, as before.', (v) => String(v), (s) => s),
    ],
  },
  {
    title: 'A gun out, not fighting',
    note: 'With a gun in hand and none up (no aim, no shot), what a pace plays, by the kind of gun. full: the walking or running clip has the whole body, the gun swinging in the hand. original: the game\'s own carry walk and run for that gun on the whole body, the body turned the way it runs (as before the paces), at the pace\'s speed. split: the walking or running legs under the gun\'s standing carry held still (as before this choice). Ready or aimed, nothing here applies.',
    dials: [
      choice('gunCarry.pistol', 'Pistol', LOCO_CHOICES['gunCarry.pistol'], 'The owner\'s: full.', (v) => String(v), (s) => s),
      choice('gunCarry.carbine', 'Carbine', LOCO_CHOICES['gunCarry.carbine'], 'The owner\'s: original.', (v) => String(v), (s) => s),
      choice('gunCarry.rifle', 'Rifle', LOCO_CHOICES['gunCarry.rifle'], 'Original, as the carbine.', (v) => String(v), (s) => s),
      choice('gunCarry.heavy', 'Heavy weapon', LOCO_CHOICES['gunCarry.heavy'], 'Original, as the carbine.', (v) => String(v), (s) => s),
    ],
  },
  {
    title: 'Forward',
    note: 'What each class moves the body at: the owner\'s own speeds of 2026-11-15. The clip plays at the rate that keeps its feet on the ground (each pace\'s animation speed, below, at 1), inside the slowest and fastest playback.',
    dials: [
      speed('forward.walk', 'Walk', 'The walk class: what the walk key held gives.'),
      speed('forward.jog', 'Jog', 'Forward with nothing held.'),
      speed('forward.tired', 'Tired jog', 'The jog while tired (the pool emptied and not yet back to its share).'),
      speed('forward.run', 'Run', 'Shift held.'),
      speed('forward.sprint', 'Sprint', 'Shift let go and pressed again quickly. Burns stamina; a fight key ends it (or does nothing while it lasts: the switch under The classes).'),
    ],
  },
  {
    title: 'Backward and sideways',
    dials: [
      speed('back.walk', 'Back: walk', 'Backing up at a walk.'),
      speed('back.jog', 'Back: jog', 'Backing up with nothing held.'),
      speed('back.run', 'Back: run', 'Backing up with Shift (there is no sprint but forward).'),
      speed('side.walk', 'Side: walk', 'Strafing at a walk (whatever "Walking sideways plays" plays).'),
      speed('side.jog', 'Side: jog', 'Strafing with nothing held.'),
      speed('side.run', 'Side: run', 'Strafing with Shift.'),
    ],
  },
  {
    title: 'Diagonals',
    note: 'The jogs have clips of their own. The walks and the runs are the strafes (forward) and the backward clips (backward) with the body turned 45 degrees.',
    dials: [
      speed('forwardDiag.walk', 'Forward diagonal: walk', 'Forward and to a side at a walk: the strafe walk, the body turned.'),
      speed('forwardDiag.jog', 'Forward diagonal: jog', 'Forward and to a side with nothing held.'),
      speed('forwardDiag.run', 'Forward diagonal: run', 'Forward and to a side with Shift: the strafe run, the body turned.'),
      speed('backDiag.walk', 'Backward diagonal: walk', 'Back and to a side at a walk: the backward walk, the body turned.'),
      speed('backDiag.jog', 'Backward diagonal: jog', 'Back and to a side with nothing held.'),
      speed('backDiag.run', 'Backward diagonal: run', 'Back and to a side with Shift: the backward run, the body turned.'),
    ],
  },
  {
    title: 'Shift and the feet',
    dials: [
      dial('shift.dropDelay', 'Class drops after', 0.05, 's', 'How long after Shift is let go the class drops by one, and again by one each such time, down to the jog.'),
      dial('shift.tapWindow', 'Second press within', 0.05, 's', 'Shift let go and pressed again within this raises the class by one over the class it was let go at (the run to the sprint).'),
      dial('rate.min', 'Slowest playback', 0.05, 'x', 'A clip never plays slower than this while it follows the ground speed.'),
      dial('rate.max', 'Fastest playback', 0.05, 'x', 'Nor faster than this (Force Speed raises it by its own factor).'),
      dial('rate.feet', 'Feet against the ground', 0.01, 'x', 'Every clip\'s own foot speed as a share of what the pack says: past 1 the legs play slower for the same ground speed (raise it if planted feet slip back, lower it if they slip forward).'),
    ],
  },
  {
    title: 'Each pace\'s animation speed',
    note: 'How fast each pace\'s clip plays, as a share of the speed that keeps its planted feet on the ground. 1 locks the feet to the ground whatever the pace\'s speed is. Under 1 the clip plays slower than the body moves and the feet slide forward; over 1, faster, and they slide back. Always inside the slowest and fastest playback.',
    dials: [
      dial('rate.byClass.walk', 'Walk: animation speed, 1 = feet locked', 0.01, 'x', 'The walk\'s clip, as a share of the feet-locked speed.'),
      dial('rate.byClass.jog', 'Jog: animation speed, 1 = feet locked', 0.01, 'x', 'The jog\'s clip (the tired jog\'s too), as a share of the feet-locked speed.'),
      dial('rate.byClass.run', 'Run: animation speed, 1 = feet locked', 0.01, 'x', 'The run\'s clip, as a share of the feet-locked speed.'),
      dial('rate.byClass.sprint', 'Sprint: animation speed, 1 = feet locked', 0.01, 'x', 'The sprint\'s clip, as a share of the feet-locked speed: under 1 a fast sprint with its feet sliding slightly, as the owner asked.'),
    ],
  },
  {
    title: 'Stamina',
    note: 'Points a second by what the body is doing. Emptied, the body is tired: no run or sprint, and the jog is the tired one, until the pool is back to its share.',
    dials: [
      dial('stamina.pool', 'Pool', 5, 'points', 'How much there is.'),
      dial('stamina.sprint', 'Sprinting', 0.5, '/s', 'What a second of the sprint takes.'),
      dial('stamina.run', 'Running', 0.5, '/s', 'A second of the run forward: nothing, by the brief.'),
      dial('stamina.jog', 'Jogging', 0.5, '/s', 'A second of the jog forward.'),
      dial('stamina.walk', 'Walking and standing', 0.5, '/s', 'The standard rate: walking forward, and standing.'),
      dial('stamina.back', 'Backward', 0.5, '/s', 'Backing up, at any class.'),
      dial('stamina.side', 'Sideways', 0.5, '/s', 'Strafing and the forward diagonals, from the jog up.'),
      dial('stamina.sideWalk', 'Sideways at a walk', 0.5, '/s', 'Strafing and the forward diagonals at the walk: the standard rate, by the owner\'s answer of 2026-11-15 (walking sideways gives stamina back). Nought is the brief\'s "won\'t allow for stamina regen" read to the letter.'),
      dial('stamina.air', 'Most regained in the air', 0.5, '/s', 'The most the pool regains a second off the ground and in the water. What a class spends it spends in the air too.'),
      dial('stamina.tiredUntil', 'Tired until', 0.01, '', 'Emptied, the body is tired until the pool is back to this share of itself.', (v) => `${Math.round(v * 100)}%`),
      dial('stamina.linger', 'Bar stays for', 0.1, 's', 'How long the bar stays up after the pool is full again.'),
    ],
  },
  {
    title: 'Blending and the turned body',
    dials: [
      dial('fade.loco', 'Between two classes', 0.01, 's', 'The fade between two walking or running clips, their feet kept in step.'),
      dial('fade.idle', 'Standing to moving', 0.01, 's', 'The fade between the standing idle and a walk or a run, either way.'),
      dial('fade.jka', 'Into a block or a swing', 0.01, 's', 'The fade into and out of the saber\'s own legs.'),
      dial('turn.torso', 'Torso turns back', 0.05, '', 'How much of a turned body\'s angle the spine takes back toward the view; the head\'s look takes what it can of the rest.', (v) => `${Math.round(v * 100)}%`),
      dial('turn.rate', 'Body comes round at', 0.5, '/s', 'How fast the body turns to where its clip wants it.'),
      dial('turn.aimSpine', 'Spine turns for the aim', 1, 'deg', 'With a blaster up over the classes\' legs: how far the spine turns to bring the barrel onto the crosshair before the body turns instead. At its most the body stays square to its legs.'),
      dial('fight.walkUnder', 'Block or swing: saber walk under', 0.05, 'x', 'Under a block or a swing the legs are the saber\'s own walk below this share of the speed at which its walk played fast and its run played slow are equally far from their own rates, and its run from there up. Nought: the run at every class above the walk.'),
      dial('peer.settle', 'Others change class after', 0.05, 's', 'How long another player\'s speed must have said a new class before their figure changes clip.'),
      dial('peer.hold', 'Others keep their way within', 1, 'deg', 'How far past halfway to another clip\'s way another player\'s travel must lie before their legs change way: a slope or a wall turns a body\'s travel a few degrees from its heading.'),
    ],
  },
  {
    title: 'Crouched',
    note: 'Crouched (Ctrl held): Alt held the slowest (the sneak walk), nothing held the middle (the crouched walk), Shift held the quickest (the game\'s own crouched walk); no sprint. Every way but back plays the class\'s forward clip with the body turned toward the travel (45 degrees on a diagonal, 90 sideways); backing up is Jedi Academy\'s crouched walk back, the body facing the view. Each clip plays at the rate that keeps its feet down, inside the band under Shift and the feet.',
    dials: [
      choice('crouchRule', 'Crouched', LOCO_CHOICES.crouchRule, 'classes: the three crouched speeds and their clips. before: one clip, the game\'s own crouched walk at its own pace (halved with Alt), the body turned the way it goes, as before this choice.', (v) => String(v), (s) => s),
      speedDial('crouch.forward.slow', 'Crouched, Alt held (sneak walk)', 'Started at what Alt crouched moved at before (half the game\'s crouched walk). The sneak walk\'s own feet are made for about 2.6 m/s, so here it plays at the band\'s bottom and its feet slide.'),
      speedDial('crouch.forward.normal', 'Crouched, nothing held (crouched walk)', 'Started at what crouching moved at before (the game\'s crouched walk\'s written 1.63).'),
      speedDial('crouch.forward.fast', 'Crouched, Shift held (the game\'s crouch)', 'Started at the quickest round speed the game\'s own crouched walk keeps its feet at inside the band (1.6 times its measured 1.49).'),
      speedDial('crouch.back.slow', 'Crouched back, Alt held', 'Backing up crouched (Jedi Academy\'s walk back): three quarters of the forward speed, as the standing back jog is of the forward jog.'),
      speedDial('crouch.back.normal', 'Crouched back, nothing held', 'Three quarters of the forward speed.'),
      speedDial('crouch.back.fast', 'Crouched back, Shift held', 'Three quarters of the forward speed.'),
      dial('crouch.stamina.slow', 'Stamina crouched, Alt held', 1, '/s', 'Points a second the pool regains: the walk\'s rate.'),
      dial('crouch.stamina.normal', 'Stamina crouched, nothing held', 1, '/s', 'The walk\'s rate.'),
      dial('crouch.stamina.fast', 'Stamina crouched, Shift held', 1, '/s', 'The jog\'s rate.'),
      dial('made.crouched', 'The game\'s crouched walk: its feet go', 0.01, 'm/s', 'The speed the game\'s own crouched walk\'s feet were made for (on a figure of scale 1): what its rate is worked out against. Measured 1.486 by the importer\'s own rule on the human male; the converter wrote 1.628.'),
      dial('made.crouchBack', 'Crouched walk back: its feet go', 0.01, 'm/s', 'The same for Jedi Academy\'s crouched walk back: 1.39, its planted frames\' median (its feet settle too briefly for the importer\'s rule).'),
    ],
  },
  {
    title: 'Prone',
    note: 'Prone (Z): Alt held the game\'s own crawl, nothing held the low crawl, Shift held the running crawl; no sprint. No crawl has a strafe, so the body turns the way it crawls. With a gun in hand the gun\'s own prone crawl plays at every speed.',
    dials: [
      choice('proneRule', 'Prone', LOCO_CHOICES.proneRule, 'classes: the three prone speeds and their crawls. before: the game\'s crawl at its own pace, as before this choice.', (v) => String(v), (s) => s),
      choice('proneBack', 'Backing up prone', LOCO_CHOICES.proneBack, 'today: the body turns round and crawls the way it goes. reverse: the body keeps facing the view and the class\'s crawl plays backwards (the brief\'s experiment).', (v) => String(v), (s) => s),
      speedDial('prone.forward.slow', 'Prone, Alt held (the game\'s crawl)', 'Started at the game\'s crawl\'s own pace, as prone moved before.'),
      speedDial('prone.forward.normal', 'Prone, nothing held (low crawl)', 'Started as fast as the low crawl\'s feet keep up inside the band\'s top (0.61 times 1.6).'),
      speedDial('prone.forward.fast', 'Prone, Shift held (running crawl)', 'Started at the running crawl\'s own speed on the human male: its feet locked.'),
      dial('prone.stamina.slow', 'Stamina prone, Alt held', 1, '/s', 'The walk\'s rate.'),
      dial('prone.stamina.normal', 'Stamina prone, nothing held', 1, '/s', 'The walk\'s rate.'),
      dial('prone.stamina.fast', 'Stamina prone, Shift held', 1, '/s', 'The jog\'s rate.'),
    ],
  },
  {
    title: 'The walk: gait and hurt',
    note: 'A character\'s gait (the Walk row on the appearance page, or loco({ gait })) chooses the walk\'s clips; only the walk changes. Hurt under the share below, the walk forward and to the sides is the injured walk.',
    dials: [
      dial('made.gameWalk', 'The game\'s walk: its feet go', 0.01, 'm/s', 'The speed the game\'s own walk\'s feet were made for (the gait \'game\'), on a figure of scale 1: measured 1.436 by the importer\'s rule; the converter wrote 1.549.'),
      choice('injured.rule', 'Walking hurt', LOCO_CHOICES['injured.rule'], 'walk: under the share below, the walk forward and to the sides is the injured walk (the jog and up as ever). off: as before.', (v) => String(v), (s) => s),
      dial('injured.below', 'Hurt under', 0.01, '', 'The share of the health pool under which the walk is the injured walk.', (v) => `${Math.round(v * 100)}%`),
      speedDial('injured.speed', 'The injured walk', 'Started at the injured walk\'s own measured speed: its feet locked.'),
      dial('made.injuredWalk', 'The injured walk: its feet go', 0.01, 'm/s', 'The speed the injured walk\'s feet were made for on a figure of scale 1: its index speed (0.573) fitted to the human male\'s legs (0.564), since the importer marked no foot landing in it.'),
    ],
  },
  {
    title: 'The slope',
    note: 'A face steeper than the climb limit is never ground, on the terrain and on every model alike: the body cannot stand, walk or rest on it, and slides down it. The grappling rope, the water, a ride, a flight and noclip are as ever.',
    dials: [
      choice('slopeRule', 'Faces too steep to stand on', LOCO_CHOICES.slopeRule, 'limit: past the climb limit the body slides off, landing on one slides, and the fall it slides into is paid for its speed into the ground. before: the controller called any face that points up at all ground, so the body stood on a face of any steepness.', (v) => String(v), (s) => s),
      dial('slope.climb', 'Climb limit', 1, '°', 'Steeper than this is never ground, and is not walked up: 55, the controller\'s own climb angle since the game had one.'),
      dial('slope.slide', 'Slides with this much gravity', 0.01, '', 'The share of the world\'s gravity along the face a body slides with: 1, Jedi Academy\'s own rule (a face too steep to walk on is air there, and gravity slides the body down it with no friction); less is a rougher face.', (v) => `${Math.round(v * 100)}%`),
      choice('slopeJump', 'Jumping off a steep face', LOCO_CHOICES.slopeJump, 'refused: no plain jump off a face too steep to stand on (jumping up such a face was how a body climbed it, the fault being mended). allowed: the plain jump off it, as from the ground. A Jedi\'s own moves off a wall in the air are the air\'s.', (v) => String(v), (s) => s),
      dial('slope.fade', 'Falling loop comes in over', 0.01, 's', 'How fast the falling loop takes the body as a slide begins: 0.18, the rig\'s own fade for any change of clip.'),
      choice('slopeCrease', 'Falling into a steep face\'s foot', LOCO_CHOICES.slopeCrease, 'floor: a body that falls into the crease where a face too steep to stand on meets the floor ends on the floor (wave 3). before: it could rest leaning on the face 8 to 32 cm up.', (v) => String(v), (s) => s),
    ],
  },
  {
    title: 'The feet on the ground',
    note: 'Each foot\'s ground found under where the clip puts it, the leg bent so the sole meets it, the foot turned to its slope, and the pelvis lowered by as much as the lower foot needs (never raised). On the player and other players near the camera; standing on feet on the ground only.',
    dials: [
      choice('ik.rule', 'Feet on their ground', LOCO_CHOICES['ik.rule'], 'placed: each foot on what is under it. before: the clip\'s feet wherever they fall, as before this wave.', (v) => String(v), (s) => s),
      choice('ik.eye', 'First-person eye', LOCO_CHOICES['ik.eye'], 'steady: the view does not drop with the pelvis on a slope or stairs. follow: the eye on the drawn head, drop and all.', (v) => String(v), (s) => s),
      dial('ik.pitchMost', 'A foot pitches at most', 1, '°', 'How far a foot turns to its slope front to back: 35, a little over a walkable ramp\'s lean.'),
      dial('ik.rollMost', 'A foot rolls at most', 1, '°', 'How far a foot turns to its slope side to side: 20, less than its pitch, as an ankle\'s is.'),
      dial('ik.pelvisMost', 'The pelvis drops at most', 0.01, 'm', 'How far the pelvis is lowered for the lower foot at most: 0.4, a riser and a half.'),
      dial('ik.ease', 'Comes in and goes over', 0.01, 's', 'How fast the placement comes in and goes out as the feet take and leave the ground, each foot\'s own planting comes in, a sudden change of a planted foot\'s ground (a riser\'s edge crossed under it) slides in, and the pelvis comes back up: 0.08, about five frames at 60. Nought snaps.'),
      dial('ik.plantLow', 'Planted whole under', 0.005, 'm', 'A foot at or under this over its own resting height in the clip is planted whole: 0.04, a walk\'s heel and toe both down.'),
      dial('ik.plantHigh', 'Swinging over', 0.005, 'm', 'A foot at or over this over its resting height swings as the clip has it: 0.15, a walk\'s lifted foot.'),
      dial('ik.stairBack', 'Stairs: planted going back', 0.01, 'm/s', 'On a stair clip (whose planted foot climbs a tread a step in the clip, so its height says nothing) a foot going back under the body at least this fast, in the figure\'s own frame, is planted whole: 0.1.'),
      dial('ik.stairAhead', 'Stairs: swinging going ahead', 0.01, 'm/s', 'On a stair clip a foot going ahead at least this fast swings: 0.3.'),
      dial('ik.toeMost', 'A toe bends at most', 1, '°', 'How far a toe bends to meet its own ground on a step\'s edge: 30.'),
      dial('ik.edgePull', 'Drawn in from an edge at most', 0.01, 'm', 'A foot over nothing is drawn in toward the body\'s middle until it stands on the edge, at most this: 0.25.'),
      dial('ik.peerReach', 'Others placed within', 1, 'm', 'Other players\' feet are placed within this of the camera: 40.'),
      choice('ik.hips', 'The hips', LOCO_CHOICES['ik.hips'], 'steady: the hips stand at the clip\'s own height over the ground where the body stands now (on stairs the line through their treads\' middles), the legs bend and stretch to their grounds, and the hips drop only by what a stretched leg with its toe pointed still cannot reach, held over a step. before: the pelvis lowered each frame for the lower foot, as before the stairs wave (the body bobbing on a hill).', (v) => String(v), (s) => s),
      dial('ik.hipEase', 'Hips: follow a step over', 0.01, 's', 'How fast the ground the hips stand over is followed past its own slope (a kerb, the stairs come onto), and a drop the legs ask for comes in: 0.25, about a step.'),
      dial('ik.hipRelease', 'Hips: let a drop go over', 0.01, 's', 'How fast a drop the legs asked for goes back out: 0.6, slower than it came, so a steady slope\'s drop is held.'),
      dial('ik.hipHold', 'Hips: hold a drop for', 0.01, 's', 'The drop asked is the most either foot asked over this long: 1.5, a whole cycle of both feet at the walk and the jog, so no footfall pumps it (a step alone let it go between the jog\'s two feet, which ask differently).'),
      dial('ik.stretch', 'A leg stretches to', 0.01, '', 'A downhill leg reaches this share of its whole length before the hips drop: 0.98 (the clip\'s own leg at heel strike is near straight).', (v) => `${Math.round(v * 100)}%`),
      dial('ik.toeReach', 'A toe points to make up', 0.01, '', 'And points its toe (the heel up) to make up at most this share of its foot\'s length, once the clip has it on its ball: 0.5.', (v) => `${Math.round(v * 100)}%`),
      dial('ik.soleLow', 'Hips steady: planted whole under', 0.001, 'm', 'Under the steady hips, a foot is planted whole once its lower sole point (heel or ball) is this over the clip\'s ground: 0.005, as the clip puts it down.'),
      dial('ik.soleHigh', 'Hips steady: swinging over', 0.001, 'm', 'And swings as the clip has it at or over this: 0.025, under a walk\'s middle swing (2.5 cm), so a swinging foot is never pulled down and the hips never drop for it.'),
    ],
  },
  {
    title: 'Stairs',
    note: 'Stairs found from the ground\'s heights along the travel (never a mesh\'s name), and walked up and down by the stair clips standing and going forward only; and the drawn body\'s height eased over a step\'s pop at any kerb (the capsule and what others are sent untouched).',
    dials: [
      choice('stairs.rule', 'Stairs', LOCO_CHOICES['stairs.rule'], 'stairs: the rule, the stair clips and the drawn height\'s ease. before: none of it, as before this wave.', (v) => String(v), (s) => s),
      choice('stairs.ways', 'Which ways take the stair clips', LOCO_CHOICES['stairs.ways'], 'forward: straight ahead only (the brief\'s "ALWAYS forward"). forwardDiag: the forward diagonals too, the body turned 45 degrees as the walk diagonals turn it.', (v) => String(v), (s) => s),
      choice('stairs.camera', 'The chase camera follows', LOCO_CHOICES['stairs.camera'], 'smooth: the drawn body\'s eased height. capsule: the capsule\'s, its pop at each step and all.', (v) => String(v), (s) => s),
      dial('stairs.pace', 'Pace on stairs', 0.01, '', 'Under one step a stair: a share between the stair clip\'s own pace for stairs of this size (0: one clip step every n treads at its own rate) and the class\'s speed (1), then held to the rate band below: 0.25, toward the clips\' pace ("the animation speeds are good"). Under its before, the class\'s own speed.', (v) => `${Math.round(v * 100)}%`),
      choice('stairs.cycle', 'Stair clips played round', LOCO_CHOICES['stairs.cycle'], 'trimmed: each clip\'s measured window that loops cleanly (the upstairs clips whole, their seam spread to nothing; a downstairs clip\'s one step and its mirror). before: the clips untrimmed (a downstairs clip\'s ankles jumping 0.3 to 0.5 m at each wrap).', (v) => String(v), (s) => s),
      choice('stairs.mirror', 'Going down: the other step', LOCO_CHOICES['stairs.mirror'], 'legs: the legs and hips mirrored, the spine, arms and head keeping the clip\'s own turn. whole: the whole body mirrored. off: the same foot every step, the clip as it stands.', (v) => String(v), (s) => s),
      choice('stairs.stepRule', 'One step a stair', LOCO_CHOICES['stairs.stepRule'], 'stairs: the clip\'s phase driven by the distance along the stairs, each planted foot on a tread, n treads a step, the stride reached to the treads, the speed matched. before: the class\'s speed, the rate held at the band\'s top and the feet sliding.', (v) => String(v), (s) => s),
      choice('stairs.perStep', 'Treads a step', LOCO_CHOICES['stairs.perStep'], 'auto: by the stairs\' size against the clip\'s own step, one more where the clip would outrun the band, held on a flight. 1, 2, 3: forced.', (v) => String(v), (s) => s),
      choice('stairs.pin', 'A planted foot on a stair', LOCO_CHOICES['stairs.pin'], 'sole: held where its sole stands (its heel or its ball, whichever the clip has lower), eased out as it lifts, so the clip\'s uneven stance never slides it along its tread. off: the clip\'s own foot.', (v) => String(v), (s) => s),
      dial('stairs.nMost', 'Auto: at most', 1, 'treads', 'Under auto, at most this many treads a step: 2 (3 allowed: a long run up shallow stairs).'),
      dial('stairs.upAt', 'Auto: a tread more past rate', 0.01, '', 'Under auto, a step takes a tread more where the clip\'s rate at the speed asked would pass this: 1.4, the band\'s top (past it the speed would be cut).'),
      dial('stairs.resize', 'Auto: choose again past', 0.01, '', 'Under auto, the treads a step takes are chosen again on a flight only once its tread or riser changed by this share: 0.15.', (v) => `${Math.round(v * 100)}%`),
      dial('stairs.land', 'A foot lands along its tread', 0.01, '', 'Where on its tread each planted foot lands, from its riser: 0.5, the tread\'s middle (never over a nosing).', (v) => `${Math.round(v * 100)}%`),
      dial('stairs.rateLow', 'Stair clip\'s rate at least', 0.01, '', 'The stair clip\'s rate is held within this and the next, so the speed is what they allow: 0.7.'),
      dial('stairs.rateHigh', 'Stair clip\'s rate at most', 0.01, '', 'And at most this: 1.4.'),
      dial('stairs.steer', 'A footfall steered from', 0.01, '', 'Each footfall is steered onto its tread as the body goes toward it; one nearer than this share of a step lands where it lands and the next is steered: 0.25 (under it the clip would have to race or stall).', (v) => `${Math.round(v * 100)}%`),
      dial('stairs.clear', 'A swinging foot clears a nosing by', 0.005, 'm', 'A swinging foot passes over each nosing by at least this: 0.04 (a toe\'s clearance).'),
      dial('stairs.ease', 'A step\'s pop eased over', 0.01, 's', 'How fast the drawn body\'s height catches the capsule\'s after a step pops it: 0.12. Nought draws the pop.'),
      dial('stairs.lagMost', 'Never more behind than', 0.01, 'm', 'The drawn body is never more than this off the capsule\'s height: 0.5, the autostep\'s height.'),
      dial('stairs.look', 'Looks along the travel', 0.05, 'm', 'The window the ground is sampled over, half behind and half ahead: 1.6.'),
      dial('stairs.step', 'Every', 0.01, 'm', 'A sample of the ground every this along the travel: 0.1.'),
      dial('stairs.riserMin', 'A riser is at least', 0.01, 'm', 'A rise or a fall of at least this is a riser: 0.08 (under it is a bump).'),
      dial('stairs.riserMax', 'And at most', 0.01, 'm', 'And at most this: 0.5, the autostep\'s height (more is a wall or a ledge).'),
      dial('stairs.riserRun', 'Over less than', 0.01, 'm', 'A riser rises over less than this much ground: 0.12 (steeper than any ramp a body walks).'),
      dial('stairs.level', 'A tread is level within', 0.005, 'm', 'Ground level within this between two samples is a tread: 0.03.'),
      dial('stairs.treadMin', 'A tread is at least', 0.01, 'm', 'Between two risers, at least this long: 0.18 (a narrow stair).'),
      dial('stairs.count', 'Stairs are at least', 1, 'risers', 'This many risers the same way in the window: 2 (a single kerb is no stairs).'),
      dial('stairs.leave', 'Off stairs after', 0.05, 'm', 'Still on stairs until this far is travelled with no riser in the window: 0.5.'),
      dial('made.stairsUp', 'Walking up: its feet go', 0.01, 'm/s', 'The speed the walking-up clip\'s feet were made for along the stairs (scale 1): 0.365, measured off the human male\'s rig with the climb taken out.'),
      dial('made.stairsRunUp', 'Running up: its feet go', 0.01, 'm/s', 'The running-up clip\'s: 0.749.'),
      dial('made.stairsDown', 'Walking down: its feet go', 0.01, 'm/s', 'The walking-down clip\'s: 0.485.'),
      dial('made.stairsRunDown', 'Running down: its feet go', 0.01, 'm/s', 'The running-down clip\'s: 1.119.'),
    ],
  },
];

/** The dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const LOCO_DIALS: DialSet = { helper: 'loco', groups: LOCO_GROUPS, shipped: readDials(LOCO_GROUPS) };

/** The dials `__debug.loco` has, or null: what the debug menu asks as a helper is picked. */
export function locoDialsFor(helper: string): DialSet | null {
  return helper === 'loco' ? LOCO_DIALS : null;
}
