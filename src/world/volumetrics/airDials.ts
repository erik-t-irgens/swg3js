// The moving air's dials (src/ui/dials.ts): the numbers of feel -- how fast the air is pulled to the wind, how gusty,
// how much it swirls, how fast the dust settles, how hard a jet or a blast pushes, how far a grain falls -- as sliders
// in the debug menu when `air` is picked. Each is set through `tuneAir`, exactly as `__debug.air({ tune })` sets it,
// so the line the menu copies out is that helper's own argument (`air({ tune: { dust: { settle: 4 } } })`). Every one is
// the owner's to judge by eye (CLAUDE.md, "Feel is the owner's"); a slider's range is ours, wide enough to try
// anything sensible. The technical numbers of the table (loop bounds, budgets, the window's size) have no slider.
//
// Pure: it imports the tune table and the dials' own types and nothing of the page.
import type { DialGroup, DialSet, NumberDial } from '../../ui/dials.ts';
import { readDials } from '../../ui/dials.ts';
import { AIR_TUNE, tuneAir } from './airTune.ts';

type Group = keyof typeof AIR_TUNE;

/** One number of `AIR_TUNE`, as a slider set through `tuneAir`. */
function dial(group: Group, key: string, label: string, min: number, max: number, step: number, unit: string, note: string, text?: (v: number) => string): NumberDial {
  const table = AIR_TUNE[group] as unknown as Record<string, number>;
  return {
    kind: 'number',
    key: `tune.${group}.${key}`,
    label,
    note,
    min,
    max,
    step,
    unit,
    get: () => table[key],
    set: (v) => tuneAir({ [group]: { [key]: v } }).notes,
    text,
  };
}

const kmh = (v: number): string => `${Math.round(v * 3.6)} km/h`;

const AIR_GROUPS: DialGroup[] = [
  {
    title: 'The wind',
    note: 'The planet\'s own wind, from the weather. The air is pulled toward it everywhere, and gust cells about 29 m across ride along it.',
    dials: [
      dial('solver', 'relax', 'Pull toward the wind', 0, 3, 0.05, '/s', 'How fast the air settles back to the wind after a jet or a blast has stirred it. Higher, a wake fills in sooner.'),
      dial('wind', 'gust', 'Gusts', 0, 2, 0.05, '', 'How much stronger and weaker, and how far turned, the wind is cell to cell. 0 is one steady wind.'),
      dial('wind', 'scale', 'Wind strength', 0, 3, 0.05, '×', 'The weather\'s wind taken as metres a second, times this.'),
      dial('solver', 'swirl', 'Swirl', 0, 60, 1, '', 'How much the stirred air curls into eddies, at the demo\'s own cell (held per metre whatever the air detail).'),
      dial('solver', 'dissipation', 'Stirred air dies away', 0, 2, 0.05, '/s', 'How fast the air\'s own motion fades on its own, besides the pull toward the wind.'),
      dial('slabs', 'reach', 'Height a push reaches', 0.3, 3, 0.05, '×', 'How far up and down from where it is made a push still stirs the layer of air near the ground.'),
    ],
  },
  {
    title: 'The dust',
    note: 'Each source lays its dust at a height of its own, rising at a speed of its own; it rises, slows, spreads and falls back by one rule, and a unit of it is as thick as ever wherever its mass sits.',
    dials: [
      dial('dust', 'settle', 'Dust settles in', 0.5, 10, 0.1, 's', 'How long lifted dust hangs in the air before it falls out: it decays as 1 / (1 + dt / this).'),
      dial('dust', 'stormHeight', 'Storm dust stands to', 2, 30, 0.5, 'm', 'How high a full storm\'s dust stands on average (and only the storm\'s).'),
      dial('dust', 'stormShed', 'Storm lifts off the sand', 0, 3, 0.05, '/s', 'How much dust sandy ground sheds a second in a full storm, more under a gust.'),
      dial('dust', 'stormInflow', 'Storm on the wind', 0, 2, 0.05, '', 'How much dust a full storm carries in from beyond the square that follows you.'),
      dial('dust', 'stormEase', 'Storm takes the ground\'s colour over', 0.2, 20, 0.1, 's', 'How long the storm\'s colour takes to come to the colour of the ground it blows over.'),
      dial('dust', 'extinction', 'Dust thickness', 0.05, 3, 0.05, '', 'How much light a unit of dust takes. Thicker hides more of what is behind it.'),
      dial('dust', 'slopeFrom', 'Steep ground sheds less from', 5, 60, 1, '°', 'Ground steeper than this sheds less dust, whatever it is made of.'),
      dial('dust', 'slopeTo', 'Steep ground sheds none from', 10, 80, 1, '°', 'And none at all past this: a cliff face throws no dust.'),
      dial('dust', 'drag', 'Rise dies away', 0.1, 5, 0.05, '/s', 'How fast thrown dust stops climbing: higher, it peaks lower and sooner.'),
      dial('dust', 'fall', 'Dust sinks at', 0, 3, 0.05, 'm/s', 'How fast dust that has stopped climbing sinks back to the ground.'),
      dial('dust', 'spreadRate', 'Dust spreads', 0, 2, 0.01, 'm²/s', 'How fast a patch of dust grows taller and thinner as it hangs.'),
      dial('dust', 'spreadMin', 'Thinnest patch', 0.05, 2, 0.01, 'm', 'The least a patch of dust is spread up and down.'),
      dial('dust', 'spreadMax', 'Widest patch', 0.5, 15, 0.1, 'm', 'The most a patch of dust spreads up and down however long it hangs.'),
      dial('engine', 'spreadAt', 'Skimming jet lays dust at', 0, 3, 0.05, 'm', 'How high over the ground a speeder\'s, a bike\'s or a pod\'s dust starts.'),
      dial('engine', 'spreadSigma', 'Skimming jet\'s dust spread', 0.05, 3, 0.05, 'm', 'How tall that dust is as it starts.'),
      dial('engine', 'spreadRise', 'Skimming jet throws it up', 0, 2, 0.05, '×', 'How hard it is thrown up, as a share of the demo\'s grains\' throw.'),
      dial('engine', 'spreadRiseSpeed', 'Throw held at speed', 5, 120, 1, 'm/s', 'A machine faster than this throws its dust up no harder, so a racing pod\'s dust keeps a speeder\'s arc.', kmh),
      dial('engine', 'impactAt', 'Landing jet lays dust at', 0, 3, 0.05, 'm', 'How high over the ground the dust where a jet lands starts.'),
      dial('engine', 'impactSigma', 'Landing jet\'s dust spread', 0.05, 3, 0.05, 'm', 'How tall that dust is as it starts.'),
      dial('engine', 'impactRise', 'Landing jet lifts it', 0, 1, 0.01, '× speed', 'How fast it rises, as a share of the jet\'s speed where it lands.'),
      dial('dust', 'lift', 'Sources lift their own dust', 0, 1, 1, '', 'At 1 each source lays its dust at its own height; at 0 all of it stands as the storm\'s does, the nearest to the first dust, for comparing.'),
      dial('dust', 'tone', 'Colour from the lighter part', 0, 0.95, 0.05, '', 'How much of the ground picture\'s darker part, the gaps between its grains, the dust\'s colour leaves out: 0 is the whole picture\'s mean.'),
      dial('dust', 'tint', 'Colour map\'s tint', 0, 1, 0.05, '', 'How much of the drawn ground\'s colour-map tint the dust takes: 1 the ground\'s own, 0 none, for comparing.'),
      dial('volume', 'nearFrom', 'Clear round the lens to', 0, 5, 0.05, 'm', 'Dust nearer the camera than this is not drawn, so it never fills the screen.'),
      dial('volume', 'nearTo', 'And back in full by', 0, 10, 0.05, 'm', 'Dust this far from the camera is drawn in full; in between it fades in.'),
      dial('volume', 'bandSigmas', 'Band looked in', 1, 6, 0.1, '× spread', 'How far over a patch\'s peak the picture looks for dust, in its spreads.'),
    ],
  },
  {
    title: 'The light in the dust',
    note: 'How strongly the dust shades itself, and how bright it is drawn, are the Graphics page\'s "The dust\'s look".',
    dials: [
      dial('volume', 'phaseLift', 'Glow toward the sun', 0, 5, 0.05, '', 'How much brighter dust is looking toward the sun through it than away from it.'),
      dial('volume', 'sun', 'Sunlit dust', 0, 3, 0.05, '×', 'How strongly the sun lights the dust.'),
      dial('volume', 'ambient', 'Shaded dust', 0, 3, 0.05, '×', 'How much the sky\'s own light lights the dust in shade.'),
      dial('ground', 'shade', 'Dust shadow at most', 0, 1, 0.01, '', 'How much of the sun the thickest dust between the ground and the sun takes off the ground under it.'),
      dial('volume', 'history', 'New frame\'s share', 0.02, 1, 0.01, '', 'How much of each new frame goes into the smoothed picture. Lower is smoother and slower to follow; 1 is no smoothing.'),
    ],
  },
  {
    title: 'Engines',
    note: 'An engine\'s exit speed is its kind\'s, times how hard it runs (the heat its glow already shows).',
    dials: [
      dial('engine', 'exitSpeeder', 'Speeder exit speed', 0, 150, 1, 'm/s', 'A speeder\'s or a bike\'s jet at full heat.', kmh),
      dial('engine', 'exitFlyer', 'Flyer exit speed', 0, 150, 1, 'm/s', 'A flyer\'s jet at full heat.', kmh),
      dial('engine', 'exitPod', 'Pod exit speed', 0, 150, 1, 'm/s', 'A pod\'s engines between them at full heat.', kmh),
      dial('engine', 'exitShip', 'Ship exit speed', 0, 150, 1, 'm/s', 'A ship\'s engines at full heat. They point aft, so they stir the ground only low and fast.', kmh),
      dial('engine', 'downwashShip', 'Ship downwash', 0, 150, 1, 'm/s', 'A hovering ship blowing straight down under itself: what lifts dust under a ship holding its height.', kmh),
      dial('engine', 'downwashFlyer', 'Flyer downwash', 0, 150, 1, 'm/s', 'The same under a flyer off the ground.', kmh),
      dial('engine', 'downwashFade', 'Downwash gone at', 1, 100, 1, 'm/s', 'The forward speed at which the downwash has faded to nothing.', kmh),
      dial('engine', 'spreadPush', 'Spread under a low nozzle', 0, 150, 1, '', 'How hard a jet skimming the ground shoves the air out from under it.'),
      dial('engine', 'spreadDust', 'Dust from a low nozzle', 0, 10, 0.1, '/s', 'How much dust a jet skimming sand lifts.'),
      dial('engine', 'impactDust', 'Dust where a jet lands', 0, 1, 0.01, '', 'How much dust a jet pointed at the ground lifts, times its speed there.'),
    ],
  },
  {
    title: 'Blasts and the Force',
    dials: [
      dial('blast', 'shove', 'Blast shove', 0, 150, 1, 'm/s', 'A thermal detonator\'s ring of shoves; others by their own push.'),
      dial('blast', 'dust', 'Blast dust', 0, 10, 0.1, '', 'The dust a thermal detonator lifts; others by their radius.'),
      dial('blast', 'liftAt', 'Blast lays dust at', 0, 3, 0.05, 'm', 'How high over the ground a thermal detonator\'s dust starts; others by their radius.'),
      dial('blast', 'liftSigma', 'Blast dust spread', 0.05, 3, 0.05, 'm', 'How tall it is as it starts.'),
      dial('blast', 'liftRise', 'Blast throws it up', 0, 20, 0.1, 'm/s', 'How fast it is thrown up.'),
      dial('force', 'push', 'Push shove', 0, 80, 1, 'm/s', 'A Force push through its cone, given to the air its wave passes.'),
      dial('force', 'pull', 'Pull draw', 0, 80, 1, 'm/s', 'A Force pull drawing the air back.'),
      dial('force', 'repulse', 'Repulse ring', 0, 80, 1, 'm/s', 'A repulse ringing the air away.'),
      dial('force', 'pushTime', 'Push wave runs out in', 0.1, 4, 0.05, 's', 'How long a push\'s wave takes to reach its end.'),
      dial('force', 'pullTime', 'Pull rolls in over', 0.1, 4, 0.05, 's', 'How long a pull\'s wave takes to come in.'),
      dial('force', 'repulseTime', 'Repulse ring opens in', 0.1, 4, 0.05, 's', 'How long a repulse\'s ring takes to open to its reach.'),
      dial('force', 'pushFrom', 'Push wave starts at', 0, 5, 0.1, 'm', 'How far ahead of the feet a push\'s wave begins.'),
      dial('force', 'pullFrom', 'Pull wave starts at', 0.3, 1.5, 0.05, '× reach', 'Where a pull\'s wave begins, as a share of its reach.'),
      dial('force', 'pullTo', 'Pull wave stops at', 0, 5, 0.1, 'm', 'How far short of the feet a pull\'s wave stops.'),
      dial('force', 'repulseFrom', 'Repulse ring starts at', 0, 5, 0.1, 'm', 'How far out a repulse\'s ring begins: inside it the middle stays clear.'),
      dial('force', 'pushEase', 'Push wave slows by', 1, 5, 0.1, '', 'How much faster a push\'s wave starts than it ends.'),
      dial('force', 'pullEase', 'Pull wave quickens by', 1, 5, 0.1, '', 'How much faster a pull\'s wave arrives than it starts.'),
      dial('force', 'repulseEase', 'Repulse ring slows by', 1, 5, 0.1, '', 'How much faster a repulse\'s ring starts than it ends.'),
      dial('force', 'arc', 'Push and pull sweep', 5, 90, 1, '°', 'How far either side of the aim a push\'s or a pull\'s wave reaches.'),
      dial('force', 'shoveShare', 'Wave\'s shoves as wide as', 0.02, 0.5, 0.01, '× reach', 'How wide each shove of a wave is, as a share of its reach.'),
      dial('force', 'dust', 'Wave\'s dust', 0, 5, 0.05, '', 'How much dust a wave lifts as it passes over sand.'),
      dial('force', 'dustWidth', 'Wave\'s band starts', 0.1, 4, 0.05, 'm', 'How wide the band of dust a wave lifts is near the feet.'),
      dial('force', 'dustGrow', 'And widens by', 0, 0.5, 0.01, '/m', 'How much wider it grows each metre it travels.'),
      dial('force', 'dustShape', 'Dust comes and goes', 0.2, 4, 0.05, '', 'How sharply the wave\'s dust rises to its most halfway and falls away again.'),
      dial('force', 'dustLow', 'Wave lays dust at', 0, 2, 0.05, 'm', 'How high over the ground a push\'s or a pull\'s dust starts.'),
      dial('force', 'dustSpread', 'Wave\'s dust spread', 0.05, 2, 0.05, 'm', 'How tall it is as it starts.'),
      dial('force', 'dustKick', 'Wave throws it up', 0, 8, 0.1, 'm/s', 'How fast it is thrown up.'),
      dial('force', 'repulseSpread', 'Repulse dust spread', 0.05, 2, 0.05, 'm', 'How tall a repulse\'s dust is as it starts.'),
      dial('force', 'repulseKick', 'Repulse throws it up', 0, 8, 0.1, 'm/s', 'How fast a repulse\'s dust is thrown up.'),
    ],
  },
  {
    title: 'Grains that fall back',
    dials: [
      dial('grains', 'gravity', 'Grains fall at', 1, 30, 0.1, 'm/s²', 'How hard a thrown grain is pulled back to the ground.'),
      dial('grains', 'rest', 'Grains lie for', 0, 3, 0.05, 's', 'How long a grain lies on the sand before it fades.'),
      dial('grains', 'blast', 'Grains a blast throws', 0, 1000, 10, '', 'At a thermal detonator\'s radius; others by theirs.'),
    ],
  },
  {
    title: 'The blowing sand',
    note: 'A blowing sand of our own streaks over the still ground where the air near it passes a threshold: min(the wind × over + add, cap), so the planet\'s own breeze leaves it lying and a jet blows it. The ground\'s own picture never moves.',
    dials: [
      dial('ground', 'liftOver', 'Threshold over the wind', 0.5, 3, 0.05, '×', 'How far over the planet\'s own wind the air must blow to blow sand.'),
      dial('ground', 'liftAdd', 'Threshold over the wind, plus', 0, 15, 0.1, 'm/s', 'And this much more.'),
      dial('ground', 'liftCap', 'Threshold never over', 1, 40, 0.5, 'm/s', 'The threshold\'s ceiling, so a real gale\'s gusts still blow the sand.'),
      dial('ground', 'liftSpan', 'Lift comes in over', 0.5, 20, 0.5, 'm/s', 'How much faster than the threshold the air must blow to blow the sand fully.'),
      dial('ground', 'lift', 'Sand blows at', 0, 2, 0.01, '× air', 'The streaks\' speed as a share of the air\'s.'),
      dial('sand', 'cycle', 'Streaks renew every', 0.3, 6, 0.05, 's', 'How long the streaks are carried before they quietly start again; longer stretches them further at a jet\'s edge.'),
      dial('sand', 'opacity', 'Streaks show at', 0, 1, 0.01, '', 'How much of the ground the thickest streak hides.'),
      dial('sand', 'bright', 'Streaks brightness', 0.3, 3, 0.05, '×', 'Grains in flight read lighter than the ground they leave.'),
      dial('sand', 'scale', 'Picture repeats every', 1, 40, 0.5, 'm', 'How big the streaks\' grains and patches are.'),
      dial('sand', 'streak', 'Streak length', 0, 0.5, 0.005, 's', 'Each grain is blurred along its way over this much time.'),
      dial('sand', 'from', 'Begins at', 0, 5, 0.05, 'm/s', 'The carry at which the streaks begin to show.'),
      dial('sand', 'full', 'Full at', 0.1, 15, 0.1, 'm/s', 'The carry at which they show in full.'),
      dial('sand', 'grains', 'Grains cut at', 0, 1, 0.01, '', 'Where the grains are cut out of the picture: higher, fewer grains.'),
      dial('sand', 'soft', 'Grains\' edge', 0.001, 0.5, 0.005, '', 'How soft each grain\'s edge is.'),
      dial('sand', 'patches', 'Patches', 0.001, 0.5, 0.005, '', 'How much of the picture\'s coarse patches the streaks keep: lower breaks them up more.'),
      dial('sand', 'flatten', 'Flying grains hide the relief', 0, 1, 0.01, '', 'How much the grains in flight flatten the ground\'s ripples and shine under them.'),
      dial('sand', 'fadeFrom', 'Fades from', 0.5, 16, 0.5, 'texels', 'Picture texels a pixel at which the streaks begin to fade with distance.'),
      dial('sand', 'fadeTo', 'Gone at', 1, 32, 0.5, 'texels', 'And are gone, so far grains never become a flat tint.'),
      dial('sand', 'wetFull', 'Too wet to blow at', 0.02, 1, 0.01, '', 'How wet the ground must be before no sand blows at all.'),
    ],
  },
  {
    title: 'Prints, ruts and pits',
    note: 'Every depth is times how far the ground gives: none in rock, sand at one, mud two and a half times as deep.',
    dials: [
      dial('ground', 'darkening', 'Pressed ground darker by', 0, 0.6, 0.01, '', 'How much darker the floor of a deep print, rut or pit is at most.'),
      dial('ground', 'darkenScale', 'Darkening per metre of depth', 0, 30, 0.5, '×', 'How fast the darkening comes in with a dent\'s depth.'),
      dial('prints', 'footDepth', 'Footprint depth', 0, 0.2, 0.001, 'm', 'How deep a person\'s foot presses into sand.'),
      dial('prints', 'footAlong', 'Footprint length', 0.1, 0.8, 0.01, 'm', 'A person\'s print from heel to toe.'),
      dial('prints', 'footAcross', 'Footprint width', 0.05, 0.5, 0.01, 'm', 'A person\'s print across.'),
      dial('prints', 'fade', 'Prints fade over', 2, 120, 1, 's', 'How long a print, a rut or a pit takes to fill back in on sand; slower on ground that heals slower.'),
      dial('prints', 'rut', 'Rut dug', 0, 2, 0.01, 'm/s', 'How fast a speeder skimming the sand digs its rut, at a full bite.'),
      dial('prints', 'bowl', 'Rut width', 0.3, 5, 0.05, 'm', 'Half the width of a speeder\'s rut.'),
      dial('prints', 'scour', 'Pit scoured', 0, 0.02, 0.0001, 'm/s', 'How fast a jet blowing down scours its pit, for each metre a second it lands at.'),
      dial('prints', 'craterDepth', 'Crater depth', 0, 0.5, 0.01, '× radius', 'A blast\'s crater, as a share of its radius.'),
      dial('prints', 'craterAcross', 'Crater width', 0.1, 1.5, 0.01, '× radius', 'Half a blast\'s crater across, as a share of its radius.'),
      dial('prints', 'craterReach', 'A blast still digs from', 0, 2, 0.05, '× radius', 'How high over the ground a blast still presses a crater into it, as a share of its radius: shallower the higher it went off, none past this.'),
    ],
  },
];

/** The air's dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const AIR_DIALS: DialSet = { helper: 'air', groups: AIR_GROUPS, shipped: readDials(AIR_GROUPS) };

/** The dials the air's helper of `__debug` has, or null: what the debug menu asks as a helper is picked. */
export function airDialsFor(helper: string): DialSet | null {
  return helper === 'air' ? AIR_DIALS : null;
}
