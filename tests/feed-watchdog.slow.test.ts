// Slow integration test (≈ 70 s, `npm run test:slow`): the real UpstoxFeed class against a local WebSocket server.
// Upstox pings every ~5 s and answers our pings at once (probed live 2026-10-04), so a socket that answers nothing
// for SILENT_MS is half-open (laptop sleep, Wi-Fi change). The feed must drop it and reconnect, and must never drop
// a quiet but healthy socket (market closed: no ticks, only ping/pong).
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';

const target = vi.hoisted(() => ({ url: '' }));
vi.mock('@/server/upstox', () => ({
  // authorize → our local server instead of wss://api.upstox.com
  upstoxRequest: async () => ({ ok: true, status: 200, json: { data: { authorized_redirect_uri: target.url } } }),
}));

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('feed watchdog (real UpstoxFeed, local WebSocket server)', () => {
  it('keeps a quiet socket that answers pings, drops it once it goes silent, then reconnects', async () => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', autoPong: false });
    await new Promise(r => wss.once('listening', r));
    let healthy = true;
    let connections = 0;
    wss.on('connection', (ws: WebSocket) => {
      connections += 1;
      ws.on('ping', d => {
        if (healthy) ws.pong(d); // healthy phase: answers pings but sends no data (like a closed market)
      });
    });
    target.url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;

    const { feed, SILENT_MS, WATCHDOG_MS } = await import('@/server/upstoxFeed');
    const states: string[] = [];
    const off = feed.on(e => {
      if (e.type === 'status') states.push(e.feed);
    });
    feed.subscribe(['NSE_EQ|INE982J01020']);

    // 1) quiet but healthy for longer than the silence limit: one connection, never down
    await wait(SILENT_MS + WATCHDOG_MS + 1_000);
    expect(connections).toBe(1);
    expect(states).toContain('connected');
    expect(states).not.toContain('down');

    // 2) the socket stops answering: dropped within SILENT_MS + one check, then a fresh connection
    healthy = false;
    const t0 = Date.now();
    while (connections < 2 && Date.now() - t0 < SILENT_MS + 2 * WATCHDOG_MS + 5_000) await wait(250);
    expect(states).toContain('down');
    expect(connections).toBe(2);
    expect(Date.now() - t0).toBeGreaterThan(SILENT_MS - WATCHDOG_MS);

    off();
    for (const c of wss.clients) c.terminate();
    wss.close();
  }, 120_000);
});
