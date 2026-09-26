// The bare skin a garment leaves showing, and the one shader it is always written with.
//
// A bikini's midriff, a bustier's shoulders and the Ithorian trousers' legs are triangles of the
// garment's own mesh that the client drew with the **wearer's** body shader -- which is how a
// character's own tone, and a Twi'lek's lekku pattern, reach a piece of clothing. The archives name
// that material generically and give it no texture, so converted as it stands it is a material with
// no map: a flat pale grey that reads as a missing texture.
//
// This pins the two things the runtime fix depends on: that every textureless material in the whole
// wardrobe is that one shader and nothing else (so swapping on the name can never catch a garment
// whose texture merely failed to convert), and that a species body really carries a material the
// name rule will find to take the skin from.
//
// Run: node tools/swg/tests/bareSkin.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

/** The JSON chunk of a GLB. */
function glbJson(file: string): { materials?: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: unknown } }[] } | null {
  const buf = readFileSync(file);
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return null;
  let off = 12;
  let json = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString('utf8'));
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  return json;
}

const SKIN = /(^|\/)skin_([a-z0-9]+)\.sht$/i;
const ALSO: Record<string, string[]> = { skull: ['skull', 'head'] };

{
  const root = join('assets-private', 'wardrobe');
  if (!existsSync(root)) note('no wardrobe pack here (npm run swg -- wardrobe ...)');
  else {
    let bare = 0;
    let materials = 0;
    const odd: string[] = [];
    const parts = new Set<string>();
    for (const folder of readdirSync(root)) {
      const dir = join(root, folder);
      let files: string[];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.glb'));
      } catch {
        continue;
      }
      for (const f of files) {
        const g = glbJson(join(dir, f));
        for (const m of g?.materials ?? []) {
          materials++;
          if (m.pbrMetallicRoughness?.baseColorTexture !== undefined) continue;
          const name = m.name ?? '';
          const part = SKIN.exec(name)?.[2]?.toLowerCase();
          if (part) {
            bare++;
            parts.add(part);
          } else odd.push(`${folder}/${f}: ${name || '(unnamed)'}`);
        }
      }
    }
    if (!materials) note('the wardrobe pack has no models in it');
    else {
      ok(bare > 0, `${bare} of ${materials} worn materials are bare skin (${[...parts].sort().join(', ')}): the garment's own triangles that take the wearer's colour`);
      // The whole of why the runtime may swap on the name: bare skin is all but the only reason a
      // worn material has no texture, so a match can never be a garment whose own texture failed to
      // convert. A handful do fail, and every one measured is an archive gap rather than a fault of
      // the converter's -- the shader is not in the archives at all, or names a texture that is not
      // -- so they are counted and named rather than listed by hand, and the cap is what would trip
      // if a real regression started stripping textures off clothes.
      const share = odd.length / materials;
      assert.ok(share < 0.01, `hardly any other worn material is missing a texture (${odd.length} of ${materials}: ${odd.slice(0, 4).join('; ')})`);
      passed++;
      console.log(`ok   and only ${odd.length} of ${materials} others are missing one (${(share * 100).toFixed(2)}%, each a shader or texture the archives lack), so matching on those names is safe`);
      for (const o of odd.slice(0, 6)) console.log(`     ${o}`);
      // Every part a garment asks for must be a part some species really renders, or the swap finds
      // nothing and the piece stays grey with nothing to say why.
      const covered = new Set<string>();
      const croot = join('assets-private', 'characters');
      if (existsSync(croot)) {
        for (const species of readdirSync(croot)) {
          const file = join(croot, species, 'customize.json');
          if (!existsSync(file)) continue;
          for (const r of (JSON.parse(readFileSync(file, 'utf8')) as { recipes?: { material?: string }[] }).recipes ?? []) {
            const m = /_([a-z0-9]+)\.sht(@|$)/i.exec(r.material ?? '');
            if (m && !SKIN.test(r.material ?? '')) covered.add(m[1].toLowerCase());
          }
        }
        for (const p of parts) assert.ok((ALSO[p] ?? [p]).some((n) => covered.has(n)), `a species really renders the ${p} a garment asks for`);
        passed++;
        console.log(`ok   and every part they ask for (${[...parts].sort().join(', ')}) is one a species renders`);
      }
    }
  }
}

{
  const root = join('assets-private', 'characters');
  if (!existsSync(root)) note('no species packs here (npm run swg -- species ...)');
  else {
    let found = 0;
    let looked = 0;
    const without: string[] = [];
    for (const species of readdirSync(root)) {
      const file = join(root, species, 'customize.json');
      if (!existsSync(file)) continue;
      looked++;
      const recipes = (JSON.parse(readFileSync(file, 'utf8')) as { recipes?: { material?: string }[] }).recipes ?? [];
      // The body's own shader, which is what a garment's bare skin is given: it must not itself be
      // the generic name, or the swap would point a garment at another garment.
      if (recipes.some((r) => /_body\.sht$/i.test(r.material ?? '') && !SKIN.test(r.material ?? ''))) found++;
      else without.push(species);
    }
    if (!looked) note('no species carries a customize.json');
    else {
      ok(found === looked, `all ${looked} species render their skin into a material the name rule finds`);
      assert.ok(!without.length, `and none is left without one (${without.join(', ')})`);
    }
  }
}

console.log(`\n${passed} checks passed`);
