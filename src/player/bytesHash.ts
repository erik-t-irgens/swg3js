// Two 32-bit hashes of a run of numbers, as one string: what tells two images or two index buffers apart (the shared
// looks' `contentKey` and `indexKey`, src/world/mobiles/lookShare.ts). A module of its own, with no imports, so the
// characters' recipe worker can hash a render where it made it (the performance pass's second wave) and the main
// thread never reads four megabytes to learn what the worker already knew; both ends run these very lines, so a
// hash made in the worker is byte for byte the one this thread would make.

/** Every number is read, so two runs that differ anywhere are two keys. */
export function hashRun(a: ArrayLike<number>, n: number): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < n; i++) {
    const v = a[i];
    h1 = Math.imul(h1 ^ v, 0x01000193);
    h2 = Math.imul(h2 ^ (v + i), 0x5bd1e995);
    h2 ^= h2 >>> 13;
  }
  return `${n}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

/** `hashRun` over bytes, four at a time where they are aligned for it. */
export function hashBytes(bytes: Uint8Array): string {
  if (bytes.byteOffset % 4 === 0 && bytes.byteLength % 4 === 0) return `w${hashRun(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), bytes.byteLength / 4)}`;
  return `b${hashRun(bytes, bytes.length)}`;
}

/**
 * A render's pixels hashed as the main thread hashes the texture made from them: that texture holds its own copy,
 * which starts at the front of its buffer, so a view that does not is copied first and both take the same path.
 */
export function hashPixels(rgba: Uint8Array | Uint8ClampedArray): string {
  const bytes = rgba instanceof Uint8Array && rgba.byteOffset % 4 === 0 ? rgba : new Uint8Array(rgba);
  return hashBytes(bytes);
}
