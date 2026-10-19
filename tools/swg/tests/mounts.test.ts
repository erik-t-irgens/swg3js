// The mount tables' chain from a skeletal appearance to the rider's pose.
import assert from 'node:assert/strict';
import { mountCreatures, riderPoseFromTables } from '../mounts.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const tables = {
  logical: [
    { sat_name: 'appearance/bantha_hue.sat', logical_saddle_name: 'lookup/mnt_saddle_body2_wide_s01' },
    { sat_name: 'appearance/pv_speeder_bike.sat', logical_saddle_name: 'lookup/speeder_bike' },
    { sat_name: 'appearance/pv_landspeeder_luke.sat', logical_saddle_name: 'lookup/landspeeder_luke' },
  ],
  saddles: [
    { logical_saddle_name: 'lookup/mnt_saddle_body2_wide_s01', saddle_capacity: 1, saddle_appearance_name: 'appearance/mnt_saddle_body2_wide_s01.apt' },
    { logical_saddle_name: 'lookup/speeder_bike', saddle_capacity: 1, saddle_appearance_name: 'appearance/speeder_bike.apt' },
    { logical_saddle_name: 'lookup/landspeeder_luke', saddle_capacity: 2, saddle_appearance_name: 'appearance/landspeeder_luke.apt' },
  ],
  poses: [
    { saddle_appearance_name: 'appearance/mnt_saddle_body2_wide_s01.apt', seat_index: 1, rider_pose: 'saddle_body2_wide' },
    { saddle_appearance_name: 'appearance/speeder_bike.apt', seat_index: 1, rider_pose: 'vehicle_speeder_bike' },
    { saddle_appearance_name: 'appearance/landspeeder_luke.apt', seat_index: 1, rider_pose: 'vehicle_landspeeder' },
    { saddle_appearance_name: 'appearance/landspeeder_luke.apt', seat_index: 2, rider_pose: 'vehicle_landspeeder_passenger' },
  ],
};

ok(riderPoseFromTables('appearance/bantha_hue.sat', 1, tables)?.pose === 'saddle_body2_wide', 'a bantha seats its rider on the wide body-2 saddle');
ok(riderPoseFromTables('appearance/bantha.sat', 1, tables)?.pose === 'saddle_body2_wide', 'the template names bantha.sat and the table its _hue variant: the same saddle');
ok(riderPoseFromTables('appearance\\pv_speeder_bike.sat', 1, tables)?.pose === 'vehicle_speeder_bike', 'a speeder bike has its own pose, whatever the slashes');
const luke = riderPoseFromTables('appearance/pv_landspeeder_luke.sat', 2, tables);
ok(luke?.pose === 'vehicle_landspeeder_passenger' && luke.seats === 2, 'the second seat of a two-seater is the passenger pose');
ok(riderPoseFromTables('appearance/pv_landspeeder_luke.sat', 9, tables)?.pose === 'vehicle_landspeeder', 'a seat the table lacks falls back to the first');
ok(riderPoseFromTables('appearance/unknown.sat', 1, tables) === null, 'an appearance outside the tables has no pose');
ok(riderPoseFromTables('appearance/bantha.sat', 1, tables)?.sat === 'appearance/bantha_hue.sat', "the table's own listing comes back, for reading its hardpoints");

// A mount whose template carries another name than its appearance (the beast master's, from publish 55) is found by
// the appearance its template names, and takes the template's own label as its id. A stand-in mount over TEST tables.
{
  const datatable = (columns: string[], rows: string[][]): Buffer => {
    const cols = new W().i32(columns.length);
    for (const c of columns) cols.str(c);
    const type = new W();
    for (const _ of columns) type.str('s');
    const body = new W().i32(rows.length);
    for (const r of rows) for (const v of r) body.str(v);
    return Buffer.from(encode(form('DTII', form('0001', chunk('COLS', cols.bytes()), chunk('TYPE', type.bytes()), chunk('ROWS', body.bytes())))));
  };
  const files: Record<string, Buffer> = {
    'datatables/mount/logical_saddle_name_map.iff': datatable(['sat_name', 'logical_saddle_name'], [['appearance/test_bird_saddle_hue.sat', 'lookup/test_bird'], ['appearance/bantha_hue.sat', 'lookup/test_bantha']]),
    'datatables/mount/saddle_appearance_map.iff': datatable(['logical_saddle_name', 'saddle_appearance_name'], [['lookup/test_bird', 'appearance/test_saddle.apt']]),
    'datatables/mount/rider_pose_map.iff': datatable(['saddle_appearance_name', 'rider_pose'], [['appearance/test_saddle.apt', 'saddle_test']]),
  };
  const templates = ['object/mobile/shared_bantha.iff', 'object/mobile/beast_master/shared_bm_test_bird_mount.iff', 'object/mobile/vehicle/shared_test_bird_vehicle.iff'];
  const appearances: Record<string, string> = { 'object/mobile/beast_master/shared_bm_test_bird_mount.iff': 'appearance/test_bird_saddle_hue.sat', 'object/mobile/vehicle/shared_test_bird_vehicle.iff': 'appearance/test_bird_saddle_hue.sat', 'object/mobile/shared_bantha.iff': 'appearance/bantha.sat' };
  const vfs = { has: (p: string) => p in files || templates.includes(p), read: (p: string) => files[p], list: (prefix: string) => templates.filter((t) => t.startsWith(prefix)) };
  const found = mountCreatures(vfs, { appearanceOf: (t: string) => appearances[t] ?? null });
  const bird = found.find((m: { template: string }) => m.template.includes('beast_master'));
  ok(!!bird && bird.id === 'bm_test_bird_mount' && bird.sat === 'appearance/test_bird_saddle_hue.sat', `a mount whose template has another name is found by its appearance and labelled by its template (${bird?.id})`);
  ok(found.some((m: { id: string }) => m.id === 'bantha') && !found.some((m: { template: string }) => m.template.includes('/vehicle/')), 'one found by name keeps its stem, and a vehicle template naming the same appearance is never taken');
}
console.log(`${checks} checks passed`);
