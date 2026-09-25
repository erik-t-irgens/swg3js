// What this character has to spend, on this browser's side.
//
// Credits are a number on the character and not a thing in a backpack, so there is no list and no
// row: there is one number, where it came from, and a way to ask for something to be taken out of
// it. With a server the server holds it and this is a cache of the last thing it said; with none
// the number lives on the saved character exactly as its clothes and its powers do.
//
// The one rule: **with a server, nothing here ever takes money off.** A spend is asked for and the
// server's answer is what may be acted on, because a browser that subtracted first and told the
// server afterwards would be a browser deciding what it can afford. With no server there is nobody
// to ask and the number here is the truth, which is the same bargain every other saved thing makes.

/** Every number of ours. The fares themselves are the game's. */
export const PURSE_TUNE = {
  /** What a character has with no server at all, the first time it is asked. Matches the server's own. */
  start: 25000,
};

export interface PurseDeps {
  /** Send a word to the server. */
  send(msg: Record<string, unknown>): void;
  /** Say something to the player, once. */
  say(text: string): void;
  /** Whether a server is answering. */
  shared(): boolean;
  /** Read and write the number on the saved character, for when no server is. */
  saved(): number | null;
  save(credits: number): void;
}

export class Purse {
  private deps: PurseDeps | null = null;
  /**
   * Whoever wants telling when the number moves: the backpack's header and the travel terminal's
   * line, which are both open while a fare is paid. It is a plain callback rather than a list
   * because a panel that is shut has nothing to redraw and one that is open reads it again anyway.
   */
  onChange: () => void = () => {};
  /** What the server last said, or what the character was saved with. */
  private held = 0;
  /** Whether anything has ever told us a number. */
  known = false;
  /** The last thing the server refused, for the console. */
  lastWhy = '';
  /** What a spend was waiting on, so the answer can be acted on when it comes. */
  private waiting: { what: string; then: () => void } | null = null;

  attach(deps: PurseDeps): void {
    this.deps = deps;
  }

  /** What this character has. */
  get credits(): number {
    if (!this.known && this.deps && !this.deps.shared()) {
      const saved = this.deps.saved();
      this.held = saved ?? PURSE_TUNE.start;
      this.known = true;
      if (saved === null) this.deps.save(this.held);
    }
    return this.held;
  }

  /** A character was put on, or taken off: forget what the last one had. */
  reset(): void {
    this.known = false;
    this.held = 0;
    this.waiting = null;
  }

  /** Ask the server what this character has. Does nothing with no server: the number is already here. */
  ask(): void {
    if (this.deps?.shared()) this.deps.send({ t: 'purse', do: 'ask' });
  }

  /**
   * Ask for an amount to be taken out, and do `then` if it is.
   *
   * With a server the answer decides and `then` runs when it comes; with none the answer is here
   * and `then` runs at once. Either way `then` runs **only** if the money really moved, which is
   * what keeps a fare from being paid twice or a ride from being free.
   */
  spend(amount: number, what: string, then: () => void): void {
    const n = Math.max(0, Math.round(amount));
    if (!n) {
      then();
      return;
    }
    if (this.deps?.shared()) {
      this.waiting = { what, then };
      this.deps.send({ t: 'purse', do: 'spend', credits: n, what });
      return;
    }
    if (this.credits < n) {
      this.deps?.say(`${what} costs ${n.toLocaleString('en-GB')} and you have ${this.credits.toLocaleString('en-GB')}`);
      return;
    }
    this.held = this.credits - n;
    this.deps?.save(this.held);
    this.onChange();
    then();
  }

  /** Put an amount in, with no server. With one, only the server's admin may. */
  give(amount: number): number {
    const n = Math.max(0, Math.round(amount));
    if (this.deps?.shared()) {
      this.deps.send({ t: 'purse', do: 'give', credits: n });
      return this.held;
    }
    this.held = this.credits + n;
    this.deps?.save(this.held);
    this.onChange();
    return this.held;
  }

  /** The server's word about the purse, handed over whole. */
  word(msg: Record<string, unknown>): void {
    if (msg.t !== 'purse') return;
    if (typeof msg.credits === 'number' && Number.isFinite(msg.credits)) {
      const was = this.held;
      this.held = Math.max(0, Math.floor(msg.credits));
      this.known = true;
      if (was !== this.held) this.onChange();
    }
    if (typeof msg.why === 'string' && msg.why) {
      this.lastWhy = msg.why;
      this.deps?.say(msg.why);
      this.waiting = null;
      return;
    }
    // A spend that really happened: the server says how much it took, and only then is the thing
    // that was paid for done.
    if (typeof msg.spent === 'number' && this.waiting) {
      const go = this.waiting.then;
      this.waiting = null;
      go();
    }
  }

  /** What `__debug.purse()` prints. */
  report(): { credits: number; known: boolean; shared: boolean; waiting: string | null; lastWhy: string } {
    return { credits: this.credits, known: this.known, shared: this.deps?.shared() ?? false, waiting: this.waiting?.what ?? null, lastWhy: this.lastWhy };
  }
}

/** One for the session, as the rest of the net's own pieces are. */
export const purse = new Purse();

/** A number of credits in words, the way every panel writes one. */
export function creditText(n: number): string {
  return `${Math.round(n).toLocaleString('en-GB')} credits`;
}
