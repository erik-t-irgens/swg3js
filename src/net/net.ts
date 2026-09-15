// The client of the relay (server/relay.mjs): a WebSocket that carries where this player is a
// few times a second and brings back everyone else's, with a reconnect when the line drops.

export interface Hello {
  name: string;
  species: string;
  class: 'jedi' | 'bounty_hunter';
  planet: string;
  zone?: string;
}

export interface PeerState {
  p: [number, number, number];
  h: number;
  /** The rig state name (idle, run, ...). */
  s: string;
  /** Speed, m/s, for the clip's pace. */
  v: number;
  /** Mounted on a vehicle. */
  m: boolean;
  /** The saber is lit. */
  sab: boolean;
}

export interface Peer {
  id: number;
  hello: Hello;
  state: PeerState | null;
}

type Status = 'off' | 'connecting' | 'online' | 'reconnecting';

const STORAGE = 'swg.server';

export class Net {
  private socket: WebSocket | null = null;
  private url = '';
  private hello: Hello | null = null;
  private retryTimer = 0;
  private retryDelay = 1000;
  private wanted = false;
  status: Status = 'off';
  id = 0;
  readonly peers = new Map<number, Peer>();
  onJoin: (peer: Peer) => void = () => {};
  onLeave: (id: number) => void = () => {};
  onHello: (peer: Peer) => void = () => {};
  onState: (id: number, state: PeerState) => void = () => {};
  onEmote: (id: number, clip: string) => void = () => {};
  onStatus: (status: Status, detail: string) => void = () => {};

  /** The server kept in this browser, or the one in ?server=, or none. */
  static savedUrl(): string {
    const param = new URLSearchParams(location.search).get('server');
    if (param) return param;
    try {
      return localStorage.getItem(STORAGE) ?? '';
    } catch {
      return '';
    }
  }

  static saveUrl(url: string): void {
    try {
      if (url) localStorage.setItem(STORAGE, url);
      else localStorage.removeItem(STORAGE);
    } catch {
      /* no storage */
    }
  }

  get online(): boolean {
    return this.status === 'online';
  }

  /** Connect (or reconnect) to a relay and announce who this is; the hello is repeated on every reconnect. */
  connect(url: string, hello: Hello): void {
    this.url = url.trim();
    this.hello = hello;
    this.wanted = !!this.url;
    this.open();
  }

  /** Who and where this player is now (a new world after travel); sent at once when online. */
  setHello(hello: Hello): void {
    this.hello = hello;
    if (this.online) this.send({ t: 'hello', ...hello });
  }

  disconnect(): void {
    this.wanted = false;
    window.clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = null;
    this.clearPeers();
    this.setStatus('off', '');
  }

  private open(): void {
    if (!this.wanted || !this.url) return;
    window.clearTimeout(this.retryTimer);
    this.socket?.close();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.setStatus('off', `bad address: ${err instanceof Error ? err.message : String(err)}`);
      this.wanted = false;
      return;
    }
    this.socket = ws;
    this.setStatus(this.retryDelay > 1000 ? 'reconnecting' : 'connecting', this.url);
    ws.onopen = () => {
      this.retryDelay = 1000;
      this.setStatus('online', this.url);
      if (this.hello) this.send({ t: 'hello', ...this.hello });
    };
    ws.onmessage = (e) => this.receive(String(e.data));
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.clearPeers();
      if (!this.wanted) return;
      this.setStatus('reconnecting', `in ${Math.round(this.retryDelay / 1000)} s`);
      this.retryTimer = window.setTimeout(() => this.open(), this.retryDelay);
      this.retryDelay = Math.min(15000, this.retryDelay * 2);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private clearPeers(): void {
    for (const id of [...this.peers.keys()]) {
      this.peers.delete(id);
      this.onLeave(id);
    }
  }

  private setStatus(status: Status, detail: string): void {
    this.status = status;
    this.onStatus(status, detail);
  }

  private send(msg: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  /** Where this player is now; a few times a second is plenty. */
  sendState(state: PeerState): void {
    if (this.online) this.send({ t: 'state', ...state });
  }

  sendEmote(clip: string): void {
    if (this.online) this.send({ t: 'emote', clip });
  }

  private receive(text: string): void {
    let msg: { t: string; id?: number; hello?: Hello; peers?: Peer[]; clip?: string } & Partial<PeerState>;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id ?? 0;
        for (const p of msg.peers ?? []) {
          this.peers.set(p.id, p);
          this.onJoin(p);
          if (p.state) this.onState(p.id, p.state);
        }
        break;
      case 'join':
        if (msg.id !== undefined && msg.hello) {
          const peer = { id: msg.id, hello: msg.hello, state: null };
          this.peers.set(msg.id, peer);
          this.onJoin(peer);
        }
        break;
      case 'hello':
        if (msg.id !== undefined && msg.hello) {
          const peer = this.peers.get(msg.id);
          if (peer) {
            peer.hello = msg.hello;
            this.onHello(peer);
          }
        }
        break;
      case 'leave':
        if (msg.id !== undefined) {
          this.peers.delete(msg.id);
          this.onLeave(msg.id);
        }
        break;
      case 'state':
        if (msg.id !== undefined && msg.p) {
          const peer = this.peers.get(msg.id);
          const state: PeerState = { p: msg.p, h: msg.h ?? 0, s: msg.s ?? 'idle', v: msg.v ?? 0, m: !!msg.m, sab: !!msg.sab };
          if (peer) peer.state = state;
          this.onState(msg.id, state);
        }
        break;
      case 'emote':
        // An empty clip is the end of a dance or a sit: the figure goes back to what it was doing.
        if (msg.id !== undefined && typeof msg.clip === 'string') this.onEmote(msg.id, msg.clip);
        break;
    }
  }
}
