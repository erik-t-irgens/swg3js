// The hand-overs of the interior layout files' wave that only the game makes, pinned as text (the world, the app, the
// garage, the ship's rooms, the editor and the people pass build none of them in node, and every behaviour test makes its
// own): a world reads its pack's file and stands its pieces through the streamer, a permanent building stands its file's
// furniture beside it and takes it down with it, the editor writes `furnish: false` with its switch off and makes a picked
// piece's building's furniture its own, the YT-1300's furniture is hung in its rooms with its seats passable, a post inside
// a solid piece is asked once and waits while it cannot be answered, and `aimAt` names a piece's key.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
/** Whether `text` holds every line of `lines`, each once, in this order. */
const inOrder = (text: string, lines: string[]) => {
  let at = 0;
  for (const l of lines) {
    const i = text.indexOf(l, at);
    if (i < 0 || text.indexOf(l, i + 1) >= 0) return false;
    at = i + l.length;
  }
  return true;
};

const world = read('src/world/world.ts');
ok(inOrder(world, ['const file = await pack.loadInteriors();', 'const made = furnishLayout(layout.objects, file);', 'streamLayout = { ...layout, objects: [...layout.objects, ...made.objects] };']), "a world reads its pack's interior layout table and appends its pieces after every object of its layout");
ok(world.includes('new LayoutStreamer(this.scene, this.physics, pack, streamLayout ?? layout, this.particles') && world.includes("...(furnitureGuests ? { guests: furnitureGuests } : {})"), 'and hands the streamer that layout, with the props folder standing behind it');
ok(world.includes('clearPost: (st) => (POST_CLEAR_TUNE.on && this.interiorsFile ? (this.layoutStream?.clearPost(st) ?? false) : false),'), 'the people pass asks the streamer whether a post stands inside a piece');
ok(world.includes('this.releaseGuest(this.furniturePack);'), "the furniture pack is let go with the world, as every guest is");
ok(inOrder(world, ["this.furniturePack = AssetPack.from({ planet: 'interiors', categories: { interiors: [...file.defs] } }, `${import.meta.env.BASE_URL}assets-private/props/`);", 'furnitureGuests = [this.furniturePack];']), "the pack over the props folder holds the file's defs and is the streamer's guest from its making");

const stream = read('src/world/layoutStream.ts');
ok(stream.includes('if (o.ilf) p.ilf = o.ilf;') && stream.includes('if (o.solid !== undefined) p.solid = o.solid;'), "the streamer files a piece's key and its own word on being solid");
ok(stream.includes('radius: row.radius ?? radiusOfBounds(bounds),'), 'a permanent stand files at its own radius where it carries one');

const people = read('src/world/standingPeople.ts');
ok(inOrder(people, ["if (inside && deps.clearPost && !this.postAsked[i] && !r.sit && !/sitting/i.test(r.mood ?? '')) {", 'const moved = deps.clearPost(st);', 'if (moved === null) {', 'this.postAsked[i] = 1;', 'this.last.cleared++;', 'first.x = st.x;']), 'a post is asked once, with its room built, never a seated one, and waits while the answer must wait; a patroller moved clear moves its round\'s first point with it (the behaviour is held by interiors.test, on the real class)');

const main = read('src/main.ts');
ok(main.includes("return row.kind === 'building' ? this.furnishDressing(row, g, key, answer) : answer;"), 'a permanent building stands its template furniture beside it');
ok(inOrder(main, ['this.standOutOf(key);\n      // Its template\'s furniture first', 'this.unfurnish(key);\n      this.world.unplaceBuilding(key);']), 'and takes it down first when it goes');
ok(main.includes('const pieces = this.furnitureKeysOf(keys);\n      this.world.unplaceMany(pieces.length ? [...pieces, ...keys] : keys);'), "a sync's removals take the furniture down before the buildings");
ok(main.includes('if (!answer || row.furnish === false) return answer;'), 'a row that says `furnish: false` stands none');
ok(main.includes("if (row.kind !== 'building' || row.deed || !row.template || !row.model) return null;"), "a deed's house, and a row with no template, stand none");
ok(inOrder(main, ['this.furnished.clear();\n    // The centre rows are written about', 'this.permanent.enter(pack, centre, kind, gen);']), "what the last world's buildings stood is forgotten at an arrival");
ok(main.includes('if (!this.packInteriors.has(pack)) this.packInteriors.set(pack, await pack.loadInteriors());'), 'the tables are read before a sync stands anything');
ok(main.includes('ownFurniture: (id) => this.ownFurnitureRows(id),') && main.includes('furnitureNote: (id) => this.furnitureNote(id),') && main.includes('hostedRows: (key) => this.hostedRowIds(key),'), 'the editor is handed the make-own, the furniture words and what a building carries');
ok(main.includes('return carriedRowIds({ id: b.row.id, key, layer: b.layer }, rows, (x, y, z) => s.hostKeyAt(x, y, z));'), "what a building carries is `carriedRowIds` over every permanent row standing, by the streamer's own rule (`hostKeyAt`)");
ok(main.includes('const s = pieceStand(p, key, row);') && main.includes("const a = this.world.standPlacement(s, p.from === 'own' ? got.pack : fp);"), "a permanent building's pieces are stood as `pieceStand` says, out of the building's pack or the furniture pack");
ok(main.includes('const got = pieceRow(p, had.row, ctx);'), 'and made rows of its own as `pieceRow` says');
ok(main.includes('...(placed.o.ilf ? { piece: placed.o.ilf } : {})'), '`aimAt` names a piece by its key');

const garage = read('src/vehicles/garage.ts');
ok(garage.includes('if (def.furniture?.length) unresolved.push(...(await this.hangFurniture(def, model)));'), "a ship's own furniture is hung as it is assembled, before it is framed and prepared");
ok(inOrder(garage, ['placeFurniture(node, f);', 'if (furniturePassable(f)) {', 'model.add(node);', 'room.attach(node);']), "each piece stood by `placeFurniture`, a seat made passable by `furniturePassable`, and moved under its room's node");
const cli = read('tools/swg/cli.mjs');
ok(cli.includes('out.push({ file: got.file, template: n.template, cell, ...IL.hullFurniturePlace(n.m) });'), "the ships command writes a piece's place and turn as `hullFurniturePlace` says");
ok(cli.includes('const piecesOf = (file, def, defs, usedDefs) => IL.interiorPieces(files.get(file) ?? [], def, defs, usedDefs, { kindOf, propOf, leave });') && cli.includes('const { row: written, twice, states } = IL.buildingRow(b, o, t, contained.get(b.row), fittings, layout.states);'), "the interiors pass writes each template's pieces and each building's row by the rules its test runs");
ok(read('tools/swg/finalnames.mjs').includes("{ command: 'interiors', files: ['<world>/interiors.json', 'gallery/interiors.json'], ask: 'interiors <swg-dir> <out> --retail-only' },"), "the gallery's table is held to SOE's final names list as every world's is (the furniture every gallery building the editor puts down stands)");
ok(read('tools/swg/soundplaces.mjs').includes('const loopOf = soundOf ?? ((t) => ambientOf(vfs, clientData(t), ambientCache));'), "the sounds pass reads a piece's own loop out of the archives where no test hands one in");
ok(garage.includes("...(sh.furniture?.length ? { furniture: sh.furniture.map((f) => ({ ...f, file: `assets-private/ships/${f.file}` })) } : {}),"), "and read off the ships pack's manifest");
ok(read('src/vehicles/interior.ts').includes('if (m.isMesh && !m.userData.passableFurniture) meshes.push(m);'), "a seat of a ship's furniture is no collider of its rooms");

const entry = read('src/editor/editorEntry.ts');
ok(entry.includes('const src = hand.building && !EDITOR_TUNE.furnish ? { ...hand.src, furnish: false as const } : hand.src;'), 'a building put down with the switch off is written empty');
ok(read('src/editor/editorBrush.ts').includes('const src = s.building && !EDITOR_TUNE.furnish ? { ...s.src, furnish: false as const } : s.src;'), 'and one the brush paints');
ok(entry.includes('ownPiece: (id, shift) => me.ownPieceAsked(id, shift),'), 'a click on a piece reaches the make-own');
ok(inOrder(entry, ["{ file: b.layer, id: b.row.id, before: b.row, after: { ...rest, furnish: false } as PlacementRow },", "const work = () => this.edits.putRows('make its furniture its own', changes);", 'said = got.fresh && h.curtain ? await h.curtain('], ), "the make-own is one action: the building's row empty and its pieces its own, behind the curtain where anything is new");
const edit = read('src/editor/editorEdit.ts');
ok(edit.includes('if (hov && ed.ownPiece?.(hov, shift)) ed.refreshWindow();\n      else if (this.sel.click(hov, shift)) ed.refreshWindow();'), "the editing hands a click on a piece to the make-own before the selection");
ok(edit.includes('const own = ownFurniture(this.sel.ids, ed);') && edit.includes('const rows = withOwnFurniture(ids, this.ed).map((id) => this.ed.rowFor(id))') && edit.includes('return this.deleteRows(this.sel.ids, force, prefix, true);'), 'a building whose furniture is its own carries its rows when moved and takes them when deleted (the behaviour is interiorsEdit.test\'s)');
ok(entry.includes('hostedRows: (key) => host.hostedRows?.(key) ?? [],'), "the editing asks the game's own `hostedRows`");
ok(inOrder(entry, ['async remove(id: string, layer: PlacementLayer): Promise<string> {', 'if (this.edits.carries(id) > 0) {', 'const said = await this.edits.deleteRows([id], false);', 'const before = this.host.rowFor(id);']), 'Delete on the aim and the Here tab take such a building out with its rows, through the selection\'s own delete');
ok(inOrder(entry, ['async pickUp(id: string): Promise<string | null> {', 'const carried = this.edits.carries(id);', 'if (carried > 0) return this.refuse(']), 'and O refuses it in words, since the hand holds one row and would leave its rows behind');

console.log(`\n${checks} checks passed`);
