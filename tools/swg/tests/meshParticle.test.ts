// Particles that draw a model rather than a billboard, and the props that are nothing else.
//
// **Why this exists.** The converter read mesh emitters, counted them and threw them away, and the
// runtime only ever looked at `.quad`. 297 of the 2,097 retail effects carry a mesh emitter and 119
// are mesh emitters and nothing else, so those drew nothing at all. The entertainer's ribbon stick is
// the plainest case and the one the owner reported: its quad emitters are written with **alpha 0 for
// their whole life** and are there only to carry the ribbons (swooshes, `swoosh.mjs`), so the stick
// itself is the mesh, and holding one showed an empty hand. A sparkler has real quads, so its sparks
// showed and only its stick was missing -- which is exactly the pair of symptoms reported, from one cause.
//
// What is pinned here is the converter's half (an emitter's model is converted and its file written on
// the emitter, and an effect with no model to convert is left exactly as it was) and the arithmetic of
// the drawing, which is a matrix per live particle. The drawing itself needs a GPU and is the owner's
// to judge.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

// ---- The real pack: the entertainer props and what they carry -------------------------------------
//
// These read the owner's own converted pack when it is there and say so when it is not, as every test
// over converted content in this project does.
const pack = 'assets-private/weapons';
const particles = join(pack, 'particles');
if (!existsSync(particles)) {
  console.log(`note weapons pack not converted: skipping what it carries (${particles})`);
} else {
  const files = readdirSync(particles).filter((f) => f.endsWith('.json'));
  let withMesh = 0;
  let meshWithFile = 0;
  let meshWithout = 0;
  const models = new Set<string>();
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(particles, f), 'utf8')) as { groups?: { emitters?: { particle?: { type?: string; mesh?: { path?: string; file?: string } } }[] }[] };
    let any = false;
    for (const g of d.groups ?? []) {
      for (const e of g.emitters ?? []) {
        if (e.particle?.type !== 'mesh') continue;
        any = true;
        if (e.particle.mesh?.file) {
          meshWithFile++;
          models.add(e.particle.mesh.file);
        } else meshWithout++;
      }
    }
    if (any) withMesh++;
  }
  console.log(`note ${files.length} effects in the pack, ${withMesh} with a mesh emitter, ${meshWithFile} emitters with a model and ${meshWithout} without, over ${models.size} models`);
  assert.ok(meshWithFile > 0, 'the pack carries a model for its mesh emitters (rerun the weapons command if not)');
  passed++;
  console.log('ok   the pack carries a model for its mesh emitters');
  // Every model named is really on disk, or the runtime fetches a 404 and draws nothing.
  const missing = [...models].filter((m) => !existsSync(join(pack, m)));
  assert.deepEqual(missing, [], `every model a mesh emitter names is on disk${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
  passed++;
  console.log(`ok   and every one of the ${models.size} models it names is on disk`);

  // The ribbon stick: the case the owner reported. Its quads are invisible on purpose: the stick is the
  // mesh -- which is why "nothing appears at all" and not merely "no stick" -- and each quad is there to
  // carry a ribbon, which only a swoosh reader can convert.
  const ribbon = join(particles, 'fx_pt_entertainer_ribbon_stick_double.json');
  if (!existsSync(ribbon)) console.log('note the ribbon stick is not in this pack');
  else {
    type Att = { path: string; file?: string };
    const d = JSON.parse(readFileSync(ribbon, 'utf8')) as { groups: { emitters: { particle: { type: string; alpha?: { points: number[][] }; mesh?: { file?: string }; attachments?: Att[] } }[] }[] };
    const all = d.groups.flatMap((g) => g.emitters);
    const quads = all.filter((e) => e.particle.type === 'quad');
    const meshes = all.filter((e) => e.particle.type === 'mesh');
    assert.ok(quads.length > 0 && meshes.length > 0, 'the ribbon stick has both kinds');
    const invisible = quads.every((e) => (e.particle.alpha?.points ?? []).every((p) => p[1] === 0));
    assert.ok(invisible, 'every one of its quads is written with alpha 0 for its whole life');
    passed++;
    console.log(`ok   the ribbon stick's ${quads.length} quads are alpha 0 throughout, so the stick is the mesh`);
    assert.ok(
      meshes.every((e) => e.particle.mesh?.file),
      'and each of its mesh emitters names a model',
    );
    passed++;
    console.log(`ok   and each of its ${meshes.length} mesh emitters names a model`);
    const ribbons = quads.flatMap((e) => e.particle.attachments ?? []).filter((a) => /\.swh$/i.test(a.path));
    assert.ok(ribbons.length === quads.length, `each invisible quad carries a ribbon (${ribbons.length} ribbons on ${quads.length} quads)`);
    passed++;
    console.log(`ok   each of its ${quads.length} invisible quads carries a ribbon`);
    const drawn = ribbons.filter((a) => a.file && existsSync(join(pack, a.file)) && (JSON.parse(readFileSync(join(pack, a.file), 'utf8')) as { kind?: string }).kind === 'swoosh');
    assert.equal(drawn.length, ribbons.length, 'and every ribbon is converted, as a swoosh, onto disk (rerun the weapons command if not)');
    passed++;
    console.log('ok   and every ribbon is converted as a swoosh and is on disk');
  }

  // And the props on the rack that are an effect and nothing else: each must name an effect the pack
  // really holds, or holding one shows an empty hand however well the drawing works.
  const man = join(pack, 'manifest.json');
  if (existsSync(man)) {
    const m = JSON.parse(readFileSync(man, 'utf8')) as { weapons?: { id: string; class?: string; file?: string | null; effect?: string | null }[] };
    const ent = (m.weapons ?? []).filter((w) => w.class === 'entertainer');
    const modelless = ent.filter((w) => !w.file);
    const noEffect = modelless.filter((w) => !w.effect);
    const lostEffect = modelless.filter((w) => w.effect && !existsSync(join(pack, w.effect)));
    console.log(`note ${ent.length} dancer's props, ${ent.length - modelless.length} with a model of their own and ${modelless.length} that are an effect and nothing else`);
    assert.deepEqual(noEffect.map((w) => w.id), [], 'a prop with no model names an effect instead');
    passed++;
    console.log('ok   every prop with no model of its own names an effect instead');
    assert.deepEqual(lostEffect.map((w) => w.id), [], 'and the pack holds it');
    passed++;
    console.log('ok   and the pack really holds every effect they name');
  }
}

// ---- Which emitters the runtime makes at all -------------------------------------------------------
//
// The half that was missing. The drawing was written and this rule was not, so every mesh emitter in
// the game was refused before it could spawn a single particle: the effect was placed, it reported
// itself playing, and it had nothing in it. That is the exact reading the owner sent back, and it is
// why the pack checks above all passed while nothing appeared.
{
  const { emitterDrawn, emitterKept } = await import('../../../src/world/particleDraw.ts');
  const quad = (file: string | null, visible = true, shader: string | null = null) => ({ particle: { type: 'quad', quad: { texture: { file, visible, shader } } } });
  const mesh = (file: string | null) => ({ particle: { type: 'mesh', mesh: { file } } });

  ok(emitterDrawn(mesh('particles/pm_x.glb')), 'a mesh emitter that names a model draws');
  ok(!emitterDrawn(mesh(null)), 'and one out of a pack converted before the models were read does not');
  ok(emitterKept(mesh('particles/pm_x.glb')), 'so the effect makes it, which is what lets it spawn at all');
  ok(!emitterKept(mesh(null)), 'and leaves out the one that would draw nothing');

  ok(emitterDrawn(quad('particles/t.png')), 'a quad with a texture switched on draws, as it always did');
  ok(!emitterDrawn(quad('particles/t.png', false)), 'one whose texture is switched off does not');
  ok(!emitterDrawn(quad(null)), 'and one with no texture does not');
  ok(emitterDrawn(quad(null), true), 'unless the effect was placed solid, which is the jump tunnel');
  ok(!emitterDrawn(quad(null, true, 'shader/x.sht'), true), 'and not even then when it names a shader of its own');
  ok(!emitterDrawn(mesh(null), true), 'solid never rescues a mesh emitter, which has no untextured form');

  ok(!emitterKept({ visible: false, ...mesh('particles/pm_x.glb') }), 'an emitter the file switches off is left out whatever it would draw');
  ok(emitterKept(quad(null), { carries: true }), 'one that draws nothing is still made when its particles carry effects');
  ok(!emitterKept(quad(null)), 'and is not when they carry none');
  ok(!emitterKept({}), 'an emitter with no particle description at all is left out rather than throwing');
}

// ---- The fountains' water, drawn thinner than its files -------------------------------------------
{
  const { FOUNTAIN_SPRAY_TUNE, isFountainSpray } = await import('../../../src/world/particleDraw.ts');
  ok(isFountainSpray('particles/fx_pt_fountain_corl_circle_s01.json'), "a Corellian fountain's spray is a fountain's water");
  ok(isFountainSpray('../props/particles/fx_pt_fountain_garden.json'), 'and so is one out of the props pack, named its way out of the world it stands in');
  ok(!isFountainSpray('particles/fx_pt_fountain_corl_brazier_round_s01.json'), "the brazier that shares the fountains' name burns as its files say");
  ok(!isFountainSpray('particles/fx_pt_waterfall_mist.json') && !isFountainSpray('particles/fx_pt_fountain.json.bak/fx_pt_fire.json'), 'nothing else is thinned, and only the file name is read');
  ok(FOUNTAIN_SPRAY_TUNE.alpha > 0 && FOUNTAIN_SPRAY_TUNE.alpha < 1, `and the share is a thinning, not a switch (${FOUNTAIN_SPRAY_TUNE.alpha})`);
}

console.log(`\n${passed} checks passed`);
