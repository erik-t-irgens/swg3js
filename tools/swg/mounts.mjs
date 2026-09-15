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
  return p ? { pose: p.rider_pose, seats: Number(s.saddle_capacity) || 1, saddle: s.saddle_appearance_name } : null;
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
