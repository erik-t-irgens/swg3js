// The file a dev-server middleware mounted on a folder answers a request with (Map-maker II's tenth wave: `vite.config.ts`'s
// `privateImports`, which serves imports-private/ and public/imports/ from the disk). The one rule that keeps such a
// middleware from serving any file on the disk: the request's path, decoded, must stand inside the folder, so `..`, an
// encoded `%2e%2e` and a backslash all answer nothing. Pure (node's own `path` only), so a node test runs it.
import path from 'node:path';

/**
 * The file under `dir` a request's URL (as the middleware sees it, the mount's prefix taken off) names, or null for none
 * the folder may answer: a path outside the folder, the folder itself, or one that does not decode.
 */
export function servedFile(dir, url) {
  let rel;
  try {
    rel = decodeURIComponent(String(url ?? '/').split('?')[0]);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  const root = path.resolve(dir);
  const file = path.resolve(root, `.${rel.startsWith('/') ? rel : `/${rel}`}`);
  return file.startsWith(root + path.sep) ? file : null;
}
