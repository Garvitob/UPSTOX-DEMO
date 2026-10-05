import 'server-only';

// Typed access to .env.local. Every token and key is read here and only here, on the server.
// The browser never receives a token: route handlers return data, not credentials.

export type EnvKey =
  | 'UPSTOX_ANALYTICS_TOKEN'
  | 'UPSTOX_ACCESS_TOKEN'
  | 'UPSTOX_SANDBOX_TOKEN'
  | 'UPSTOX_SANDBOX_BASE'
  | 'ALPACA_KEY_ID'
  | 'ALPACA_SECRET_KEY'
  | 'ALPACA_PAPER_BASE'
  | 'ALPACA_DATA_BASE'
  | 'US_SYMBOL'
  | 'ENABLE_SANDBOX_ORDER'
  | 'ENABLE_ALPACA_PAPER_ORDER'
  | 'DEMO_ACCOUNT_LABEL'
  | 'FX_KEY_OVERRIDE';

export class MissingEnvError extends Error {
  constructor(readonly key: EnvKey) {
    super(`${key} is not set in .env.local`);
    this.name = 'MissingEnvError';
  }
}

/** The kit's .env files carry inline "  # comment" tails; strip them and surrounding quotes. */
function clean(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const s = v.replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
  return s === '' ? undefined : s;
}

export const opt = (key: EnvKey): string | undefined => clean(process.env[key]);

export function need(key: EnvKey): string {
  const v = opt(key);
  if (!v) throw new MissingEnvError(key);
  return v;
}

export const flag = (key: 'ENABLE_SANDBOX_ORDER' | 'ENABLE_ALPACA_PAPER_ORDER'): boolean => opt(key)?.toLowerCase() === 'true';

export const config = {
  upstoxBase: 'https://api.upstox.com',
  sandboxBase: (): string => opt('UPSTOX_SANDBOX_BASE') ?? 'https://api-sandbox.upstox.com',
  alpacaTradeBase: (): string => opt('ALPACA_PAPER_BASE') ?? 'https://paper-api.alpaca.markets',
  alpacaDataBase: (): string => opt('ALPACA_DATA_BASE') ?? 'https://data.alpaca.markets',
  usSymbol: (): string => (opt('US_SYMBOL') ?? 'AAPL').toUpperCase(),
  accountLabel: (): string => opt('DEMO_ACCOUNT_LABEL') ?? 'Real holdings',
};
