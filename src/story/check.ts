// The checker: what `npm run story:check` proves about a set before anybody plays it. Pure; the command
// line (`tools/story/check.mjs`) reads the folder and prints what this answers, and the node tests run it
// over the committed test set and over fixtures built to fail it.
//
// What the loader already refused stays refused (a file that does not read, a word the vocabulary does
// not have, a word kept for a later pass, a relative place outside the test set, a field claiming to be
// the canonical version). On top of that, across every file of the set, the design's rules by number:
//
//   1. Every id referred to exists: quests, steps, outcomes, objects, areas.
//   2. Every step can be reached from `start`, every path can reach an end, and no edge points back to an
//      earlier step except from a step marked `loop` or through a choice's option. A step waiting `after`
//      others can see them all done in one run: none of them may be skipped (`unless`, a chance under 1)
//      and no two of them lie only on different branches of one fork (a `nextOne`, a choice's options;
//      different conditional `next` edges are warned about), unless its `onStuck` says how that ends. And
//      no circle of quests gives itself for ever from one grant.
//   3. Every signal a step waits on has something that raises it.
//   4. Every condition and action is in the vocabulary with the right arguments, and none is reserved.
//   5. Trust moves only inside a choice or an outcome marked `pressure`, and never in a repeatable quest;
//      nor does a repeatable quest close anything.
//   6. No `note` is written where the player might not be present: on a hidden step, on a deadline the
//      world clock runs out, or on a signal another quest raises.
//   7. Every place's world is a planet or zone this game has, and every room names its cell.
//   8. A place relative to where a quest began is only in the test set.
//   9. Every `charge` stands on a choice whose condition asks `credits() >= ` at least that much.
//  10. Nothing anywhere is marked canonical or "true".
//  11. A document's slots: checked from the wave that brings documents.
//  12. A conversation's links resolve -- every entry, `next` and answer names a node it has, a talk step's
//      node is one its speaker's conversation has, a cast member's conversation exists -- its last entry has
//      no condition (nobody is ever mute), no node can be reached that neither ends, goes on nor offers
//      an answer, unless an importer marked it `needs`, and no nodes go on to each other in a ring with
//      nothing said and no answer offered (a conversation that would turn for ever in one frame). A node
//      nothing reaches, and one that says nothing and only goes on, are warned about.
//  13. A kill step's target, and a cast member's body, are in the creature catalogue (warnings, since the
//      catalogue is the pack's).
//  14. Unresolved escapes (`call` names nothing registered) and `needs` markers are counted.
//
// Rules 5 and 9 reach the conversations too: Trust moves only in an answer marked `pressure` (never in a
// node's own actions), and a `charge` stands on an answer whose condition asks for the money. Every gesture
// a conversation names is one of the library's (a clip, a family, an alias or a mood); with the player's
// own body's clip list in hand (`clips`) a clip that body has not got is warned about. `cues` are warned
// about as kept and not played yet. A `choice` step that no answer ever chooses can never be done (rule 3).
//
// Each problem names its file and line. A warning is something the owner may mean; an error is something
// that would leave a player stuck or the rules broken.

import { readSlot } from './gestures.ts';
import { lineAt } from './jsonc.ts';
import { reachFrom, stepsOutOf } from './quests.ts';
import { scriptNames } from './scripts.ts';
import { joinSets, stepPath, type ActionDef, type CondJson, type Issue, type LoadResult, type Place, type QuestDef, type StepDef, type StorySet } from './set.ts';
import { isLevelSignal, raisersFor, waitedOn } from './signals.ts';
import type { TalkDef } from './talkSet.ts';
import { readiness, STEP_TYPES } from './vocab.ts';

export interface Catalogue {
  ids: ReadonlySet<string>;
  groups: ReadonlySet<string>;
  socials: ReadonlySet<string>;
  tags: ReadonlySet<string>;
}

export interface CheckOptions {
  /** The worlds this game has (planet, zone and space zone pack ids). Without it rule 7 checks nothing. */
  worlds?: readonly string[];
  /** The creature catalogue, when the owner's install has one. Without it rule 13 checks nothing. */
  catalogue?: Catalogue | null;
  /** Other sets loaded beside this one, whose ids a reference may name. */
  others?: readonly StorySet[];
  /** The clips the player's own body has (a species rig's list), when this machine has one: a gesture clip not in it is warned about. */
  clips?: ReadonlySet<string> | null;
}

export interface CheckResult {
  errors: Issue[];
  warnings: Issue[];
  counts: { quests: number; steps: number; areas: number; objects: number; talks: number; nodes: number; cast: number; signals: number; unresolved: number; needs: number; later: number };
}

/** Every condition's quest, step and area references, walked. */
function walkCond(c: CondJson | null | undefined, f: (c: CondJson) => void): void {
  if (!c || typeof c !== 'object') return;
  f(c);
  for (const k of ['all', 'any']) if (Array.isArray(c[k])) for (const x of c[k] as CondJson[]) walkCond(x, f);
  if (c.not) walkCond(c.not as CondJson, f);
}

/** The edges out of a step, with whether each is allowed to point back (a loop step's, or a choice's). */
function edgesOf(st: StepDef): { to: string; back: boolean }[] {
  const out: { to: string; back: boolean }[] = [];
  for (const e of st.next) out.push({ to: e.to, back: st.loop });
  for (const e of st.nextOne) out.push({ to: e.to, back: st.loop });
  for (const t of st.onFail) out.push({ to: t, back: st.loop });
  if (st.onStuck !== 'fail' && st.onStuck !== 'skip') out.push({ to: st.onStuck, back: true });
  for (const o of st.options ?? []) for (const t of o.next) out.push({ to: t, back: true });
  return out;
}

/** Whether a step ends its quest when it is done, one way or another. */
function terminal(st: StepDef): boolean {
  return st.type === 'end' || st.ends !== null || (st.options ?? []).some((o) => o.ends !== null);
}

/** One edge of a quest's graph, with the fork it belongs to when only some of a step's edges are taken. */
interface GraphEdge {
  from: string;
  to: string;
  /** `nextOne` (exactly one is taken), `options` (one option is picked), `when` (a conditional `next`), or none. */
  fam: 'nextOne' | 'options' | 'when' | null;
  /** Which branch of that fork: the edge's place in `nextOne`, the option's, or the conditional edge's in `next`. */
  idx: number;
}

function graphOf(q: QuestDef): GraphEdge[] {
  const out: GraphEdge[] = [];
  for (const from of Object.keys(q.steps)) {
    const st = q.steps[from];
    st.next.forEach((e, i) => out.push({ from, to: e.to, fam: e.when ? 'when' : null, idx: i }));
    st.nextOne.forEach((e, i) => out.push({ from, to: e.to, fam: 'nextOne', idx: i }));
    st.options?.forEach((o, i) => o.next.forEach((to) => out.push({ from, to, fam: 'options', idx: i })));
    for (const to of st.onFail) out.push({ from, to, fam: null, idx: 0 });
    if (st.onStuck !== 'fail' && st.onStuck !== 'skip') out.push({ from, to: st.onStuck, fam: null, idx: 0 });
  }
  return out;
}

function reachOver(q: QuestDef, edges: GraphEdge[], cut: (e: GraphEdge) => boolean): Set<string> {
  const seen = new Set<string>();
  const todo = q.start.filter((s) => q.steps[s]);
  while (todo.length) {
    const s = todo.pop()!;
    if (seen.has(s)) continue;
    seen.add(s);
    for (const e of edges) if (e.from === s && !cut(e) && !seen.has(e.to)) todo.push(e.to);
  }
  return seen;
}

/**
 * Every fork in a quest -- a step that takes one of its `nextOne` edges, one of its options, or each of
 * its conditional `next` edges only when its condition holds -- with, for each branch, the steps no other
 * way leads to. A fork a run can come back round to is left out, since a second pass could take another
 * branch.
 */
function forks(q: QuestDef): { at: string; kind: 'nextOne' | 'options' | 'when'; only: Set<string>[] }[] {
  const edges = graphOf(q);
  const all = reachOver(q, edges, () => false);
  const out: { at: string; kind: 'nextOne' | 'options' | 'when'; only: Set<string>[] }[] = [];
  for (const at of Object.keys(q.steps)) {
    if (!all.has(at) || reachFrom(q, at).has(at)) continue;
    for (const kind of ['nextOne', 'options', 'when'] as const) {
      const idxs = [...new Set(edges.filter((e) => e.from === at && e.fam === kind).map((e) => e.idx))];
      if (idxs.length < 2) continue;
      const only = idxs.map((idx) => {
        const without = reachOver(q, edges, (e) => e.from === at && e.fam === kind && e.idx === idx);
        return new Set([...all].filter((s) => !without.has(s)));
      });
      out.push({ at, kind, only });
    }
  }
  return out;
}

/**
 * Whether a quest can finish within the very event it is given in: a way from its start through steps
 * that are done the moment they begin reaches one that ends it, or everything it can reach is such a step
 * (it then ends by itself). Chances and `after` are taken as letting it through.
 */
function finishesAtOnce(q: QuestDef): boolean {
  const instant = (s: string): boolean => !!q.steps[s] && !!STEP_TYPES[q.steps[s].type]?.instant;
  const seen = new Set<string>();
  const todo = q.start.filter(instant);
  while (todo.length) {
    const s = todo.pop()!;
    if (seen.has(s)) continue;
    seen.add(s);
    if (terminal(q.steps[s])) return true;
    for (const t of stepsOutOf(q.steps[s])) if (instant(t)) todo.push(t);
  }
  const reach = new Set(q.start);
  for (const s of q.start) for (const t of reachFrom(q, s)) reach.add(t);
  return reach.size > 0 && [...reach].every(instant);
}

/**
 * Every circle of quests that would give itself for ever from one grant: each repeated always (with no
 * limit and no cooldown), each finishing the moment it is given, and each giving the next -- a chain giver
 * after it, a step's `grant`, or a `grant()` action. One stopped by the machine's own guard changes nothing,
 * but it is a set that can never be played, so it is refused here.
 */
function instantCircles(set: StorySet): string[][] {
  const always = (q: QuestDef): boolean => q.repeat.limit === 0 && (q.repeat.every === 'always' || (q.repeat.every === 'cooldown' && q.repeat.cooldown === 0));
  const nodes = Object.keys(set.quests).filter((id) => always(set.quests[id]) && finishesAtOnce(set.quests[id]));
  const inSet = new Set(nodes);
  const gives = new Map<string, Set<string>>(nodes.map((id) => [id, new Set<string>()]));
  for (const id of nodes) {
    const q = set.quests[id];
    for (const g of q.givers) if (g.kind === 'chain' && inSet.has(g.after)) gives.get(g.after)!.add(id);
    const acts: ActionDef[] = [];
    for (const s of Object.keys(q.steps)) {
      const st = q.steps[s];
      for (const t of [...st.grant.done, ...st.grant.fail]) if (inSet.has(t)) gives.get(id)!.add(t);
      acts.push(...st.do.start, ...st.do.done, ...st.do.fail, ...(st.options ?? []).flatMap((o) => o.do));
    }
    for (const o of Object.keys(q.outcomes)) acts.push(...q.outcomes[o].do);
    for (const a of acts) if (a.act === 'grant' && typeof a.args[0] === 'string' && inSet.has(a.args[0])) gives.get(id)!.add(a.args[0]);
  }
  // Each circle once: walk from every quest, and report a way back to where it began that starts at the
  // smallest id on it.
  const out: string[][] = [];
  const reported = new Set<string>();
  for (const start of [...nodes].sort()) {
    const path: string[] = [];
    const onPath = new Set<string>();
    const walk = (id: string): string[] | null => {
      path.push(id);
      onPath.add(id);
      for (const n of [...(gives.get(id) ?? [])].sort()) {
        if (n === start) return [...path];
        if (!onPath.has(n) && n > start) {
          const found = walk(n);
          if (found) return found;
        }
      }
      path.pop();
      onPath.delete(id);
      return null;
    };
    const cyc = walk(start);
    if (cyc && !cyc.some((id) => reported.has(id))) {
      for (const id of cyc) reported.add(id);
      out.push(cyc);
    }
  }
  return out;
}

export function checkSet(input: LoadResult | StorySet, opts: CheckOptions = {}): CheckResult {
  const loaded = 'set' in input ? input : null;
  const set: StorySet = loaded ? loaded.set : (input as StorySet);
  const errors: Issue[] = loaded ? [...loaded.errors] : [];
  const warnings: Issue[] = loaded ? [...loaded.warnings] : [];
  const lib = opts.others?.length ? joinSets([set, ...opts.others]) : set;
  const worlds = opts.worlds ? new Set(opts.worlds) : null;
  const cat = opts.catalogue ?? null;
  const clips = opts.clips ?? null;
  const scripts = new Set(scriptNames());
  const counts = { quests: 0, steps: 0, areas: Object.keys(set.areas).length, objects: Object.keys(set.objects).length, talks: 0, nodes: 0, cast: Object.keys(set.cast ?? {}).length, signals: 0, unresolved: 0, needs: 0, later: set.later.length };
  const signalsSeen = new Set<string>();
  /** Every choice a `choose(q, s, option)` anywhere makes, as `<quest>#<step>`: a choice step none makes can never be done. */
  const chosen = new Set<string>();

  type Err = (path: string, message: string, rule: number) => void;
  type Warn = (path: string, message: string, rule?: number) => void;
  /** The reference checks every file shares, reporting to its own file. */
  const refsFor = (err: Err, warn: Warn) => {
    /** A quest id: in this set, in a set beside it, or in a set not loaded here (a warning: it cannot be checked). */
    const questRef = (ref: string, path: string): QuestDef | null => {
      const d = lib.quests[ref];
      if (d) return d;
      const prefix = ref.slice(0, ref.indexOf(':'));
      if (lib.sets.some((s) => s.name === prefix)) err(path, `${ref} is not a quest of the ${prefix} set`, 1);
      else warn(path, `${ref} is in the ${prefix} set, which is not loaded here, so it cannot be checked`, 1);
      return null;
    };
    /** A person: a cast member of a set loaded here, or one of the game's own people (`row:`), whom a later wave binds. */
    const whoRef = (who: string, path: string): void => {
      if (who.startsWith('row:')) return;
      if (lib.cast && Object.hasOwn(lib.cast, who)) return;
      const prefix = who.slice(0, who.indexOf(':'));
      if (lib.sets.some((s) => s.name === prefix)) err(path, `there is no cast member ${who}`, 1);
      else warn(path, `${who} is in the ${prefix} set, which is not loaded here, so it cannot be checked`, 1);
    };
    /** A conversation's node (`<tree>#<node>`) or answer (`<tree>#<node>.<reply>`). */
    const talkRef = (ref: string, path: string): void => {
      const [tree, rest] = ref.split('#');
      const t = lib.talks && Object.hasOwn(lib.talks, tree) ? lib.talks[tree] : null;
      if (!t) {
        const prefix = tree.slice(0, tree.indexOf(':'));
        if (lib.sets.some((s) => s.name === prefix)) err(path, `there is no conversation ${tree}`, 1);
        else warn(path, `${tree} is in the ${prefix} set, which is not loaded here, so it cannot be checked`, 1);
        return;
      }
      const [node, reply] = rest.split('.');
      const n = t.nodes[node];
      if (!n) err(path, `${tree} has no node ${node}`, 12);
      else if (reply !== undefined && !n.replies.some((r) => r.id === reply)) err(path, `${tree}'s node ${node} has no answer ${reply}`, 12);
    };
    /** A gesture slot: one of the library's, and, with the body's own list in hand, a clip that body has. */
    const gestureRef = (slot: string | null | undefined, path: string): void => {
      if (typeof slot !== 'string') return;
      const s = readSlot(slot);
      if (!s) {
        err(path, `${slot} is not a gesture: a clip (emt_nod), a family (@agree), an alias (explain) or a mood (mood:sad)`, 4);
        return;
      }
      if (s.kind === 'clips' && clips) for (const c of s.clips) if (!clips.has(c)) warn(path, `${c} is not one of the body's own clips, so the line is said standing still`);
    };
    const condRefs = (c: CondJson | null | undefined, path: string): void =>
      walkCond(c, (x) => {
        if (typeof x.quest === 'string') {
          const d = questRef(x.quest, path);
          if (d && typeof x.outcome === 'string' && !(x.outcome in d.outcomes)) err(path, `${x.quest} has no outcome ${x.outcome}`, 1);
        }
        if (Array.isArray(x.step)) {
          const d = questRef(x.step[0] as string, path);
          if (d && !d.steps[x.step[1] as string]) err(path, `${x.step[0]} has no step ${x.step[1]}`, 1);
        }
        if (Array.isArray(x.choice)) {
          const d = questRef(x.choice[0] as string, path);
          const st = d?.steps[x.choice[1] as string];
          if (d && !st) err(path, `${x.choice[0]} has no step ${x.choice[1]}`, 1);
          else if (st && (st.type !== 'choice' || !st.options?.some((o) => o.id === x.eq))) err(path, `${x.choice[0]}'s step ${x.choice[1]} is not a choice with an option ${String(x.eq)}`, 1);
        }
        if (typeof x.completions === 'string') questRef(x.completions, path);
        if (typeof x.inArea === 'string' && !lib.areas[x.inArea]) err(path, `there is no area ${x.inArea}`, 1);
        if (typeof x.heard === 'string') talkRef(x.heard, path);
        if (typeof x.chosen === 'string') talkRef(x.chosen, path);
        if (x.person && typeof (x.person as { who?: unknown }).who === 'string') whoRef((x.person as { who: string }).who, path);
        if (typeof x.script === 'string' && !scripts.has(x.script)) {
          counts.unresolved++;
          warn(path, `call(${x.script}) names no registered script, so it reads false`, 14);
        }
      });
    const actionRefs = (list: readonly ActionDef[], path: string): void => {
      list.forEach((a, i) => {
        const p = `${path}/${i}`;
        const [x, y] = a.args;
        switch (a.act) {
          case 'grant':
          case 'offer':
          case 'drop':
          case 'restart':
            questRef(x as string, p);
            break;
          case 'close':
            for (const r of a.args) questRef(r as string, p);
            break;
          case 'complete':
          case 'failStep': {
            const d = questRef(x as string, p);
            if (d && !d.steps[y as string]) err(p, `${x} has no step ${y}`, 1);
            break;
          }
          case 'end':
          case 'fail': {
            const d = questRef(x as string, p);
            if (d && y !== undefined && y !== 'cleared' && !((y as string) in d.outcomes)) err(p, `${x} has no outcome ${y}`, 1);
            break;
          }
          case 'choose': {
            const d = questRef(x as string, p);
            const st = d?.steps[y as string];
            if (d && (!st || st.type !== 'choice')) err(p, `${x} has no choice step ${y}`, 1);
            else if (st && !st.options?.some((o) => o.id === a.args[2])) err(p, `${x}'s choice ${y} has no option ${String(a.args[2])}`, 1);
            chosen.add(`${x}#${y}`);
            break;
          }
          case 'introduce':
            whoRef(x as string, p);
            break;
          case 'gesture':
            gestureRef(x as string, p);
            break;
          case 'call':
            if (!scripts.has(x as string)) {
              counts.unresolved++;
              warn(p, `call(${x}) names no registered script, so it does nothing`, 14);
            }
            break;
          case 'waypoint':
            if (worlds && typeof y === 'string' && !worlds.has(y)) err(p, `${y} is not a world this game has`, 7);
            break;
        }
      });
    };
    return { questRef, whoRef, condRefs, actionRefs, gestureRef };
  };

  // ---- the conversations and the cast, first: their `choose` actions are what make a choice step doable ----
  for (const id of Object.keys(set.talks ?? {})) checkTalk(set.talks[id]);
  for (const id of Object.keys(set.cast ?? {})) {
    const c = set.cast[id];
    const err: Err = (path, message, rule) => errors.push({ level: 'error', file: c.src.file, line: lineAt(c.src.lines, path), message, rule });
    const warn: Warn = (path, message, rule) => warnings.push({ level: 'warning', file: c.src.file, line: lineAt(c.src.lines, path), message, ...(rule ? { rule } : {}) });
    const { condRefs } = refsFor(err, warn);
    if (worlds && !worlds.has(c.world)) err('/world', `${c.world} is not a world this game has`, 7);
    if (c.tree && !(lib.talks && Object.hasOwn(lib.talks, c.tree))) err('/tree', `there is no conversation ${c.tree}`, 12);
    if (cat && !cat.ids.has(c.body)) warn('/body', `${c.body} is not in the creature catalogue`, 13);
    condRefs(c.stand, '/stand');
  }

  /** One conversation: its links, its entries, its dead ends, and Trust, charges and gestures where they may be. */
  function checkTalk(t: TalkDef): void {
    counts.talks++;
    const err: Err = (path, message, rule) => errors.push({ level: 'error', file: t.src.file, line: lineAt(t.src.lines, path), message, rule });
    const warn: Warn = (path, message, rule) => warnings.push({ level: 'warning', file: t.src.file, line: lineAt(t.src.lines, path), message, ...(rule ? { rule } : {}) });
    const { condRefs, actionRefs, gestureRef, whoRef } = refsFor(err, warn);
    if (t.speaker) whoRef(t.speaker, '/speaker');
    const last = t.entry[t.entry.length - 1];
    if (last?.when) err(`/entry/${t.entry.length - 1}`, 'the last entry has no condition, so nobody is ever mute', 12);
    t.entry.forEach((e, i) => {
      if (!t.nodes[e.to]) err(`/entry/${i}`, `the entry goes to ${e.to}, which is not a node of this conversation`, 12);
      condRefs(e.when, `/entry/${i}`);
    });
    // Which nodes the entries reach, through `next` and answers.
    const reached = new Set<string>();
    const todo = t.entry.map((e) => e.to);
    while (todo.length) {
      const n = todo.pop()!;
      const node = t.nodes[n];
      if (!node || reached.has(n)) continue;
      reached.add(n);
      if (node.next) todo.push(node.next);
      for (const r of node.replies) if (r.to) todo.push(r.to);
    }
    // Nodes that go on to each other with nothing said and no answer offered: a ring of them would be asked
    // for one after another with nothing for the player to read or press, for ever. Each ring said once.
    const quiet = (name: string): boolean => {
      const n = t.nodes[name];
      return !!n && !n.say.length && !n.replies.length && !!n.next;
    };
    const ringed = new Set<string>();
    for (const start of Object.keys(t.nodes)) {
      if (!quiet(start) || ringed.has(start)) continue;
      const walked: string[] = [];
      let at = start;
      while (quiet(at) && !walked.includes(at)) {
        walked.push(at);
        at = t.nodes[at].next!;
      }
      if (!walked.includes(at)) continue;
      const ring = walked.slice(walked.indexOf(at));
      if (!ring.some((r) => ringed.has(r))) err(`/nodes/${at}/next`, `${[...ring, at].join(' -> ')} go on to each other with nothing said and no answer offered, for ever`, 12);
      for (const r of ring) ringed.add(r);
    }
    for (const name of Object.keys(t.nodes)) {
      const n = t.nodes[name];
      counts.nodes++;
      const p = `/nodes/${name}`;
      if (n.needs) counts.needs++;
      if (!reached.has(name)) warn(p, `${name} is never reached from the entries`, 12);
      if (n.next && !t.nodes[n.next]) err(`${p}/next`, `${name} goes on to ${n.next}, which is not a node of this conversation`, 12);
      if (!n.end && !n.next && !n.replies.length && !n.needs) err(p, `${name} neither ends, goes on, nor offers an answer: mark it "end": true`, 12);
      if (n.end && (n.next || n.replies.length)) warn(p, `${name} ends, so its ${n.next ? 'next' : 'answers'} are never reached`);
      if (!n.say.length && !n.replies.length && n.next) warn(`${p}/say`, `${name} says nothing and only goes on to ${n.next}`);
      else if (!n.say.length && !n.next) warn(`${p}/say`, `${name} says nothing`);
      actionRefs(n.do, `${p}/do`);
      for (const a of n.do) {
        if (a.act === 'trust') err(`${p}/do`, 'Trust moves only on an answer marked "pressure": true, never as a node is reached', 5);
        if (a.act === 'charge') err(`${p}/do`, 'charge belongs on an answer whose condition asks credits() >= the amount', 9);
      }
      n.say.forEach((l, i) => gestureRef(l.gesture, `${p}/say/${i}/gesture`));
      n.replies.forEach((r, i) => {
        const rp = `${p}/replies/${i}`;
        if (r.to && !t.nodes[r.to]) err(`${rp}/to`, `answer ${r.id} goes on to ${r.to}, which is not a node of this conversation`, 12);
        condRefs(r.when, `${rp}/when`);
        actionRefs(r.do, `${rp}/do`);
        gestureRef(r.gesture, `${rp}/gesture`);
        for (const a of r.do) {
          if (a.act === 'trust' && !r.pressure) err(`${rp}/do`, `answer ${r.id} moves Trust without being marked "pressure": true`, 5);
          if (a.act === 'charge') {
            const want = a.args[0] as number;
            let asked = false;
            walkCond(r.when, (c) => {
              const cr = c.credits as Record<string, unknown> | undefined;
              if (cr && typeof cr.gte === 'number' && cr.gte >= want) asked = true;
              if (cr && typeof cr.gt === 'number' && cr.gt >= want - 1) asked = true;
            });
            if (!asked) err(`${rp}/when`, `answer ${r.id} charges ${want} credits without asking credits() >= ${want} in its condition`, 9);
          }
        }
      });
    }
  }

  for (const id of Object.keys(set.quests)) {
    const q = set.quests[id];
    counts.quests++;
    const file = q.src.file;
    const err = (path: string, message: string, rule: number): void => {
      errors.push({ level: 'error', file, line: lineAt(q.src.lines, path), message, rule });
    };
    const warn = (path: string, message: string, rule?: number): void => {
      warnings.push({ level: 'warning', file, line: lineAt(q.src.lines, path), message, ...(rule ? { rule } : {}) });
    };
    const outcomeOk = (o: string): boolean => o === 'cleared' || o in q.outcomes;
    const { questRef, whoRef, condRefs, actionRefs } = refsFor(err, warn);
    const placeCheck = (p: Place | null, path: string): void => {
      if (!p) return;
      const world = 'rel' in p ? p.world : p.world;
      if (world && worlds && !worlds.has(world)) err(path, `${world} is not a world this game has`, 7);
    };

    // ---- the quest's own fields ----
    if (typeof q.abandon === 'string' && !outcomeOk(q.abandon)) err('/abandon', `abandon names the outcome ${q.abandon}, which the quest does not declare`, 1);
    if (q.harsh && q.restart !== 'never') warn('/restart', 'a harsh quest can never be restarted, whatever restart says');
    condRefs(q.needs, '/needs');
    q.givers.forEach((g, i) => {
      if (g.kind === 'use' && !lib.objects[g.object]) err(`/givers/${i}`, `there is no object ${g.object}`, 1);
      if (g.kind === 'chain') {
        const d = questRef(g.after, `/givers/${i}`);
        if (d && g.outcome && !(g.outcome in d.outcomes)) err(`/givers/${i}`, `${g.after} has no outcome ${g.outcome}`, 1);
      }
      if (g.kind === 'talk') whoRef(g.who, `/givers/${i}`);
    });
    for (const s of q.start) if (!q.steps[s]) err('/start', `start names ${s}, which is not a step of this quest`, 1);
    const repeatable = q.repeat.every !== 'never';
    for (const o of Object.keys(q.outcomes)) {
      const od = q.outcomes[o];
      const path = `/outcomes/${o}`;
      actionRefs(od.do, `${path}/do`);
      for (const a of od.do) {
        if (a.act === 'trust' && !od.pressure) err(path, 'Trust moves only under pressure: mark this outcome "pressure": true, or take the trust out', 5);
        if (a.act === 'trust' && repeatable) err(path, 'a repeatable quest may not move Trust (Standing is the grindable one)', 5);
        if (a.act === 'close' && repeatable) err(path, 'a repeatable quest may not close anything', 5);
        if (a.act === 'charge') err(path, 'charge belongs on a choice whose condition asks credits() >= the amount', 9);
      }
    }

    // ---- each step ----
    for (const name of Object.keys(q.steps)) {
      const st = q.steps[name];
      counts.steps++;
      const sp = (...rest: (string | number)[]): string => stepPath(name, ...rest);
      for (const s of [...st.after, ...st.unless]) if (!q.steps[s]) err(sp(), `${name} names ${s}, which is not a step of this quest`, 1);
      for (const e of [...st.next, ...st.nextOne]) {
        if (!q.steps[e.to]) err(sp('next'), `${name} goes on to ${e.to}, which is not a step of this quest`, 1);
        condRefs(e.when, sp('next'));
      }
      for (const s of st.onFail) if (!q.steps[s]) err(sp('onFail'), `${name} fails into ${s}, which is not a step of this quest`, 1);
      if (st.onStuck !== 'fail' && st.onStuck !== 'skip' && !q.steps[st.onStuck]) err(sp('onStuck'), `onStuck names ${st.onStuck}, which is not a step of this quest`, 1);
      if (st.ends && !outcomeOk(st.ends)) err(sp('ends'), `${name} ends the quest as ${st.ends}, which the quest does not declare in its outcomes`, 1);
      if (st.type === 'end' && st.outcome && !outcomeOk(st.outcome)) err(sp('outcome'), `${name} ends the quest as ${st.outcome}, which the quest does not declare in its outcomes`, 1);
      if (st.ends && (st.next.length || st.nextOne.length)) warn(sp('ends'), `${name} ends the quest, so its next is never followed`);
      for (const g of [...st.grant.done, ...st.grant.fail]) questRef(g, sp('grant'));
      if (st.object && !lib.objects[st.object]) err(sp('object'), `there is no object ${st.object}`, 1);
      if (st.area && !lib.areas[st.area]) err(sp('area'), `there is no area ${st.area}`, 1);
      if (st.type === 'talk' && st.who) {
        whoRef(st.who, sp('who'));
        // The node a talk step waits for must be one its speaker's conversation has.
        const c = lib.cast && Object.hasOwn(lib.cast, st.who) ? lib.cast[st.who] : null;
        const t = c?.tree && lib.talks && Object.hasOwn(lib.talks, c.tree) ? lib.talks[c.tree] : null;
        if (c && !t) err(sp('who'), `${st.who} has no conversation, so nothing can be said to them`, 12);
        else if (t && st.node && !t.nodes[st.node]) err(sp('node'), `${st.who}'s conversation has no node ${st.node}`, 12);
      }
      placeCheck(st.at, sp('at'));
      placeCheck(st.waypoint?.at ?? null, sp('waypoint'));
      const all = [...st.do.start, ...st.do.done, ...st.do.fail];
      actionRefs(st.do.start, sp('do', 'start'));
      actionRefs(st.do.done, sp('do', 'done'));
      actionRefs(st.do.fail, sp('do', 'fail'));
      for (const o of st.options ?? []) {
        actionRefs(o.do, sp('options'));
        condRefs(o.when, sp('options'));
        for (const t of o.next) if (!q.steps[t]) err(sp('options'), `option ${o.id} goes on to ${t}, which is not a step of this quest`, 1);
        if (o.ends && !outcomeOk(o.ends)) err(sp('options'), `option ${o.id} ends the quest as ${o.ends}, which the quest does not declare`, 1);
      }

      // Rule 3: what it waits on is raised by something.
      const waits = waitedOn(st);
      if (waits) {
        signalsSeen.add(waits);
        const raisers = raisersFor(lib, waits);
        if (!raisers.length) err(sp(), `${name} waits on ${waits}, which nothing raises`, 3);
        else if (waits.startsWith('debug:')) {
          if (set.test) warn(sp(), `${name} waits on ${waits}, which only the console raises (allowed in the test set)`, 3);
          else err(sp(), `${name} waits on ${waits}: console signals are only for the test set`, 3);
        }
        if (isLevelSignal(waits) && st.n > 1) warn(sp('n'), `${waits} is raised again every couple of seconds while it stays true, so counting it to ${st.n} counts the repeats`);
        if (waits.startsWith('world:') && worlds && !worlds.has(waits.slice(6))) err(sp('signal'), `${waits.slice(6)} is not a world this game has`, 7);
        if (waits.startsWith('died:') && cat && !waits.slice(5).includes(':') && !cat.ids.has(waits.slice(5))) warn(sp('signal'), `${waits.slice(5)} is not in the creature catalogue`, 13);
      }
      // Rule 13: a kill step's target.
      if (st.kill && cat) {
        for (const w of st.kill.who ?? []) if (!cat.ids.has(w)) warn(sp('who'), `${w} is not in the creature catalogue`, 13);
        if (st.kill.group && !cat.groups.has(st.kill.group)) warn(sp('group'), `no creature in the catalogue is in the group ${st.kill.group}`, 13);
        if (st.kill.social && !cat.socials.has(st.kill.social)) warn(sp('social'), `no creature in the catalogue is of the social group ${st.kill.social}`, 13);
        if (st.kill.tag && !cat.tags.has(st.kill.tag)) warn(sp('tag'), `no creature in the catalogue carries the tag ${st.kill.tag}`, 13);
      }
      // Rule 5: Trust only under pressure, and neither Trust nor closing in a repeatable quest.
      for (const a of all) {
        if (a.act === 'trust') err(sp('do'), 'Trust moves only under pressure: on a choice\'s option or an outcome marked "pressure": true', 5);
        if (a.act === 'close' && repeatable) err(sp('do'), 'a repeatable quest may not close anything', 5);
        if (a.act === 'charge') err(sp('do'), 'charge belongs on a choice whose condition asks credits() >= the amount', 9);
      }
      for (const o of st.options ?? []) {
        for (const a of o.do) {
          if (a.act === 'trust' && !o.pressure) err(sp('options'), `option ${o.id} moves Trust without being marked "pressure": true`, 5);
          if (a.act === 'trust' && repeatable) err(sp('options'), 'a repeatable quest may not move Trust (Standing is the grindable one)', 5);
          if (a.act === 'close' && repeatable) err(sp('options'), 'a repeatable quest may not close anything', 5);
          if (a.act === 'charge') {
            // Rule 9: the option's own condition must ask for at least the amount charged.
            const n = a.args[0] as number;
            let asked = false;
            walkCond(o.when, (c) => {
              const cr = c.credits as Record<string, unknown> | undefined;
              if (cr && typeof cr.gte === 'number' && cr.gte >= n) asked = true;
              if (cr && typeof cr.gt === 'number' && cr.gt >= n - 1) asked = true;
            });
            if (!asked) err(sp('options'), `option ${o.id} charges ${n} credits without asking credits() >= ${n} in its condition`, 9);
          }
        }
      }
      // Rule 6: a note only where the player is present.
      const notes = (list: readonly ActionDef[]): boolean => list.some((a) => a.act === 'note');
      if (st.visible === false && (notes(all) || (st.options ?? []).some((o) => notes(o.do)))) err(sp('do'), `${name} is hidden, so the player is not there to note anything: no note on a hidden step`, 6);
      if (st.for?.clock === 'world' && notes(st.do.done)) err(sp('do', 'done'), `${name} runs out on the world clock, perhaps while the player is away: no note there`, 6);
      if (st.timeLimit?.clock === 'world' && notes(st.do.fail)) err(sp('do', 'fail'), `${name}'s time limit runs out on the world clock, perhaps while the player is away: no note there`, 6);
      if (waits && notes(st.do.done) && raisersFor(lib, waits).some((r) => r.kind === 'action' || r.kind === 'out')) err(sp('do', 'done'), `${name} is done by a signal another step raises, perhaps far from the player: no note there`, 6);
      if (readiness(STEP_TYPES[st.type] ?? { wave: 99 }) !== 'built') counts.later++;
    }

    // ---- rule 2: reaching every step, and every step reaching an end ----
    const reached = new Set<string>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const visit = (s: string): void => {
      if (reached.has(s) || !q.steps[s]) return;
      reached.add(s);
      stack.push(s);
      onStack.add(s);
      for (const e of edgesOf(q.steps[s])) {
        if (onStack.has(e.to) && !e.back) err(stepPath(s, 'next'), `${s} points back to ${e.to}: only a step marked "loop": true or a choice's option may`, 2);
        visit(e.to);
      }
      stack.pop();
      onStack.delete(s);
    };
    for (const s of q.start) visit(s);
    for (const name of Object.keys(q.steps)) if (!reached.has(name)) err(stepPath(name), `${name} can never be reached from start`, 2);
    // Which steps can reach an end: an end step, a step that ends the quest, or one with nowhere to go (it ends the quest by itself, which is warned).
    const ends = new Set<string>();
    for (const name of Object.keys(q.steps)) {
      const st = q.steps[name];
      if (terminal(st)) ends.add(name);
      else if (!edgesOf(st).length) {
        ends.add(name);
        if (reached.has(name)) warn(stepPath(name), `${name} goes nowhere, so the quest ends done by itself once nothing else is active`);
      }
    }
    for (let grew = true; grew; ) {
      grew = false;
      for (const name of Object.keys(q.steps)) {
        if (ends.has(name)) continue;
        if (edgesOf(q.steps[name]).some((e) => ends.has(e.to))) {
          ends.add(name);
          grew = true;
        }
      }
    }
    for (const name of reached) if (!ends.has(name)) err(stepPath(name), `${name} can be reached and never finish: every way on from it goes round without an end`, 2);
    for (const name of Object.keys(q.steps)) for (const a of q.steps[name].after) if (q.steps[a] && !reached.has(a)) err(stepPath(name, 'after'), `${name} waits on ${a}, which can never be done`, 2);

    // ---- rule 2 for a step waiting `after` others: each of them must be able to be done in one run ----
    // A step it waits on that may be skipped, or two that only a fork's different branches lead to, leave
    // it waiting for ever. The machine's watchdog would then hold the quest; a step whose onStuck says what
    // to do instead (skip, or go to another step) has said how that ends, and is let be.
    const branches = forks(q);
    for (const name of Object.keys(q.steps)) {
      const st = q.steps[name];
      if (!st.after.length || st.onStuck !== 'fail') continue;
      for (const a of st.after) {
        const w = q.steps[a];
        if (!w || !reached.has(a)) continue;
        if (w.unless.length || w.chance < 1) err(stepPath(name, 'after'), `${name} waits on ${a}, which may be skipped (${w.unless.length ? `unless ${w.unless.join(', ')}` : `a chance of ${w.chance}`}), and would then wait for ever: give ${name} an onStuck, or let ${a} always run`, 2);
      }
      for (let i = 0; i < st.after.length; i++)
        for (let j = i + 1; j < st.after.length; j++) {
          const a = st.after[i];
          const b = st.after[j];
          for (const f of branches) {
            const ia = f.only.findIndex((set) => set.has(a));
            const ib = f.only.findIndex((set) => set.has(b));
            if (ia < 0 || ib < 0 || ia === ib) continue;
            if (f.kind === 'when') warn(stepPath(name, 'after'), `${name} waits on ${a} and ${b}, which only different conditional edges of ${f.at} lead to: unless both conditions can hold at once, it waits for ever`, 2);
            else err(stepPath(name, 'after'), `${name} waits on ${a} and ${b}, but only one branch of ${f.at}'s ${f.kind === 'nextOne' ? 'nextOne' : 'options'} is ever taken, so it would wait for ever`, 2);
            break;
          }
        }
    }
  }

  // ---- rule 3 for a choice: something must choose it, an answer in a conversation or a step's action ----
  for (const id of Object.keys(set.quests)) {
    const q = set.quests[id];
    for (const name of Object.keys(q.steps)) {
      if (q.steps[name].type !== 'choice' || chosen.has(`${id}#${name}`)) continue;
      errors.push({ level: 'error', file: q.src.file, line: lineAt(q.src.lines, stepPath(name)), message: `${name} is a choice nothing ever makes: no answer or action says choose(${id}, ${name}, <option>)`, rule: 3 });
    }
  }

  // ---- rule 2 across quests: a circle of quests each given again the moment the last ends ----
  for (const cyc of instantCircles(set)) {
    const q = set.quests[cyc[0]];
    errors.push({ level: 'error', file: q.src.file, line: lineAt(q.src.lines, '/givers'), message: `${cyc.join(' -> ')} -> ${cyc[0]} is a circle: each is repeated always, finishes the moment it is given and gives the next, so one grant would never stop`, rule: 2 });
  }

  // ---- areas and objects ----
  for (const id of Object.keys(set.areas)) {
    const a = set.areas[id];
    if (worlds && !worlds.has(a.world)) errors.push({ level: 'error', file: a.src.file, line: lineAt(a.src.lines, '/world'), message: `${a.world} is not a world this game has`, rule: 7 });
  }
  for (const id of Object.keys(set.objects)) {
    const o = set.objects[id];
    if (worlds && !worlds.has(o.world)) errors.push({ level: 'error', file: o.src.file, line: lineAt(o.src.lines, '/world'), message: `${o.world} is not a world this game has`, rule: 7 });
  }
  counts.signals = signalsSeen.size;
  const order = (a: Issue, b: Issue): number => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);
  return { errors: errors.sort(order), warnings: warnings.sort(order), counts };
}

/** One issue as a line of text: `quests/goto.jsonc:12: error: ... (rule 3)`. */
export function issueLine(i: Issue, dir = ''): string {
  return `${dir ? `${dir.replace(/[\\/]$/, '')}/` : ''}${i.file}:${i.line}${i.col ? `:${i.col}` : ''}: ${i.level}: ${i.message}${i.rule ? ` (rule ${i.rule})` : ''}`;
}
