// The story's named people as a character knows them: who counts as named, whether they will speak, whether
// they are alive and what the character knows of it, and the People tab. Pure, so the server holds a book to
// the same rules the browser shows it by.
//
// **Named people only** (the owner's decision). A person has Standing, Trust, access and a life the story can
// end only when the story names them: one of a set's cast (`<set>:cast/<id>`), or one of the game's own people
// a cast file promotes (`{ "id", "row": "row:<key>", "name", "unknownAs" }`, which stands nobody: the world
// stands them already). Everybody else -- the crowd the world stands, met in passing -- keeps only the met and
// named stamps a conversation writes, and the rules refuse anything more for them (`quests.ts`), as the server
// does for a book handed up (`namedOnly`). A promoted person is kept under their row's key, so a promotion
// written by its cast id is the same person (`whoOf`).
//
// **Truth and knowledge are kept apart.** `alive` is the truth, and nothing the player sees reads it: the
// People tab shows only what the character knows (`known`), and a person the story killed simply stops
// appearing -- never stood again, never spoken to -- until a document says why (`kill(w, how, doc)`: once that
// page is in the journal, the tab shows them gone). The companion is the one exception, since a companion
// dies beside the player.
//
// **Access.** Open unless the story said otherwise: `refuse(w)` and they will not speak to the character,
// `vouch(by, w, cost)` and they will again. A track that has burned the character takes its contacts with it:
// a cast member whose side is that track's is refused too, until somebody vouches for the character to them.
//
// Every word here is ours.

import { ownOf, type Access, type NpcRec, type StoryBook } from './book.ts';
import { trackOfFaction } from './reactions.ts';
import type { CastDef, StorySet } from './set.ts';
import { statusOf, trackOf } from './standing.ts';
import type { TextRef } from './text.ts';

/** What a person the story killed is, to anybody who would speak to them. */
export const TALK_GONE = 'They are not there any more.';
/** What a person who has refused the character says, instead of anything else. */
export const TALK_REFUSED = 'They will not speak to you.';

/** The cast member a person is: by their cast id, or by the row a cast file promotes. Null for anybody the story does not name. */
export function castFor(lib: StorySet | null | undefined, who: string): CastDef | null {
  if (!lib?.cast) return null;
  if (Object.hasOwn(lib.cast, who)) return lib.cast[who];
  if (!who.startsWith('row:')) return null;
  for (const id of Object.keys(lib.cast)) if (lib.cast[id].row === who) return lib.cast[id];
  return null;
}

/** Whether the story names a person: a cast member, or a row a cast file promotes. */
export function isNamed(lib: StorySet | null | undefined, who: string): boolean {
  return castFor(lib, who) !== null;
}

/** The key a named person is kept under: a promoted row's own key, whichever way the story wrote them; anybody else as written. */
export function whoOf(lib: StorySet | null | undefined, who: string): string {
  const c = castFor(lib, who);
  return c?.row ?? who;
}

/** A person's record, or undefined. */
export function npcOf(book: Pick<StoryBook, 'npcs'> | null | undefined, who: string): NpcRec | undefined {
  return ownOf(book?.npcs, who);
}

/** Whether a person is alive: the truth, which only the rules read. */
export function aliveOf(book: Pick<StoryBook, 'npcs'> | null | undefined, who: string): boolean {
  return npcOf(book, who)?.alive !== false;
}

/** Whether the journal holds a document (a page read, a call heard). */
function witnessed(book: Pick<StoryBook, 'journal'>, doc: string): boolean {
  for (const e of book.journal ?? []) if ((e.kind === 'doc' || e.kind === 'comm') && e.doc === doc) return true;
  return false;
}

/** Whether the character knows a person is gone: they saw it, or the page that says so is in their journal. */
export function knownGone(book: Pick<StoryBook, 'npcs' | 'journal'>, who: string): boolean {
  const k = npcOf(book, who)?.known;
  if (!k) return false;
  return k.alive === false || (!!k.by && witnessed(book, k.by));
}

/**
 * Whether a person will speak to the character: what they said (`refused`, `vouched`), and otherwise refused
 * when they are a contact on a track that has burned the character, or open. `now` reads a suspension's end.
 */
export function accessOf(book: Pick<StoryBook, 'npcs' | 'tracks'>, lib: StorySet | null | undefined, who: string, now: number): Access {
  const own = npcOf(book, who)?.access;
  if (own === 'vouched' || own === 'refused') return own;
  const c = castFor(lib, who);
  if (c?.side) {
    const t = trackOfFaction(c.side);
    if (statusOf(trackOf(book, t), now) === 'burned') return 'refused';
  }
  return own ?? 'open';
}

/** Why a person will not speak to the character just now, in their words, or null: gone, or refused. */
export function whyNotSpeak(book: Pick<StoryBook, 'npcs' | 'tracks'>, lib: StorySet | null | undefined, who: string, now: number): string | null {
  if (!aliveOf(book, who)) return TALK_GONE;
  if (isNamed(lib, who) && accessOf(book, lib, who, now) === 'refused') return TALK_REFUSED;
  return null;
}

/** One person as the People tab shows them: by the name the character knows, where and when last seen, and gone once it is known. */
export interface PersonView {
  id: string;
  name: TextRef;
  lastSeenAt?: number;
  lastSeenWhere?: string;
  gone?: true;
}

/** The people the character has met whom the story names, the last seen first. */
export function peopleView(book: StoryBook, lib: StorySet): PersonView[] {
  const out: PersonView[] = [];
  for (const who of Object.keys(book.npcs ?? {})) {
    const rec = book.npcs![who];
    const c = castFor(lib, who);
    if (!c || rec.met === undefined) continue;
    const v: PersonView = { id: who, name: rec.named !== undefined ? c.name : c.unknownAs };
    // Met is seen: a record from before anybody was marked seen (or a person met some other way) was last seen
    // when it was met, which is truer than nothing for the tab to say.
    if (rec.lastSeenAt !== undefined) v.lastSeenAt = rec.lastSeenAt;
    else if (typeof rec.met === 'number' && rec.met > 0) v.lastSeenAt = rec.met;
    if (rec.lastSeenWhere) v.lastSeenWhere = rec.lastSeenWhere;
    if (knownGone(book, who)) v.gone = true;
    out.push(v);
  }
  out.sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** The fields of a person's record only a named person may have. */
const NAMED_FIELDS = ['standing', 'trust', 'access', 'alive', 'diedAt', 'how', 'known', 'lastSeenAt', 'lastSeenWhere'];

/**
 * A book held to the named-people rule, in place: every record of a person the story does not name keeps its
 * met and named stamps and loses the rest, and a companion who is not one of the story's companions is let go.
 * What a server does to a book handed up, which a browser on another story's sets may have written. Answers how
 * many records it cut.
 */
export function namedOnly(book: StoryBook, lib: StorySet): number {
  let n = 0;
  for (const who of Object.keys(book.npcs ?? {})) {
    if (isNamed(lib, who)) continue;
    const rec = book.npcs![who];
    if (!NAMED_FIELDS.some((k) => rec[k] !== undefined)) continue;
    const kept: NpcRec = {};
    if (rec.met !== undefined) kept.met = rec.met;
    if (rec.named !== undefined) kept.named = rec.named;
    book.npcs![who] = kept;
    n++;
  }
  if (book.companion && !castFor(lib, book.companion.who)?.companion) {
    book.companion = null;
    n++;
  }
  return n;
}
