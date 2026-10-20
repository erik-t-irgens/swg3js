/// <reference types="vite/client" />

/**
 * The public files a built game ships (`vite.config.ts`'s `shippedPublic`): the tracked `public/tracks`,
 * `public/placements` and `public/dem` files, as paths under `public/`; null on the dev server, which lists none.
 */
declare module 'virtual:shipped-public' {
  const list: readonly string[] | null;
  export default list;
}
