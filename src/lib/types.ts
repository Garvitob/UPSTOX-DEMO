// Shared contracts between the route handlers (src/app/api/*) and the browser.
// Field names that come straight from Upstox / Alpaca keep their original spelling so every rendered value
// can be traced back to the raw response (artifacts/API_MAP.md).

export type Source = 'live' | 'cache' | 'unavailable';

export type ApiErrorCode =
  | 'missing_env' // a required key is not set in .env.local
  | 'unauthorized' // 401/403 from the upstream API (token expired / revoked)
  | 'rate_limited' // 429 after backoff
  | 'upstream' // other non-2xx from the upstream API
  | 'network' // upstream unreachable
  | 'bad_request' // our own validation
  | 'unresolved'; // an instrument key could not be resolved

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  key?: string; // env var name for missing_env
  status?: number; // upstream HTTP status
  upstream_code?: string; // e.g. UDAPI1093
}

// ---------- Upstox: holdings ----------
/** One row of GET /v2/portfolio/long-term-holdings (subset, original field names). */
export interface HoldingRow {
  isin: string;
  trading_symbol: string;
  company_name: string;
  instrument_token: string; // "NSE_EQ|<ISIN>" — already the instrument key
  exchange: string;
  product: string;
  quantity: number;
  t1_quantity: number;
  cnc_used_quantity: number; // shares sold today (still in quantity until settlement)
  average_price: number;
  last_price: number;
  close_price: number;
  pnl: number;
}

export interface HoldingsPayload {
  source: Source;
  fetched_at: string | null; // when Upstox returned this data (cache keeps the original time)
  label: string; // DEMO_ACCOUNT_LABEL
  initials: string | null; // from GET /v2/user/profile user_name (initials only)
  holdings: HoldingRow[];
  positions: { source: Source; total_pnl: number | null; count: number }; // GET /v2/portfolio/short-term-positions
  /** Today's executed DELIVERY trades (GET /v2/order/trades/get-trades-for-day, product D), dated the IST day they were fetched. */
  today: { source: Source; fetched_at: string | null; trades: TradeRow[]; error?: ApiError };
  error?: ApiError;
}

// ---------- Upstox: trade history ----------
/** One row of GET /v2/charges/historical-trades (subset, original field names). */
export interface TradeRow {
  trade_date: string; // "YYYY-MM-DD"
  transaction_type: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  isin: string;
  symbol: string;
  local?: true; // a confirmed order of this browser session (labelled "updated locally"), not a Trade History row
  trade_id?: string; // exchange trade id: today's trades are de-duplicated against Trade History with it
}

export interface TradesPayload {
  source: Source;
  fetched_at: string | null;
  isin: string;
  window: { start_date: string; end_date: string } | null; // the start_date actually used (3-FY limit)
  trades: TradeRow[]; // this ISIN only, oldest first
  error?: ApiError;
}

// ---------- Upstox: market data ----------
export interface Quote {
  instrument_key: string;
  last_price: number;
  cp: number | null; // previous close
  ltt: number | null; // last trade time, epoch ms (full quote v2 / feed)
}

export interface MarketStatus {
  exchange: string;
  status: string; // e.g. NORMAL_OPEN, CLOSING_END
  open: boolean;
  last_updated: number | null;
}

export interface LtpPayload {
  source: 'live' | 'unavailable';
  fetched_at: string;
  quotes: Record<string, Quote>; // keyed by instrument key ("NSE_EQ|INE982J01020")
  market: MarketStatus | null; // NSE
  markets: Record<'NSE' | 'BSE', MarketStatus | null>; // each exchange's own status (GET /v2/market/status/{exchange})
  error?: ApiError;
}

/** Server-sent event payloads on /api/stream. */
export type StreamEvent =
  | { type: 'tick'; key: string; ltp: number; cp: number | null; ltt: number | null }
  | { type: 'status'; feed: 'connecting' | 'connected' | 'down'; since: number; detail?: string }
  | { type: 'market'; segment: string; status: string };

// ---------- instruments ----------
export interface InstrumentInfo {
  isin: string;
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  label: string; // "NSE EQ" / "BSE B"
  instrument_key: string;
  bse_key: string | null;
  tick_size: number | null; // rupees, of instrument_key's exchange
  bse_tick_size?: number | null; // rupees, of the BSE listing when bse_key is set
}

export interface IndexInfo {
  name: string; // "Nifty 50"
  label: string; // "NIFTY 50"
  instrument_key: string;
  expiries: number[]; // epoch ms, ascending
}

export interface InstrumentsPayload {
  resolved_at: string | null;
  equities: InstrumentInfo[]; // holdings + watchlist, keyed by ISIN on the server
  watchlist: { name: string | null; items: InstrumentInfo[] };
  indices: IndexInfo[];
  fx: { instrument_key: string; name: string | null } | null;
  us_symbol: string; // US_SYMBOL (the Alpaca paper symbol of the US tab)
  notes: string[];
  error?: ApiError;
}

// ---------- FX (Upstox global indicator USD INR) ----------
export type FxBasis = 'intraday' | 'daily_close' | 'feed';
export interface FxPayload {
  source: 'live' | 'unavailable';
  instrument_key: string | null;
  rate: number | null;
  basis: FxBasis | null; // how the rate was obtained (all real Upstox data)
  as_of: string | null; // ISO instant of the candle / tick used
  date: string | null; // for ?date= lookups: the candle date actually used ("YYYY-MM-DD")
  requested_date?: string;
  error?: ApiError;
}

// ---------- margin (MTF) ----------
export interface MarginPayload {
  source: 'live' | 'unavailable';
  instrument_key: string;
  product: 'MTF' | 'D';
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  required_margin: number | null; // POST /v2/charges/margin → data.required_margin
  fetched_at: string;
  error?: ApiError;
}

// ---------- funds (Upstox) ----------
/** GET /v2/user/get-funds-and-margin?segment=SEC → equity; Upstox Pro's ticket shows it as "Available: ₹ …". */
export interface FundsPayload {
  source: 'live' | 'unavailable';
  available: number | null; // equity.available_margin
  used: number | null; // equity.used_margin
  fetched_at: string;
  error?: ApiError;
}

// ---------- Alpaca (US) ----------
export interface UsPosition {
  symbol: string;
  qty: number;
  avg_entry_price: number;
  current_price: number | null;
  lastday_price: number | null;
  exchange: string | null;
}

export interface UsPendingOrder {
  id: string;
  created_at: string;
  qty: number;
  side: string;
  type: string;
  status: string;
}

export interface UsPositionsPayload {
  source: 'live' | 'unavailable';
  fetched_at: string;
  symbol: string;
  position: UsPosition | null;
  pending_orders: UsPendingOrder[];
  error?: ApiError;
}

export interface UsFill {
  id: string;
  order_id: string;
  transaction_time: string; // ISO
  side: 'buy' | 'sell';
  price: number;
  qty: number;
}

export interface UsFillsPayload {
  source: 'live' | 'unavailable';
  fetched_at: string;
  symbol: string;
  fills: UsFill[]; // buys + sells for the symbol, oldest first
  error?: ApiError;
}

export interface UsPricePayload {
  source: 'live' | 'unavailable';
  fetched_at: string;
  symbol: string;
  price: number | null; // latest trade p (IEX)
  at: string | null; // latest trade t
  prev_close: number | null; // previous daily bar close
  exchange: string | null; // from /v2/assets/{symbol}
  market: { is_open: boolean; next_open: string | null; next_close: string | null } | null; // /v2/clock
  error?: ApiError;
}

// ---------- order (India only: the Upstox sandbox; US orders are never placed — CPO ruling Q8) ----------
export interface OrderRequest {
  tab: 'regular' | 'gtt' | 'mtf';
  side: 'BUY' | 'SELL';
  symbol: string;
  instrument_key: string; // NSE_EQ|<ISIN> or BSE_EQ|<ISIN> (the exchange picked in the ticket)
  quantity: number;
  order_type: 'MARKET' | 'LIMIT';
  price: number; // limit price (0 for market)
}

export interface OrderResult {
  ok: boolean; // true only when a sandbox order id came back
  mode: 'upstox_sandbox' | 'not_wired';
  order_id: string | null;
  detail: string; // human-readable reason when not placed (never shown as an error on the sheet)
}
