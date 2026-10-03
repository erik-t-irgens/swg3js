// Which of a parts pack's meshes a character is stood up with (src/player/partsShown.ts), read
// against every parts pack on disk: each species pack under `characters/` and each of the mobiles
// catalogue's parts appearances (an NPC's own model, Han Solo's or a Selonian's).
//
// The promise pinned is the client's: every mesh of the appearance itself is drawn, whatever its
// occlusion layer, with the pack's own default clothes on (an NPC's own model) and with nothing on
// (a dressed person, whose outfit is the catalogue's). The old rule loaded layer 0 and the dress
// list only, which left fifteen of the game's named people with no head and no hands (their head
// and hands are one mesh at layer -1) and gave the Selonians and gungan_m_02 nothing to show at all,
// so their spawns threw. The made-up checks run anywhere; the packs are read only where they are.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { partsToLoad, type ShownPart } from '../../../src/player/partsShown.ts';

let passed = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`--   ${what}`);

/** The rule before: layer 0 and the dress list, nothing else. */
const oldRule = (parts: readonly ShownPart[], dress: ReadonlySet<string>) => parts.filter((p) => p.occlusionLayer === 0 || dress.has(p.name));

// ---------------------------------------------------------------------------------------------
// The rule on made-up parts.
{
  const parts: ShownPart[] = [
    { name: 'body', occlusionLayer: 0, body: true },
    { name: 'headhands', occlusionLayer: -1, body: true },
    { name: 'boots', occlusionLayer: 2, body: true },
    { name: 'shirt', occlusionLayer: 1 },
    { name: 'under', occlusionLayer: -1 },
  ];
  const names = (dress: string[]) => partsToLoad(parts, new Set(dress)).map((p) => p.name).join(',');
  ok(names([]) === 'body,headhands,boots,under', 'with nothing on: every body mesh at any layer, and anything at layer 0 or under');
  ok(names(['shirt']) === 'body,headhands,boots,shirt,under', 'a piece asked for is put on as well, in the pack\'s own order');
  ok(partsToLoad([{ name: 'whole', occlusionLayer: -1, body: true }], new Set()).length === 1, 'a pack whose whole body is one mesh at layer -1 has that mesh to show');
  ok(oldRule([{ name: 'whole', occlusionLayer: -1, body: true }], new Set()).length === 0, 'where the old rule had nothing, which is the spawn that threw');
}

// ---------------------------------------------------------------------------------------------
// The game stands its characters up by this rule and no other. Character.load cannot run under node
// (its rig loader), so its source is read: put back to the old filter, every check above would still
// pass and the Selonians would throw again.
{
  const character = readFileSync(new URL('../../../src/player/character.ts', import.meta.url), 'utf8');
  ok(/import \{ partsToLoad \} from '\.\/partsShown\.ts';/.test(character), 'Character takes the rule from partsShown.ts');
  ok(/const dress = new Set\(wear \?\? manifest\.defaultWear \?\? \[\]\);\s*(\/\/[^\n]*\n\s*)*const wanted = partsToLoad\(manifest\.parts, dress\);/.test(character), "Character.load stands its meshes up from partsToLoad over the pack's parts and the dress");
  ok(/for \(const def of wanted\) await character\.addPart\(def\.name, \[def\], true\);/.test(character), 'and loads every one of them');
  ok(!/occlusionLayer === 0 \|\| dress\.has/.test(character) && !/const wanted = manifest\.parts\.filter\(/.test(character), 'with no filter of its own left beside it');
}

// ---------------------------------------------------------------------------------------------
// The packs.
interface Pack {
  label: string;
  /** The pack's own folder, which its parts' files are relative to. */
  dir: string;
  parts: (ShownPart & { file?: string; dir?: string })[];
  defaultWear: string[];
}
const packs: Pack[] = [];
const root = 'assets-private';
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as { parts?: Pack['parts']; defaultWear?: string[] };
{
  const chars = join(root, 'characters');
  if (existsSync(chars)) {
    for (const id of readdirSync(chars)) {
      const file = join(chars, id, 'parts.json');
      if (!existsSync(file)) continue;
      const m = read(file);
      packs.push({ label: `characters/${id}`, dir: join(chars, id), parts: m.parts ?? [], defaultWear: m.defaultWear ?? [] });
    }
  }
  const catFile = join(root, 'mobiles', 'catalogue.json');
  if (existsSync(catFile)) {
    const cat = JSON.parse(readFileSync(catFile, 'utf8')) as { appearances?: Record<string, { form?: string; file?: string }> };
    for (const [id, app] of Object.entries(cat.appearances ?? {})) {
      if (app.form !== 'parts' || !app.file) continue;
      const file = join(root, app.file);
      if (!existsSync(file)) {
        note(`${id}: the catalogue names ${app.file}, which is not on disk`);
        continue;
      }
      const m = read(file);
      packs.push({ label: `mobiles/${id}`, dir: join(file, '..'), parts: m.parts ?? [], defaultWear: m.defaultWear ?? [] });
    }
  }
}

if (!packs.length) note('no parts packs here (npm run swg -- species / mobiles ...): only the made-up checks ran');
else {
  const species = packs.filter((p) => p.label.startsWith('characters/')).length;
  ok(packs.length > 0, `${packs.length} parts packs read (${species} species, ${packs.length - species} of the catalogue's parts appearances)`);
  let bodies = 0;
  const missed: string[] = [];
  const empty: string[] = [];
  const strays: string[] = [];
  let oldDropped = 0;
  const oldDroppedPacks = new Set<string>();
  for (const pack of packs) {
    for (const dress of [new Set(pack.defaultWear), new Set<string>()]) {
      const wanted = new Set(partsToLoad(pack.parts, dress).map((p) => p.name));
      if (!wanted.size) empty.push(`${pack.label} (${dress.size ? 'its own dress' : 'nothing on'})`);
      for (const p of pack.parts) {
        if (p.body && !wanted.has(p.name)) missed.push(`${pack.label}: ${p.name}`);
        // A worn piece above the skin is put on only when asked for.
        if (!p.body && p.occlusionLayer > 0 && wanted.has(p.name) && !dress.has(p.name)) strays.push(`${pack.label}: ${p.name}`);
      }
      const before = new Set(oldRule(pack.parts, dress).map((p) => p.name));
      for (const p of pack.parts) {
        if (p.body && !before.has(p.name)) {
          oldDropped++;
          oldDroppedPacks.add(pack.label);
        }
      }
    }
    bodies += pack.parts.filter((p) => p.body).length;
  }
  // The rule loads every mesh marked `body` by its own definition, so what the packs can be held to is
  // that the converter marks them: a pack with no body mesh at all would be stood up from its layers
  // alone, which is the old rule and the old fault.
  const unmarked = packs.filter((p) => !p.parts.some((q) => q.body)).map((p) => p.label);
  ok(unmarked.length === 0, `every pack marks its own meshes as the body (${bodies} body meshes over ${packs.length} packs), which is what the rule loads${unmarked.length ? `: none marked in ${unmarked.slice(0, 8).join('; ')}` : ''}`);
  // Following from the rule, and kept as a guard on it should it change.
  ok(missed.length === 0 && strays.length === 0, `so every body mesh is loaded dressed and bare, and no worn piece above the skin goes on unasked${missed.length + strays.length ? `: ${[...missed, ...strays].slice(0, 8).join('; ')}` : ''}`);
  ok(empty.length === 0, `no pack stands up with nothing to show${empty.length ? `: ${empty.join('; ')}` : ''}`);
  // What the rule now loads must be there to load: a mesh named and not on disk would throw the spawn
  // the rule has just mended. A part from the wardrobe names its own folder; the pack's own live beside it.
  const absent: string[] = [];
  let files = 0;
  for (const pack of packs) {
    for (const p of partsToLoad(pack.parts, new Set(pack.defaultWear))) {
      if (!p.file || p.dir) continue;
      files++;
      if (!existsSync(join(pack.dir, p.file))) absent.push(`${pack.label}: ${p.file}`);
    }
  }
  ok(files > 0 && absent.length === 0, `every one of the ${files} meshes the packs stand up with is on disk${absent.length ? `: missing ${absent.slice(0, 8).join('; ')}` : ''}`);
  console.log(`     the old rule left out ${oldDropped} body meshes over ${oldDroppedPacks.size} packs: ${[...oldDroppedPacks].slice(0, 12).join(', ')}${oldDroppedPacks.size > 12 ? ', ...' : ''}`);

  // The three whose spawns threw, and two the finding named by face.
  const byLabel = new Map(packs.map((p) => [p.label, p]));
  for (const id of ['gungan_m_02', 'selonian_f', 'selonian_m']) {
    const pack = byLabel.get(`mobiles/${id}`);
    if (!pack) {
      note(`${id} is not converted here`);
      continue;
    }
    const wanted = partsToLoad(pack.parts, new Set(pack.defaultWear));
    const before = oldRule(pack.parts, new Set(pack.defaultWear));
    ok(wanted.length > 0 && wanted.some((p) => p.body), `${id} stands up with its body (${wanted.map((p) => p.name).join(', ')}), where the old rule had ${before.length} mesh${before.length === 1 ? '' : 'es'}`);
  }
  const han = byLabel.get('mobiles/han_solo');
  if (han) {
    const wanted = new Set(partsToLoad(han.parts, new Set(han.defaultWear)).map((p) => p.name));
    ok(wanted.has('han_solo_l0'), 'Han Solo has his head and hands (han_solo_l0, layer -1)');
  } else note('han_solo is not converted here');
  const monF = byLabel.get('characters/moncal_female');
  if (monF) {
    const hands = monF.parts.find((p) => /hands/.test(p.name) && p.body);
    if (hands) ok(partsToLoad(monF.parts, new Set()).includes(hands), `a Mon Calamari woman has her hands (${hands.name}) dressed or not`);
  } else note('moncal_female is not converted here');
}

console.log(`\n${passed} checks passed`);
