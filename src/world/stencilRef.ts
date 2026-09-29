// One stencil reference for every material the portal renderer draws (step 6 of the frame-time wave).
//
// Every material in the world tests the stencil the portal renderer leaves (1 the camera's own side of the
// doorways, 2 the far side), and the reference it tests against moves between passes: the renderer used to
// write it into each of the seven or eight thousand materials in its set, about nine times a frame, which
// was 0.7 to 0.8 ms of walking a set and writing a field. So moving the reference is one assignment
// (`PORTAL_REF.value`) and a registered material reads it through an accessor.
//
// The accessor lives on `THREE.Material.prototype`, once, installed when this module is evaluated -- which
// `main.ts` makes the first thing it does, before any material exists. It is **never** put on a material of
// its own: V8 turns an object whose data property is redefined as an accessor into a dictionary, for good,
// and every read of every field of that material then costs about twice what it did (measured in node 22
// on three's own materials: 25 field reads 60-80 ns a material in fast mode, 157-172 ns after an own
// accessor, and the same after a plain value is put back). On the prototype nothing about the material's
// own shape changes: the Material constructor's own `this.stencilRef = 0` goes through the setter, which
// writes two fields of the material's own (`_portalRefShared`, `_portalRefOwn`) in the same order for every
// material, so every material keeps one hidden class and fast properties. Registering a material flips a
// boolean it already has; letting it go flips it back with the value in force kept as its own.
//
// Nothing else writes a registered material's reference: the effects' products, the ambient occlusion's
// region pass and the weather each write materials of their own. A write that does come is not taken -- the
// shared value is the renderer's to move -- and says so once in development, and is counted, because a
// reference that silently would not move is exactly the fault nobody would think to look for.
// `Material.copy` writes the reference it reads, so a clone made from a registered material gets the value
// of that moment as a plain value of its own, and follows the shared one only once it is registered itself.
//
// `PORTAL_REF.shared` false is the old way, live: each registered material holds its own value and the
// renderer walks the set writing it. With `localStorage['swg.stencilAccessor'] = '0'` the accessor is not
// installed at all and the reference is exactly the plain field three made it (the old way at the next
// load, for a comparison with nothing of this in it). A material made before the accessor was installed
// (none in the game, since `main.ts` imports this first; possible in a test) keeps a plain field of its own
// that shadows the accessor, and is walked every time the reference moves (`legacy`).
//
// Pure apart from three's `Material`, so the node test drives it with real materials.

import * as THREE from 'three';

export const PORTAL_REF = {
  /** The reference every registered material tests the stencil against right now. */
  value: 1,
  /** Whether registered materials read `value` (true) or hold a copy each that the renderer writes (false, the old way). */
  shared: true,
  /** Whether the accessor is on `Material.prototype` (decided once, when this module is evaluated). */
  installed: false,
  /** Writes to a shared material's reference that were not taken, since the session began. */
  foreignWrites: 0,
  /** Whether the one development warning has been given. */
  warned: false,
};

/** The two fields of its own the accessor keeps on every material. */
interface RefFields {
  _portalRefShared?: boolean;
  _portalRefOwn?: number;
}

/** Registered materials made before the accessor was installed: a plain field each, walked every time. */
const legacy = new Set<THREE.Material>();

/** Whether this build warns: a development server's, never a node test's or a release's. */
const DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

function readRef(this: RefFields): number {
  return this._portalRefShared === true && PORTAL_REF.shared ? PORTAL_REF.value : (this._portalRefOwn as number);
}

function writeRef(this: RefFields, v: number): void {
  if (this._portalRefShared === true && PORTAL_REF.shared) {
    if (v === PORTAL_REF.value) return;
    PORTAL_REF.foreignWrites++;
    if (DEV && !PORTAL_REF.warned) {
      PORTAL_REF.warned = true;
      console.warn(`stencil: something wrote ${v} to a portal material's stencilRef, which follows the portal renderer's own reference (${PORTAL_REF.value}); the write was not taken (src/world/stencilRef.ts)`);
    }
    return;
  }
  // The first write is the constructor's own: both fields are made then, in this order, on every material.
  if (this._portalRefShared === undefined) this._portalRefShared = false;
  this._portalRefOwn = v;
}

/** Whether the old way was asked for at load: the accessor left out entirely. */
function accessorRefused(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('swg.stencilAccessor') === '0';
  } catch {
    return false;
  }
}

/**
 * Put the accessor on `Material.prototype`, unless the old way was asked for. Run once, when this module is
 * evaluated; a second evaluation (a module reloaded in development) puts its own functions in place of the
 * first's, which read and write the same two fields.
 */
function install(): boolean {
  if (accessorRefused()) return false;
  Object.defineProperty(THREE.Material.prototype, 'stencilRef', { configurable: true, enumerable: false, get: readRef, set: writeRef });
  return true;
}

PORTAL_REF.installed = install();
PORTAL_REF.shared = PORTAL_REF.installed;

/** Whether a material reads its reference through the accessor rather than a plain field of its own. */
function throughAccessor(m: THREE.Material): boolean {
  return PORTAL_REF.installed && !Object.prototype.hasOwnProperty.call(m, 'stencilRef');
}

/** Whether a material is registered and reads the one shared value now. */
export function isShared(m: THREE.Material): boolean {
  return PORTAL_REF.shared && throughAccessor(m) && (m as unknown as RefFields)._portalRefShared === true;
}

/** Registered materials that hold a plain field of their own (made before the accessor was installed). */
export function legacyCount(): number {
  return legacy.size;
}

/**
 * A material the portal renderer has registered: its reference follows the shared value from now on (idempotent).
 * Its own value is set to 1, which is what registering wrote before any of this, and is what it holds while
 * the shared value is switched off until the renderer next writes the set.
 */
export function shareRef(m: THREE.Material): void {
  if (!throughAccessor(m)) {
    legacy.add(m);
    m.stencilRef = PORTAL_REF.shared ? PORTAL_REF.value : 1;
    return;
  }
  const f = m as unknown as RefFields;
  if (f._portalRefShared === true) return;
  f._portalRefOwn = 1;
  f._portalRefShared = true;
}

/** A material the portal renderer has let go of: a plain reference of its own again, holding the value in force. */
export function unshareRef(m: THREE.Material): void {
  if (legacy.delete(m)) return;
  const f = m as unknown as RefFields;
  if (f._portalRefShared !== true) return;
  if (PORTAL_REF.shared) f._portalRefOwn = PORTAL_REF.value;
  f._portalRefShared = false;
}

/**
 * Move the reference every registered material tests against. Shared, one assignment (and the rare material
 * that could not take the accessor, written); the old way, a walk of the set writing each.
 */
export function setPortalRef(ref: number, materials: Iterable<THREE.Material>): void {
  PORTAL_REF.value = ref;
  if (!PORTAL_REF.shared) {
    for (const m of materials) m.stencilRef = ref;
    return;
  }
  if (legacy.size) for (const m of legacy) m.stencilRef = ref;
}

/**
 * Switch between the shared value and a copy per material (the frame report's `sharedStencilRef`): switched
 * off, every registered material is given the value in force as its own first, so nothing moves. Refused
 * (nothing changes) while the accessor is not installed.
 */
export function setSharedRef(on: boolean, materials: Iterable<THREE.Material>): void {
  const want = on && PORTAL_REF.installed;
  if (PORTAL_REF.shared === want) return;
  if (!want) {
    for (const m of materials) {
      const f = m as unknown as RefFields;
      if (f._portalRefShared === true && throughAccessor(m)) f._portalRefOwn = PORTAL_REF.value;
    }
  }
  PORTAL_REF.shared = want;
}
