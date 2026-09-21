// Serving files for the launcher: the built game at `/`, the player's converted content at
// `/assets-private/`, with the types a browser needs (a module script must be served as JavaScript or
// the browser refuses it; Rapier's `.wasm` must be `application/wasm` to be compiled while it streams),
// and byte ranges for the large files. Dependency-free and pure where it can be, so the node test can
// try the table, the ranges and the path checks without a socket.

import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

/** The content types, by extension. Anything not here is served as bytes. */
export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
});

/** The content type for a file name. */
export function mimeOf(file) {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * A `Range` header against a file of `size` bytes: null to send the whole file (no header, a header
 * this does not understand, or more than one range, which a server may always answer whole), a
 * `{ start, end }` (inclusive) to send part of it, or `'unsatisfiable'` for a range wholly past the end.
 */
export function parseRange(header, size) {
  if (!header || typeof header !== 'string') return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start;
  let end;
  if (a === '') {
    const n = Number(b);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
    if (b !== '' && Number(b) < start) return null;
  }
  if (start >= size || size === 0) return 'unsatisfiable';
  return { start, end };
}

/**
 * The file a URL path names under `root`, or null when it would leave `root`: the path is decoded,
 * any NUL refused, and the result must stay inside the folder whatever `..` or backslashes it carries.
 */
export function resolveUnder(root, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  const base = resolve(root);
  const file = resolve(base, `.${rel.startsWith('/') ? rel : `/${rel}`}`);
  if (file !== base && !file.startsWith(base.endsWith(sep) ? base : base + sep)) return null;
  return file;
}

/**
 * Sends a file with its type, honouring a single byte range and HEAD. Answers 404 for anything that
 * is not a readable file. `cache` is the Cache-Control to send.
 */
export function sendFile(req, res, file, { cache = 'no-cache' } = {}) {
  let st;
  try {
    st = statSync(file);
  } catch {
    st = null;
  }
  if (!st || !st.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const headers = { 'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes', 'Cache-Control': cache, 'Last-Modified': st.mtime.toUTCString() };
  const range = parseRange(req.headers.range, st.size);
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${st.size}` });
    res.end();
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : st.size - 1;
  const length = st.size === 0 ? 0 : end - start + 1;
  res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': String(length), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${st.size}` } : {}) });
  if (req.method === 'HEAD' || length === 0) {
    res.end();
    return;
  }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
