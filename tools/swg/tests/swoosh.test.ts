// The ribbons a particle trails (.swh): the reader and the exporter on files built by hand, every
// retail file where the owner's archives are on this machine, and the runtime's trail driven round a
// circle to read what it would draw.
//
// Run: node tools/swg/tests/swoosh.test.ts

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { form, chunk, W, encode } from './iffWriter.ts';
import { parseIff } from '../iff.mjs';
import { exportSwoosh, parseSwoosh, swooshStatus } from '../swoosh.mjs';
import { SWOOSH_TUNE, SwooshTrail, stripQuads, writeStrip, type SwooshDef } from '../../../src/world/swooshTrail.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}
const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

// ---------------------------------------------------------------- files built by hand

const ptex = (shader: string) => form('PTEX', chunk('0000', new W().str(shader).i32(1).i32(0).i32(0).f32(1).i32(1).f32(-1).u8(1).bytes()));
const data = (v: 0 | 1, over: { appearance?: string; extra?: number } = {}) => {
  const w = new W().f32(1).f32(0).f32(0).f32(1).f32(0.04).str(over.appearance ?? '').u8(0).u8(0).f32(2).f32(-0.5).i32(1).i32(0).u8(1).i32(2).i32(1);
  if (v === 1) w.f32(30).i32(20).i32(5);
  for (let i = 0; i < (over.extra ?? 0); i++) w.u8(7);
  return chunk('0000', w.bytes());
};
const swoosh = (v: 0 | 1, over: { appearance?: string; extra?: number } = {}) => Buffer.from(encode(form('SWSH', form(`000${v}`, ptex('shader/red_4_4.sht'), data(v, over)))));

{
  const s = parseSwoosh(parseIff(swoosh(1, { appearance: 'appearance\\pt_sparks.prt' })));
  ok(s.version === 1 && s.color.join() === '1,0,0,1' && near(s.width, 0.04), 'a version 0001 ribbon: its colour in RGBA and its width');
  ok(s.appearance === 'appearance/pt_sparks.prt', 'the effect it names, with the separators the game writes turned round');
  ok(s.rate === 30 && s.samples === 20 && s.subdivisions === 5, 'and the three fields that version adds, read as a rate, a count and a subdivision');
  ok(s.fields.length === 9 && s.fields[2] === 2 && s.fields[3] === -0.5 && s.fields[7] === 2, 'the fields nothing reads yet go into the pack as they stand, in file order');
  ok(s.texture.shader === 'shader/red_4_4.sht', 'its texture is a particle texture, read by the same reader');
  const old = parseSwoosh(parseIff(swoosh(0)));
  ok(old.version === 0 && old.rate === null && old.samples === null && old.appearance === null, 'a version 0000 ribbon says nothing of its sampling, and an empty name is no effect');
  assert.throws(() => parseSwoosh(parseIff(swoosh(1, { extra: 3 }))), /3 bytes left unread/);
  ok(true, 'a file with bytes past what the layout reads is refused, never read short');
  assert.throws(() => parseSwoosh(parseIff(Buffer.from(encode(form('PEFT', form('0000', chunk('0000', new W().i32(0).bytes()))))))), /expected FORM SWSH/);
  ok(true, 'and a particle effect is not a ribbon');
}

// ---------------------------------------------------------------- the exporter

{
  const dir = mkdtempSync(join(tmpdir(), 'swoosh-'));
  try {
    const files = new Map<string, Buffer>([['appearance/sw_red_ribbon.swh', swoosh(1, { appearance: 'appearance/pt_sparks.prt' })]]);
    const vfs = { has: (p: string) => files.has(p), read: (p: string) => files.get(p)! };
    const written = new Map<string, Buffer | string>();
    const asked: string[] = [];
    const entry = exportSwoosh(vfs, 'appearance/sw_red_ribbon.swh', dir, {
      textureFor: () => ({ path: 'texture/red_4_4.dds', png: Buffer.from([1, 2, 3]) }),
      passFor: () => null,
      write: (f: string, b: Buffer | string) => written.set(f.replace(/\\/g, '/'), b),
      attach: (p: string) => (asked.push(p), { file: 'particles/fx_pt_sparks.json' }),
    });
    const json = JSON.parse(String(written.get(`${dir.replace(/\\/g, '/')}/particles/swh_sw_red_ribbon.json`)));
    ok(entry.file === 'particles/swh_sw_red_ribbon.json' && json.kind === 'swoosh', 'a ribbon is written as particles/swh_<name>.json and says it is one');
    ok(json.texture.file === 'particles/red_4_4.png' && json.texture.blend === 'opaque', "its texture is written as a quad particle's is, blend and all");
    ok(asked.join() === 'appearance/pt_sparks.prt' && json.appearance.file === 'particles/fx_pt_sparks.json', 'and the effect it names is converted as any carried effect is, its file written on the ribbon');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- what `status` reads

{
  const dir = mkdtempSync(join(tmpdir(), 'swoosh-status-'));
  try {
    const eff = (att: object) => JSON.stringify({ groups: [{ emitters: [{ particle: { attachments: [att] } }] }] });
    writeFileSync(join(dir, 'fx_old.json'), eff({ path: 'appearance/sw_red_ribbon.swh', failed: 'expected FORM PEFT, got FORM SWSH' }));
    writeFileSync(join(dir, 'fx_new.json'), eff({ path: 'appearance/sw_blue_ribbon.swh', file: 'particles/swh_sw_blue_ribbon.json' }));
    writeFileSync(join(dir, 'fx_plain.json'), eff({ path: 'appearance/pt_smoke.prt', file: 'particles/fx_pt_smoke.json' }));
    const s = swooshStatus(dir, { readdirSync, readFileSync, existsSync });
    ok(s.carriers === 2 && s.ribbons === 2 && s.missing === 1, `a pack from before the reader is told apart by the ribbons with no file (${JSON.stringify(s)})`);
    ok(swooshStatus(join(dir, 'nowhere'), { readdirSync, readFileSync, existsSync }).ribbons === 0, 'and a pack with no particles has none to ask about');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the runtime's trail

const def = (over: Partial<SwooshDef> = {}): SwooshDef => ({
  kind: 'swoosh',
  version: 1,
  texture: { shader: 'shader/red_4_4.sht', frameCount: 1, frameStart: 0, frameEnd: 0, frameUVSize: 1, framesPerColumn: 1, framesPerSecond: -1, visible: true, file: 'particles/red_4_4.png', blend: 'opaque' },
  color: [1, 1, 1, 1],
  width: 0.04,
  appearance: null,
  rate: 30,
  samples: 10,
  subdivisions: 5,
  fields: [],
  ...over,
});

{
  // Round a circle 4 cm across at four turns a second, the fancy stick's own carrier, for a second.
  const t = new SwooshTrail(def());
  const dt = 1 / 60;
  const at = (time: number): [number, number, number] => [Math.cos(time * 8 * Math.PI) * 0.04, 1.5, Math.sin(time * 8 * Math.PI) * 0.04];
  let time = 0;
  for (let i = 0; i < 60; i++) {
    time += dt;
    t.step(dt, ...at(time), true);
  }
  ok(near(t.life, 10 / 30), `a ribbon of ten points taken thirty times a second reaches back a third of a second (${t.life.toFixed(3)} s)`);
  ok(t.held <= 12, `and holds no more points than that needs (${t.held})`);
  const n = t.points(...at(time), true, null);
  const p = t.drawn;
  ok(n > 30 && near(p[0], at(time)[0]) && near(p[2], at(time)[2]) && p[3] === 0, `the first point drawn is the carrier itself, where it is this frame (${n} points)`);
  ok(near(p[(n - 1) * 4 + 3], 1), 'and the last is the tail, a whole ribbon length back');
  let rising = true;
  for (let i = 1; i < n; i++) if (p[i * 4 + 3] < p[(i - 1) * 4 + 3] - 1e-6) rising = false;
  ok(rising, 'every point is further down the ribbon than the one before it');
  let off = 0;
  for (let i = 0; i < n; i++) off = Math.max(off, Math.abs(Math.hypot(p[i * 4], p[i * 4 + 2]) - 0.04));
  ok(off < 0.006, `drawn through a curve rather than a polygon, the ribbon keeps to the circle its carrier swung (${(off * 1000).toFixed(1)} mm at worst)`);

  const pos = new Float32Array(200 * 12);
  const col = new Float32Array(200 * 16);
  const uv = new Float32Array(200 * 8);
  const quads = writeStrip(p, n, { x: 0, y: 1.5, z: 5 }, 0.04, 1, 0, 0, 1, 0, 0, 1, pos, col, uv, 0, 200);
  ok(quads === stripQuads(n), `a strip is a quad a span (${quads})`);
  const across = Math.hypot(pos[0] - pos[9], pos[1] - pos[10], pos[2] - pos[11]);
  ok(near(across, 0.04, 1e-4), `as wide as the file says, across its own direction (${(across * 100).toFixed(2)} cm)`);
  ok(pos[3] === pos[12] || near(pos[3], pos[12 + 0]), 'and each quad starts where the last one ended, so the ribbon has no seams');
  ok(uv[1] === 0 && uv[0] === 1 && uv[6] === 0, 'its texture runs down the ribbon in V and across it in U');
  ok(col[0] === 1 && col[1] === 0 && col[3] === 1, 'coloured as asked, with the alpha solid to the end while nothing asks the tail to fade');
  ok(writeStrip(p, n, { x: 0, y: 1.5, z: 5 }, 0.04, 1, 1, 1, 1, 0, 0, 1, pos, col, uv, 0, 3) === 3, 'and it never writes past the room the frame has left');

  // Let go: it draws on until its tail has run out, then goes.
  let frames = 0;
  while (t.step(dt, ...at(time), false) && frames < 1000) frames++;
  ok(frames > 0 && frames * dt <= t.life + 2 * dt, `let go, a ribbon draws on for its own length and then goes (${(frames * dt).toFixed(2)} s)`);
}

{
  const still = new SwooshTrail(def());
  for (let i = 0; i < 30; i++) still.step(1 / 60, 0, 1, 0, true);
  ok(still.points(0, 1, 0, true, null) === 0, 'a carrier held still draws nothing rather than a ribbon folded on itself');
  const old = new SwooshTrail(def({ version: 0, rate: null, samples: null, subdivisions: null }));
  ok(near(old.life, SWOOSH_TUNE.samples / SWOOSH_TUNE.rate) && old.subdivisions === SWOOSH_TUNE.subdivisions, 'a version 0000 file samples by our own numbers, since it says none');
  const framed = new SwooshTrail(def());
  framed.step(0.1, 0, 0, 0, true);
  framed.step(0.1, 1, 0, 0, true);
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];
  const k = framed.points(1, 0, 0, true, m);
  ok(k > 1 && near(framed.drawn[0], 11) && near(framed.drawn[1], 20) && near(framed.drawn[2], 30), "a ribbon aboard a hull is carried out of the hull's frame as it is drawn");
}

// ---------------------------------------------------------------- the two halves agree

{
  const here = fileURLToPath(new URL('../../../assets-private/weapons/particles/swh_sw_red_ribbon.json', import.meta.url));
  if (!existsSync(here)) note('the weapons pack has no converted ribbon on this machine, so the shape on disk is not compared');
  else {
    const d = JSON.parse(readFileSync(here, 'utf8')) as SwooshDef;
    const t = new SwooshTrail(d);
    ok(d.kind === 'swoosh' && t.rate === 30 && near(t.life, 1 / 3) && t.subdivisions === 5, 'the game reads the ribbon the converter wrote: the red ribbon is a third of a second long, drawn in fives');
  }
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
  if (!swg || !existsSync(swg)) note('no SWG install on this machine, so the retail ribbons are not read here');
  else {
    const { openVfs } = await import('../tre.mjs');
    const { isRetailByName } = await import('../manifest.mjs');
    const vfs = openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null });
    const all = [...vfs.list()].filter((p: string) => /\.swh$/i.test(p));
    const bad: string[] = [];
    const versions = [0, 0];
    for (const p of all) {
      try {
        versions[parseSwoosh(parseIff(vfs.read(p))).version]++;
      } catch (err) {
        bad.push(`${p}: ${(err as Error).message}`);
      }
    }
    ok(all.length > 0 && bad.length === 0, `every one of the ${all.length} retail ribbons reads to its last byte (${versions[0]} of 0000, ${versions[1]} of 0001)${bad.length ? `: ${bad.slice(0, 3).join('; ')}` : ''}`);
    const red = parseSwoosh(parseIff(vfs.read('appearance/sw_red_ribbon.swh')));
    ok(red.texture.shader === 'shader/red_4_4.sht' && near(red.width, 0.04) && red.samples === 10, 'the red ribbon is a flat red texture four centimetres wide');
  }
}

console.log(`\nribbons: ${passed} checks passed`);
