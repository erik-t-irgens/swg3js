// The mount tables' chain from a skeletal appearance to the rider's pose.
import assert from 'node:assert/strict';
import { riderPoseFromTables } from '../mounts.mjs';

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
console.log(`${checks} checks passed`);
