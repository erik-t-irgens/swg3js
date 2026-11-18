// What each piece of the climbing course is for, in words, for the labels `__debug.climbTest()` stands by each one (the
// owner's 2026-11-17: "if we can 'label' what I'm meant to test near each test geometry that would be helpful too"). Pure:
// read off a piece's id, row and numbers, so node runs it as the game does. The words are ours.

import type { CoursePiece } from './climbCourse.ts';

export interface PieceLabel {
  /** One short line: what the piece is. */
  title: string;
  /** One line: what to do on it. */
  what: string;
}

const m = (v: unknown): string => `${Number(v)} m`;

/** A piece's label: what it is and what to try on it. */
export function pieceLabel(p: CoursePiece): PieceLabel {
  const n = p.numbers;
  const id = p.id;
  const free = n.free === true || n.braced === false;
  if (p.row === 'lips braced' || p.row === 'lips free') {
    const why = typeof n.from === 'string' ? ` (${n.from})` : '';
    return { title: `${free ? 'Free' : 'Braced'} lip, ${m(n.height)}${why}`, what: 'Jump at it to grab (E, or W and Space), shimmy A/D, climb up W, drop with a crouch tap' };
  }
  if (p.kind === 'corner' && n.radius !== undefined) {
    return { title: `${free ? 'Free' : 'Braced'} curve, ${n.turn}, ${m(n.radius)} radius`, what: 'Grab and shimmy round the curve and back (A/D held)' };
  }
  if (p.kind === 'corner') {
    return { title: `${free ? 'Free' : 'Braced'} ${n.turn} ${id.includes('bend') ? 'bend' : 'corner'}, ${n.angle}°`, what: 'Grab and shimmy round the turn and back (A/D held)' };
  }
  if (p.kind === 'slope') {
    const past = n.pastLimit === true ? ': past the slope limit, the shimmy should refuse' : '';
    return { title: `${free ? 'Free' : 'Braced'} lip sloping ${n.angle}°${past}`, what: 'Grab the low end, shimmy up the slope and down; watch both hands on the lip' };
  }
  if (p.kind === 'steps') {
    return { title: `${free ? 'Free' : 'Braced'} lip in steps of ${m(n.step)}`, what: 'Shimmy along over the steps both ways' };
  }
  if (n.dir === 'traverse') {
    return { title: `${free ? 'Free' : 'Braced'} traverse: ${n.lips} lips, gaps ${String(n.gaps).split(' ').join(', ')} m`, what: 'Grab the first, cross to the last and back: hold A/D to see the hop, Space to go' };
  }
  if (p.kind === 'gap') {
    switch (n.dir) {
      case 'side':
        return { title: `${free ? 'Free' : 'Braced'} hop sideways, ${m(n.span)}`, what: 'Grab A, shimmy to its end, hold A/D for the lean, Space to hop to B' };
      case 'updown':
        return { title: `${free ? 'Free' : 'Braced'} hop up and down, ${m(n.span)}`, what: 'Grab the low lip on its open left end, shimmy under B, W (Space if cued) up, crouch tap down' };
      case 'diag':
        return { title: `${free ? 'Free' : 'Braced'} hop diagonally, ${m(n.span)}`, what: 'Grab A, hold W and D toward B, Space to hop' };
      case 'behind':
        return { title: `${free ? 'Free' : 'Braced'} hop behind, ${m(n.span)} across`, what: 'Grab A, look back at B, W toward it, Space to hop' };
      case 'ladder':
        return { title: `${free ? 'Free' : 'Braced'} ladder, rungs ${m(n.step)} apart`, what: 'Climb rung to rung: W up, S down (Space where the reach is cued)' };
      case 'zigzag':
        return { title: `${free ? 'Free' : 'Braced'} zigzag rungs, ${m(n.step)} up each`, what: 'Hop diagonally rung to rung: W with A or D' };
      case 'shelves':
        return { title: `Shelves, ${m(n.step)} a tier`, what: 'Climb tier to tier (W), and drop back down (crouch tap)' };
      case 'chimney':
        return { title: 'Chimney: two walls 2.5 m apart', what: 'Hop behind face to face up to the top, and out onto either side' };
      default:
        return { title: id, what: 'Hop between the lips' };
    }
  }
  if (p.kind === 'wall' && n.holds !== undefined) {
    return { title: `${free ? 'Free' : 'Braced'} climbing wall, holds ${m(n.holdWidth)} wide`, what: 'Grab a low hold, climb hand to hand with W/A/S/D to the top and out' };
  }
  if (p.kind === 'wall') {
    return { title: `Wall climb, ${m(n.height)}${n.top === 'edge' ? ' to a thin edge' : ''}`, what: 'E at the wall to start the climb, W/A/S/D, and climb out (or Space off)' };
  }
  if (p.kind === 'bar') return { title: `Bars ${m(n.spacing ?? '')} apart`, what: 'E grabs a bar, W and S swing, Space lets go for the next (4 and 5 m want more boost), the crouch drops' };
  if (p.kind === 'rope') return { title: 'Rope (phase 4)', what: 'Ropes come with phase 4' };
  if (p.kind === 'pole') return { title: 'Poles (phase 5)', what: 'Poles come with phase 5' };
  if (p.kind === 'obstacle' && n.dir === 'duck') return { title: `Beam ${m(n.under)} over the floor`, what: 'Walk and run under it with only the move keys: you should duck on your own' };
  if (p.kind === 'obstacle' && n.dir === 'tunnel') return { title: `Tunnel ${m(n.under)} high`, what: 'Go through crouched, with only the move keys' };
  if (p.kind === 'obstacle' && n.dir === 'crawl') return { title: `Slab ${m(n.under)} over the floor`, what: 'Go under it lying down, with only the move keys' };
  if (p.kind === 'obstacle') return { title: `${id.startsWith('clamber') ? 'Clamber' : 'Vault'}: ${id.replace(/^(obstacle|clamber)-/, '')} m (phase 6)`, what: 'Vaults and clambers come with phase 6' };
  if (p.kind === 'run' && id === 'tower') return { title: 'The tower: everything in one climb', what: 'Shimmy, hop up twice, hop across, wall climb, hop down, round the corner, drop' };
  if (p.kind === 'run') return { title: 'The run: everything in a line', what: 'Run the line start to end' };
  if (p.kind === 'room') return { title: `Climb up where it only nearly fits (${id.replace(/^room-/, '')})`, what: 'Grab and climb up W: it should climb short or say why not' };
  return { title: id, what: '' };
}
