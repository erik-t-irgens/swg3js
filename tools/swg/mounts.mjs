// How a rider sits on a mount or in a vehicle: the game's three mount tables chain a skeletal
// appearance to a rider pose, which names the riding animation's selector value (the rider_pose
// variable of loop_riding in the animation tables: vehicle_speeder_bike, saddle_body2_wide,
// vehicle_hover_chair and so on).
//
//   datatables/mount/logical_saddle_name_map.iff   sat_name -> logical_saddle_name
//   datatables/mount/saddle_appearance_map.iff     logical_saddle_name -> saddle_appearance_name (and its capacity)
//   datatables/mount/rider_pose_map.iff            saddle_appearance_name + seat_index -> rider_pose
import { parseIff } from './iff.mjs';
import { parseDatatable } from './datatable.mjs';
import { resolveTemplateString } from './objtemplate.mjs';

const norm = (s) => String(s ?? '').replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
/** A skeletal appearance's family: the file's name without its folder, extension or a _hue suffix (the table lists bantha_hue.sat, the template names bantha.sat). */
const stem = (s) => norm(s).replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/_hue$/, '');

/** The pose for a skeletal appearance and seat from the three tables as plain row lists, or null when the chain breaks. */
export function riderPoseFromTables(satPath, seat, { logical, saddles, poses }) {
  const sat = norm(satPath);
  const l = logical.find((r) => norm(r.sat_name) === sat) ?? logical.find((r) => stem(r.sat_name) === stem(sat));
  if (!l) return null;
  const s = saddles.find((r) => norm(r.logical_saddle_name) === norm(l.logical_saddle_name));
  if (!s) return null;
  const p = poses.find((r) => norm(r.saddle_appearance_name) === norm(s.saddle_appearance_name) && Number(r.seat_index) === seat) ?? poses.find((r) => norm(r.saddle_appearance_name) === norm(s.saddle_appearance_name));
  // `sat` is the table's own listing (bantha_hue.sat for a template's bantha.sat): the appearance
  // whose meshes carry the saddle hardpoint when the plain one lacks it.
  return p ? { pose: p.rider_pose, seats: Number(s.saddle_capacity) || 1, saddle: s.saddle_appearance_name, sat: l.sat_name } : null;
}

const cache = new WeakMap();

/** The three tables read from the archives once per mounted set. */
function tables(vfs) {
  let t = cache.get(vfs);
  if (!t) {
    const read = (path) => {
      try {
        return vfs.has(path) ? parseDatatable(parseIff(vfs.read(path))).rows : [];
      } catch {
        return [];
      }
    };
    t = { logical: read('datatables/mount/logical_saddle_name_map.iff'), saddles: read('datatables/mount/saddle_appearance_map.iff'), poses: read('datatables/mount/rider_pose_map.iff') };
    cache.set(vfs, t);
  }
  return t;
}

/** The rider pose for a skeletal appearance (a vehicle's or a mount's .sat) in the mounted archives, or null. */
export function riderPoseFor(vfs, satPath, seat = 1) {
  return riderPoseFromTables(satPath, seat, tables(vfs));
}

const byAppearance = new WeakMap();

/**
 * Every mobile template by the appearance its chain names (`appearanceFilename`), lower case: one pass over
 * `object/mobile/**`, made once per mounted set and only when a mount is not found by its name.
 */
function mobilesByAppearance(vfs, mobiles, appearanceOf) {
  let map = byAppearance.get(vfs);
  if (!map) {
    map = new Map();
    for (const m of [...mobiles].sort()) {
      if (!/\/shared_[^/]+\.iff$/.test(m)) continue;
      let app = null;
      try {
        app = appearanceOf(m);
      } catch {
        app = null;
      }
      if (!app) continue;
      const key = norm(app);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    }
    byAppearance.set(vfs, map);
  }
  return map;
}

/**
 * Every creature the saddle map lists as mountable (a creature .sat, not a vehicle's pv_ one)
 * that has a mobile template in the archives, as { id, template, sat, saddle }: the banthas,
 * dewbacks, kaadu, cu pa, varactyls, tauntauns and the rest. The mount tables list a creature
 * by its _hue appearance (the customizable one the player buys); the id drops that suffix.
 *
 * A mount whose template carries another name than its appearance is found by the appearance: the template
 * under `object/mobile/` whose chain names the row's `.sat` (or the same appearance less its `_hue`). From
 * publish 55 four of the saddle map's rows are such (the beast master's whisper bird, reptilian flier and snorbal,
 * and the trading card's armoured tauntaun), and a mount found that way takes its template's own label as its id
 * (`bm_whisper_bird_mount`), since the appearance's stem reads oddly and nothing keys on it. `appearanceOf(template)`
 * is how a template's appearance is read (its chain's `appearanceFilename`, unless a test hands in another).
 */
export function mountCreatures(vfs, { appearanceOf = null } = {}) {
  const params = new Map();
  const appOf = appearanceOf ?? ((t) => resolveTemplateString(vfs, t, ['appearanceFilename'], params));
  const mobiles = vfs.list('object/mobile/');
  const out = [];
  for (const r of tables(vfs).logical) {
    const sat = norm(r.sat_name);
    if (!/^appearance\/[^/]+\.sat$/.test(sat) || /\/pv_/.test(sat)) continue;
    const stemName = sat.replace(/^appearance\//, '').replace(/\.sat$/, '');
    const base = stemName.replace(/_hue$/, '');
    let id = base;
    let template = [`object/mobile/shared_${stemName}.iff`, `object/mobile/shared_${base}.iff`, ...mobiles.filter((m) => m.endsWith(`/shared_${stemName}.iff`) || m.endsWith(`/shared_${base}.iff`))].find((c) => vfs.has(c));
    if (!template) {
      const map = mobilesByAppearance(vfs, mobiles, appOf);
      template = (map.get(sat) ?? map.get(sat.replace(/_hue\.sat$/, '.sat')) ?? []).find((c) => !/\/vehicle\//.test(c)) ?? null;
      if (template) id = template.replace(/^.*\/shared_/, '').replace(/\.iff$/, '');
    }
    // A vehicle listed by its own appearance (the basilisk, the wheel bike, the pod racers) is the gallery's.
    if (!template || /\/vehicle\//.test(template) || /pod_?racer|speeder|wheel_bike|walker|atpt/.test(base)) continue;
    if (!out.some((o) => o.id === id)) out.push({ id, template, sat, saddle: r.logical_saddle_name });
  }
  return out;
}
