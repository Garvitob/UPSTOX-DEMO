import 'server-only';
import { config, MissingEnvError, need } from './env';
import type { Upstream } from './upstox';

// READ-ONLY fetch wrapper for Alpaca's PAPER trading API and market-data API (GET only — this app never places
// an Alpaca order; the two seeded orders come from scripts/alpaca-seed-orders.mjs). Keys are read only here.
// Numbers arrive as strings from Alpaca; callers convert. 429 → exponential backoff.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Paper only: a live-trading host in ALPACA_PAPER_BASE is refused, so the app can never read a real brokerage account. */
export function isAlpacaPaperHost(base: string): boolean {
  try {
    const u = new URL(base);
    return u.protocol === 'https:' && u.hostname === 'paper-api.alpaca.markets';
  } catch {
    return false;
  }
}

export async function alpacaRequest<T>(req: { api: 'trade' | 'data'; path: string; retries?: number }): Promise<Upstream<T>> {
  let keyId: string, secret: string;
  try {
    keyId = need('ALPACA_KEY_ID');
    secret = need('ALPACA_SECRET_KEY');
  } catch (e) {
    if (e instanceof MissingEnvError) return { ok: false, status: 0, error: { code: 'missing_env', message: e.message, key: e.key } };
    throw e;
  }
  const base = req.api === 'trade' ? config.alpacaTradeBase() : config.alpacaDataBase();
  if (req.api === 'trade' && !isAlpacaPaperHost(base)) {
    return { ok: false, status: 0, error: { code: 'missing_env', key: 'ALPACA_PAPER_BASE', message: 'ALPACA_PAPER_BASE must be https://paper-api.alpaca.markets (this app reads the paper account only)' } };
  }
  const retries = req.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(base + req.path, {
        method: 'GET',
        headers: { Accept: 'application/json', 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret },
        signal: ctrl.signal,
        cache: 'no-store',
      });
    } catch (e) {
      const why = (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message;
      return { ok: false, status: 0, error: { code: 'network', message: `Alpaca unreachable (${why})` } };
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 && attempt < retries) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) return { ok: true, status: res.status, json: json as T };
    const message = (json && typeof json === 'object' && 'message' in json ? String((json as { message: unknown }).message) : '') || `HTTP ${res.status}`;
    const code = res.status === 401 || res.status === 403 ? 'unauthorized' : res.status === 429 ? 'rate_limited' : 'upstream';
    return { ok: false, status: res.status, error: { code, message, status: res.status } };
  }
}

export const symbolOk = (s: string): boolean => /^[A-Z][A-Z.]{0,9}$/.test(s);

/**
 * Alpaca sends nanosecond fractions ("…:59.099728764Z"); keep milliseconds so every browser parses it (Safari rejects
 * more than 3 fraction digits). Null for anything that is not a time.
 */
export function msIso(v: unknown): string | null {
  const t = Date.parse(String(v ?? '').replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
