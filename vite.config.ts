import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { STORY_FILE, listStorySet } from './server/storySet.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_DIR = path.resolve(ROOT, 'assets-private');
/** The owner's own story set, beside the checkout and git-ignored like the converted content. */
const STORY_DIR = path.resolve(ROOT, 'story-private');

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
  plugins: [privateAssets(), privateStory()],
  build: { target: 'es2022', sourcemap: false },
  // PORT lets a launcher assign the port; without it Vite picks its own default, so `npm run dev`
  // behaves exactly as before.
  server: { host: true, port: Number(process.env.PORT) || undefined },
});
