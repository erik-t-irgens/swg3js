// The space body viewer's Vite (`npm run viewer`; the GPU port's pass 2, wave 4): the old Feature-requests viewer moved into
// the repo, so it always runs the game's current code on the game's own three. Its page is this folder (`index.html`,
// `style.css`, `app.js`, `main.js`), its modules `src/sky/look/` and `src/sky/system/`, shared with the game; its server's
// answers are the old `serve.mjs`'s, as this Vite's middleware (`server.mjs`). Port 5194 by default, so it runs beside the
// old viewer on 5195 while the owner compares them; `SBV_PORT` moves it. Every path of his (his file of choices, his
// imported pictures, the survey, the packs, his looks' private table, the game's bodies file) comes from the process
// environment over the repo's `.env` (`viewerPaths` names each).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { lanNames, startWords, viewerMiddleware, viewerPaths } from './server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export default defineConfig(({ mode }) => {
  // The repo's .env under the process's own environment (a process variable wins, so a test points the viewer at a copy).
  const env = { ...loadEnv(mode, ROOT, ''), ...process.env } as Record<string, string | undefined>;
  const P = viewerPaths(env, ROOT);
  const serve: Plugin = {
    name: 'space-body-viewer',
    configureServer(server) {
      server.middlewares.use(viewerMiddleware(P));
      server.httpServer?.once('listening', () => {
        for (const line of startWords(P)) console.log(line);
      });
    },
  };
  return {
    root: HERE,
    base: './',
    // The viewer's own optimised-dependency cache, apart from the game's (a test points it into its scratch folder).
    cacheDir: env.SBV_CACHE ? path.resolve(ROOT, env.SBV_CACHE) : path.resolve(ROOT, 'node_modules', '.vite-viewer'),
    // No public folder of its own: the game's `public/` is the game's, and Save to game writes into it by its own path.
    publicDir: false,
    // Three and its addons made ready afresh at every start, from the whole graph the page reaches (its own modules and the
    // game's air): with no reloading (`hmr` below) a dependency first found in play could never reach the page, which then
    // stops on a 504 "Outdated Optimize Dep" until the server is restarted with its cache cleared.
    optimizeDeps: { force: true, entries: ['index.html', 'main.js', 'app.js'] },
    // The game's own three as the game resolves it (the old page's import map put a bare `three` on the WebGPU build; the
    // viewer's own modules name `three/webgpu` themselves, and the game's modules the viewer now reads need three's whole
    // module build, which shares its core with the WebGPU build).
    plugins: [serve],
    server: {
      host: P.shared ? true : '127.0.0.1',
      port: P.port,
      strictPort: true,
      allowedHosts: P.shared ? lanNames(P) : undefined,
      // The owner's choice for the game's dev server too: an edit never reloads a page in use.
      hmr: false,
      fs: { allow: [ROOT] },
      watch: { ignored: ['**/assets-private/**', '**/imports-private/**', '**/public/**', '**/node_modules/**'] },
    },
  };
});
