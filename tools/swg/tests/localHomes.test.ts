// The houses this machine keeps itself, with no server: kept per world in the browser's own storage and
// shared by every character played on it, as its props are -- the owner's answer -- so a house put down is
// still standing the next time anybody comes back with no server.
//
// What can go wrong is the storage: a reload that loses them, a key handed out twice (a second house filed
// over the first in the streamer), a storage that refuses to be written (a private window), a row in it
// that is not a row. So each is tried against a store of the test's own.
//
// Run: node tools/swg/tests/localHomes.test.ts

import assert from 'node:assert/strict';
import { LOCAL_HOME_PREFIX, LocalHomes, MOVE_SAYS, homesKey, isLocalHome, placeLocalHome, readHome, type HomeStore, type LocalHome, type LocalHomeDeps } from '../../../src/world/myBuildings.ts';
import { propsKey } from '../../../src/world/propsPlaced.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

/** A browser's storage: a map, which can be told to refuse every write or every read. */
function shelf() {
  const kept = new Map<string, string>();
  let refuseWrites = false;
  let refuseReads = false;
  const store: HomeStore = {
    get: (k) => {
      if (refuseReads) throw new Error('no storage');
      return kept.get(k) ?? null;
    },
    set: (k, v) => {
      if (refuseWrites) throw new Error('quota');
      kept.set(k, v);
    },
  };
  return { kept, store, refuseWrites: (on: boolean) => (refuseWrites = on), refuseReads: (on: boolean) => (refuseReads = on) };
}

const house = (key: string, over: Partial<LocalHome> = {}): LocalHome => ({ key, model: 'ply_tato_house_sm_s01_fp1', name: 'Small Tatooine House', x: 100, y: 12.5, z: -40, yaw: 1.2, r: 14, ...over });

{
  ok(homesKey('tatooine') === 'swg.homes.tatooine' && homesKey('tatooine') !== propsKey('tatooine'), "a world's houses are kept under a key of their own, beside its props'");
}

{
  // Put down, then a reload: a fresh list over the same storage has them all.
  const s = shelf();
  const a = new LocalHomes();
  a.enter('tatooine', s.store);
  const k1 = a.mint();
  const k2 = a.mint();
  a.add(house(k1));
  a.add(house(k2, { x: 300, name: 'Another' }));
  ok(s.kept.has(homesKey('tatooine')), 'putting one down writes it into this machine\'s keeping for that world');
  const b = new LocalHomes();
  b.enter('tatooine', s.store);
  ok(b.all.length === 2 && b.find(k1)?.y === 12.5 && b.find(k2)?.name === 'Another', 'a fresh list over the same storage (a reload, or another character on this browser) has them all, as they were');
  ok(b.find(k1)?.r === 14 && b.circles().length === 2 && b.circles()[0].r === 14, 'with the ground each keeps clear of plants, which the arrival hands the ground before it is built');
  ok(b.waiting === 2 && !b.isStanding(k1), 'and none of them stands until the game stands it');
  b.setStanding(k1, true);
  ok(b.isStanding(k1) && b.waiting === 1 && b.standingKeys().join() === k1, 'stood, it is counted standing');
  b.setStanding('local:nothing', true);
  ok(!b.isStanding('local:nothing'), 'and a key it does not hold cannot be marked standing');
  b.remove(k1);
  const c = new LocalHomes();
  c.enter('tatooine', s.store);
  ok(c.all.length === 1 && c.find(k2) !== null && c.find(k1) === null, 'one taken down is gone from the storage too');
  ok(!b.isStanding(k1), 'and no longer counted standing');
  // Another world's are its own.
  const n = new LocalHomes();
  n.enter('naboo', s.store);
  ok(n.all.length === 0, "another world's list is its own");
  n.add(house(n.mint(), { model: 'ply_nboo_house_s01' }));
  const t = new LocalHomes();
  t.enter('tatooine', s.store);
  ok(t.all.length === 1, 'and putting one down there leaves this one\'s alone');
}

{
  // Keys: the moment and a little randomness, so a reload never hands one out again, nor a second list.
  const s = shelf();
  const seen = new Set<string>();
  let clash = false;
  for (let i = 0; i < 4; i++) {
    const h = new LocalHomes();
    h.enter('tatooine', s.store);
    for (let j = 0; j < 50; j++) {
      const k = h.mint();
      if (seen.has(k)) clash = true;
      seen.add(k);
      h.add(house(k, { x: j }));
    }
  }
  ok(!clash && seen.size === 200, 'two hundred keys over four lists of the same world, none handed out twice');
  ok([...seen].every((k) => isLocalHome(k) && k.startsWith(LOCAL_HOME_PREFIX)), 'and every one says it is this machine\'s own');
  // Even at the same moment with the same randomness, a key already on the list is never given again.
  const h = new LocalHomes();
  h.enter('lok', s.store);
  let n = 0;
  const rnd = () => (n++ < 3 ? 0.5 : 0.25);
  const k1 = h.mint(1000, rnd);
  h.add(house(k1));
  const k2 = h.mint(1000, rnd);
  ok(k1 !== k2, 'and even the same moment and the same draw give a key the list has not got');
}

{
  // A storage that will not be written: kept for the session, and said.
  const s = shelf();
  const h = new LocalHomes();
  h.enter('corellia', s.store);
  s.refuseWrites(true);
  const k = h.mint();
  h.add(house(k));
  ok(h.all.length === 1 && h.find(k) !== null, 'a storage that refuses to be written keeps the house for the session');
  ok(h.note.length > 0 && !s.kept.has(homesKey('corellia')), 'and says so, with nothing written');
  s.refuseWrites(false);
  h.add(house(h.mint(), { x: 9 }));
  ok(h.note === '' && JSON.parse(s.kept.get(homesKey('corellia'))!).length === 2, 'and once it takes writes again, both go in');
  // A storage that cannot be read: none, and the world is still one to put one down in.
  s.refuseReads(true);
  const r = new LocalHomes();
  r.enter('corellia', s.store);
  ok(r.all.length === 0 && r.world === 'corellia', 'a storage that cannot be read gives none, and the world is still the world');
}

{
  // What is in the storage is not trusted.
  const s = shelf();
  s.kept.set(homesKey('dantooine'), JSON.stringify([house('local:ok'), { ...house('local:bad'), x: 'far' }, { ...house('h12') }, null, { ...house('local:ok') }, { ...house('local:noname'), name: '' }]));
  const h = new LocalHomes();
  h.enter('dantooine', s.store);
  ok(h.all.length === 2 && h.find('local:ok') !== null && h.find('local:noname')?.name === 'ply_tato_house_sm_s01_fp1', 'a row that is not a house, a server\'s id and a second copy of one are left out; a house with no name is called by its model');
  s.kept.set(homesKey('dantooine'), 'not json');
  const g = new LocalHomes();
  g.enter('dantooine', s.store);
  ok(g.all.length === 0, 'and storage that is not a list at all is none');
  ok(readHome({ ...house('local:x'), r: -3 })?.r === undefined && readHome({ ...house('local:x'), r: 0 })?.r === undefined, 'a ground to keep clear that is nothing is no ground');
}

{
  // Taking them all down ends a run of standing, so a stand still loading lands nowhere.
  const s = shelf();
  const h = new LocalHomes();
  h.enter('tatooine', s.store);
  const k = h.mint();
  h.add(house(k));
  const run = h.beginStand();
  h.setStanding(k, true);
  ok(h.standing(run) && h.isStanding(k), 'a run of standing is in force while it is the last one begun');
  h.endStand();
  ok(!h.standing(run) && !h.isStanding(k) && h.all.length === 1, 'and taken down, none stands, the run is over, and the house is still kept');
  h.enter('tatooine', s.store);
  ok(!h.standing(run) && h.all.length === 1, 'an arrival ends it too, reading the same house back');
  h.clear();
  ok(h.all.length === 0 && h.world === '', 'the select screen lets go of the list, which the next arrival reads again');
  const again = new LocalHomes();
  again.enter('tatooine', s.store);
  ok(again.all.length === 1, 'and the storage still has it');
}

{
  // An arrival is handed the world straight after the last one, with nothing taken down first (`App.arrive` calls
  // `enter` alone): whatever stood went with the world, so none of it may still be counted standing, or the run that
  // stands them again would step over every one.
  const s = shelf();
  const h = new LocalHomes();
  h.enter('tatooine', s.store);
  const k1 = h.mint();
  const k2 = h.mint();
  h.add(house(k1));
  h.add(house(k2, { x: 300 }));
  h.setStanding(k1, true);
  h.setStanding(k2, true);
  const t = h.beginPlace(k1);
  h.enter('tatooine', s.store);
  ok(!h.isStanding(k1) && !h.isStanding(k2) && h.standingKeys().length === 0, 'an arrival back on the same world with nothing taken down first counts none of them standing');
  ok(h.waiting === h.all.length && h.all.length === 2, 'so every one waits to be stood again, and the count says so');
  ok(!h.isPlacing(k1), 'and none of them is going up any more: what was on its way went with the world');
  ok(h.land(k1, t, true, true) === 'down' && !h.isStanding(k1), 'one that lands after the arrival went with the world it went up in: taken down, never counted standing');
}

{
  // A house landing (`App.standLocalHomes`): stood while it is wanted, whichever run began it, and never filed twice.
  const s = shelf();
  const h = new LocalHomes();
  h.enter('tatooine', s.store);
  const k = h.mint();
  h.add(house(k));
  const run = h.beginStand();
  const t1 = h.beginPlace(k);
  ok(h.isPlacing(k), 'a house going up is marked so, and a run steps over it rather than placing its key a second time');
  h.endStand();
  ok(!h.standing(run) && h.isPlacing(k), 'everything taken down while it is on its way ends the run and leaves it on its way');
  h.beginStand();
  ok(h.land(k, t1, true, true) === 'stands' && h.isStanding(k) && !h.isPlacing(k), 'stood again before it lands, it stands as it lands: neither lost nor filed twice');
  h.endStand();
  const t2 = h.beginPlace(k);
  ok(h.land(k, t2, true, false) === 'down' && !h.isStanding(k), 'landing once this machine no longer keeps the houses, it is taken straight back down');
  const t3 = h.beginPlace(k);
  ok(h.land(k, t3, false, true) === 'none' && !h.isPlacing(k), 'one that did not go up asks for nothing');
  const t4 = h.beginPlace(k);
  h.remove(k);
  ok(h.land(k, t4, true, true) === 'down', 'one taken off the list while it was going up comes straight back down');
  // Across an arrival: the next world's own placing of the same key is never taken down by the old one landing.
  const k5 = h.mint();
  h.add(house(k5));
  const old = h.beginPlace(k5);
  h.enter('tatooine', s.store);
  const fresh = h.beginPlace(k5);
  ok(h.land(k5, old, true, true) === 'none' && h.isPlacing(k5), "the old one landing leaves the next world's own on its way alone");
  ok(h.land(k5, fresh, true, true) === 'stands' && h.isStanding(k5), 'which stands as it lands');
  const old2 = h.beginPlace(k5);
  h.enter('tatooine', s.store);
  h.setStanding(k5, true);
  ok(h.land(k5, old2, true, true) === 'none' && h.isStanding(k5), "nor the next world's own standing already");
}

// ---------------------------------------------------------------- a house of this machine's picked up and moved (W7)

{
  // In hand: down on purpose, kept where it stood, and stood by no run until it is put down or back.
  const s = shelf();
  const h = new LocalHomes();
  h.enter('tatooine', s.store);
  const k = h.mint();
  h.add(house(k));
  h.setStanding(k, true);
  ok(!h.lift('local:nothing'), 'a house this list does not keep cannot be taken in hand');
  ok(h.lift(k) && h.inHand(k) && !h.isStanding(k) && h.find(k)?.x === 100, 'taken in hand it no longer counts standing, and is kept where it stood');
  const t = h.beginPlace(k);
  ok(h.land(k, t, true, true) === 'down' && !h.isStanding(k), 'a placing that lands for a house now in hand comes straight back down');
  h.lower(k);
  ok(!h.inHand(k), 'let go of, it is in hand no more');
  h.beginPlace(k);
  ok(!h.lift(k) && !h.inHand(k), 'and one still going up is not taken in hand, or its placing would land it while held');
  const k2 = h.mint();
  h.add(house(k2, { x: 600 }));
  h.lift(k2);
  h.enter('tatooine', s.store);
  ok(!h.inHand(k2), 'an arrival lets go of what was in hand');
  h.lift(k2);
  h.remove(k2);
  ok(!h.inHand(k2), 'and so does taking it off the list');
}

/**
 * A world that stands this machine's houses: it files each one under its key, counts every key filed over a copy
 * already there (the streamer overwrites its map, leaving a copy nothing can take down), and can hold a placing open,
 * refuse the next, stop wanting the houses (a change of keeper) or load again (a new generation).
 */
function world() {
  const filed = new Map<string, { x: number; z: number; yaw: number }>();
  let twice = 0;
  let holding = false;
  const held: (() => void)[] = [];
  let refuse = false;
  const state = { wanted: true, gen: 1 };
  const deps: LocalHomeDeps = {
    place: async (_model, o) => {
      if (holding) {
        holding = false;
        await new Promise<void>((done) => void held.push(done));
      }
      if (refuse) {
        refuse = false;
        return { ok: false, why: 'the ground would not take it', x: 0, y: 0, z: 0, yaw: 0, clear: 0 };
      }
      if (filed.has(o.key)) twice++;
      filed.set(o.key, { x: o.at.x, z: o.at.z, yaw: o.yaw });
      return { ok: true, why: null, x: o.at.x, y: o.y, z: o.at.z, yaw: o.yaw, clear: 15 };
    },
    unplace: (key) => void filed.delete(key),
    wanted: () => state.wanted,
    generation: () => state.gen,
  };
  return {
    deps,
    filed,
    state,
    twice: () => twice,
    holdNext: () => (holding = true),
    release: () => held.shift()?.(),
    refuseNext: () => (refuse = true),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

{
  // Put back, and moved: under its own key, filed once, its row where it stands now only once it has gone up there.
  const s = shelf();
  const h = new LocalHomes();
  h.enter('tatooine', s.store);
  const w = world();
  const k = h.mint();
  h.add(house(k));
  const first = await placeLocalHome(h, h.find(k)!, h.find(k)!, w.deps);
  ok(first.placed && first.fate === 'stands' && h.isStanding(k) && w.filed.size === 1, 'a house stood where it stands is filed once and counts standing');
  ok((await placeLocalHome(h, h.find(k)!, h.find(k)!, w.deps)).fate === 'busy' && w.twice() === 0, 'one already standing is left alone, never filed a second time');
  // Picked up: the game stands the player out and takes it down; then it is let go of and put back.
  h.lift(k);
  w.deps.unplace(k);
  ok((await placeLocalHome(h, h.find(k)!, h.find(k)!, w.deps)).fate === 'busy' && w.filed.size === 0, 'one in hand is left alone too, so nothing stands it under the hand');
  h.lower(k);
  const back = await placeLocalHome(h, h.find(k)!, h.find(k)!, w.deps);
  ok(back.fate === 'stands' && w.filed.get(k)!.x === 100 && h.find(k)!.x === 100, 'put back, it stands where it stood');
  // Moved.
  h.lift(k);
  w.deps.unplace(k);
  h.setStanding(k, false);
  h.lower(k);
  const row = h.find(k)!;
  const moved = await placeLocalHome(h, row, { ...row, x: 400, y: 9, z: -80, yaw: 2 }, w.deps);
  ok(moved.placed && moved.fate === 'stands' && w.filed.get(k)!.x === 400 && w.filed.get(k)!.yaw === 2 && w.filed.size === 1 && w.twice() === 0, 'moved, it goes up where it was put, under the same key, filed once');
  const kept = JSON.parse(s.kept.get(homesKey('tatooine'))!) as LocalHome[];
  ok(h.find(k)!.x === 400 && h.find(k)!.r === 15 && kept.find((r) => r.key === k)!.x === 400 && kept.length === 1, 'and its row says where it stands now, in this machine\'s keeping too, one row still');
}

{
  // A move the world will not take where it was put: the row stays where it stood, and the placer itself puts it back
  // there, through the same tickets -- the very code the game's drop runs, which has no put-back of its own.
  const s = shelf();
  const h = new LocalHomes();
  h.enter('tatooine', s.store);
  const w = world();
  const k = h.mint();
  h.add(house(k));
  w.refuseNext();
  const row = h.find(k)!;
  const no = await placeLocalHome(h, row, { ...row, x: 900 }, w.deps);
  ok(!no.placed && no.fate === 'none' && !!no.why && h.find(k)!.x === 100 && !h.isPlacing(k), 'refused where it was put, its row stays where it stood and nothing is left going up');
  ok(no.back === 'stands' && w.filed.size === 1 && w.filed.get(k)!.x === 100 && h.isStanding(k) && w.twice() === 0, 'and it is stood again where it stood, by the placer itself, filed once');
  // A put-back is not put back again, and one already standing is left alone.
  ok((await placeLocalHome(h, h.find(k)!, h.find(k)!, w.deps)).back === undefined && w.twice() === 0, 'a put-back asks for no put-back of its own');
  // Refused while this machine no longer keeps the player's houses: nothing stood, the row waiting where it stood.
  h.lift(k);
  w.deps.unplace(k);
  h.lower(k);
  w.state.wanted = false;
  w.refuseNext();
  const off = await placeLocalHome(h, h.find(k)!, { ...h.find(k)!, x: 950 }, w.deps);
  ok(!off.placed && off.back === undefined && w.filed.size === 0 && h.find(k)!.x === 100, 'refused once a server keeps the houses, nothing is stood back: it waits where it stood for a game with no server');
}

{
  // Taken down from the Housing tab while its move is still going up (the drop has let go of the hand, so the tab's
  // in-hand guard no longer stops it): it stays taken down. Written where it was moved to before its landing asked
  // whether it was still kept, it came back, was saved again and was counted standing.
  const s = shelf();
  const h = new LocalHomes();
  h.enter('tatooine', s.store);
  const w = world();
  const k = h.mint();
  const other = h.mint();
  h.add(house(k));
  h.add(house(other, { x: 700 }));
  w.holdNext();
  const row = h.find(k)!;
  const going = placeLocalHome(h, row, { ...row, x: 400 }, w.deps);
  await tick();
  // `App.takeDownHome`'s local branch: stood out, taken down, taken off the list.
  w.deps.unplace(k);
  h.remove(k);
  w.release();
  const out = await going;
  const kept = JSON.parse(s.kept.get(homesKey('tatooine'))!) as LocalHome[];
  ok(out.fate === 'down' && !w.filed.has(k) && !h.isStanding(k) && !h.isPlacing(k), 'a house taken down while its move was going up lands and comes straight back down, nothing of it filed');
  ok(h.find(k) === null && !kept.some((r) => r.key === k) && kept.length === 1 && h.all.length === 1, "and it stays off the list and out of this machine's keeping, the other house kept beside it");
  // The same for a move the world refuses: taken down meanwhile, nothing stands it back.
  const k2 = h.mint();
  h.add(house(k2, { x: 50 }));
  w.holdNext();
  w.refuseNext();
  const row2 = h.find(k2)!;
  const going2 = placeLocalHome(h, row2, { ...row2, x: 60 }, w.deps);
  await tick();
  h.remove(k2);
  w.release();
  const out2 = await going2;
  ok(!out2.placed && out2.back === undefined && !w.filed.has(k2) && h.find(k2) === null, 'and a refused move of a house taken down meanwhile is not stood back where it stood');
}

{
  // A move overtaken by a change of keeper (a server takes the player's houses over while it is going up): it lands,
  // comes straight back down, keeps where it was put for a game with no server, and stands there, once, when that comes.
  const s = shelf();
  const h = new LocalHomes();
  h.enter('tatooine', s.store);
  const w = world();
  const k = h.mint();
  const other = h.mint();
  h.add(house(k));
  h.add(house(other, { x: 700 }));
  await placeLocalHome(h, h.find(other)!, h.find(other)!, w.deps);
  w.holdNext();
  const row = h.find(k)!;
  const going = placeLocalHome(h, row, { ...row, x: 250 }, w.deps);
  await tick();
  // The keeper goes to the server: this machine's houses come down (`takeDownLocalHomes`).
  w.state.wanted = false;
  for (const key of h.standingKeys()) w.deps.unplace(key);
  h.endStand();
  w.release();
  const out = await going;
  ok(out.fate === 'down' && w.filed.size === 0 && !h.isStanding(k), 'a move that lands once a server keeps the houses comes straight back down: nothing of this machine\'s stands');
  ok(h.find(k)!.x === 250, 'and keeps where it was put, for a game with no server');
  // And back to this machine: every house stood again, each once.
  w.state.wanted = true;
  for (const r of [...h.all]) await placeLocalHome(h, r, r, w.deps);
  ok(w.filed.size === 2 && w.filed.get(k)!.x === 250 && w.twice() === 0, 'when this machine keeps them again it stands where it was moved to, once, beside the other');
}

{
  // Overtaken there and back while it is still going up (a Disconnect and a Connect inside one model load): the run
  // that stands them again steps over the one on its way, which stands as it lands. One house, filed once.
  const s = shelf();
  const h = new LocalHomes();
  h.enter('tatooine', s.store);
  const w = world();
  const k = h.mint();
  h.add(house(k));
  w.holdNext();
  const row = h.find(k)!;
  const going = placeLocalHome(h, row, { ...row, x: 330 }, w.deps);
  await tick();
  w.state.wanted = false;
  h.endStand();
  w.state.wanted = true;
  h.beginStand();
  const again = await placeLocalHome(h, h.find(k)!, h.find(k)!, w.deps);
  ok(again.fate === 'busy' && w.filed.size === 0, 'the run that stands them again steps over the one still going up');
  w.release();
  const out = await going;
  ok(out.fate === 'stands' && w.filed.size === 1 && w.filed.get(k)!.x === 330 && w.twice() === 0 && h.isStanding(k), 'which stands as it lands, where it was moved to: one house under its key');
}

{
  // A move overtaken by its world loading again (a travel, a reload): it went with that world, and its row in this
  // machine's keeping stays where it stood, for the next visit to stand.
  const s = shelf();
  const h = new LocalHomes();
  h.enter('tatooine', s.store);
  const w = world();
  const k = h.mint();
  h.add(house(k));
  w.holdNext();
  const row = h.find(k)!;
  const going = placeLocalHome(h, row, { ...row, x: 480 }, w.deps);
  await tick();
  w.state.gen++;
  h.enter('tatooine', s.store);
  w.release();
  const out = await going;
  ok(out.fate === 'gone' && out.why === MOVE_SAYS.world && !out.placed, 'a move whose world loaded again in the wait went with that world');
  const kept = JSON.parse(s.kept.get(homesKey('tatooine'))!) as LocalHome[];
  ok(h.find(k)!.x === 100 && kept[0].x === 100 && !h.isPlacing(k) && !h.isStanding(k), 'and its row stays where it stood, in the list and in this machine\'s keeping');
}

console.log(`\n${passed} checks passed`);
