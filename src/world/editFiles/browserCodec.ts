// The browser's deflate-raw and base64 for the edit files' packed fields (Map-maker II: a heights tile's deltas), which the
// pure readers are handed and never import: `DecompressionStream('deflate-raw')` and `CompressionStream('deflate-raw')`,
// both in every browser the game runs on and in node 22, so a test runs these very functions. Kept apart from the readers
// so that a node test can hand them node's own `zlib` instead and hold the two to each other.
//
// Rule for this file (node runs it with type stripping): no enum, no namespace, no constructor parameter properties.

/** Base64 to its bytes, or null where it is not base64. */
export function bytesOfBase64(b64: string): Uint8Array | null {
  try {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Bytes as base64. */
export function base64OfBytes(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/** Every byte a stream gives, in one array. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let n = 0;
  const reader = stream.getReader();
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    parts.push(r.value);
    n += r.value.byteLength;
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

/** A base64 field's deflate-raw bytes inflated, or null where it is not base64 or does not inflate. */
export async function inflateBase64(b64: string): Promise<Uint8Array | null> {
  const packed = bytesOfBase64(b64);
  if (!packed) return null;
  const ds = new DecompressionStream('deflate-raw');
  const out = drain(ds.readable as ReadableStream<Uint8Array>);
  // A stream that errors rejects its reading side as well as its writing one: the reading side is answered here too, so a
  // field that does not inflate is nothing and never a rejection nobody hears.
  out.catch(() => null);
  try {
    const w = ds.writable.getWriter();
    await w.write(packed as unknown as BufferSource);
    await w.close();
    return await out;
  } catch {
    return null;
  }
}

/** Bytes deflated (deflate-raw) and written as base64. */
export async function deflateBase64(bytes: Uint8Array): Promise<string> {
  const cs = new CompressionStream('deflate-raw');
  const out = drain(cs.readable as ReadableStream<Uint8Array>);
  const w = cs.writable.getWriter();
  await w.write(bytes as unknown as BufferSource);
  await w.close();
  return base64OfBytes(await out);
}
