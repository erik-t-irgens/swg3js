// The fit's worker (the GPU port's pass 2, wave 1): each row of a world's sky given its air record and the twin's two
// small tables, off the main thread, behind the loading screen (`airFit.ts` does the work; this carries messages and
// decodes the gradient pictures the clear rows name, which is where SWG's sky keeps its colour).
import { fitReply, pictureSampler, type FitAsk } from './airFit.ts';

const scope = self as unknown as { onmessage: ((e: MessageEvent<FitAsk>) => void) | null; postMessage(m: unknown, transfer: Transferable[]): void };

/** A picture fetched and read into its bytes, top row first; null where it could not be. */
async function readPicture(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close();
    return { width: img.width, height: img.height, data: img.data };
  } catch {
    return null;
  }
}

scope.onmessage = async (e: MessageEvent<FitAsk>) => {
  const ask = e.data;
  const pictures = new Map<string, { width: number; height: number; data: Uint8ClampedArray }>();
  await Promise.all(
    Object.entries(ask.gradients ?? {}).map(async ([file, url]) => {
      const p = await readPicture(url);
      if (p) pictures.set(file, p);
    }),
  );
  const reply = fitReply(ask, pictureSampler(pictures));
  const transfer: Transferable[] = [reply.depth.buffer];
  for (const a of reply.records) transfer.push(a.buffer);
  for (const a of reply.psis) transfer.push(a.buffer);
  scope.postMessage({ ...reply, pictures: pictures.size }, transfer);
};
