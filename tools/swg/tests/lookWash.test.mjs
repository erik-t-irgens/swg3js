// The viewer's wash suite brought into the game (the GPU port's pass 2, wave 4a), over `src/sky/look/`.
// Node tests for the day wash's new numbers (the atmosphere brief's wave B, item 3): skywash.js's thickness (1 is the
// wash as it was, to the bit) and the drawn sun's glow laid in front of a body (its profile is the very stops the sun
// is drawn with; nothing behind the eye, nothing beyond the glow's edge, none at a share of 0).
//   node tools/swg/tests/lookWash.test.mjs
import { pathToFileURL } from 'node:url';
const LOOK = new URL('../../../src/sky/look/', import.meta.url);
const W = await import(new URL('skywash.js', LOOK).href);
const A = await import(new URL('airProfile.js', LOOK).href);
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const sky = { zenith: { r: 0.1, g: 0.2, b: 0.5 }, horizon: { r: 0.4, g: 0.5, b: 0.6 }, sunDir: { x: 0, y: 1, z: 0 }, sunGlow: { r: 1, g: 0.9, b: 0.8 }, glowAmt: 0.5, game: 0, gZenith: { r: 0, g: 0, b: 0 }, gHorizon: { r: 0, g: 0, b: 0 }, zenithAt: 0.5, daylight: 1 };
const mk = () => ({ light: { r: 0, g: 0, b: 0 }, trans: { r: 0, g: 0, b: 0 } });
const d = { x: 0.6, y: 0.3, z: 0.74 }; const dl = Math.hypot(d.x, d.y, d.z); d.x /= dl; d.y /= dl; d.z /= dl;
// the wash as it was (looks run 2's formula, written here) against the module at thickness 1
{
  const o = W.skyWash(d, sky, mk(), { ...W.WASH });
  const m = W.airMass(d.y), dim = 1 - 0.25;
  const was = [0.1, 0.15, 0.28].map((t) => Math.exp(-t * m) * dim);
  ok(o.trans.r === was[0] && o.trans.g === was[1] && o.trans.b === was[2], `at thickness 1 a Painted body's wash is what it was, to the bit (${o.trans.r.toFixed(4)}, ${o.trans.g.toFixed(4)}, ${o.trans.b.toFixed(4)})`);
  const o2 = W.skyWash(d, sky, mk(), { ...W.WASH, thick: 2 });
  ok(Math.abs(o2.trans.b / dim - (o.trans.b / dim) ** 2) < 1e-12, 'at thickness 2 it takes twice the optical depth (the share through, squared)');
  const tabs = A.makeTables(A.recordOf({ mode: 'scattered' }));
  const s1 = W.airWash(d, sky, tabs, mk(), { ...W.WASH }), s2 = W.airWash(d, sky, tabs, mk(), { ...W.WASH, thick: 2 }), s0 = W.airWash(d, sky, tabs, mk(), { ...W.WASH, thick: 0 });
  ok(Math.abs(s2.trans.g / 0.75 - (s1.trans.g / 0.75) ** 2) < 1e-12 && Math.abs(s0.trans.g - 0.75) < 1e-12, `a Scattered body's likewise, from the ground world's own air (${(s1.trans.g / 0.75).toFixed(4)} through at 1; all at 0)`);
}
// the profile is the drawn stops, linear between
ok(W.profileAt(W.SUN_GLOW_STOPS, 0) === 0.6 && Math.abs(W.profileAt(W.SUN_GLOW_STOPS, 0.175) - (0.38 + 0.18) / 2) < 1e-12 && W.profileAt(W.SUN_GLOW_STOPS, 1) === 0 && W.profileAt(W.SUN_GLOW_STOPS, 1.5) === 0, 'the glow\'s profile is its drawn stops, linear between, none at and beyond its square\'s edge');
// the glow in front of a body
{
  const half = 3 * Math.PI / 180;
  const sun = { x: 0, y: 0, z: -1, glowTan: Math.tan(half) * 1.4, discTan: Math.tan(half), glow: { r: 0.85, g: 0.8, b: 0.7 }, disc: { r: 1, g: 1, b: 0.95 } };
  const at = (deg, share = 1) => { const a = deg * Math.PI / 180, o = { r: 0, g: 0, b: 0 }; W.sunGlowAt({ x: Math.sin(a), y: 0, z: -Math.cos(a) }, [sun], 1, o, share); return o; };
  // (the glow's square reaches 1.4 times the disc's 3 degrees: about 4.2 degrees out)
  const g0 = at(0), g1 = at(1), g2 = at(2.5), g3 = at(3.6), g9 = at(10), gb = at(170), gs = at(1, 0);
  ok(Math.abs(g0.r - 0.85 * 0.6) < 1e-12, `in front of the sun itself the glow's centre alone (${g0.r.toFixed(3)}: the disc is behind the body)`);
  ok(g1.r < g0.r && g2.r < g1.r && g3.r < g2.r && g3.r > 0, `it falls off outward (${[g0, g1, g2, g3].map((x) => x.r.toFixed(3)).join(', ')})`);
  ok(g9.r === 0 && gb.r === 0 && gs.r === 0, 'none beyond the glow\'s edge, none behind the eye, none at a share of 0');
  const t = Math.tan(1.2 * Math.PI / 180) / sun.discTan, tg = Math.tan(1.2 * Math.PI / 180) / sun.glowTan;
  const want = 0.85 * W.profileAt(W.SUN_GLOW_STOPS, tg) + 1 * W.profileAt(W.SUN_DISC_STOPS, t) * (t <= 0.2 ? 0 : t >= 0.3 ? 1 : ((t - 0.2) / 0.1) ** 2 * (3 - 2 * (t - 0.2) / 0.1));
  ok(Math.abs(at(1.2).r - want) < 1e-12, `a body 1.2 degrees off takes the glow's light there and the disc's fringe beyond its bright edge (${want.toFixed(4)})`);
}
console.log(`${n - fails} of ${n} checks pass`);
process.exit(fails ? 1 : 0);
