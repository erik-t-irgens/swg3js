/**
 * Decoding 16-bit PCM WAV off the main thread. Every sample the game ships as a WAV is 16-bit PCM,
 * mostly mono at 22,050 Hz, so it is turned into Float32 here and kept at the file's own rate: the
 * browser's own `decodeAudioData` would resample to the device's 48 kHz, which is 2.2 times the
 * memory for the same sound. Anything this cannot read (an MP3, a format tag that is not 1) comes
 * back null and the bank falls back to `decodeAudioData`.
 *
 * `parseWav` is pure and has no worker in it, so a node test reads a synthetic file with it.
 */

export interface WavData {
  channels: Float32Array[];
  sampleRate: number;
  /** Loop points in frames, only where the file loops part of itself. */
  loop: [number, number] | null;
  frames: number;
}

const tag = (view: DataView, at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

/** Reads `fmt `, `data` and `smpl`. Returns null for anything that is not 16-bit PCM. */
export function parseWav(bytes: ArrayBuffer): WavData | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes);
  if (tag(view, 0) !== 'RIFF' || tag(view, 8) !== 'WAVE') return null;
  let channelCount = 0;
  let sampleRate = 0;
  let bits = 0;
  let format = 0;
  let dataAt = -1;
  let dataLength = 0;
  let loop: [number, number] | null = null;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const name = tag(view, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (name === 'fmt ' && size >= 16) {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (name === 'data') {
      dataAt = body;
      dataLength = Math.min(size, bytes.byteLength - body);
    } else if (name === 'smpl' && size >= 36) {
      const loops = view.getUint32(body + 28, true);
      if (loops > 0 && size >= 36 + 24) {
        const start = view.getUint32(body + 36 + 8, true);
        const end = view.getUint32(body + 36 + 12, true);
        if (end > start) loop = [start, end];
      }
    }
    at = body + size + (size & 1);
  }
  if (format !== 1 || bits !== 16 || channelCount < 1 || sampleRate < 1 || dataAt < 0) return null;
  const frames = Math.floor(dataLength / (2 * channelCount));
  if (frames <= 0) return null;
  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c++) channels.push(new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    const base = dataAt + f * 2 * channelCount;
    for (let c = 0; c < channelCount; c++) channels[c][f] = view.getInt16(base + c * 2, true) / 32768;
  }
  // A loop the file says covers the whole sound is no loop at all: only the three files that loop
  // part of themselves need points, and the rest simply repeat.
  if (loop && loop[0] === 0 && loop[1] >= frames - 1) loop = null;
  return { channels, sampleRate, loop, frames };
}

/** All zeroes: fifteen samples in the archives are zero-filled and cannot be used. */
export function isSilentPcm(data: WavData): boolean {
  for (const ch of data.channels) {
    for (let i = 0; i < ch.length; i++) if (ch[i] !== 0) return false;
  }
  return true;
}

export interface WavRequest {
  id: string;
  bytes: ArrayBuffer;
}

export interface WavReply {
  id: string;
  ok: boolean;
  channels?: Float32Array[];
  sampleRate?: number;
  loop?: [number, number] | null;
  frames?: number;
  silent?: boolean;
}

// The worker half. Guarded, so importing this module in a node test (which has no `self`) does
// nothing at all.
const scope = typeof self !== 'undefined' ? (self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t?: Transferable[]): void }) : null;
if (scope && typeof window === 'undefined') {
  scope.onmessage = (e: MessageEvent) => {
    const req = e.data as WavRequest;
    const data = parseWav(req.bytes);
    if (!data) {
      scope.postMessage({ id: req.id, ok: false } satisfies WavReply);
      return;
    }
    const reply: WavReply = { id: req.id, ok: true, channels: data.channels, sampleRate: data.sampleRate, loop: data.loop, frames: data.frames, silent: isSilentPcm(data) };
    scope.postMessage(reply, data.channels.map((c) => c.buffer as Transferable));
  };
}
