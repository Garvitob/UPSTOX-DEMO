import 'server-only';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { istDate } from '@/lib/format';
import type { ApiError, Source } from '@/lib/types';

// Live-or-cache for account data (docs/ARCHITECTURE.md). Every cache file was written from a real Upstox
// response and carries its fetched_at. Two locations, reads take whichever copy is newer:
// - data/cache/  written by scripts/fetch-upstox-cache.mjs (and shipped with a deploy as the fallback snapshot);
// - <os temp>/add-more-check-cache/  written by the routes at runtime. Runtime writes never go into the project
//   folder: the dev server watches it and would reload the page on every fetch, and Vercel's filesystem is read-only.

export type CacheName = 'holdings' | 'trades' | 'trades-today' | 'positions' | 'profile';

export interface CacheFile<T> {
  source: string;
  fetched_at: string;
  endpoint?: string;
  start_date?: string;
  end_date?: string;
  data: T;
}

const BUNDLED_DIR = path.join(process.cwd(), 'data', 'cache');
// AMC_RUNTIME_CACHE_DIR exists for the tests, so they never write into the app's real runtime cache.
const TMP_DIR = process.env.AMC_RUNTIME_CACHE_DIR || path.join(os.tmpdir(), 'add-more-check-cache');

function readFrom<T>(dir: string, name: CacheName): CacheFile<T> | null {
  const p = path.join(dir, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as CacheFile<T>;
    return j && typeof j.fetched_at === 'string' && 'data' in j ? j : null;
  } catch (e) {
    console.warn(`[cache] ${p} is unreadable: ${(e as Error).message}`);
    return null;
  }
}

export function readCache<T>(name: CacheName): CacheFile<T> | null {
  const a = readFrom<T>(BUNDLED_DIR, name);
  const b = readFrom<T>(TMP_DIR, name);
  if (a && b) return Date.parse(b.fetched_at) > Date.parse(a.fetched_at) ? b : a;
  return a ?? b;
}

export function writeCache<T>(name: CacheName, data: T, meta: Record<string, unknown> = {}, fetchedAt = new Date().toISOString()): void {
  const body = JSON.stringify({ source: 'upstox_api', fetched_at: fetchedAt, ...meta, data }, null, 2);
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(path.join(TMP_DIR, `${name}.json`), body);
  } catch (e) {
    console.warn(`[cache] could not write ${name}.json: ${(e as Error).message}`);
  }
}

/** Where runtime cache files live (for scripts and tests). */
export const runtimeCacheDir = (): string => TMP_DIR;

export type LiveResult<T> = { ok: true; data: T; meta?: Record<string, unknown> } | { ok: false; error: ApiError };

export interface Sourced<T> {
  data: T | null;
  source: Source;
  fetched_at: string | null;
  meta: Record<string, unknown>;
  error?: ApiError;
}

/**
 * Try the live call; on success write the cache and return it as "live". On any failure (expired token,
 * network, rate limit, missing key) serve the cache labelled "cache" with its original fetched_at, or report
 * "unavailable" when there is no cache. Never invents data.
 */
export async function liveOrCache<T>(name: CacheName, live: () => Promise<LiveResult<T>>): Promise<Sourced<T>> {
  const r = await live();
  if (r.ok) {
    const fetchedAt = new Date().toISOString();
    writeCache(name, r.data, r.meta ?? {}, fetchedAt);
    return { data: r.data, source: 'live', fetched_at: fetchedAt, meta: r.meta ?? {} };
  }
  const c = readCache<T>(name);
  if (r.error.code === 'unauthorized' || r.error.code === 'missing_env') noteTokenProblem(name, r.error, c?.fetched_at ?? null);
  if (c) {
    const { data, fetched_at, ...meta } = c;
    return { data, source: 'cache', fetched_at, meta, error: r.error };
  }
  return { data: null, source: 'unavailable', fetched_at: null, meta: {}, error: r.error };
}

// ---------------------------------------------------------------- HUMAN_TODO on an expired / missing token

let notedOn: string | null = null;

/** Appends one dated HUMAN_TODO entry per day when the OAuth token is rejected or missing. */
export function noteTokenProblem(what: CacheName, error: ApiError, cachedAt: string | null = null): void {
  const today = istDate(Date.now());
  if (notedOn === today) return;
  notedOn = today;
  const reason = error.code === 'missing_env' ? `${error.key ?? 'UPSTOX_ACCESS_TOKEN'} is missing` : `Upstox rejected the OAuth token (HTTP ${error.status ?? 401})`;
  const state = cachedAt
    ? `the app is serving the cached copy fetched ${cachedAt} (labelled "cached") and hides the live MTF figures`
    : 'there is no cached copy, so the page shows a labelled "unavailable" state';
  const entry =
    `- **${today} — Refresh the Upstox OAuth token.** ${reason} while loading ${what}; ${state}. ` +
    'Run `node scripts/upstox-login.mjs` then `node scripts/fetch-upstox-cache.mjs`, and reload the page. ' +
    'Unblocks: live holdings, trade history, MTF margin.';
  const file = path.join(process.cwd(), 'HUMAN_TODO.md');
  try {
    const txt = fs.readFileSync(file, 'utf8');
    if (txt.includes(`${today} — Refresh the Upstox OAuth token.`)) return;
    const out = /## Open\r?\n/.test(txt) ? txt.replace(/## Open\r?\n/, m => `${m}\n${entry}\n`) : `${txt}\n${entry}\n`;
    fs.writeFileSync(file, out);
  } catch (e) {
    console.warn(`[human-todo] could not record the token problem (${(e as Error).message}). ${entry}`);
  }
}
