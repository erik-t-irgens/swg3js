// One dock, one ship: the places two players can both want, and who really has each of them.
//
// Both halves are driven here -- the server's table (server/spots.mjs) and the browser's claims
// (`LaneClaims` in src/space/dockingMath.ts, through `Docking`) -- because the whole point of the
// pair is that they cannot disagree: a lane flown on this browser's own answer is given back the
// moment the server's says it was somebody else's, and a ship is never left sitting in a lane it does
// not hold. Synthetic lanes of round numbers, synthetic hulls, no sockets and no clock but the ones
// handed in, so every case can be stepped by hand.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Docking } from '../../../src/space/docking.ts';
import { LaneClaims, SPOT_TUNE, type DockLaneLike, type LaneStepLike, type SpotKind } from '../../../src/space/dockingMath.ts';
import { SPOT_TUNING, Spots, cleanSpot, mayClaim } from '../../../server/spots.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type Tell = { to: number; msg: any };
type Result = { ok: boolean; why?: string; tell: Tell[]; freed?: number };

// --- the shapes the browser's side is driven with ---------------------------------------------------

const yaw = (deg: number): [number, number, number, number] => {
  const h = (deg * Math.PI) / 360;
  return [Math.cos(h), 0, Math.sin(h), 0];
};

const point = (n: number, at: [number, number, number], q: [number, number, number, number], dock: [number, number, number]): LaneStepLike => ({
  n,
  at,
  q,
  forward: [0, 0, 1],
  fromDock: Math.hypot(at[0] - dock[0], at[1] - dock[1], at[2] - dock[2]),
});

/** A zone with one hull in it, one lane, and nothing else: only what docking reads of a world. */
function zone() {
  const dockAt: [number, number, number] = [50, 0, 0];
  const west = yaw(-90);
  const lane: DockLaneLike = {
    lane: 'a',
    dock: { at: dockAt, q: west, forward: [-1, 0, 0] },
    dockRadius: 25,
    approach: [point(1, [120, 0, 0], west, dockAt), point(2, [300, 0, 40], west, dockAt), point(3, [520, 0, 90], west, dockAt)],
    exit: [point(1, [120, 0, -60], west, dockAt)],
  };
  const hull = { model: 'a_hull', template: 'a_hull', x: 2000, y: 0, z: 0, q: new THREE.Quaternion(), radius: 120, contained: false, tier: 0 };
  return {
    planet: { space: 'a system' },
    spaceData: {
      version: 3,
      stations: [{ name: 'test', title: 'Test Station', model: 'a_hull', x: -2000, y: 0, z: 0, radius: 120 }],
      scenery: [],
      lanes: { a_hull: { lanes: [lane], drydocks: [], bays: [] } },
      dockEffects: {},
    },
    placedObjects: [hull],
    vehicles: [] as unknown[],
    physics: null,
    dockEffect: () => true,
  };
}

/** A hull with only what docking reads of one, holding wherever it is put. */
function hullShip(id: string, x: number, z: number) {
  const attitude = new THREE.Quaternion();
  const ship = {
    spec: { id, label: id, ship: true, bounds: { min: [-5, -2, -8], max: [5, 2, 8] } },
    pos: new THREE.Vector3(x, 0, z),
    radius: 10,
    /** The clamp reads it (a clamp is a manoeuvre, not a collision); the station's lanes do not. */
    speed: 0,
    disposed: false,
    holding: false,
    ghosted: false,
    held: false,
    landed: false,
    autopilot: null,
    combat: { repair: () => {} },
    quaternion: (out: THREE.Quaternion) => out.copy(attitude),
    hold: (frame: THREE.Matrix4 | null, p: THREE.Vector3) => {
      ship.holding = true;
      ship.pos.copy(p);
      if (frame) ship.pos.applyMatrix4(frame);
    },
    release: () => void (ship.holding = false),
    setGhost: (on: boolean) => void (ship.ghosted = on),
  };
  return ship;
}

/**
 * The other players as a clamp reads them: one hull standing still, big enough to carry a fighter
 * (twice its longest side), with a picture and no colliders -- which is what a peer's ship is.
 */
function peerHull(id: number, at: THREE.Vector3) {
  return {
    shipPeers: (out: number[]) => {
      out.length = 0;
      out.push(id);
      return out;
    },
    vehiclePose: (who: number, pos: THREE.Vector3, quat: THREE.Quaternion, vel: THREE.Vector3) => {
      if (who !== id) return false;
      pos.copy(at);
      quat.identity();
      vel.set(0, 0, 0);
      return true;
    },
    vehicleOf: (who: number) => (who === id ? { label: 'a big hull', bounds: { min: [-40, -10, -60], max: [40, 10, 60] }, radius: 60 } : null),
    peerName: (who: number) => `player ${who}`,
  };
}

/** The way to one other player, writing down every word instead of sending it. */
function clampLink(id: number, said: { to: number; word: string }[]) {
  return { id: () => id, send: (to: number, word: string) => void said.push({ to, word }) };
}

/**
 * A server with its own postbox, and the browsers it answers. Everything a claim does goes through
 * it, so what each browser believes is only ever what it was really told.
 */
function world(tuning: Record<string, number> = {}) {
  let t = 100000;
  const spots = new Spots({ now: () => t, tuning: { ...SPOT_TUNING, ...tuning } });
  const inbox = new Map<number, any[]>();
  const post = (r: Result) => {
    for (const line of r.tell ?? []) inbox.set(line.to, [...(inbox.get(line.to) ?? []), line.msg]);
    return r;
  };
  return {
    spots,
    post,
    to: (session: number) => inbox.get(session) ?? [],
    clear: () => inbox.clear(),
    wait: (ms: number) => void (t += ms),
  };
}

/**
 * One browser, with its docking wired to that server: what it sends goes straight in, and what comes
 * back for it is handed to `spotAnswer` when the test says so, which is how a message in flight is
 * held and two browsers raced.
 */
function browser(w: ReturnType<typeof world>, session: number, where = 'a system') {
  const d = new Docking(zone() as never);
  const said: string[] = [];
  d.onNote = (text) => said.push(text);
  const sent: { kind: SpotKind; what: string; take: boolean }[] = [];
  d.spotLink = {
    active: () => true,
    send: (kind, what, take) => {
      sent.push({ kind, what, take });
      w.post((take ? w.spots.take(session, where, kind, what) : w.spots.free(session, where, kind, what)) as Result);
    },
  };
  return {
    docking: d,
    said,
    sent,
    /**
     * Hand this browser every answer waiting for it, which is what the socket would do -- with the
     * kind the server answered about, since that is half of the key it holds the spot under.
     */
    deliver() {
      const mine = w.to(session);
      for (const msg of mine) if (msg.t === 'spot') d.spotAnswer(String(msg.what), msg.granted === 1, String(msg.why ?? ''), msg.kind as SpotKind);
      mine.length = 0;
    },
  };
}

// --- 1: what a browser may send ---------------------------------------------------------------------
{
  const take = cleanSpot({ t: 'claimSpot', do: 'take', kind: 'dock', what: 'a_hull@2000,0,0|a' });
  ok(take?.do === 'take' && take.kind === 'dock' && take.what === 'a_hull@2000,0,0|a', '1: asking for a place names what kind it is and which one');
  ok(cleanSpot({ t: 'claimSpot', do: 'free', kind: 'carrier', what: 'carrier|7' })?.do === 'free', '1: and giving one back is the same word the other way round');
  ok(cleanSpot({ t: 'claimSpot', do: 'steal', kind: 'dock', what: 'x' }) === undefined, '1: a word nobody knows is dropped');
  ok(cleanSpot({ t: 'claimSpot', do: 'take', kind: 'planet', what: 'x' }) === undefined, '1: a kind of place this server does not hold is dropped');
  ok(cleanSpot({ t: 'claimSpot', do: 'take', kind: 'dock', what: '__proto__' }) === undefined, '1: and a name that means something to every object in the language is not a name');
  ok(cleanSpot({ t: 'claimSpot', do: 'take', kind: 'dock', what: 'x'.repeat(200) }) === undefined && cleanSpot({ t: 'claimSpot', do: 'take', kind: 'dock', what: 'a b' }) === undefined, '1: a name far longer than any key, and one with a space in it, are dropped whole');
  ok(cleanSpot(null) === undefined && cleanSpot([1] as unknown as object) === undefined, '1: nothing at all and a list are not claim messages');
  const window = { at: 0, lines: 0 };
  let through = 0;
  for (let i = 0; i < 20; i++) if (mayClaim(window, 5000)) through++;
  ok(through === SPOT_TUNING.perSecond, `1: one browser may send ${SPOT_TUNING.perSecond} claim words in a second and the rest are dropped`);
  ok(mayClaim(window, 6000) === true, '1: and the next second starts the count again');
}

// --- 2: the server holds one dock for one ship -------------------------------------------------------
{
  const w = world();
  const lane = 'a_hull@2000,0,0|a';
  const first = w.post(w.spots.take(1, 'a system', 'dock', lane) as Result);
  const second = w.post(w.spots.take(2, 'a system', 'dock', lane) as Result);
  ok(first.ok && w.to(1)[0].granted === 1, '2: the first browser to ask for a dock is granted it');
  ok(!second.ok && w.to(2)[0].granted === 0 && typeof w.to(2)[0].why === 'string', `2: the second is refused, in words (${w.to(2)[0].why})`);
  ok(w.spots.holderOf('a system', 'dock', lane) === 1, '2: and the dock is still the first one’s');
  w.clear();
  w.post(w.spots.take(1, 'a system', 'dock', lane) as Result);
  ok(w.to(1)[0].granted === 1 && w.spots.describe().held === 1, '2: asking again for what you hold is granted rather than refused, so a lost answer can be asked for again');
  // The same name in another world is another place: two zones may have the same hull at the same metres.
  ok(w.post(w.spots.take(2, 'another system', 'dock', lane) as Result).ok, '2: the same name on another world is another place');
  ok(w.spots.free(2, 'another system', 'dock', lane).ok && w.spots.holderOf('another system', 'dock', lane) === 0, '2: given back, it is free again');
  ok(!w.spots.free(2, 'a system', 'dock', lane).ok && w.spots.holderOf('a system', 'dock', lane) === 1, '2: and nobody can give back a place that is not theirs');
}

// --- 3: a line that drops gives back everything it held ----------------------------------------------
{
  const w = world();
  const lane = 'a_hull@2000,0,0|a';
  w.post(w.spots.take(1, 'a system', 'dock', lane) as Result);
  w.post(w.spots.take(1, 'a system', 'carrier', 'carrier|9') as Result);
  ok(w.spots.heldBy(1) === 2, '3: a browser holds what it has asked for');
  const dropped = w.spots.gone(1) as Result;
  ok(dropped.freed === 2 && w.spots.describe().held === 0, '3: a line closing gives every one of them back at once');
  ok(w.post(w.spots.take(2, 'a system', 'dock', lane) as Result).ok, '3: so the next ship to ask for that dock has it');
  // A browser that travels gives back what it held where it was, and nothing it holds where it has gone.
  w.post(w.spots.take(2, 'another system', 'dock', lane) as Result);
  const left = w.spots.left(2, 'a system') as Result;
  ok(left.freed === 1 && w.spots.holderOf('a system', 'dock', lane) === 0 && w.spots.holderOf('another system', 'dock', lane) === 2, '3: and a travel gives back the world it left, not the one it arrived on');
}

// --- 4: one browser may not hold every place there is ------------------------------------------------
{
  const w = world({ held: 2 });
  ok(w.spots.take(1, 'a system', 'dock', 'one').ok && w.spots.take(1, 'a system', 'dock', 'two').ok, '4: a browser holds what its own ship needs');
  const over = w.post(w.spots.take(1, 'a system', 'dock', 'three') as Result);
  ok(!over.ok && String(w.to(1).pop().why).includes('as many places'), '4: and is refused past that, so nothing can hold a station shut by naming every lane in it');
}

// --- 5: playing alone, nothing is asked and nothing changes ------------------------------------------
{
  const d = new Docking(zone() as never);
  const ship = hullShip('one', 2000 + 560, 120);
  const said = d.dock(ship as never);
  ok(d.report().phase === 'approach' && said.startsWith('flying lane'), `5: a dock with no server behind it starts exactly as it did (${said})`);
  ok(d.claims.count === 1 && d.claims.pending === 0, '5: the lane is held outright, with nothing waiting on anybody');
  const spots = d.report().spots as Record<string, number | string>;
  ok(spots.link === 'none' && spots.asked === 0 && spots.pending === 0, '5: nothing was ever asked, which is what says docking alone is untouched');
  // The claims' own clock runs on the step's seconds, and with nothing pending it changes nothing.
  for (let i = 0; i < 600; i++) d.step(ship as never, 1 / 60, null);
  ok(d.claims.count === 1 && (d.report().spots as Record<string, number>).timedOut === 0, '5: and ten seconds of stepping neither times anything out nor gives the lane back');
  d.breakOff('by hand');
  ok(d.claims.count === 0 && d.claims.holder('a_hull@2000,0,0|a') === null, '5: breaking off gives the lane back as it always did');
}

// --- 6: the claim itself: asked, granted, refused, and never answered ---------------------------------
{
  const claims = new LaneClaims();
  const key = LaneClaims.key('station', 'a');
  const asked: string[] = [];
  const given: string[] = [];
  let lost = '';
  claims.ask = (kind, what) => {
    asked.push(`${kind}:${what}`);
    return true;
  };
  claims.give = (kind, what) => void given.push(`${kind}:${what}`);
  claims.onLost = (what, by, why) => void (lost = `${what}|${by}|${why}`);

  ok(claims.claim(key, 'one', 'dock') && claims.asking(key) && asked.join() === 'dock:station|a', '6: a claim goes out and is granted here while it is on its way');
  ok(claims.count === 1 && claims.pending === 1 && !claims.free(key, 'two'), '6: the lane reads as this browser’s meanwhile, so nothing else here takes it');
  ok(claims.answer(key, true) && !claims.asking(key) && claims.count === 1, '6: the answer settles it');
  ok(claims.answer(key, false) === false, '6: and an answer to a question nobody is waiting on any more moves nothing');
  claims.release('one');
  ok(claims.count === 0 && given.join() === 'dock:station|a', '6: released, the server is told it is free');

  // Refused: the caller is told, and the lane is somebody else's until it is worth asking again.
  claims.claim(key, 'one', 'dock');
  ok(claims.answer(key, false, 'another ship took that dock first'), '6: a refusal is an answer too');
  ok(lost === `${key}|one|another ship took that dock first` && claims.count === 0, '6: whoever asked is told in the server’s own words, and holds nothing');
  ok(!claims.free(key, 'one') && claims.holder(key) === 'elsewhere', '6: the lane is theirs, so the next press is offered another one rather than the same refusal');
  ok(claims.claim(key, 'one', 'dock') === false, '6: and asking for it again is refused here, without a word going out');
  claims.tick(SPOT_TUNE.forget + 1);
  ok(claims.holder(key) === null && claims.claim(key, 'one', 'dock'), '6: once that has worn off it is asked for again, since the server is the only place the truth is');

  // An answer that never comes: the local answer stands, which is the answer with no server at all.
  const quiet = new LaneClaims();
  quiet.ask = () => true;
  quiet.claim(key, 'one', 'dock');
  ok(quiet.pending === 1, '6: a question with nothing coming back is still pending');
  quiet.tick(SPOT_TUNE.wait / 2);
  ok(quiet.pending === 1, '6: and stays so while the wait runs');
  quiet.tick(SPOT_TUNE.wait);
  ok(quiet.pending === 0 && quiet.count === 1 && quiet.stats().timedOut === 1, '6: past it the claim stands on this browser’s own answer rather than hanging');

  // And the wait stops the waiting, never the hearing. A round trip slower than it, or one message
  // lost and asked for again, must still end with the hull off a lane the server gave to somebody
  // else: were a late word dropped, the claim would stand for as long as the pilot flew it and
  // nothing on either side would ever say so.
  let slowLost = '';
  quiet.onLost = (what, by, why) => void (slowLost = `${what}|${by}|${why}`);
  ok(quiet.answer(key, false, 'another ship took that dock first') === true, '6: a refusal that arrives after the wait has run out is still the server’s word, and is still acted on');
  ok(slowLost === `${key}|one|another ship took that dock first` && quiet.count === 0 && quiet.holder(key) === 'elsewhere', '6: so the lane goes back and whoever asked is told, however slow the line was');
  ok(quiet.stats().late === 1 && quiet.stats().refused === 1, '6: counted as late, which is what says the wait is shorter than this line’s round trip');
  ok(quiet.answer(key, true) === false, '6: and a second word about the same claim moves nothing');

  // A grant is the same the other way round: late, it settles the claim rather than being dropped.
  const lateGrant = new LaneClaims();
  lateGrant.ask = () => true;
  lateGrant.claim(key, 'one', 'dock');
  lateGrant.tick(SPOT_TUNE.wait + 1);
  ok(lateGrant.answer(key, true) === true && lateGrant.count === 1 && lateGrant.stats().late === 1 && lateGrant.stats().granted === 1, '6: a grant that comes late settles the claim it was always about');

  // The kind is half the key the server holds a spot under, so an answer has to name it. Today's two
  // build names that cannot run into one another; that is two key builders agreeing by accident.
  const kinds = new LaneClaims();
  kinds.ask = () => true;
  kinds.claim(key, 'one', 'dock');
  ok(kinds.answer(key, false, 'no', 'carrier') === false && kinds.count === 1, '6: a word about another kind of place is not a word about this one');
  ok(kinds.answer(key, false, 'no', 'dock') === true && kinds.count === 0, '6: and the one that names this kind is');

  // Nothing can be answering a question that never went out: playing alone, a claim is this
  // browser's own and a `spot` word arriving from anywhere would be a word about nothing.
  const alone = new LaneClaims();
  ok(alone.claim(key, 'one', 'dock') && alone.answer(key, false, 'no') === false && alone.count === 1, '6: a claim made with no server behind it is answered by nobody');
}

// --- 7: two players flying at one dock ----------------------------------------------------------------
{
  const w = world();
  const one = browser(w, 1);
  const two = browser(w, 2);
  const shipOne = hullShip('one', 2000 + 560, 120);
  const shipTwo = hullShip('two', 2000 + 540, -120);

  const saidOne = one.docking.dock(shipOne as never);
  const saidTwo = two.docking.dock(shipTwo as never);
  ok(one.docking.report().phase === 'approach' && two.docking.report().phase === 'approach', '7: both ships start down the lane, because each has its own answer while the server’s is on its way');
  ok(saidOne.endsWith('asking for it') && saidTwo.endsWith('asking for it'), `7: and both rows say the lane is being asked for (${saidOne})`);
  ok(one.sent.length === 1 && two.sent.length === 1 && one.sent[0].what === two.sent[0].what, '7: they asked for the very same lane');

  one.deliver();
  two.deliver();
  ok(one.docking.report().phase === 'approach' && one.docking.claims.pending === 0, '7: the one that asked first keeps it and flies on');
  ok(two.docking.report().phase === 'idle', '7: the one that lost the race is off the lane at once');
  ok(two.said.length === 1 && two.said[0].includes('dock'), `7: told in words rather than left wondering (${two.said[0]})`);
  ok(!shipTwo.holding && !shipTwo.ghosted, '7: and its hull is its pilot’s again, held by nothing');
  ok(two.docking.claims.count === 0, '7: it holds no lane');
  ok(w.spots.holderOf('a system', 'dock', one.sent[0].what) === 1, '7: the server still says the lane is the first one’s');

  // The loser presses again while the winner is still on it: refused here, with nothing sent.
  const sentWas = two.sent.length;
  const again = two.docking.dock(shipTwo as never);
  ok(two.docking.report().phase === 'idle' && two.sent.length === sentWas, `7: pressing again while it is theirs asks nobody anything (${again})`);

  // The winner breaks off: the server is told, and the next ship to ask has it.
  one.docking.breakOff('by hand');
  ok(one.sent.length === 2 && one.sent[1].take === false, '7: breaking off gives the lane back to the server as well as to itself');
  ok(w.spots.holderOf('a system', 'dock', one.sent[0].what) === 0, '7: which leaves it free');
  two.docking.claims.tick(SPOT_TUNE.forget + 1);
  two.docking.dock(shipTwo as never);
  two.deliver();
  ok(two.docking.report().phase === 'approach' && two.docking.claims.pending === 0, '7: and the ship that lost the first race wins the second');
}

// --- 8: a refusal that arrives during the approach -----------------------------------------------------
{
  const w = world();
  const one = browser(w, 1);
  const two = browser(w, 2);
  const shipOne = hullShip('one', 2000 + 560, 120);
  const shipTwo = hullShip('two', 2000 + 540, -120);
  one.docking.dock(shipOne as never);
  two.docking.dock(shipTwo as never);
  one.deliver();
  // The loser's answer is held back **past `SPOT_TUNE.wait`**, which is the case this section is
  // named for and the one that matters: a round trip slower than three seconds, or one message lost
  // and asked for again, is an ordinary thing on an ordinary line. Held for less than the wait, the
  // only path exercised is the one that was never in doubt.
  const dt = 1 / 60;
  const want = Math.ceil((SPOT_TUNE.wait + 1) / dt);
  let steps = 0;
  const nose = new THREE.Vector3();
  while (steps < want && two.docking.report().phase === 'approach') {
    const drive = two.docking.step(shipTwo as never, dt, null);
    if (drive) {
      nose.set(0, 0, 1);
      shipTwo.pos.addScaledVector(nose, (drive.cruise ?? 0) * dt);
    }
    steps++;
  }
  ok(two.docking.report().phase === 'approach' && steps === want, `8: ${(want * dt).toFixed(1)} s of flying with no answer yet carries on down the lane`);
  const waited = two.docking.report().spots as Record<string, number>;
  ok(two.docking.claims.pending === 0 && waited.timedOut === 1, '8: and past the wait the claim stands on this browser’s own answer, so nothing hangs');
  ok(two.docking.claims.count === 1 && two.docking.claims.holder(two.sent[0].what) !== null, '8: the lane still reads as this browser’s, which is the state the refusal has to be able to undo');
  two.deliver();
  ok(two.docking.report().phase === 'idle' && String(two.docking.report().note).length > 0, `8: the refusal breaks the approach off where the ship stands, however late it came (${two.docking.report().note})`);
  ok(!shipTwo.holding && !shipTwo.ghosted && two.docking.claims.count === 0, '8: nothing holds the hull and nothing holds a lane: never a hang, and never a ship in a lane it does not have');
  ok(two.said.length === 1 && two.said[0].length > 0, `8: and the pilot reads it in words rather than flying on (${two.said[0]})`);
  const stats = two.docking.report().spots as Record<string, number>;
  ok(stats.refused === 1 && stats.granted === 0 && stats.timedOut === 1 && stats.late === 1, '8: the count says exactly what happened: asked, not answered in time, flown on, and then refused late');
  // The server never wavered: the lane was the first browser's from the moment it asked.
  ok(w.spots.holderOf('a system', 'dock', two.sent[0].what) === 1, '8: and the lane was the other ship’s the whole time');
}

// --- 9: one ship to a hull's back, driven through the press itself -------------------------------------
//
// Not `claims.claim` by hand: `ShipClamp.dock`, the step, the two pilots' own words and `spotLost`,
// because the claim's whole worth here is the order it happens in. The hull is another player's, so
// both asking browsers name the spot the same way -- by the connection of whoever flies it -- with
// nothing sent between them about what it is called.
{
  const w = world();
  const one = browser(w, 1);
  const two = browser(w, 2);
  const carrier = new THREE.Vector3(0, 0, 0);
  const oneSaid: { to: number; word: string }[] = [];
  const twoSaid: { to: number; word: string }[] = [];
  one.docking.clamp.peers = peerHull(7, carrier) as never;
  one.docking.clamp.link = clampLink(1, oneSaid) as never;
  two.docking.clamp.peers = peerHull(7, carrier) as never;
  two.docking.clamp.link = clampLink(2, twoSaid) as never;
  const shipOne = hullShip('one', 0, 80);
  const shipTwo = hullShip('two', 0, -80);
  const spot = LaneClaims.key('carrier', '7');
  const dt = 1 / 60;

  const askedOne = one.docking.clamp.dock(shipOne as never);
  two.docking.clamp.dock(shipTwo as never);
  ok(one.sent.length === 1 && one.sent[0].kind === 'carrier' && one.sent[0].what === spot, '9: the press claims the spot on that hull’s back first of all');
  ok(oneSaid.length === 0 && twoSaid.length === 0 && askedOne.includes('asking'), `9: and says nothing to their pilot while the claim is out, since the server decides which ship asks at all (${askedOne})`);

  one.deliver();
  two.deliver();
  ok(one.docking.claims.count === 1 && two.docking.claims.count === 0, '9: the server puts one of them on that back and not the other');
  ok(w.spots.holderOf('a system', 'carrier', spot) === 1, '9: one hull, one ship on it');
  one.docking.clamp.step(dt);
  two.docking.clamp.step(dt);
  ok(oneSaid.length === 1 && oneSaid[0].word === 'dock' && oneSaid[0].to === 7, '9: the winner asks their pilot on the step after its claim settles');
  ok(twoSaid.length === 0, '9: the loser never asks at all, so their pilot’s one slot is never filled by a ship that cannot have the spot');
  ok(two.said.length === 1 && two.said[0].length > 0, `9: and its own pilot is told in words (${two.said[0]})`);
  ok((two.docking.clamp.report().waiting as unknown) === null, '9: with nothing left waiting on an answer that can never come');

  // Their pilot says yes, and the hull is eased on.
  one.docking.clamp.heard(7, 'allow', shipOne as never);
  ok(one.docking.docked(shipOne as never) && shipOne.ghosted, '9: their yes puts the hull on that back');
  one.docking.clamp.undock();
  ok(w.spots.holderOf('a system', 'carrier', spot) === 0, '9: letting go gives the back to whoever wants it next');
}

// --- 10: the hull that was already aboard, and the word that came too late -----------------------------
//
// The branch nothing had ever run: a spot claimed, no answer inside the wait, the word to their pilot
// sent on the local answer, their yes, the hull eased on -- and only then the server's refusal. The
// claim entry is rewritten as somebody else's in the same breath as `undock()` is re-entered, which is
// exactly the ordering a test is for.
{
  const w = world();
  const holder = browser(w, 1);
  const late = browser(w, 3);
  const carrier = new THREE.Vector3(0, 0, 0);
  const lateSaid: { to: number; word: string }[] = [];
  late.docking.clamp.peers = peerHull(7, carrier) as never;
  late.docking.clamp.link = clampLink(3, lateSaid) as never;
  const ship = hullShip('late', 0, 80);
  const spot = LaneClaims.key('carrier', '7');
  const dt = 1 / 60;

  // Somebody else has the back already; this browser simply never hears about it in time.
  w.post(w.spots.take(1, 'a system', 'carrier', spot) as Result);
  holder.docking.claims.claim(spot, 'clamp', 'carrier');
  late.docking.clamp.dock(ship as never);
  ok(late.docking.claims.count === 1 && lateSaid.length === 0, '10: the claim is out and their pilot has not been asked');
  // The answer is held back past the wait, so the local answer stands and the word goes out on it.
  for (let i = 0; i < Math.ceil((SPOT_TUNE.wait + 0.5) / dt); i++) late.docking.step(null, dt, null);
  ok(lateSaid.length === 1 && lateSaid[0].word === 'dock', '10: past the wait the ship asks on its own answer rather than hanging, which is the game played alone');
  late.docking.clamp.heard(7, 'allow', ship as never);
  ok(late.docking.docked(ship as never) && ship.ghosted, '10: their pilot says yes and the hull is eased onto a back the server never gave it');

  // And now the refusal, as late as the line made it.
  late.deliver();
  ok(!late.docking.docked(ship as never), '10: the word takes the hull straight back off that hull’s back');
  ok(lateSaid.some((s) => s.word === 'undock'), '10: their pilot is told, so the hull they think is riding them is not one they go on believing in');
  ok(late.docking.claims.count === 0 && late.docking.claims.holder(spot) === 'elsewhere', '10: this browser holds nothing and knows whose it is');
  ok(w.spots.holderOf('a system', 'carrier', spot) === 1, '10: and the spot is still the browser’s that really had it');
  const stats = late.docking.report().spots as Record<string, number>;
  ok(stats.late === 1 && stats.refused === 1, '10: counted as a late refusal, which is the line saying it is slower than the wait');
  ok(late.said.some((s) => s.length > 0), `10: with the pilot told in words (${late.said[late.said.length - 1]})`);
}

// --- 11: a claim word the server will not act on is refused in words, never in silence ------------------
//
// The browser reads silence as consent -- it flies on its own answer and takes the lane when the wait
// runs out -- so the one path that deliberately says nothing is the one that would put two ships in one
// lane. Giving a place back is never rate-limited at all: it can only ever make the world freer.
{
  const w = world({ perSecond: 2 });
  const lane = 'a_hull@2000,0,0|a';
  const window = { at: 0, lines: 0 };
  const now = 5000;
  let refusals = 0;
  for (let i = 0; i < 4; i++) {
    if (mayClaim(window, now, { ...SPOT_TUNING, perSecond: 2 })) w.post(w.spots.take(1, 'a system', 'dock', `${lane}${i}`) as Result);
    else {
      w.post(w.spots.tooFast(1, 'dock', `${lane}${i}`) as Result);
      refusals++;
    }
  }
  const answers = w.to(1);
  ok(answers.length === 4 && refusals === 2, '11: every claim word is answered, the two the rate let through and the two it did not');
  ok(answers[2].granted === 0 && String(answers[2].why).length > 0 && answers[3].granted === 0, '11: and the ones past the rate are refused in words rather than dropped');
  ok(w.spots.holderOf('a system', 'dock', `${lane}2`) === 0, '11: a refusal for asking too fast writes nothing down, so the next press asks again');
  ok(w.spots.describe().refused === 2, '11: it counts as the refusal it is');
}

console.log(`\n${checks} checks passed`);
