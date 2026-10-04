// The world's own creatures shared through a real relay: the lairs, the nests and the people at their
// posts that every browser seeds for itself, said to the server as seen and kept by one browser; a death
// that carries who struck it and how long the post stays empty; a follower walking off; a creature's blow
// on another player going to that player and nobody else; the admin's weapon riding in a stood
// creature's row, and put in the hand of one already standing (the admin's alone to ask, said to its world
// and no other, and told again to a browser that sees an armed one afterwards); and the admin changing
// the length of everybody's day without moving the sun.
//
// The pieces each have tests of their own (ownership.test.ts, npcWire.test.ts, clock.test.ts). What they
// cannot see is the glue in `server/relay.mjs`: that each word reaches its handler, that a seen word is
// taken only from a browser that has said who it is, that the answers go to the browsers they are for
// and to nobody else. That is run here against the relay itself, on a port of its own and a world in a
// temp folder, with plain sockets standing in for browsers.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const note = (msg: string): void => console.log(`     ${msg}`);

type Msg = Record<string, unknown>;

if (typeof WebSocket === 'undefined') {
  note('the relay round trip was skipped: this node has no WebSocket of its own');
} else {
  const { randomBytes } = await import('node:crypto');
  const { playerIdFor, proofFor, verifierFor } = await import('../../../server/identity.mjs');
  const { OWN_TUNING } = await import('../../../server/ownership.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'swg-npcshare-relay-'));
  const port = 18793;
  process.env.PORT = String(port);
  // Its world goes in the temp folder and never in `server/data`, which is somebody's real world.
  process.argv.push(`--data=${dir}`);
  await import('../../../server/relay.mjs');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const settle = () => wait(120);
  // The grants go out on the server's own clock, twice a second: a little more than one of its passes.
  const pass = () => wait(OWN_TUNING.grant + 150);

  /** A browser: its own key, a character of its own, everything the server has said to it, and where it stands. */
  async function connect(name: string, character: string, planet: string, claim = true) {
    const key = new Uint8Array(randomBytes(32));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const got: Msg[] = [];
    let nonce = '';
    await new Promise<void>((done, fail) => {
      ws.addEventListener('open', () => done());
      ws.addEventListener('error', () => fail(new Error(`${name} could not connect`)));
    });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String((e as MessageEvent).data)) as Msg;
      if (m.t === 'hail') nonce = String(m.nonce ?? '');
      got.push(m);
    });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    await settle();
    if (claim) {
      send({ t: 'claim', player: playerIdFor(key), key: verifierFor(key), proof: proofFor(verifierFor(key), nonce), character, name, counter: 0 });
      await settle();
    }
    send({ t: 'hello', name, species: 'human_male', class: 'jedi', planet, v: 3 });
    await settle();
    const welcome = got.find((m) => m.t === 'welcome') as { id?: number } | undefined;
    return {
      id: Number(welcome?.id ?? 0),
      got,
      send,
      close: () => ws.close(),
      at: (x: number, z = 0) => send({ t: 'state', p: [x, 0, z], h: 0, s: 'idle', v: 0 }),
      /** Every id this browser has been told to keep, and every one it has been told to let go, in order. */
      added: () => got.filter((m) => m.t === 'keep').flatMap((m) => (m.add as string[]) ?? []),
      dropped: () => got.filter((m) => m.t === 'keep').flatMap((m) => (m.drop as string[]) ?? []),
      all: (t: string) => got.filter((m) => m.t === t),
      last: (t: string, pick: (m: Msg) => boolean = () => true) => [...got].reverse().find((m) => m.t === t && pick(m)),
    };
  }

  try {
    // The first player this world ever registers is its admin.
    const admin = await connect('Han', 'char-a', 'tatooine');
    const b = await connect('Chewie', 'char-b', 'tatooine');
    const stranger = await connect('Greedo', '', 'tatooine', false);
    const far = await connect('Leia', 'char-c', 'naboo');
    ok(admin.id > 0 && b.id > 0 && stranger.id > 0 && far.id > 0, 'four browsers, three of them saying who they are, are in');
    const hail = admin.last('hail') as Msg;
    ok(hail.v === 6, `the relay speaks the sixth wire (${hail.v})`);
    ok(admin.all('welcome').length === 1 && b.all('welcome').length === 1, 'and a welcome is sent once and only once');
    admin.at(10);
    b.at(40);
    stranger.at(5);
    far.at(0);
    await settle();

    // ---- a lair's creature, seen by two browsers ----------------------------------------------------
    admin.send({ t: 'spawn', do: 'seen', id: 'wild:tatooine:3:0', at: [0, 0, 0], r: 30 });
    await pass();
    ok(admin.added().includes('wild:tatooine:3:0'), 'the browser that says it has stood a lair\'s creature, alone with a body for it, keeps it');
    b.send({ t: 'spawn', do: 'seen', id: 'wild:tatooine:3:0', at: [0, 0, 0], r: 30 });
    await pass();
    ok(!b.added().includes('wild:tatooine:3:0'), 'a second browser saying the same is not handed it while the first, nearer, has it');
    ok(!admin.last('spawn', (m) => m.do === 'add') && !b.last('spawn', (m) => m.do === 'add'), 'and nobody is told to stand anything: every browser has its own body already');
    stranger.send({ t: 'spawn', do: 'seen', id: 'wild:tatooine:3:0', at: [0, 0, 0], r: 30 });
    await pass();
    ok(!stranger.added().includes('wild:tatooine:3:0'), 'a browser that has not said who it is may say nothing of the kind, however near it stands');
    admin.send({ t: 'spawn', do: 'seen', id: 'travel:tatooine:1', at: [0, 0, 0], r: 0 });
    await pass();
    ok(!admin.added().includes('travel:tatooine:1'), 'and a ticket collector, which nobody may strike, is never on the list at all');

    // ---- putting one down hands it on at once --------------------------------------------------------
    admin.send({ t: 'spawn', do: 'unseen', id: 'wild:tatooine:3:0' });
    await pass();
    ok(admin.dropped().includes('wild:tatooine:3:0') && b.added().includes('wild:tatooine:3:0'), 'the keeper putting its body down is told to let go, and the other browser with one takes it');

    // ---- a creature's blow on another player ---------------------------------------------------------
    // Not behind the players' damage switch, so held to what the server can see instead: the player struck
    // must have a body for that very creature (their own browser stood it), and stand within reach of it.
    b.send({ t: 'npcBlow', to: admin.id, i: 'wild:tatooine:3:0', a: 14, at: [1, 2, 3], w: 'body' });
    await settle();
    ok(!admin.last('npcBlow'), 'a player whose own browser has put its body for the creature down is not bitten by it: nobody can be bitten by a creature their browser has not stood');
    admin.send({ t: 'spawn', do: 'seen', id: 'wild:tatooine:3:0', at: [0, 0, 0], r: 30 });
    await settle();
    b.send({ t: 'npcBlow', to: admin.id, i: 'wild:tatooine:3:0', a: 14, at: [1, 2, 3], w: 'body' });
    await settle();
    const blow = admin.last('npcBlow') as Msg | undefined;
    ok(!!blow && blow.id === b.id && blow.i === 'wild:tatooine:3:0' && blow.a === 14, `with a body for it again, the keeper's word that its creature bit them reaches them (${JSON.stringify(blow)})`);
    ok(!stranger.last('npcBlow') && !far.last('npcBlow'), 'and nobody else, on this world or another');
    b.send({ t: 'npcBlow', to: stranger.id, i: 'wild:tatooine:3:0', a: 5 });
    await settle();
    ok(!stranger.last('npcBlow'), 'a browser cannot make one up beside somebody whose browser never stood it and bite them with it');
    admin.at(OWN_TUNING.strike + 60);
    await settle();
    b.send({ t: 'npcBlow', to: admin.id, i: 'wild:tatooine:3:0', a: 15 });
    await settle();
    ok(admin.all('npcBlow').length === 1, `nor bite somebody standing farther from it than anything reaches (${OWN_TUNING.strike} m)`);
    admin.at(10);
    await settle();
    const before = admin.all('npcBlow').length;
    for (let k = 0; k < 30; k++) b.send({ t: 'npcBlow', to: admin.id, i: 'wild:tatooine:3:0', a: 1 });
    await settle();
    const landed = admin.all('npcBlow').length - before;
    ok(landed > 0 && landed <= OWN_TUNING['blow.perSecond'], `and no more of them in a second than the allowance (${landed} of 30 passed on)`);
    stranger.send({ t: 'npcBlow', to: b.id, i: 'wild:tatooine:3:0', a: 99 });
    await settle();
    ok(!b.last('npcBlow'), 'a browser that never kept the creature cannot strike anybody with it');

    // ---- a bolt on a creature somebody else keeps carries its flight to the keeper --------------------
    // Which is what lets the keeper's own blade answer the block for everybody: the direction, the speed,
    // the colour and the size go with the blow, to the keeper and nobody else.
    const holds = (br: { got: Msg[] }, id: string): boolean => {
      let held = false;
      for (const m of br.got) {
        if (m.t !== 'keep') continue;
        if (((m.drop as string[]) ?? []).includes(id)) held = false;
        if (((m.add as string[]) ?? []).includes(id)) held = true;
      }
      return held;
    };
    const keeper = holds(b, 'wild:tatooine:3:0') ? b : admin;
    const asker = keeper === b ? admin : b;
    ok(holds(keeper, 'wild:tatooine:3:0') && !holds(asker, 'wild:tatooine:3:0'), 'one of the two browsers with a body for it keeps it, and the other does not');
    asker.send({ t: 'npcHit', i: 'wild:tatooine:3:0', a: 12, at: [0, 1, 0], b: 1, d: [0, 0, -2], s: 88, c: 0x33ff66, z: 1.5 });
    await settle();
    const hurt = keeper.last('npcHurt') as Msg | undefined;
    ok(!!hurt && hurt.id === asker.id && hurt.a === 12 && hurt.b === 1 && JSON.stringify(hurt.d) === JSON.stringify([0, 0, -1]) && hurt.s === 88 && hurt.c === 0x33ff66 && hurt.z === 1.5, `a bolt struck on the other browser reaches the keeper with its own flight, direction made unit (${JSON.stringify(hurt)})`);
    ok(!asker.last('npcHurt') && !stranger.last('npcHurt') && !far.last('npcHurt'), 'and reaches nobody but the keeper');
    asker.send({ t: 'npcHit', i: 'wild:tatooine:3:0', a: 3, at: [0, 1, 0] });
    await settle();
    const bite = keeper.last('npcHurt') as Msg | undefined;
    ok(bite?.a === 3 && bite.d === undefined && bite.s === undefined, 'a blow that was no bolt carries no flight at all');
    // The browser that kept it a moment ago may still land the bite it had already decided on, with the
    // same grace a death has: the grant and the word cross on the wire.
    admin.send({ t: 'npcBlow', to: b.id, i: 'wild:tatooine:3:0', a: 7 });
    await settle();
    ok((b.last('npcBlow') as Msg | undefined)?.a === 7, 'while the one that kept it a moment ago may still land a bite it had already struck');

    // ---- a death, who struck it, and how long the post stays empty -----------------------------------
    b.send({ t: 'spawn', do: 'dead', id: 'wild:tatooine:3:0', by: [admin.id, b.id, far.id, 9999] });
    await settle();
    const gone = admin.last('spawn', (m) => m.do === 'gone') as Msg | undefined;
    ok(!!gone && gone.id === 'wild:tatooine:3:0' && gone.why === 'dead' && gone.back === 30, `everybody on the world is told it died and for how long its post stays empty (${JSON.stringify(gone)})`);
    ok(JSON.stringify(gone?.by) === JSON.stringify([admin.id, b.id]), 'naming who struck it, kept to the players really standing on this world');
    ok(!!stranger.last('spawn', (m) => m.do === 'gone') && !far.last('spawn', (m) => m.do === 'gone'), 'the news goes to the world it happened on and to no other');
    admin.send({ t: 'spawn', do: 'seen', id: 'wild:tatooine:3:0', at: [0, 0, 0], r: 30 });
    await settle();
    const told = admin.last('spawn', (m) => m.do === 'gone' && m.why === 'dead' && (m.back as number) <= 30 && m.by === undefined) as Msg | undefined;
    ok(!!told, 'a browser saying it has stood it again meanwhile is told that it is still dead');
    ok(told?.fresh === 1, 'told that it is about a body it has only just stood, which it takes away quietly rather than playing a death nobody saw');
    ok(b.all('spawn').filter((m) => m.do === 'gone' && m.id === 'wild:tatooine:3:0').length === 1, 'and it is told alone: nobody else hears the death twice');

    // ---- a follower walks off ------------------------------------------------------------------------
    admin.send({ t: 'spawn', do: 'seen', id: 'stood:tatooine:4', at: [0, 0, 0], r: 60 });
    await pass();
    ok(admin.added().includes('stood:tatooine:4'), 'a person at their post is kept by the one browser with a body for them');
    admin.send({ t: 'spawn', do: 'taken', id: 'stood:tatooine:4' });
    await settle();
    const taken = b.last('spawn', (m) => m.do === 'gone' && m.id === 'stood:tatooine:4') as Msg | undefined;
    ok(taken?.why === 'taken' && taken.back === 60, 'asked to follow, they leave their post, and every other browser is told they were taken and for how long the post stays empty');
    b.send({ t: 'spawn', do: 'seen', id: 'stood:tatooine:4', at: [0, 0, 0], r: 60 });
    await settle();
    const stillTaken = b.last('spawn', (m) => m.do === 'gone' && m.id === 'stood:tatooine:4' && m.fresh === 1) as Msg | undefined;
    ok(stillTaken?.why === 'taken', 'and a browser standing them at their post meanwhile is told they were taken, not that they died: the walk-off is held as a death and never named one');

    // ---- the admin's weapon rides in the row ---------------------------------------------------------
    admin.send({ t: 'spawn', do: 'add', species: 'a_trooper', at: [3, 0, 3], h: 0, weapon: 'object/weapon/ranged/rifle/rifle_e11.iff' });
    await settle();
    const stood = b.last('spawn', (m) => m.do === 'add') as { row: Msg } | undefined;
    ok(stood?.row.weapon === 'object/weapon/ranged/rifle/rifle_e11.iff', 'a creature the admin stood holding a weapon carries it in the row every browser stands it from');
    b.send({ t: 'spawn', do: 'add', species: 'a_trooper', at: [3, 0, 3] });
    await settle();
    ok(!!b.last('spawn', (m) => m.do === 'refused'), 'and nobody but the admin may stand one');

    // ---- the admin's weapon for one already standing --------------------------------------------------
    // `__debug.arm` on a body the world holds: only the admin may, the word goes to everybody on its world and
    // nobody off it, and a browser that says it has seen an armed one later is told the weapon as it does.
    const armId = String((admin.last('spawn', (m) => m.do === 'add') as { row: Msg } | undefined)?.row.id ?? '');
    const sword = 'object/weapon/melee/sword/shared_sword_01.iff';
    const arms = (br: { got: Msg[] }, id: string) => br.got.filter((m) => m.t === 'spawn' && m.do === 'arm' && m.id === id);
    const refusedWas = b.all('spawn').filter((m) => m.do === 'refused').length;
    b.send({ t: 'spawn', do: 'arm', id: armId, weapon: sword });
    await settle();
    ok(!!armId && b.all('spawn').filter((m) => m.do === 'refused').length === refusedWas + 1, 'a player who is not the admin asking to arm one is refused in words');
    ok([admin, b, stranger, far].every((br) => arms(br, armId).length === 0), 'and nobody is told anything about it');
    admin.send({ t: 'spawn', do: 'arm', id: armId, weapon: sword });
    await settle();
    const armWord = arms(b, armId)[0];
    ok(arms(admin, armId).length === 1 && armWord?.weapon === sword, `the admin's word reaches every browser on the world, the admin's own included (${JSON.stringify(armWord)})`);
    ok(arms(far, armId).length === 0, 'and none on another world');
    const adminRefusedWas = admin.all('spawn').filter((m) => m.do === 'refused').length;
    admin.send({ t: 'spawn', do: 'arm', id: 'stood:tatooine:nobody', weapon: sword });
    await settle();
    ok(admin.all('spawn').filter((m) => m.do === 'refused').length === adminRefusedWas + 1 && arms(b, 'stood:tatooine:nobody').length === 0, 'arming something that is not standing is refused, even for the admin, and said to nobody else');
    // One the browsers seed for themselves, armed, and then seen by a browser that arrives afterwards.
    admin.send({ t: 'spawn', do: 'seen', id: 'stood:tatooine:9', at: [0, 0, 0], r: 60 });
    await pass();
    admin.send({ t: 'spawn', do: 'arm', id: 'stood:tatooine:9', weapon: sword });
    await settle();
    ok(arms(b, 'stood:tatooine:9').length === 1, 'a person at their post is armed for everybody on the world alike');
    const seer = await connect('Wedge', 'char-e', 'tatooine');
    seer.at(12);
    await settle();
    ok(arms(seer, 'stood:tatooine:9').length === 0, 'a browser arriving afterwards has heard nothing of it yet');
    seer.send({ t: 'spawn', do: 'seen', id: 'stood:tatooine:9', at: [0, 0, 0], r: 60 });
    await settle();
    ok(arms(seer, 'stood:tatooine:9')[0]?.weapon === sword, 'and is told the weapon the moment it says it has stood that body, which was armed off its own seed');
    seer.close();

    // ---- the length of everybody's day ---------------------------------------------------------------
    b.send({ t: 'day', ms: 60000 });
    await settle();
    const refused = b.last('day') as Msg | undefined;
    ok(refused?.do === 'refused' && !admin.last('day'), 'a player who is not the admin is told in words whose the day is, and nothing changes');
    admin.send({ t: 'day', ms: 1800000 });
    await settle();
    const day = far.last('day') as Msg | undefined;
    ok(!!day && day.dayMs === 1800000 && Number(day.dayAt) > 0 && Number.isFinite(Number(day.dayFrom)), `the admin's word reaches everybody, on every world, with the anchor the day turned at (${JSON.stringify(day)})`);
    ok(!!admin.last('day') && !!b.last('day') && !!stranger.last('day'), 'the admin included');
    admin.send({ t: 'day', ms: 10 });
    await settle();
    ok((far.all('day') as Msg[]).length === 1, 'a length past the limits is no word at all');
    const late = await connect('Lando', 'char-d', 'tatooine');
    const lateHail = late.last('hail') as Msg;
    ok(lateHail.dayMs === 1800000 && lateHail.dayAt === day?.dayAt, 'a browser arriving afterwards is handed the same day in its greeting, anchor and all');

    // ---- the day survives a restart ------------------------------------------------------------------
    // The admin's word is written down as it is taken. A second relay started on a copy of what this one
    // wrote -- its own process, its own port -- must hand out the same day, anchor and all, or a restart
    // moves everybody's sun.
    const copy = mkdtempSync(join(tmpdir(), 'swg-npcshare-restart-'));
    for (const f of readdirSync(dir)) copyFileSync(join(dir, f), join(copy, f));
    const port2 = port + 1;
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../server/relay.mjs', import.meta.url)), `--data=${copy}`, `--port=${port2}`], { stdio: 'ignore' });
    try {
      let restarted: Msg | undefined;
      for (let tries = 0; tries < 40 && !restarted; tries++) {
        await wait(150);
        restarted = await new Promise<Msg | undefined>((done) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port2}`);
          const give = (m: Msg | undefined) => {
            try {
              ws.close();
            } catch {
              /* already gone */
            }
            done(m);
          };
          ws.addEventListener('message', (e) => {
            const m = JSON.parse(String((e as MessageEvent).data)) as Msg;
            if (m.t === 'hail') give(m);
          });
          ws.addEventListener('error', () => give(undefined));
        });
      }
      ok(!!restarted && restarted.dayMs === 1800000 && restarted.dayAt === day?.dayAt && restarted.dayFrom === day?.dayFrom, `a relay started again from what was written down hands out the same day, anchor and all (${JSON.stringify(restarted && { dayMs: restarted.dayMs, dayAt: restarted.dayAt, dayFrom: restarted.dayFrom })})`);
    } finally {
      child.kill();
      setTimeout(() => {
        try {
          rmSync(copy, { recursive: true, force: true });
        } catch {
          /* a temp folder either way */
        }
      }, 300);
    }

    admin.close();
    b.close();
    stranger.close();
    far.close();
    late.close();
    await settle();
  } finally {
    // The relay owns the port and the store for the rest of this process; the folder is ours.
    setTimeout(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* the server still has it open: a temp folder either way */
      }
      console.log(`\n${passed} checks passed`);
      process.exit(0);
    }, 200);
  }
}
