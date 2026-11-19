// The climbing's dials (src/ui/dials.ts): every number of `CLIMB_TUNE` on a slider in the debug menu when `climb` is picked,
// and its switch beside them. Each is set through `tuneClimb`, exactly as `__debug.climb({ tune })` sets it, so a slider and
// a typed line can never mean two things, and the line the menu copies out is that helper's own argument
// (`climb({ tune: { stamina: { hang: 2 } } })`). Every number here is how hanging and climbing feel and is the owner's to
// judge by hand; a slider's range is the table's own (`CLIMB_RANGES`). Maker B's groups (wall climbing, the hands' bracing)
// join `CLIMB_GROUPS` beside these.
//
// Pure: it imports the tune and the dials' own types and nothing of the page, so a node test moves every dial through the
// real table.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { CLIMB_CHOICES, CLIMB_RANGES, CLIMB_TUNE, tuneClimb } from './climbTune.ts';

/** A nested patch for one path: `stamina.hang`, 2 is `{ stamina: { hang: 2 } }`. */
function patchOf(path: string, v: unknown): Record<string, unknown> {
  const parts = path.split('.');
  const root: Record<string, unknown> = {};
  let at = root;
  for (let i = 0; i < parts.length - 1; i++) at = at[parts[i]] = {} as Record<string, unknown>;
  at[parts[parts.length - 1]] = v;
  return root;
}

function read(path: string): unknown {
  let at: unknown = CLIMB_TUNE;
  for (const p of path.split('.')) at = (at as Record<string, unknown>)[p];
  return at;
}

/** A number of `CLIMB_TUNE`, by its path, set through `tuneClimb`. */
function dial(path: string, label: string, step: number, unit: string, note: string): NumberDial {
  const range = CLIMB_RANGES[path];
  return { kind: 'number', key: `tune.${path}`, label, note, min: range.min, max: range.max, step, unit, get: () => read(path) as number, set: (v) => tuneClimb(patchOf(path, v)) };
}

function choice(path: string, label: string, note: string): ChoiceDial {
  return { kind: 'choice', key: `tune.${path}`, label, note, choices: CLIMB_CHOICES[path], get: () => String(read(path)), set: (s) => tuneClimb(patchOf(path, s)) };
}

export const CLIMB_GROUPS: DialGroup[] = [
  {
    title: 'Ledges',
    note: 'before: the body as it was before the ledges (nothing is felt for, nothing grabbed). on: a lip in reach in the air is grabbed, hung from braced (feet on the wall) or free, shimmied along with A and D, hopped from with Space and a side or W, climbed with Space or W, dropped from with the crouch key and jumped off backward with S and Space.',
    dials: [
      choice('ledges', 'Ledges', 'The whole of it: before is the body as it was.'),
      dial('grabFall', 'Grabs while falling no faster than', 0.5, 'm/s', 'The brief\'s 12: falling faster, a lip in reach is passed.'),
      dial('reachLow', 'Hands reach from', 0.01, 'm', 'Over the feet, on the human male (scaled by the figure): 1.62, the rest pose\'s head.'),
      dial('reachHigh', 'Up to', 0.01, 'm', '2.285, the free hang\'s own grip over its feet: a standing jump grabs a top up to 3.15 m over the ground.'),
      dial('reachAhead', 'A face as far ahead as', 0.01, 'm', 'From the body\'s middle: 0.75, the braced hang\'s own 0.38 and an arm\'s bend more.'),
      dial('regrab', 'Not the same lip again for', 0.05, 's', 'After a let-go, a drop or a jump off: 0.4.'),
    ],
  },
  {
    title: 'The hands',
    dials: [
      dial('gripDrop', 'Grip under the top', 0.005, 'm', 'Measured off the climbs (their feet end on the top their hands started on): 0.06.'),
      dial('gripOut', 'Grip out from the face', 0.005, 'm', 'The knuckles over the edge: 0.03.'),
      dial('ease', 'Hands and feet ease in over', 0.01, 's', 'And the figure\'s line-up between two clips: 0.15.'),
    ],
  },
  {
    title: 'Moving on the lip',
    dials: [
      dial('shimmy', 'Shimmy pace', 0.05, 'of the clip\'s', '1: the clip\'s own (braced 0.48 m/s, free 0.27 to 0.28), so its hands keep their holds.'),
      dial('edgeAhead', 'Stops short of a lip\'s end by', 0.01, 'm', 'Felt for ahead of the leading hand: 0.12, a hand\'s width.'),
      dial('hopSide', 'A hop reaches sideways', 0.05, 'm', 'The brief\'s 1.5, to any lip that way (another face across a gap too); the slider goes to 8. With hops band, measured across the gap from the held lip\'s end.'),
      dial('hopUp', 'And up', 0.05, 'm', 'The brief\'s 1.5; to 8.'),
      dial('lipSlope', 'Shimmies up or down a lip as steep as', 1, 'deg', 'The owner\'s 35: the leading hand stops where the lip grows steeper.'),
      dial('lipTilt', 'The body turned with a sloping lip by', 0.05, 'of its slope', 'Ours, half: how much of the slope the hanging body leans with.'),
    ],
  },
  {
    title: 'Stamina',
    note: 'Wave 2a\'s pool of 100: hanging and shimmying drain it, a hop takes a share at once, and an empty pool lets go (no grab again until it is back to its share).',
    dials: [
      dial('stamina.hang', 'Hanging costs', 0.5, '/s', 'The brief\'s 3.'),
      dial('stamina.shimmy', 'Shimmying costs', 0.5, '/s', 'The brief\'s 5.'),
      dial('stamina.hop', 'A hop costs', 1, '', 'The brief\'s 12.'),
    ],
  },
  {
    title: 'Letting go',
    dials: [
      dial('dropCut', 'A drop\'s clip plays for', 0.05, 's', 'Before the falling loop takes the body: 0.3.'),
      dial('jumpBack', 'Jumping off: back at', 0.1, 'm/s', 'From the clip\'s own flight under the game\'s gravity: 3.'),
      dial('jumpUp', 'And up at', 0.1, 'm/s', '6.25.'),
      dial('freePush', 'A free hang\'s push back', 0.1, 'm/s', 'S and Space from a free hang (no clip of its own): 1.5.'),
    ],
  },
  {
    title: 'Wall climbing',
    note: 'before: the body as it was before the wall climb (nothing is felt for, nothing climbed). on: W held into a face steeper than the climb limit and no steeper than upright, pressed against it, climbs it: W up, S down, A and D sideways, onto a ledge at its lip (W still held climbs on up), the crouch key lets go, Space jumps off backward. Stamina drains while on the wall, and an empty pool lets go.',
    dials: [
      choice('wall', 'Wall climbing', 'The whole of it: before is the body as it was.'),
      dial('wallStart', 'Starts after pressing in for', 0.05, 's', 'The brief\'s 0.25: a brush along a wall never starts it.'),
      dial('wallSpeed.up', 'Climbs up at', 0.05, 'm/s', 'The brief\'s 1, along the face: the clip plays at 1.69 (its planted hands slide 0.592 m/s), so they stay put.'),
      dial('wallSpeed.down', 'Down at', 0.05, 'm/s', 'The brief\'s 1.2: the down clip at 2.05 (its hands 0.586 m/s).'),
      dial('wallSpeed.side', 'Sideways at', 0.05, 'm/s', 'The brief\'s 0.8 (no clip of its own: the up clip at 1.35).'),
      dial('wallStamina.climb', 'Climbing costs', 0.5, '/s', 'The brief\'s 8.'),
      dial('wallStamina.still', 'Holding still costs', 0.5, '/s', 'The brief\'s 4.'),
    ],
  },
  {
    title: 'Climbing II: the controls',
    note: 'Each switch\'s other word is the climbing as it was. Grab use: a lip is grabbed and a wall climbed only while E (the use key, when nothing else in reach takes it, or falling) is held; W at a ledge hops up to a lip above, else climbs onto the top; Space with nowhere to hop jumps a little up and off the wall; hops look for the nearest lip in the asked way within these reaches; a step along a lip up to the step\'s most is crossed hand by hand.',
    dials: [
      choice('grab', 'Grabbing and wall climbing', 'use: on E (pressed or held); auto: as before (moving at a lip in the air, W pressed into a wall).'),
      choice('wUp', 'W at a ledge', 'hop: up to a lip above where there is one, else onto the top; before: onto the top.'),
      choice('spaceOff', 'Space with nowhere to hop', 'jump: a small jump up and off the wall; before: Space alone climbs up.'),
      choice('hops', 'Where a hop looks', 'band: the asked way with a tolerance either side and up and down, the nearest lip taken; before: as it was.'),
      choice('steps', 'Steps along a lip', 'hands: crossed hand by hand up to the step\'s most; before: a step is the lip\'s end.'),
      dial('offUp', 'The small jump off rises', 0.05, 'm', 'Ours: 0.4, half a plain jump\'s 0.8 m apex.'),
      dial('offPush', 'And pushes off the wall at', 0.1, 'm/s', 'The free hang\'s own push back: 1.5.'),
      dial('hopDown', 'A hop reaches down', 0.05, 'm', 'Ours: 1.5, as far as up reaches.'),
      dial('hopSlack', 'Up or down, either side by', 0.05, 'm', 'Ours: 0.75, the hands\' span and a hand more.'),
      dial('hopDepth', 'A face in front of or behind by', 0.05, 'm', 'Ours: 0.5, a stepped wall\'s 0.3 setback with room.'),
      dial('hopArc', 'A hop\'s way rises at its middle by', 0.01, 'of its length', 'Ours: 0.1, a 3 m hop rising 0.3 m.'),
      dial('stepMax', 'A step along a lip crossed up to', 0.01, 'm', 'The owner\'s 0.5.'),
      dial('useReach', 'E reaches for a lip as far ahead as', 0.01, 'm', 'Ours: 0.95, a little past where the wall climb feels for a face (0.8 to 0.93), so a lip over a wall in reach is grabbed rather than climbed to.'),
    ],
  },
  {
    title: 'Climbing II: the wall and looking away',
    note: 'Each switch\'s other word is the climbing as it was. On a wall A or D alone plays the braced shimmy clips, and every hand and foot the clip plants is held where it was planted until that limb\'s next reach, one limb reaching at a time. Braced and still, looking away past the threshold turns the spine toward the view, the leading hand leaves the lip into the hop clip\'s coil and reaches toward the view, and Space hops to a lip behind that way, else jumps a little off the wall.',
    dials: [
      choice('wallSide', 'Sideways on a wall', 'shimmy: the braced shimmy clips; before: the up clip slowed.'),
      choice('wallLimbs', 'Hands and feet on a wall', 'held: each held where it was planted until its next reach, one at a time; before: put where the clip has it, frame by frame.'),
      dial('holdMost', 'A held limb reaches anyway once the body has moved', 0.01, 'm', 'Ours: 0.3, a forearm, from where the clip has it.'),
      choice('lookAway', 'Looking away while braced', 'reach: the spine turns, the leading hand leaves the lip, Space hops behind; before: the view is free.'),
      dial('lookStart', 'Begins once the view turns past', 1, 'deg', 'Ours: 100, a little past square to the wall, so a glance along it never lets go.'),
      dial('lookTwist', 'The spine turns toward it by at most', 1, 'deg', 'Ours: 40, the hips still to the wall; the rig\'s own clamp is 69.'),
      dial('lookPose', 'The reach-back pose from the hop clip at', 0.01, 's', 'Its coil: the hips risen, the arms bent, the hands still on the lip (they leave at 0.35 to 0.45 s).'),
      dial('lookArm', 'The leading hand reaches toward the view by', 0.05, 'of the way', 'Ours: 0.6; nought leaves it where the held pose has it.'),
      dial('hopBehind', 'A hop behind reaches', 0.05, 'm', 'Ours: 3, twice the side hop\'s start.'),
    ],
  },
  {
    title: 'Climbing II: the faults mended',
    note: 'Each switch\'s other word is the climbing as it was (CLIMB1-notes\' faults). corners ramp: a corner turns the hands\' faces over the same span either side of it, so the heading at a corner\'s lip is the place\'s, at any frame rate. thinTop hang: a top shallower than the least depth is no top to stand on. slopeLimit inclusive: a lip exactly as steep as the limit is shimmied along. grabSweep swept: a lip the reach band passed during the frame is grabbed, at any frame rate.',
    dials: [
      choice('corners', 'Corners along a lip', 'ramp: the same span either side at any rate; before: as the rail\'s sampling put it.'),
      choice('thinTop', 'A thin top', 'hang: refused, the body hangs; before: climbed onto.'),
      dial('topMin', 'A top to stand on is at least', 0.01, 'm', 'Ours: 0.35 behind its lip, the body\'s own capsule radius.'),
      choice('slopeLimit', 'A lip exactly at the slope limit', 'inclusive: shimmied along; before: refused at its foot.'),
      choice('grabSweep', 'The grab\'s reach band', 'swept: over the frame\'s whole rise or fall; before: where the frame ended.'),
    ],
  },
  {
    title: 'Climbing II: the grab and the climb up',
    note: 'Each switch\'s other word is the climbing as phase 2 left it. grabFree share: from a share of the grab\'s clip on, the hang takes the keys (a shimmy, W, a hop, Space, the crouch, the look-away), the grab blended into what was asked; a key pressed earlier in the grab waits for it. roomSay why: a climb up refused says which test failed and what it met. roomRule fit: where the whole climb up does not fit, a shorter one is tried (ending nearer the lip, tucked crouched, over the lip lower, then all of them with a brush allowed) before it is refused.',
    dials: [
      choice('grabFree', 'A grab takes the keys', 'share: from the share below on; whole: only once its clip is done.'),
      dial('grabFreeAt', 'From this share of the grab\'s clip', 0.01, 'of its length', 'The round\'s 0.35: the hands are on the lip by then in the braced and free grabs.'),
      choice('roomSay', 'A refused climb up says', 'why: which test failed and what it met, and how far into it; before: only that there is no room.'),
      choice('roomRule', 'A climb up that does not quite fit', 'fit: climbed short (nearer, tucked, lower, then brushing); strict: refused.'),
      dial('roomBrush', 'A short climb may brush what stands by', 0.005, 'm', 'The round\'s 0.04: under a hand\'s thickness.'),
      dial('liftLeast', 'A lower way in over the lip lifts the feet at least', 0.005, 'm', 'Ours: nought (the climb\'s own 0.02 of skin still under the feet); the whole climb lifts 0.05.'),
    ],
  },
  {
    title: 'Climbing II: shallow lips and the hang\'s keys',
    note: 'Each switch\'s other word is the climbing as the feedback round left it. shelves grab: a lip is the top edge of any face whose top runs back far enough with room for the hands over it, so a ladder\'s rung, a shelf with its next tier behind it and a sill are grabbed, hung from and hopped to. hangKeys cue: hold a way to look for a move (W where you look: up at the wall, a side past the turn below, behind past the look-away\'s threshold; A and D their own side; S down); a hold at a ladder-like distance is climbed to by the key alone, a lip further is shown by the body (a pull-up, a lean, the reach back, the drop\'s hand lowered) only while the key is held, and Space takes it; with nothing shown Space jumps a little off; W with nothing up climbs onto the top; a tap of crouch drops to the lip beneath, held it lets go fully. Nothing of it is on the action bar.',
    dials: [
      choice('shelves', 'Shallow lips', 'grab: a rung, a shelf, a sill is a lip; before: a lip with anything over its reach is none.'),
      dial('shelfMin', 'A lip\'s top runs back at least', 0.01, 'm', 'The round\'s 0.12 before anything rises behind it: the fingers and a knuckle.'),
      dial('handRoom', 'With room over it for the hands of', 0.01, 'm', 'The round\'s 0.15: a hand curled over the top, and a little.'),
      choice('hangKeys', 'The hang\'s keys', 'cue: hold a way, the body shows it, Space takes it; before: phase 2\'s keys.'),
      dial('wayTurn', 'W means a side once the view turns past', 1, 'deg', 'Ours: 45 from the wall, half way to square.'),
      dial('ladderMin', 'A hold is ladder-like from', 0.01, 'm', 'The round\'s 0.3: nearer is the same hold.'),
      dial('ladderMax', 'Up to', 0.01, 'm', 'The round\'s 1.1: the course\'s 0.75 and 1 m ladders are climbed by the key, 1.25 m and over are hops.'),
      dial('wayDepth', 'A lip up or down may stand in front or behind by', 0.05, 'm', 'Ours: 0.8, the owner\'s shelves step 0.6 back, and a hand more.'),
      dial('cueShare', 'A hop\'s cue holds its coil at', 0.05, 'of the coil', 'Ours: half of it (the hands leave the lip about 0.35 s in): a slight pull-up.'),
      dial('cueEase', 'A cue eases in and out over', 0.01, 's', 'Ours: 0.2, the hang\'s own ease and a little more.'),
      dial('cueLean', 'A side\'s cue leans the body that way by', 0.5, 'deg', 'Ours: 8, a slight lean, a shimmy still playing under it.'),
      dial('dropMost', 'Crouch drops to a lip beneath within', 0.05, 'm', 'The round\'s 2.5.'),
      dial('dropHold', 'Crouch held longer than this lets go fully', 0.01, 's', 'The round\'s 0.25: a tap is quicker.'),
      choice('diagonals', 'A diagonal (W or S with A or D)', 'below: W with a side takes a lip over the hands, S with a side one under them (a level lip is the side key\'s alone); before: phase 2\'s band, 0.3 m either way.'),
    ],
  },
  {
    title: 'Climbing II: hops timed to the hands, transitions, the camera',
    note: 'Each switch\'s other word is the climbing as the smoothness round left it. hopFlight timed: a hop, a grab and a step down carry the body only between the clip\'s own moments (the hands leaving the held lip, the hands touching the new one: the owner\'s timings, else the clip\'s measure), on a thrown body\'s arc, so the hands are on the new lip as the clip\'s touch; a drop\'s clip is never played faster than its own rate. transitions blend: a one-off crossfades straight into the loop that follows before its own end, the loop started where its pose is nearest. camera eased: while climbing the camera follows the body eased, and a pull-in at a wall is let out eased. slopeHands each: on a sloping lip each hand grips the lip at its own place from the grab\'s touch on.',
    dials: [
      choice('hopFlight', 'Hops and grabs', 'arc: a hop flies the time a thrown body\'s arc takes, the clip slowed and held just before its touch while it waits for the contact (grabs as timed; its numbers under Smoothness III); timed: the body in the air only between the clip\'s hands leaving and touching, at the clip\'s pace; before: carried over the whole clip.'),
      dial('flightRateMin', 'A clip\'s flight played no slower than', 0.05, 'of its rate', 'Ours: 0.7; slower reads as slow motion.'),
      dial('flightRateMax', 'And no quicker than', 0.05, 'of its rate', 'Ours: 1.5; quicker reads as a snap.'),
      dial('flightLift', 'A hop\'s way rises over the straight way by', 0.01, 'of its length', 'Ours: the band\'s own 0.1, a 3 m hop rising 0.3 m; an up hop rises at least to its new lip (it slows to its top).'),
      dial('grabLead', 'A grab caught in the air shows its reach for', 0.01, 's', 'Ours: 0.2, about the owner\'s grabs\' own reach before their touch.'),
      dial('dropRateLeast', 'A drop\'s fall played no slower than', 0.05, 'of its rate', 'Ours: 0.35; a longer fall holds its last frame until the feet land.'),
      choice('transitions', 'Into and out of a hang', 'blend: crossfaded before the one-off ends, the loop from its nearest pose; before: held, then faded through the clip before it.'),
      dial('transitionBlend', 'Crossfaded over', 0.01, 's', 'Ours: 0.25, a little more than the hang\'s own ease.'),
      dial('poseJump', 'The measure: a bone faster than this many times the clips\' own is a jump', 0.1, '', 'Ours: 2 (the console\'s and the tests\' measure, not the feel).'),
      choice('camera', 'The camera while climbing', 'eased: follows the body eased, a wall\'s pull-in let out eased; before: the body\'s own place.'),
      dial('camEase', 'The camera catches the body over', 0.01, 's', 'Ours: 0.12, settling in about a third of a second.'),
      dial('camOut', 'Pulled in by a wall, it goes back out over', 0.05, 's', 'The race view\'s own 0.5: in at once, out eased.'),
      dial('camJump', 'The measure: a camera move this many times the follow\'s own is a snap', 0.1, '', 'Ours: 3 (the tests\' measure, not the feel).'),
      choice('slopeHands', 'Hands on a sloping lip', 'each: each hand on the lip at its own place from the grab\'s touch; before: as the smoothness round had them.'),
    ],
  },
  {
    title: 'Climbing II: Smoothness III, a hop\'s arc, the room under a target, a drop\'s own move',
    note: 'Each switch\'s other word is the climbing as Smoothness II left it (hopFlight\'s is timed, above). hopFlight arc: a hop\'s flight takes the time its arc takes under the gravity below, rising the height below over the higher of its two ends (a drop to a lip beneath falls from rest), the clip played at its own pace before the hands leave and after they touch and its flight slowed (to the slowest above) and held just before the touch until the body arrives. targetRoom fit: a lip whose hanging body would stand in the ground or anything still is no target for a grab, a hop, a drop or a step along it, and a hop\'s way is checked for the ground too. dropMove drop: a drop to a lower lip plays its own move, the held hang\'s drop clip through its release into the fall, then the catch into the lower hang (the parts\' seconds below, the clips the owner\'s table DROP_PARTS); reverse: the hop up played backward; hop: the side hop as before.',
    dials: [
      dial('flightGravity', 'A hop\'s arc is worked out under a gravity of', 0.1, 'm/s²', 'The game\'s own on foot, 20.32 (Jedi Academy\'s 800 units).'),
      dial('arcRise', 'And rises over its higher end by', 0.05, 'm', 'Ours: 0.5, the brief\'s own example (a 3 m hop taking about the time a half metre\'s rise and fall does).'),
      dial('holdEase', 'A clip waiting for the hands\' contact eases into and out of its hold over', 0.01, 's', 'Ours: 0.1, about three of the clip\'s own frames.'),
      choice('targetRoom', 'A lip\'s room for the hanging body', 'fit: no grab, hop, drop or step to a lip whose hang stands in the ground or anything still; none: only what a shape test finds, as before.'),
      choice('dropMove', 'A drop to a lip beneath', 'drop: its own move, the drop clip through its release, then the catch; reverse: the hop up backward; hop: the side hop, as before.'),
      dial('dropParts.bracedFrom', 'Braced: its drop clip from', 0.01, 's', 'The start of braced_hang_drop (the owner\'s table names the clip).'),
      dial('dropParts.bracedTo', 'To', 0.01, 's', 'Ours: 0.6, a quarter second past its hands\' release (the owner\'s 0.35), well before its feet meet its own ground (his 0.81).'),
      dial('dropParts.freeFrom', 'Free: its drop clip from', 0.01, 's', 'The start of freehang_drop.'),
      dial('dropParts.freeTo', 'To', 0.01, 's', 'Ours: 0.45, past its hands\' release (0.233 measured), short of its feet\'s touch (0.533).'),
      dial('dropParts.catchBracedFrom', 'Caught braced: the catch from', 0.01, 's', 'The start of jumping_to_hanging ("starts by falling/approaching the ledge"); its touch the owner\'s 0.28.'),
      dial('dropParts.catchBracedTo', 'To', 0.01, 's', 'Its end, 1.5, into the braced hang.'),
      dial('dropParts.catchFreeFrom', 'Caught free: the catch from', 0.01, 's', 'The start of jump_to_hang; its touch the owner\'s 0.26.'),
      dial('dropParts.catchFreeTo', 'To', 0.01, 's', 'Its end, 2, into the free hang.'),
    ],
  },
  {
    title: 'Climbing II: Smoothness III, free hops up and down, the ladder\'s cycle',
    note: 'Each switch\'s other word is the climbing as Smoothness II left it. freeHops on: a free hang hops up as a braced one does, braced_hang_hop_up\'s arms (between the seconds below) over the free hang\'s own legs, timed by the hop\'s arc, and drops to a lip beneath by the drop\'s own move; off: a free hang only shimmies and hops sideways. ladderCycle cycle: a ladder is climbed by the wall clip\'s whole cycle over two rungs, one hand reaching a rung and then the other, its phase carried on from rung to rung and its pace the climb\'s speed, held within the stretch below of the clip\'s own; rung: each rung played on its own from the clip\'s start, as before.',
    dials: [
      choice('freeHops', 'A free hang hopping up and down', 'on: up by braced_hang_hop_up\'s arms over the free hang\'s legs, down by the drop\'s own move; off: sideways only, as before.'),
      dial('freeHopParts.from', 'A free hop up\'s arms from', 0.01, 's', 'The start of braced_hang_hop_up (the brief names the clip); its cue coils from here.'),
      dial('freeHopParts.to', 'To', 0.01, 's', 'Its end, 1.667: the arms reach the lip and settle as the clip does.'),
      choice('ladderCycle', 'A ladder', 'cycle: the wall clip\'s whole cycle over two rungs, hands alternating; rung: each rung from the clip\'s start, as before.'),
      dial('ladderStretch', 'The cycle\'s pace held within', 0.01, 'of the clip\'s own', 'Ours: 0.2 (the brief\'s plus or minus a fifth): faster or slower than that the climb takes longer rather than the clip skating.'),
      dial('ladderArc', 'A free ladder\'s hand is led out round the rungs by', 0.01, 'm', 'Ours: 0.2, the rung beam\'s depth less a little: the wall clip\'s hand, made against a wall, would pass through the free rung between its two holds.'),
      dial('ladderLead', 'At the reach\'s middle the hand is led rather than carried by the clip by', 0.05, 'of the way', 'Ours: 0.5, half and half: nought is the clip\'s own reach (its hand passes into the rungs and the wall), one a hand drawn on a path.'),
    ],
  },
  {
    title: 'Climbing II: the body out of walls, the wall\'s hands, the push-off',
    note: 'Each switch\'s other word is the climbing as the smoothness round left it. bodyClear spheres: the figure\'s spheres (measured off its own mesh) are asked of what stands still while hanging, shimmying, hopping, climbing a wall and ducking, and the figure is pushed out of anything they are in (its planted hands and feet allowed their contact). wallHands grip: a wall climb\'s hand over air (past the top, a side or a hole) grips the nearest real surface, under the top or in over it. pushOff jka: Space off a wall and S with Space off a braced hang play Jedi Academy\'s rebound off a wall and push back as it does. The duck\'s head (duckHead, headSkin) is under the movement\'s.',
    dials: [
      choice('bodyClear', 'The figure out of walls', 'spheres: pushed out of anything still its spheres are in; before: nothing asked.'),
      dial('clearEase', 'The push eases back in over', 0.01, 's', 'Ours: 0.08, a few frames; it goes out at once.'),
      dial('clearMost', 'The figure pushed out no further than', 0.01, 'm', 'Ours: 0.3, about a forearm, past which the hands would leave the lip.'),
      choice('wallHands', 'The wall climb\'s hands', 'grip: a hand over air grips the nearest real surface, under the top or in over it; before: left as the clip has it.'),
      dial('gripSeek', 'A hand over air looks for a grip within', 0.01, 'm', 'Ours: 0.9, a whole arm and a hand, so a hand stretched high over a wall\'s top still finds its lip.'),
      choice('pushOff', 'Off a wall with Space', 'jka: Jedi Academy\'s rebound, pushed back and up as it does; before: the slow jump off, turned round at its end.'),
      dial('pushBack', 'The push back', 0.05, '× Jedi Academy\'s', 'Ours: 1, Jedi Academy\'s 5.08 m/s.'),
      dial('pushUp', 'The lift with it', 0.05, '× Jedi Academy\'s', 'Ours: 1, Jedi Academy\'s 8.53 m/s.'),
    ],
  },
  {
    title: 'Climbing II: bars, the swing',
    note: 'off: a bar is whatever the ledges make of a thin box (the course\'s bars caught as a free lip). on: a still thing long, level and thin, with room under it to hang, is a bar and never a lip; E in reach grabs it (from the ground under it, a jump, or a fall past it; a running jump plays the swing clip\'s reach), and the body hangs from its hands as a pendulum on the physics\' own steps, W and S pushing it on at its own phase as on a swing, A and D moving the hands along it; the pose is run_and_swing\'s swing played by the pendulum\'s own angle.',
    dials: [
      choice('bars', 'Bars', 'on: grabbed with E and swung on; off: as before, a thin box is a lip.'),
      dial('barThin', 'A bar is thinner than', 0.01, 'm', 'The brief\'s 0.12: a hand round it (the course\'s bars are 0.07, its free beams 0.2 by 0.3 and stay lips).'),
      dial('barLength', 'And at least as long as', 0.05, 'm', 'The brief\'s 0.8: room for both hands and a shift along it.'),
      dial('swingGravity', 'The swing\'s gravity', 0.1, 'm/s²', 'Ours: the game\'s own on foot, 20.32 (Jedi Academy\'s 800 units), as a hop\'s arc is.'),
      dial('swingPump', 'W or S pushes the swing on by', 0.1, 'rad/s²', 'Ours: 4, W alone pumping a still hang to the largest swing in about four swings against the damping.'),
      dial('swingDamp', 'The swing dies away by', 0.01, 'a second', 'Ours: 0.35, a swing let alone halving in about four seconds.'),
      dial('swingMost', 'The largest swing the keys pump to', 1, 'degrees', 'Ours: 70 either side of straight down, short of the clip\'s own front (84).'),
      dial('swingCarry', 'Of the body\'s speed at the grab, carried into the swing', 0.05, '', 'Ours: 1, all of it, held to the largest swing.'),
      dial('barShimmy', 'A and D move the hands along it at', 0.05, 'm/s', 'Ours: 0.6, a slow hand over hand.'),
      dial('barGrab', 'A standing or falling grab carries the body onto it over', 0.01, 's', 'Ours: 0.25; a running jump\'s is the clip\'s own reach, 0.13.'),
    ],
  },
  {
    title: 'Climbing II: bars, the flight',
    note: 'plain: Space hands the body the swing\'s own velocity and the falling clips, nothing caught. fly: Space flies on the swing\'s own velocity and the boost, on the physics\' own steps, in run_and_swing\'s flight; a bar within the band ahead of the hands along the flight is caught into the clip\'s reach, the flight\'s speed carried into the new swing; else the clip\'s landing where the feet meet ground, or the falling clips. The crouch key drops straight down; a hard blow knocks the body off.',
    dials: [
      choice('barFlight', 'The flight off a bar', 'fly: the flight, the catch and the landing; plain: the swing\'s velocity handed to the movement, as maker A had it.'),
      dial('barBoost', 'Space adds along the swing\'s own way', 0.1, 'm/s', 'Ours: 1, a let-go on the forward swing reaching a bar 2 or 3 m on; 2.5 reaches 4 m and 4 reaches 5.'),
      dial('catchReach', 'A bar is caught this far ahead of the hands', 0.05, 'm', 'Ours: 0.6, about what the flight covers in the clip\'s own 0.13 s reach.'),
      dial('catchSlack', 'And within this above, below or beside them', 0.05, 'm', 'Ours: 0.35, a hand\'s span and a little, as the hops\' band forgives.'),
      dial('barKnock', 'A blow of at least this knocks the body off', 1, 'health', 'Ours: 25, a quarter of a whole bar (the ledges have no such rule).'),
    ],
  },
  {
    title: 'Climbing II: ropes',
    note: 'off: no rope hangs (the course\'s rope a still column). on: a rope hangs from its anchor, no collider, drawn as the grappling hook\'s rope and free to swing; E in reach grabs it at the height met (standing by it, a jump, or a fall past it), and the body hangs on it as a pendulum from the anchor at its place along it, on the physics\' own steps: W and S climb (the radius changing, the swing kept), the pump keys push the swing on at its own phase as on a swing, the plane turns toward the view; hanging still plays hanging, climbing climbing_a_rope, swinging start_swinging from 1.07 s by the pendulum\'s angle. Space lets go on the swing, the crouch drops. Letting go (lips): where the flight comes to a lip it lands you on it by the lip\'s height under the feet: level the swinging clip from 1.03 s, a knee swing_to_land_1 from 1.33 s, between knee and waist swing_to_land from 1.03 s, the waist swing_into_wall from 0.93 s; nothing ahead to land on, the plain let-go and the fall. (plain: every let-go the plain one.)',
    dials: [
      choice('ropes', 'Ropes', 'on: ropes hang and are grabbed with E; off: as before, the course\'s rope a still column.'),
      choice('ropeKeys', 'Which keys pump the swing', 'ad: A toward the view\'s way, D away, W and S climb; ws: W and S pump too while the rope swings, and climb while it hangs still.'),
      dial('ropeLength', 'A rope is this long', 0.1, 'm', 'Ours: 8, the course\'s, from its beam 6 m over the take-off floor to a metre over the pit\'s floor.'),
      dial('ropeGive', 'And gives this much under a hanging body', 0.01, 'm', 'Ours: 0.15 at its whole length, a climbing rope\'s couple of per cent; a caught fall bounces about as much again a metre a second.'),
      dial('ropeClimb', 'W and S climb it at', 0.05, 'm/s', 'Ours: 0.5, the clip at a little over twice its own pace (0.22), the holding hand still keeping its place.'),
      dial('ropeGrab', 'A grab carries the body onto it over', 0.01, 's', 'Ours: 0.25, the bar\'s own grab.'),
      dial('ropePush', 'A pump key pushes the swing on by', 0.1, 'm/s²', 'Ours: 4, the bar\'s own push at its radius, so a long rope pumps no harder than a bar.'),
      dial('ropeDamp', 'The swing dies away by', 0.01, 'a second', 'Ours: 0.35, the bar\'s, a swing let alone halving in about four seconds.'),
      dial('ropeMost', 'The largest swing the keys pump to', 1, 'degrees', 'Ours: 60 either side of straight down, short of the bar\'s 70.'),
      dial('ropeCarry', 'Of the body\'s speed at the grab, carried into the swing', 0.05, '', 'Ours: 1, all of it, held to the largest swing.'),
      dial('ropeTurn', 'The swing\'s plane turns toward the view at most', 5, 'degrees a second', 'Ours: 60, a quarter turn in a second and a half; nought keeps the plane the grab\'s.'),
      dial('ropeSwingFrom', 'A swing past this plays the swing\'s clip', 0.5, 'degrees', 'Ours: 5, a smaller sway reading as hanging still (back to the hang under half of it).'),
      choice('ropeLand', 'Letting go', 'lips: Space flies on the swing and lands on a lip the flight meets by the lip\'s height (level, knee, between knee and waist, waist), else falls as today; plain: the swing\'s velocity handed to the movement, whatever is ahead.'),
      dial('ropeLandKnee', 'A lip under this over the feet is landed level', 0.01, 'm', 'Ours: 0.2, a step the level landing takes in its stride (a stair\'s riser).'),
      dial('ropeLandBetween', 'From this, between knee and waist', 0.01, 'm', 'Ours: 0.45, about the knee, past which the knee clip\'s raised legs no longer clear the lip.'),
      dial('ropeLandWaist', 'From this, waist high (the feet to the wall)', 0.01, 'm', 'Ours: 0.78, halfway between the between clip\'s own 0.70 and the waist clip\'s 0.86, measured off the clips.'),
      dial('ropeLandTop', 'A lip higher than this is a wall', 0.01, 'm', 'Ours: 1.1, the waist clip\'s own 0.86 and a quarter metre.'),
      dial('ropeLandBelow', 'A top met from above is landed level down to this under the feet at the let-go', 0.05, 'm', 'Ours: 0.5, the owner\'s "level with the body"; deeper, the body falls onto it as a fall does today.'),
      dial('ropeLandIn', 'The body stands up this far in past the lip\'s edge', 0.05, 'm', 'Ours: 0.3, a foot\'s length past the capsule\'s own radius.'),
      dial('ropeLandWalk', 'And goes in over the top at no more than', 0.1, 'm/s', 'Ours: 2, about the let-go clips\' own travel (4.9 to 6 m over their 2 to 3 s), which the importer takes out.'),
    ],
  },
  {
    title: 'Climbing II: Feedback II',
    note: 'Each switch\'s other word is the climbing as phase 4 left it. barCamera pass: the camera is never stopped by the bar the hands hold, the bar just let go of while flying off it, or the bar a catch reaches for (a wall beside them still stops it). barSettle swings: a swing let alone (no W or S held) settles to under the angle below in about the swings below, its damping worked out from the swing\'s own period; W or S held, the swing\'s own damping as before. barHang free: a swing under the angle below with no pump key held crossfades into the free hang\'s own loop, the hands on the bar, A and D playing the free hang\'s shimmy at the shift\'s own speed; W or S crossfades back to the swing.',
    dials: [
      choice('barCamera', 'The camera and the bar held', 'pass: the bar held, let go of or reached for never stops the camera; block: every bar a wall to it, as before.'),
      choice('barSettle', 'A swing let alone', 'swings: settles in the swings below; damp: dies away by the swing\'s own damping, as before.'),
      dial('barSettleTo', 'Settles to under', 0.5, 'degrees', 'The brief\'s 3, either side of straight down: a sway too small to read as a swing.'),
      dial('barSettleSwings', 'Over this many swings out and back', 0.1, 'swings', 'The owner\'s "2-3 swings total": 2.5, the middle of them.'),
      choice('barHang', 'Hanging still from a bar', 'free: the free hang\'s loop and shimmy, the hands on the bar; swing: the swing\'s clip held straight down, as before.'),
      dial('barHangFrom', 'The free hang from a swing under', 0.5, 'degrees', 'The brief\'s 4: a little over where a swing let alone settles, so the loop comes in as it settles.'),
      dial('barHangBlend', 'Crossfaded either way over', 0.01, 's', 'The brief\'s 0.3: a little more than the hang\'s own ease.'),
    ],
  },
  {
    title: 'Climbing II: Feedback II, the free hang and the ladders',
    note: 'Maker B\'s. Each switch\'s other word is the climbing as phase 4 left it. freeCue pull: on a free hang the up cue is a small pull-up, the hands kept on the grip and the body risen by the rise below (the pose the free climb up\'s first pull, its seconds below); arms: the braced hop\'s arms through and off the grip, as before. freeHopLegs kick: under a free hop up\'s arms the free climb up\'s own leg kick, and the sway below on the hips and legs. ladderSway sway: on a free ladder the free hang shimmy\'s legs, one step a reach; on both ladders the hips and legs lag the body as a damped pendulum, a braced ladder\'s feet kept on the rungs. freeBehind reach: a free hang looks back and jumps at a ledge behind as a braced one does; side: a look back reads as a side.',
    dials: [
      choice('freeCue', 'A free hang\'s up cue', 'pull: a small pull-up, hands on the grip; arms: the braced hop\'s arms off the grip, as before.'),
      dial('freeCueRise', 'Rises by', 0.005, 'm', 'The brief\'s 0.08: the owner\'s "very small pull up".'),
      dial('freeCueIn', 'Over', 0.01, 's', 'The brief\'s 0.25: a slow, held pull, and as long back down.'),
      dial('freeCueParts.pullFrom', 'Its pose: freehang_climb from', 0.01, 's', 'The free climb up\'s start: its first pull begins here.'),
      dial('freeCueParts.pullTo', 'To', 0.01, 's', 'Ours, 0.2: from 0.25 the climb\'s spine leans back past where the arms reach the grip from.'),
      choice('freeHopLegs', 'A free hop up\'s legs', 'kick: the free climb up\'s leg kick under the arms, and the sway; stiff: the free hang\'s legs held, as before.'),
      dial('freeCueParts.kickFrom', 'The kick: freehang_climb from', 0.01, 's', 'Ours, 0.15: where the climb\'s knees begin to come up.'),
      dial('freeCueParts.kickTo', 'To', 0.01, 's', 'Ours, 0.7: the legs swung out over the top, played by the hop\'s hands\' leave.'),
      choice('ladderSway', 'Ladders', 'sway: the free ladder\'s shimmy legs and the hips\' lag on both; stiff: as before.'),
      dial('swayAmount', 'How much of the lag is drawn', 0.05, '×', 'The brief\'s 1: the pendulum\'s own; nought draws none.'),
      dial('swayHz', 'The lag\'s own swing', 0.05, 'a second', 'The brief\'s 1.2: about a hanging body\'s legs.'),
      dial('swayDamp', 'Settles at', 0.05, 'of critical', 'The brief\'s 0.5: a stop overshoots once and settles.'),
      choice('freeBehind', 'A free hang looking back', 'reach: looks away and jumps at a ledge behind; side: reads as a side, as before.'),
      dial('freeBehindParts.pose', 'Its held pose and the jump\'s start', 0.01, 's', 'Ours, 0.3: the braced look-away\'s own moment, in the free hang\'s own side hop.'),
    ],
  },
  {
    title: 'Climbing II: poles',
    note: 'off: as before, a pole is whatever the wall climb and the ledges make of it. on: a still collider long, upright and thin (across no more than the thickness below, at least the length below, within 10 degrees of upright) is a pole: E in reach grabs it facing it (standing by it, a jump, or a fall past it), the body hanging with its hands where the climb\'s clip has them; W and S climb up and down on climbing_a_rope_1 (the feet on the pole, played backward for down), stopping at its top and its bottom; A and D carry the body round it, the view free; the hands and feet are kept on it by the limbs\' solve, the feet pinching it from its two sides. Space jumps off along the view and catches another pole, a bar or a lip in reach on the way; the crouch slides down to the ground; W at the top climbs onto a lip or a floor\'s edge in reach (each its own switch below, their other settings a let-go straight down and a stop at the top). The camera is never stopped by the pole held, nor by the pole jumped off while the jump flies (by the bars\' camera switch above).',
    dials: [
      choice('poles', 'Poles', 'on: grabbed with E and climbed; off: as before, a pole is the wall climb\'s.'),
      dial('poleThin', 'A pole is no thicker than', 0.01, 'm', 'The brief\'s 0.15: a thick pole or a sapling a fist can still close round; a lamp post\'s 0.2 is a wall.'),
      dial('poleLength', 'And at least this long', 0.1, 'm', 'The brief\'s 1.5: long enough to hang the body on, hands to feet; a short post is not climbed.'),
      dial('poleClimb', 'W and S climb it at', 0.05, 'm/s', 'Ours: 0.5, the rope\'s own climb, the clip a little faster than its own pace (about 0.2), the holding hands keeping their place.'),
      dial('poleTurn', 'A and D carry the body round it at', 5, 'degrees a second', 'Ours: 90, a quarter of the way round in a second, slow enough that the camera keeps up.'),
      dial('poleGrab', 'A grab carries the body onto it over', 0.01, 's', 'Ours: 0.25, the rope\'s own grab.'),
      dial('poleFootSide', 'Each foot pinches it this far out from its side', 0.005, 'm', 'Ours: 0.04, about a sole\'s half width, so the instep and not the toes is against the pole.'),
      choice('poleJump', 'Space on a pole', 'fly: jumps off along the view and catches another pole, a bar or a lip in reach on the way; plain: lets go, straight down.'),
      dial('polePush', 'The jump off pushes along the view at', 0.1, 'm/s', 'Ours: 3, a strong shove off with the arms and the feet, about a standing long jump\'s carry: a pole 2 m off is reached.'),
      dial('poleJumpUp', 'And rises', 0.05, 'm', 'Ours: 0.5, a small jump\'s, under the plain jump\'s 0.8: the body pushes off from a hold, not the ground.'),
      choice('poleCrouch', 'The crouch on a pole', 'slide: slides down to the ground (or off the pole\'s foot), the crouch again lets go, W stops it; drop: lets go, straight down.'),
      dial('poleSlide', 'The slide down goes at', 0.1, 'm/s', 'Ours: 3, a fireman\'s slide: six times the climb, well under a fall\'s speed from a few metres.'),
      choice('poleTop', 'W at a pole\'s top', 'climb: climbs onto a lip or a floor\'s edge in reach (behind first, then ahead, then the sides), as a ledge\'s climb up does; stop: the climb stops at the top.'),
    ],
  },
  {
    title: 'Climbing II: the rope\'s chain',
    note: 'straight: as phase 5 drew it, a straight line from the anchor through the hands to the end at the swing\'s angle. chain: each rope is a chain of points stepped on the physics\' own steps (alike at every frame rate): pinned at its anchor, its links held to the rope\'s length, a gentle bend, gravity, a damping and the weather\'s wind as a drag (the very wind the trees and the rain take); held over the ground and out of what stands still, a tail on the ground lying there. With a body on it the hands are a pin moving along the chain: the span above holds the swing\'s length, the tail below swings after the body, settles when it is still and whips a little at a let-go; the drawn rope meets both hands every frame. Drawn as a strip turned to the view through a smooth curve of the points, a twisted rope\'s strands of our own on it, lifted off what it lies on; another player hanging on a rope here bends it to their drawn hands. Drawing only: nothing of it moves the body.',
    dials: [
      choice('ropeLook', 'The rope is drawn', 'chain: a chain of points, swung, bent and blown; straight: as before, a straight line at the swing\'s angle.'),
      dial('ropePoints', 'Its points', 1, '', 'The brief\'s 24: a link of a third of a metre on the course\'s 8 m rope, a curve that reads as a curve.'),
      dial('ropeSubsteps', 'Each physics step solved in', 1, 'substeps', 'Ours: 8, a 480th of a second each: the course\'s 8 m rope hangs 1.2 cm longer than itself (4: 4.9 cm; 2: 19 cm).'),
      dial('ropeBend', 'Two links folding pushed apart by', 0.01, 'a pass', 'Ours: 0.1, a hemp rope\'s give: it curves rather than kinks and is never stiff as a pole.'),
      dial('ropeChainDamp', 'Its own motion dies away by', 0.01, 'a second', 'Ours: 0.3, the free rope\'s own swing\'s, so the drawn rope settles as the rope the grab finds does.'),
      dial('ropeGrip', 'Lying on something, its slide dies away by', 0.5, 'a second', 'Ours: 10, the slide halving in a fourteenth of a second: a tail that lands drags to a stop where it lands rather than skating on.'),
      dial('ropeWind', 'The wind drags it at', 0.01, 'a second', 'Ours: 0.3: against the swing\'s own gravity (20.32) a 10 m/s gale leans a free rope about 8 degrees, a 2 m/s breeze under 2.'),
      dial('ropeWidth', 'Drawn this thick', 0.005, 'm', 'Ours: 0.04, the course rope\'s column: half of it is the chain\'s own 2 cm off what it lies on, so edge on it never dips in. Never under the hook\'s least pixels across.'),
      dial('ropeLift', 'Lying on something, drawn lifted off it by', 0.005, 'm', 'The brief\'s 1 cm along the surface\'s normal, over a depth offset: it never flickers into the ground or a wall.'),
      dial('ropeLay', 'One turn of its strands', 0.01, 'm', 'Ours: 0.14, three and a half times a 4 cm rope\'s thickness, a hawser\'s lay: a strand\'s band every 4.7 cm.'),
    ],
  },
  {
    title: 'The hands bracing',
    note: 'before: the arms as they were (nothing is felt for). on: moving into a wall the hand on that side rests on it (head on, both), in a passage narrower than the tight share both touch its sides, among people the hand on their side rests on them, and drifting in space near a surface both hands reach to it and step along it.',
    dials: [
      choice('brace.rule', 'The hands bracing', 'The whole of it: before is the arms as they were.'),
      choice('brace.people', 'On people near', 'The brief\'s start: on (never on one fighting you).'),
      dial('brace.reach', 'A face within', 0.01, 'm', 'Of the shoulders, on the human male: his arm, 0.56, and the shoulder\'s 0.19 off the middle line, less a hand: 0.7.'),
      dial('brace.press', 'Moving into it by at least', 0.05, 'of the move', 'A third: a glance along a wall never braces.'),
      dial('brace.tight', 'A passage narrower than', 0.05, 'm', 'The brief\'s 1.4, wall to wall at the shoulders.'),
      dial('brace.moving', 'Only moving faster than', 0.05, 'm/s', 'For a passage and a crowd: 0.4 (standing among people is not passing them).'),
      dial('brace.height', 'At the height of', 0.01, 'm', 'Over the feet on the human male: 1.3, a little under the shoulders.'),
      dial('brace.spaceReach', 'In space, a surface within', 0.05, 'm', 'The brief\'s 1.2 of the chest.'),
      dial('brace.ease', 'Hands reach out over', 0.01, 's', '0.2, and come back as quickly.'),
    ],
  },
];

/** The dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const CLIMB_DIALS: DialSet = { helper: 'climb', groups: CLIMB_GROUPS, shipped: readDials(CLIMB_GROUPS) };

/** The dials `__debug.climb` has, or null: what the debug menu asks as a helper is picked. */
export function climbDialsFor(helper: string): DialSet | null {
  return helper === 'climb' ? CLIMB_DIALS : null;
}
