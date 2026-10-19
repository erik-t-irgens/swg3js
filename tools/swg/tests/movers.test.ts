// The motion blur's list of the catalogue's creatures and people (the performance pass's third wave, `App.collectMovers`
// over `listsMover` in `src/world/mobiles/crowd.ts`): a body is listed only while its group is drawn at the time the
// effects run -- after the portal renderer's passes, which keep a body no pass drew hidden through the effects -- every
// body with the list switch at its old value, and never a body the matrix walk stepped over as culled, whose meshes'
// world matrices are not this frame's (one stepped over as standing still is listed: its matrices are this frame's). A
// stub list of bodies run through the rule as `collectMovers` runs it, and the game's own loop read as text: where it
// is, what it hands the rule, and that the list is filled during the effects.
//
// Everything here is synthetic: numbers chosen for this test, nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CROWD_SWITCHES, listsMover } from '../../../src/world/mobiles/crowd.ts';
import { BODY_WALK, BodyGroup } from '../../../src/world/mobiles/bodyGroup.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- 1. A stub list through the rule, as the game's loop runs it. ----
{
  /** Bodies drawn, hidden by a pass for the frame, culled by the manager, and culled with the walk at the old way. */
  const bodies = [
    { name: 'drawn', visible: true, culled: false, still: false },
    { name: 'drawn too', visible: true, culled: false, still: false },
    { name: 'standing still', visible: true, culled: false, still: true },
    { name: 'in a room nobody saw', visible: false, culled: false, still: false },
    { name: 'off the screen', visible: false, culled: true, still: false },
  ].map((b) => {
    const g = new BodyGroup(true);
    g.name = b.name;
    g.visible = b.visible;
    g.culled = b.culled;
    g.still = b.still;
    return g;
  });
  const listed = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < bodies.length; i++) {
      const g = bodies[i];
      if (!listsMover(g.visible, BODY_WALK.culled && g.culled, CROWD_SWITCHES.moverList)) continue;
      out.push(g.name);
    }
    return out;
  };
  BODY_WALK.culled = true;
  CROWD_SWITCHES.moverList = true;
  ok(listed().join(',') === 'drawn,drawn too,standing still', 'a body is listed only while its group is drawn: one a pass hid for the frame and one the manager culled are not, and one the walk steps over as standing still is, its matrices being this frame\'s');
  CROWD_SWITCHES.moverList = false;
  ok(listed().join(',') === 'drawn,drawn too,standing still,in a room nobody saw', 'the list at its old value takes every body again, except one the walk stepped over as culled, whose matrices are stale');
  BODY_WALK.culled = false;
  ok(listed().length === 5, 'and with the walk skip at its old value too, every body, as before the wave');
  BODY_WALK.culled = true;
  CROWD_SWITCHES.moverList = true;
  // A body coming back into the list is a record met for the first time: the product's own rule, unchanged.
  const velocity = readFileSync(new URL('../../../src/core/fx/velocity.ts', import.meta.url), 'utf8');
  ok(velocity.includes('f.historyValid = rec.rootFrame === frame - 1 && rec.scanned >= 0;'), 'a record not listed last frame has no history, and blurs with the camera alone for its first frame back (the product\'s own rule)');
  ok(bodies.every((g) => g instanceof THREE.Group), 'the stub bodies are three groups, as a mobile\'s root is');
}

// ---- 2. The game's own loop, read as text. ----
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const collect = main.slice(main.indexOf('private readonly collectMovers = (out: FxMoverList): void => {'), main.indexOf('this.remotes.collectMovers(out);'));
  ok(collect.length > 0 && /if \(!listsMover\(g\.visible, BODY_WALK\.culled && g\.culled, CROWD_SWITCHES\.moverList\)\) continue;\s*out\.add\(g, false, 'creature'\);/.test(collect), "collectMovers adds a mobile only through the rule, handed its group's visibility now, whether the walk stepped over it as culled, and the switch");
  ok(!/for \(const m of w\.mobiles\.live\) out\.add/.test(collect), 'and no longer lists every mobile whatever was drawn');
  ok(/this\.moversListed = listed;/.test(collect), 'the count it listed is kept for the console (`crowd().moversListed`)');
  // The list is filled in the effects, after the passes and before the frame's routing is put back.
  ok(/installEffects\(fx, \{[^}]*collectMovers: this\.collectMovers/.test(main), 'the list is the effects\' own (the motion blur asks for it inside `postfx.end`)');
  const routed = main.indexOf('this.drawFrameRouted(cam, view);');
  const restore = main.indexOf('this.portals.actors.restoreFrame();');
  const body = main.slice(main.indexOf('private drawFrameRouted(cam: THREE.PerspectiveCamera'), main.indexOf('private readonly collectMovers'));
  ok(routed > 0 && restore > routed && restore - routed < 200 && body.includes('postfx.end(f);'), 'and the effects run inside the routed frame (`postfx.end` in `drawFrameRouted`), before every root the routing hid is put back');
}

console.log(`\n${checks} checks passed`);
