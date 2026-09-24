// The `mobiles` command's thinking: every creature, droid and person the client's mobile
// templates describe, turned into a catalogue the spawner can read. Nothing here touches the
// disk or the archives; the reading is mobilescan.mjs's and the writing the cli's, so every rule
// below can be tested on plain values (tools/swg/tests/mobiles.test.ts).
//
// The words used throughout:
//   entry        one mobile template (one row of the catalogue)
//   appearance   one .sat, shared by many entries; converted once as a model or a parts character
//   pack         one (skeleton set, animation table), shared by many appearances; the clips
//   unit         a thing the run converts and records: a model, a pack, or a wearable folder
import { createHash } from 'node:crypto';
import { childOf, childrenOf, isForm, readCString } from './iff.mjs';
import { DIRECTION, R, skinData } from './skeletal.mjs';
import { buildGlb, everyKeyEquals } from './glb.mjs';

/**
 * Bump whenever the conversion changes what **any** unit holds: every record then reads
 * `oldFormat` and the whole of `mobiles/` is rebuilt, models and wearables included.
 */
export const MOBILES_FORMAT = 1;

/**
 * Bump when only the animation packs change. It is in a pack's own signature and in nothing else,
 * so the 153 packs go stale and the models, colour variants and wearable folders stay current:
 * a rerun with `--skip-existing` then rewrites the packs alone.
 *
 * A pack's signature already carries its clip list, so a pack that gains a clip would go stale by
 * itself -- but the roles, the logical names and the role sources are in the JSON and not in the
 * signature, and a pack can gain a name that resolves to a clip it already had. This is what
 * catches those.
 *
 * 2: the direction selector is read, so the aimed blaster stances and the whole-body shots exist
 * at all, and the curated set asks for them, for the one-handed sword and for the cover postures.
 * 3: a carry row per weapon (`ALLB_CARRIES`) is resolved into the pack's JSON, so the runtime
 *    picks a row instead of matching clip names. No new clip is wanted for it -- every name a row
 *    reads is one 2 already asks for -- so this rides the same rerun and costs no extra bytes in
 *    the GLBs; only the JSON grows.
 */
export const ANIM_FORMAT = 3;
export const KINDS = ['creature', 'droid', 'npc', 'dressed', 'special'];

/** Animation tables whose mobiles are machines, whatever hierarchy they sit on. */
export const DROID_TABLES = new Set(['astromech', 'atat', 'atst', 'basilisk_war_droid', 'battle_droid', 'blastromech', 'cll8', 'cww8', 'droid_2', 'droid_ice', 'droideka', 'dwarf_spider_droid', 'dz70', 'eg6', 'fx_7', 'hailfire_droid', 'hk47', 'ito', 'lin_demolition', 'ma3_mark_1', 'ma3_mark_2', 'ma3_mark_3', 'mouse_droid', 'orb', 'pit_droid', 'probe_droid', 'protocol_droid', 'robo_bartender', 'spider_droid', 'super_battle_droid', 'tt8l', 'tt8l_y7', 'union_sentry_droid', 'wed_treadwell']);
/** Tables that are props rather than creatures: they stand still, or they are scenery with a mouth. */
export const SPECIAL_TABLES = new Set(['baby_colo_claw_fish', 'dianoga_dumpster', 'hoth_turrets', 'sarlacc', 'sarlacc_mini', 'ship_familiar', 'stormtrooper_bobble_head', 'tcg_tauntaun_ride']);

/** What a creature_base table's creatures are like, for behaviour and for the spawner's groups. */
export const FAMILIES = new Map([
  ...['acklay', 'spider', 'rancor', 'cat_predatory', 'canine', 'lizard_giant', 'insect_mantis', 'nexu', 'snake_basic', 'pig', 'bear', 'simian_ape', 'jundak', 'sher_kar', 'rat', 'lava_flea', 'dinosaurid', 'elite_acklay', 'elite_kaadu', 'elite_snake_basic', 'elite_tauntaun', 'urnsoris', 'tanray_lizard'].map((t) => [t, 'predator']),
  ...['bantha', 'camel', 'dewback', 'giraffe', 'horse', 'kaadu', 'elephant', 'fambaa', 'goat', 'tauntaun', 'varactyl', 'reek', 'bird_turkey_baz_nitch', 'bird_turkey_nuna', 'bird_turkey_pharple', 'kubaza_beetle', 'millipede'].map((t) => [t, 'herd']),
  ...['cat_domestic', 'frog', 'insect_basic', 'rabbit', 'lizard_basic', 'simian_monkey'].map((t) => [t, 'critter']),
  ...['bat', 'mynock', 'bird_finch', 'bird_giant', 'griffon', 'insect_moth'].map((t) => [t, 'flyer']),
  ['basilisk_war_droid', 'machine'],
]);

/**
 * The combat set an `all_b` table bakes: what a person or droid needs to stand, fight, fall and
 * get up. A name with a speed selector under it bakes one clip per branch, so the clip count is
 * always higher than the name count.
 *
 * The blaster, one-handed sword and cover sections below were added once the direction selector
 * could be read at all: the aimed stances and the whole-body shots resolve to nothing without
 * that fix, so asking for them before it would have written a pack that quietly lacked them. The
 * two-handed sword and the polearm are the owner's to call and are deliberately left out; their
 * names are the same shape (`loop_sword2h_combat`, `loop_polearm_combat` and their swings).
 */
export const CURATED_ALL_B = [
  'loop_standing', 'loop_combat_standing', 'loop_swimming',
  'attack_light_standing', 'attack_heavy_standing',
  'unarmed_standing_ready_jab_double', 'unarmed_standing_ready_lead_uppercut', 'unarmed_standing_ready_rear_roundhouse_kic',
  'unarmed_standing_ready_lead_frontkick', 'unarmed_standing_ready_hammerfist', 'unarmed_standing_ready_headbutt',
  'unarmed_combo_2a', 'unarmed_combo_3a', 'unarmed_combo_4a', 'unarmed_combo_5a',
  // Blasters: the relaxed carry, the ready and aimed standing stances, every whole-body standing
  // shot the game has (six a weapon, odd-numbered), the additive recoils and the ways in and out.
  'cbt_attack_ranged',
  'loop_pistol_standing', 'loop_pistol_combat_standing', 'loop_pistol_combat_standing_aimed',
  'add_pistol_fire_1', 'add_pistol_fire_3',
  'pistol_combat_standing_fire_1', 'pistol_combat_standing_fire_3', 'pistol_combat_standing_fire_5',
  'pistol_combat_standing_fire_7', 'pistol_combat_standing_fire_9', 'pistol_combat_standing_fire_11',
  'trn_pistol_standing_to_pistol_combat_standing', 'trn_pistol_combat_to_pistol_combat_aimed', 'trn_pistol_combat_standing_aimed_to_pistol_combat_standing',
  'loop_rifle', 'loop_rifle_combat_standing', 'loop_rifle_a_combat_standing_aimed',
  'add_rifle_fire_1', 'add_rifle_fire_3',
  'rifle_standing_aimed_fire_1', 'rifle_standing_aimed_fire_3', 'rifle_standing_aimed_fire_5',
  'rifle_standing_aimed_fire_7', 'rifle_standing_aimed_fire_9', 'rifle_standing_aimed_fire_11',
  'trn_rifle_a_standing_hold_to_ready', 'trn_rifle_a_standing_ready_to_aimed', 'trn_rifle_a_standing_aimed_to_ready',
  // The one-handed sword: its own ready stance (a speed set of its own, so a body with a blade
  // walks and runs holding it) and six swings at three heights, both sides, plus a thrust.
  'loop_sword_1h_ready',
  'sword_1h_standing_ready_hrz_slash_middle_r', 'sword_1h_standing_ready_hrz_slash_middle_l',
  'sword_1h_standing_ready_hrz_slash_high_r', 'sword_1h_standing_ready_hrz_slash_low_l',
  'sword_1h_standing_ready_thrust_middle', 'sword_1h_standing_ready_vrt_slash',
  'trn_standing_to_sword_1h_standing_ready', 'trn_cbt_sword_1h_standing_ready_to_standing_2', 'trn_unarmed_standing_ready_to_standing',
  // Cover: kneeling, prone and the crouch, each posture's blaster stances aimed and not, every
  // kneeling and prone shot the game has, and every way in and out between the four postures.
  'loop_kneeling', 'loop_prone', 'loop_crouched',
  'loop_pistol_kneeling', 'loop_pistol_combat_kneeling', 'loop_pistol_combat_kneeling_aimed',
  'loop_rifle_kneeling', 'loop_rifle_kneeling_combat', 'loop_rifle_kneeling_combat_aimed',
  'loop_pistol_prone', 'loop_pistol_combat_prone', 'loop_pistol_combat_prone_aimed',
  'loop_rifle_prone', 'loop_rifle_combat_prone', 'loop_rifle_combat_prone_aimed',
  'pistol_combat_kneeling_fire_1', 'pistol_combat_kneeling_fire_3', 'pistol_combat_kneeling_fire_5',
  'pistol_combat_kneeling_fire_7', 'pistol_kneeling_fire_9', 'pistol_kneeling_fire_11',
  'rifle_kneeling_fire_1', 'rifle_kneeling_fire_3', 'rifle_kneeling_fire_5',
  'rifle_kneeling_fire_7', 'rifle_kneeling_fire_9', 'rifle_kneeling_fire_11',
  'pistol_combat_prone_fire_1', 'rifle_combat_prone_fire_1',
  'trn_standing_to_kneeling', 'trn_kneeling_to_standing', 'trn_kneeling_to_prone', 'trn_prone_to_kneeling',
  'trn_standing_to_prone', 'trn_prone_to_standing', 'trn_standing_to_crouched', 'trn_crouched_to_standing', 'trn_crouched_to_kneeling',
  'rea_get_hit_light_high_center', 'rea_get_hit_light_mid_center', 'rea_get_hit_light_low_left',
  'rea_get_hit_medium_high_center', 'rea_get_hit_medium_mid_center', 'rea_get_hit_medium_low_left',
  'add_rea_get_hit_light', 'add_get_hit_medium',
  'trn_rea_get_hit_heavy_backward', 'rea_incapacitated_hit',
  'trn_rea_get_knocked_down', 'loop_knocked_down', 'trn_knocked_down_to_standing',
  'trn_combat_standing_hit_to_incapacitated_face_up', 'loop_incapacitated_face_up', 'loop_incapacitated_face_down', 'trn_incapacitated_face_up_to_standing',
  'emt_nod_head_once', 'emt_point_forward', 'emt_look_casual', 'emt_shrug_shoulders', 'emt_search', 'emt_wave1',
  'emt_nervous', 'emt_shake_head_no', 'emt_taunt1', 'emt_conversation_1',
];

/** The name tables a display name may hide in, beyond the one `objectName` names itself. */
export const NAME_TABLES = ['mob/creature_names', 'monster_name', 'npc_name', 'droid_name', 'theme_park_name', 'ep3/npc_names', 'som/som_mob', 'npe/npe_name'];

/** What a template's name says about it, when nothing else does. */
export const KEYWORDS = {
  boss: /(^|_)(boss|king|queen|matriarch|patriarch|alpha|lord|champion|warlord|elder|ancient|giant|monstrous|colossal|behemoth)(_|$)/,
  elite: /(^|_)(elite|enraged|berserk|berserker|frenzied|mutated|mutant|savage|vicious|dire|rabid|blood|deadly|feral|crazed)(_|$)/,
  young: /(^|_)(young|baby|juvenile|cub|pup|hatchling|runt|infant|lesser|minor|dwarf|mini)(_|$)/,
  tame: /^(bm_|beast_master_)|(_|^)(pet|mount|tame|domestic|familiar|saddle|tcg|holo|hologram|bobble)(_|$)/,
  hostile: /(^|_)(trooper|soldier|guard|thug|pirate|raider|bandit|mercenary|assassin|bounty|hunter|marauder|cultist|warrior|scout|commando|sniper|officer|enforcer|criminal|smuggler|slaver|gang|thief|militia|nightsister|singing_mountain|zombie|sith|dark_jedi|inquisitor|stormtrooper|battle_droid|droideka|assault|blackscale)(_|$)/,
  faction: /(^|_)(rebel|imperial)(_|$)/,
  civilian: /(^|_)(vendor|merchant|commoner|farmer|trader|citizen|refugee|noble|bartender|musician|dancer|entertainer|pilot|technician|scientist|doctor|medic|chef|servant|slave|prisoner|worker|miner|informant|contact|trainer|quest|npe|ambassador|senator|clerk|patron|villager|waiter|shopkeeper)(_|$)/,
};
const KEYWORD_ORDER = ['boss', 'elite', 'young', 'tame', 'hostile', 'faction', 'civilian'];

/**
 * Core3's numbers against this game's: health from the mobile's HAM pool, damage from its damage
 * range, both on a square-root curve so a level 80 boss is a few times a level 5 critter rather
 * than a hundred times. Set so the public scripts' rancor lands near the planet table's 900 and 38.
 */
export const CORE3_MAP = { hpBase: 30, hpScale: 8, hpMin: 20, hpMax: 6000, damageBase: 4, damageScale: 1.6, damageMin: 1, damageMax: 400, range: 20 };

/** The `wardrobe` run that fills each wardrobe folder the outfits wear from. */
export const WARDROBE_RUNS = {
  human_male: '',
  human_female: ' --gender=female',
  ithorian_male: ' --template=object/creature/player/shared_ithorian_male.iff',
  ithorian_female: ' --template=object/creature/player/shared_ithorian_female.iff --gender=female',
};

const sha1 = (text) => createHash('sha1').update(text).digest('hex');
const norm = (s) => String(s ?? '').replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
const stemOf = (p) => norm(p).replace(/^.*\//, '').replace(/\.[^.]+$/, '');
const round3 = (n) => Number(Number(n).toFixed(3));

// ---------------------------------------------------------------------------------------------
// Ids

/** The catalogue's id for a template: its path under object/mobile/, folder kept. */
export function entryIdOf(templatePath) {
  return norm(templatePath).replace(/^object\/mobile\//, '').replace(/(^|\/)shared_/, '$1').replace(/\.iff$/, '');
}

/** An appearance's id: its .sat file's base name. */
export function appearanceIdOf(satPath) {
  return stemOf(satPath);
}

/** A pack's key: the table, then every skeleton in .sat order as file@attachTo. */
export function packKeyOf(table, skeletons) {
  return `${norm(table)}|${skeletons.map((s) => `${norm(s.file)}@${String(s.attachTo ?? '').toLowerCase()}`).join('+')}`;
}

/** A pack's id: readable where it can be, hashed where the skeleton list runs long. */
export function packIdOf(key) {
  const [table, rest] = key.split('|');
  const skeletons = (rest ?? '').split('+').filter(Boolean).map((s) => {
    const at = s.lastIndexOf('@');
    return { file: at < 0 ? s : s.slice(0, at), attachTo: at < 0 ? '' : s.slice(at + 1) };
  });
  const tableStem = stemOf(table);
  const base = skeletons[0] ? stemOf(skeletons[0].file) : '';
  const tokens = [tableStem];
  if (base && (base !== tableStem || skeletons.length > 1)) tokens.push(base);
  for (const s of skeletons.slice(1)) tokens.push(`${stemOf(s.file)}${s.attachTo && s.attachTo !== 'head' ? `_at_${s.attachTo}` : ''}`);
  const id = tokens.join('-');
  if (id.length <= 48) return id;
  return `${tableStem}-${base}-${skeletons.length}x-${sha1(key).slice(0, 8)}`;
}

/** One combination of customization values, as a key that sorts the same whoever built it. */
export function comboKey(values) {
  return Object.keys(values ?? {}).sort().map((k) => `${k}=${values[k]}`).join(';');
}

export function variantIdOf(key) {
  return `v${sha1(key).slice(0, 8)}`;
}

// ---------------------------------------------------------------------------------------------
// Classification

/** Why a mobile template is not in the catalogue, or null when it is. */
export function exclusionOf({ folder = '', appearance = null, appearanceExists = true, table = null, appearanceId = null }) {
  const top = String(folder ?? '').split('/')[0];
  if (top === 'skeleton') return 'skeleton base template';
  if (top === 'vehicle') return 'vehicle';
  if (!appearance) return 'no appearance';
  const ext = norm(appearance).replace(/^.*\./, '');
  if (ext !== 'sat') return `not skeletal (.${ext})`;
  if (!appearanceExists) return 'appearance missing from the archives';
  if (stemOf(table ?? '') === 'monstrosity' || appearanceId === 'distant_ship_controller' || appearanceId === 'player_transport') return 'not a creature';
  return null;
}

/** Which of the five kinds an entry is. */
export function kindOf({ playerBody = null, hierarchy = null, table = null }) {
  if (playerBody) return 'dressed';
  const t = stemOf(table ?? '');
  if (DROID_TABLES.has(t)) return 'droid';
  if (SPECIAL_TABLES.has(t)) return 'special';
  return stemOf(hierarchy ?? '') === 'creature_base' ? 'creature' : 'npc';
}

/** A creature table's family; an unknown table is taken as a herd animal (the caller says so). */
export function creatureFamilyOf(table) {
  return FAMILIES.get(stemOf(table ?? '')) ?? 'herd';
}

/** Male, female or neither, from the template's own flag first and then the appearance's name. */
export function genderOf({ templateGender = 0, appearanceId = '', faceRig = null, hierarchy = null }) {
  if (templateGender === 1) return 'f';
  const id = String(appearanceId ?? '');
  if (/(^|_)m(_\d+)?(_hue)?$|(^|_)male/.test(id)) return 'm';
  if (/(^|_)f(_\d+)?(_hue)?$|(^|_)female/.test(id)) return 'f';
  // A name that says male in the middle of itself beats the face rig it happens to sit on.
  if (/(^|_)m(_|$)/.test(id)) return 'm';
  if (/(^|_)f(_|$)/.test(id)) return 'f';
  if (faceRig && /_f_face$/.test(stemOf(faceRig))) return 'f';
  if (stemOf(hierarchy ?? '') === 'all_b') return 'm';
  return null;
}

/** What the spawner should know about an entry at a glance. */
export function flagsOf({ folder = '', gameObjectType = 0, roles = null, family = null, riderPose = null }) {
  const out = [];
  const top = String(folder ?? '').split('/')[0];
  if (top === 'hologram') out.push('hologram');
  if (top === 'beast_master') out.push('pet');
  if (top === 'vendor' || gameObjectType === 8203) out.push('vendor');
  if (top === 'npe') out.push('tutorial');
  if (!roles || (!roles.walk && !roles.run && !roles.hover && !roles.swim)) out.push('static');
  if (family === 'flyer' || roles?.hoverIdle || roles?.hover) out.push('flyer');
  if (roles?.swim || roles?.swimIdle) out.push('swims');
  if (riderPose) out.push('rideable');
  return out;
}

/** A plain model, or a parts character because some template of this appearance wears clothes. */
export function formOf(appearance, templates) {
  return templates.some((t) => (t.cdf?.wear ?? []).length) ? 'parts' : 'glb';
}

// ---------------------------------------------------------------------------------------------
// Template parameters. Every decoder reads the type byte first and never reads past its buffer.

/**
 * A number parameter: type 0 is unset (two bytes, the type and its delta), 1 a single value at
 * offset 2, 3 a [min, max] range. Weighted lists and die rolls (2 and 4) are not read.
 */
export function decodeNumberParam(buf, float = true) {
  if (!buf || buf.length < 2) return undefined;
  const read = (o) => (float ? buf.readFloatLE(o) : buf.readInt32LE(o));
  if (buf[0] === 1) return buf.length >= 6 ? read(2) : undefined;
  if (buf[0] === 3) return buf.length >= 10 ? [read(2), read(6)] : undefined;
  return undefined;
}

/** An array parameter (speed, turn rate, acceleration): a count, then a set or unset number each. */
export function decodeFloatArray(buf) {
  if (!buf || buf.length < 4) return undefined;
  const count = buf.readInt32LE(0);
  const out = [];
  let o = 4;
  for (let i = 0; i < count; i++) {
    if (o + 2 > buf.length) break;
    const type = buf[o];
    if (type === 0) {
      out.push(null);
      o += 2;
    } else if (type === 1 && o + 6 <= buf.length) {
      out.push(buf.readFloatLE(o + 2));
      o += 6;
    } else break;
  }
  while (out.length < count) out.push(null);
  return out.some((v) => v !== null) ? out : undefined;
}

/** A string id parameter: a presence byte, the table, a presence byte, the key. An empty key is set. */
export function decodeStringId(buf) {
  if (!buf || buf.length < 1 || buf[0] !== 1) return undefined;
  let o = 1;
  const part = () => {
    if (o >= buf.length) return undefined;
    const present = buf[o++];
    if (present !== 1) return '';
    const end = buf.indexOf(0, o);
    if (end < 0) return undefined;
    const value = buf.toString('latin1', o, end);
    o = end + 1;
    return value;
  };
  const table = part();
  if (table === undefined) return undefined;
  const key = part();
  if (key === undefined) return undefined;
  return { table, key };
}

const PARAM_DEFAULTS = { collisionRadius: 0.5, collisionLength: 1.5, cameraHeight: 0, stepHeight: 0.5, swimHeight: 1, scale: [1, 1], speed: [6, 2], turnRate: [300, 300], acceleration: [12, 4], gameObjectType: 1025 };

/**
 * The size and movement an entry carries, from the first set value of each parameter along its
 * template chain. An unset element of an array takes its neighbour, and only then the default,
 * so a creature with a run speed but no walk speed walks at its run speed rather than at 2 m/s.
 */
export function resolveParams(values = {}) {
  const num = (name) => {
    const v = values[name];
    if (v === undefined || v === null) return PARAM_DEFAULTS[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const pair = (name) => {
    const v = values[name];
    const d = PARAM_DEFAULTS[name];
    if (v === undefined || v === null) return [d[0], d[1]];
    if (!Array.isArray(v)) return [v, v];
    const a = v[0] ?? v[1] ?? d[0];
    const b = v[1] ?? v[0] ?? d[1];
    return [a, b];
  };
  const scale = pair('scale');
  const speed = pair('speed');
  const turn = pair('turnRate');
  const accel = pair('acceleration');
  return {
    size: {
      collisionRadius: round3(num('collisionRadius')),
      collisionLength: round3(num('collisionLength')),
      scale: [round3(scale[0]), round3(scale[1])],
      cameraHeight: round3(num('cameraHeight')),
      stepHeight: round3(num('stepHeight')),
      swimHeight: round3(num('swimHeight')),
    },
    move: { run: round3(speed[0]), walk: round3(speed[1]), turnRun: round3(turn[0]), turnWalk: round3(turn[1]), accel: [round3(accel[0]), round3(accel[1])] },
    gameObjectType: values.gameObjectType === undefined || values.gameObjectType === null ? PARAM_DEFAULTS.gameObjectType : Number(Array.isArray(values.gameObjectType) ? values.gameObjectType[0] : values.gameObjectType),
    gender: values.gender === undefined || values.gender === null ? 0 : Number(Array.isArray(values.gender) ? values.gender[0] : values.gender),
  };
}

// ---------------------------------------------------------------------------------------------
// Client data (.cdf)

/**
 * A mobile's client data: the customization values its templates set (CSSI), and what it wears
 * (WEAR forms of meshes with the colour values for them). PALV and HOBJ are counted only.
 */
export function readClientData(root) {
  if (!root || !isForm(root)) return null;
  const out = { cssi: {}, wear: [], palv: 0, hobj: 0 };
  const pairChunk = (node) => {
    const r = new R(node.data);
    const name = r.str();
    const value = r.remaining >= 4 ? r.i32() : 0;
    return [name, value];
  };
  const walk = (node, wear) => {
    for (const c of node.children ?? []) {
      if (isForm(c)) {
        if (c.type === 'WEAR') {
          const form = { meshes: [], values: {} };
          out.wear.push(form);
          walk(c, form);
        } else walk(c, wear);
        continue;
      }
      if (c.tag === 'CSSI') {
        const [name, value] = pairChunk(c);
        if (name) out.cssi[name] = value;
      } else if (c.tag === 'WCSI' && wear) {
        const [name, value] = pairChunk(c);
        if (name) wear.values[name] = value;
      } else if (c.tag === 'MESH' && wear) {
        wear.meshes.push(norm(new R(c.data).str()));
      } else if (c.tag === 'PALV') out.palv++;
      else if (c.tag === 'HOBJ') out.hobj++;
    }
  };
  walk(root, null);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Animation tables: flattening that keeps every selector step, so a wild spawn's branch can be
// chosen here rather than by the naming the mount manifest depends on.

/**
 * Every leaf an animation template form resolves to, each with the path of selector steps that
 * reaches it. Unlike skeletal.mjs's flattener this renames nothing and loses no nesting.
 */
export function flattenPaths(form, timeScale = 1, path = []) {
  if (!form) return [];
  const v = form.children?.find(isForm);
  switch (form.type) {
    case 'KFAT':
    case 'CKAT':
      return [{ inline: true, timeScale, path }];
    case 'PXAT': {
      const target = norm(new R(childOf(v, 'INFO').data).str());
      return [{ file: target.includes('/') ? target : `appearance/animation/${target}${/\.ans$/i.test(target) ? '' : '.ans'}`, timeScale, path }];
    }
    case 'TSCL': {
      const scale = new R(childOf(v, 'INFO').data).f32();
      return flattenPaths(v.children.filter(isForm)[0], timeScale * (scale || 1), path);
    }
    case 'AGAT': {
      const loop = childOf(v, 'LOOP');
      return flattenPaths(loop && loop.children.find(isForm), timeScale, path);
    }
    case 'PBAT': {
      const primary = new R(childOf(v, 'INFO').data).i8();
      const comps = childrenOf(v, 'COMP');
      return flattenPaths((comps[primary] ?? comps[0])?.children.find(isForm), timeScale, path);
    }
    case 'SPAT':
      return v.children.filter(isForm).flatMap((c, i) => flattenPaths(c, timeScale, [...path, { k: 'speed', i }]));
    case 'YWAT': {
      const out = [];
      for (const [tag, value] of [['NONE', ''], ['YNEG', 'left'], ['YPOS', 'right']]) {
        const holder = childOf(v, tag);
        const child = holder && holder.children.find(isForm);
        if (child) out.push(...flattenPaths(child, timeScale, [...path, { k: 'yaw', v: value }]));
      }
      return out;
    }
    case 'DRAT': {
      // "DIR " is a four-character tag, three letters and a space, as "VAL " is below. Every
      // direction branch is kept with its code; which one a spawn plays is leafPenalty's to say.
      const out = [];
      for (const dir of childrenOf(v, 'DIR ')) {
        // Both are there on every retail branch, but this loop never ran before the tag was
        // corrected, so a branch missing either is stepped over rather than throwing.
        const info = childOf(dir, 'INFO');
        const child = dir.children.find(isForm);
        if (!info || !child) continue;
        out.push(...flattenPaths(child, timeScale, [...path, { k: 'dir', v: new R(info.data).i8() }]));
      }
      return out;
    }
    case 'SSAT': {
      const variable = new R(childOf(v, 'INFO').data).str();
      const anms = childOf(v, 'ANMS');
      const templates = anms ? anms.children.filter(isForm) : [];
      const values = new Map();
      // The value list's tag is "VAL " (three letters and a space), not "VALS".
      const vals = childOf(v, 'VAL ') ?? childOf(v, 'VALS');
      if (vals) {
        const r = new R(vals.data);
        const n = r.i16();
        for (let i = 0; i < n && r.remaining >= 3; i++) {
          const value = r.str();
          const index = r.i16();
          values.set(index, [...(values.get(index) ?? []), value]);
        }
      }
      const dflt = childOf(v, 'DFLT');
      const defaultIndex = dflt ? new R(dflt.data).i16() : -1;
      return templates.flatMap((t, i) => flattenPaths(t, timeScale, [...path, { k: 'sel', variable, values: values.get(i) ?? [], isDefault: i === defaultIndex, i }]));
    }
    default:
      return [{ unsupported: form.type, timeScale, path }];
  }
}

/** A table's hierarchy and every logical name with the leaves it can play. */
export function tableNames(latRoot) {
  const v = latRoot?.children?.find(isForm);
  if (!v) return { hierarchy: '', names: new Map() };
  const info = new R(childOf(v, 'INFO').data);
  const hierarchy = stemOf(info.str());
  const names = new Map();
  const visit = (node) => {
    for (const c of node.children ?? []) {
      if (!isForm(c)) continue;
      if (c.type === 'ANIM') {
        const name = new R(childOf(c, 'INFO').data).str().trim();
        const leaves = flattenPaths(c.children.find(isForm));
        // An ANIM with no animation template at all is a name the table lists but cannot play.
        if (name && leaves.length && !names.has(name)) names.set(name, leaves);
      } else visit(c);
    }
  };
  visit(v);
  return { hierarchy, names };
}

/** How far a leaf is from the branch a wild, calm, unridden spawn would play; lower is nearer. */
function leafPenalty(leaf, female) {
  let penalty = 0;
  for (const step of leaf.path) {
    if (step.k === 'yaw') penalty += step.v ? 50 : 0;
    // A direction code is a bitmask (4 front, 8 back, 1 right, 2 left) and is never 0, so the
    // branch a body facing what it is fighting plays is the front one, DIRECTION.front.
    else if (step.k === 'dir') penalty += step.v === DIRECTION.front ? 0 : 50;
    else if (step.k === 'sel') {
      const values = step.values ?? [];
      const want = step.variable === 'mounted_creature' ? ['0'] : step.variable === 'mood' ? ['calm'] : step.variable === 'gender' ? (female ? ['f'] : ['m', 'o']) : null;
      if (want) penalty += want.some((w) => values.includes(w)) ? 0 : step.isDefault ? 5 : 10;
      else penalty += step.isDefault ? 0 : 3;
    }
  }
  return penalty;
}

/** One leaf per speed branch of a logical name: the one a wild spawn plays. */
export function chooseLeaves(leaves, { female = false } = {}) {
  const best = new Map();
  for (const leaf of leaves ?? []) {
    if (!leaf.file) continue;
    const speedIndex = leaf.path.find((s) => s.k === 'speed')?.i ?? 0;
    const penalty = leafPenalty(leaf, female);
    const have = best.get(speedIndex);
    if (!have || penalty < have.penalty) best.set(speedIndex, { ...leaf, speedIndex, penalty });
  }
  return [...best.values()].sort((a, b) => a.speedIndex - b.speedIndex);
}

/** A clip's name: its animation file, with the time scale and the loop flag only when they clash. */
export function clipNameOf(file, timeScale, loop, taken = new Set()) {
  let name = stemOf(file);
  if (timeScale !== 1) name += `@x${Number(timeScale.toFixed(3))}`;
  if (taken.has(name)) name += loop ? '~loop' : '~once';
  taken.add(name);
  return name;
}

/**
 * Locomotion from a name selected by speed: the still branch is the idle, the moving ones the
 * gaits. A second still branch is ignored rather than named a walk (the basilisk has two).
 */
export function gaitsOf(list) {
  const still = list.filter((g) => g.speed <= 0.05);
  const moving = list.filter((g) => g.speed > 0.05).sort((a, b) => a.speed - b.speed);
  let idle = still[0]?.clip ?? null;
  let gaits = moving;
  if (!still.length && moving.length) {
    idle = moving[0].clip;
    gaits = moving.slice(1);
  }
  let walk = null;
  let run = null;
  if (gaits.length === 1) {
    if (gaits[0].speed > 4) run = gaits[0].clip;
    else walk = gaits[0].clip;
  } else if (gaits.length >= 2) {
    walk = gaits[0].clip;
    run = gaits[gaits.length - 1].clip;
  }
  return { idle, walk, run, gaits: gaits.map((g) => ({ clip: g.clip, speed: round3(g.speed) })) };
}

/** The bytes a compacted clip comes to: full-rate keys for what moves, two keys for what holds still. */
function clipBytes(clip, joints) {
  const rot = Math.min(clip.animatedRotations ?? joints, joints);
  const trn = Math.min(clip.animatedTranslations ?? 0, joints);
  const off = Math.min(clip.offsetTranslations ?? 0, joints);
  return clip.frames * (4 + rot * 16 + trn * 12) + 8 + (joints - rot) * 32 + off * 24 + (joints + trn + off) * 229 + 230;
}

/**
 * What a pack will hold: one clip per (animation file, time scale, loop), the logical names each
 * clip serves, and what it costs. `header(file)` gives an animation's header, or null when the
 * archives have not got it.
 */
export function planPack(def, { header }) {
  const { id, key, table, hierarchy, joints, names, genders = false } = def;
  const set = hierarchy === 'all_b' ? 'curated' : 'full';
  const wanted = set === 'curated' ? CURATED_ALL_B.filter((n) => names.has(n)) : [...names.keys()];
  const clips = [];
  const byKey = new Map();
  const taken = new Set();
  const logical = {};
  const variants = {};
  const missing = [];
  const missingSeen = new Set();
  const skipped = [];
  const femaleNames = new Set(['loop_standing', 'loop_combat_standing']);
  const add = (name, female) => {
    const chosen = chooseLeaves(names.get(name), { female });
    const out = [];
    for (const leaf of chosen) {
      const h = header(leaf.file);
      if (!h) {
        if (!missingSeen.has(leaf.file)) {
          missingSeen.add(leaf.file);
          missing.push(leaf.file);
        }
        continue;
      }
      const loop = name.startsWith('loop_') && h.frames > 1;
      const dedup = `${leaf.file}|${leaf.timeScale.toFixed(3)}|${loop}`;
      let clip = byKey.get(dedup);
      if (!clip) {
        const fps = (h.fps || 30) * leaf.timeScale;
        clip = {
          name: clipNameOf(leaf.file, leaf.timeScale, loop, taken),
          file: leaf.file,
          timeScale: leaf.timeScale,
          loop,
          additive: false,
          frames: h.frames <= 1 ? 2 : loop ? h.frames + 1 : h.frames,
          fps: round3(fps),
          speed: round3((h.speed ?? 0) * leaf.timeScale),
          names: [],
          animatedRotations: h.animatedRotations,
          animatedTranslations: h.animatedTranslations,
          offsetTranslations: h.offsetTranslations,
          transforms: h.transforms ?? [],
        };
        byKey.set(dedup, clip);
        clips.push(clip);
      }
      if (name.startsWith('add_')) clip.additive = true;
      if (!clip.names.includes(name)) clip.names.push(name);
      out.push({ clip: clip.name, speed: clip.speed, speedIndex: leaf.speedIndex });
    }
    return out.sort((a, b) => a.speed - b.speed || a.speedIndex - b.speedIndex);
  };
  for (const name of wanted) {
    const male = add(name, false);
    if (male.length) logical[name] = male.map((g) => g.clip);
    if (genders && femaleNames.has(name)) {
      const female = add(name, true);
      if (female.length) variants[name] = female.map((g) => g.clip);
    }
    // Once per name, whatever genders were asked for: a branch this converter cannot follow.
    for (const leaf of names.get(name) ?? []) {
      if (leaf.unsupported) skipped.push({ name, why: `${leaf.unsupported} animation templates are not converted` });
      else if (leaf.inline) skipped.push({ name, why: 'an animation held inside the table itself is not converted' });
    }
  }
  // The bake adds a bind-pose reference whenever anything is additive, so it is counted here as
  // well, or the plan would promise one clip fewer than the run writes.
  const bindPose = clips.some((c) => c.additive);
  const bindBytes = bindPose ? clipBytes({ frames: 2, animatedRotations: joints, animatedTranslations: joints, offsetTranslations: 0 }, joints) : 0;
  const estimatedBytes = clips.reduce((a, c) => a + clipBytes(c, joints), 0) + bindBytes;
  return { id, key, table, hierarchy, set, joints, clips, bindPose, clipCount: clips.length + (bindPose ? 1 : 0), logical, femaleLogical: variants, missing, skipped, appearances: [], speciesRigs: [], estimatedBytes };
}

const CREATURE_ROLES = {
  toCombat: ['trn_stand_to_stand_combat'],
  fromCombat: ['trn_stand_combat_to_stand'],
  turnLeft: ['turn_left'],
  turnRight: ['turn_right'],
  ranged: ['cbt_attack_ranged', 'cbt_attack_ranged_1'],
  hitLight: ['rea_stand_combat_get_hit_light', 'rea_stand_get_hit_light'],
  hitMedium: ['rea_stand_combat_get_hit_medium', 'rea_stand_get_hit_medium'],
  hitHeavy: ['trn_rea_stand_combat_get_hit_heavy'],
  down: ['trn_stand_to_incapacitated', 'trn_rea_stand_combat_get_hit_heavy'],
  downLoop: ['loop_incapacitated'],
  getUp: ['trn_incapacitated_to_stand'],
  swimDown: ['trn_swim_to_incapacitated_water'],
  swimDownLoop: ['loop_incapacitated_water'],
  hoverDown: ['trn_hovering_to_incapacitated'],
};
const CREATURE_ATTACKS = ['cbt_stand_combat_attack_light', 'cbt_stand_combat_attack_heavy', 'cbt_stand_combat_attack_special_1', 'cbt_stand_combat_attack_special_2'];
const CREATURE_HOVER_ATTACKS = ['cbt_hover_attack_light', 'cbt_hover_attack_heavy', 'cbt_hover_attack_special_1', 'cbt_hover_attack_special_2'];
const CREATURE_EMOTES = { vocalize: 'emt_stand_vocalize', threaten: 'emt_stand_threaten', fidget: 'idl_stand_fidget', eat: 'emt_stand_eat', look: 'emt_stand_look', startle: 'emt_stand_startle', combatVocalize: 'emt_stand_combat_vocalize' };
export const ALLB_ROLES = {
  // The humanoid tables have no plain "stand to combat stance": every one they carry names the
  // weapon it is drawn for, so the generic body takes the sword's and the blaster's in that order.
  // Nothing in the game plays these two yet -- `toCombat` and `fromCombat` were null on every
  // humanoid pack because this table listed no candidates at all -- so what they cost is bytes
  // and what they buy is a pack that has them when something wants them.
  toCombat: ['trn_standing_to_sword_1h_standing_ready', 'trn_pistol_standing_to_pistol_combat_standing'],
  fromCombat: ['trn_unarmed_standing_ready_to_standing', 'trn_cbt_sword_1h_standing_ready_to_standing_2', 'trn_pistol_combat_standing_aimed_to_pistol_combat_standing'],
  hitLight: ['rea_get_hit_light_mid_center', 'add_rea_get_hit_light'],
  hitMedium: ['rea_get_hit_medium_mid_center', 'add_get_hit_medium'],
  hitHeavy: ['trn_rea_get_hit_heavy_backward'],
  hitWhileDown: ['rea_incapacitated_hit'],
  down: ['trn_combat_standing_hit_to_incapacitated_face_up', 'trn_rea_get_hit_heavy_backward'],
  downLoop: ['loop_incapacitated_face_up', 'loop_incapacitated_face_down', 'loop_knocked_down'],
  getUp: ['trn_incapacitated_face_up_to_standing', 'trn_knocked_down_to_standing'],
  knockdown: ['trn_rea_get_knocked_down'],
  knockdownLoop: ['loop_knocked_down'],
  knockdownGetUp: ['trn_knocked_down_to_standing'],
};
export const ALLB_ATTACKS = ['attack_light_standing', 'attack_heavy_standing', 'unarmed_combo_2a', 'unarmed_standing_ready_jab_double', 'unarmed_standing_ready_lead_uppercut', 'unarmed_standing_ready_rear_roundhouse_kic', 'unarmed_standing_ready_lead_frontkick', 'unarmed_standing_ready_hammerfist', 'unarmed_standing_ready_headbutt', 'unarmed_combo_3a', 'unarmed_combo_4a', 'unarmed_combo_5a'];
// The whole-body shots come first and the one-frame additive recoils last, which is the order this
// list has always had -- but the first three resolved to nothing on a humanoid table until the
// direction selector could be read, so every humanoid pack fell through to `add_pistol_fire_1`.
// With the reader fixed a humanoid's `ranged` is a whole-body shot and `rangedAdditive` is false.
export const ALLB_RANGED = ['cbt_attack_ranged', 'pistol_combat_standing_fire_1', 'rifle_standing_aimed_fire_1', 'add_pistol_fire_1', 'add_rifle_fire_1'];

/**
 * The stance a gun carrier stands in, best first: its weapon's aimed loop, then its ready loop,
 * then the relaxed carry it walks about with. Until the direction selector could be read the first
 * two of each pair resolved to nothing, so every humanoid fell through to the third -- and the
 * pistol's third is the holstered carry, whose still branch is the plain breathing idle.
 */
export const ALLB_RANGED_STANCES = {
  pistol: ['loop_pistol_combat_standing_aimed', 'loop_pistol_combat_standing', 'loop_pistol_standing'],
  rifle: ['loop_rifle_a_combat_standing_aimed', 'loop_rifle_combat_standing', 'loop_rifle'],
};

/**
 * One row per weapon a body can hold: which logical name is that weapon's relaxed carry, its
 * weapon-up carry, its aimed loop, what it fires or swings, and the ways in and out.
 *
 * This is the knowledge the runtime used to guess at. `armedRoles` rewrote six roles for a rifle
 * carrier by matching clip **names** with regular expressions, did nothing whatever for a pistol,
 * and had no way of naming a blade's ready stance -- so every sword-carrying body in the game stood
 * in an unarmed guard and threw punches. Which logical name means which weapon's carry is a fact
 * about the animation table, and the table is read here, so it is resolved here, once per pack.
 *
 * Every name below is one the curated list already asks for, so no row costs a clip. `polearm` is
 * the exception and is deliberate: its names are the same shape as the sword's, the curated list
 * does not ask for them yet (the owner's call in the design), and so its row resolves to nothing
 * and is left out of the pack -- the day the list asks for them the row fills itself.
 *
 * A stance name is read as a locomotion name (its speed branches are an idle, a walk and a run)
 * exactly as `loop_standing` is, which is how a rifle's held walk and run are found without
 * anybody matching a clip name for them.
 */
export const ALLB_CARRIES = {
  pistol: {
    relaxed: ['loop_pistol_standing'],
    ready: ['loop_pistol_combat_standing'],
    aimed: ['loop_pistol_combat_standing_aimed'],
    fires: ['pistol_combat_standing_fire_1', 'pistol_combat_standing_fire_3', 'pistol_combat_standing_fire_5', 'pistol_combat_standing_fire_7', 'pistol_combat_standing_fire_9', 'pistol_combat_standing_fire_11'],
    recoil: ['add_pistol_fire_1', 'add_pistol_fire_3'],
    swings: [],
    toCombat: ['trn_pistol_standing_to_pistol_combat_standing'],
    fromCombat: ['trn_pistol_combat_standing_aimed_to_pistol_combat_standing'],
  },
  rifle: {
    relaxed: ['loop_rifle'],
    ready: ['loop_rifle_combat_standing'],
    aimed: ['loop_rifle_a_combat_standing_aimed'],
    fires: ['rifle_standing_aimed_fire_1', 'rifle_standing_aimed_fire_3', 'rifle_standing_aimed_fire_5', 'rifle_standing_aimed_fire_7', 'rifle_standing_aimed_fire_9', 'rifle_standing_aimed_fire_11'],
    recoil: ['add_rifle_fire_1', 'add_rifle_fire_3'],
    swings: [],
    toCombat: ['trn_rifle_a_standing_hold_to_ready'],
    fromCombat: ['trn_rifle_a_standing_aimed_to_ready'],
  },
  sword: {
    relaxed: [],
    ready: ['loop_sword_1h_ready'],
    aimed: [],
    fires: [],
    recoil: [],
    swings: ['sword_1h_standing_ready_hrz_slash_middle_r', 'sword_1h_standing_ready_hrz_slash_middle_l', 'sword_1h_standing_ready_hrz_slash_high_r', 'sword_1h_standing_ready_hrz_slash_low_l', 'sword_1h_standing_ready_vrt_slash', 'sword_1h_standing_ready_thrust_middle'],
    toCombat: ['trn_standing_to_sword_1h_standing_ready'],
    fromCombat: ['trn_cbt_sword_1h_standing_ready_to_standing_2'],
  },
  polearm: {
    relaxed: [],
    ready: ['loop_polearm_combat'],
    aimed: [],
    fires: [],
    recoil: [],
    swings: ['polearm_standing_ready_hrz_slash_middle_r', 'polearm_standing_ready_hrz_slash_middle_l', 'polearm_standing_ready_vrt_slash', 'polearm_standing_ready_thrust_middle'],
    toCombat: ['trn_standing_to_polearm_combat'],
    fromCombat: ['trn_polearm_combat_to_standing'],
  },
  unarmed: {
    relaxed: [],
    ready: ['loop_combat_standing'],
    aimed: [],
    fires: [],
    recoil: [],
    swings: ALLB_ATTACKS,
    toCombat: ['trn_unarmed_standing_to_unarmed_standing_ready'],
    fromCombat: ['trn_unarmed_standing_ready_to_standing'],
  },
};

const EMPTY_ROLES = () => ({
  idle: null, walk: null, run: null, gaits: [],
  idleCombat: null, walkCombat: null, runCombat: null, gaitsCombat: [],
  swimIdle: null, swim: null, gaitsSwim: [],
  hoverIdle: null, hover: null, gaitsHover: [],
  toCombat: null, fromCombat: null, turnLeft: null, turnRight: null,
  attacks: [], hoverAttacks: [],
  ranged: null, rangedAdditive: false, rangedStance: null,
  hitLight: null, hitMedium: null, hitHeavy: null, hitWhileDown: null,
  down: null, downLoop: null, getUp: null,
  knockdown: null, knockdownLoop: null, knockdownGetUp: null,
  swimDown: null, swimDownLoop: null, hoverDown: null,
  emotes: {}, bind: null,
});

/**
 * One weapon's carry row, or null when the table says nothing about that weapon at all.
 *
 * `logicalOf(name)` gives the clips a logical name resolved to, slowest first, and `speedOf(clip)`
 * the ground speed the clip was animated at -- the two things a stance needs to be read as an
 * idle, a walk and a run, exactly as `loop_standing` is. Null rather than a row of nulls, so a pack
 * carries only the weapons it really has something for and the runtime's "no row, behave as before"
 * branch is reached honestly.
 *
 * `plainIdle` is the pack's own standing loop, and a relaxed carry that resolves to **that clip**
 * is dropped. Several of the holstered carries resolve to the plain breathing loop and its plain
 * walk and run -- the client's way of saying "there is no special pose for carrying this" -- and a
 * row that reported them as a carry would make a body fighting with a pistol stand breathing
 * instead of in the guard it stands in today. A carry is only a carry when it is its own clip.
 */
export function resolveCarry(def, logicalOf, speedOf, plainIdle = null) {
  const listOf = (name) => (logicalOf(name) ?? []).map((clip) => ({ clip, speed: speedOf(clip) ?? 0 }));
  // The first name of the list that resolves to anything, read as a locomotion set.
  const locoOf = (names) => {
    for (const n of names ?? []) {
      const list = listOf(n);
      if (list.length) return gaitsOf(list);
    }
    return null;
  };
  const first = (names) => {
    for (const n of names ?? []) {
      const clip = logicalOf(n)?.[0];
      if (clip) return clip;
    }
    return null;
  };
  const each = (names) => (names ?? []).map((n) => logicalOf(n)?.[0] ?? null).filter((c, i, a) => c && a.indexOf(c) === i);
  const ready = locoOf(def.ready);
  let relaxed = locoOf(def.relaxed);
  if (relaxed && relaxed.idle === plainIdle) relaxed = null;
  // The gaits are the weapon-up ones where the table has them and the carry's own otherwise, which
  // is what a rifle has today: its port-arms walk and run, and no combat-stance branches at all.
  const move = ready?.gaits.length ? ready : (relaxed?.gaits.length ? relaxed : (ready ?? relaxed));
  const row = {
    relaxed: relaxed?.idle ?? null,
    ready: ready?.idle ?? null,
    aimed: locoOf(def.aimed)?.idle ?? null,
    walk: move?.walk ?? null,
    run: move?.run ?? null,
    gaits: move?.gaits ?? [],
    fires: each(def.fires),
    recoil: first(def.recoil),
    swings: each(def.swings),
    toCombat: first(def.toCombat),
    fromCombat: first(def.fromCombat),
  };
  const anything = row.relaxed || row.ready || row.aimed || row.fires.length || row.recoil || row.swings.length;
  return anything ? row : null;
}

/** Every weapon the table says anything about, as `{ pistol: row, ... }`; `{}` for a hierarchy with none. */
export function resolveCarries(plan, hierarchy = plan.hierarchy, plainIdle = null) {
  if (hierarchy !== 'all_b') return {};
  const speedOf = new Map(plan.clips.map((c) => [c.name, c.speed]));
  const out = {};
  for (const [weapon, def] of Object.entries(ALLB_CARRIES)) {
    const row = resolveCarry(def, (n) => plan.logical[n], (c) => speedOf.get(c), plainIdle);
    if (row) out[weapon] = row;
  }
  return out;
}

/**
 * Which clip plays for each thing a mobile does. The candidates follow the hierarchy's own
 * links (all_b.ash and creature_base.ash), so a death goes down the way the client took it.
 */
export function resolveRoles(plan, hierarchy = plan.hierarchy) {
  const roles = EMPTY_ROLES();
  const sources = {};
  const speedOf = new Map(plan.clips.map((c) => [c.name, c.speed]));
  const first = (name) => plan.logical[name]?.[0] ?? null;
  const pick = (role, candidates) => {
    for (const name of candidates) {
      const clip = first(name);
      if (clip) {
        roles[role] = clip;
        sources[role] = name;
        return;
      }
    }
  };
  const loco = (name, into) => {
    const list = (plan.logical[name] ?? []).map((clip) => ({ clip, speed: speedOf.get(clip) ?? 0 }));
    if (!list.length) return null;
    const g = gaitsOf(list);
    roles[into.idle] = g.idle;
    if (into.walk) roles[into.walk] = g.walk;
    if (into.run) roles[into.run] = g.run;
    roles[into.gaits] = g.gaits;
    if (g.idle) sources[into.idle] = name;
    return g;
  };
  const allB = hierarchy === 'all_b';
  loco(allB ? 'loop_standing' : 'loop_stand', { idle: 'idle', walk: 'walk', run: 'run', gaits: 'gaits' });
  loco(allB ? 'loop_combat_standing' : 'loop_stand_combat', { idle: 'idleCombat', walk: 'walkCombat', run: 'runCombat', gaits: 'gaitsCombat' });
  // Swimming and hovering have one moving role, not a walk and a run, and most things swim slowly
  // enough that their lone gait lands in the walk slot: take it from whichever slot it fell into,
  // or a creature that plainly swims would carry no swim clip at all.
  const swimming = loco('loop_swimming', { idle: 'swimIdle', walk: null, run: 'swim', gaits: 'gaitsSwim' });
  if (!roles.swim) roles.swim = swimming?.walk ?? null;
  if (!allB) {
    const hovering = loco('loop_hovering', { idle: 'hoverIdle', walk: null, run: 'hover', gaits: 'gaitsHover' });
    if (!roles.hover) roles.hover = hovering?.walk ?? null;
  }
  if (allB) {
    for (const [role, candidates] of Object.entries(ALLB_ROLES)) pick(role, candidates);
    roles.attacks = ALLB_ATTACKS.map(first).filter((c, i, a) => c && a.indexOf(c) === i);
    pick('ranged', ALLB_RANGED);
    roles.rangedAdditive = !!sources.ranged?.startsWith('add_');
    const stance = (names) => gaitsOf((names.map((n) => plan.logical[n]).find((l) => l?.length) ?? []).map((clip) => ({ clip, speed: speedOf.get(clip) ?? 0 }))).idle;
    if (sources.ranged && /pistol/.test(sources.ranged)) roles.rangedStance = stance(ALLB_RANGED_STANCES.pistol);
    else if (sources.ranged && /rifle/.test(sources.ranged)) roles.rangedStance = stance(ALLB_RANGED_STANCES.rifle);
    for (const name of CURATED_ALL_B) if (name.startsWith('emt_') && first(name)) roles.emotes[name.slice(4)] = first(name);
  } else {
    for (const [role, candidates] of Object.entries(CREATURE_ROLES)) pick(role, candidates);
    roles.attacks = CREATURE_ATTACKS.map(first).filter((c, i, a) => c && a.indexOf(c) === i);
    roles.hoverAttacks = CREATURE_HOVER_ATTACKS.map(first).filter((c, i, a) => c && a.indexOf(c) === i);
    for (const [key, name] of Object.entries(CREATURE_EMOTES)) if (first(name)) roles.emotes[key] = first(name);
  }
  if (plan.clips.some((c) => c.additive)) roles.bind = 'bind_pose';
  return { roles, sources, carries: resolveCarries(plan, hierarchy, roles.idle) };
}

/** The roles that differ when the female branch is chosen, or {} when nothing does. */
export function genderVariant(plan, roles) {
  const female = { ...plan, logical: { ...plan.logical, ...plan.femaleLogical } };
  if (!Object.keys(plan.femaleLogical ?? {}).length) return {};
  const other = resolveRoles(female, plan.hierarchy).roles;
  const out = {};
  for (const role of ['idle', 'walk', 'run', 'idleCombat', 'walkCombat', 'runCombat']) if (other[role] && other[role] !== roles[role]) out[role] = other[role];
  return Object.keys(out).length ? { 'gender:f': out } : {};
}

/**
 * A one-key clip held for one frame: three finishes a zero-length action on its first update, so
 * a recoil would never show, and a repeating one divides by that length and poses the bones at NaN.
 */
export function padSingleFrame(clip, fps) {
  if (clip.times.length !== 1) return clip;
  const dt = 1 / (fps || 30);
  clip.times = Float32Array.of(0, dt);
  for (const t of clip.tracks) {
    const r = new Float32Array(8);
    r.set(t.rotations.subarray(0, 4), 0);
    r.set(t.rotations.subarray(0, 4), 4);
    const tr = new Float32Array(6);
    tr.set(t.translations.subarray(0, 3), 0);
    tr.set(t.translations.subarray(0, 3), 3);
    t.rotations = r;
    t.translations = tr;
  }
  clip.duration = dt;
  return clip;
}

/** The GLB and the JSON for one pack: the skin, every clip baked and compacted, and what it holds. */
export function bakePack(plan, { skeleton, loadAnimation }) {
  const clips = [];
  for (const c of plan.clips) {
    const a = loadAnimation(c.file);
    if (!a) throw new Error(`${c.file}: not readable`);
    const animation = { ...a };
    if (c.timeScale && c.timeScale !== 1 && c.timeScale > 0) animation.fps = (a.fps || 30) * c.timeScale;
    clips.push({ name: c.name, animation, loop: c.loop });
  }
  const additive = plan.clips.some((c) => c.additive);
  if (additive) {
    // The reference the runtime subtracts to make the shots additive; it keeps every track.
    clips.push({ name: 'bind_pose', loop: false, animation: { fps: 30, frameCount: 1, transforms: [], rotationChannels: [], staticRotations: [], translationChannels: [], staticTranslations: [] } });
  }
  const skin = skinData(skeleton, clips, { flipX: true });
  const spelling = new Map(skeleton.joints.map((j) => [j.name.toLowerCase(), j.name]));
  const json = [];
  let frames = 0;
  const tracks = { full: 0, twoKey: 0, omitted: 0 };
  skin.clips.forEach((clip, i) => {
    const plannedClip = plan.clips[i] ?? null;
    padSingleFrame(clip, plannedClip ? plannedClip.fps : 30);
    if (!plannedClip) clip.keepAllTracks = true;
    frames += clip.times.length;
    const n = clip.times.length;
    clip.tracks.forEach((t, j) => {
      tracks[n > 2 && everyKeyEquals(t.rotations, 4, t.rotations.subarray(0, 4), 1e-6) ? 'twoKey' : 'full']++;
      if (!clip.keepAllTracks && everyKeyEquals(t.translations, 3, skin.joints[j].translation, 1e-5)) tracks.omitted++;
      else tracks[n > 2 && everyKeyEquals(t.translations, 3, t.translations.subarray(0, 3), 1e-6) ? 'twoKey' : 'full']++;
    });
    const duration = (clip.times.length - 1) / (plannedClip ? plannedClip.fps || 30 : 30);
    json.push(plannedClip
      ? {
          name: plannedClip.name, file: plannedClip.file, timeScale: plannedClip.timeScale, loop: plannedClip.loop, additive: plannedClip.additive,
          frames: clip.times.length, fps: plannedClip.fps, duration: round3(duration), speed: plannedClip.speed, names: plannedClip.names,
          ...(plannedClip.additive ? { joints: plannedClip.transforms.map((t) => spelling.get(String(t).toLowerCase())).filter((t) => t !== undefined) } : {}),
        }
      : { name: 'bind_pose', file: '', timeScale: 1, loop: false, additive: false, frames: clip.times.length, fps: 30, duration: round3(duration), speed: 0, names: [] });
  });
  const glb = buildGlb([], { flipX: true, skin, animations: skin.clips, compactTracks: true });
  return { glb, clips: json, frames, bytes: glb.length, tracks };
}

// ---------------------------------------------------------------------------------------------
// Names

/** A name as it should be shown: one line, no leading article, a capital at the front. */
export function cleanName(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/^(an?|the) /i, '');
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** A readable label from a template's file name, when no name table has anything better. */
export function labelOf(base) {
  let s = String(base ?? '').toLowerCase();
  let again = true;
  while (again) {
    const next = s.replace(/^(dressed_|bm_|ep3_|som_|npe_|mtp_|tcg_|event_|quest_)/, '');
    again = next !== s;
    s = next;
  }
  s = s.replace(/_hue$/, '');
  let suffix = '';
  const m = /(?:_(hum|human|twk|twilek|rod|rodian|bth|bothan|mon|moncal|sul|sullustan|trn|trandoshan|wke|wookiee|zab|zabrak|ith|ithorian))?_(m|f|male|female)(?:_?(\d+))?$/.exec(s);
  if (m) {
    s = s.slice(0, m.index);
    suffix = ` (${m[2][0] === 'f' ? 'female' : 'male'}${m[3] ? ` ${m[3]}` : ''})`;
  }
  const words = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return { label: `${words ? words[0].toUpperCase() + words.slice(1) : ''}${suffix}` };
}

const GENERIC_KEY = /_base_(male|female)$/;

/** An entry's display name, where it came from, and the species name when the name is a label. */
export function displayNameOf({ template, folder = '', objectName = null, description = null, lookup }) {
  const base = norm(template).replace(/^.*\//, '').replace(/^shared_/, '').replace(/\.iff$/, '');
  const suffix = folder === 'hologram' ? ' (hologram)' : folder === 'beast_master' ? ' (pet)' : '';
  const usable = (text) => !!text && !!cleanName(text) && !/^(an? )?unknown creature$/i.test(cleanName(text));
  const finish = (text, source, key) => {
    const clean = cleanName(text);
    const generic = (key && GENERIC_KEY.test(key)) || /^hologram image$/i.test(clean);
    return generic ? { name: `${labelOf(base).label}${suffix}`, source: 'label', subtitle: clean } : { name: `${clean}${suffix}`, source, subtitle: null };
  };
  if (objectName?.key) {
    const text = lookup(objectName.table, objectName.key);
    if (usable(text)) return withDescription(finish(text, 'objectName', objectName.key));
    for (const table of NAME_TABLES) {
      for (const key of [objectName.key, objectName.key.replace(/_n$/, '')]) {
        const other = lookup(table, key);
        if (usable(other)) return withDescription(finish(other, 'otherTable', key));
      }
    }
  }
  const keys = [base, base.replace(/_hue$/, ''), base.replace(/^bm_/, ''), base.replace(/^dressed_/, ''), `${base}_n`, base.replace(/^(dressed_|bm_|ep3_|som_|npe_)/, '').replace(/_hue$/, ''), base.replace(/_(m|f)$|_\d+$/, '')];
  for (const table of NAME_TABLES) {
    for (const key of keys) {
      const text = lookup(table, key);
      if (usable(text)) return withDescription(finish(text, 'fileKey', key));
    }
  }
  return withDescription({ name: `${labelOf(base).label}${suffix}`, source: 'label', subtitle: null });

  function withDescription(out) {
    if (!description?.key) return out;
    const text = lookup(description.table, description.key);
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    return clean ? { ...out, description: clean } : out;
  }
}

// ---------------------------------------------------------------------------------------------
// Customization

/** A template's CSSI split into the colours this appearance reads, its body shape, and the rest. */
export function splitCustomization(cssi, readable) {
  const values = {};
  const morphs = {};
  const ignored = [];
  for (const [full, value] of Object.entries(cssi ?? {})) {
    const name = String(full).replace(/^.*\//, '');
    if (/^blend_/.test(name)) morphs[name] = round3(Math.min(1, Math.max(0, value / 255)));
    // No list of readable names at all means every non-morph name is kept: a dressed NPC whose
    // species has not been converted yet would otherwise lose its skin, hair and texture choices
    // for good, with the catalogue still saying it was ready.
    else if (!readable || readable.has(name)) values[name] = value;
    else ignored.push(name);
  }
  return { values, morphs, ignored };
}

// ---------------------------------------------------------------------------------------------
// Outfits

/** A wardrobe's parts by name, each mapped to the item a wearer should be given. */
export function wardrobeIndex(wardrobeJson) {
  const out = new Map();
  const chosen = new Map();
  // Several items can share a mesh (a quest copy of an armour piece, an invisible suit reusing a
  // vest): prefer the one named after the mesh, then the shortest id, then the catalogue's order.
  const named = (item) => stemOf(item.sat ?? '').replace(/_(m|f)$/, '') === item.id;
  for (const item of wardrobeJson?.items ?? []) {
    for (const part of item.parts ?? []) {
      const have = chosen.get(part.name);
      const better = !have || (named(item) && !named(have)) || (named(item) === named(have) && item.id.length < have.id.length);
      if (!better) continue;
      chosen.set(part.name, item);
      out.set(part.name, item.id);
    }
  }
  return out;
}

/** What a mobile wears, resolved to wardrobe items, NPC-only pieces, and what could not be found. */
export function resolveOutfit(wear, { target, wardrobes, present, meshInfo }) {
  const outfit = [];
  const missing = [];
  const npcOnly = [];
  const references = {};
  const note = (w) => {
    if (w) references[w] = (references[w] ?? 0) + 1;
  };
  const wanted = new Set((target.skeletons ?? []).map(norm));
  for (const form of wear ?? []) {
    const values = {};
    for (const [full, v] of Object.entries(form.values ?? {})) values[String(full).replace(/^.*\//, '')] = v;
    for (const mesh of form.meshes ?? []) {
      const info = meshInfo(mesh);
      if (!info || !info.exists) {
        missing.push({ part: stemOf(mesh), mesh, why: 'not in the archives' });
        continue;
      }
      const part = info.part;
      let done = false;
      for (const w of [target.own, target.other]) {
        if (done || !w || !wardrobes.get(w)?.has(part)) continue;
        outfit.push({ part, item: wardrobes.get(w).get(part), wardrobe: `wardrobe/${w}`, values });
        note(w);
        done = true;
      }
      if (done) continue;
      const fits = (info.skeletons ?? []).some((s) => wanted.has(norm(s)));
      const absent = [target.own, target.other].filter((w) => w && !present.has(w));
      if (absent.length && fits) {
        // The wardrobe may well hold this piece; say so rather than converting it as NPC-only.
        missing.push({ part, mesh, why: `wardrobe ${absent[0]} not converted` });
        note(absent[0]);
        continue;
      }
      if (fits) {
        const folder = target.folderOf(part);
        const item = `npc_${part.replace(/_l\d+$/, '')}`;
        outfit.push({ part, item, wardrobe: `mobiles/wearables/${folder}`, values });
        npcOnly.push({ mesh, part, folder });
        continue;
      }
      missing.push({ part, mesh, why: `built for ${(info.skeletons ?? []).map(stemOf).join(', ') || 'no skeleton'}, not ${[...wanted].map(stemOf).join(', ')}` });
    }
  }
  return { outfit, missing, npcOnly, references };
}

/** Whether every piece of an outfit is on disk, and what to convert when it is not. */
export function outfitReadyOf(entry, { wardrobesPresent, wearableUnits }) {
  for (const item of entry.outfit ?? []) {
    if (item.wardrobe.startsWith('wardrobe/')) {
      const w = item.wardrobe.slice('wardrobe/'.length);
      if (!wardrobesPresent.has(w)) return { ready: false, why: `${item.wardrobe} not converted` };
    } else {
      const folder = item.wardrobe.replace(/^mobiles\/wearables\//, '');
      const unit = wearableUnits.get(folder);
      if (!unit?.ready) return { ready: false, why: `${item.wardrobe} not converted` };
      if (unit.items && !unit.items.includes(item.item)) return { ready: false, why: `${item.wardrobe} has not got ${item.item}` };
    }
  }
  for (const miss of entry.outfitMissing ?? []) {
    const m = /^wardrobe (\S+) not converted$/.exec(miss.why);
    if (m) return { ready: false, why: `wardrobe/${m[1]} not converted` };
  }
  return { ready: true, why: null };
}

// ---------------------------------------------------------------------------------------------
// Stats

/** How big a mobile is, from its bind-pose bounds: the corners may come either way round. */
export function sizeClassOf(bounds, scale = 1) {
  if (!bounds) return 'small';
  const e = [0, 1, 2].map((i) => Math.abs(bounds.max[i] - bounds.min[i]) * scale);
  const m = Math.max(e[1], e[0], e[2]);
  if (m < 0.8) return 'tiny';
  if (m < 2.2) return 'small';
  if (m < 4.5) return 'medium';
  if (m < 9) return 'large';
  return 'huge';
}

/** The keyword groups an entry id falls into, in the order they are tested. */
export function keywordsOf(entryId) {
  const id = String(entryId ?? '').replace(/\//g, '_');
  return KEYWORD_ORDER.filter((group) => KEYWORDS[group].test(id));
}

const SIZE_STATS = { tiny: { hp: 30, damage: 4, reach: 1.2 }, small: { hp: 80, damage: 8, reach: 1.5 }, medium: { hp: 180, damage: 14 }, large: { hp: 350, damage: 24 }, huge: { hp: 800, damage: 40 } };

/** Health, damage, reach, temper and whether it shoots, estimated from size, family and name. */
export function heuristicStats({ kind, family = null, sizeClass, bounds = null, keywords = [], flags = [], roles = null, gameObjectType = 0 }) {
  const base = SIZE_STATS[sizeClass] ?? SIZE_STATS.small;
  const has = (k) => keywords.includes(k);
  let hp = base.hp;
  let damage = base.damage;
  if (has('boss')) {
    hp *= 2.5;
    damage *= 1.5;
  }
  if (has('elite')) {
    hp *= 1.5;
    damage *= 1.25;
  }
  if (has('young')) {
    hp *= 0.5;
    damage *= 0.5;
  }
  if (family === 'predator') damage *= 1.2;
  const reach = base.reach ?? (bounds ? round3(0.5 * Math.max(Math.abs(bounds.max[0] - bounds.min[0]), Math.abs(bounds.max[2] - bounds.min[2])) + 0.8) : 1.5);
  const fights = kind === 'dressed' || !!(roles && (roles.attacks?.length || roles.ranged));
  let aggression = 'defensive';
  if (flags.includes('hologram') || flags.includes('vendor') || flags.includes('tutorial') || gameObjectType === 8203 || has('tame') || kind === 'special' || !fights) aggression = 'passive';
  else if (family === 'predator' || has('hostile')) aggression = 'aggressive';
  else if (family === 'critter' || has('civilian')) aggression = 'skittish';
  let ranged = null;
  if (aggression !== 'passive') {
    if (kind === 'dressed') ranged = has('hostile') || has('faction') ? { range: CORE3_MAP.range, additive: false } : null;
    else if (roles?.ranged) ranged = { range: CORE3_MAP.range, additive: !!roles.rangedAdditive };
  }
  return {
    source: 'heuristic', sizeClass, level: null,
    hp: Math.round(hp), damage: Math.round(damage), reach,
    aggression, ranged, attackCooldown: 1.6,
    tags: [...(family ? [family] : []), ...keywords],
  };
}

const RANGED_WEAPON = /pistol|rifle|carbine|blaster|ranged|heavy|light|medium/;
const MELEE_WEAPON = /unarmed|melee/;

/** The same stats read from Core3's own scripts, where a checkout was given. */
export function core3StatsFor(mobiles, heuristic, { kind, roles = null } = {}) {
  if (!mobiles || !mobiles.length) return heuristic;
  const mob = mobiles[0];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ham = mob.ham?.[0] ?? 0;
  const dmg = mob.damage ? (mob.damage[0] + mob.damage[1]) / 2 : 0;
  let aggression;
  if (mob.pvp.includes('AGGRESSIVE') || mob.creature.includes('KILLER') || mob.creature.includes('STALKER')) aggression = 'aggressive';
  else if (!mob.pvp.includes('ATTACKABLE')) aggression = 'passive';
  else aggression = heuristic.aggression === 'skittish' ? 'skittish' : 'defensive';
  let ranged = heuristic.ranged;
  if (kind === 'npc' || kind === 'dressed') {
    const shoots = mob.weapons.some((w) => RANGED_WEAPON.test(w)) && !mob.weapons.every((w) => MELEE_WEAPON.test(w));
    ranged = shoots ? { range: CORE3_MAP.range, additive: !!roles?.rangedAdditive } : null;
  }
  return {
    source: 'core3', sizeClass: heuristic.sizeClass, level: mob.level ?? null,
    hp: clamp(Math.round(CORE3_MAP.hpBase + CORE3_MAP.hpScale * Math.sqrt(ham)), CORE3_MAP.hpMin, CORE3_MAP.hpMax),
    damage: clamp(Math.round(CORE3_MAP.damageBase + CORE3_MAP.damageScale * Math.sqrt(dmg)), CORE3_MAP.damageMin, CORE3_MAP.damageMax),
    reach: heuristic.reach, aggression, ranged, attackCooldown: heuristic.attackCooldown,
    tags: [...heuristic.tags, 'core3'],
    core3: { mobile: mob.name, level: mob.level ?? null, ham: mob.ham ?? null, damage: mob.damage ?? null, chanceHit: mob.chanceHit ?? null, ferocity: mob.ferocity ?? null, pvp: mob.pvp, creature: mob.creature, diet: mob.diet ?? null, attacks: mob.attacks ?? null, weapons: mob.weapons, faction: mob.faction ?? null, socialGroup: mob.socialGroup ?? null, mobiles: mobiles.length },
  };
}

/** Keep the Core3 stats an earlier run read, so a later run without the scripts does not lose them. */
export function carryCore3(entries, previous) {
  const old = new Map((previous?.entries ?? []).filter((e) => e.stats?.source === 'core3').map((e) => [e.id, e.stats]));
  let kept = 0;
  for (const e of entries) {
    const stats = old.get(e.id);
    if (!stats) continue;
    e.stats = stats;
    kept++;
  }
  return kept;
}

// ---------------------------------------------------------------------------------------------
// Units: signatures, states and what the run must do

export function signatureOf(object) {
  return sha1(JSON.stringify(object)).slice(0, 16);
}

/** Which archives this run mounted, so a unit made from another set is never mistaken for it. */
export function sourceStampOf({ retailOnly, archives }) {
  const sorted = [...archives].map(([name, size]) => [String(name).toLowerCase(), size]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { retailOnly: !!retailOnly, archives: sorted.length, key: sha1(JSON.stringify([!!retailOnly, sorted])).slice(0, 12) };
}

/** What the conversion code comes to, so a record written by other code is noticed. */
export function codeStampOf(texts) {
  return sha1(texts.map((t) => String(t).replace(/\r\n/g, '\n')).join('\n \n')).slice(0, 12);
}

/** Whether a unit on disk can be used, and whether --skip-existing may keep it. */
export function unitState(record, { sig, source }, sizeOf) {
  if (!record) return 'missing';
  if (record.format !== MOBILES_FORMAT) return 'oldFormat';
  if (record.source?.key !== source?.key) return 'foreign';
  for (const f of record.files ?? []) {
    const size = sizeOf(f.path);
    if (size === null || size === undefined || size !== f.bytes) return 'incomplete';
  }
  return record.sig !== sig ? 'stale' : 'current';
}

/**
 * Why a model can fail that no run on the same archives can mend: the game's own appearance is
 * stripped at every detail level, so there is nothing to convert. Every other reason (an unreadable
 * file, an exception, a run stopped part way) may go the next time and stays work to do.
 */
export const PERMANENT_FAILURE = /^no mesh survived$/;

/**
 * The catalogue's model failures that no rerun on the same archives can mend, by appearance id:
 * a reason `PERMANENT_FAILURE` names, for an appearance the catalogue still plans, recorded from the
 * archives the catalogue was made from and (when the failure carries it) for the unit signature it
 * plans now. A failure from other archives, or for other inputs, is not permanent: the archives or
 * the appearance changed, and a run may convert it now. A failure written before failures carried
 * their stamps is judged by the catalogue's own source, since every run writes the list afresh.
 */
export function permanentFailures(catalogue) {
  const key = catalogue?.options?.source?.key ?? null;
  const out = new Map();
  if (!key) return out;
  for (const f of catalogue?.failed ?? []) {
    if (f?.what !== 'model' || !PERMANENT_FAILURE.test(String(f.why ?? ''))) continue;
    const app = catalogue.appearances?.[f.id];
    if (!app) continue;
    if ((f.source ?? key) !== key) continue;
    if (f.sig !== undefined && f.sig !== null && f.sig !== app.sig) continue;
    out.set(f.id, f);
  }
  return out;
}

/**
 * The units a status count takes as work to do: every unit not current, except a model that is
 * missing because it is a permanent failure (listed apart, so it is not hidden).
 */
export function unitsToDo(units, permanent) {
  return units.filter((u) => u.state !== 'current' && !(u.kind === 'model' && u.state === 'missing' && permanent.has(u.id)));
}

/** Every unit a catalogue names, with the record that says whether it is current. */
export function unitList(catalogue) {
  const out = [];
  for (const a of Object.values(catalogue.appearances ?? {})) out.push({ kind: 'model', id: a.id, record: a.record, sig: a.sig });
  for (const p of Object.values(catalogue.packs ?? {})) out.push({ kind: 'pack', id: p.id, record: p.json, sig: p.sig });
  for (const w of Object.values(catalogue.wearables ?? {})) out.push({ kind: 'wearables', id: w.dir.replace(/^.*\//, ''), record: w.record, sig: w.sig });
  return out;
}

/**
 * Which units a run converts. An entry id selects everything that entry needs; an appearance id
 * its model and its pack; a pack id that pack alone. `--only` narrows all three to the kinds named.
 */
export function selectWork(plan, { only = null, match = null, limit = null } = {}) {
  // --only=creatures and --only=creature both mean the same thing.
  const asKind = (k) => {
    const word = String(k).toLowerCase().trim();
    return KINDS.includes(word) ? word : KINDS.find((kind) => `${kind}s` === word) ?? word;
  };
  const kinds = only ? new Set(only.map(asKind)) : null;
  const re = match ? new RegExp(match, 'i') : null;
  const entries = plan.entries.filter((e) => !kinds || kinds.has(e.kind));
  const models = new Set();
  const packs = new Set();
  const wearables = new Set();
  const take = (entry) => {
    if (entry.appearance && plan.appearances.get(entry.appearance)?.form) models.add(entry.appearance);
    if (entry.pack) packs.add(entry.pack);
    for (const item of entry.outfit ?? []) if (item.wardrobe.startsWith('mobiles/wearables/')) wearables.add(item.wardrobe.replace(/^mobiles\/wearables\//, ''));
  };
  let chosen = entries;
  if (re) {
    chosen = entries.filter((e) => re.test(e.id));
    for (const [id, app] of plan.appearances) {
      if (!re.test(id) || !app.form) continue;
      if (!entries.some((e) => e.appearance === id)) continue;
      models.add(id);
      if (app.pack) packs.add(app.pack);
    }
    for (const id of plan.packs.keys()) if (re.test(id) && entries.some((e) => e.pack === id)) packs.add(id);
  }
  if (limit !== null && limit !== undefined) chosen = [...chosen].sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, Number(limit));
  for (const entry of chosen) take(entry);
  return { models, packs, wearables, entries: new Set(chosen.map((e) => e.id)) };
}

// ---------------------------------------------------------------------------------------------
// The catalogue

/** The catalogue, from the plan and whatever each unit's record says is on disk. */
export function assembleCatalogue(plan, { records = new Map(), sizeOf = () => null, options = {}, wardrobes = {} } = {}) {
  const seen = new Set();
  for (const e of plan.entries) {
    if (seen.has(e.id)) throw new Error(`duplicate entry id ${e.id}`);
    seen.add(e.id);
  }
  const stateOf = (u) => unitState(records.get(u.record) ?? null, { sig: u.sig, source: plan.source }, sizeOf);
  const usable = (state) => state === 'current' || state === 'stale';
  const appearances = {};
  for (const [id, a] of plan.appearances) {
    if (!a.form) continue;
    const record = records.get(a.record) ?? null;
    const unit = stateOf(a);
    const variants = {};
    for (const [vid, v] of Object.entries(a.variants ?? {})) {
      const kept = record?.variants?.[vid] ?? null;
      variants[vid] = { values: v.values, templates: v.templates, file: kept?.file ?? null, same: !!kept?.same };
    }
    appearances[id] = {
      id, sat: a.sat, form: a.form, file: a.file, record: a.record, sig: a.sig, unit, pack: a.pack,
      skeletons: a.skeletons, joints: a.joints,
      triangles: record?.triangles ?? null,
      bounds: record?.bounds ?? a.bounds,
      sizeClass: a.sizeClass, meshes: record?.meshes ?? [],
      readable: a.readable, base: a.base,
      ...(Object.keys(variants).length ? { variants } : {}),
      riderPose: a.riderPose, templates: a.templates, bytes: record?.bytes ?? null, ready: usable(unit),
    };
  }
  const packs = {};
  for (const [id, p] of plan.packs) {
    const record = records.get(p.json) ?? null;
    const unit = stateOf({ record: p.json, sig: p.sig });
    // The planned count includes the bind pose the bake adds, so it agrees with the record's.
    packs[id] = { id, file: p.file, json: p.json, sig: p.sig, unit, hierarchy: p.hierarchy, set: p.set, clips: record?.clips?.length ?? p.clipCount ?? p.clips.length, bytes: record?.bytes ?? null, appearances: p.appearances, speciesRigs: p.speciesRigs, ready: usable(unit) };
  }
  const wearableUnits = new Map();
  const wearableOut = {};
  for (const [folder, w] of plan.wearables) {
    const record = records.get(w.record) ?? null;
    const unit = stateOf({ record: w.record, sig: w.sig });
    wearableOut[folder] = { dir: w.dir, record: w.record, sig: w.sig, unit, skeleton: w.skeleton, items: record?.items?.length ?? w.meshes.length, bytes: record?.bytes ?? null, ready: usable(unit) };
    wearableUnits.set(folder, { ready: usable(unit), items: record?.items ?? null });
  }
  const present = new Set(Object.entries(wardrobes).filter(([, v]) => v.present).map(([k]) => k));
  const entries = [];
  for (const e of plan.entries) {
    const entry = { ...e };
    let notReady = null;
    if (e.kind === 'dressed') {
      if (!e.speciesReady) notReady = `no species pack characters/${e.species}`;
      else if (e.pack && !packs[e.pack]?.ready) notReady = `pack ${e.pack} ${packs[e.pack] ? packs[e.pack].unit : 'missing'}`;
    } else {
      const app = e.appearance ? appearances[e.appearance] : null;
      if (!app) notReady = 'model not converted';
      else if (!app.ready) notReady = `model ${e.appearance} ${app.unit}`;
      else if (e.pack && !packs[e.pack]?.ready) notReady = `pack ${e.pack} ${packs[e.pack] ? packs[e.pack].unit : 'missing'}`;
    }
    entry.ready = !notReady;
    if (notReady) entry.notReady = notReady;
    const outfit = outfitReadyOf(entry, { wardrobesPresent: present, wearableUnits });
    entry.outfitReady = outfit.ready;
    if (!outfit.ready) entry.outfitNotReady = outfit.why;
    delete entry.speciesReady;
    entries.push(entry);
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const counts = { entries: entries.length, ready: entries.filter((e) => e.ready).length, outfitReady: entries.filter((e) => e.outfitReady).length };
  for (const kind of KINDS) counts[kind] = entries.filter((e) => e.kind === kind).length;
  return {
    format: MOBILES_FORMAT,
    converted: new Date().toISOString(),
    options: { ...options, source: plan.source },
    counts, appearances, packs, wearables: wearableOut, wardrobes,
    entries, excluded: plan.excluded, failed: plan.failed ?? [],
  };
}

/** Which colour combination a plain model bakes, and which others become whole models beside it. */
export function planVariants(combos, { maxVariants = 32 } = {}) {
  const sorted = [...combos].sort((a, b) => b.templates.length - a.templates.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const base = sorted[0] ?? { key: '', values: {}, templates: [] };
  const rest = sorted.slice(1);
  return {
    base,
    variants: rest.slice(0, maxVariants).map((c) => ({ id: variantIdOf(c.key), key: c.key, values: c.values, templates: c.templates })),
    dropped: rest.slice(maxVariants).map((c) => ({ key: c.key, templates: c.templates })),
  };
}

// ---------------------------------------------------------------------------------------------
// Planning: the whole catalogue, every run, whether or not anything is converted

const HUMAN_WARDROBES = ['human_male', 'human_female'];
const ITHORIAN_WARDROBES = ['ithorian_male', 'ithorian_female'];

/** The wardrobe folders a wearer's pieces can come from, and where its NPC-only pieces go. */
function targetFor({ baseSkeleton, gender, skeletons, speciesWardrobe = null }) {
  const stem = stemOf(baseSkeleton ?? '');
  const g = gender === 'f' ? 'female' : 'male';
  if (stem === 'ithorian') return { own: `ithorian_${g}`, other: ITHORIAN_WARDROBES.find((w) => w !== `ithorian_${g}`), skeletons, folderOf: (part) => (/_f(_|$)/.test(part) ? 'ithorian_female' : 'ithorian_male') };
  if (stem === 'all_b') return { own: speciesWardrobe ?? `human_${g}`, other: HUMAN_WARDROBES.find((w) => w !== (speciesWardrobe ?? `human_${g}`)), skeletons, folderOf: (part) => (/_f(_|$)/.test(part) ? 'human_female' : 'human_male') };
  return { own: null, other: null, skeletons, folderOf: () => stem };
}

/**
 * Everything the run will do, worked out from the archives and from what is already on disk:
 * every entry with its name, size, colours, outfit and stats; every model, pack and wearable
 * folder with its signature and state. Converts nothing.
 */
export function planMobiles({ vfs, scan, io, options = {}, source, core3Stats = null, log = () => {}, warn = () => {} }) {
  const rows = scan.scanTemplates(vfs);
  const bodies = scan.playerBodies(vfs);
  const caches = {};
  const excluded = [];
  const live = [];
  for (const row of rows) {
    const appearanceId = row.appearance ? appearanceIdOf(row.appearance) : null;
    const why = exclusionOf({ folder: row.folder, appearance: row.appearance, appearanceExists: row.appearanceExists, appearanceId });
    if (why) excluded.push({ template: row.template, why });
    else live.push({ ...row, appearanceId });
  }
  const scans = new Map();
  for (const row of live) if (!scans.has(row.appearanceId)) scans.set(row.appearanceId, scan.scanAppearance(vfs, row.appearance, caches));
  const kept = [];
  for (const row of live) {
    const s = scans.get(row.appearanceId);
    const why = exclusionOf({ folder: row.folder, appearance: row.appearance, table: s.table, appearanceId: row.appearanceId });
    if (why) excluded.push({ template: row.template, why });
    else kept.push(row);
  }
  const byAppearance = new Map();
  for (const row of kept) (byAppearance.get(row.appearanceId) ?? byAppearance.set(row.appearanceId, []).get(row.appearanceId)).push(row);

  // Names, parameters and classification, one entry per template.
  const lookup = scan.nameLookup(vfs);
  const speciesIndex = io?.readJson('characters/index.json') ?? null;
  const speciesById = new Map((speciesIndex?.species ?? []).map((s) => [s.id, s]));
  const nameSources = { objectName: 0, otherTable: 0, fileKey: 0, label: 0, generic: 0 };
  const entries = [];
  const combosByAppearance = new Map();
  for (const row of kept) {
    const s = scans.get(row.appearanceId);
    const body = bodies.get(row.appearanceId) ?? null;
    const kind = kindOf({ playerBody: body?.species ?? null, hierarchy: s.hierarchy, table: s.table });
    const family = kind === 'creature' ? creatureFamilyOf(s.table) : kind === 'droid' ? 'machine' : kind === 'special' ? 'special' : null;
    if (kind === 'creature' && !FAMILIES.has(stemOf(s.table ?? ''))) warn(`  family unknown for table ${stemOf(s.table ?? '')}, taken as herd`);
    const params = resolveParams(row.values);
    const gender = genderOf({ templateGender: params.gender, appearanceId: row.appearanceId, faceRig: s.skeletons[1]?.file ?? null, hierarchy: s.hierarchy });
    const name = displayNameOf({ template: row.template, folder: row.folder, objectName: row.objectName, description: row.description, lookup });
    nameSources[name.source]++;
    if (name.subtitle) nameSources.generic++;
    const readable = new Set(body ? (speciesById.get(body.species)?.variables ?? []).map((v) => (typeof v === 'string' ? v : v.name)) : s.readable);
    const split = splitCustomization(row.cdf?.cssi, body && !readable.size ? null : readable);
    const key = comboKey(split.values);
    if (!body) {
      const list = combosByAppearance.get(row.appearanceId) ?? combosByAppearance.set(row.appearanceId, new Map()).get(row.appearanceId);
      const combo = list.get(key) ?? list.set(key, { key, values: split.values, templates: [] }).get(key);
      combo.templates.push(row.template);
    }
    entries.push({
      id: entryIdOf(row.template), template: row.template, kind, folder: row.folder,
      group: '', name: name.name, nameSource: name.source, subtitle: name.subtitle,
      ...(name.description ? { description: name.description } : {}),
      flags: [], gender,
      appearance: body ? null : row.appearanceId, species: body?.species ?? null,
      pack: null, variant: null, custom: split.values, morphs: split.morphs,
      outfit: [], size: params.size, move: params.move, gameObjectType: params.gameObjectType,
      stats: null, family, comboKey: key, wear: row.cdf?.wear ?? [], appearanceId: row.appearanceId,
    });
  }

  // Appearances: which are models, which are parts characters, and which colours each bakes.
  const appearances = new Map();
  for (const [id, list] of byAppearance) {
    const s = scans.get(id);
    const body = bodies.get(id) ?? null;
    const form = body ? null : formOf(s, list);
    const combos = [...(combosByAppearance.get(id)?.values() ?? [])];
    const chosen = planVariants(combos.length ? combos : [{ key: '', values: {}, templates: [] }], { maxVariants: options.maxVariants ?? 32 });
    const variants = {};
    if (form === 'glb') for (const v of chosen.variants) variants[v.id] = { key: v.key, values: v.values, templates: v.templates.length };
    // The cap only bites on a plain model: a parts character bakes its base and recolours live.
    const dropped = form === 'glb' ? chosen.dropped : [];
    if (dropped.length) log(`  ${id}: ${dropped.length} colour combinations over the cap of ${options.maxVariants ?? 32}, shown in the base colours`);
    const file = form === 'parts' ? `mobiles/models/${id}/parts.json` : form === 'glb' ? `mobiles/models/${id}.glb` : null;
    const sig = form ? signatureOf(form === 'glb'
      ? { f: MOBILES_FORMAT, source: source.key, sat: s.sat, form, base: chosen.base.values, variants: chosen.variants.map((v) => [v.id, v.values]) }
      : { f: MOBILES_FORMAT, source: source.key, sat: s.sat, form, base: chosen.base.values }) : null;
    appearances.set(id, {
      id, sat: s.sat, form, file, record: form ? `mobiles/models/${id}.json` : null, sig,
      pack: null, skeletons: s.skeletons, joints: s.joints, bounds: s.bounds,
      sizeClass: sizeClassOf(s.bounds), readable: s.readable, base: chosen.base.values,
      variants, variantList: form === 'glb' ? chosen.variants : [], riderPose: s.riderPose,
      templates: list.length, playerBody: body?.species ?? null, table: s.table, hierarchy: s.hierarchy,
      baseSkeleton: s.skeletons[0]?.file ?? null, dropped,
    });
  }

  // Packs: one per (skeleton set, table) any entry uses.
  const packs = new Map();
  const packKeys = new Map();
  for (const [id, a] of appearances) {
    if (!a.table) continue;
    const key = packKeyOf(a.table, a.skeletons);
    const packId = packIdOf(key);
    const have = packKeys.get(packId);
    if (have && have !== key) throw new Error(`pack id ${packId} names two keys: ${have}, ${key}`);
    packKeys.set(packId, key);
    a.pack = packId;
    let p = packs.get(packId);
    if (!p) {
      const table = scan.readTable(vfs, a.table, caches);
      const genders = [...table.names.values()].some((leaves) => leaves.some((l) => l.path.some((step) => step.k === 'sel' && step.variable === 'gender')));
      p = planPack({ id: packId, key, table: a.table, hierarchy: table.hierarchy || a.hierarchy, joints: a.joints, names: table.names, genders }, { header: (f) => scan.readAnimationHeader(vfs, f, caches) });
      const resolved = resolveRoles(p, p.hierarchy);
      p.roles = resolved.roles;
      p.roleSources = resolved.sources;
      p.carries = resolved.carries;
      p.variants = genderVariant(p, resolved.roles);
      p.file = `mobiles/anims/${packId}.glb`;
      p.json = `mobiles/anims/${packId}.json`;
      p.skeletons = a.skeletons;
      p.sig = signatureOf({ f: MOBILES_FORMAT, a: ANIM_FORMAT, source: source.key, key, set: p.set, clips: p.clips.map((c) => [c.file, c.timeScale, c.loop, c.additive]) });
      packs.set(packId, p);
    }
    if (a.playerBody) p.speciesRigs.push(a.playerBody);
    else p.appearances.push(id);
  }
  for (const p of packs.values()) {
    p.appearances.sort();
    p.speciesRigs.sort();
  }
  for (const e of entries) {
    const a = appearances.get(e.appearanceId);
    e.pack = a?.pack ?? null;
    const variant = a?.form === 'glb' ? Object.entries(a.variants).find(([, v]) => v.key === e.comboKey) : null;
    e.variant = variant ? variant[0] : null;
  }

  // Outfits: the wardrobes on disk, then every dressed or clothed entry's pieces.
  const wardrobeIds = new Set([...HUMAN_WARDROBES, ...ITHORIAN_WARDROBES, ...(speciesIndex?.species ?? []).map((s) => s.wardrobe).filter(Boolean)]);
  const wardrobes = new Map();
  const present = new Set();
  for (const w of [...wardrobeIds].sort()) {
    const json = io?.readJson(`wardrobe/${w}/wardrobe.json`) ?? null;
    if (!json) continue;
    present.add(w);
    wardrobes.set(w, wardrobeIndex(json));
  }
  const wardrobeUse = {};
  const wearableFolders = new Map();
  const meshCache = new Map();
  const meshInfo = (lmg) => scan.meshInfo(vfs, lmg, meshCache);
  for (const e of entries) {
    const a = appearances.get(e.appearanceId);
    if (!e.wear.length || (a?.form !== 'parts' && e.kind !== 'dressed')) continue;
    const target = targetFor({
      baseSkeleton: a?.baseSkeleton, gender: e.gender ?? 'm', skeletons: (a?.skeletons ?? []).map((s) => s.file),
      speciesWardrobe: e.species ? speciesById.get(e.species)?.wardrobe ?? null : null,
    });
    const r = resolveOutfit(e.wear, { target, wardrobes, present, meshInfo });
    e.outfit = r.outfit;
    if (r.missing.length) e.outfitMissing = r.missing;
    for (const [w, n] of Object.entries(r.references)) wardrobeUse[w] = (wardrobeUse[w] ?? 0) + n;
    for (const piece of r.npcOnly) {
      const folder = wearableFolders.get(piece.folder) ?? wearableFolders.set(piece.folder, { folder: piece.folder, meshes: new Map(), appearances: new Set(), gender: /female/.test(piece.folder) ? 'f' : 'm' }).get(piece.folder);
      folder.meshes.set(piece.mesh, piece.part);
      folder.appearances.add(e.appearanceId);
    }
  }
  const wearables = new Map();
  for (const [folder, w] of [...wearableFolders].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    // Which skeleton the folder's pieces are built for: a player body's for the wardrobes the
    // game already knows, else the first appearance (by id) that wears from it.
    const bodyId = [...bodies.entries()].find(([, b]) => b.species === folder)?.[0] ?? null;
    const from = bodyId ? appearances.get(bodyId) ?? { skeletons: scans.get(bodyId)?.skeletons ?? [] } : appearances.get([...w.appearances].sort()[0]);
    const skeletons = (from?.skeletons ?? []).map((s) => ({ file: s.file, attachTo: s.attachTo }));
    const meshes = [...w.meshes].map(([lmg, part]) => ({ lmg, part })).sort((a, b) => (a.part < b.part ? -1 : 1));
    wearables.set(folder, {
      folder, dir: `mobiles/wearables/${folder}`, record: `mobiles/wearables/${folder}.json`,
      gender: w.gender, skeletons, skeleton: skeletons[0]?.file ?? '', meshes,
      sig: signatureOf({ f: MOBILES_FORMAT, source: source.key, folder, skeletons: skeletons.map((s) => `${s.file}@${s.attachTo}`), meshes: meshes.map((m) => m.lmg).sort() }),
    });
  }

  // Stats and groups.
  const core3 = core3Stats ?? null;
  for (const e of entries) {
    const a = appearances.get(e.appearanceId);
    const roles = e.pack ? packs.get(e.pack)?.roles ?? null : null;
    const scale = (e.size.scale[0] + e.size.scale[1]) / 2;
    const sizeClass = sizeClassOf(a?.bounds ?? null, scale);
    e.flags = flagsOf({ folder: e.folder, gameObjectType: e.gameObjectType, roles, family: e.family, riderPose: a?.riderPose ?? null });
    const keywords = keywordsOf(e.id);
    const heuristic = heuristicStats({ kind: e.kind, family: e.family, sizeClass, bounds: a?.bounds ?? null, keywords, flags: e.flags, roles, gameObjectType: e.gameObjectType });
    e.stats = core3 ? core3StatsFor(core3.get(e.template) ?? null, heuristic, { kind: e.kind, roles }) : heuristic;
    e.group = e.kind === 'creature' ? `creatures/${e.family}` : e.kind === 'droid' ? 'droids' : e.kind === 'special' ? 'specials'
      : e.kind === 'dressed' ? `dressed/${e.species}`
        : `npcs/${keywords.includes('hostile') ? 'hostile' : keywords.includes('faction') ? 'faction' : keywords.includes('civilian') ? 'civilian' : 'other'}`;
    if (e.kind === 'dressed') e.speciesReady = !!io?.exists(`characters/${e.species}/parts.json`);
    delete e.family;
    delete e.comboKey;
    delete e.wear;
    delete e.appearanceId;
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const wardrobeReport = {};
  for (const [w, references] of Object.entries(wardrobeUse).sort()) wardrobeReport[w] = { references, present: present.has(w) };
  return { source, options, entries, excluded, appearances, packs, wearables, wardrobes: wardrobeReport, wardrobesPresent: present, nameSources, failed: [], templates: rows.length };
}

// ---------------------------------------------------------------------------------------------
// The run

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

/**
 * The whole command: plan, convert what is selected, and write the catalogue. Everything that
 * touches the disk or the archives comes in through `io`, `convert` and `scan`, so the cli case
 * is wiring and this can be driven by a test or a scratch script.
 */
export function runMobiles(ctx) {
  const { vfs, scan, io, convert, options = {}, source, code, core3Stats = null, log = console.log, warn = console.warn } = ctx;
  const started = Date.now();
  const previous = io.readJson('mobiles/catalogue.json');
  const plan = planMobiles({ vfs, scan, io, options, source, core3Stats, log, warn });
  const units = [...unitList({ appearances: Object.fromEntries([...plan.appearances].filter(([, a]) => a.form)), packs: Object.fromEntries(plan.packs), wearables: Object.fromEntries(plan.wearables) })];
  const records = new Map();
  const sizeOf = (p) => io.size(p);
  const states = new Map();
  let fromOtherCode = 0;
  for (const u of units) {
    const record = io.readJson(u.record);
    records.set(u.record, record);
    states.set(u.record, unitState(record, { sig: u.sig, source: plan.source }, sizeOf));
    if (record && record.code !== code) fromOtherCode++;
  }
  if (!core3Stats) {
    const kept = options.core3 === 'none' ? 0 : carryCore3(plan.entries, previous);
    if (kept) log(`  stats: kept Core3 stats for ${kept} entries from the previous catalogue (give --core3 to read them again, --core3=none to drop them)`);
    plan.core3Mode = options.core3 === 'none' ? 'none' : kept ? 'kept' : 'none';
    plan.core3Kept = kept;
  } else {
    plan.core3Mode = 'read';
    plan.core3Kept = 0;
  }

  // What the plan comes to, printed with or without --plan.
  const kinds = KINDS.map((k) => `${plan.entries.filter((e) => e.kind === k).length} ${k === 'creature' ? 'creatures' : k === 'droid' ? 'droids' : k === 'npc' ? 'npcs' : k === 'dressed' ? 'dressed' : 'specials'}`).join(', ');
  const why = new Map();
  for (const x of plan.excluded) why.set(x.why, (why.get(x.why) ?? 0) + 1);
  log(`mobiles: ${plan.templates} templates under object/mobile/: ${plan.entries.length} entries (${kinds}); ${plan.excluded.length} left out (${[...why].map(([w, n]) => `${n} ${w}`).join(', ')})`);
  const models = [...plan.appearances.values()].filter((a) => a.form);
  const bodyPacks = [...plan.packs.values()].filter((p) => p.speciesRigs.length).length;
  const packBytes = [...plan.packs.values()].reduce((a, p) => a + p.estimatedBytes, 0);
  log(`  appearances: ${models.length} to convert (${models.filter((a) => a.form === 'glb').length} models, ${models.filter((a) => a.form === 'parts').length} parts characters) + ${plan.appearances.size - models.length} player bodies; anim packs: ${plan.packs.size} (${[...plan.packs.values()].filter((p) => p.set === 'full').length} creature_base full, ${[...plan.packs.values()].filter((p) => p.set === 'curated').length} all_b curated, ${bodyPacks} on player bodies), about ${mb(packBytes)}`);
  const variantCount = models.reduce((a, m) => a + m.variantList.length, 0);
  log(`  names: ${plan.nameSources.objectName} objectName, ${plan.nameSources.otherTable} other table, ${plan.nameSources.fileKey} file key, ${plan.nameSources.label} label (${plan.nameSources.generic} of them generic species names); colour: ${variantCount} variants over ${models.filter((m) => m.variantList.length).length} models, ${models.reduce((a, m) => a + m.dropped.length, 0)} dropped by the cap`);
  const outfitRefs = plan.entries.reduce((a, e) => a + e.outfit.length + (e.outfitMissing?.length ?? 0), 0);
  const npcOnly = plan.entries.reduce((a, e) => a + e.outfit.filter((i) => i.wardrobe.startsWith('mobiles/')).length, 0);
  const notInArchives = plan.entries.reduce((a, e) => a + (e.outfitMissing ?? []).filter((m) => m.why === 'not in the archives').length, 0);
  const otherSkeleton = plan.entries.reduce((a, e) => a + (e.outfitMissing ?? []).filter((m) => m.why.startsWith('built for')).length, 0);
  // The parts characters wear clothes too, so the total is not the dressed entries' own count.
  const dressedRefs = plan.entries.reduce((a, e) => a + (e.kind === 'dressed' ? e.outfit.length + (e.outfitMissing?.length ?? 0) : 0), 0);
  const absent = Object.entries(plan.wardrobes).filter(([, w]) => !w.present && w.references);
  log(`  outfits: ${outfitRefs} worn pieces (${dressedRefs} on dressed entries), ${outfitRefs - npcOnly - notInArchives - otherSkeleton} in the wardrobes, ${npcOnly} to NPC-only wearables (${[...plan.wearables.values()].reduce((a, w) => a + w.meshes.length, 0)} meshes), ${notInArchives} missing from the archives, ${otherSkeleton} built for another skeleton${absent.map(([w, x]) => `; wardrobe ${w} not converted (${x.references} references wait for it)`).join('')}`);
  log(`  stats: ${plan.entries.length} ${plan.core3Mode === 'read' ? 'from Core3 where named' : 'heuristic'}${plan.core3Kept ? `, ${plan.core3Kept} kept from the previous catalogue` : ''}`);
  const countState = (kind, state) => units.filter((u) => u.kind === kind && states.get(u.record) === state).length;
  const ofKind = (kind) => units.filter((u) => u.kind === kind).length;
  log(`  units: models ${ofKind('model')} (${countState('model', 'current')} current, ${countState('model', 'stale')} stale, ${ofKind('model') - countState('model', 'current')} to convert), anims ${ofKind('pack')} (${countState('pack', 'current')} current, ${ofKind('pack') - countState('pack', 'current')} to convert), wearables ${ofKind('wearables')} (${countState('wearables', 'current')} current, ${ofKind('wearables') - countState('wearables', 'current')} to convert)${units.filter((u) => states.get(u.record) === 'foreign').length ? `, ${units.filter((u) => states.get(u.record) === 'foreign').length} from other archives` : ''}`);
  let work = selectWork(plan, { only: options.only ?? null, match: options.match ?? null, limit: options.limit ?? null });
  log(`  selected: ${work.entries.size} entries -> ${work.models.size} models, ${work.packs.size} packs, ${[...work.models].reduce((a, id) => a + (plan.appearances.get(id)?.variantList.length ?? 0), 0)} variants, ${work.wearables.size} wearable folders`);
  if (options.plan) {
    for (const id of [...work.packs].sort()) {
      const p = plan.packs.get(id);
      const r = p.roles;
      const speed = (clip) => `${clip}${p.clips.find((c) => c.name === clip)?.speed ? ` ${p.clips.find((c) => c.name === clip).speed.toFixed(2)}` : ''}`;
      // Each carry row as "weapon(r=ready a=aimed 6 fires)", so a run says plainly which weapons a
      // pack can really hold and which of them can aim.
      const carries = Object.entries(p.carries ?? {}).map(([w, c]) => `${w}(${[c.ready && 'ready', c.aimed && 'aimed', c.fires.length && `${c.fires.length} fires`, c.swings.length && `${c.swings.length} swings`, !c.fires.length && c.recoil && 'recoil only'].filter(Boolean).join(' ')})`).join(', ');
      log(`  anims ${id} [${p.hierarchy}, ${p.set}]: ${p.clipCount} clips from ${Object.keys(p.logical).length} names, ${p.clips.reduce((a, c) => a + c.frames, 0)} frames, ~${mb(p.estimatedBytes)}; idle ${r.idle ?? 'NONE'}${r.walk ? `, walk ${speed(r.walk)}` : ', NO WALK'}${r.run ? `, run ${speed(r.run)}` : ', NO RUN'}; combat ${r.gaitsCombat.length}; attacks ${r.attacks.length}${r.attacks.length ? '' : ' (NO ATTACK)'}; ranged ${r.ranged ?? 'none'}; hits ${[r.hitLight && 'l', r.hitMedium && 'm', r.hitHeavy && 'h'].filter(Boolean).join('.') || 'NO HITS'}; ${[r.down && 'down', r.downLoop && 'loop', r.getUp && 'up'].filter(Boolean).join('/') || 'NO DOWN'}; emotes ${Object.keys(r.emotes).length}${carries ? `; carries ${carries}` : ''}${p.missing.length ? `; missing ${p.missing.length} .ans` : ''}`);
    }
    log('mobiles: --plan, nothing written');
    return { plan, written: 0, catalogue: null };
  }
  if (options.skipExisting) {
    for (const set of ['models', 'packs', 'wearables']) {
      for (const id of [...work[set]]) {
        const unit = set === 'models' ? plan.appearances.get(id) : set === 'packs' ? plan.packs.get(id) : plan.wearables.get(id);
        const recordPath = set === 'packs' ? unit.json : unit.record;
        if (states.get(recordPath) === 'current') work[set].delete(id);
      }
    }
  }
  if (fromOtherCode && options.skipExisting) log(`  kept ${fromOtherCode} units converted by other converter code of the same format; run without --skip-existing (or with --match) to redo them`);

  // C0: anything a stopped run left behind.
  for (const f of io.listFiles('mobiles')) if (f.includes('.tmp')) io.remove(f);

  const failed = plan.failed;
  const commit = (recordPath, renames, body) => {
    io.remove(recordPath);
    for (const [tmp, final] of renames) io.rename(tmp, final);
    io.writeJsonAtomic(recordPath, body);
    const keep = new Set(body.files.map((f) => f.path));
    for (const f of records.get(recordPath)?.files ?? []) if (!keep.has(f.path)) io.remove(f.path);
    records.set(recordPath, body);
  };
  const header = (unit, id, sig, files) => ({ format: MOBILES_FORMAT, unit, id, sig, source: plan.source, code, written: new Date().toISOString(), files });
  let written = { models: 0, variants: 0, same: 0, packs: 0, wearables: 0, bytes: 0 };

  // C1: the animation packs.
  for (const id of [...work.packs].sort()) {
    const p = plan.packs.get(id);
    const t0 = Date.now();
    try {
      const skeleton = scan.loadSkeletonSet(vfs, p.skeletons);
      const baked = bakePack(p, { skeleton, loadAnimation: (f) => scan.loadAnimation(vfs, f) });
      io.writeFileAtomic(`${p.file}.tmp`, baked.glb);
      const body = {
        ...header('pack', id, p.sig, [{ path: p.file, bytes: baked.glb.length }]),
        key: p.key, file: p.file, table: p.table, hierarchy: p.hierarchy, set: p.set,
        skeletons: p.skeletons, joints: p.joints, appearances: p.appearances, speciesRigs: p.speciesRigs,
        clips: baked.clips, logical: p.logical, roles: p.roles, roleSources: p.roleSources, variants: p.variants,
        // Left out rather than written empty, so a pack with nothing to say about any weapon reads
        // as one the runtime must treat the old way.
        ...(Object.keys(p.carries ?? {}).length ? { carries: p.carries } : {}),
        missing: p.missing, skipped: p.skipped.map((s) => `${s.name}: ${s.why}`), bytes: baked.bytes, tracks: baked.tracks,
      };
      commit(p.json, [[`${p.file}.tmp`, p.file]], body);
      written.packs++;
      written.bytes += baked.bytes;
      log(`  anims ${id}: ${baked.clips.length} clips, ${baked.frames} frames, ${mb(baked.bytes)} (${Date.now() - t0} ms); tracks ${baked.tracks.full} full, ${baked.tracks.twoKey} two-key, ${baked.tracks.omitted} left out${p.missing.length ? `; missing ${p.missing.length} .ans` : ''}`);
    } catch (err) {
      failed.push({ what: 'anims', id, why: err.message });
      warn(`  anims ${id}: ${err.message}`);
    }
  }

  // C2: the models, plain and parts.
  let done = 0;
  for (const id of [...work.models].sort()) {
    const a = plan.appearances.get(id);
    try {
      if (a.form === 'glb') {
        const tmp = `${a.file}.tmp`;
        const info = convert.model(a.sat, tmp, a.base);
        const baseBytes = io.readFile(tmp);
        const files = [{ path: a.file, bytes: baseBytes.length }];
        const renames = [[tmp, a.file]];
        const variants = {};
        for (const v of a.variantList) {
          const file = `mobiles/variants/${id}/${v.id}.glb`;
          try {
            convert.model(a.sat, `${file}.tmp`, v.values);
            const bytes = io.readFile(`${file}.tmp`);
            if (bytes.equals(baseBytes)) {
              io.remove(`${file}.tmp`);
              variants[v.id] = { file: a.file, same: true, bytes: 0 };
              written.same++;
            } else {
              renames.push([`${file}.tmp`, file]);
              files.push({ path: file, bytes: bytes.length });
              variants[v.id] = { file, same: false, bytes: bytes.length };
              written.variants++;
            }
          } catch (err) {
            failed.push({ what: 'variant', id: `${id}/${v.id}`, why: err.message });
            variants[v.id] = { file: null, same: false, bytes: 0 };
          }
        }
        const bytes = files.reduce((x, f) => x + f.bytes, 0);
        commit(a.record, renames, { ...header('model', id, a.sig, files), form: 'glb', joints: info.joints, triangles: info.triangles, meshes: info.meshes, bounds: info.bounds ?? a.bounds, bytes, variants, warnings: (info.warnings ?? []).slice(0, 50) });
        written.models++;
        written.bytes += bytes;
        log(`  model ${id}: ${info.joints} joints, ${info.triangles} tris, ${mb(bytes)}${a.variantList.length ? `, ${a.variantList.length} variants, ${Object.values(variants).filter((v) => v.same).length} same as the base` : ''}`);
      } else {
        const dir = `mobiles/models/${id}`;
        const info = convert.parts(a.sat, `${dir}.tmp`, a.base, { id, anims: a.pack ? `mobiles/anims/${a.pack}.json` : null, gender: genderOf({ appearanceId: id }) === 'f' ? 'female' : 'male' });
        // The old record goes before the folder is swapped, so a crash in between leaves a unit
        // with no record rather than a record describing the new folder with the old sizes.
        io.remove(a.record);
        io.remove(dir);
        io.rename(`${dir}.tmp`, dir);
        const files = io.listFiles(dir).map((p) => ({ path: p, bytes: io.size(p) ?? 0 }));
        const bytes = files.reduce((x, f) => x + f.bytes, 0);
        commit(a.record, [], { ...header('model', id, a.sig, files), form: 'parts', joints: info.joints, triangles: info.triangles, meshes: info.meshes, bounds: info.bounds ?? a.bounds, bytes, recipes: info.recipes ?? 0, images: info.images ?? 0, warnings: (info.warnings ?? []).slice(0, 50) });
        written.models++;
        written.bytes += bytes;
        log(`  parts ${id}: ${info.meshes.length} meshes, ${info.recipes ?? 0} colour recipes, ${mb(bytes)}`);
      }
    } catch (err) {
      // With the unit's signature and the archives it was tried on, so a permanent failure
      // (`permanentFailures`) is only taken as one for the same inputs from the same archives.
      failed.push({ what: 'model', id, why: err.message, sig: a.sig, source: plan.source?.key ?? null });
      warn(`  model ${id}: ${err.message}`);
    }
    convert.clearCaches();
    if (++done % 50 === 0) log(`  models: ${done}/${work.models.size} (${mb(written.bytes)}) ...`);
  }

  // C3: the worn meshes no wardrobe has.
  for (const folder of [...work.wearables].sort()) {
    const w = plan.wearables.get(folder);
    try {
      const r = convert.wearables(`${w.dir}.tmp`, w);
      // As for a parts character: the record first, then the folder.
      io.remove(w.record);
      io.remove(w.dir);
      io.rename(`${w.dir}.tmp`, w.dir);
      const files = io.listFiles(w.dir).map((p) => ({ path: p, bytes: io.size(p) ?? 0 }));
      const bytes = files.reduce((x, f) => x + f.bytes, 0);
      commit(w.record, [], { ...header('wearables', folder, w.sig, files), skeleton: w.skeleton, items: r.items, bytes, failed: r.failed ?? [] });
      for (const part of r.failed ?? []) failed.push({ what: 'wearables', id: `${folder}/${part}`, why: 'no triangles' });
      written.wearables++;
      written.bytes += bytes;
      log(`  wearables ${folder}: ${r.items.length} items, ${mb(bytes)}`);
    } catch (err) {
      failed.push({ what: 'wearables', id: folder, why: err.message });
      warn(`  wearables ${folder}: ${err.message}`);
    }
    convert.clearCaches();
  }

  // C4 and C5: the catalogue, and anything under mobiles/ no unit claims.
  const catalogue = assembleCatalogue(plan, {
    records, sizeOf,
    options: { retailOnly: !!plan.source.retailOnly, core3: plan.core3Mode, core3Kept: plan.core3Kept, only: options.only ?? null, match: options.match ?? null, limit: options.limit ?? null, maxVariants: options.maxVariants ?? 32 },
    wardrobes: plan.wardrobes,
  });
  io.writeJsonAtomic('mobiles/catalogue.json', catalogue, 0);
  const full = !options.only && !options.match && !options.limit;
  if (full) {
    const claimed = new Set(['mobiles/catalogue.json']);
    for (const u of units) claimed.add(u.record);
    for (const record of records.values()) for (const f of record?.files ?? []) claimed.add(f.path);
    let swept = 0;
    for (const dir of ['mobiles/models', 'mobiles/variants', 'mobiles/anims', 'mobiles/wearables']) {
      for (const f of io.listFiles(dir)) {
        if (claimed.has(f)) continue;
        io.remove(f);
        swept++;
      }
    }
    if (swept) log(`  swept ${swept} files no unit claims`);
  }
  const readyCount = (kind) => units.filter((u) => u.kind === kind
    && ['current', 'stale'].includes(unitState(records.get(u.record) ?? null, { sig: u.sig, source: plan.source }, sizeOf))).length;
  const ready = (kind) => `${readyCount(kind)}/${units.filter((u) => u.kind === kind).length}`;
  // What each kind comes to on disk, read from the records, so a unit this run kept counts as
  // much as one it wrote. A model's record counts its variants too, so they are taken back out.
  const bytesOf = (kind, pick) => units.filter((u) => u.kind === kind).reduce((a, u) => a + (pick(records.get(u.record)) || 0), 0);
  const variantBytes = bytesOf('model', (r) => Object.values(r?.variants ?? {}).reduce((x, v) => x + (v.bytes || 0), 0));
  const modelBytes = bytesOf('model', (r) => r?.bytes) - variantBytes;
  const variantsPlanned = [...plan.appearances.values()].reduce((a, m) => a + (m.variantList?.length ?? 0), 0);
  const seconds = Math.round((Date.now() - started) / 1000);
  log(`mobiles: ${catalogue.counts.entries} entries, ${catalogue.counts.ready} ready, ${catalogue.counts.outfitReady} with every outfit piece -> mobiles/catalogue.json`
    + ` | models ${ready('model')} (${written.models} written, ${Math.max(0, readyCount('model') - written.models)} kept, ${mb(modelBytes)})`
    + ` | variants ${variantsPlanned} (${written.variants} written, ${written.same} same as the base, ${mb(variantBytes)})`
    + ` | anims ${ready('pack')} (${written.packs} written, ${mb(bytesOf('pack', (r) => r?.bytes))})`
    + ` | wearables ${ready('wearables')} (${written.wearables} written, ${mb(bytesOf('wearables', (r) => r?.bytes))})`
    + ` | failed ${failed.length} | ${Math.floor(seconds / 60)} min ${seconds % 60} s`);
  if (failed.length) {
    log('failed:');
    for (const f of failed.slice(0, 40)) log(`  ${f.what} ${f.id}: ${f.why}`);
  }
  return { plan, catalogue, written, failed };
}

