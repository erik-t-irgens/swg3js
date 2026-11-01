/**
 * The path from one pack's folder to another's, as a prefix for a file named relative to the second:
 * `/assets-private/tatooine/` to `/assets-private/gallery/` is `../gallery/`.
 *
 * The effects loader resolves every file against the pack of the world being stood on, while a model
 * out of a pack standing behind it (the gallery's, the props pack's) names its effects relative to its
 * own; this is the re-rooting between the two. Pure and on its own, so a node test can reach it.
 */
export function relativeRoot(from: string, to: string): string {
  const a = from.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return '../'.repeat(a.length - i) + b.slice(i).map((part) => `${part}/`).join('');
}

/** A pack's id from its folder (`/assets-private/tatooine/` is `tatooine`): the id a look's donor and an attachment's file name it by. */
export function packIdOfRoot(root: string): string {
  const parts = root.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] ?? '';
}
