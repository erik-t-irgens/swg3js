// A body far out in the open reading the ground the world already holds, and never making terrain on the
// spot (src/world/mobiles/groundProbe.ts, commit 4b of the frame-time wave), over a stub terrain that counts
// every `heightAt`: near the player (within the physics' reach) the terrain answers as it always did; past
// it the world's cache answers and the terrain is never asked, a miss being unknown rather than a guess; with
// the switch off, or nothing wired, the terrain answers everywhere, as before; and a body's standing is
// decided as `checkGround` always decided it, an unknown ground leaving it as it was. Then the wiring, read
// as text: every outdoor probe a body makes goes through the helper, and the world's two readers reach it.
//
// Everything here is synthetic: numbers chosen for this test, nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FAR_PROBE, FAR_PROBE_STATS, groundUnder, standingOn, type ProbeWorld } from '../../../src/world/mobiles/groundProbe.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** The terrain: a slope, and a count of every time it is asked (each of which, far out, would make a block). */
const terrain = {
  asked: 0,
  heightAt(x: number, z: number): number {
    this.asked++;
    return 0.01 * x + 0.02 * z;
  },
};

/** The world: the physics reaches 192 m from the origin; its cache holds the ground east of x = 1000 only. */
const world: ProbeWorld = {
  groundSolid: (x, z) => Math.max(Math.abs(x), Math.abs(z)) <= 192,
  groundIfCached: (x, z) => (x > 1000 ? 5 + 0.001 * z : null),
};

{
  terrain.asked = 0;
  const s0 = { ...FAR_PROBE_STATS };
  ok(groundUnder(10, 20, terrain, world) === 0.5 && terrain.asked === 1, "near the player the terrain answers, as it always did");
  ok(groundUnder(1500, 40, terrain, world) === 5.04 && terrain.asked === 1, "far out where the world holds the ground its cache answers and the terrain is not asked");
  ok(groundUnder(-3000, 900, terrain, world) === null && terrain.asked === 1, 'far out where it holds nothing the ground is unknown, and still the terrain is not asked');
  ok(FAR_PROBE_STATS.terrain - s0.terrain === 1 && FAR_PROBE_STATS.cached - s0.cached === 1 && FAR_PROBE_STATS.unknown - s0.unknown === 1, 'and each answer is counted by where it came from');

  // A crowd left behind by a fast flight: 26 bodies kilometres off, each asking every fourth frame and the
  // manager's lift four times a second, over sixteen seconds at sixty frames: not one terrain call.
  terrain.asked = 0;
  for (let f = 0; f < 16 * 60; f++) {
    for (let b = 0; b < 26; b++) {
      const x = 1700 + b * 500;
      const z = -900 + b * 300;
      if ((f + b) % 4 === 0) groundUnder(x, z, terrain, world);
      if ((f + b) % 15 === 0) groundUnder(x, z, terrain, world);
    }
  }
  ok(terrain.asked === 0, 'twenty-six bodies kilometres off, asking all the way through a sixteen-second flight, never ask the terrain once');

  FAR_PROBE.cached = false;
  terrain.asked = 0;
  groundUnder(1500, 40, terrain, world);
  groundUnder(-3000, 900, terrain, world);
  ok(terrain.asked === 2, 'with the switch off the terrain answers everywhere, as before');
  FAR_PROBE.cached = true;
  terrain.asked = 0;
  ok(groundUnder(-3000, 900, terrain, {}) === -12 && terrain.asked === 1, 'and so it does with nothing of the world wired');
  ok(groundUnder(-3000, 900, terrain, { groundIfCached: () => 1 }) === -12, 'or with only half of it');
}

{
  // `checkGround`'s own rule, with the ground now allowed to be unknown.
  ok(standingOn(false, true, false, false, 10, 0) && standingOn(false, false, true, true, 10, null), 'something under it the physics found, or a room with no floor, is standing');
  ok(!standingOn(true, false, false, true, 0, 0), 'inside with nothing found is not');
  ok(standingOn(false, false, false, false, 0.2, 0) && !standingOn(true, false, false, false, 0.3, 0), 'outdoors, a quarter of a metre over the ground is standing and more is not');
  ok(standingOn(true, false, false, false, 50, null) && !standingOn(false, false, false, false, -50, null), 'with the ground unknown it stays as it was, whatever its height');
}

{
  // The wiring, read as text: `mobile.ts`, `manager.ts` and `world.ts` are browser modules that drag the
  // whole world in, so a body cannot be stood here, and every probe below would compile just as well put
  // back to `terrain.heightAt` -- which the checks above could never see, since they call the helper
  // themselves. So each of the body's outdoor probes is held to going through `groundUnder`, and the two
  // readers it needs to be held to reaching it from the world through the manager.
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const mobile = src('world/mobiles/mobile.ts');
  const manager = src('world/mobiles/manager.ts');
  const worldSrc = src('world/world.ts');
  /** A method's body, from its signature to the brace that closes it. */
  const body = (text: string, signature: RegExp): string => {
    const m = signature.exec(text);
    assert.ok(m, `no ${signature} in the source`);
    let i = text.indexOf('{', m.index + m[0].length - 1);
    let depth = 0;
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) break;
    }
    return text.slice(start, i + 1);
  };
  const check = body(mobile, /private checkGround\(t: \{ x: number; y: number; z: number \}\): void \{/);
  ok(/groundUnder\(this\.pos\.x, this\.pos\.z, terrain, this\.deps\)/.test(check) && !/heightAt\(/.test(check), '`checkGround` reads the ground outdoors through `groundUnder`, and asks the terrain nowhere else');
  ok(/if \(ground === null\) return;/.test(check), 'and an unknown ground leaves its swimming as it was');
  const lift = body(mobile, /liftToGround\(\): boolean \{/);
  ok(/groundUnder\(this\.pos\.x, this\.pos\.z, this\.deps\.terrain, this\.deps\)/.test(lift) && !/heightAt\(/.test(lift) && /ground === null \|\|/.test(lift), "the manager's lift reads it the same way, and an unknown ground lifts nothing");
  ok(/groundUnder\(nx, nz, terrain, this\.deps\)/.test(mobile) && !/terrain\.heightAt\(nx, nz\)/.test(mobile), 'the water-ahead probe too');
  const hold = body(mobile, /private holdHeight\(t: \{ x: number; y: number; z: number \}, sdt: number\): void \{/);
  ok(/this\.inside \? this\.deps\.terrain\.heightAt\(this\.pos\.x, this\.pos\.z\) : groundUnder\(this\.pos\.x, this\.pos\.z, this\.deps\.terrain, this\.deps\)/.test(hold), "a flyer's hover asks the terrain only indoors, and outdoors goes through `groundUnder`");
  ok(/wantY = ground === null \? t\.y :/.test(hold), 'and with the ground unknown it holds the height it is at rather than drifting with whatever it was climbing at');
  // Every other `heightAt` in a body is indoors: each sits behind `this.inside ?` on its own line.
  const lines = mobile.split('\n').filter((l) => /heightAt\(/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  ok(lines.length > 0 && lines.every((l) => /this\.inside \?/.test(l)), `no body asks the terrain on an outdoor path (${lines.length} line${lines.length === 1 ? '' : 's'} left, each indoors)`);
  ok(/groundIfCached: this\.deps\.groundIfCached \? this\.groundCached : undefined,/.test(manager) && /groundSolid: this\.deps\.groundSolid \? this\.groundSolid : undefined,/.test(manager), 'the manager hands every body the two readers when the world gives them');
  ok(/groundIfCached: \(x, z\) => this\.groundIfCached\(x, z\),/.test(worldSrc) && /groundSolid: \(x, z\) => this\.groundSolidAt\(x, z\),/.test(worldSrc), "and the world gives them: its cached ground and the physics' reach");
  ok(/this\.streamPcx = pcx;\s*this\.streamPcz = pcz;\s*if \(pcx === this\.lastCx/.test(worldSrc), 'the reach is measured from where the ground last streamed, set before the stream returns early');
}

console.log(`\n${checks} checks passed`);
