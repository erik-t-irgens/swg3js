// Which hulls stand in a flow unhurt.
//
// The client carries the list itself: one small terrain table names the vehicle templates that take
// no damage from the water they are standing in, which is what its lava-going craft and its
// jetpacks were for. Nothing in that list is ours and none of it is typed out here -- the converter
// writes it into a planet's `water.json` and this file only finds it there, reduces both sides to
// one key and answers yes or no.
//
// Pure, and it imports nothing, so a node test runs exactly what the game runs. It keeps two things,
// as a registry, the way the peers' rooms are a registry, so that nothing in the vehicles has to
// import the world's water reader and nothing has to look a hull up per frame -- a hull is joined
// once, when it is spawned. The two are the list the planet's pack last handed over, and the
// templates this build carries, which the garage hands over when its manifests are read.
//
// The second is there for one reason: the only honest report of a join across two spellings is how
// many of the client's names this build actually carries. A count of the pack's own rows is the same
// number whether every name joins or none does, which makes it no report at all -- so when both ends
// are known, and only then, one line says both sides and names the misses.
//
// There is not a number in this file. The list is the client's; how a name is reduced to a key
// (the file's own name, without `shared_` and without the extension) is ours, and is the one
// judgement call here: the client's table names `<folder>/<name>.iff` while the packs convert
// `<folder>/shared_<name>.iff`, so the basename is the only thing the two spellings share.

/** Everything known about who takes no damage from a flow, as one record. */
export interface LavaImmunity {
  /** 'pack' when a converted pack has said (even to say none of them), 'none' when nothing has yet. */
  source: 'pack' | 'none';
  /** The templates as the pack spelled them, for the console and the join report. */
  templates: readonly string[];
  /** Their keys, which is what a join actually tests. */
  keys: ReadonlySet<string>;
}

/**
 * Nothing has been said: nobody is immune. What a pack converted before this change leaves in place.
 *
 * Frozen, and so is each of its parts, because one object is handed back to every caller that asks
 * about a world with no pack to say: `readonly` is a promise the compiler keeps and the console
 * does not. (A `Set`'s contents live in an internal slot, so freezing it stops a field being added
 * and not an `add` call; nothing is ever handed this record to write, and the registry replaces the
 * record rather than writing into it.)
 */
export const NO_LAVA_IMMUNITY: LavaImmunity = Object.freeze({
  source: 'none',
  templates: Object.freeze([]) as readonly string[],
  keys: Object.freeze(new Set<string>()) as ReadonlySet<string>,
});

/**
 * A template name reduced to the key both sides join on: the file's own name, without a `shared_`
 * prefix, without the `.iff` extension, lower case. Backslashes count as separators, since a
 * client data path may carry either. Anything that is not a string is no key at all ('').
 */
export function immunityKey(template: string | null | undefined): string {
  if (typeof template !== 'string') return '';
  // The trim comes first: a hand-written list picks up spaces at both ends, and a trailing one
  // would leave the extension looking like part of the name.
  return template
    .trim()
    .replace(/\\/g, '/')
    .replace(/^.*\//, '')
    .replace(/\.iff$/i, '')
    .replace(/^shared_/i, '')
    .trim()
    .toLowerCase();
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Whether a parsed `water.json` carries the list at all -- which is the one thing the list's own
 * reader cannot say. There is exactly **one** parser of the block, `lavaImmuneTemplates` in
 * `lavaHarmMath.ts`, beside the rest of what that block means, and it hands back the names it finds;
 * an empty list back from it means either "the pack names nobody" or "there is no pack to name
 * anybody", and those two read very differently in the console: the first is a converted pack whose
 * table came out empty, which is worth a look, and the second is every pack converted before this
 * change, which is expected and says nothing.
 *
 * So this is a presence probe and not a second parser: it accepts exactly the shapes that parser
 * accepts (`harm.immune` as an array, or as an object carrying `templates`) and reads none of them.
 * Keep the two in step -- a shape added there wants a line here, and nowhere else.
 */
export function packNamesImmunity(json: unknown): boolean {
  if (!isObject(json)) return false;
  const harm = json.harm;
  if (!isObject(harm)) return false;
  const list = harm.immune;
  return Array.isArray(list) || (isObject(list) && Array.isArray(list.templates));
}

/** A list turned into the record the game keeps. Null or absent gives the "nothing has said" record back. */
export function lavaImmunityOf(list: readonly string[] | null | undefined): LavaImmunity {
  if (!list) return NO_LAVA_IMMUNITY;
  const templates: string[] = [];
  const keys = new Set<string>();
  for (const t of list) {
    const key = immunityKey(t);
    if (!key) continue;
    templates.push(t);
    keys.add(key);
  }
  return { source: 'pack', templates, keys };
}

/** Whether one template is on a list: the join, as one call, so the rule has exactly one spelling. */
export function isLavaImmune(template: string | null | undefined, immunity: LavaImmunity): boolean {
  const key = immunityKey(template);
  return key !== '' && immunity.keys.has(key);
}

/**
 * What a list joins onto a set of templates: which of them it names, and which of its own names
 * nothing carries. For the report and for the node test, never in a frame.
 */
export function joinImmunity(templates: Iterable<string | null | undefined>, immunity: LavaImmunity): { joined: string[]; missing: string[] } {
  const seen = new Set<string>();
  const joined: string[] = [];
  for (const t of templates) {
    const key = immunityKey(t);
    if (!key || !immunity.keys.has(key) || seen.has(key)) continue;
    seen.add(key);
    joined.push(key);
  }
  const missing: string[] = [];
  for (const key of immunity.keys) if (!seen.has(key)) missing.push(key);
  return { joined, missing };
}

// --- the registry ---------------------------------------------------------------------------------

let current: LavaImmunity = NO_LAVA_IMMUNITY;
/**
 * Every template this build actually carries, as the garage spells them. It is the other half of
 * the only question worth printing: a count of the client's own rows says nothing about whether the
 * two spellings meet, and a list that joins to nothing looks exactly like a list that joins to
 * everything if all that is printed is how long it is.
 */
let carried: readonly string[] | null = null;
/** The last thing said, so that a second pack, a second garage or a reload says nothing twice. */
let lastSaid = '';

/**
 * The planet's pack has been read: this is what it says about who a flow cannot hurt. Called once
 * per pack, before anything can be spawned on that planet, and with null (or nothing) wherever
 * there is no pack to say -- a space zone, a world left, a pack converted before the list existed.
 * Returns the record it put in place.
 */
export function setLavaImmunity(list: readonly string[] | null | undefined): LavaImmunity {
  current = lavaImmunityOf(list);
  sayJoin();
  return current;
}

/**
 * What this build carries, handed over once by whatever holds the models -- the garage, when its
 * manifests are read. The list and the garage arrive in either order (a planet's pack is read on a
 * world load, the garage on the first thing that needs one), so both ends call the report and it
 * prints when both are known.
 */
export function setImmunityCatalogue(templates: Iterable<string | null | undefined>): void {
  const out: string[] = [];
  for (const t of templates) if (typeof t === 'string' && t.trim()) out.push(t);
  carried = out;
  sayJoin();
}

/**
 * The one line the owner reads to know whether this works: how many the client's own list names,
 * how many of them this build carries, and which. A join that finds nothing is a **warning**,
 * because that is what a wrong key, a renamed converter field or a list of server templates with no
 * client sibling all look like, and it is otherwise indistinguishable from a build where nothing
 * happens to be immune.
 */
function sayJoin(): void {
  const immunity = lavaImmunity();
  // No pack has said anything (a space zone, a world left, a pack converted before the list
  // existed) -- that is not news, and the harm's own warning already asks for a reconversion.
  if (!carried || immunity.source === 'none') return;
  const n = immunity.keys.size;
  if (!n) {
    say(false, "lava: this pack carries the client's list of what a flow cannot hurt and it names nobody, so everything burns");
    return;
  }
  const { joined, missing } = joinImmunity(carried, immunity);
  const lines = [
    `lava: the client's own list names ${n} that take no damage from a flow; this build carries ${joined.length} of them and has no model for ${missing.length}`,
    joined.length ? `  carried: ${joined.join(', ')}` : '',
    missing.length ? `  not in this build: ${missing.join(', ')}` : '',
    // Said every time, because it is the one place the owner can see it: the client's table gives
    // each row a resistance and this wave reads none of it, so a row is all or nothing.
    '  each of them takes no damage at all: the table gives a resistance per row and that column is not modelled',
  ].filter(Boolean);
  say(joined.length === 0, lines.join('\n'));
}

function say(warn: boolean, message: string): void {
  if (message === lastSaid) return;
  lastSaid = message;
  if (warn) console.warn(`${message}\n  nothing joined: the two spellings do not meet, so nothing is immune`);
  else console.info(message);
}

/** What is in force now, for the console and for a join. */
export function lavaImmunity(): LavaImmunity {
  return current;
}

/** The join itself, as everything that spawns a hull asks it: one lookup, at spawn, never per frame. */
export function lavaImmuneTemplate(template: string | null | undefined): boolean {
  return isLavaImmune(template, current);
}
