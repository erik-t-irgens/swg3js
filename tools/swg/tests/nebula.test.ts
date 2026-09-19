// The nebulae of a space zone: the table's rows, the lightning appearance they name, and the look a
// pack writes for the two kinds of sheet. Every figure here is made up; the shapes stand for the ones
// the real tables have (a nebula with lightning, one with none, one whose frequency is 0, a zone with
// both kinds of sheet, and a lightning file with a flip-book texture and two waveforms).
import assert from 'node:assert/strict';
import { LIGHTNING_IMAGE, NEBULA_SHADERS, nebulaLook, nebulaSummary, parseLightning, parseNebulaTable, shaderKindOf, lightningFilesOf } from '../nebula.mjs';
import { parseIff } from '../iff.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// A row in the table's own columns; anything left out is 0 or empty, as an unfilled cell is.
type Row = Record<string, string | number>;
const row = (over: Row): Row => ({
  name: '',
  x: 0, y: 0, z: 0, radius: 1000, density: 1, facingPercent: 0.5,
  facingA: 1, facingR: 1, facingG: 1, facingB: 1,
  facingRampA: 1, facingRampR: 1, facingRampG: 1, facingRampB: 1,
  orientedA: 1, orientedR: 1, orientedG: 1, orientedB: 1,
  orientedRampA: 1, orientedRampR: 1, orientedRampG: 1, orientedRampB: 1,
  ambientSound: '', ambientSoundVolume: 0, cameraJitter: 0,
  effectReactor: 0, effectEngine: 0, effectShields: 0,
  lightningFrequency: 0, lightningDurationMax: 0, lightningDamageMin: 0, lightningDamageMax: 0,
  lightningAppearace: '',
  lightningA: 0, lightningR: 0, lightningG: 0, lightningB: 0,
  lightningRampA: 0, lightningRampR: 0, lightningRampG: 0, lightningRampB: 0,
  lightningSound: '', lightningSoundLoop: '', lightningHitEffectClient: '', lightningHitEffectServer: '',
  environmentalDamageFrequency: 0, environmentalDamage: 0, environmentalDamageEffect: '',
  shaderIndex: 0,
  ...over,
});

ok(shaderKindOf(0) === 'glow' && shaderKindOf(1) === 'mist' && shaderKindOf(7) === 'glow' && shaderKindOf(undefined) === 'glow', 'shaderIndex 1 is the blended mist and everything else the additive glow');

const rows: Row[] = [
  row({
    name: 'big', x: -4000, y: 4000, z: 0, radius: 4000, density: 1, facingPercent: 0.5, shaderIndex: 1,
    facingR: 0.8, facingG: 0.8, facingB: 0.65, facingRampR: 0.8, facingRampG: 0.8, facingRampB: 0.7, orientedB: 0.7, orientedRampB: 0.7,
    ambientSound: 'sound\\amb_test_lp.snd', ambientSoundVolume: 0.5,
    lightningFrequency: 0.1, lightningDurationMax: 2, lightningDamageMin: 10, lightningDamageMax: 57,
    lightningAppearace: 'appearance\\pt_test.ltn',
    lightningA: 0.2, lightningR: 1, lightningG: 0.5, lightningB: 0.2,
    lightningRampA: 0.4, lightningRampR: 1, lightningRampG: 0.8, lightningRampB: 0.2,
    lightningSound: 'sound/strike.snd', lightningSoundLoop: 'sound/loop.snd',
    lightningHitEffectClient: 'clienteffect/hit_shield.cef', lightningHitEffectServer: 'clienteffect/hit_armor.cef',
  }),
  row({ name: 'quiet', x: 500, y: -200, z: 1500, radius: 600, density: 0.4, cameraJitter: 0.3 }),
  // A row that names a file but never strikes: no lightning either.
  row({ name: 'still', x: 0, y: 0, z: -2000, lightningAppearace: 'appearance/pt_test.ltn', lightningFrequency: 0, shaderIndex: 1 }),
];
const nebulae = parseNebulaTable(rows);
ok(nebulae.length === 3 && nebulae[0].name === 'big' && nebulae[0].radius === 4000 && nebulae[0].density === 1, 'a row per nebula with its name, radius and density');
ok(nebulae[0].at.join(',') === '4000,4000,0' && nebulae[1].at.join(',') === '-500,-200,1500' && Object.is(nebulae[2].at[0], 0), 'the centre is mirrored in X into the game\'s frame, and a zero stays a plain zero');
ok(nebulae[0].facing.colour.join(',') === '1,0.8,0.8,0.65' && nebulae[0].facing.ramp.join(',') === '1,0.8,0.8,0.7' && nebulae[0].oriented.colour[3] === 0.7, 'the four colours come across as alpha, red, green, blue');
ok(nebulae[0].shader === 'mist' && nebulae[1].shader === 'glow' && nebulae[0].shaderIndex === 1, 'each nebula carries the kind of sheet its index picks, and the index it came from');
ok(nebulae[0].sound.ambient === 'sound/amb_test_lp.snd' && nebulae[0].sound.volume === 0.5 && nebulae[1].sound.ambient === null, 'the ambient sound\'s slashes are turned, and an empty cell is null');
ok(nebulae[1].jitter === 0.3 && nebulae[0].jitter === 0, 'the camera shake rides along');
const strike = nebulae[0].lightning!;
ok(!!strike && strike.appearance === 'appearance/pt_test.ltn' && strike.every === 0.1 && strike.maxSeconds === 2 && strike.damage.join(',') === '10,57', 'the lightning columns: how often, how long and the damage band');
ok(strike.colour.join(',') === '0.2,1,0.5,0.2' && strike.ramp.join(',') === '0.4,1,0.8,0.2' && strike.sounds.strike === 'sound/strike.snd' && strike.hit.client === 'clienteffect/hit_shield.cef', 'its colours, its sounds and its hit effects');
ok(nebulae[1].lightning === null && nebulae[2].lightning === null, 'a row with no appearance, or one that never strikes, has no lightning at all');
ok(nebulae[0].unused.effectReactor === 0 && nebulae[0].unused.environmentalDamageEffect === null, 'the columns no retail row fills are kept, and an empty one is null');
ok(lightningFilesOf(nebulae).join(',') === 'appearance/pt_test.ltn', 'the lightning files a zone names, once each');

const sum = nebulaSummary(nebulae);
ok(sum.count === 3 && sum.glow === 1 && sum.mist === 2 && sum.striking === 1 && sum.jitter === 0.3, 'the summary counts the kinds and how many strike');
ok(sum.farthest === Math.round(Math.hypot(4000, 4000) + 4000), `the farthest edge is the furthest centre plus its radius (${sum.farthest} m)`);
ok(nebulaSummary([]).count === 0 && nebulaSummary(null as never).farthest === 0, 'no nebulae at all is a summary of zeros');

// A lightning appearance, laid out as the retail .ltn files are: FORM LEFX > 0002 with a particle
// texture, two waveforms and a chunk naming the effects at each end.
const wvfm = (points: number[][]) =>
  form('WVFM', chunk('0001', points.reduce((w, p) => w.f32(p[0]).f32(p[1]).f32(0).f32(0), new W().i32(0).i32(1).i32(points.length)).bytes()));
const ptex = (shader: string) =>
  form('PTEX', chunk('0000', new W().str(shader).i32(4).i32(0).i32(3).f32(0.5).i32(2).f32(10).u8(1).bytes()));
// The data chunk: the float, the two effect names, then a tail of 20 floats the reader only counts.
const data = new W().f32(0.2).str('appearance\\pt_test_start.prt').str('appearance/pt_test_end.prt');
for (let i = 0; i < 20; i++) data.f32(i / 10);
const ltn = parseLightning(
  parseIff(
    Buffer.from(
      encode(
        form('LEFX', form('0002',
          ptex('shader/pt_test_lightning.sht'),
          wvfm([[0, 0], [0.35, 3], [0.95, 3], [1, 8]]),
          wvfm([[0, 0], [0.15, 3], [0.2, 3], [1, 8]]),
          chunk('0000', data.bytes()),
        )),
      ),
    ),
  ),
);
ok(!!ltn && ltn.value === 0.2, 'the data chunk opens with a float the reader keeps but does not resolve');
ok(ltn!.start === 'appearance/pt_test_start.prt' && ltn!.end === 'appearance/pt_test_end.prt', 'it then names the effect at the start of a bolt and the one at its end, slashes turned');
ok(ltn!.trailingBytes === 80, `what follows those two names is counted and not read (${ltn!.trailingBytes} bytes)`);
ok(ltn!.texture!.shader === 'shader/pt_test_lightning.sht' && ltn!.texture!.frames === 4 && ltn!.texture!.frameEnd === 3 && ltn!.texture!.perColumn === 2 && ltn!.texture!.fps === 10 && ltn!.texture!.uvSize === 0.5 && ltn!.texture!.visible, 'the beam is a flip-book: its shader, its frames, how they sit in the picture and how fast they run');
ok(ltn!.waveforms.length === 2 && ltn!.waveforms[0].points.length === 4 && ltn!.waveforms[0].points[3][1] === 8, 'both waveforms come through the particle reader with their keys');
ok(parseLightning(parseIff(Buffer.from(encode(form('MESH', form('0005')))))) === null && parseLightning(null) === null, 'anything that is not a lightning appearance is null');
// The reader takes the first chunk of the version form that is long enough to hold the float and a
// name. The one file in the archives has nothing before it, but a shorter chunk in front of it (a
// flag byte, say) must not be mistaken for the data.
const withPrefix = parseLightning(
  parseIff(
    Buffer.from(
      encode(
        form('LEFX', form('0002',
          chunk('FLAG', new W().u8(1).bytes()),
          ptex('shader/pt_test_lightning.sht'),
          chunk('0000', data.bytes()),
        )),
      ),
    ),
  ),
);
ok(withPrefix!.value === 0.2 && withPrefix!.start === 'appearance/pt_test_start.prt' && withPrefix!.waveforms.length === 0, 'a short chunk before the data is not mistaken for it, and a file with no waveforms still reads');
ok(parseLightning(parseIff(Buffer.from(encode(form('LEFX', form('0002', ptex('shader/x.sht'))))))) === null, 'a lightning form with no data chunk at all is null rather than half a beam');

// The look a pack writes: each kind's sheet and the near shell over the same image.
const look = nebulaLook({ image: (kind: string) => (kind === 'glow' ? 'nebula/glow.png' : null), effect: (shader: string) => `effect/e_${shader.replace(/^.*\//, '').replace(/\.sht$/, '')}.eft` });
ok(look.glow.shader === NEBULA_SHADERS.glow.sheet && look.glow.blend === 'add' && look.mist.blend === 'alpha', 'the glow is additive and the mist blended');
ok(look.glow.texture === 'nebula/glow.png' && look.glow.shell.texture === 'nebula/glow.png' && look.glow.shell.shader === NEBULA_SHADERS.glow.shell, 'the near shell is a different shader over its kind\'s own image');
ok(look.mist.texture === null && look.mist.shell.texture === null, 'a kind whose picture could not be written carries null, shell and all');
ok(look.glow.effect !== look.glow.shell.effect, 'the shell\'s effect is its own');
ok(LIGHTNING_IMAGE === 'nebula/lightning.png', 'the lightning picture has a fixed place in a pack');

console.log(`${checks} checks passed`);
