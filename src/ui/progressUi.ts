// The Progress section of the Skills tab: the character's four core skills and their milestones, the Skill Points
// spent of 250 and the challenge level they give (on this page only, never over a head), the Demolitions tree with
// what each node costs, who teaches it and where it stands for the character, the pool's banked experience, the
// rested bonus in words, and where the nearest trainer stands. It is a section and not a tab: the inventory's
// strip already holds seven and does not wrap, and Progression II turns this tab into one list of techniques, so
// the skills, the tree and the slots start out together.
//
// **It writes to the page on open and on a change of the record, and never in a frame**: the game calls `render`
// from the tab's own render and from the record's change, and nothing else. Learning and giving back ask the
// game, which asks the rules (`src/progress/learn.ts`): the page never decides a cost of its own. Its colours
// are the palette's names only, through `var(--…)` (`hudPage.test.ts` holds every injected stylesheet to it).

import { challengeOf } from '../progress/challenge.ts';
import { BUILT_CORE, CORE, ratingOf } from '../progress/core.ts';
import { DISCIPLINES, TIER_COST, type NodeDef } from '../progress/disciplines.ts';
import { learnCost, nodeState, surrenderFee, teaches, type NodeState } from '../progress/learn.ts';
import { restedAt } from '../progress/payout.ts';
import { spSpent, type ProgressRecord } from '../progress/record.ts';
import { PROGRESS_RULES } from '../progress/tune.ts';

const PROGRESS_CSS = `
.pg { margin: 0 0 10px; padding: 0 0 10px; border-bottom: 1px solid var(--rule); }
.pg-head { font-size: 13px; color: var(--ink); margin: 2px 0 6px; }
.pg-head b { color: var(--accent); font-weight: 600; }
.pg-head .muted { color: var(--muted); }
.pg-rested { font-size: 12px; color: var(--good); margin: 0 0 6px; }
.pg-skills { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; }
.pg-skill .pg-name { font-size: 13px; color: var(--ink); }
.pg-skill .pg-name b { color: var(--accent); margin-left: 4px; }
.pg-skill .pg-name small { color: var(--muted); margin-left: 6px; }
.pg-bar { position: relative; height: 6px; margin: 3px 0; background: color-mix(in srgb, var(--ink) 10%, transparent); border-radius: 3px; }
.pg-bar > i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--pool); border-radius: 3px; }
.pg-bar > s { position: absolute; top: -2px; bottom: -2px; width: 1px; background: var(--edge); }
.pg-bar > s.on { background: var(--accent); }
.pg-miles { font-size: 11px; color: var(--muted); line-height: 1.35; }
.pg-miles .on { color: var(--ink); }
.pg-miles .wait { font-style: italic; }
.pg-later { font-size: 11px; color: var(--muted); margin: 6px 0 4px; }
.pg-tree { margin: 10px 0 0; }
.pg-tree-head { font-size: 13px; color: var(--ink); margin: 0 0 4px; }
.pg-tree-head b { color: var(--accent); }
.pg-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin: 4px 0; }
.pg-row.one { grid-template-columns: minmax(0, 1fr); width: 50%; margin-left: auto; margin-right: auto; }
.pg-branch { font-size: 11px; color: var(--muted); text-align: center; }
.pg-cell { border: 1px solid var(--rule); border-radius: 3px; padding: 4px 6px; font-size: 11px; background: color-mix(in srgb, var(--void) 35%, transparent); }
.pg-cell.owned { border-color: var(--good); }
.pg-cell.learnable { border-color: var(--accent); }
.pg-cell .n { font-size: 12px; color: var(--ink); }
.pg-cell .c { color: var(--muted); }
.pg-cell .t { color: var(--muted); margin-top: 2px; }
.pg-cell .si { color: var(--warn); margin-top: 2px; }
.pg-cell .s { margin-top: 2px; color: var(--muted); }
.pg-cell.owned .s { color: var(--good); }
.pg-cell button { margin-top: 3px; font-size: 11px; }
.pg-cell button.armed { color: var(--warn); border-color: var(--warn); }
.pg-trainer { font-size: 12px; margin: 8px 0 0; color: var(--ink); }
.pg-trainer button { margin-left: 6px; font-size: 11px; }
.pg-stats { margin: 8px 0 0; font-size: 11px; color: var(--muted); }
.pg-stats table { border-collapse: collapse; margin-top: 4px; }
.pg-stats td { padding: 1px 6px; border-bottom: 1px solid var(--rule); color: var(--ink); }
.pg-stats td.moved { color: var(--accent); }
`;

let styled = false;
function installStyle(): void {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = PROGRESS_CSS;
  document.head.appendChild(style);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
}

const n = (x: number): string => Math.round(x).toLocaleString('en-GB');

/** The trainer the player is learning from: the kind of person, the name the page says, and the developer's stand-in. */
export interface ProgressTeacher {
  who: string;
  name: string;
  dev: boolean;
  body: { readonly removed: boolean; readonly dead: boolean; readonly pos: { readonly x: number; readonly z: number } } | null;
}

/** Where the nearest trainer is, as the game words it, and whether it can be marked as a waypoint. */
export interface TrainerLine {
  text: string;
  mark: boolean;
}

/** One row of the developer's Stats fold: `__debug.stat()`'s table. */
export interface StatRowView {
  id: string;
  label: string;
  base: number | string;
  value: number;
  moved: boolean;
}

/** Everything the section draws, handed in by the game on each render. */
export interface ProgressModel {
  /** Who holds the record: this browser, a server, nobody just now. */
  holder: string;
  rec: ProgressRecord | null;
  /** The shared clock in whole seconds, for the relearn window and the rested bonus. */
  now: number;
  teacher: ProgressTeacher | null;
  trainer: TrainerLine;
  /** The developer's Stats fold (a DEV build only), or null. */
  stats: StatRowView[] | null;
}

const STATE_WORDS: Record<NodeState, string> = {
  owned: 'learnt',
  learnable: 'learnable here',
  needsXp: 'needs experience',
  needsTrainer: 'needs a trainer',
  needsSp: 'needs Skill Points',
  locked: 'locked',
};

const HOLDER_WORDS: Record<string, string> = {
  local: 'kept in this browser',
  server: 'kept by the server',
  held: 'waiting for the server',
};

export class ProgressUi {
  private host: HTMLElement | null = null;
  private model: ProgressModel | null = null;
  /** A node whose Give back has been pressed once: the second press gives it back. */
  private armed: string | null = null;
  /** How many times the section has been drawn, for the console: it should not climb in a steady frame. */
  renders = 0;
  /** Learn a node, from the trainer in reach (the game asks the rules). */
  onLearn: (id: string) => void = () => {};
  /** Give a node back to the trainer in reach, for its fee. */
  onSurrender: (id: string) => void = () => {};
  /** Mark the nearest trainer on this world as a waypoint. */
  onMark: () => void = () => {};

  /** The element the section is drawn into, once: every click on it is read here. */
  mount(el: HTMLElement): void {
    if (this.host === el) return;
    installStyle();
    this.host = el;
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b || !el.contains(b)) return;
      const learn = b.dataset.learn;
      const give = b.dataset.give;
      if (learn) {
        this.armed = null;
        this.onLearn(learn);
      } else if (give) {
        if (this.armed === give) {
          this.armed = null;
          this.onSurrender(give);
        } else {
          this.armed = give;
          if (this.model) this.render(this.model);
        }
      } else if (b.dataset.mark) this.onMark();
    });
  }

  /** Draw the section from the model the game hands in. Called on open and on a change, never in a frame. */
  render(model: ProgressModel): void {
    this.model = model;
    const el = this.host;
    if (!el) return;
    this.renders++;
    el.innerHTML = this.html(model);
  }

  /** The section's markup, from the model: pure but for the armed button, so a test can read it. */
  html(m: ProgressModel): string {
    const rec = m.rec;
    if (!rec) return '<div class="pg"><div class="pg-head muted">No character in play.</div></div>';
    const rules = PROGRESS_RULES;
    const sp = spSpent(rec);
    const out: string[] = [];
    out.push('<div class="pg">');
    out.push(`<div class="pg-head">Progress, ${esc(HOLDER_WORDS[m.holder] ?? m.holder)} · Skill Points <b>${sp}</b> of ${rules.spCap} spent · challenge level <b>${challengeOf(sp)}</b></div>`);
    const rested = restedAt(rec, m.now, rules);
    if (rested > 0) out.push(`<div class="pg-rested">Rested: your next fights pay double, for ${n(rested)} experience more.</div>`);
    out.push('<div class="pg-skills">');
    for (const s of BUILT_CORE) {
      const def = CORE.find((c) => c.id === s)!;
      const r = ratingOf(rec.core[s] ?? 0, rules);
      const marks = def.milestones.map((mi) => `<s class="${r >= mi.at ? 'on' : ''}" style="left:${mi.at}%"></s>`).join('');
      const miles = def.milestones
        .map((mi) => `<div class="${r >= mi.at ? 'on' : ''}${mi.waits ? ' wait' : ''}">${mi.at} ${esc(mi.name)}${mi.waits ? `: ${esc(mi.waits)}` : r >= mi.at ? '' : `: ${esc(mi.text)}`}</div>`)
        .join('');
      out.push(`<div class="pg-skill"><div class="pg-name">${esc(def.name)}<b>${r}</b><small>${n(rec.core[s] ?? 0)} experience</small></div><div class="pg-bar"><i style="width:${r}%"></i>${marks}</div><div class="pg-miles">${miles}</div></div>`);
    }
    out.push('</div>');
    const later = CORE.filter((c) => !c.built).map((c) => c.name);
    out.push(`<div class="pg-later">Not yet: ${esc(later.join(', '))}.</div>`);
    for (const d of DISCIPLINES) {
      const bank = rec.pools[d.id] ?? 0;
      out.push(`<div class="pg-tree"><div class="pg-tree-head">${esc(d.name)} · <b>${n(bank)}</b> experience banked${rec.earned?.[d.id] ? ` · ${n(rec.earned[d.id] ?? 0)} earned in all` : ''}</div>`);
      const cell = (node: NodeDef | undefined): string => (node ? this.cell(node, m) : '<div></div>');
      out.push(`<div class="pg-row one">${cell(d.nodes.find((x) => x.branch === null && x.tier === 0))}</div>`);
      out.push(`<div class="pg-row">${d.branches.map((b) => `<div class="pg-branch">${esc(b.name)}</div>`).join('')}</div>`);
      for (let tier = 1; tier <= 4; tier++) out.push(`<div class="pg-row">${d.branches.map((b) => cell(d.nodes.find((x) => x.branch === b.id && x.tier === tier))).join('')}</div>`);
      out.push(`<div class="pg-row one">${cell(d.nodes.find((x) => x.branch === null && x.tier > 0))}</div>`);
      out.push('</div>');
    }
    out.push(`<div class="pg-trainer">${esc(m.trainer.text)}${m.trainer.mark ? '<button data-mark="1">Mark it</button>' : ''}</div>`);
    if (m.stats) {
      const rows = m.stats.map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.label)}</td><td>${typeof s.base === 'number' ? +s.base.toFixed(4) : esc(String(s.base))}</td><td class="${s.moved ? 'moved' : ''}">${+s.value.toFixed(4)}</td></tr>`).join('');
      out.push(`<details class="pg-stats"><summary>Stats (developer)</summary><table>${rows}</table></details>`);
    }
    out.push('</div>');
    return out.join('');
  }

  /** One node of the tree: its name, what it costs and who teaches it, its words, where it stands, and the button that acts on it. */
  private cell(node: NodeDef, m: ProgressModel): string {
    const rec = m.rec!;
    const teacher = m.teacher?.who ?? null;
    const state = nodeState(rec, node.id, teacher, m.now, PROGRESS_RULES);
    const tier = TIER_COST[node.tier];
    const cost = learnCost(rec, node, m.now, PROGRESS_RULES);
    const relearn = cost !== tier.xp ? ' (relearn)' : '';
    let act = '';
    if (state === 'learnable') act = `<button data-learn="${esc(node.id)}">Learn</button>`;
    else if (state === 'owned' && teaches(teacher, node)) {
      const fee = surrenderFee(node, PROGRESS_RULES);
      act = this.armed === node.id ? `<button class="armed" data-give="${esc(node.id)}">Give back for ${n(fee)} credits?</button>` : `<button data-give="${esc(node.id)}">Give back (${n(fee)} credits)</button>`;
    }
    return `<div class="pg-cell ${state}" title="${esc(node.note ?? node.text)}"><div class="n">${esc(node.name)}</div><div class="c">${tier.sp} SP · ${n(cost)} XP${relearn} · ${tier.teacher ? 'a trainer' : 'anywhere'}</div><div class="t">${esc(node.text)}</div>${node.standIn ? `<div class="si">${esc(node.standIn)}</div>` : ''}<div class="s">${STATE_WORDS[state]}</div>${act}</div>`;
  }
}
