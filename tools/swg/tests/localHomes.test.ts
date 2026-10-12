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
import { LOCAL_HOME_PREFIX, LocalHomes, homesKey, isLocalHome, readHome, type HomeStore, type LocalHome } from '../../../src/world/myBuildings.ts';
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

console.log(`\n${passed} checks passed`);
