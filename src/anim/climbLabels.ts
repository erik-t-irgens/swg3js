// What each piece of the climbing course is for, in words, for the labels `__debug.climbTest()` stands by each one (the
// owner's 2026-11-17: "if we can 'label' what I'm meant to test near each test geometry that would be helpful too"). Pure:
// read off a piece's id, row and numbers (and, for the poles, the `climb.poles` switch as it stands), so node runs it as the
// game does. The words are ours.

import type { CoursePiece } from './climbCourse.ts';
import { CLIMB_TUNE } from './climbTune.ts';
import { MOVE_TUNE } from './moveTune.ts';

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
  if (p.kind === 'rope' && n.band === 'none') return { title: 'Rope swing with nothing ahead', what: 'E grabs, hold A to swing, Space lets go: a plain fall and landing' };
  if (p.kind === 'rope' && typeof n.band === 'string') return { title: `Rope swing to a ${n.band === 'between' ? 'between knee and waist' : n.band} landing (${m(n.top)})`, what: 'E grabs standing, hold A about 9 s, Space on the swing toward the platform at about 28 degrees (laid so for your size): a later let-go or a longer swing lands the band below' };
  if (p.kind === 'rope') return { title: 'Rope over a pit', what: 'E grabs, W/S climb, A/D swing (toward and away from the view), Space lets go, the crouch drops' };
  if (p.kind === 'pole' && typeof n.top === 'number') return { title: `Pole beside a platform ${m(n.top)} up`, what: 'Stand between the pole and the platform, E grabs the pole, W to its top climbs onto the platform behind you' };
  if (p.kind === 'pole' && typeof n.floorTop === 'number') return { title: `Pole up through a floor ${m(n.floorTop)} up`, what: 'E grabs the pole under the hole, W to its top climbs out onto the floor' };
  // (The course's own poles under `climb.poles` 'off', its other setting: the base commit's words, the pole not climbed as a pole.)
  if (p.kind === 'pole' && CLIMB_TUNE.poles !== 'on') return { title: 'Poles (phase 5)', what: 'Poles come with phase 5' };
  if (p.kind === 'pole') return { title: `Poles ${m(n.height)} tall, ${m(n.apart)} apart`, what: 'E grabs a pole facing it, W/S climb up and down, A/D go round it, look at the other pole and Space jumps across to it, the crouch slides down' };
  if (p.kind === 'obstacle' && n.dir === 'duck') return { title: `Beam ${m(n.under)} over the floor`, what: 'Walk and run under it with only the move keys: you should duck on your own' };
  if (p.kind === 'obstacle' && n.dir === 'tunnel') return { title: `Tunnel ${m(n.under)} high`, what: 'Go through crouched, with only the move keys' };
  if (p.kind === 'obstacle' && n.dir === 'crawl') return { title: `Slab ${m(n.under)} over the floor`, what: 'Go under it lying down, with only the move keys' };
  // (Climbing II, phase 6, maker B: under `move.vault` 'off', its other setting, the base commit's words, nothing vaulted.)
  if (p.kind === 'obstacle' && MOVE_TUNE.vault === 'off') return { title: `${id.startsWith('clamber') ? 'Clamber' : 'Vault'}: ${id.replace(/^(obstacle|clamber)-/, '')} m (phase 6)`, what: 'Vaults and clambers come with phase 6' };
  if (p.kind === 'obstacle' && id.startsWith('clamber')) return { title: `Clamber: ${m(n.height)} ledge`, what: 'Sprint at it (Shift again, W held): you clamber onto it and run on; let go of the sprint first and you stand up on it' };
  if (p.kind === 'obstacle' && typeof n.height === 'number' && n.height > MOVE_TUNE.vaultHigh) return { title: `Vault: ${id.replace(/^obstacle-/, '')} m, too high`, what: 'Too high to vault: a sprint meets it as a wall, as before' };
  if (p.kind === 'obstacle') return { title: `Vault: ${id.replace(/^obstacle-/, '')} m`, what: 'Sprint at it (Shift again, W held): a vault, or a dive and roll over a long low one; a walk or a run stops at it' };
  if (p.kind === 'run' && id === 'tower') return { title: 'The tower: everything in one climb', what: 'Shimmy, hop up twice, hop across, wall climb, hop down, round the corner, drop' };
  if (p.kind === 'run') return { title: 'The run: everything in a line', what: 'Run the line start to end' };
  if (p.kind === 'room') return { title: `Climb up where it only nearly fits (${id.replace(/^room-/, '')})`, what: 'Grab and climb up W: it should climb short or say why not' };
  return { title: id, what: '' };
}
