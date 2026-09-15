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
  lightsaber: { fights: 'lightsaber', hands: 'right', label: 'Lightsabers' },
  lightsaber2h: { fights: 'lightsaber', hands: 'right', label: 'Two-hand lightsabers' },
  lightsaberStaff: { fights: 'lightsaber', hands: 'right', label: 'Double-bladed lightsabers' },
};

/**
 * The class a weapon template belongs to from its path, or null with a reason for the ones the
 * game does not play yet (grenades, turrets, batons, the unarmed "weapons", mines and the like).
 */
export function weaponClassOf(template) {
  const t = template.toLowerCase();
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
  if (/\/ranged\/(thrown|grenade)\//.test(t)) return { skip: 'grenade or thrown weapon' };
  if (/\/ranged\/(turret|mine|trap)\//.test(t) || /\/trap\//.test(t)) return { skip: 'turret, mine or trap' };
  if (/\/melee\/2h_sword\//.test(t)) return { cls: 'sword2h' };
  if (/\/melee\/sword\//.test(t)) return { cls: 'sword1h' };
  if (/\/melee\/knife\//.test(t)) return { cls: 'knife' };
  if (/\/melee\/polearm\//.test(t)) return { cls: 'polearm' };
  if (/\/melee\/(unarmed|baton|axe|special)\//.test(t)) return { skip: `melee kind ${/\/melee\/([^/]+)\//.exec(t)?.[1]} (no style for it yet)` };
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
 * Build the weapons pack: every weapon template sorted into a class, converted by `deps.convert`
 * (returns { model, file, bounds } or { skip }), the unplayable ones listed with why.
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
    const entry = { id: weaponLabel(template), template, class: c.cls, model: r.model, file: r.file, bounds: r.bounds, length: Number(weaponLength(r.bounds).toFixed(2)) };
    // A lightsaber: the blade the client draws from its hilt, and the light it casts.
    if (r.blade) entry.blade = { length: Number(r.blade.length.toFixed(3)), width: Number(r.blade.width.toFixed(3)), open: r.blade.open, close: r.blade.close, ...(r.blade.light ? { light: r.blade.light } : {}) };
    weapons.push(entry);
    counts.set(c.cls, (counts.get(c.cls) ?? 0) + 1);
  }
  for (const [cls, n] of counts) log(`${WEAPON_CLASSES[cls].label}: ${n}`);
  const reasons = new Map();
  for (const s of skipped) reasons.set(s.why.replace(/:.*$/, ''), (reasons.get(s.why.replace(/:.*$/, '')) ?? 0) + 1);
  if (skipped.length) log(`left out: ${[...reasons.entries()].map(([w, n]) => `${n} ${w}`).join('; ')}`);
  return { weapons, skipped };
}
