import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_DIR = path.resolve(ROOT, 'assets-private');

/**
 * Serves the git-ignored assets-private/ folder (converted SWG content) at
 * /assets-private/ in dev and copies it into dist/ on build. The Pages
 * workflow builds from a clean checkout, so nothing private ever deploys.
 */
const TYPES: Record<string, string> = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** Where the backdrop shoot is allowed to write, and the only extensions it may write there. */
const SCENES_DIR = path.join(PRIVATE_DIR, 'scenes');
const SCENE_WRITABLE = new Set(['.jpg', '.json']);
/** A backdrop is a few megabytes; anything far past that is a mistake and is refused rather than written. */
const SCENE_MAX_BYTES = 64 * 1024 * 1024;

function privateAssets(): Plugin {
  return {
    name: 'private-assets',
    configureServer(server) {
      server.middlewares.use('/assets-private', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = path.join(PRIVATE_DIR, rel);

        // Writing back: the backdrop shoot renders each of the owner's captured shots in the game
        // itself and posts the picture here. It is the dev server's own hand doing it, which is
        // why it is confined to the scenes folder and to the two extensions that belong in it --
        // a stray path or a stray type is refused rather than trusted, since this is a socket
        // listening on the machine's network interfaces (`server.host` is on for the launcher).
        if (req.method === 'POST' || req.method === 'PUT') {
          const dir = path.dirname(file);
          if (!file.startsWith(SCENES_DIR + path.sep) || !SCENE_WRITABLE.has(path.extname(file).toLowerCase())) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'text/plain');
            res.end('scenes only');
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          let stopped = false;
          req.on('data', (c: Buffer) => {
            if (stopped) return;
            size += c.length;
            if (size > SCENE_MAX_BYTES) {
              stopped = true;
              res.statusCode = 413;
              res.end('too large');
              req.destroy();
              return;
            }
            chunks.push(c);
          });
          req.on('end', () => {
            if (stopped) return;
            try {
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(file, Buffer.concat(chunks));
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ wrote: rel, bytes: size }));
            } catch (e) {
              res.statusCode = 500;
              res.end(String((e as Error).message ?? e));
            }
          });
          return;
        }

        if (!file.startsWith(PRIVATE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain');
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
        void next;
      });
    },
    closeBundle() {
      // SWG3JS_NO_PRIVATE=1 is the release pack's build (tools/launcher/pack.mjs --build): a release is
      // never to carry converted content, even when it is packed on a machine that has some.
      if (process.env.SWG3JS_NO_PRIVATE === '1') return;
      if (fs.existsSync(PRIVATE_DIR)) fs.cpSync(PRIVATE_DIR, path.resolve(ROOT, 'dist/assets-private'), { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [privateAssets()],
  build: { target: 'es2022', sourcemap: false },
  // PORT lets a launcher assign the port; without it Vite picks its own default, so `npm run dev`
  // behaves exactly as before.
  server: { host: true, port: Number(process.env.PORT) || undefined },
});
