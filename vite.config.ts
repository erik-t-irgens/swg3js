import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const PRIVATE_DIR = path.resolve(__dirname, 'assets-private');

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
      if (fs.existsSync(PRIVATE_DIR)) fs.cpSync(PRIVATE_DIR, path.resolve(__dirname, 'dist/assets-private'), { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [privateAssets()],
  build: { target: 'es2022', sourcemap: false },
  server: { host: true },
});
