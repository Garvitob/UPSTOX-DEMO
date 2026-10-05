import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config, opt } from './env';
import type { IndexInfo, InstrumentInfo, InstrumentsPayload } from '@/lib/types';

// Instrument keys come from Upstox's public instrument master, resolved by scripts/resolve-instruments.mjs
// into data/instruments.json (holdings, watchlist, indices + expiries, USD INR). Nothing is hardcoded here.
// On-demand resolution downloads the exchange master once (memoised) for symbols the file does not know.

interface FileEquity {
  instrument_key: string;
  trading_symbol?: string;
  name: string;
  exchange?: 'NSE' | 'BSE';
  label?: string;
  tick_size?: number | null;
  bse_key?: string | null;
  bse_tick_size?: number | null;
}
interface FileWatchItem extends FileEquity {
  symbol: string;
  isin: string;
}
interface InstrumentsFile {
  resolved_at: string;
  equities: Record<string, FileEquity>;
  watchlist?: { name: string | null; items: FileWatchItem[] };
  indices: Record<string, { instrument_key: string; label: string; expiries: number[] }>;
  fx: { instrument_key: string; name?: string } | null;
  notes?: string[];
}

const FILE = path.join(process.cwd(), 'data', 'instruments.json');
let memo: { at: number; file: InstrumentsFile | null; error: string | null } | null = null;

export function instrumentsFile(): { file: InstrumentsFile | null; error: string | null } {
  if (memo && Date.now() - memo.at < 60_000) return memo;
  try {
    memo = { at: Date.now(), file: JSON.parse(fs.readFileSync(FILE, 'utf8')) as InstrumentsFile, error: null };
  } catch (e) {
    memo = { at: Date.now(), file: null, error: `data/instruments.json unreadable: ${(e as Error).message}. Run node scripts/resolve-instruments.mjs` };
  }
  return memo;
}

const toInfo = (isin: string, e: FileEquity | FileWatchItem): InstrumentInfo => ({
  isin,
  // holdings entries carry trading_symbol; watchlist entries (scripts/resolve-instruments.mjs) carry symbol
  symbol: e.trading_symbol ?? ('symbol' in e ? e.symbol : ''),
  name: e.name,
  exchange: e.exchange ?? (e.instrument_key.startsWith('BSE_') ? 'BSE' : 'NSE'),
  label: e.label ?? `${e.instrument_key.startsWith('BSE_') ? 'BSE' : 'NSE'} EQ`,
  instrument_key: e.instrument_key,
  bse_key: e.bse_key ?? null,
  tick_size: e.tick_size ?? null,
  bse_tick_size: e.bse_tick_size ?? null,
});

export function instrumentsPayload(): InstrumentsPayload {
  const { file, error } = instrumentsFile();
  if (!file) {
    return { resolved_at: null, equities: [], watchlist: { name: null, items: [] }, indices: [], fx: null, us_symbol: config.usSymbol(), notes: [], error: { code: 'unresolved', message: error ?? 'instruments missing' } };
  }
  const indices: IndexInfo[] = Object.entries(file.indices).map(([name, v]) => ({ name, label: v.label, instrument_key: v.instrument_key, expiries: v.expiries ?? [] }));
  const fx = fxKey();
  return {
    resolved_at: file.resolved_at,
    equities: Object.entries(file.equities).map(([isin, e]) => toInfo(isin, e)),
    watchlist: { name: file.watchlist?.name ?? null, items: (file.watchlist?.items ?? []).map(w => toInfo(w.isin, w)) },
    indices,
    fx: fx ? { instrument_key: fx, name: file.fx?.name ?? null } : null,
    us_symbol: config.usSymbol(),
    notes: file.notes ?? [],
  };
}

/** USD INR global-indicator key: a human-resolved override wins, else the resolved file. Never a rate. */
export function fxKey(): string | null {
  return opt('FX_KEY_OVERRIDE') ?? instrumentsFile().file?.fx?.instrument_key ?? null;
}

/** Keys that are safe to put in one LTP v3 batch (one bad key fails the whole batch). */
export function knownMarketKeys(): Set<string> {
  const s = new Set<string>();
  const f = instrumentsFile().file;
  if (!f) return s;
  for (const e of Object.values(f.equities)) {
    s.add(e.instrument_key);
    if (e.bse_key) s.add(e.bse_key);
  }
  for (const w of f.watchlist?.items ?? []) {
    s.add(w.instrument_key);
    if (w.bse_key) s.add(w.bse_key);
  }
  for (const i of Object.values(f.indices)) s.add(i.instrument_key);
  return s;
}

/** Equity keys follow "NSE_EQ|<ISIN>" / "BSE_EQ|<ISIN>" — a holding's instrument_token already is one. */
export const EQUITY_KEY = /^(NSE_EQ|BSE_EQ)\|IN[A-Z0-9]{9}[0-9]$/;

// ---------------------------------------------------------------- on-demand resolution

interface MasterRow {
  segment: string;
  isin?: string;
  trading_symbol: string;
  name: string;
  instrument_key: string;
  instrument_type?: string;
  tick_size?: number;
}

const masters = new Map<'NSE' | 'BSE', { at: number; rows: Promise<MasterRow[]> }>();

function master(ex: 'NSE' | 'BSE'): Promise<MasterRow[]> {
  const m = masters.get(ex);
  if (m && Date.now() - m.at < 30 * 60_000) return m.rows;
  const rows = (async () => {
    const r = await fetch(`https://assets.upstox.com/market-quote/instruments/exchange/${ex}.json.gz`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${ex}.json.gz → HTTP ${r.status}`);
    const all = JSON.parse(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8')) as MasterRow[];
    return all.filter(i => i.segment === `${ex}_EQ`);
  })();
  rows.catch(() => masters.delete(ex));
  masters.set(ex, { at: Date.now(), rows });
  return rows;
}

/**
 * Resolve an equity the file does not know (e.g. a new holding) from Upstox's public master. A stock listed on both
 * exchanges comes back with the NSE key as `instrument_key` and the BSE key as `bse_key`, whichever exchange was asked.
 */
export async function resolveEquity(q: { isin?: string; symbol?: string; exchange?: 'NSE' | 'BSE' }): Promise<InstrumentInfo | null> {
  const match = (r: MasterRow) => (q.isin ? r.isin === q.isin : r.trading_symbol === q.symbol);
  let ex: 'NSE' | 'BSE' = q.exchange ?? 'NSE';
  let hit = (await master(ex)).find(match);
  if (!hit) {
    // listed on the other exchange only (e.g. a BSE-only stock asked without &exchange=BSE)
    ex = ex === 'NSE' ? 'BSE' : 'NSE';
    hit = (await master(ex)).find(match);
  }
  if (!hit || !hit.isin) return null;
  const isin = hit.isin;
  const other = ex === 'NSE' ? 'BSE' : 'NSE';
  let twin: MasterRow | undefined;
  try {
    twin = (await master(other)).find(r => r.isin === isin);
  } catch (e) {
    console.warn(`[instruments] ${other} master unavailable: ${(e as Error).message}`);
  }
  const nse = ex === 'NSE' ? hit : twin;
  const bse = ex === 'BSE' ? hit : twin;
  const primary = nse ?? hit;
  const paise = (r: MasterRow | undefined) => (r && typeof r.tick_size === 'number' ? r.tick_size / 100 : null);
  return {
    isin,
    symbol: hit.trading_symbol,
    name: primary.name,
    exchange: nse ? 'NSE' : 'BSE',
    label: `${nse ? 'NSE' : 'BSE'} ${primary.instrument_type ?? 'EQ'}`,
    instrument_key: primary.instrument_key,
    bse_key: nse && bse ? bse.instrument_key : null,
    tick_size: paise(primary),
    bse_tick_size: nse && bse ? paise(bse) : null,
  };
}
