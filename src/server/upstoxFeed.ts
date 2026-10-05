import 'server-only';
import path from 'node:path';
import protobuf from 'protobufjs';
import WebSocket from 'ws';
import { upstoxRequest } from './upstox';
import type { StreamEvent } from '@/lib/types';

// Server-side client for the Upstox Market Data Feed V3 (Analytics token):
// authorize → wss → binary JSON subscription (mode ltpc) → protobuf FeedResponse → in-memory LTP map →
// subscribers (/api/stream SSE). Reconnects with exponential backoff (1 s → 30 s). Outside market hours only
// the initial snapshot arrives, which is normal. One connection per process (Upstox allows 2 per user), kept on
// globalThis so dev hot-reloads never open a second one. Idle for 5 minutes → closed to free the slot.

const PROTO = path.join(process.cwd(), 'src', 'server', 'proto', 'MarketDataFeedV3.proto');
const IDLE_MS = 5 * 60_000;
export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
export const STABLE_MS = 30_000;
// Upstox pings every ~5 s and answers our pings within ~0.1 s, market open or closed (probed live 2026-10-04).
// Silence for SILENT_MS therefore means a half-open socket (laptop sleep, Wi-Fi change): terminate it so the
// normal reconnect path runs, instead of serving frozen prices as "live".
export const WATCHDOG_MS = 10_000;
// The app needs ~25 keys (watchlist + holdings + indices + USD/INR); the subscription never shrinks, so cap it.
export const MAX_FEED_KEYS = 300;
export const SILENT_MS = 25_000;

/** True when a socket that should be pinging has been silent too long (no message, ping or pong). */
export function isSilent(lastSeenMs: number, nowMs: number): boolean {
  return nowMs - lastSeenMs > SILENT_MS;
}

/**
 * Reconnect delay rule: a connection that stayed open for STABLE_MS resets the delay to 1 s; anything shorter
 * (refused, or open-then-drop such as Upstox's connection cap) keeps doubling it up to 30 s.
 * Returns [delay to wait now, delay to use next time].
 */
export function nextBackoff(current: number, openedForMs: number | null): [number, number] {
  const base = openedForMs !== null && openedForMs >= STABLE_MS ? BACKOFF_MIN_MS : current;
  return [base, Math.min(base * 2, BACKOFF_MAX_MS)];
}

export interface Tick {
  ltp: number;
  cp: number | null;
  ltt: number | null; // exchange last-trade time, epoch ms
  at: number; // when this process received it
}
export type FeedState = 'connecting' | 'connected' | 'down';
type Listener = (e: StreamEvent) => void;

interface Ltpc {
  ltp?: number;
  ltt?: number;
  cp?: number;
}
interface Decoded {
  feeds?: Record<string, { ltpc?: Ltpc; fullFeed?: { marketFF?: { ltpc?: Ltpc }; indexFF?: { ltpc?: Ltpc } }; firstLevelWithGreeks?: { ltpc?: Ltpc } }>;
  marketInfo?: { segmentStatus?: Record<string, string> };
}

class UpstoxFeed {
  private ws: WebSocket | null = null;
  private keys = new Set<string>();
  private ticks = new Map<string, Tick>();
  private market = new Map<string, string>();
  private listeners = new Set<Listener>();
  private state: FeedState = 'down';
  private since = Date.now();
  private detail: string | undefined;
  private backoffMs = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private decoder: protobuf.Type | null = null;
  private lastUse = Date.now();
  private connecting = false;
  private openedAt = 0;
  private lastSeen = 0; // last message, ping or pong on the current socket
  private watchdog: ReturnType<typeof setInterval> | null = null;

  status(): { feed: FeedState; since: number; detail?: string } {
    return { feed: this.state, since: this.since, detail: this.detail };
  }
  tick(key: string): Tick | undefined {
    return this.ticks.get(key);
  }
  segment(seg: string): string | undefined {
    return this.market.get(seg);
  }

  /** Adds keys to the subscription (connecting if needed). */
  subscribe(keys: string[]): void {
    this.lastUse = Date.now();
    const all = keys.filter(k => !this.keys.has(k));
    const fresh = all.slice(0, Math.max(0, MAX_FEED_KEYS - this.keys.size));
    if (fresh.length < all.length) console.warn(`[feed] subscription cap ${MAX_FEED_KEYS} reached; ${all.length - fresh.length} key(s) not subscribed`);
    for (const k of fresh) this.keys.add(k);
    if (fresh.length && this.ws?.readyState === WebSocket.OPEN) this.send(fresh);
    void this.ensure();
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    this.lastUse = Date.now();
    void this.ensure();
    return () => {
      this.listeners.delete(fn);
      this.lastUse = Date.now();
    };
  }

  /**
   * Waits up to `ms` for every key to have a value from the CURRENT connection (the snapshot arrives right after
   * subscribing). Returns {} when the feed is down, so callers fall back to REST instead of serving stale ticks.
   */
  async waitFor(keys: string[], ms: number): Promise<Record<string, Tick>> {
    this.subscribe(keys);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !keys.every(k => this.ticks.has(k)) && this.state !== 'down') {
      await new Promise(r => setTimeout(r, 100));
    }
    if (this.state !== 'connected') return {};
    const out: Record<string, Tick> = {};
    for (const k of keys) {
      const t = this.ticks.get(k);
      if (t) out[k] = t;
    }
    return out;
  }

  private setState(s: FeedState, detail?: string): void {
    if (s !== this.state) {
      this.state = s;
      this.since = Date.now();
      if (s === 'down') console.warn(`[feed] down: ${detail ?? 'unknown reason'} (retry in ${this.backoffMs} ms)`);
      else if (s === 'connected') console.info('[feed] connected to Upstox Market Data Feed V3');
    }
    this.detail = detail;
    this.emit({ type: 'status', feed: s, since: this.since, detail });
  }

  private emit(e: StreamEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch (err) {
        console.warn(`[feed] listener failed: ${(err as Error).message}`);
      }
    }
  }

  private wanted(): boolean {
    return this.listeners.size > 0 || Date.now() - this.lastUse < IDLE_MS;
  }

  private async ensure(): Promise<void> {
    this.armIdle();
    if (this.connecting || this.retryTimer) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    await this.connect();
  }

  private async connect(): Promise<void> {
    this.connecting = true;
    this.setState('connecting');
    try {
      this.decoder ??= (await protobuf.load(PROTO)).lookupType('com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse');
      const auth = await upstoxRequest<{ data?: { authorized_redirect_uri?: string; authorizedRedirectUri?: string } }>({
        path: '/v3/feed/market-data-feed/authorize',
        token: 'analytics',
      });
      if (!auth.ok) throw new Error(`authorize failed (${auth.error.code}: ${auth.error.message})`);
      const url = auth.json.data?.authorized_redirect_uri ?? auth.json.data?.authorizedRedirectUri;
      if (!url) throw new Error('authorize returned no wss url');
      const ws = new WebSocket(url, { followRedirects: true });
      this.ws = ws;
      let lastError = '';
      ws.on('open', () => {
        if (this.ws !== ws) return;
        this.openedAt = Date.now();
        this.lastSeen = Date.now();
        this.armWatchdog(ws);
        this.setState('connected');
        if (this.keys.size) this.send([...this.keys]);
      });
      ws.on('message', (data: WebSocket.RawData) => {
        if (this.ws !== ws) return;
        this.lastSeen = Date.now();
        this.onMessage(data);
      });
      ws.on('ping', () => {
        if (this.ws === ws) this.lastSeen = Date.now();
      });
      ws.on('pong', () => {
        if (this.ws === ws) this.lastSeen = Date.now();
      });
      ws.on('error', err => {
        lastError = err.message;
      });
      ws.on('close', (code, reason) => {
        if (this.ws !== ws) return; // an old, replaced socket must not change the state
        this.ws = null;
        this.stopWatchdog();
        // Values from a closed connection are no longer live: callers fall back to LTP v3 / candles until it reconnects.
        this.ticks.clear();
        this.market.clear();
        const openedFor = this.openedAt ? Date.now() - this.openedAt : null; // null: it never opened
        this.openedAt = 0;
        const why = [`closed ${code}`, reason?.length ? reason.toString() : '', lastError].filter(Boolean).join(' · ');
        this.setState('down', why);
        this.scheduleReconnect(openedFor);
      });
    } catch (e) {
      this.ws = null;
      this.setState('down', `connect failed: ${(e as Error).message}`);
      this.scheduleReconnect(null);
    } finally {
      this.connecting = false;
    }
  }

  /** openedForMs: how long the closed socket was open (a stable one resets the delay); null when it never opened. */
  private scheduleReconnect(openedForMs: number | null): void {
    if (this.retryTimer || !this.wanted()) return;
    const [wait, next] = nextBackoff(this.backoffMs, openedForMs);
    this.backoffMs = next;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.ensure();
    }, wait);
    this.retryTimer.unref?.();
  }

  private armWatchdog(ws: WebSocket): void {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      if (this.ws !== ws) return this.stopWatchdog();
      if (isSilent(this.lastSeen, Date.now())) {
        console.warn(`[feed] no message, ping or pong for ${SILENT_MS / 1000} s — dropping the half-open socket`);
        ws.terminate(); // emits 'close' → ticks cleared, state down, reconnect with backoff
        return;
      }
      try {
        ws.ping();
      } catch {
        /* socket closing; the close handler takes over */
      }
    }, WATCHDOG_MS);
    this.watchdog.unref?.();
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.wanted()) return this.armIdle();
      this.ws?.close(1000, 'idle');
    }, IDLE_MS + 1000);
    this.idleTimer.unref?.();
  }

  private send(keys: string[]): void {
    const msg = { guid: `amc-${Date.now().toString(36)}`, method: 'sub', data: { mode: 'ltpc', instrumentKeys: keys } };
    this.ws?.send(Buffer.from(JSON.stringify(msg))); // Upstox requires the subscription as a binary frame
  }

  private onMessage(data: WebSocket.RawData): void {
    if (!this.decoder) return;
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    let m: Decoded;
    try {
      m = this.decoder.toObject(this.decoder.decode(buf), { longs: Number, enums: String, defaults: false }) as Decoded;
    } catch (e) {
      console.warn(`[feed] undecodable message: ${(e as Error).message}`);
      return;
    }
    for (const [seg, st] of Object.entries(m.marketInfo?.segmentStatus ?? {})) {
      this.market.set(seg, st);
      this.emit({ type: 'market', segment: seg, status: st });
    }
    for (const [key, f] of Object.entries(m.feeds ?? {})) {
      const l = f.ltpc ?? f.fullFeed?.marketFF?.ltpc ?? f.fullFeed?.indexFF?.ltpc ?? f.firstLevelWithGreeks?.ltpc;
      if (!l || typeof l.ltp !== 'number') continue;
      const t: Tick = { ltp: l.ltp, cp: typeof l.cp === 'number' ? l.cp : null, ltt: typeof l.ltt === 'number' ? l.ltt : null, at: Date.now() };
      this.ticks.set(key, t);
      this.emit({ type: 'tick', key, ltp: t.ltp, cp: t.cp, ltt: t.ltt });
    }
  }
}

const g = globalThis as unknown as { __amcUpstoxFeed?: UpstoxFeed };
export const feed: UpstoxFeed = g.__amcUpstoxFeed ?? (g.__amcUpstoxFeed = new UpstoxFeed());

/** Latest feed values for `keys`, subscribing if needed and waiting up to `ms` for the snapshot. */
export function feedSnapshot(keys: string[], ms: number): Promise<Record<string, Tick>> {
  return feed.waitFor(keys, ms);
}
