// The room deferral (the performance pass's second wave): a body stood outdoors has only the world pass's program
// built before it is shown, and its rooms pass's program after, off the frame.
//
// A body is drawn in a building's rooms pass only when it stands in one of that building's rooms, its sphere reaches
// one of its doorways, or the routing is off for the frame; measured over a 100 s walk through Bestine that was never
// once for a person outdoors, and the rooms' program is the dearer of the two (443 ms against 365 on Direct3D 11). So
// a mobile's or a fighter's look stood outdoors is shown once its world pass is built, and its rooms pass is pushed
// after it as work of its own, below the urgent rank, marked room-ready when it is answered. Until then the routes
// (`ActorRoutes`, its `F_NOROOM` flag) never show the body in a building's pass, and with the routes off for the frame
// the portal renderer hides every body on the world's pending list around each rooms pass. A record that counts in a
// room while not room-ready has its job made urgent (`RoomJob.promote`). A body stood indoors keeps both passes urgent.
//
// The deferred work is tied to the life of what it compiles, both ways round (`deferRooms`). Its owner going (a cached
// look trimmed while its rooms batch waits, a fighter let go) marks the handle `gone`, and the queued work then compiles
// nothing: compiled after the asset's materials were disposed, three built them programs nothing would ever release and
// the cascades' strong map took the disposed materials back. And the work let go unbuilt (a world unloading clears the
// queue, which answers every batch it holds) leaves the handle not ready rather than ready: the cached asset outlives
// the planet, and a body of it stood in the next world would otherwise be drawn in a rooms pass with no program and
// built there on a live frame. Such a handle asks for its work again, urgent when a body of it is wanted in a room
// (`promote`) and below the urgent rank when one is merely stood again (`resume`).
//
// One rule with the player's (D28): a body is left out of a pass only while that pass's program for it is being built
// off the frame, where leaving it out buys back a freeze; nothing is ever left out of a pass to save drawing time, and
// a body with a light under it is never deferred (hiding a light would change the light count). The price is said
// to the owner: a body first shown outdoors that walks straight through a doorway can be missing from that room for up
// to about half a second while its rooms program builds. Pure but for three's types; node loads it.
import type * as THREE from 'three';
import type { CompileStep, OwnJob } from '../core/programQueue.ts';

/** The switch: `true` defers an outdoor body's rooms program (what ships), `false` builds both passes before it is shown, as before. */
export const ROOM_DEFER = { on: true };

/**
 * One deferred rooms program's handle, filled in by the world as it pushes the job: whether it has been answered,
 * how to make it urgent now (a body that counts in a room before it is ready), how to ask again for work let go
 * unbuilt, and whether its owner has gone. Kept on the asset or the fighter whose body it is; the world writes
 * `ready` true when the job answers with its programs built, and the owner writes `gone` true as it goes.
 */
export interface RoomJob {
  ready: boolean;
  promote: () => void;
  /** Work let go unbuilt pushed again below the urgent rank (a cached look stood again); nothing otherwise. */
  resume: () => void;
  /** Its owner has gone: queued rooms work for it compiles nothing, and it is never marked ready. */
  gone: boolean;
}

/** A fresh handle, ready until the world defers something under it. */
export function roomJob(): RoomJob {
  return { ready: true, promote: noop, resume: noop, gone: false };
}

function noop(): void {}

/** What the deferral is handed of the world: a batch made ready through its queue (or outright where the queue would not take it), and one moved up to the urgent rank. */
export interface RoomQueue {
  push(objects: THREE.Object3D[], label: string, urgent: boolean, own: OwnJob): Promise<void>;
  promote(own: OwnJob): boolean;
}

/** One turn at an object's rooms pass, as the world's compile takes it. */
export type RoomCompile = (o: THREE.Object3D, allowance: number, resolve: boolean) => CompileStep;

/** The step a turn for a gone owner answers: nothing built, nothing left. Read and never written. */
const NOTHING: CompileStep = Object.freeze({ made: 0, done: true }) as CompileStep;

/**
 * Defer the rooms pass of `objects` under `later`: pushed below the urgent rank as a job of its own (`compile` one turn
 * at an object's rooms pass), `later.ready` false until it is answered with its programs built, `promote` moving it
 * up meanwhile. A gone owner's work compiles nothing; work let go unbuilt leaves `later` not ready and able to ask
 * again (see the file's head).
 */
export function deferRooms(later: RoomJob, objects: THREE.Object3D[], label: string, compile: RoomCompile, queue: RoomQueue): void {
  if (later.gone) return;
  ROOM_DEFER_STATS.deferred++;
  pushRooms(later, objects, label, compile, queue, false);
}

function pushRooms(later: RoomJob, objects: THREE.Object3D[], label: string, compile: RoomCompile, queue: RoomQueue, urgent: boolean): void {
  later.ready = false;
  let lost = false;
  const own: OwnJob = {
    compile: (o, allowance, resolve) => (later.gone ? NOTHING : compile(o, allowance, resolve)),
    dropped: () => {
      lost = true;
    },
  };
  later.promote = () => {
    if (later.ready || later.gone) return;
    if (queue.promote(own)) ROOM_DEFER_STATS.promoted++;
  };
  later.resume = noop;
  const settle = (failed: boolean): void => {
    if (later.gone) {
      ROOM_DEFER_STATS.cancelled++;
      later.promote = noop;
      later.resume = noop;
      return;
    }
    if (!lost && !failed) {
      later.ready = true;
      later.promote = noop;
      later.resume = noop;
      return;
    }
    // Let go unbuilt: not ready, and asked for again the first time a body of it is wanted.
    ROOM_DEFER_STATS.dropped++;
    const again = (asUrgent: boolean) => (): void => {
      if (later.ready || later.gone) return;
      if (asUrgent) ROOM_DEFER_STATS.promoted++;
      pushRooms(later, objects, label, compile, queue, asUrgent);
    };
    later.promote = again(true);
    later.resume = again(false);
  };
  void queue.push(objects, label, urgent, own).then(
    () => settle(false),
    (err) => {
      console.warn(`shaders: ${label} could not be made ready`, err);
      settle(true);
    },
  );
}

/** What the room deferral has counted this session, for `__debug.links()`. */
export const ROOM_DEFER_STATS = {
  /** Bodies whose rooms program was pushed after them. */
  deferred: 0,
  /** Of those, made urgent because they counted in a room before they were ready (and work let go asked for again in a room). */
  promoted: 0,
  /** Deferred work let go unbuilt (a world unloading cleared the queue), left not ready to be asked for again. */
  dropped: 0,
  /** Deferred work answered after its owner had gone, which compiled nothing. */
  cancelled: 0,
  /** Frames on which a record not room-ready reached more rooms than the routes take (`F_NOROOM` where it was `F_SKIP`). */
  wideFrames: 0,
  /** Frames on which a record not room-ready had a light under it and so was left in every pass (should stay nought). */
  litFrames: 0,
};
