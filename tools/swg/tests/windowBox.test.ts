// The arithmetic of a window that moves and sizes (src/ui/windowBox.ts): what is remembered and how an
// old record is read back, the smallest each window may be, and where a window may stand in a browser
// of any size. No browser, no document, no storage: the arithmetic runs on made-up boxes, and the one
// thing read from the game's own code is which windows it wires.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { clampPlace, clampSize, DEFAULT_MIN, fitRect, minFor, readSaved, resizeRect, WINDOW_MIN, writeSaved } from '../../../src/ui/windowBox.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------------------------------------
// Reading what was remembered.
{
  const old = readSaved(JSON.stringify({ map: { x: 120, y: 40 }, menu: { x: 10, y: 20 } }));
  ok(old.map?.x === 120 && old.map?.y === 40 && old.map?.w === undefined && old.map?.h === undefined, 'an old { x, y } record is read as it stands, a place and no size');
  ok(Object.keys(old).length === 2, 'and no record is lost on the way');

  const sized = readSaved(JSON.stringify({ backpack: { x: 5, y: 6, w: 800, h: 500 } }));
  ok(sized.backpack?.w === 800 && sized.backpack?.h === 500, 'a sized record keeps its size');

  const junk = readSaved(JSON.stringify({ a: { x: 'no', y: 1 }, b: null, c: { x: 1, y: 2, w: -5, h: 300 }, d: { x: 1, y: 2, w: 300 }, e: [1, 2], f: { x: Infinity, y: 0 } }));
  ok(!('a' in junk) && !('b' in junk) && !('e' in junk) && !('f' in junk), 'a record with no usable place is dropped whole');
  ok(junk.c?.x === 1 && junk.c.w === undefined && junk.d?.x === 1 && junk.d.w === undefined, 'a size that is not two positive numbers is dropped and the place kept');

  ok(Object.keys(readSaved('{not json')).length === 0, 'text that is not JSON reads as nothing remembered');
  ok(Object.keys(readSaved(null)).length === 0 && Object.keys(readSaved('')).length === 0, 'and so does nothing at all');
  ok(Object.keys(readSaved('[1,2,3]')).length === 0 && Object.keys(readSaved('7')).length === 0, 'and a table that is not a table');

  const evil = readSaved('{"__proto__": {"x": 1, "y": 2}, "constructor": {"x": 1, "y": 2}, "prototype": {"x": 1, "y": 2}}');
  ok(Object.getPrototypeOf(evil) === null, 'the table read back has no prototype');
  ok(Object.keys(evil).length === 0 && ({} as Record<string, unknown>).x === undefined, 'and a key that names the language\'s own objects is refused');

  const text = writeSaved({ map: { x: 10.4, y: 20.6 }, trade: { x: 1, y: 2, w: 640.2, h: 400.7 } });
  const back = JSON.parse(text) as Record<string, Record<string, number>>;
  ok(back.map.x === 10 && back.map.y === 21 && !('w' in back.map), 'a window only moved is written as a place alone, in whole pixels');
  ok(back.trade.w === 640 && back.trade.h === 401, 'a sized one with its size');
  const round = readSaved(text);
  ok(round.map?.x === 10 && round.trade?.w === 640, 'and what is written reads back the same');
}

// ---------------------------------------------------------------------------------------------
// The minimums.
{
  // The windows are read out of the code that wires them, not out of a list kept here: every
  // `draggable(…, '<id>')` under `src/`, and the `['<id>', this.<panel>]` pairs of a loop that hands its
  // `id` to `draggable`. A window wired later under a new id is found the same way, so it cannot fall
  // back on the default minimum without this failing.
  const src = new URL('../../../src/', import.meta.url);
  const files = (readdirSync(src, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => f.endsWith('.ts') && f !== 'ui/drag.ts');
  const wired = new Set<string>();
  const calls: string[] = [];
  let loops = 0;
  for (const file of files) {
    const text = readFileSync(new URL(file, src), 'utf8');
    for (const call of text.matchAll(/(?<![\w.])draggable\(([^;]*?)\);/g)) {
      calls.push(call[1]);
      const last = /,\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))\s*$/.exec(call[1]);
      if (!last) continue;
      if (last[1] !== undefined || last[2] !== undefined) {
        wired.add(last[1] ?? last[2]);
        continue;
      }
      // A variable: the loop on the same line names the ids it takes.
      const line = text.slice(text.lastIndexOf('\n', call.index) + 1, call.index);
      const pairs = [...line.matchAll(/\[\s*'([^']+)'\s*,\s*this\.[\w$]+\s*\]/g)].map((p) => p[1]);
      if (pairs.length) loops++;
      for (const p of pairs) wired.add(p);
    }
  }
  ok(wired.size >= 13 && loops >= 1 && wired.has('map') && wired.has('menu') && wired.has('backpack'), `the wired windows are read out of the code (${wired.size}: ${[...wired].sort().join(', ')})`);
  const missing = [...wired].filter((id) => !Object.hasOwn(WINDOW_MIN, id));
  ok(missing.length === 0, `every window the game wires has a minimum of its own${missing.length ? `: ${missing.join(', ')}` : ''}`);
  // The group's panel and the trade window are wired where they are built, late in the game's
  // constructor; they must be found there and have minimums of their own.
  ok(wired.has('group') && wired.has('trade'), 'the group\'s panel and the trade window are wired too');
  // The select screen is a whole screen, not a window: it is never moved or sized.
  ok(!wired.has('start') && !wired.has('select') && !calls.some((c) => /\bselect\b|#start/.test(c)), 'the select screen is never made a window');
  // The smallest browser the game is judged at is 1280x720, and at 150% scaling that is 853x480 CSS
  // pixels: every minimum must fit inside that, or a window could be made unable to show all of itself.
  const tooBig = Object.entries(WINDOW_MIN).filter(([, m]) => m.w > 853 || m.h > 480).map(([id]) => id);
  ok(tooBig.length === 0, `and every one fits a 1280x720 screen at 150% (853x480)${tooBig.length ? `: ${tooBig.join(', ')}` : ''}`);
  const tooSmall = Object.entries(WINDOW_MIN).filter(([, m]) => m.w < 200 || m.h < 120).map(([id]) => id);
  ok(tooSmall.length === 0, 'and none is so small the header and a row could not show');
  ok(minFor('nobody').w === DEFAULT_MIN.w && minFor('nobody').h === DEFAULT_MIN.h, 'a window the table does not name takes the default');
  ok(minFor('__proto__').w === DEFAULT_MIN.w, 'and a name out of the language is not a window');
  const m = minFor('map');
  m.w = 1;
  ok(minFor('map').w === WINDOW_MIN.map.w, 'the minimum handed out is a copy, so nothing can move the table');
}

// ---------------------------------------------------------------------------------------------
// Sizes and places.
{
  const view = { w: 1280, h: 720 };
  const min = { w: 400, h: 300 };
  const s = clampSize(100, 100, min, view);
  ok(s.w === 400 && s.h === 300, 'a size under the minimum is lifted to it');
  const big = clampSize(5000, 5000, min, view);
  ok(big.w === 1280 && big.h === 720, 'a size over the browser is cut to it');
  const tiny = clampSize(100, 100, min, { w: 300, h: 200 });
  ok(tiny.w === 300 && tiny.h === 200, 'a browser smaller than the minimum wins over the minimum');

  const p = clampPlace(-50, -50, 400, 300, view);
  ok(p.x === 0 && p.y === 0, 'a window pushed off the top left comes back on');
  const q = clampPlace(1200, 700, 400, 300, view);
  ok(q.x === 880 && q.y === 420, 'and one pushed off the bottom right');

  // A window remembered on a big screen, shown on a small one: made to fit, never lost off it.
  const r = fitRect({ x: 2000, y: 1200, w: 1600, h: 1000 }, min, view);
  ok(r.x === 0 && r.y === 0 && r.w === 1280 && r.h === 720, 'a remembered box larger than the browser is shown as the whole browser');
  const r2 = fitRect({ x: 1100, y: 600, w: 500, h: 400 }, min, view);
  ok(r2.w === 500 && r2.h === 400 && r2.x === 780 && r2.y === 320, 'one that fits but stands off the edge is slid back on at its own size');
  const within = (b: { x: number; y: number; w: number; h: number }, v: { w: number; h: number }) => b.x >= 0 && b.y >= 0 && b.x + b.w <= v.w && b.y + b.h <= v.h;
  let all = true;
  for (let i = 0; i < 400; i++) {
    const v = { w: 300 + ((i * 97) % 2300), h: 200 + ((i * 61) % 1300) };
    const b = fitRect({ x: ((i * 131) % 4000) - 1000, y: ((i * 71) % 3000) - 800, w: (i * 53) % 3000, h: (i * 29) % 2000 }, min, v);
    if (!within(b, v)) all = false;
  }
  ok(all, 'across four hundred browsers and boxes, every window shown is wholly on the screen');
}

// ---------------------------------------------------------------------------------------------
// A sizing drag.
{
  const view = { w: 1280, h: 720 };
  const min = { w: 400, h: 300 };
  const start = { x: 100, y: 100, w: 600, h: 400 };
  const both = { right: true, bottom: true };
  const a = resizeRect(start, 50, 30, both, min, view);
  ok(a.x === 100 && a.y === 100 && a.w === 650 && a.h === 430, 'the corner moves both far edges and the top left holds still');
  const r = resizeRect(start, 50, 30, { right: true, bottom: false }, min, view);
  ok(r.w === 650 && r.h === 400, 'the right edge moves the width alone');
  const b = resizeRect(start, 50, 30, { right: false, bottom: true }, min, view);
  ok(b.w === 600 && b.h === 430, 'the bottom edge the height alone');
  const shrink = resizeRect(start, -900, -900, both, min, view);
  ok(shrink.w === 400 && shrink.h === 300 && shrink.x === 100, 'dragged smaller than its minimum, it stops at the minimum');
  const grow = resizeRect(start, 5000, 5000, both, min, view);
  ok(grow.x === 100 && grow.y === 100 && grow.w === 1180 && grow.h === 620, 'dragged past the browser, it stops at the edge rather than pushing its corner');
  const late = resizeRect({ x: 1000, y: 500, w: 250, h: 200 }, 10, 10, both, min, view);
  ok(late.w === 400 && late.h === 300 && late.x === 880 && late.y === 420, 'a window too near the edge for its minimum slides back to keep all of itself on the screen');
}

console.log(`\n${checks} checks passed`);
