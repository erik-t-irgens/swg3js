// The conversation window: who is speaking, what they said, and the numbered answers, in a band across
// the bottom of the screen with a bar of the dark above and below it, while everything else of the
// display stands aside.
//
// It is a window of our own and not a panel, which is the one decision here worth writing down. A panel
// joins `anyPanelOpen`, and while any panel is open the game does not simulate at all; a conversation is
// held in the world as it goes on round it, so the world keeps running and only the player's own keys are
// taken (`App.stepTalk`). The rest of the display is not taken down piece by piece but stood aside by one
// class on the interface's root, so nothing that draws itself need know a conversation is on: every child
// of `#ui` but this one is hidden while it lasts, the overlay canvas with the rest.
//
// It builds its own element and says what was chosen; it knows nothing about bodies, followers or the
// camera. Every colour on it is one of the eighteen.
//
// A story's conversation plays through it a line at a time (`say`): the speaker's name as the player knows
// it, each line in turn, the player's own answer as "You: ..." (`you`), and then the answers numbered, one
// that may not be chosen greyed with its reason and what is at stake shown under any answer that names it.
// While a line stands, a click on the window moves on (`onNext`), as any digit does. Nothing marks an
// answer as one under pressure. Every word goes in with `textContent`, so nobody's words are read as markup.

// Every class is the window's own (`talk-`): the page already has a `.bar` (the health bars, a fixed
// width), a `.bottom` (the display's own block, moved half its width left) and a `.keys` (the help's
// grid), and a bare name here would take their rules along with ours.
const TALK_CSS = `
#talk { position: fixed; inset: 0; pointer-events: none; }
#talk[hidden] { display: none; }
#ui.talking > :not(#talk) { visibility: hidden !important; }
#talk .talk-bar { position: absolute; left: 0; right: 0; height: 7vh; background: var(--void); opacity: 0.92; }
#talk .talk-top { top: 0; }
#talk .talk-bottom { bottom: 0; }
#talk .talk-box { position: absolute; left: 50%; bottom: calc(7vh + 18px); transform: translateX(-50%); width: min(680px, 92vw); display: flex; flex-direction: column; gap: 8px; padding: 12px 16px 12px; background: color-mix(in srgb, var(--plate) 70%, transparent); border: 1px solid var(--edge); border-radius: 4px; pointer-events: auto; }
#talk .talk-who { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
#talk .talk-banner { font-size: 11px; letter-spacing: 0.06em; color: var(--warn); }
#talk .talk-banner[hidden] { display: none; }
#talk .talk-line { font-size: 16px; line-height: 1.35; color: var(--ink); min-height: 1.35em; }
#talk .talk-options { display: flex; flex-direction: column; gap: 4px; }
#talk .talk-options[hidden] { display: none; }
#talk .talk-opt { font: inherit; font-size: 14px; text-align: left; color: var(--ink); background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 6px 10px; cursor: pointer; }
#talk .talk-opt:hover { border-color: var(--edge); color: var(--accent); }
#talk .talk-opt[disabled] { color: var(--muted); cursor: default; opacity: 0.6; }
#talk .talk-num { color: var(--accent); margin-right: 8px; }
#talk .talk-why { color: var(--muted); margin-left: 8px; font-size: 12px; }
#talk .talk-stakes { display: block; margin: 3px 0 0 22px; font-size: 12px; color: var(--warn); }
#talk .talk-line.talk-you { color: var(--muted); font-style: italic; }
#talk .talk-line.talk-wait { color: var(--muted); }
#talk .talk-keys { font-size: 11px; letter-spacing: 0.05em; color: var(--muted); }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = TALK_CSS;
  document.head.appendChild(style);
}

/** One answer as the window is told it: its words, whether it may be chosen, why not, and what is at stake. */
export interface TalkChoice {
  label: string;
  enabled: boolean;
  why: string;
  stakes?: string;
}

export class TalkUi {
  readonly root: HTMLElement;
  /** An answer chosen with the mouse, by its number from 1. */
  onPick: (n: number) => void = () => {};
  /** A click on the window while a line stands and no answer shows: on to the next line. */
  onNext: () => void = () => {};
  private readonly parent: HTMLElement;
  private readonly who: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly line: HTMLElement;
  private readonly options: HTMLElement;
  private readonly keys: HTMLElement;
  /** DOM writes, for the console: a conversation writes when it opens, is answered and ends, and never in between. */
  writes = 0;

  constructor(parent: HTMLElement) {
    installStyle();
    this.parent = parent;
    this.root = document.createElement('div');
    this.root.id = 'talk';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="talk-bar talk-top"></div>
      <div class="talk-bar talk-bottom"></div>
      <div class="talk-box">
        <div class="talk-who"></div>
        <div class="talk-banner" hidden></div>
        <div class="talk-line"></div>
        <div class="talk-options"></div>
        <div class="talk-keys"></div>
      </div>`;
    parent.appendChild(this.root);
    this.who = this.root.querySelector('.talk-who')!;
    this.banner = this.root.querySelector('.talk-banner')!;
    this.line = this.root.querySelector('.talk-line')!;
    this.options = this.root.querySelector('.talk-options')!;
    this.keys = this.root.querySelector('.talk-keys')!;
    // One listener for the life of the window: the buttons are made again with each conversation.
    this.options.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-n]');
      if (b && !b.disabled) this.onPick(Number(b.dataset.n));
    });
    // A click anywhere else on the box, while no answer is offered, moves a conversation on a line.
    this.root.querySelector('.talk-box')!.addEventListener('click', (e) => {
      if (this.options.hidden && !(e.target as HTMLElement).closest('button')) this.onNext();
    });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Open on somebody: their name, what they said, and the answers, numbered from 1. */
  show(name: string, said: string, choices: readonly TalkChoice[]): void {
    this.root.hidden = false;
    this.parent.classList.add('talking');
    this.who.textContent = name;
    this.line.textContent = said;
    this.line.classList.remove('talk-you', 'talk-wait');
    this.setChoices(choices);
    this.writes += 4;
  }

  /** The answers again (a choice refused a moment ago may be open now), or none while a reply stands. */
  setChoices(choices: readonly TalkChoice[]): void {
    this.options.hidden = !choices.length;
    // Built with the page's own nodes, so no word of anybody's is ever read as markup.
    this.options.replaceChildren(
      ...choices.map((c, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'talk-opt';
        b.dataset.n = String(i + 1);
        b.disabled = !c.enabled;
        const num = document.createElement('span');
        num.className = 'talk-num';
        num.textContent = `${i + 1}.`;
        b.append(num, c.label);
        if (!c.enabled && c.why) {
          const why = document.createElement('span');
          why.className = 'talk-why';
          why.textContent = `(${c.why})`;
          b.append(why);
        }
        if (c.stakes) {
          const stakes = document.createElement('span');
          stakes.className = 'talk-stakes';
          stakes.textContent = c.stakes;
          b.append(stakes);
        }
        return b;
      }),
    );
    this.keys.textContent = choices.length ? `1 to ${choices.length} to answer · Esc leaves` : '';
    this.writes += 2;
  }

  /** What they say back, with no answers under it. */
  reply(said: string): void {
    this.say(said);
  }

  /** One of the speaker's lines, with no answers under it: a click or any digit moves on. */
  say(line: string, more = false): void {
    this.line.textContent = line;
    this.line.classList.remove('talk-you', 'talk-wait');
    this.setChoices([]);
    if (more) this.keys.textContent = 'Click or any number for the next line · Esc leaves';
    this.writes += 2;
  }

  /** The player's own answer, said aloud. */
  you(said: string): void {
    this.line.textContent = `You: ${said}`;
    this.line.classList.remove('talk-wait');
    this.line.classList.add('talk-you');
    this.setChoices([]);
    this.writes += 2;
  }

  /** Waiting for somebody to answer (a server's node on its way). */
  waiting(): void {
    this.line.textContent = '…';
    this.line.classList.remove('talk-you');
    this.line.classList.add('talk-wait');
    this.setChoices([]);
    this.writes += 2;
  }

  /** The speaker's name, as the player knows it now (somebody who has just given their name). */
  setName(name: string): void {
    if (this.who.textContent === name) return;
    this.who.textContent = name;
    this.writes++;
  }

  /**
   * A note under the name, or none: `[structure only]` over a conversation the console plays from the
   * emulator's structure alone, whose handler did things nothing here does.
   */
  setBanner(text: string | null): void {
    const hidden = !text;
    if (this.banner.hidden === hidden && (hidden || this.banner.textContent === text)) return;
    this.banner.hidden = hidden;
    this.banner.textContent = text ?? '';
    this.writes += 2;
  }

  /** The words of the line standing, again, with nothing else moved: a line whose words have just come. */
  setLine(line: string): void {
    if (this.line.textContent === line) return;
    this.line.textContent = line;
    this.writes++;
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.parent.classList.remove('talking');
    this.options.replaceChildren();
    this.writes += 3;
  }

  /** For the console: what the window shows. */
  debug(): { open: boolean; who: string; banner: string | null; line: string; options: string[]; writes: number } {
    return {
      open: this.open,
      who: this.who.textContent ?? '',
      banner: this.banner.hidden ? null : (this.banner.textContent ?? ''),
      line: this.line.textContent ?? '',
      options: [...this.options.querySelectorAll('button')].map((b) => `${b.textContent ?? ''}${b.disabled ? ' [refused]' : ''}`),
      writes: this.writes,
    };
  }
}
