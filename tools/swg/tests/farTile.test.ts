// The far tiles' cut under the detailed chunks, one tile at a time and in place (src/world/farTile.ts, commit 4a
// of the frame-time wave), with three in node: over 500 random sequences of chunks coming and going, each
// tile's cut is the old rebuild from scratch quad for quad, in the same order; the index attribute is the one
// made with the tile throughout, and the draw range is the quads kept; a chunk outside a tile touches nothing
// of it; the old rebuild's replacement of the index is mended by the next cut; both kinds of tile the terrain
// builds (the textured ground's one corner a triangle, and a grid's shared corners) keep a 16-bit index; each
// cut asks for one upload range from the front over every quad kept and never grows the list, and a copy of
// the card's buffer kept the way three uploads it holds the right quads at every draw; what it costs: every
// tile of the default reach cut from scratch, against one tile cut in place; and step 4's wiring in the world
// (the chunks noted, the plants adopted, compiled, and forgotten with the world), read as text.
//
// Everything here is synthetic: the tile and chunk sizes are the world's own (64 m chunks, 512 m tiles of
// 32 by 32 quads, six tiles each way), nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { chunkInTile, coverChunk, coverFrom, keptFromScratch, makeFarTileCut, writeKept, type FarTileCut } from '../../../src/world/farTile.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const CHUNK = 64;
const TILE = 512;
const RES = 32;
const STEP = TILE / RES;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The textured ground's far tile: one corner a triangle, so the index is the identity over 6 144 corners. */
function identityIndex(): Uint32Array {
  const a = new Uint32Array(RES * RES * 6);
  for (let i = 0; i < a.length; i++) a[i] = i;
  return a;
}

/** A plain grid's far tile: 33 by 33 shared corners, two triangles a quad. */
function gridIndex(): number[] {
  const out: number[] = [];
  const w = RES + 1;
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const a = j * w + i;
      out.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
  }
  return out;
}

function geometryFor(full: ArrayLike<number>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  let max = 0;
  for (let i = 0; i < full.length; i++) max = Math.max(max, full[i]);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((max + 1) * 3), 3));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(full), 1));
  return g;
}

const key = (cx: number, cz: number) => `${cx},${cz}`;

/**
 * The card's copy of an index attribute, kept the way three's `WebGLAttributes` keeps it: made whole the first
 * time the attribute is drawn, and afterwards, whenever its version has moved, rewritten over the ranges it
 * asked for (or whole when it asked for none), the ranges then cleared. What a draw reads is this copy, never
 * the array, so a cut that forgot to ask for an upload, or asked for too little, draws stale quads here as it
 * would on the card: holes, or the ground under a chunk drawn twice.
 */
class CardCopy {
  data: Uint32Array | null = null;
  version = -1;
  uploads = 0;
  draw(attr: THREE.BufferAttribute): void {
    const array = attr.array as ArrayLike<number>;
    if (this.data === null) {
      this.data = Uint32Array.from(array);
      this.version = attr.version;
      this.uploads++;
      return;
    }
    if (this.version >= attr.version) return;
    const ranges = attr.updateRanges;
    if (ranges.length === 0) for (let i = 0; i < array.length; i++) this.data[i] = array[i];
    else for (const r of ranges) for (let i = r.start; i < r.start + r.count; i++) this.data[i] = array[i];
    attr.clearUpdateRanges();
    this.version = attr.version;
    this.uploads++;
  }
}

function sameAsScratch(cut: FarTileCut, g: THREE.BufferGeometry, full: ArrayLike<number>, tx: number, tz: number, loaded: Set<string>): boolean {
  const want = keptFromScratch(full, RES, tx * TILE, tz * TILE, STEP, CHUNK, (cx, cz) => loaded.has(key(cx, cz)));
  const idx = g.index as THREE.BufferAttribute;
  if (g.drawRange.start !== 0 || g.drawRange.count !== want.length) return false;
  if (cut.kept * 6 !== want.length) return false;
  for (let i = 0; i < want.length; i++) if (idx.array[i] !== want[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// The cut against the old rebuild, over 500 random sequences.
{
  const next = rng(11);
  let sequences = 0;
  let steps = 0;
  let sameAttr = true;
  let allSame = true;
  let maxRanges = 0;
  let asked = true;
  let writes = 0;
  let drawnSame = true;
  let draws = 0;
  let uploads = 0;
  for (let s = 0; s < 500; s++) {
    const full = s % 2 === 0 ? identityIndex() : gridIndex();
    const tx = Math.floor((next() - 0.5) * 20);
    const tz = Math.floor((next() - 0.5) * 20);
    const g = geometryFor(full);
    const cut = makeFarTileCut(full, RES, tx * TILE, tz * TILE, STEP, CHUNK);
    const attr = cut.index;
    const card = new CardCopy();
    const loaded = new Set<string>();
    // A cut that keeps anything must ask for an upload: the version moved, and one range from the front
    // reaching at least over every quad kept (wider only while three has not taken the last one yet).
    const cutAndCheck = (): void => {
      const v = attr.version;
      writeKept(cut, g);
      writes++;
      if (cut.kept > 0) {
        const r = attr.updateRanges;
        if (attr.version === v || r.length !== 1 || r[0].start !== 0 || r[0].count < cut.kept * 6) asked = false;
      }
    };
    // A frame drawn now and then: the card's copy brought up to date as three would, and the draw range read
    // from it, never from the array, against the old rebuild from scratch.
    const drawAndCheck = (): void => {
      if (next() < 0.4) return;
      const before = card.uploads;
      card.draw(attr);
      uploads += card.uploads - before;
      draws++;
      const want = keptFromScratch(full, RES, tx * TILE, tz * TILE, STEP, CHUNK, (cx, cz) => loaded.has(key(cx, cz)));
      const data = card.data as Uint32Array;
      if (g.drawRange.count !== want.length) drawnSame = false;
      for (let i = 0; i < want.length && drawnSame; i++) if (data[i] !== want[i]) drawnSame = false;
    };
    // Some chunks already standing when the tile is made, in the tile and round it.
    const c0x = (tx * TILE) / CHUNK;
    const c0z = (tz * TILE) / CHUNK;
    for (let k = 0; k < 20; k++) loaded.add(key(c0x - 2 + Math.floor(next() * 12), c0z - 2 + Math.floor(next() * 12)));
    coverFrom(cut, (cx, cz) => loaded.has(key(cx, cz)));
    cutAndCheck();
    if (!sameAsScratch(cut, g, full, tx, tz, loaded)) allSame = false;
    drawAndCheck();
    const n = 20 + Math.floor(next() * 60);
    for (let k = 0; k < n; k++) {
      const cx = c0x - 2 + Math.floor(next() * 12);
      const cz = c0z - 2 + Math.floor(next() * 12);
      const has = loaded.has(key(cx, cz));
      // Mostly a chunk flipping, sometimes one said to come that is already there.
      const come = next() < 0.1 ? true : !has;
      if (come) loaded.add(key(cx, cz));
      else loaded.delete(key(cx, cz));
      if (coverChunk(cut, cx, cz, come)) cutAndCheck();
      if (!sameAsScratch(cut, g, full, tx, tz, loaded)) allSame = false;
      if (g.index !== attr || cut.index !== attr) sameAttr = false;
      maxRanges = Math.max(maxRanges, attr.updateRanges.length);
      drawAndCheck();
      steps++;
    }
    sequences++;
  }
  ok(sequences === 500 && allSame, `over ${sequences} random sequences (${steps} chunks coming and going) every cut is the old rebuild from scratch, quad for quad and in order, and the draw range is the quads kept`);
  ok(sameAttr, 'the index attribute is the one made with the tile, throughout');
  ok(maxRanges === 1, 'each cut asks for one upload range and the list never grows between draws');
  ok(asked && writes > 1000, `every one of ${writes} cuts that keeps anything moves the version and asks for one range from the front over every quad kept`);
  ok(drawnSame && draws > 1000 && uploads > 500, `and at each of ${draws} draws the card's copy, uploaded as three uploads it (${uploads} times), holds the old rebuild's quads over the draw range`);
}

// ---------------------------------------------------------------------------------------------
// The pieces one by one.
{
  const full = identityIndex();
  const g = geometryFor(full);
  const cut = makeFarTileCut(full, RES, 2 * TILE, -3 * TILE, STEP, CHUNK);
  ok(cut.index.array instanceof Uint16Array && cut.index.array.length === RES * RES * 6, "the textured ground's tile (6 144 corners) keeps a 16-bit index at its full size");
  ok(makeFarTileCut(gridIndex(), RES, 0, 0, STEP, CHUNK).index.array instanceof Uint16Array, "and so does a plain grid's (33 by 33)");
  const big = new Uint32Array(RES * RES * 6);
  big[5] = 70000;
  ok(makeFarTileCut(big, RES, 0, 0, STEP, CHUNK).index.array instanceof Uint32Array, 'a tile past 65 535 corners keeps a 32-bit one');
  ok(chunkInTile(cut, 16, -24) && chunkInTile(cut, 23, -17) && !chunkInTile(cut, 24, -20) && !chunkInTile(cut, 16, -25), 'a tile of 512 m holds the eight by eight chunks at its own place and no other');
  coverFrom(cut, () => false);
  writeKept(cut, g);
  ok(cut.kept === RES * RES && g.drawRange.count === RES * RES * 6 && g.index === cut.index, 'no chunk: every quad kept, and the tile draws through its own index');
  ok(!coverChunk(cut, 0, 0, true), 'a chunk outside the tile changes nothing of it');
  ok(coverChunk(cut, 17, -20, true) && !coverChunk(cut, 17, -20, true), 'a chunk inside it covers its quads once');
  writeKept(cut, g);
  ok(cut.kept === RES * RES - 16, 'a 64 m chunk covers the four by four 16 m quads under it');
  // The old rebuild hands the geometry a new index of its own; the next cut puts the tile's back.
  g.setIndex([0, 1, 2]);
  g.setDrawRange(0, Infinity);
  writeKept(cut, g);
  ok(g.index === cut.index && g.drawRange.count === (RES * RES - 16) * 6, "the old rebuild's replacement is mended by the next cut");
  for (let cx = 16; cx < 24; cx++) for (let cz = -24; cz < -16; cz++) coverChunk(cut, cx, cz, true);
  const v = cut.index.version;
  writeKept(cut, g);
  ok(cut.kept === 0 && g.drawRange.count === 0 && cut.index.version === v, 'every chunk loaded: nothing drawn, and nothing uploaded');
}

// ---------------------------------------------------------------------------------------------
// What it costs: every tile of the default reach (thirteen by thirteen) against one.
{
  const tiles: { cut: FarTileCut; g: THREE.BufferGeometry; tx: number; tz: number }[] = [];
  const full = identityIndex();
  const loaded = new Set<string>();
  // The detailed chunks round the middle, six each way, as the world streams them.
  for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) loaded.add(key(dx, dz));
  const has = (cx: number, cz: number) => loaded.has(key(cx, cz));
  for (let tz = -6; tz <= 6; tz++) {
    for (let tx = -6; tx <= 6; tx++) {
      const g = geometryFor(full);
      const cut = makeFarTileCut(full, RES, tx * TILE, tz * TILE, STEP, CHUNK);
      coverFrom(cut, has);
      writeKept(cut, g);
      tiles.push({ cut, g, tx, tz });
    }
  }
  // Warm both paths, then time them.
  for (let w = 0; w < 5; w++) for (const t of tiles) keptFromScratch(full, RES, t.tx * TILE, t.tz * TILE, STEP, CHUNK, has);
  const runs = 10;
  let t0 = performance.now();
  for (let r = 0; r < runs; r++) for (const t of tiles) t.g.setIndex(keptFromScratch(full, RES, t.tx * TILE, t.tz * TILE, STEP, CHUNK, has));
  const whole = (performance.now() - t0) / runs;
  const middle = tiles.find((t) => t.tx === 0 && t.tz === 0) as (typeof tiles)[number];
  for (let w = 0; w < 200; w++) {
    coverChunk(middle.cut, 3, 3, w % 2 === 0);
    writeKept(middle.cut, middle.g);
  }
  const n = 2000;
  t0 = performance.now();
  for (let r = 0; r < n; r++) {
    coverChunk(middle.cut, 3, 3, r % 2 === 0);
    writeKept(middle.cut, middle.g);
  }
  const one = (performance.now() - t0) / n;
  console.log(`     ${tiles.length} tiles rebuilt from scratch: ${whole.toFixed(2)} ms; one tile cut in place: ${(one * 1000).toFixed(1)} µs`);
  ok(one < 0.1, `one tile cut in place takes under 0.1 ms (${one.toFixed(4)} ms)`);
  ok(one * 20 < whole, `and is more than twenty times cheaper than rebuilding all ${tiles.length} (${whole.toFixed(2)} ms)`);
}

// ---------------------------------------------------------------------------------------------
// Step 4's wiring in the world, read as text: `world.ts` drags the whole game in and cannot be stood up here,
// and each line below compiles just as well deleted.
{
  const worldSrc = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const flora = readFileSync(new URL('../../../src/world/flora.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  // 4a: every chunk made or dropped is noted, and only their tiles are cut.
  ok(/this\.createChunk\(w\.cx, w\.cz\);\s*this\.noteChunk\(w\.cx, w\.cz, true\);/.test(worldSrc) && /this\.chunks\.delete\(key\);\s*this\.noteChunk\(c\.cx, c\.cz, false\);/.test(worldSrc), 'the world notes every chunk it makes and drops');
  ok(/FAR_TILE_TUNE\.local \? this\.cutChangedTiles\(\) : this\.refreshAllFarTiles\(\)/.test(worldSrc) && /this\.changedN = 0;/.test(worldSrc), 'and cuts only their tiles, the notes emptied after every stream');
  // 4c: the plants' materials are forgotten with the world, the whole list the stand-ins adopted at arrival.
  const unload = worldSrc.slice(worldSrc.indexOf('for (const c of this.chunks.values()) this.disposeChunk(c);'), worldSrc.indexOf('this.pack?.dispose();'));
  ok(/if \(this\.flora\) this\.forgetMaterials\(this\.flora\.materials\(\)\);/.test(unload) && unload.indexOf('this.forgetMaterials(this.flora.materials())') < unload.indexOf('this.flora = null;'), "a world let go forgets every plant's material from the portal set and the cascades, before it lets go of the planter and the pack disposes them");
  ok(/materials\(out: Set<THREE\.Material> = new Set\(\)\): Set<THREE\.Material> \{\s*for \(const model of this\.models\.values\(\)\) \{\s*for \(const prim of model\.primitives\)/.test(flora) && /for \(const model of this\.models\.values\(\)\) \{[\s\S]{0,200}for \(const prim of model\.primitives\) \{\s*const mesh = new THREE\.InstancedMesh\(prim\.geometry, prim\.material, 1\);/.test(flora), 'and that list is every primitive of every model, the very ones the stand-ins are made of');
  ok(/this\.floraWarm = FLORA_WARM\.on \? this\.flora\.standIns\(\) : \[\];\s*for \(const o of this\.floraWarm\) this\.adoptMaterials\(o\);/.test(worldSrc), 'the stand-ins are adopted when the planet is read');
  ok(/for \(const o of this\.floraWarm\) \{\s*this\.adoptMaterials\(o\);\s*objects\.push\(o\);\s*\}/.test(worldSrc), "and compiled by the loading screen's sweep");
  ok(/if \(FLORA_WARM\.on\) \{\s*const fresh = this\.adoptMaterials\(group\);\s*if \(fresh\.length\) this\.compileObjects\(fresh\);\s*\}\s*this\.chunkRoot\.add\(group\);/.test(worldSrc), 'and a chunk is adopted before it goes into the scene');
}

console.log(`\n${checks} checks passed`);
