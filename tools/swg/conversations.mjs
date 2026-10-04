// What the game's own people say: the `conversations` command, which writes what the runtime needs into
// `<out>/conversations/` and nowhere else.
//
// Three files and a folder, from three places. The **structure** of the server's conversations and who
// speaks which come from the Core3 reference the converter carries (`core3ref/conversations.json` and
// `conversation-speakers.json`); the **people** from the packs the `spawns` command wrote (who stands on
// each world, and the fleet manifest's body and faction for every creature); and the **words** from the
// client's own string tables, through the archives. So:
//
//   - `core3.json`: the reference's trees, but only those somebody the packs stand speaks, and the ones of
//     the people this command stands itself (the heralds, below), with the shapes and calls those use and
//     the heralds' own table. The browser folds it with the very rules the server folds the whole
//     reference with (`src/story/core3Trees.ts`).
//   - `speakers.json`: every creature the packs (or this command) stand that has a conversation or a way
//     of speaking (`who`: its tree, its reaction table's diction, its faction), every herald whose places
//     `core3.json` keeps (with its tree, which is how the fold finds a herald's places), and, by world, the
//     rows this command stands (`stand`).
//   - `strings/<the client's table path>.json`: every table those trees' lines and answers are in, the
//     tables the heralds' places are named from, and all of `npc_reaction`, a table's every key and its
//     words as the archives hold them.
//
// **Why it stands anybody.** The heralds are the first of the server's conversations this game plays, and
// not one of them is in a pack: the server stood them from a table of its own (`heraldScreenPlay`), which
// the readers the `spawns` command uses do not read, and changing those would change every pack and the
// reference besides. So the heralds with a conversation are stood here instead, as rows of the same shape
// the packs carry, at the places the reference keeps (the converter mirrors nothing; the runtime turns them
// into the world's frame exactly as it turns every other row), and the browser stands them with the rest.
// A world whose pack already stands one of them is not given a second.
//
// It reads archives only for the strings, with `--retail-only` like every other command, and writes only
// under `<out>/conversations`. Nothing it writes ever reaches the repository.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { captureOf, heraldKey, voicesOf } from '../../src/story/core3Trees.ts';

/** The shape of what this command writes. A folder written by an older run is asked for again. */
export const CONVERSATIONS_FORMAT = 1;

/** The client's reaction tables: the greetings, farewells and barks of each way of speaking. */
export const REACTION_DIR = 'npc_reaction';

/** A table path as the client names one (`conversation/heraldcorellia1`): letters, digits and folders, nothing that climbs. */
const TABLE = /^[A-Za-z0-9_][A-Za-z0-9_/.-]{0,160}$/;
/** A part of a path that is `.` or `..`, an empty part, or a path ending in a slash. The same rule as the browser's (`src/story/strings.ts`). */
const NOT_A_PART = /(?:^|\/)\.{1,2}(?:\/|$)|\/\/|\/$/;

export function isTablePath(t) {
  return typeof t === 'string' && TABLE.test(t) && !NOT_A_PART.test(t);
}

/** Every client table a tree's words are in. */
function tablesOfTree(t, out) {
  const add = (ref) => {
    const m = typeof ref === 'string' ? /^@([A-Za-z0-9_/.-]+):[A-Za-z0-9_.-]+$/.exec(ref) : null;
    if (m && isTablePath(m[1])) out.add(m[1]);
  };
  for (const n of t.nodes) {
    add(n.say);
    for (const r of n.replies) add(r.text);
  }
}

/** Every creature a pack's row may stand as: its own, either side of a guard's, and every name of the lists it draws from. */
function standersOf(statics, pools) {
  const out = new Set();
  for (const r of statics ?? []) {
    if (typeof r.who === 'string' && r.who) out.add(r.who);
    for (const g of r.gcw ?? []) if (typeof g?.who === 'string') out.add(g.who);
    for (const d of r.draw ?? []) for (const n of pools?.[d?.[0]] ?? []) if (typeof n === 'string') out.add(n);
  }
  return out;
}

/**
 * What the command writes, worked out from what it was handed and nothing else, so a node test can hand it
 * a slice of each: the reference's conversations and speakers (as the reference's reader answers, Maps and
 * all, or plain), each world's pack (`{ world, statics, pools }`), the fleet's creatures (who to `{ id,
 * faction }`), and the reaction tables the archives hold. The strings are not here: `tables` is the list
 * of tables to read.
 */
export function planConversations({ conversations, speakers, packs, creatures, reactionTables = [] }) {
  const capture = captureOf(conversations);
  const voices = voicesOf(speakers);
  const fleet = creatures ?? {};
  // Who stands anywhere, and on which world.
  const standing = new Set();
  const standsOn = new Map();
  for (const p of packs) {
    const s = standersOf(p.statics, p.pools);
    standsOn.set(p.world, s);
    for (const w of s) standing.add(w);
  }
  // The heralds this command stands: those with a conversation, a body and a world with a pack, outdoors,
  // and not already stood by the pack (one a pack stands is spoken all the same, below).
  const stand = {};
  const notes = [];
  let stood = 0;
  for (const h of capture.heralds.multi) {
    const body = fleet[h.who]?.id;
    if (!voices[h.who]?.tree) continue;
    if (!standsOn.has(h.world)) {
      notes.push(`${h.who}: no pack for ${h.world}`);
      continue;
    }
    if (typeof body !== 'string' || !body) {
      notes.push(`${h.who}: no body in the fleet's creatures`);
      continue;
    }
    if (h.cell) {
      notes.push(`${h.who}: stands in a room, which this command does not resolve`);
      continue;
    }
    if (standsOn.get(h.world).has(h.who)) continue;
    (stand[h.world] ??= []).push({ key: heraldKey(h), who: h.who, id: body, x: h.x, y: h.y, z: h.z, heading: h.heading, cell: 0, respawn: 1, where: 'tasks', from: 'herald', still: true, peaceful: true });
    standing.add(h.who);
    stood++;
  }
  // Who speaks: every creature that stands and has a conversation or a way of speaking. A faction is kept
  // only beside a way of speaking, since it is what picks the greeting's warmth.
  const who = {};
  const treesUsed = new Set();
  const instancesUsed = new Set();
  for (const name of [...standing].sort()) {
    const v = voices[name];
    if (!v) continue;
    const row = {};
    // A hand-written tree, or one a factory built for this name (a trainer's, a theme park's giver's).
    if (v.tree && (capture.trees[v.tree] || capture.instances[v.tree])) {
      row.tree = v.tree;
      (capture.trees[v.tree] ? treesUsed : instancesUsed).add(v.tree);
    }
    if (v.diction) {
      row.diction = v.diction;
      const f = fleet[name]?.faction;
      if (typeof f === 'string' && f) row.faction = f;
    }
    if (row.tree || row.diction) who[name] = row;
  }
  // The trees, shapes and calls those speakers use.
  const trees = {};
  for (const name of [...treesUsed].sort()) trees[name] = capture.trees[name];
  const instances = {};
  const shapes = {};
  for (const name of [...instancesUsed].sort()) {
    instances[name] = capture.instances[name];
    const shape = capture.instances[name].shape;
    if (capture.shapes[shape]) shapes[shape] = capture.shapes[shape];
  }
  // The tables: every one the trees' words are in, every one a herald's place may be named from, and the
  // reaction tables.
  const tables = new Set();
  for (const name of Object.keys(trees)) tablesOfTree(trees[name], tables);
  for (const d of capture.heralds.directions) {
    const m = /^@([A-Za-z0-9_/.-]+):/.exec(d.name);
    if (m && isTablePath(m[1])) tables.add(m[1]);
  }
  for (const t of reactionTables) if (isTablePath(t)) tables.add(t);
  // The heralds' own table, for every tree written that a herald speaks, whoever stands them -- this command
  // or a pack -- in the reference's order: the browser finds a herald's places by its tree exactly as the
  // server does over the whole table (`foldTree`), so leaving one out would leave its places unmarked here
  // and its tree unplayable while the server plays it.
  const heralds = capture.heralds.multi.filter((h) => {
    const t = voices[h.who]?.tree;
    return !!t && treesUsed.has(t);
  });
  // And the fold finds a herald by who speaks the tree, so every one kept is given its tree here too, as the
  // server's whole table of speakers gives it: one nobody stands binds a creature nobody is stood as.
  for (const h of heralds) {
    if (!who[h.who]) who[h.who] = { tree: voices[h.who].tree };
    else who[h.who].tree ??= voices[h.who].tree;
  }
  const core3 = { format: CONVERSATIONS_FORMAT, trees, shapes, instances, heralds: { multi: heralds, directions: capture.heralds.directions } };
  const speakersOut = { format: CONVERSATIONS_FORMAT, who, stand };
  return { core3, speakers: speakersOut, tables: [...tables].sort(), notes, counts: { trees: Object.keys(trees).length, shapes: Object.keys(shapes).length, instances: Object.keys(instances).length, speakers: Object.keys(who).length, withTree: Object.values(who).filter((v) => v.tree).length, withDiction: Object.values(who).filter((v) => v.diction).length, heralds: stood, standing: standing.size } };
}

/** A string table as written: every key and its words, in the table's own order, with no prototype to reach. */
export function tableJson(map) {
  const out = {};
  for (const [k, v] of map) if (typeof k === 'string' && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') out[k] = v;
  return out;
}

/**
 * Write a plan's files under `<out>/conversations`, with each table read by `readTable(path)` (a Map, or
 * null for a table the archives have not got). The strings folder is written afresh, so a table no longer
 * wanted is gone. `ref` is the reference's own hash, which `status` compares to ask for a run again when
 * the reference changes under it. Answers how many tables were written and which were missing.
 */
export function writeConversations(out, plan, readTable, ref) {
  const dir = join(out, 'conversations');
  const strings = join(dir, 'strings');
  rmSync(strings, { recursive: true, force: true });
  mkdirSync(strings, { recursive: true });
  const missing = [];
  let written = 0;
  let bytes = 0;
  for (const t of plan.tables) {
    const map = readTable(t);
    if (!map) {
      missing.push(t);
      continue;
    }
    const file = join(strings, ...`${t}.json`.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    const text = JSON.stringify(tableJson(map));
    writeFileSync(file, text);
    written++;
    bytes += text.length;
  }
  const core3 = { ...plan.core3, ref };
  const core3Text = JSON.stringify(core3);
  writeFileSync(join(dir, 'core3.json'), core3Text);
  const speakers = { ...plan.speakers, ref, tables: plan.tables.filter((t) => !missing.includes(t)) };
  const speakersText = JSON.stringify(speakers);
  writeFileSync(join(dir, 'speakers.json'), speakersText);
  return { written, missing, bytes, core3Bytes: core3Text.length, speakersBytes: speakersText.length };
}

/** The reference's own hash: what a folder written from an older reference is told apart by. */
export function referenceHash(refDir) {
  const h = createHash('sha1');
  for (const f of ['conversations.json', 'conversation-speakers.json']) {
    const p = join(refDir, f);
    h.update(existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '');
  }
  return h.digest('hex').slice(0, 12);
}

/**
 * What `status` says of the conversations: a line, and why it is asked for again (null when it is not):
 * nothing written, an older shape, a reference that changed since, a world's people converted again since,
 * or tables named and not written.
 */
export function conversationsStatus(out, refDir, worlds) {
  const dir = join(out, 'conversations');
  const read = (f) => {
    try {
      return JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      return null;
    }
  };
  const core3 = read('core3.json');
  const speakers = read('speakers.json');
  if (!core3 || !speakers) return { line: '  conversations: none (the game\'s own people greet in our own words, and nobody speaks the client\'s)', why: 'the game\'s own people have none of the client\'s words to speak (conversations/)' };
  if (core3.format !== CONVERSATIONS_FORMAT || speakers.format !== CONVERSATIONS_FORMAT) return { line: `  conversations: an older shape (${core3.format})`, why: `the conversations were written in an older shape than this build reads (${core3.format})` };
  if (core3.ref !== referenceHash(refDir)) return { line: '  conversations: written from an older Core3 reference', why: 'the Core3 reference has changed since the conversations were written' };
  const at = statSync(join(dir, 'speakers.json')).mtimeMs;
  const newer = worlds.filter((w) => existsSync(join(out, w, 'spawns.json')) && statSync(join(out, w, 'spawns.json')).mtimeMs > at);
  if (newer.length) return { line: `  conversations: written before the people on ${newer.join(', ')}`, why: `the people on ${newer.join(', ')} were converted again since the conversations were written` };
  const tables = Array.isArray(speakers.tables) ? speakers.tables : [];
  const gone = tables.filter((t) => isTablePath(t) && !existsSync(join(dir, 'strings', ...`${t}.json`.split('/'))));
  if (gone.length) return { line: `  conversations: ${gone.length} string tables missing`, why: `${gone.length} of the client's string tables the conversations name are not there (${gone.slice(0, 3).join(', ')})` };
  const who = speakers.who ?? {};
  const voiced = Object.values(who).filter((v) => v?.tree).length;
  const diction = Object.values(who).filter((v) => v?.diction).length;
  const stood = Object.values(speakers.stand ?? {}).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0);
  return { line: `  conversations: ${Object.keys(core3.trees ?? {}).length} of the server's conversations for ${voiced} kinds of people, ${diction} who greet in the client's own reaction lines, ${stood} heralds stood, ${tables.length} of the client's string tables`, why: null };
}

/** Every reaction table the archives hold (`string/en/npc_reaction/*.stf`), as table paths. */
export function reactionTablesIn(list) {
  const out = [];
  for (const p of list) {
    const m = /^string\/en\/(npc_reaction\/[A-Za-z0-9_]+)\.stf$/.exec(p);
    if (m) out.push(m[1]);
  }
  return out.sort();
}

/** Every world under `<out>` whose `spawns.json` is there, with what the plan reads of it. */
export function packsUnder(out) {
  const packs = [];
  let names = [];
  try {
    names = readdirSync(out).sort();
  } catch {
    return packs;
  }
  for (const world of names) {
    const file = join(out, world, 'spawns.json');
    if (!existsSync(file)) continue;
    try {
      const s = JSON.parse(readFileSync(file, 'utf8'));
      packs.push({ world, statics: Array.isArray(s.statics) ? s.statics : [], pools: s.pools && typeof s.pools === 'object' ? s.pools : {} });
    } catch {
      /* a pack that will not read stands nobody here, as it stands nobody in the game */
    }
  }
  return packs;
}
