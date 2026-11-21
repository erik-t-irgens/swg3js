// The dev server's file watcher and the converted content (the GPU port's pass 1, wave 8, cut 1: `UNWATCHED` in
// vite.config.ts). The config is read as the dev server reads it, twice (as it stands, and with SWG3JS_WATCH_ASSETS=1), and
// each `server.watch` is handed to Vite's own dev server over a folder of the same shape in the system's temporary folder
// (an `assets-private/`, an `imports-private/`, a `src/`), with no port bound: what Vite's own watcher then watches, and
// whether a file written into each folder afterwards is heard. By default neither private folder is watched, the folder
// itself included, and the rest is; with the switch both are watched again.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type UserConfig } from 'vite';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

async function configWith(watch: boolean): Promise<UserConfig> {
  if (watch) process.env.SWG3JS_WATCH_ASSETS = '1';
  else delete process.env.SWG3JS_WATCH_ASSETS;
  // A query of its own, so the config is evaluated again under the variable as it now stands.
  const m = (await import(`../../../vite.config.ts?watch=${watch ? 1 : 0}`)) as { default: UserConfig };
  delete process.env.SWG3JS_WATCH_ASSETS;
  return m.default;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function watched(cfg: UserConfig, expectWatched: boolean): Promise<{ dirs: string[]; heard: Set<string> }> {
  const root = mkdtempSync(join(tmpdir(), 'swg3js-devwatch-'));
  try {
    for (const d of ['assets-private/tatooine', 'imports-private/mine', 'src']) mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, 'assets-private/tatooine/manifest.json'), '{}');
    writeFileSync(join(root, 'imports-private/mine/model.glb'), 'x');
    writeFileSync(join(root, 'src/a.ts'), 'export {};');
    const server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      appType: 'custom',
      cacheDir: join(root, '.vite'),
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, hmr: false, watch: cfg.server?.watch },
    });
    try {
      // Generous bounds: under a machine full of other suites the watcher's first walk and its events come late. Its 'ready'
      // can have gone by before the server is handed back, so the walk is read as done once the code folder is watched.
      const rootSlash = root.replace(/\\/g, '/');
      const walked = (): boolean => Object.keys(server.watcher.getWatched()).some((d) => d.replace(/\\/g, '/') === `${rootSlash}/src`);
      for (let i = 0; i < 600 && !walked(); i++) await wait(50);
      assert.ok(walked(), "Vite's watcher walked the folder within 30 s");
      await wait(300);
      const heard = new Set<string>();
      server.watcher.on('add', (f: string) => heard.add(f.replace(/\\/g, '/')));
      server.watcher.on('change', (f: string) => heard.add(f.replace(/\\/g, '/')));
      writeFileSync(join(root, 'assets-private/tatooine/new.bin'), 'y');
      writeFileSync(join(root, 'imports-private/mine/new.glb'), 'y');
      writeFileSync(join(root, 'src/b.ts'), 'export {};');
      // Every file a watched folder should hear, or 20 s; then a second more for anything else to arrive.
      const want = expectWatched ? ['/src/b.ts', '/assets-private/tatooine/new.bin', '/imports-private/mine/new.glb'] : ['/src/b.ts'];
      for (let i = 0; i < 400 && !want.every((w) => [...heard].some((f) => f.endsWith(w))); i++) await wait(50);
      await wait(1000);
      const dirs = Object.keys(server.watcher.getWatched()).map((d) => d.replace(/\\/g, '/').slice(root.replace(/\\/g, '/').length));
      return { dirs, heard: new Set([...heard].map((f) => f.slice(root.replace(/\\/g, '/').length))) };
    } finally {
      await server.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const off = await watched(await configWith(false), false);
ok(off.dirs.includes('/src') && off.heard.has('/src/b.ts'), `by default the rest of the tree is watched as before (a new code file heard; watched: ${off.dirs.join(' ')})`);
ok(!off.dirs.some((d) => d.startsWith('/assets-private') || d.startsWith('/imports-private')), 'and neither the converted content nor the imports is watched, the folders themselves included');
ok(!off.heard.has('/assets-private/tatooine/new.bin') && !off.heard.has('/imports-private/mine/new.glb'), 'so nothing written there is heard');

const on = await watched(await configWith(true), true);
ok(on.dirs.includes('/assets-private/tatooine') && on.dirs.includes('/imports-private/mine'), `SWG3JS_WATCH_ASSETS=1 watches both again (${on.dirs.join(' ')})`);
ok(on.heard.has('/assets-private/tatooine/new.bin') && on.heard.has('/imports-private/mine/new.glb') && on.heard.has('/src/b.ts'), 'and hears what is written there, as before the cut');

console.log(`\n${passed} passed`);
