import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { STORY_FILE, listStorySet } from './server/storySet.mjs';
import { placementFileOf } from './src/story/placementPath.ts';
import { trackFileOf } from './src/race/trackPath.ts';
import { shippedPublic } from './tools/dev/shippedPublic.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_DIR = path.resolve(ROOT, 'assets-private');
/** The owner's own story set, beside the checkout and git-ignored like the converted content. */
const STORY_DIR = path.resolve(ROOT, 'story-private');
/** The permanent placements' two layers (`src/story/placements.ts`): tracked files that ship with the build. */
const PLACEMENTS_DIR = path.resolve(ROOT, 'public', 'placements');
/** The worlds' race tracks (`src/race/trackFile.ts`): tracked files that ship with the build, one a world. */
const TRACKS_DIR = path.resolve(ROOT, 'public', 'tracks');

/** The list of the owner's story files, as `/story-private/index.json` hands it to the browser. */
function storyIndex(): string {
  let files: string[] = [];
  try {
    files = listStorySet(STORY_DIR).map((f: { path: string }) => f.path);
  } catch (err) {
    console.warn(`story-private: ${(err as Error).message}`);
  }
  return JSON.stringify({ files });
}

/**
 * Serves the git-ignored story-private/ folder (the owner's own quests and the rest) at /story-private/
 * in dev, with `/story-private/index.json`, the list of its files, made fresh on every ask; watches it
 * and tells the page (`story:changed`, a custom HMR event) when anything in it changes, so an edit
 * reloads the story without a restart; and copies it into dist/ on a local build with its index written.
 * A release build (SWG3JS_NO_PRIVATE=1) never carries it, exactly as with assets-private, and the
 * release pack refuses any path through it.
 */
function privateStory(): Plugin {
  return {
    name: 'private-story',
    configureServer(server) {
      server.middlewares.use('/story-private', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        res.setHeader('Cache-Control', 'no-store');
        if (rel === '/index.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(storyIndex());
          return;
        }
        const file = path.resolve(STORY_DIR, `.${rel}`);
        if (!file.startsWith(STORY_DIR + path.sep) || !STORY_FILE.test(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain');
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        fs.createReadStream(file).pipe(res);
        void next;
      });
      server.watcher.add(STORY_DIR);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const changed = (file: string): void => {
        const abs = path.resolve(file);
        if (abs !== STORY_DIR && !abs.startsWith(STORY_DIR + path.sep)) return;
        // An editor saving a file touches it more than once: one word for the lot.
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          server.ws.send('story:changed', { at: Date.now() });
        }, 150);
      };
      for (const ev of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) server.watcher.on(ev, changed);
    },
    closeBundle() {
      if (process.env.SWG3JS_NO_PRIVATE === '1') return;
      if (!fs.existsSync(STORY_DIR)) return;
      const out = path.resolve(ROOT, 'dist/story-private');
      fs.cpSync(STORY_DIR, out, { recursive: true });
      fs.writeFileSync(path.join(out, 'index.json'), storyIndex());
    },
  };
}

/**
 * Tells the page when one of the permanent placements' files changes (`placements:changed`, a custom HMR
 * event naming the layer and the world), so an edit by hand, or the editor's own write, is stood without a
 * reload. Vite builds `public/` itself, and no module imports these files, so a save reloads nothing on its
 * own; this is the only word the page gets. A file in a dot folder or under a dot name says nothing, and
 * neither does anything that is not `<layer>/<world>.json` (`placementFileOf`).
 *
 * On the dev server it also answers the page's ask for one of those files itself, from the disk as it stands at
 * that moment, and a file that is not there with a 404. Vite would answer from its own list of the public folder,
 * which learns of a new file only once its watcher has told it: the page asking in the moment after the editor
 * first wrote a world's file (the editor says so the instant it is written) was handed the page itself, which
 * reads as no file at all, and the rows the save had just stood were taken down again.
 */
function placementFiles(): Plugin {
  return {
    name: 'placement-files',
    configureServer(server) {
      server.middlewares.use('/placements', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const word = placementFileOf(decodeURIComponent((req.url ?? '/').split('?')[0]));
        if (!word) return next();
        const file = path.resolve(PLACEMENTS_DIR, word.layer, `${word.world}.json`);
        if (!file.startsWith(PLACEMENTS_DIR + path.sep)) return next();
        res.setHeader('Cache-Control', 'no-store');
        fs.readFile(file, (err, data) => {
          if (err) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('not found');
            return;
          }
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(req.method === 'HEAD' ? undefined : data);
        });
      });
      server.watcher.add(PLACEMENTS_DIR);
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      const changed = (file: string): void => {
        const abs = path.resolve(file);
        if (!abs.startsWith(PLACEMENTS_DIR + path.sep)) return;
        const word = placementFileOf(path.relative(PLACEMENTS_DIR, abs));
        if (!word) return;
        // An editor saving a file touches it more than once: one word for the lot, per file.
        const key = `${word.layer}/${word.world}`;
        const was = timers.get(key);
        if (was) clearTimeout(was);
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key);
            server.ws.send('placements:changed', word);
          }, 150),
        );
      };
      for (const ev of ['add', 'change', 'unlink'] as const) server.watcher.on(ev, changed);
    },
  };
}

/**
 * The placement editor's endpoint, `POST /__dev/placements`, which writes a world's two files of permanent
 * placements under `public/placements/` one row at a time (`tools/dev/placementsEndpoint.mjs`, its rules in
 * `src/world/placementEdits.ts`). The dev server's alone: a build carries no server, a release is packed
 * without this file, and the launcher answers nothing but GET. The glue is loaded at the first ask by a name
 * worked out here, so it and what it imports are never this config's dependencies and editing them never
 * restarts the dev server; the price is that the endpoint runs the code it first loaded until a restart.
 * Every file it writes is said to the page at once (`placements:changed`; the page reads the file through the
 * placement files' own answer above, from the disk, so it finds what was just written), and the watcher above
 * says it again a moment later, which the page's sync finds already done.
 */
function placementsEditor(): Plugin {
  return {
    name: 'placements-editor',
    apply: 'serve',
    configureServer(server) {
      const glue = pathToFileURL(path.resolve(ROOT, 'tools', 'dev', 'placementsEndpoint.mjs')).href;
      server.middlewares.use('/__dev/placements', (req, res) => {
        import(/* @vite-ignore */ glue)
          .then((m: { handle: (req: unknown, res: unknown, opts: unknown) => Promise<void> }) => m.handle(req, res, { dir: PLACEMENTS_DIR, notify: (word: { layer: string; world: string }) => server.ws.send('placements:changed', word) }))
          .catch((err: unknown) => {
            if (res.headersSent) return;
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, why: `the placement editor's endpoint failed: ${err instanceof Error ? err.message : String(err)}` }));
          });
      });
    },
  };
}

/**
 * The tracks' files as the placements' are served (`placementFiles` above): `tracks:changed { world }` said to the page
 * when a world's file changes, so a track edited by hand, or the editor's own write, is read again without a reload,
 * and the page's ask for a file answered from the disk as it stands, a file that is not there with a 404 (Vite's own
 * list of the public folder learns of a new file only once its watcher has told it).
 */
function trackFiles(): Plugin {
  return {
    name: 'track-files',
    configureServer(server) {
      server.middlewares.use('/tracks', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const word = trackFileOf(decodeURIComponent((req.url ?? '/').split('?')[0]));
        if (!word) return next();
        const file = path.resolve(TRACKS_DIR, `${word.world}.json`);
        if (!file.startsWith(TRACKS_DIR + path.sep)) return next();
        res.setHeader('Cache-Control', 'no-store');
        fs.readFile(file, (err, data) => {
          if (err) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('not found');
            return;
          }
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(req.method === 'HEAD' ? undefined : data);
        });
      });
      server.watcher.add(TRACKS_DIR);
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      const changed = (file: string): void => {
        const abs = path.resolve(file);
        if (!abs.startsWith(TRACKS_DIR + path.sep)) return;
        const word = trackFileOf(path.relative(TRACKS_DIR, abs));
        if (!word) return;
        const was = timers.get(word.world);
        if (was) clearTimeout(was);
        timers.set(
          word.world,
          setTimeout(() => {
            timers.delete(word.world);
            server.ws.send('tracks:changed', word);
          }, 150),
        );
      };
      for (const ev of ['add', 'change', 'unlink'] as const) server.watcher.on(ev, changed);
    },
  };
}

/**
 * The track editor's endpoint, `POST /__dev/tracks`, which writes a world's track file under `public/tracks/` one track
 * at a time (`tools/dev/tracksEndpoint.mjs`, its rules in `src/race/trackEdits.ts`), loaded at the first ask by a name
 * worked out here, as the placements editor's is: the dev server's alone, and never this config's dependency.
 */
function tracksEditor(): Plugin {
  return {
    name: 'tracks-editor',
    apply: 'serve',
    configureServer(server) {
      const glue = pathToFileURL(path.resolve(ROOT, 'tools', 'dev', 'tracksEndpoint.mjs')).href;
      server.middlewares.use('/__dev/tracks', (req, res) => {
        import(/* @vite-ignore */ glue)
          .then((m: { handle: (req: unknown, res: unknown, opts: unknown) => Promise<void> }) => m.handle(req, res, { dir: TRACKS_DIR, notify: (word: { world: string }) => server.ws.send('tracks:changed', word) }))
          .catch((err: unknown) => {
            if (res.headersSent) return;
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, why: `the track editor's endpoint failed: ${err instanceof Error ? err.message : String(err)}` }));
          });
      });
    },
  };
}

/**
 * `virtual:shipped-public`: in a build, the list of the tracked `public/tracks`, `public/placements` and `public/dem` files
 * the release carries (`tools/dev/shippedPublic.mjs`), so a built game asks for a world's tracks, its permanent
 * placements and a raster only when it has them; on the dev server `null`, no list at all, and every such file is asked
 * for and answered from the disk (`placementFiles`, `trackFiles`). Never kept current by a watcher: the module is fixed
 * in the page's loaded graph, so a list changed in dev would reload the page at the editor's first save of a world's
 * file, or tell the page not to fetch the file that save had just written. The player's own story's index is no part of
 * it: the launcher serves a folder the player names at run time (`storyDir`), which no list made here can know, so the
 * page asks for it at every boot.
 */
function shippedPublicList(): Plugin {
  const id = 'virtual:shipped-public';
  let build = false;
  return {
    name: 'shipped-public',
    configResolved(config) {
      build = config.command === 'build';
    },
    resolveId(source) {
      return source === id ? `\0${id}` : null;
    },
    load(source) {
      if (source !== `\0${id}`) return null;
      if (!build) return 'export default null;';
      return `export default ${JSON.stringify(shippedPublic(ROOT))};`;
    },
  };
}

/**
 * Serves the git-ignored assets-private/ folder (converted SWG content) at
 * /assets-private/ in dev and copies it into dist/ on build. The Pages
 * workflow builds from a clean checkout, so nothing private ever deploys.
 */
function privateAssets(): Plugin {
  return {
    name: 'private-assets',
    configureServer(server) {
      server.middlewares.use('/assets-private', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = path.join(PRIVATE_DIR, rel);
        if (!file.startsWith(PRIVATE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain');
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : file.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream');
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
  plugins: [privateAssets(), privateStory(), placementFiles(), placementsEditor(), trackFiles(), tracksEditor(), shippedPublicList()],
  build: { target: 'es2022', sourcemap: false },
  // PORT lets a launcher assign the port; without it Vite picks its own default, so `npm run dev`
  // behaves exactly as before.
  server: { host: true, port: Number(process.env.PORT) || undefined },
});
