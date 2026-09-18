// The water reflections' reason for a frame they sat out, as `__debug.postfx()` lists it: every
// state short of its setting (or a console override) being off has a sentence, so the listing never
// shows a pass that did not draw with no reason.
import assert from 'node:assert/strict';
import { waterReflectionsWhy, type WaterReflectionsState } from '../../../src/core/fx/waterMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

const state = (over: Partial<WaterReflectionsState> = {}): WaterReflectionsState => ({ wantedNow: true, wanted: true, underwater: false, inView: true, active: true, ...over });

ok(waterReflectionsWhy(state({ wantedNow: false, wanted: false, active: false })) === null, 'setting or override off: no reason of its own (the chain says "its setting is off" or "forced off")');
ok(waterReflectionsWhy(state({ wantedNow: false })) === null, 'turned off since the frame began: still the chain\'s words');

// The idle case the listing showed as undefined: wanted now, but no frame has taken the decision
// since the planet loaded (the bodies were reset), so nothing was wanted when the frame began.
const idle = waterReflectionsWhy(state({ wanted: false, inView: false, active: false }));
ok(typeof idle === 'string' && idle.length > 0, `wanted now but not when the frame began has a reason: "${idle}"`);

ok(waterReflectionsWhy(state({ underwater: true, active: false })) === 'camera under water', 'under water');
ok(waterReflectionsWhy(state({ inView: false, active: false })) === 'no water in view', 'no water in view');
ok(waterReflectionsWhy(state({ underwater: true, inView: false, active: false })) === 'camera under water', 'under water says so before the view');

// Active, yet not drawn (the chain stopped before it, or no frame was drawn since): still a reason.
const unreached = waterReflectionsWhy(state());
ok(typeof unreached === 'string' && unreached.length > 0, `active but not drawn has a reason: "${unreached}"`);

// Every combination with the pass wanted now gives a sentence.
let all = 0;
let said = 0;
for (const wanted of [false, true])
  for (const underwater of [false, true])
    for (const inView of [false, true]) {
      const active = wanted && inView && !underwater;
      all++;
      if (waterReflectionsWhy({ wantedNow: true, wanted, underwater, inView, active })) said++;
    }
ok(said === all, `all ${all} states with the pass wanted give a reason`);

console.log(`\n${passed} checks passed`);
