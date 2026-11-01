// The permanent rows' looks as copies (Map-maker II's seventh wave, `src/world/rowMaterials.ts`): one copy a source and a
// look, shared by every row and piece wearing it and counted by owner; a tint multiplied into the colour at the tune's
// strength, a borrowed picture put on the copy's own clone, a borrowed material cloned whole under the source's own name
// with what is keyed to its own model stripped; every refusal in words; a copy no one holds kept for the world as a spare
// (worn again as the very copy), and one past the spares' bound or at the world's going forgotten by the world before it is
// disposed, never a texture; and every copy carrying its source's wraps, so the world puts it on its source's key.
//
// Run: node tools/swg/tests/rowMaterials.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LOOK_TUNE, RowMaterials, lookFor, lookRefusal, tintColour, type DonorPiece } from '../../../src/world/rowMaterials.ts';
import type { RowLook } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

function material(name: string, opts: { map?: THREE.Texture | null; color?: number } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: opts.color ?? 0xffffff });
  m.name = name;
  if (opts.map) m.map = opts.map;
  return m;
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
const geoUv1 = geo.clone();
geoUv1.setAttribute('uv1', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
const geoCard = geo.clone();
geoCard.setAttribute('cardPlane', new THREE.Int8BufferAttribute([0, 0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127], 4, true));

// ---- lookFor: the entry naming the material, else `*`. ----
{
  const mats: RowLook[] = [{ of: '*', tint: '#808080' }, { of: 'glass', tint: '#ff0000' }];
  ok(lookFor(mats, 'glass')?.tint === '#ff0000' && lookFor(mats, 'body')?.tint === '#808080', "a material's own entry first, `*` for every other");
  ok(lookFor([{ of: 'glass', tint: '#ff0000' }], 'body') === null, 'and nothing where neither names it');
}

// ---- tintColour: white eased toward the tint, held to [0, 1]. ----
{
  const c = tintColour('#ff0000', 1);
  const red = new THREE.Color('#ff0000');
  ok(c.r === red.r && c.g === red.g && c.b === red.b, 'at a strength of 1 the tint as written (in the working space)');
  const w = tintColour('#ff0000', 0);
  ok(w.r === 1 && w.g === 1 && w.b === 1, 'at 0, white: the model\'s own colour');
  const h = tintColour('#ff0000', 2);
  ok(h.equals(c), 'a strength past 1 is 1');
}

// ---- The refusals. ----
const pic = new THREE.Texture();
const pic1 = new THREE.Texture();
pic1.channel = 1;
const donor = (m: THREE.Material, g = geo, skinned = false): DonorPiece => ({ material: m, geometry: g, skinned });
{
  const plain = material('plain');
  const pictured = material('pictured', { map: pic });
  ok(lookRefusal(plain, { of: 'plain', tint: '#102030' }, null, geo) === null, 'a tint is never refused');
  ok(/is not loaded or has no such material/.test(lookRefusal(pictured, { of: 'x', map: 'a:b/c' }, null, geo) ?? ''), 'a donor not loaded is refused in words');
  ok(/skinned body/.test(lookRefusal(pictured, { of: 'x', map: 'a:b/c' }, donor(material('d', { map: pic }), geo, true), geo) ?? ''), 'a skinned donor is refused (its material is shared by many bodies)');
  ok(/has no picture to take/.test(lookRefusal(plain, { of: 'x', map: 'a:b/c' }, donor(material('d', { map: pic })), geo) ?? ''), 'a picture needs a material that draws one');
  ok(/has no picture to lend/.test(lookRefusal(pictured, { of: 'x', map: 'a:b/c' }, donor(material('d')), geo) ?? ''), 'and a donor that draws one');
  ok(/another coordinate set/.test(lookRefusal(pictured, { of: 'x', map: 'a:b/c' }, donor(material('d', { map: pic1 })), geo) ?? ''), 'on the same coordinate set');
  ok(lookRefusal(pictured, { of: 'x', map: 'a:b/c' }, donor(material('d', { map: pic })), geo) === null, 'a picture onto a picture on one set goes on');
  const card = material('leaf', { map: pic });
  card.userData.swgCardBlend = 'none';
  ok(/leaf card/.test(lookRefusal(plain, { of: 'x', like: 'a:b/c' }, donor(card), geo) ?? ''), "a leaf card's material is refused onto a geometry with no card plane");
  ok(lookRefusal(plain, { of: 'x', like: 'a:b/c' }, donor(card), geoCard) === null, 'and goes onto one that has one');
  const glbCard = material('leaf2', { map: pic });
  glbCard.userData.swgCard = { blend: false, emissive: [0, 0, 0] };
  ok(/leaf card/.test(lookRefusal(plain, { of: 'x', like: 'a:b/c' }, donor(glbCard), geo) ?? ''), "a card known only by the converter's own word, before the card rule has run, is refused alike");
  const set1 = material('detail', { map: pic1 });
  ok(/second coordinate set/.test(lookRefusal(plain, { of: 'x', like: 'a:b/c' }, donor(set1), geo) ?? ''), 'a material reading the second set is refused onto a geometry without it');
  ok(lookRefusal(plain, { of: 'x', like: 'a:b/c' }, donor(set1), geoUv1) === null, 'and goes onto one with it');
  const detail = material('det');
  detail.userData.swgDetail = { scale: 1 };
  ok(/second coordinate set/.test(lookRefusal(plain, { of: 'x', like: 'a:b/c' }, donor(detail), geo) ?? ''), "and so is one whose detail map reads it (the detail injection's own word)");
}

// ---- The copies: shared, counted, forgotten before disposed, never a texture. ----
{
  const forgotten: THREE.Material[] = [];
  const order: string[] = [];
  const copiesMade: [THREE.Material, THREE.Material][] = [];
  const looks = new RowMaterials({
    forget: (ms) => {
      for (const m of ms) {
        forgotten.push(m);
        order.push(`forget ${m.uuid}`);
      }
    },
    onCopy: (copy, source) => copiesMade.push([copy, source]),
  });
  let textureDisposed = 0;
  const own = new THREE.Texture();
  own.addEventListener('dispose', () => textureDisposed++);
  const theirs = new THREE.Texture();
  theirs.addEventListener('dispose', () => textureDisposed++);
  const body = material('body', { map: own, color: 0x808080 });
  const glass = material('glass');
  const donorMat = material('face', { map: theirs });
  const donorOf = (ref: string) => (ref === 'w:sign/face' ? donor(donorMat) : null);
  const a = {};
  const b = {};
  const tint: RowLook[] = [{ of: 'body', tint: '#ff0000' }];
  const ca = looks.wear(a, body, tint, geo, donorOf);
  const cb = looks.wear(b, body, tint, geo, donorOf);
  ok(ca !== body && ca === cb && looks.count === 1, 'two rows wearing one look on one source share one copy');
  ok(looks.wear(a, body, tint, geo, donorOf) === ca && looks.count === 1, 'and a second piece of one owner holds it once');
  ok(looks.wear(a, glass, tint, geo, donorOf) === glass, "a material the look does not name is the source's own");
  const want = new THREE.Color(0x808080).multiply(tintColour('#ff0000', LOOK_TUNE.tintStrength));
  ok((ca as THREE.MeshStandardMaterial).color.equals(want), 'the tint multiplies the source\'s colour');
  ok((ca as THREE.MeshStandardMaterial).map === own && ca.name === 'body', 'a tinted copy keeps its own picture and its name');
  ok(looks.isCopy(ca) && looks.sourceOf(ca) === body && looks.sourceOf(body) === body, 'a copy is known as one, and by its source');
  ok(copiesMade.length === 1 && copiesMade[0][0] === ca && copiesMade[0][1] === body, 'the world is told of a copy made, with its source (the reflection registry joins it with its source\'s strength)');
  const mapped = looks.wear(a, body, [{ of: 'body', map: 'w:sign/face' }], geo, donorOf) as THREE.MeshStandardMaterial;
  ok(mapped !== ca && mapped.map === theirs && mapped.color.equals(body.color), "a borrowed picture is put on a copy of the source's own (its colour as it was)");
  const liked = looks.wear(b, glass, [{ of: '*', like: 'w:sign/face' }], geo, donorOf) as THREE.MeshStandardMaterial;
  ok(liked !== donorMat && liked.map === theirs && liked.name === 'glass' && liked.userData.swgLookOf === 'face', "a borrowed material is the donor's cloned under the source's own name");
  // A donor's sway and crown and its room are its own model's: stripped, and the source's room taken.
  const swaying = material('sway', { map: theirs });
  swaying.userData.swgSway = { a: 1 };
  swaying.userData.swgLeaf = { b: 1 };
  swaying.userData.interior = true;
  const outdoor = material('outdoor');
  const strip = looks.wear({}, outdoor, [{ of: '*', like: 'w:s/sway' }], geo, () => donor(swaying));
  ok(strip.userData.swgSway === undefined && strip.userData.swgLeaf === undefined && strip.userData.interior === undefined, "what is keyed to the donor's own model is stripped (its sway, its crown, its room)");
  const refused = looks.wear(a, glass, [{ of: 'glass', map: 'w:sign/face' }], geo, donorOf);
  ok(refused === glass && looks.notes.some((n) => /has no picture to take/.test(n)), 'a look refused leaves the source on and is noted in words');
  // Tint strength moved: every tinted copy worked out again, nothing compiles (the colour is a uniform).
  LOOK_TUNE.tintStrength = 0.5;
  const n = looks.retint();
  ok(n === 1 && (ca as THREE.MeshStandardMaterial).color.equals(new THREE.Color(0x808080).multiply(tintColour('#ff0000', 0.5))), 'a moved tint strength works out every tinted copy again');
  LOOK_TUNE.tintStrength = 1;
  looks.retint();
  // Release: counted by owner; a copy still held is kept.
  let caDisposed = 0;
  ca.addEventListener('dispose', () => {
    caDisposed++;
    order.push(`dispose ${ca.uuid}`);
  });
  looks.release(a);
  ok(caDisposed === 0 && !forgotten.includes(ca), 'let go by one owner, a copy another holds is kept');
  // Shared: what one owner holds held for another too (the ghost's copies left behind).
  const c = {};
  looks.share(b, c);
  looks.release(b);
  ok(caDisposed === 0, 'held for a second owner by `share`, it outlives the first');
  const heldBefore = looks.count;
  const sparesBefore = looks.spares;
  looks.release(c);
  // `c` held two (the tint's copy and the borrowed material, both shared from `b`): both go spare.
  ok(caDisposed === 0 && !forgotten.includes(ca) && !forgotten.includes(liked) && looks.count === heldBefore - 2 && looks.spares === sparesBefore + 2, `let go by the last, each is kept for the world as a spare: neither forgotten nor disposed, its programs living on (${looks.spares} spares)`);
  // A tier coming back (or a row stood again by a landed write) wears the very copy again: nothing made, nothing built.
  const madeBefore = looks.made;
  const d = {};
  ok(looks.wear(d, body, tint, geo, donorOf) === ca && looks.made === madeBefore && looks.spares === sparesBefore + 1 && looks.count === heldBefore - 1, 'worn again, the spare is the very copy it was, off the spares, and no copy is made');
  looks.release(d);
  // Past the spares' bound the oldest go: forgotten first, then disposed.
  looks.spareMost = 0;
  const e = {};
  looks.wear(e, body, [{ of: 'body', tint: '#00ff00' }], geo, donorOf);
  looks.release(e);
  ok(caDisposed === 1 && forgotten.includes(ca) && looks.spares === 0, 'past the spares\' bound a spare is forgotten by the world and disposed');
  ok(order.indexOf(`forget ${ca.uuid}`) >= 0 && order.indexOf(`forget ${ca.uuid}`) < order.indexOf(`dispose ${ca.uuid}`), 'forgotten first, then disposed');
  looks.spareMost = 64;
  // A spare is kept to the world's going, and the going takes it with every copy held.
  const f = {};
  const kept = looks.wear(f, glass, [{ of: '*', tint: '#0000ff' }], geo, donorOf);
  looks.release(f);
  ok(looks.spares === 1 && !forgotten.includes(kept), 'a spare under the bound stands until the world goes');
  const before = looks.count;
  looks.clear();
  ok(looks.count === 0 && looks.spares === 0 && before > 0 && textureDisposed === 0, `the world going lets every copy go (${before} held, and the spare) and disposes no texture`);
  ok(forgotten.includes(mapped) && forgotten.includes(liked) && forgotten.includes(kept), 'every copy forgotten, spares and all');
}

// ---- What a copy carries of its source: the wraps the world applies, so the world puts it on its source's key. ----
{
  const looks = new RowMaterials({ forget: () => {} });
  // A source as the converter's and the world's wraps leave it (its highlight, its reflection, its detail, its card class).
  const wraps = { swgSpec: { mode: 'phong', color: [0.5, 0.5, 0.5], power: 12 }, swgCube: true, swgDetail: { scale: 4 }, swgEnvBase: 0.6 };
  const src = material('hull', { map: pic, color: 0x808080 });
  Object.assign(src.userData, JSON.parse(JSON.stringify(wraps)));
  const donorMat = material('plate', { map: new THREE.Texture() });
  Object.assign(donorMat.userData, { swgSpec: { mode: 'aniso', color: [1, 1, 1], power: 3 }, swgCube: false, swgSway: { a: 1 }, swgSwayForm: 'w7', swgLeaf: { b: 2 }, interior: true });
  const dOf = () => donor(donorMat, geoUv1);
  const tinted = looks.wear({}, src, [{ of: 'hull', tint: '#ff0000' }], geoUv1, dOf);
  const mapped = looks.wear({}, src, [{ of: 'hull', map: 'w:d/plate' }], geoUv1, dOf);
  const both = looks.wear({}, src, [{ of: 'hull', tint: '#ff0000', map: 'w:d/plate' }], geoUv1, dOf) as THREE.MeshStandardMaterial;
  const strip = (u: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(u).filter(([k]) => k in wraps)));
  ok(strip(tinted.userData) === JSON.stringify(wraps) && strip(mapped.userData) === JSON.stringify(wraps) && strip(both.userData) === JSON.stringify(wraps), "a tinted, a mapped and a tinted-and-mapped copy carry their source's wraps as they stand (the world puts each on its source's key)");
  ok(tinted.userData.swgSpec !== src.userData.swgSpec, "and as their own copies, so the world's writes to one never reach the source");
  // Tint and a borrowed picture together, as the reader takes them: the donor's picture under the tinted colour.
  ok(both.map === donorMat.map && both.color.equals(new THREE.Color(0x808080).multiply(tintColour('#ff0000', LOOK_TUNE.tintStrength))) && both !== tinted && both !== mapped, 'a tint and a borrowed picture on one material: the donor\'s picture under the tinted colour, a copy of its own');
  // A borrowed material carries the donor's own wraps, less what is keyed to the donor's model, and the source's room.
  const liked = looks.wear({}, src, [{ of: 'hull', like: 'w:d/plate' }], geoUv1, dOf);
  const u = liked.userData;
  ok(JSON.stringify(u.swgSpec) === JSON.stringify(donorMat.userData.swgSpec) && u.swgCube === false && u.swgSway === undefined && u.swgSwayForm === undefined && u.swgLeaf === undefined && u.interior === undefined && u.swgLookOf === 'plate', `a borrowed material keeps the donor's wraps less its sway, its form, its crown and its room (${JSON.stringify(u)})`);
}

console.log(`\nrowMaterials: ${checks} checks passed`);
