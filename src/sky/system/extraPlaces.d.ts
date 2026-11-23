// The type of `extraPlaces.js`: the owner's extra places as `looks.js` keeps them (pass 2, wave 5, maker S).

export const EXTRA_PLACES: readonly {
  id: string;
  zone: string;
  what: string;
  kind: string;
  start: { size?: number; yaw?: number; pitch?: number; light?: string; [k: string]: unknown };
}[];
