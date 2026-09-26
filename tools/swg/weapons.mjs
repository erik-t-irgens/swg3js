// Weapons the player can hold: which of the game's weapon templates are which kind, so the game
// can pick the carries, the fighting style and the hand for each. The conversion itself is the
// converter's static-mesh one, handed in by the command so this stays testable.

/** The kinds the game plays, and what each one fights like. */
export const WEAPON_CLASSES = {
  pistol: { fights: 'gun', hands: 'right', label: 'Pistols' },
  carbine: { fights: 'gun', hands: 'right', label: 'Carbines' },
  rifle: { fights: 'gun', hands: 'right', label: 'Rifles' },
  heavy: { fights: 'gun', hands: 'right', label: 'Heavy weapons' },
  sword1h: { fights: 'single', hands: 'either', label: 'One-hand swords' },
  knife: { fights: 'single', hands: 'either', label: 'Knives' },
  sword2h: { fights: 'single', hands: 'right', label: 'Two-hand swords' },
  polearm: { fights: 'staff', hands: 'right', label: 'Polearms and lances' },
  fist: { fights: 'single', hands: 'either', label: 'Fist weapons' },
  lightsaber: { fights: 'lightsaber', hands: 'right', label: 'Lightsabers' },
  lightsaber2h: { fights: 'lightsaber', hands: 'right', label: 'Two-hand lightsabers' },
  lightsaberStaff: { fights: 'lightsaber', hands: 'right', label: 'Double-bladed lightsabers' },
  // The grenades: not held, thrown by the gadget slots, which take their models from here.
  thrown: { fights: 'thrown', hands: 'right', label: 'Grenades and thrown weapons' },
  // The instruments, which are held and are not weapons at all: the owner's call is that they come
  // through this pack because it is the one thing in the game that puts a model in a hand, gives it
  // the game's own name and lists it on a rack. Holding one is what lets a song's own track for that
  // instrument be played (`src/audio/band.ts`); nothing about one ever fights.
  instrument: { fights: 'none', hands: 'right', label: 'Instruments' },
  // The dancer's props: ribbons, sparklers, glowsticks, batons, fans, torches. They come through
  // this pack for the instruments' own reason, and they have one thing nothing else here has --
  // **most of them are not a model at all**. Of the 107 templates, 89 name a `.prt`: the prop *is*
  // the particle effect, and a sparkler with the sparks taken out is nothing. The 17 that are meshes
  // (the batons, the fans, a staff, a sword, the Life Day flowers) are held exactly as a weapon is.
  entertainer: { fights: 'none', hands: 'either', label: "Dancer's props" },
};

/** A melee folder's class when its weapon turns out to carry a lightsaber blade (the named sabers under sword/ and polearm/). */
export function saberClassFor(template) {
  const t = template.toLowerCase();
  if (/\/melee\/2h_sword\//.test(t)) return 'lightsaber2h';
  if (/\/melee\/polearm\//.test(t)) return 'lightsaberStaff';
  return 'lightsaber';
}

/**
 * The class a weapon template belongs to from its path, or null with a reason for the ones the
 * game does not play yet (turrets, the unarmed "weapons", mines and the like).
 */
export function weaponClassOf(template) {
  const t = template.toLowerCase();
  // An instrument is not under object/weapon/ at all, and is taken first for that reason: it is
  // held and named exactly as a weapon is, and fights with nothing.
  if (/^object\/tangible\/instrument\//.test(t)) return /\/base\//.test(t) ? { skip: 'a base template' } : { cls: 'instrument' };
  // A dancer's prop, for the same reason and with the same rule about a base template. The `_l` and
  // `_r` in the name is the hand the game meant it for; both are kept, because a pair of ribbons is
  // two props and the rack is where a player picks which hand a thing goes in.
  if (/^object\/tangible\/dance_prop\//.test(t)) return /\/(shared_)?prop_base\.iff$/.test(t) ? { skip: 'a base template' } : { cls: 'entertainer' };
  if (!t.startsWith('object/weapon/')) return { skip: 'not a weapon' };
  if (/\/lightsaber\//.test(t)) return { cls: 'lightsaber' };
  // The crafted sabers live under the sword folders, their appearance a lightsaber file (.lsb).
  if (/\/melee\/sword\/crafted_saber\//.test(t)) return { cls: 'lightsaber' };
  if (/\/melee\/2h_sword\/crafted_saber\//.test(t)) return { cls: 'lightsaber2h' };
  if (/\/melee\/polearm\/crafted_saber\//.test(t)) return { cls: 'lightsaberStaff' };
  if (/\/ranged\/pistol\//.test(t)) return { cls: 'pistol' };
  if (/\/ranged\/carbine\//.test(t)) return { cls: 'carbine' };
  if (/\/ranged\/rifle\//.test(t)) return { cls: 'rifle' };
  if (/\/ranged\/heavy\//.test(t)) return { cls: 'heavy' };
  // The grenades (fragmentation, thermal detonator, cryoban, glop, poison, proton, the Imperial detonator, the bug bomb) and the fun ones (snowballs).
  if (/\/ranged\/(thrown|grenade)\//.test(t)) return { cls: 'thrown' };
  if (/\/ranged\/(turret|mine|trap)\//.test(t) || /\/trap\//.test(t)) return { skip: 'turret, mine or trap' };
  if (/\/melee\/2h_sword\//.test(t)) return { cls: 'sword2h' };
  // The game's axes (the vibro axe, the heavy-duty axe) are two-handed, its batons (the gaderiffi, the stun baton) one-handed clubs.
  if (/\/melee\/axe\//.test(t)) return { cls: 'sword2h' };
  if (/\/melee\/baton\//.test(t)) return { cls: 'sword1h' };
  if (/\/melee\/sword\//.test(t)) return { cls: 'sword1h' };
  if (/\/melee\/knife\//.test(t)) return { cls: 'knife' };
  if (/\/melee\/polearm\//.test(t)) return { cls: 'polearm' };
  // The "special" melee weapons are worn on the hand: knucklers, the punch dagger, the razor, the fan, the blasterfist.
  if (/\/melee\/special\//.test(t)) return { cls: 'fist' };
  if (/\/melee\/unarmed\//.test(t)) return { skip: 'unarmed (nothing to hold)' };
  return { skip: 'unknown weapon path' };
}

/** A readable name: the file's own name without shared_. */
export function weaponLabel(template) {
  return template.replace(/^.*\//, '').replace(/^shared_/, '').replace(/\.iff$/, '');
}

/** The reach of a weapon from its bounds: its longest extent, in metres. */
export function weaponLength(bounds) {
  if (!bounds) return 1;
  const ext = [0, 1, 2].map((k) => Math.abs(bounds.max[k] - bounds.min[k]));
  return Math.max(0.2, ...ext);
}

/**
 * The effects the pack carries beyond the guns' own weapon-table rows, each under the name the game
 * asks for it by (`WeaponCatalogue.effect`). The first five are the held triggers' beams and the
 * lightning's muzzle, which the new gun types need; the last is the burn itself — the appearance the
 * client's own "on fire" client effect names, which is what a body that has been set alight wears.
 * Every entry is the client's own file: nothing here is ours but the name on the left.
 *
 * `worn` marks an entry that is hung on a living body rather than fired from a gun, and so has to
 * meet `wornOnABody` below. The weapons command checks it against the file it has just written, on
 * every run, so an effect that could not be seen on a body is caught here rather than by the owner
 * staring at a burning creature with no flames on it.
 */
export const EXTRA_EFFECTS = [
  { name: 'flame', path: 'appearance/pt_beam_flame_thrower.prt' },
  { name: 'lightning', path: 'appearance/pt_beam_lightning.prt' },
  { name: 'lightningMuzzle', path: 'appearance/pt_muzzle_lightning.prt' },
  { name: 'acid', path: 'appearance/pt_beam_acid.prt' },
  { name: 'ice', path: 'appearance/pt_beam_ice.prt' },
  { name: 'onfire', path: 'appearance/pt_onfire_player.prt', worn: true },
];

/** The entry on the extra-effects list with this name, or undefined. */
export function extraEffect(name) {
  return EXTRA_EFFECTS.find((e) => e.name === name);
}

/**
 * Which of those a pack has not got, by name: a pack converted before an entry was added has none of
 * it, and every one of the six is in the retail archives, so anything named here is a rerun away.
 */
export function missingExtraEffects(effects) {
  return EXTRA_EFFECTS.filter((e) => !effects?.[e.name]).map((e) => e.name);
}

/**
 * What `status` says about them: how many of the list a pack carries and which it has not got, so a
 * pack with five of six reads differently from one with five of five. (It did not: the line counted
 * the keys in the pack's own block, which cannot tell a pack that is short of one from a pack
 * converted when the list was shorter.)
 */
export function extraEffectsStatus(effects) {
  const missing = missingExtraEffects(effects);
  const have = EXTRA_EFFECTS.length - missing.length;
  return {
    have,
    total: EXTRA_EFFECTS.length,
    missing,
    line: `${have} of ${EXTRA_EFFECTS.length} beyond the guns' own rows${missing.length ? ` (no ${missing.join(', ')})` : ''}`,
  };
}

/**
 * Whether an effect, as the converter writes it, can be worn by a body — which is two properties of
 * every one of its emitters, and both of them are the particle engine's own arithmetic rather than
 * anyone's taste (`src/world/particles.ts`, `EmitterState.createNewParticles` and `Emitter.spawn`).
 *
 *  - **It must draw on a body standing still.** A distance-generated emitter's new-particle count is
 *    taken from how far the emitter moved since the last frame, so on something at rest it is nought
 *    for ever and the effect is simply invisible. A rate-generated emitter puts out its rate whatever
 *    the body is doing, and a one-shot one bursts on its own (the engine's one-shot branch never
 *    consults the generation at all), so either will do.
 *  - **It must ride the body.** A local-space emitter keeps its particles in its own frame and puts
 *    them into the world only as they are drawn, so they travel with whatever the effect is hung on.
 *    A world-space emitter leaves each particle where it was born, so a walking body lays a trail
 *    behind it and wears nothing.
 *
 * Returns `{ ok, why }`; `why` is empty when it passes and names the first fault and the emitters at
 * fault when it does not.
 */
export function wornOnABody(def) {
  const emitters = [];
  for (const g of def?.groups ?? []) for (const e of g?.emitters ?? []) emitters.push(e);
  if (!emitters.length) return { ok: false, why: 'it has no emitters at all' };
  const still = (e) => e.oneShot === true || e.generation === 'rate';
  const rides = (e) => e.localSpace === true;
  const which = (list) => (list.length > 1 ? [`emitters ${list.join(', ')}`, 'are'] : [`emitter ${list[0]}`, 'is']);
  const notStill = emitters.map((e, i) => (still(e) ? -1 : i)).filter((i) => i >= 0);
  if (notStill.length) {
    const [what, is] = which(notStill);
    return { ok: false, why: `${what} of ${emitters.length} ${is} generated by distance, so nothing is drawn on a body that is standing still` };
  }
  const notRiding = emitters.map((e, i) => (rides(e) ? -1 : i)).filter((i) => i >= 0);
  if (notRiding.length) {
    const [what, is] = which(notRiding);
    return { ok: false, why: `${what} of ${emitters.length} ${is} not local space, so the particles stay where they were born and the body walks out of its own fire` };
  }
  return { ok: true, why: '' };
}

/**
 * Build the weapons pack: every weapon template sorted into a class, converted by `deps.convert`
 * (returns { model, file, bounds, icon? } or { skip }), the unplayable ones listed with why.
 * `deps.describe(template, id)`, when given, answers { name, description, slots } (items.mjs).
 */
export function buildWeapons(templates, deps, { log = () => {}, limit = Infinity } = {}) {
  const weapons = [];
  const skipped = [];
  const counts = new Map();
  for (const template of templates.slice(0, limit)) {
    const c = weaponClassOf(template);
    if (!c.cls) {
      skipped.push({ template, why: c.skip });
      continue;
    }
    const r = deps.convert(template);
    if (!r || r.skip) {
      skipped.push({ template, why: r?.skip ?? 'failed' });
      continue;
    }
    // A weapon with a blade file is a lightsaber whatever folder it sits in (the named sabers under sword/ and polearm/).
    const cls = r.blade ? saberClassFor(template) : c.cls;
    const entry = { id: weaponLabel(template), template, class: cls, model: r.model, file: r.file, bounds: r.bounds, length: Number(weaponLength(r.bounds).toFixed(2)) };
    // A thing that is a particle effect and no model: a sparkler, a ribbon, a glowstick. It is held
    // in the sense that it plays at the hand, and it has no bounds and nothing to measure.
    if (r.effect) entry.effect = r.effect;
    // What the backpack shows: the game's own name and description, the hands its arrangement takes, and the picture.
    const d = deps.describe?.(template, entry.id);
    if (d) Object.assign(entry, { name: d.name, description: d.description, slots: d.slots });
    if (r.icon !== undefined) entry.icon = r.icon;
    // A lightsaber: the blade the client draws from its hilt, and the light it casts.
    if (r.blade) entry.blade = { length: Number(r.blade.length.toFixed(3)), width: Number(r.blade.width.toFixed(3)), open: r.blade.open, close: r.blade.close, ...(r.blade.light ? { light: r.blade.light } : {}) };
    // A gun: the client's weapon effect (its family and index into the weapon table), with the shot, muzzle flash and hit effects converted.
    if (WEAPON_CLASSES[cls].fights === 'gun' && deps.fxFor) {
      const fx = deps.fxFor(template);
      if (fx) entry.fx = fx;
    }
    weapons.push(entry);
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  for (const [cls, n] of counts) log(`${WEAPON_CLASSES[cls].label}: ${n}`);
  const reasons = new Map();
  for (const s of skipped) reasons.set(s.why.replace(/:.*$/, ''), (reasons.get(s.why.replace(/:.*$/, '')) ?? 0) + 1);
  if (skipped.length) log(`left out: ${[...reasons.entries()].map(([w, n]) => `${n} ${w}`).join('; ')}`);
  return { weapons, skipped };
}

// ---------------------------------------------------------------------------------------------
// The Force's own effects.
//
// The client has them. Under `appearance/` sit the `pt_force_*.prt` particle effects (the choke, the
// absorb and its trigger, the armour, the feedback, the heal, the knockdown, the meditate, the
// resists, the shield, the speeds, the throw, the weaken and its hit, the channel, and the pieces of
// lightning); under `clienteffect/` sit the `pl_force_*.cef` files, each of which names a particle, a
// sound, or both, in exactly the shape the guns' own effects are read in above; and the beams are
// `.ltn` files in the LEFX format the nebulae's lightning is already read from (`nebula.mjs`,
// `parseLightning`), which is why nothing here parses a beam itself.
//
// What is NOT in the archives is which of those belongs to which power: the game's power table was
// its server's and did not ship. So everything below that is a file path is the client's, and every
// pairing of a power to a file is ours. Each row says which of the two it is (`source`), and a row
// whose files are not in the archives at all comes out `'none'`, so the pack never pretends the game
// had something it has not got.

/** Where the client keeps the Force's effects; a prefix each, for the archive listing. */
export const FORCE_PATHS = {
  particles: 'appearance/pt_force_',
  effects: 'clienteffect/pl_force_',
  /** The beam appearances: the lightning ladder, the choke's bolt, the drain's ray, and the rest. */
  beams: ['appearance/force_lightning', 'appearance/pt_force_', 'appearance/pt_bolt_force_', 'appearance/pt_drain_force'],
};

/** A particle's or client effect's bare name: no folder, no `pt_force_`/`pl_force_`, no extension. */
export function forceName(path) {
  const base = String(path ?? '').replace(/\\/g, '/').replace(/^.*\//, '').replace(/\.[^.]+$/, '');
  return base.replace(/^p[lt]_force_/, '');
}

/**
 * A beam's key: its file name without the folder or the extension, and with nothing stripped, since
 * the beams come under four different prefixes and `pt_force_throw` and the throw's own particle
 * would otherwise want the same name.
 */
export function forceBeamName(path) {
  return String(path ?? '').replace(/\\/g, '/').replace(/^.*\//, '').replace(/\.[^.]+$/, '');
}

/** Where a pack keeps a beam's picture: one per shader, since the beams share theirs. */
export function forceBeamImage(shader) {
  const base = String(shader ?? '').replace(/\\/g, '/').replace(/^.*\//, '').replace(/\.[^.]+$/, '');
  return `force/${base || 'beam'}.png`;
}

/**
 * Which of the game's effects each power wears, and where it is put. The power ids are the game's
 * own (`src/combat/forcePowers.ts`); the files are the client's; the PAIRING is ours except where
 * the client's own data settles it — a client effect that names the particle and the sound together
 * for the very act the power is (the choke is the grip, the throw is the pull, the weaken is the
 * drain, the absorb is the protect, the speed is the speed), or a beam appearance that names the
 * effect at each of its own ends. That is what `source: 'game'` means. `'invented'` is a real effect
 * of the client's put on a power it never named that way; `'none'` is a power the archives hold no
 * effect for, which keeps the burst the game already draws.
 *
 * `parts` is ordered and each entry carries a `role` (`cast` as it fires, `hold` while it lasts,
 * `land` where it arrives), an `at` (`hand`, `body`, `target`) and the files to try in order, the
 * first one the archives hold winning; `beam:start` and `beam:end` stand for the effects the row's
 * own beam names at its two ends, which is the client's answer and is always tried first. `beam`
 * names a row of the built `beams` block, and `cef` a client effect the row takes its sound from
 * when no part of it gives one (which is how a power with no particle at all is still heard).
 */
export const FORCE_POWER_FX = [
  { power: 'jump', source: 'none', note: 'the archives hold no particle for a Force jump, only its sound', cef: 'clienteffect/pl_force_jump.cef', parts: [] },
  {
    power: 'speed',
    source: 'game',
    note: "the client's own speed effects: one as it starts, one while it runs",
    parts: [
      { role: 'cast', at: 'body', files: ['appearance/pt_force_speed_activate.prt'] },
      { role: 'hold', at: 'body', files: ['appearance/pt_force_speed_moves.prt', 'appearance/pt_force_speed.prt'] },
    ],
  },
  { power: 'push', source: 'none', note: 'the archives hold no particle for a Force push, only its sound', cef: 'clienteffect/pl_force_push.cef', parts: [] },
  {
    power: 'pull',
    source: 'game',
    // The client has a beam for the throw as well as a particle, and the beam names its own ends.
    note: "the client's throw is the drag, which is what this power does; its client effect names the particle and the sound together, and it has a beam of its own",
    beam: 'pt_force_throw',
    parts: [{ role: 'cast', at: 'target', files: ['appearance/pt_force_throw.prt'] }],
  },
  {
    power: 'lightning',
    source: 'game',
    // The beam appearance is the Force's own lightning and says itself what plays at each end of a
    // bolt; the ladder of twenty-one light and dark rungs is the client's too, and taking the plain
    // one is ours.
    note: "the client's own lightning beam, which names the effect at each of its ends; the plain rung of the ladder is our pick out of the twenty-one",
    beam: 'force_lightning',
    // The lightning's own particles are under names no client effect reaches, so the sound comes
    // from the client effect the game plays as a bolt begins.
    cef: 'clienteffect/pl_force_lightning_begin.cef',
    parts: [
      { role: 'cast', at: 'hand', files: ['beam:start', 'appearance/pt_force_lightning_start.prt'] },
      { role: 'land', at: 'target', files: ['beam:end', 'appearance/pt_force_lightning_end.prt'] },
    ],
  },
  {
    power: 'drain',
    source: 'game',
    note: "the client's weaken, with its own hit effect where it lands; the beam is the client's ray named for the drain",
    beam: 'pt_drain_force',
    parts: [
      { role: 'hold', at: 'target', files: ['appearance/pt_force_weaken.prt'] },
      { role: 'land', at: 'target', files: ['appearance/pt_force_weaken_hit.prt'] },
    ],
  },
  {
    power: 'grip',
    source: 'game',
    note: "the client's choke, whose client effect names the particle and the sound together; the beam is the client's bolt named for the choke",
    beam: 'pt_bolt_force_choke',
    parts: [{ role: 'hold', at: 'target', files: ['appearance/pt_force_choke.prt'] }],
  },
  { power: 'repulse', source: 'none', note: 'the archives hold no particle for a Force blast, only its sound', cef: 'clienteffect/pl_force_blast.cef', parts: [] },
  { power: 'slow', source: 'none', note: 'the archives hold no particle for holding a body where it stands, only the tangle\'s sound', cef: 'clienteffect/pl_force_tangle.cef', parts: [] },
  {
    power: 'heal',
    source: 'game',
    note: "the client's heal, whose client effect names the particle and the sound together",
    parts: [{ role: 'cast', at: 'body', files: ['appearance/pt_force_heal_self.prt'] }],
  },
  {
    power: 'protect',
    source: 'game',
    note: "the client's absorb: the trigger on oneself as it comes on, the absorb itself where a blow lands",
    parts: [
      { role: 'cast', at: 'body', files: ['appearance/pt_force_absorb_trigger.prt'] },
      { role: 'land', at: 'body', files: ['appearance/pt_force_absorb.prt'] },
    ],
  },
  {
    power: 'rage',
    source: 'invented',
    // Nothing in the archives is a rage: the armour is the nearest self-buff the client draws.
    note: "the client's armour stands in for the rage, which the game has no effect of its own for",
    parts: [{ role: 'cast', at: 'body', files: ['appearance/pt_force_armor.prt'] }],
  },
  { power: 'fists', source: 'none', note: 'bare hands is not a Force power and draws nothing', parts: [] },
];

/** What a pack's `powers` block is, so a reader can tell an older one apart. */
export const FORCE_POWERS_VERSION = 1;

/**
 * Build the pack's `powers` block from the archives. Everything it reads and writes comes in through
 * `deps`, so the shape of the block is testable without an archive anywhere near it:
 *
 * - `list(prefix)` every file path under that prefix (the mounted archives' own listing);
 * - `has(path)` whether a file is there;
 * - `particle(path)` converts a `.prt` into the pack, returning `{ file, id, attached }` or
 *   `{ failed }` (this is `convertParticle`, which caches per pack, so asking twice is free);
 * - `clientEffect(path)` reads a `.cef` as `{ particles, sounds }` (`parseClientEffect`);
 * - `beam(path)` reads a `.ltn` (`parseLightning` from the nebulae's own reader);
 * - `image(shader)` writes a beam's picture into the pack and gives its path, or null.
 *
 * Returns `{ version, effects, clientEffects, beams, powers, skipped, counts }`.
 */
export function buildForcePowers(deps, { log = () => {} } = {}) {
  const list = (prefix) => (deps.list?.(prefix) ?? []).map((p) => String(p).replace(/\\/g, '/').toLowerCase());
  const skipped = [];
  const effects = {};
  const byPath = new Map();

  /** Convert one particle into the pack, once, and keep it under its bare name. */
  const convert = (path) => {
    const key = path.toLowerCase();
    const had = byPath.get(key);
    if (had) return had;
    const r = deps.particle?.(path);
    if (!r || r.failed) {
      skipped.push({ file: path, why: r?.failed ?? 'no particle reader' });
      return null;
    }
    const entry = { particle: path, file: r.file ?? null, carried: r.attached ?? 0, clientEffect: null, sound: null, sounds: [] };
    effects[forceName(path)] = entry;
    byPath.set(key, entry);
    return entry;
  };

  // 1. Every one of the game's Force particle effects, converted into the pack.
  for (const path of list(FORCE_PATHS.particles).filter((p) => /\.prt$/.test(p)).sort()) convert(path);

  // 2. Every Force client effect, read for what it names. 26 of them pair a particle with a sound;
  //    the rest name a sound alone, which is still worth writing down, since a power with no
  //    particle of its own can still be heard.
  const clientEffects = {};
  const speaksFor = new Map(); // particle path -> { score, path, sounds }
  for (const path of list(FORCE_PATHS.effects).filter((p) => /\.cef$/.test(p)).sort()) {
    let cef = null;
    try {
      cef = deps.clientEffect?.(path) ?? null;
    } catch {
      cef = null;
    }
    if (!cef) {
      skipped.push({ file: path, why: 'the client effect did not read' });
      continue;
    }
    const particle = (cef.particles ?? [])[0] ?? null;
    const sounds = cef.sounds ?? [];
    clientEffects[forceName(path)] = { file: path, particle, sounds };
    if (!particle) continue;
    const key = particle.toLowerCase();
    if (!byPath.has(key)) {
      log(`  ${path}: names ${particle}, which is not one of the Force's own particles`);
      continue;
    }
    // Several client effects name one particle (two name the heal, two the speed's own start), and
    // they carry different sounds. The one that speaks for a particle is the one whose own name is
    // the particle's, then one whose name runs into it, then the first alphabetically: keyed on the
    // alphabet alone the speed's start would be heard as a meditation.
    const a = forceName(path);
    const b = forceName(particle);
    const score = a === b ? 2 : a.startsWith(b) || b.startsWith(a) ? 1 : 0;
    const had = speaksFor.get(key);
    if (!had || score > had.score) speaksFor.set(key, { score, path, sounds });
  }
  for (const [key, chosen] of speaksFor) {
    const e = byPath.get(key);
    if (!e) continue;
    e.clientEffect = chosen.path;
    e.sound = chosen.sounds[0] ?? null;
    e.sounds = chosen.sounds;
  }

  // 3. The beams. These are read by the nebulae's own LEFX reader, which gives the flip-book
  //    picture, its timing, the two waveforms and the effects played at each end of a bolt; one
  //    picture is written per shader, since the ladder of them shares its texture.
  const beams = {};
  const images = new Map();
  const beamFiles = [];
  for (const prefix of FORCE_PATHS.beams) for (const p of list(prefix)) if (/\.ltn$/.test(p) && !beamFiles.includes(p)) beamFiles.push(p);
  beamFiles.sort();
  for (const path of beamFiles) {
    let ltn = null;
    try {
      ltn = deps.beam?.(path) ?? null;
    } catch {
      ltn = null;
    }
    if (!ltn) {
      skipped.push({ file: path, why: 'the beam appearance did not read' });
      continue;
    }
    const shader = ltn.texture?.shader ?? null;
    if (shader && !images.has(shader)) images.set(shader, deps.image?.(shader) ?? null);
    const tidy = (p) => (p ? p.replace(/\\/g, '/').toLowerCase() : null);
    const at = (p) => (p ? convert(p)?.file ?? null : null);
    beams[forceBeamName(path)] = {
      source: path,
      flipbook: ltn.texture ?? null,
      texture: shader ? images.get(shader) ?? null : null,
      waveforms: ltn.waveforms ?? [],
      value: ltn.value ?? 0,
      // Both the path the file names and the file we wrote for it: the first is what the beam says,
      // the second is what the game loads.
      startParticle: tidy(ltn.start),
      endParticle: tidy(ltn.end),
      start: at(tidy(ltn.start)),
      end: at(tidy(ltn.end)),
      trailingBytes: ltn.trailingBytes ?? 0,
    };
  }

  // 4. The powers themselves: the table above, resolved against what the archives turned out to
  //    hold. A row that finds nothing is written all the same and marked `none`.
  const powers = [];
  for (const row of FORCE_POWER_FX) {
    const beam = row.beam && beams[row.beam] ? row.beam : null;
    const ends = beam ? beams[beam] : null;
    const parts = [];
    for (const part of row.parts ?? []) {
      // `beam:start` and `beam:end` are what the row's own beam appearance names at its two ends,
      // which is the client's answer to "what plays where the bolt begins".
      const files = (part.files ?? [])
        .map((f) => (f === 'beam:start' ? ends?.startParticle : f === 'beam:end' ? ends?.endParticle : f.toLowerCase()))
        .filter(Boolean);
      const path = files.find((f) => byPath.has(f)) ?? files.find((f) => deps.has?.(f));
      const e = path ? convert(path) : null;
      parts.push({
        role: part.role,
        at: part.at,
        particle: e?.particle ?? null,
        file: e?.file ?? null,
        sound: e?.sound ?? null,
        sounds: e?.sounds ?? [],
        carried: e?.carried ?? 0,
        clientEffect: e?.clientEffect ?? null,
        ...(e ? {} : { missing: (part.files ?? []).map((f) => (f.startsWith('beam:') ? `${row.beam}'s own ${f.slice(5)}` : f)) }),
      });
    }
    const drawn = parts.filter((p) => p.file);
    const source = row.source === 'none' || (!drawn.length && !beam) ? 'none' : row.source;
    const note = source === 'none' && row.source !== 'none' ? `${row.note}; none of it is in these archives, so the game draws its own burst` : row.note;
    // A power with no particle of its own is still heard: the row's own client effect names a sound.
    let own = null;
    if (row.cef) {
      const c = clientEffects[forceName(row.cef)];
      own = { file: row.cef, sounds: c?.sounds ?? [], read: !!c };
    }
    powers.push({ power: row.power, source, note, sound: drawn.find((p) => p.sound)?.sound ?? own?.sounds[0] ?? null, beam, parts, ...(own ? { clientEffect: own.file, sounds: own.sounds } : {}) });
  }

  const counts = {
    particles: Object.keys(effects).length,
    clientEffects: Object.keys(clientEffects).length,
    paired: Object.values(clientEffects).filter((c) => c.particle && c.sounds.length).length,
    beams: Object.keys(beams).length,
    fromGame: powers.filter((p) => p.source === 'game').length,
    invented: powers.filter((p) => p.source === 'invented').length,
    none: powers.filter((p) => p.source === 'none').length,
  };
  log(
    `the Force: ${counts.particles} particle effects, ${counts.clientEffects} client effects (${counts.paired} pairing a particle with a sound), ${counts.beams} beams; ` +
      `${counts.fromGame} powers wear the game's own, ${counts.invented} wear one we chose, ${counts.none} have none${skipped.length ? `, ${skipped.length} files left out` : ''}`,
  );
  return { version: FORCE_POWERS_VERSION, effects, clientEffects, beams, powers, skipped, counts };
}

/** What `status` says about a pack's `powers` block, and whether it must ask for the command again. */
export function forcePowersStatus(block) {
  if (!block || !Array.isArray(block.powers) || !block.powers.length) return { has: false, line: 'the Force powers throw the same spark (no effects converted)' };
  const drawn = block.powers.filter((p) => p.source !== 'none').length;
  const beams = Object.keys(block.beams ?? {}).length;
  const particles = Object.keys(block.effects ?? {}).length;
  return {
    has: true,
    old: (block.version ?? 0) < FORCE_POWERS_VERSION,
    line: `powers: ${drawn} of ${block.powers.length} wear the game's own effect, ${particles} particle effects, ${beams} beams`,
  };
}
