// The effects an object's client data hangs on it: a brazier's fire, a fountain's spray, a torch's
// flame, a streetlamp's glow. None of them is in the appearance, which is why none of them burned.
//
// The reader is checked twice: on a client data file built by hand, chunk by chunk, so every layout is
// pinned whatever machine runs this; and against the owner's own archives where they are on this
// machine (SWG in the environment or .env), on the very templates the investigation named.
//
// Run: node tools/swg/tests/clientfx.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIff } from '../iff.mjs';
import { OBJECT_EFFECTS_VERSION, clientEffectReader, placeTransform, readClientChildren } from '../clientfx.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}
const near = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) < eps;

// ---------------------------------------------------------------- a file built by hand

const chunk = (tag: string, body: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([Buffer.from(tag.padEnd(4).slice(0, 4), 'latin1'), len, body]);
};
const form = (type: string, body: Buffer) => chunk('FORM', Buffer.concat([Buffer.from(type.padEnd(4).slice(0, 4), 'latin1'), body]));
const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]);
const f32 = (...v: number[]) => {
  const b = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => b.writeFloatLE(x, i * 4));
  return b;
};
const i32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v);
  return b;
};
const seventeen = (over: Record<number, number>) => f32(...Array.from({ length: 17 }, (_, i) => over[i] ?? 0));

{
  const file = form(
    'CLDF',
    form(
      '0000',
      Buffer.concat([
        chunk('ASND', cstr('sound/amb_fire_roaring_lp.snd')),
        chunk('CHLD', Buffer.concat([cstr('appearance/pt_fountain_corl_brazier_round_s01.prt'), seventeen({ 1: 0.5, 3: 90 })])),
        chunk('CHLD', Buffer.concat([cstr('appearance/mesh/crate.msh'), seventeen({ 0: 2 })])),
        chunk('HOBJ', Buffer.concat([cstr('appearance/pt_light_blink_orange.prt'), cstr('light1')])),
        chunk('IHOB', Buffer.concat([cstr('appearance/pt_smoke.prt'), cstr('vent'), f32(0, 0, 0)])),
        // The brazier's own LOBJ: a type, no particle at all, then the light's floats with y at 15.
        chunk('LOBJ', Buffer.concat([i32(2), cstr(''), seventeen({ 0: 0.255, 1: 0.233, 15: 1.5 })])),
        // A tiki torch's: a type, its flame, then the floats with the point at 14-16.
        chunk('LOBJ', Buffer.concat([i32(1), cstr('appearance/pt_burning_smokeandembers_md.prt'), seventeen({ 14: 0.1, 15: 1.445, 16: -0.2 })])),
        chunk('HLOB', Buffer.concat([i32(1), cstr('appearance/pt_light_blink_green.prt'), f32(...Array(13).fill(0)), i32(0), cstr('hardpoint')])),
        form('VTHR', chunk('INFO', f32(0.5))),
      ]),
    ),
  );
  const rows = readClientChildren(parseIff(file));
  const tags = rows.map((r: { tag: string }) => r.tag).join(',');
  ok(tags === 'CHLD,CHLD,HOBJ,IHOB,LOBJ,HLOB', `every chunk kind that hangs a child is read, in file order, and a light that names no particle and the forms beside them are passed over (${tags})`);
  const [fire, crate, hobj, ihob, torch, hlob] = rows;
  ok(fire.name === 'appearance/pt_fountain_corl_brazier_round_s01.prt' && near(fire.place[1], 0.5) && near(fire.angles[0], 90), "a CHLD's place is its first three floats and its turn the next three, in degrees");
  ok(crate.name.endsWith('.msh'), 'a CHLD that hangs a mesh is read too, for whoever wants the mesh children later');
  ok(hobj.hardpoint === 'light1' && ihob.hardpoint === 'vent', 'HOBJ and IHOB name a hardpoint, the extra floats of an IHOB left alone');
  ok(torch.name.endsWith('pt_burning_smokeandembers_md.prt') && near(torch.place[0], 0.1) && near(torch.place[1], 1.445) && near(torch.place[2], -0.2), "an LOBJ's flame stands at its floats 14 to 16, the tiki torch's 1.445 m up");
  ok(hlob.hardpoint === 'hardpoint' && hlob.name.endsWith('pt_light_blink_green.prt'), "an HLOB's hardpoint comes after its thirteen floats and a word, as the shuttleport's blinking light's does");
  ok(readClientChildren(parseIff(form('XXXX', form('0000', chunk('CHLD', cstr('a.prt')))))).length === 0, 'and anything that is not client data hangs nothing');
}

{
  const m = placeTransform([1, 2, 3], [90, 0, 0]);
  ok(near(m[3], 1) && near(m[7], 2) && near(m[11], 3), 'a child placed by its numbers stands where they say');
  ok(near(m[0], 0, 1e-6) && near(m[2], 1, 1e-6) && near(m[8], -1, 1e-6), 'and a yaw of 90 degrees turns it a quarter about up, as the .cmp parts it shares the rule with do');
  ok(near(placeTransform([0, 0, 0], [0, 0, 0])[0], 1), 'no turn is no turn');
}

// ---------------------------------------------------------------- the two halves agree on the file's shape

{
  const assetPack = readFileSync(fileURLToPath(new URL('../../../src/world/assetPack.ts', import.meta.url)), 'utf8');
  const runtime = Number(/export const OBJECT_EFFECTS_VERSION = (\d+);/.exec(assetPack)?.[1]);
  ok(runtime === OBJECT_EFFECTS_VERSION, `the game reads the shape of objeffects.json the converter writes (${runtime} and ${OBJECT_EFFECTS_VERSION})`);
}

// ---------------------------------------------------------------- the owner's own archives

{
  let swg = process.env.SWG ?? '';
  const env = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (!swg && existsSync(env)) {
    for (const line of readFileSync(env, 'utf8').split(/\r?\n/)) {
      const m = /^\s*SWG\s*=\s*(.*?)\s*$/.exec(line);
      if (m) swg = m[1].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  if (!swg || !existsSync(swg)) {
    note('no SWG install on this machine, so the real templates are not read here');
  } else {
    const { openVfs } = await import('../tre.mjs');
    const { isRetailByName } = await import('../manifest.mjs');
    const vfs = openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null });
    const r = clientEffectReader(vfs);
    const one = (t: string) => r.effectsOf(t) as { particle: string; transform: number[] }[];
    const brazier = one('object/static/structure/corellia/shared_corl_fountain_brazier_round_s01.iff');
    ok(brazier.length === 1 && brazier[0].particle === 'appearance/pt_fountain_corl_brazier_round_s01.prt', "the Corellian fountain brazier's fire is its client data's, and nothing of its appearance");
    const torch = one('object/tangible/furniture/all/shared_frn_all_tiki_torch_s1.iff');
    ok(torch.length === 1 && near(torch[0].transform[7], 1.45, 0.01), 'a tiki torch flames at the top of its pole, 1.45 m up');
    const lamp = one('object/static/structure/general/shared_streetlamp_large_style_01.iff');
    ok(lamp.length === 1 && /pt_light_streetlamp_gold\.prt$/.test(lamp[0].particle) && near(lamp[0].transform[7], 3.22, 0.01), 'a streetlamp glows at its head, 3.22 m up');
    const fountain = one('object/static/structure/corellia/shared_corl_fountain_circle_s01.iff');
    ok(fountain.length === 1 && /pt_fountain_corl_circle_s01\.prt$/.test(fountain[0].particle), "and a fountain sprays, which is the other half of what the owner saw missing");
    ok(one('object/static/naboo/shared_waterfall_mist_lg.iff').every((e) => !(e.transform[3] === 0 && e.transform[7] === 0 && e.transform[11] === 0 && /hardpoint2/.test(e.particle))) && r.missing.some((m: string) => /hardpoint2/.test(m)), 'a hardpoint the appearance has not got is left out and counted, never hung at the origin');
  }
}

console.log(`\nclient data effects: ${passed} checks passed`);
