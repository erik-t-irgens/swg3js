// The crosshair and the grapple (the interface rewrite's second wave, item 10): what `Hud.draw` strokes on the overlay,
// read off a stand-in overlay that records every call. The crosshair's four lines from 7 px out to 11; the grapple's
// diamond 6 out and 1.4 thick, inside those lines, in its colours as they were; the rope ring drawn like the charge ring
// (a faint full circle in `muted` with the filled arc on it, clockwise from twelve, at the charge ring's own size), in
// `muted` and amber (`warn`) past half the longest rope, stepping out by its own width while a shot charges; and in
// twelve fresh processes at once, nothing made by a frame that draws all of it.
//
// Everything here is synthetic: stand-ins for the page and the overlay, a made-up kit. Run: node tools/swg/tests/crosshair.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const ALLOC = process.argv.includes('--alloc');

// ---------------------------------------------------------------- the stand-in page: it takes anything and answers little
type Any = any;
function styleOf(): Record<string, string> {
  const bag: Record<string, Any> = { setProperty: (name: string, value: string) => void (bag[name] = String(value)) };
  return new Proxy(bag, { get: (t, k) => t[String(k)] ?? '' }) as Record<string, string>;
}
class El {
  readonly style = styleOf();
  private readonly found = new Map<string, El>();
  private readonly names = new Set<string>();
  readonly kids: El[] = [];
  textContent = '';
  innerHTML = '';
  hidden = false;
  id = '';
  className = '';
  readonly classList = {
    toggle: (name: string, on?: boolean) => {
      const want = on === undefined ? !this.names.has(name) : on;
      if (want) this.names.add(name);
      else this.names.delete(name);
      return want;
    },
    add: (...n: string[]) => void n.forEach((x) => this.names.add(x)),
    remove: (...n: string[]) => void n.forEach((x) => this.names.delete(x)),
    contains: (name: string) => this.names.has(name),
  };
  querySelector(sel: string): El {
    let hit = this.found.get(sel);
    if (!hit) this.found.set(sel, (hit = new El()));
    return hit;
  }
  querySelectorAll(): El[] {
    return [];
  }
  appendChild(k: El): El {
    this.kids.push(k);
    return k;
  }
  setAttribute(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}
const g = globalThis as unknown as Record<string, Any>;
g.window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
g.document = { createElement: () => new El(), head: new El(), documentElement: new El(), getElementById: () => null, addEventListener() {}, removeEventListener() {} };

const { Hud } = await import('../../../src/ui/hud.ts');
const { HUD_SIZES } = await import('../../../src/ui/hudMath.ts');
const { COL } = await import('../../../src/core/palette.ts');

/**
 * A recording overlay: every call kept as numbers. The allocation child hands the display one that only counts, as the
 * display's own measures do: a stand-in that builds a record per call is itself what would be measured.
 */
type Call = { kind: 'line' | 'arc' | 'ring'; a: number[]; colour: number; alpha: number; width: number };
const calls: Call[] = [];
let ops = 0;
const overlay = ALLOC
  ? {
      line() {
        ops++;
      },
      arc() {
        ops++;
      },
      ring() {
        ops++;
      },
    }
  : {
      line(x1: number, y1: number, x2: number, y2: number, width: number, colour: number, alpha: number) {
        ops++;
        calls.push({ kind: 'line', a: [x1, y1, x2, y2], width, colour, alpha });
      },
      arc(cx: number, cy: number, r: number, from: number, to: number, width: number, colour: number, alpha: number) {
        ops++;
        calls.push({ kind: 'arc', a: [cx, cy, r, from, to], width, colour, alpha });
      },
      ring(cx: number, cy: number, r: number, width: number, colour: number, alpha: number) {
        ops++;
        calls.push({ kind: 'ring', a: [cx, cy, r], width, colour, alpha });
      },
    };

const kit: Any = {
  id: 'bounty_hunter',
  name: 'Bounty Hunter',
  slots: [],
  resource: null,
  chargeNow: 0,
  slotActive: () => false,
  slotCooldown: () => 0,
  charge() {
    return this.chargeNow;
  },
};
const parent = new El();
const hud = new Hud(parent as Any);
hud.attach(overlay, COL);
hud.setScale(1);
hud.setCrosshair(true, true);
hud.setKit(kit);
const frame = (charge: number) => {
  kit.chargeNow = charge;
  hud.update(0.016, 0, 0, 0, kit, 100, 100, '12:00', '', false);
  calls.length = 0;
  hud.draw();
};
const m = hud.grappleMark;
const cx = 800;
const cy = 450;

// ---------------------------------------------------------------- the allocation child
if (ALLOC) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as Any).gc as (o?: unknown) => void;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  // Everything up at once: the crosshair, a charge, the diamond, the anchor's mark and the rope ring stepped out.
  kit.chargeNow = 0.6;
  hud.update(0.016, 0, 0, 0, kit, 100, 100, '12:00', '', false);
  Object.assign(m, { shows: true, onScreen: true, x: 800, y: 450, anchorOn: true, ax: 900, ay: 300, ropeUsed: 0.7 });
  const step = () => hud.draw();
  for (let k = 0; k < 10; k++) {
    for (let i = 0; i < 4000; i++) step();
    await turn();
  }
  let best = Number.NaN;
  for (let w = 0, clean = 0; w < 12 && clean < 3; w++) {
    gc({ type: 'minor' });
    await turn();
    await turn();
    const c0 = collections;
    const b = young();
    for (let i = 0; i < 20000; i++) step();
    const a = young();
    await turn();
    await turn();
    if (collections !== c0 || a < b) continue;
    clean++;
    const per = (a - b) / 20000;
    if (!(per >= best)) best = per;
  }
  console.log(JSON.stringify({ perCall: Number.isFinite(best) ? best : null, ops }));
  process.exit(0);
}

// ---------------------------------------------------------------- 1. the crosshair's four lines
{
  frame(0);
  const lines = calls.filter((c) => c.kind === 'line');
  const left = lines.find((c) => c.a[1] === cy && c.a[2] < cx);
  ok(lines.length === 4 && !!left && near(left.a[0], cx - 11) && near(left.a[2], cx - 7), `the four lines run from 7 px out to 11 (left: ${left?.a[0]} to ${left?.a[2]} about ${cx})`);
  const reach = lines.map((c) => Math.max(Math.abs(c.a[0] - cx) + Math.abs(c.a[1] - cy), Math.abs(c.a[2] - cx) + Math.abs(c.a[3] - cy)));
  const inner = lines.map((c) => Math.min(Math.abs(c.a[0] - cx) + Math.abs(c.a[1] - cy), Math.abs(c.a[2] - cx) + Math.abs(c.a[3] - cy)));
  ok(reach.every((r) => near(r, 11)) && inner.every((r) => near(r, 7)), 'each of the four, on each axis');
  const dot = calls.find((c) => c.kind === 'ring');
  ok(!!dot && dot.a[2] + dot.width / 2 < 7, `and the dot stands clear of their inner ends (its edge at ${dot ? dot.a[2] + dot.width / 2 : '?'})`);
}

// ---------------------------------------------------------------- 2. the grapple's diamond, inside the lines
{
  Object.assign(m, { enabled: true, shows: true, onScreen: true, x: cx, y: cy, held: false, next: false, vehicle: false, flash: 0, anchorOn: false, ropeUsed: 0 });
  frame(0);
  const edges = calls.filter((c) => c.kind === 'line' && c.colour === COL.good);
  const corners = edges.flatMap((c) => [Math.abs(c.a[0] - cx) + Math.abs(c.a[1] - cy), Math.abs(c.a[2] - cx) + Math.abs(c.a[3] - cy)]);
  ok(edges.length === 4 && corners.every((r) => near(r, 6)) && edges.every((c) => near(c.width, 1.4)), `the diamond: four strokes 1.4 thick with their corners 6 px out on the axes (${corners.join(' ')})`);
  ok(Math.max(...corners) + 1.4 / 2 <= HUD_SIZES.footTickFrom, "inside the crosshair's lines, its stroke included");
  ok(edges.every((c) => near(c.alpha, HUD_SIZES.grappleMarkAlpha)), 'in `good` at its alpha, when a press would fire');
  m.vehicle = true;
  frame(0);
  ok(calls.filter((c) => c.kind === 'line' && c.colour === COL.warn).length === 4, 'in `warn` on a vehicle');
  m.vehicle = false;
  m.next = true;
  frame(0);
  ok(calls.filter((c) => c.kind === 'line' && c.colour === COL.muted).length === 4, 'in `muted` while attached, for the next anchor');
  Object.assign(m, { next: false, shows: false, flash: 0.2 });
  frame(0);
  ok(calls.filter((c) => c.kind === 'line' && c.colour === COL.bad).length === 4, 'and in `bad` for a refused press');
  Object.assign(m, { flash: 0, shows: false });
}

// ---------------------------------------------------------------- 3. the rope ring, drawn like the charge ring
{
  const rings = () => calls.filter((c) => (c.kind === 'ring' || c.kind === 'arc') && c.a[2] > 10);
  // The charge ring alone, for the look the rope ring is to share.
  frame(0.5);
  const charge = rings();
  const cTrack = charge.find((c) => c.kind === 'ring');
  const cArc = charge.find((c) => c.kind === 'arc');
  ok(!!cTrack && !!cArc && near(cTrack.a[2], 16) && near(cTrack.width, 2.5) && cTrack.colour === COL.muted && near(cTrack.alpha, 0.35) && near(cArc.alpha, 0.95) && near(cArc.a[4], 180), 'the charge ring: a faint full circle in `muted` and the filled arc on it, at 16 px and 2.5 thick');
  // The rope out a third of the longest, no shot charging.
  m.ropeUsed = 0.3;
  frame(0);
  const rope = rings();
  const rTrack = rope.find((c) => c.kind === 'ring');
  const rArc = rope.find((c) => c.kind === 'arc');
  ok(rope.length === 2 && !!rTrack && !!rArc && near(rTrack.a[2], cTrack!.a[2]) && near(rTrack.width, cTrack!.width) && near(rArc.a[2], cTrack!.a[2]), `the rope ring is drawn like it, at the charge ring's size (${rTrack?.a[2]} px, ${rTrack?.width} thick)`);
  ok(rTrack!.colour === COL.muted && near(rTrack!.alpha, cTrack!.alpha) && near(rArc!.alpha, cArc!.alpha) && rArc!.a[3] === 0 && near(rArc!.a[4], 108), 'a faint full circle and the filled arc at the same alphas, clockwise from twelve, a third of the way round');
  ok(rArc!.colour === COL.muted, 'in `muted` under half the longest rope');
  m.ropeUsed = 0.7;
  frame(0);
  ok(rings().find((c) => c.kind === 'arc')?.colour === COL.warn, 'amber (`warn`) past half');
  // A shot charging on the rope: the charge ring where it is, the rope ring out by its own width.
  m.ropeUsed = 0.4;
  frame(0.5);
  const both = rings();
  const atR = (r: number) => both.filter((c) => near(c.a[2], r));
  ok(atR(16).length === 2 && atR(18.5).length === 2 && both.length === 4, `with a shot charging, the charge ring stays at 16 and the rope ring steps out by its own width, to ${16 + 2.5}`);
  ok(atR(18.5).some((c) => c.kind === 'arc' && near(c.a[4], 144)) && atR(16).some((c) => c.kind === 'arc' && near(c.a[4], 180)), 'each ring keeps its own share');
  m.ropeUsed = 0;
}

// ---------------------------------------------------------------- 4. none of it with the mouse free
{
  Object.assign(m, { shows: true, ropeUsed: 0.5 });
  hud.setMouseFree(true);
  frame(0.5);
  ok(calls.length === 0, 'with the mouse free, neither the crosshair, the diamond nor either ring is drawn');
  hud.setMouseFree(false);
  Object.assign(m, { shows: false, ropeUsed: 0 });
}

// ---------------------------------------------------------------- 5. nothing made by a frame that draws all of it, in twelve fresh processes at once
{
  const me = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Array.from({ length: 12 }, () =>
      new Promise<{ perCall: number | null; ops: number } | string>((res) => {
        const ch = spawn(process.execPath, ['--expose-gc', me, '--alloc'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        ch.stdout.on('data', (b) => (out += b));
        ch.stderr.on('data', (b) => (err += b));
        ch.on('close', () => {
          try {
            res(JSON.parse(out.trim().split('\n').pop() ?? ''));
          } catch {
            res(`child failed: ${err.slice(0, 400)}`);
          }
        });
      }),
    ),
  );
  const said = runs.map((r) => (typeof r === 'string' ? r : r.perCall === null ? 'no clean window' : `${r.perCall.toFixed(3)} B`));
  const clean = runs.filter((r) => typeof r !== 'string' && r.perCall !== null && r.perCall < 1).length;
  ok(clean === 12, `a frame drawing the crosshair, a charge, the diamond, the anchor's mark and the rope ring stepped out makes nothing, in ${clean} of 12 processes (${said.join(', ')})`);
}

console.log(`\ncrosshair: ${checks} checks passed`);
