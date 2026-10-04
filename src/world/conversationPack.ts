// What the game's own people say, as the browser has it: the `conversations` command's two files
// (`assets-private/conversations/core3.json` and `speakers.json`), fetched once a session and folded with the
// adoptions of ours by the very rules a server folds the whole reference with (`src/story/core3Trees.ts`).
//
// It answers four questions and holds nothing else: the set of the server's conversations the local host
// joins to the story's own (`set`), how a creature speaks (`voiceOf`: its conversation, its reaction table's
// diction and its faction), which rows a world stands beside its pack's (`standRows`: the heralds, whom no pack
// stands), and which of the client's string tables somebody's words are in (`tablesFor`), which the game fetches
// before they are spoken to. A browser with no such files has none of it, and the game's people greet in our
// own words as they always did.
//
// Pure of three and of the page but for `fetch`, which is handed in.

import { captureOf, core3Set, readOverlays, tablesOf, voicesOf, type Core3Report, type Core3Voice } from '../story/core3Trees.ts';
import type { StorySet } from '../story/set.ts';
import { reactionTable } from '../story/reactions.ts';
import type { StandingRow } from './standingPeople.ts';

/** The shape of the files this reads; one of another is left unread, and `status` asks for it again. */
const FORMAT = 1;

type Fetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export class ConversationPack {
  private folded: StorySet | null = null;
  private folding: Core3Report | null = null;
  private readonly voices: Record<string, Core3Voice> = Object.create(null);
  private readonly stand: Record<string, StandingRow[]> = Object.create(null);
  /** Each creature's tables, worked out the first time it is asked and kept. */
  private readonly tables = new Map<string, readonly string[]>();
  /** The trees whose every reachable line and answer has the client's words: what the console may review. */
  private readonly complete = new Set<string>();
  private loading: Promise<void> | null = null;
  /** What the load came to, for the console. */
  status: 'not asked' | 'loading' | 'ready' | 'absent' | 'old' = 'not asked';
  problems: string[] = [];

  /**
   * Fetch the two files and fold them, once a session: `base` is the page's own base, `adoptions` the
   * adoption files (the bundle's, `core3AdoptionFiles`). A second call answers the first one's promise.
   */
  load(base: string, adoptions: () => Promise<{ path: string; text: string }[]>, fetcher: Fetcher = (u) => fetch(u)): Promise<void> {
    if (this.loading) return this.loading;
    this.status = 'loading';
    const root = `${base.endsWith('/') ? base : `${base}/`}assets-private/conversations/`;
    this.loading = (async () => {
      try {
        const [c, s, files] = await Promise.all([fetcher(`${root}core3.json`), fetcher(`${root}speakers.json`), adoptions()]);
        if (!c.ok || !s.ok) {
          this.status = 'absent';
          return;
        }
        const core3 = (await c.json()) as Record<string, unknown>;
        const speakers = (await s.json()) as Record<string, unknown>;
        if (core3?.format !== FORMAT || speakers?.format !== FORMAT) {
          this.status = 'old';
          return;
        }
        this.adopt(core3, speakers, files);
      } catch (err) {
        this.status = 'absent';
        this.problems.push(err instanceof Error ? err.message : String(err));
      }
    })();
    return this.loading;
  }

  /** What `load` does once the files are in hand: the half a node test can drive. */
  adopt(core3: unknown, speakers: unknown, adoptions: readonly { path: string; text: string }[]): void {
    const sp = (speakers ?? {}) as Record<string, unknown>;
    Object.assign(this.voices, voicesOf(sp.who));
    const stand = (sp.stand ?? {}) as Record<string, unknown>;
    for (const world of Object.keys(stand)) {
      const rows = stand[world];
      if (!Array.isArray(rows)) continue;
      this.stand[world] = rows.filter((r): r is StandingRow => !!r && typeof r === 'object' && typeof (r as StandingRow).key === 'string' && typeof (r as StandingRow).who === 'string' && typeof (r as StandingRow).id === 'string' && [(r as StandingRow).x, (r as StandingRow).y, (r as StandingRow).z].every((n) => typeof n === 'number' && Number.isFinite(n)));
    }
    const o = readOverlays(adoptions);
    for (const e of o.errors) this.problems.push(`${e.file}:${e.line}: ${e.message}`);
    const built = core3Set(captureOf(core3), this.voices, o.overlays);
    this.folded = built.set;
    this.folding = built.report;
    this.complete.clear();
    for (const name of Object.keys(built.folds)) if (built.folds[name].complete) this.complete.add(name);
    this.tables.clear();
    this.status = 'ready';
  }

  /**
   * Why a tree cannot be read through in review (`__debug.talkTree({ core3 })`), or null when it can: it is
   * here, and every line and answer its entry reaches has the client's words, whatever its handler did.
   */
  whyNotReview(name: string): string | null {
    if (!this.folded) return `no conversations are here (${this.status})`;
    if (!Object.hasOwn(this.folded.talks, `core3:talk/${name}`)) return `${name} is not one of the conversations here (only those somebody the packs stand speaks are written)`;
    if (!this.complete.has(name)) return `${name} has lines or answers its handler writes, which the structure has not got`;
    return null;
  }

  /** Settled once the load is (or straight away when none was asked for). */
  get pending(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  /** The server's conversations as a set the local host joins to the story's (`LocalHost.useCore3`), or null. */
  get set(): StorySet | null {
    return this.folded;
  }

  /** How a creature speaks: its conversation, its reaction table's diction and its faction; null for one that has none. */
  voiceOf(who: string | null | undefined): Core3Voice | null {
    return who && Object.hasOwn(this.voices, who) ? this.voices[who] : null;
  }

  /** Whether a creature is given a conversation that is played (an adopted tree): what asks a server for one. */
  voiced(who: string): boolean {
    return !!this.folded?.voices && Object.hasOwn(this.folded.voices, who);
  }

  /** The rows a world stands beside its own pack's: the heralds. Copies, since the people's pass moves its own. */
  standRows(world: string): StandingRow[] {
    return Object.hasOwn(this.stand, world) ? this.stand[world].map((r) => ({ ...r })) : [];
  }

  /** Every client string table a creature's words are in: its conversation's, and its reaction table. Kept. */
  tablesFor(who: string): readonly string[] {
    const had = this.tables.get(who);
    if (had) return had;
    const out: string[] = [];
    const v = this.voiceOf(who);
    const id = this.folded?.voices && Object.hasOwn(this.folded.voices, who) ? this.folded.voices[who] : null;
    if (id && this.folded && Object.hasOwn(this.folded.talks, id)) out.push(...tablesOf(this.folded.talks[id]));
    if (v?.diction) out.push(reactionTable(v.diction));
    const list = Object.freeze(out);
    this.tables.set(who, list);
    return list;
  }

  /** For the console. */
  report(): Record<string, unknown> {
    const r = this.folding;
    return {
      status: this.status,
      speakers: Object.keys(this.voices).length,
      stand: Object.fromEntries(Object.keys(this.stand).map((w) => [w, this.stand[w].length])),
      trees: r?.trees ?? 0,
      played: r ? [...r.played] : [],
      adopted: r ? [...r.adopted] : [],
      unplayable: r ? { ...r.unplayable } : {},
      voiced: r?.voiced ?? 0,
      reviewable: [...this.complete].sort(),
      problems: [...this.problems],
    };
  }
}

/** The one the game reads. */
export const conversationPack = new ConversationPack();
