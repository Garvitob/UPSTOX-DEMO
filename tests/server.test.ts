// Server-layer tests: env parsing, live-or-cache fallback (401 → labelled cache, no cache → unavailable, one
// HUMAN_TODO entry per day), and the Upstox fetch wrapper against a local HTTP stub (429 backoff, 401/UDAPI errors,
// missing token, correct token per call). Runs in a throwaway working directory: never touches the real
// data/cache, HUMAN_TODO.md or any real token (vitest does not load .env.local).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amc-server-test-'));
const realCwd = process.cwd();
process.env.AMC_RUNTIME_CACHE_DIR = path.join(dir, 'runtime-cache'); // never the app's real runtime cache
const TODO = '# HUMAN_TODO\n\n## Open\n\n1. existing item\n';
let server: http.Server;
let base = '';
const hits: { url: string; auth: string | undefined }[] = [];
let mode: 'ok' | '429-then-ok' | '401' | 'udapi' = 'ok';
let n429 = 0;

beforeAll(async () => {
  fs.mkdirSync(path.join(dir, 'data', 'cache'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'data', 'cache', 'holdings.json'),
    JSON.stringify({ source: 'upstox_api', fetched_at: '2026-10-04T07:12:49.799Z', endpoint: '/v2/portfolio/long-term-holdings', data: [{ trading_symbol: 'PAYTM', quantity: 6 }] }),
  );
  fs.writeFileSync(path.join(dir, 'HUMAN_TODO.md'), TODO);
  process.chdir(dir);
  server = http.createServer((req, res) => {
    hits.push({ url: req.url ?? '', auth: req.headers.authorization });
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (mode === '429-then-ok' && n429 < 2) {
      n429 += 1;
      return send(429, { status: 'error', errors: [{ errorCode: 'UDAPI10005', message: 'Too many requests' }] }, { 'Retry-After': '0' });
    }
    if (mode === '401') return send(401, { status: 'error', errors: [{ errorCode: 'UDAPI100050', message: 'Invalid token used to access API' }] });
    if (mode === 'udapi') return send(400, { status: 'error', errors: [{ errorCode: 'UDAPI1093', message: 'The start_date and end_date exceed the financial year limit.' }] });
    return send(200, { status: 'success', data: { ok: true } });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
  process.chdir(realCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('env', () => {
  it('strips the inline comments and quotes the kit .env files carry', async () => {
    const { flag, opt, need, MissingEnvError } = await import('@/server/env');
    process.env.ENABLE_SANDBOX_ORDER = 'true      # true = POST test orders to the Upstox sandbox';
    process.env.US_SYMBOL = '"AAPL"';
    expect(flag('ENABLE_SANDBOX_ORDER')).toBe(true);
    expect(opt('US_SYMBOL')).toBe('AAPL');
    delete process.env.FX_KEY_OVERRIDE;
    expect(opt('FX_KEY_OVERRIDE')).toBeUndefined();
    process.env.FX_KEY_OVERRIDE = '    # only if you resolved the USD INR key by hand';
    expect(opt('FX_KEY_OVERRIDE')).toBeUndefined();
    expect(() => need('FX_KEY_OVERRIDE')).toThrow(MissingEnvError);
  });
});

describe('liveOrCache', () => {
  it('live success → "live" and the cache is written with fetched_at', async () => {
    const { liveOrCache, readCache } = await import('@/server/cache');
    const r = await liveOrCache('trades', async () => ({ ok: true, data: [{ x: 1 }], meta: { start_date: '2024-04-01' } }));
    expect(r.source).toBe('live');
    const c = readCache<unknown[]>('trades');
    expect(c?.data).toEqual([{ x: 1 }]);
    expect(c?.start_date).toBe('2024-04-01');
    expect(Date.parse(c?.fetched_at ?? '')).toBeGreaterThan(Date.parse('2026-01-01'));
  });
  it('expired token → cached data labelled "cache" with the ORIGINAL fetched_at, and one HUMAN_TODO entry per day', async () => {
    const { liveOrCache } = await import('@/server/cache');
    const fail = async () => ({ ok: false as const, error: { code: 'unauthorized' as const, message: 'Invalid token used to access API', status: 401 } });
    const a = await liveOrCache('holdings', fail);
    const b = await liveOrCache('holdings', fail);
    expect(a.source).toBe('cache');
    expect(a.fetched_at).toBe('2026-10-04T07:12:49.799Z');
    expect(a.data).toEqual([{ trading_symbol: 'PAYTM', quantity: 6 }]);
    expect(a.error?.code).toBe('unauthorized');
    expect(b.source).toBe('cache');
    const todo = fs.readFileSync(path.join(dir, 'HUMAN_TODO.md'), 'utf8');
    expect(todo.match(/Refresh the Upstox OAuth token/g)).toHaveLength(1);
    expect(todo).toContain('node scripts/upstox-login.mjs');
    expect(todo).toContain('1. existing item');
  });
  it('no cache → "unavailable" with the error, never invented data', async () => {
    const { liveOrCache } = await import('@/server/cache');
    const r = await liveOrCache('positions', async () => ({ ok: false as const, error: { code: 'network' as const, message: 'Upstox unreachable' } }));
    expect(r).toMatchObject({ data: null, source: 'unavailable', fetched_at: null });
  });
});

describe('feed reconnect backoff', () => {
  it('doubles 1 s → 30 s while connections fail or drop quickly, and resets only after a stable connection', async () => {
    const { nextBackoff, STABLE_MS } = await import('@/server/upstoxFeed');
    const seq: number[] = [];
    let cur = 1000;
    for (let i = 0; i < 7; i++) {
      const [wait, next] = nextBackoff(cur, 2000); // open-then-drop after 2 s
      seq.push(wait);
      cur = next;
    }
    expect(seq).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(nextBackoff(30000, STABLE_MS)[0]).toBe(1000); // held 30 s → back to 1 s
    expect(nextBackoff(30000, null)[0]).toBe(30000); // connect failure keeps the current delay
  });
  it('treats 25 s without a message, ping or pong as a half-open socket (Upstox pings every ~5 s)', async () => {
    const { isSilent, SILENT_MS } = await import('@/server/upstoxFeed');
    expect(isSilent(0, 5_000)).toBe(false); // a normal ping gap
    expect(isSilent(0, SILENT_MS)).toBe(false);
    expect(isSilent(0, SILENT_MS + 1)).toBe(true);
  });
});

describe('/api/fx reports the real upstream error (never a guessed rate)', () => {
  it('missing analytics token → missing_env with the key; impossible dates → 400', async () => {
    delete process.env.UPSTOX_ANALYTICS_TOKEN;
    process.env.FX_KEY_OVERRIDE = 'GLOBAL_INDICATOR|USDINR';
    const { GET } = await import('@/app/api/fx/route');
    const live = (await (await GET(new Request('http://x/api/fx'))).json()) as { source: string; rate: unknown; error?: { code: string; key?: string } };
    expect(live).toMatchObject({ source: 'unavailable', rate: null, error: { code: 'missing_env', key: 'UPSTOX_ANALYTICS_TOKEN' } });
    const dated = (await (await GET(new Request('http://x/api/fx?date=2026-10-01'))).json()) as { error?: { code: string } };
    expect(dated.error?.code).toBe('missing_env');
    const bad = await GET(new Request('http://x/api/fx?date=2026-13-45'));
    expect(bad.status).toBe(400);
    delete process.env.FX_KEY_OVERRIDE;
  });
});

describe('instrument payload from the real data/instruments.json', () => {
  it('every equity and watchlist item has a non-empty symbol and a valid key', async () => {
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.copyFileSync(path.join(realCwd, 'data', 'instruments.json'), path.join(dir, 'data', 'instruments.json'));
    const { instrumentsPayload } = await import('@/server/instruments');
    const p = instrumentsPayload();
    expect(p.watchlist.items.length).toBeGreaterThan(0);
    for (const e of [...p.equities, ...p.watchlist.items]) {
      expect(e.symbol).toMatch(/^[A-Z0-9&-]+$/);
      expect(e.instrument_key).toMatch(/^(NSE_EQ|BSE_EQ)\|IN[A-Z0-9]{10}$/);
    }
  });
});

describe('order placement is isolated and fails safe (CLAUDE.md rule 6)', () => {
  it('only *sandbox*.upstox.com over https may receive an order', async () => {
    const { isSandboxHost } = await import('@/server/order');
    expect(isSandboxHost('https://api-sandbox.upstox.com')).toBe(true);
    expect(isSandboxHost('https://sandbox.upstox.com')).toBe(true);
    for (const bad of ['https://api.upstox.com', 'https://api-hft.upstox.com', 'http://api-sandbox.upstox.com', 'https://evil-sandbox.com', 'https://sandbox.upstox.com.evil.com', 'not a url'])
      expect(isSandboxHost(bad)).toBe(false);
  });
  const order = { tab: 'regular' as const, side: 'BUY' as const, symbol: 'PAYTM', instrument_key: 'NSE_EQ|INE982J01020', quantity: 3, order_type: 'MARKET' as const, price: 0 };
  it('flag off → not wired, nothing sent', async () => {
    const { placeOrder } = await import('@/server/order');
    delete process.env.ENABLE_SANDBOX_ORDER;
    const r = await placeOrder(order);
    expect(r).toMatchObject({ ok: false, mode: 'not_wired', order_id: null });
  });
  it('GTT is never sent (the sandbox has no GTT)', async () => {
    const { placeOrder } = await import('@/server/order');
    process.env.ENABLE_SANDBOX_ORDER = 'true';
    const r = await placeOrder({ ...order, tab: 'gtt', order_type: 'LIMIT', price: 1500 });
    expect(r).toMatchObject({ ok: false, mode: 'not_wired' });
    expect(r.detail).toContain('GTT');
  });
  it('a non-sandbox base URL is refused even with the flag on', async () => {
    const { placeOrder } = await import('@/server/order');
    process.env.ENABLE_SANDBOX_ORDER = 'true';
    process.env.UPSTOX_SANDBOX_BASE = 'https://api.upstox.com';
    const r = await placeOrder(order);
    expect(r).toMatchObject({ ok: false, mode: 'not_wired' });
    expect(r.detail).toContain('non-sandbox');
    delete process.env.UPSTOX_SANDBOX_BASE;
    delete process.env.ENABLE_SANDBOX_ORDER;
  });
  it('the flags endpoint exposes only the placement flag, never a token', async () => {
    const { orderFlags } = await import('@/server/order');
    process.env.UPSTOX_SANDBOX_TOKEN = 'secret-sandbox-token';
    const f = orderFlags();
    expect(Object.keys(f)).toEqual(['sandbox_order']);
    expect(JSON.stringify(f)).not.toContain('secret-sandbox-token');
  });
});

describe('upstoxRequest (against a local stub)', () => {
  it('sends the right token for the call and parses success', async () => {
    const { upstoxRequest } = await import('@/server/upstox');
    process.env.UPSTOX_ANALYTICS_TOKEN = 'analytics-test';
    process.env.UPSTOX_ACCESS_TOKEN = 'oauth-test';
    mode = 'ok';
    const r = await upstoxRequest<{ data: { ok: boolean } }>({ base, path: '/v3/market-quote/ltp?instrument_key=x', token: 'analytics' });
    expect(r.ok && r.json.data.ok).toBe(true);
    expect(hits.at(-1)?.auth).toBe('Bearer analytics-test');
    await upstoxRequest({ base, path: '/v2/portfolio/long-term-holdings', token: 'oauth' });
    expect(hits.at(-1)?.auth).toBe('Bearer oauth-test');
  });
  it('retries 429 with backoff, then succeeds', async () => {
    const { upstoxRequest } = await import('@/server/upstox');
    mode = '429-then-ok';
    n429 = 0;
    const before = hits.length;
    const r = await upstoxRequest({ base, path: '/v2/x', token: 'analytics' });
    expect(r.ok).toBe(true);
    expect(hits.length - before).toBe(3); // 429, 429, 200
  });
  it('maps 401 to "unauthorized" and UDAPI errors to their code', async () => {
    const { upstoxRequest } = await import('@/server/upstox');
    mode = '401';
    const a = await upstoxRequest({ base, path: '/v2/portfolio/long-term-holdings', token: 'oauth' });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toMatchObject({ code: 'unauthorized', status: 401, upstream_code: 'UDAPI100050' });
    mode = 'udapi';
    const b = await upstoxRequest({ base, path: '/v2/charges/historical-trades', token: 'oauth' });
    if (!b.ok) expect(b.error).toMatchObject({ code: 'upstream', status: 400, upstream_code: 'UDAPI1093' });
    else throw new Error('expected an error');
  });
  it('reports a missing token as missing_env without calling out', async () => {
    const { upstoxRequest } = await import('@/server/upstox');
    delete process.env.UPSTOX_SANDBOX_TOKEN;
    const before = hits.length;
    const r = await upstoxRequest({ base, path: '/v3/order/place', token: 'sandbox', method: 'POST', body: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'missing_env', key: 'UPSTOX_SANDBOX_TOKEN' });
    expect(hits.length).toBe(before);
  });
  it('reports an unreachable host as "network"', async () => {
    const { upstoxRequest } = await import('@/server/upstox');
    const r = await upstoxRequest({ base: 'http://127.0.0.1:9', path: '/x', token: 'analytics', timeoutMs: 2000 });
    if (!r.ok) expect(r.error.code).toBe('network');
    else throw new Error('expected an error');
  });
});

describe('Alpaca timestamps', () => {
  it('cuts nanosecond fractions to milliseconds so every browser can parse them', async () => {
    const { msIso } = await import('@/server/alpaca');
    expect(msIso('2026-10-02T19:59:59.099728764Z')).toBe('2026-10-02T19:59:59.099Z'); // real IEX latestTrade.t
    expect(msIso('2026-10-05T09:30:00-04:00')).toBe('2026-10-05T13:30:00.000Z');
    expect(msIso('not a time')).toBeNull();
    expect(msIso(undefined)).toBeNull();
  });
});

describe('POST /api/order accepts only same-origin JSON (no cross-site sandbox orders)', () => {
  const post = (headers: Record<string, string>, body = '{}') => new Request('http://127.0.0.1:3000/api/order', { method: 'POST', headers: { host: '127.0.0.1:3000', ...headers }, body });
  it('refuses text/plain, cross-site and cross-origin posts with the not-wired result', async () => {
    const { POST } = await import('@/app/api/order/route');
    for (const [h, why] of [
      [{ 'content-type': 'text/plain' }, 'content type'],
      [{ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, 'cross-site'],
      [{ 'content-type': 'application/json', origin: 'https://evil.example' }, 'cross-origin'],
    ] as const) {
      const r = await POST(post(h));
      expect(r.status).toBe(403);
      const j = await r.json();
      expect(j).toMatchObject({ ok: false, mode: 'not_wired', order_id: null });
      expect(j.detail).toContain(why);
    }
  });
  it("lets the app's own JSON post through (an invalid body still gets the identical fallback)", async () => {
    const { POST } = await import('@/app/api/order/route');
    const r = await POST(post({ 'content-type': 'application/json', origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' }, '{"tab":"regular"}'));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: false, mode: 'not_wired', detail: 'invalid order request' });
  });
});

describe('Alpaca is paper-only', () => {
  it('accepts only https://paper-api.alpaca.markets as the trading host', async () => {
    const { isAlpacaPaperHost } = await import('@/server/alpaca');
    expect(isAlpacaPaperHost('https://paper-api.alpaca.markets')).toBe(true);
    expect(isAlpacaPaperHost('https://api.alpaca.markets')).toBe(false); // live trading
    expect(isAlpacaPaperHost('http://paper-api.alpaca.markets')).toBe(false);
    expect(isAlpacaPaperHost('https://paper-api.alpaca.markets.evil.example')).toBe(false);
  });
});

describe("today's trades from get-trades-for-day (CPO ruling Q1)", () => {
  it('keeps delivery (product D) BUY/SELL rows only, with the ISIN from instrument_token and the fetch day as date', async () => {
    const { toTodayTrade } = await import('@/server/todayTrades');
    const row = (o: Record<string, unknown>) => ({ exchange: 'NSE', product: 'D', trading_symbol: 'PAYTM', instrument_token: 'NSE_EQ|INE982J01020', transaction_type: 'BUY', quantity: 3, average_price: 1656, trade_id: '2081101', ...o });
    expect(toTodayTrade(row({}), '2026-10-05')).toEqual({ trade_date: '2026-10-05', transaction_type: 'BUY', price: 1656, quantity: 3, isin: 'INE982J01020', symbol: 'PAYTM', trade_id: '2081101' });
    expect(toTodayTrade(row({ product: 'I' }), '2026-10-05')).toBeNull(); // intraday
    expect(toTodayTrade(row({ product: 'MTF' }), '2026-10-05')).toBeNull(); // MTF lot, not delivery
    expect(toTodayTrade(row({ transaction_type: 'SELL', instrument_token: 'BSE_EQ|INE982J01020' }), '2026-10-05')?.isin).toBe('INE982J01020');
    expect(toTodayTrade(row({ quantity: 0 }), '2026-10-05')).toBeNull();
    expect(toTodayTrade(row({ instrument_token: 'NSE_FO|12345' }), '2026-10-05')).toBeNull();
  });
});

describe('order route accepts BUY and SELL (Upstox flow: Buy / Sell → exchange → ticket)', () => {
  const post = (body: unknown) => new Request('http://127.0.0.1:3000/api/order', { method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' }, body: JSON.stringify(body) });
  const base = { tab: 'regular', symbol: 'PAYTM', instrument_key: 'BSE_EQ|INE982J01020', quantity: 1, order_type: 'MARKET', price: 0 };
  it('a SELL on the BSE key is a valid request (flag off → identical not-wired result)', async () => {
    delete process.env.ENABLE_SANDBOX_ORDER;
    const { POST } = await import('@/app/api/order/route');
    const j = await (await POST(post({ ...base, side: 'SELL' }))).json();
    expect(j).toMatchObject({ ok: false, mode: 'not_wired', detail: 'ENABLE_SANDBOX_ORDER is off' });
  });
  it('a request without a side, or an MTF sell, is invalid', async () => {
    const { POST } = await import('@/app/api/order/route');
    expect((await (await POST(post(base))).json()).detail).toBe('invalid order request');
    expect((await (await POST(post({ ...base, side: 'SELL', tab: 'mtf' }))).json()).detail).toBe('invalid order request');
  });
});
