import 'server-only';
import { config, flag } from './env';
import { upstoxRequest } from './upstox';
import type { OrderRequest, OrderResult } from '@/lib/types';

// Optional, isolated order placement (CLAUDE.md rule 6). Imported ONLY by src/app/api/order/route.ts.
// ENABLE_SANDBOX_ORDER=true → POST /v3/order/place on the Upstox SANDBOX host with the sandbox token.
// Flag off, GTT (the sandbox has no GTT), US orders (CPO: placement is limited to the Upstox sandbox), a host that
// is not a sandbox, or any failure → { ok:false, mode:'not_wired' }; the confirmation sheet is then identical
// except that it carries no order id. Never throws to the UI.

const notWired = (detail: string): OrderResult => ({ ok: false, mode: 'not_wired', order_id: null, detail });

/** Only *.sandbox.* / *-sandbox.* hosts may receive an order from this app. */
export function isSandboxHost(base: string): boolean {
  try {
    const u = new URL(base);
    return u.protocol === 'https:' && /(^|\.|-)sandbox(\.|-)/.test(u.hostname) && u.hostname.endsWith('.upstox.com');
  } catch {
    return false;
  }
}

export async function placeOrder(o: OrderRequest): Promise<OrderResult> {
  try {
    if (!flag('ENABLE_SANDBOX_ORDER')) return notWired('ENABLE_SANDBOX_ORDER is off');
    if (o.tab === 'gtt') return notWired('the Upstox sandbox does not support GTT orders');
    const base = config.sandboxBase();
    if (!isSandboxHost(base)) return notWired(`refusing to place an order on a non-sandbox host (${base})`);
    const r = await upstoxRequest<{ data?: { order_ids?: string[]; order_id?: string } }>({
      base,
      path: '/v3/order/place',
      method: 'POST',
      token: 'sandbox',
      retries: 1,
      body: {
        quantity: o.quantity,
        product: o.tab === 'mtf' ? 'MTF' : 'D',
        validity: 'DAY',
        price: o.order_type === 'LIMIT' ? o.price : 0,
        tag: 'addmorecheck',
        instrument_token: o.instrument_key,
        order_type: o.order_type,
        transaction_type: o.side,
        disclosed_quantity: 0,
        trigger_price: 0,
        is_amo: false,
        slice: false,
      },
    });
    if (!r.ok) return notWired(`sandbox rejected the order: ${r.error.upstream_code ?? r.error.code} ${r.error.message}`);
    const id = r.json.data?.order_ids?.[0] ?? r.json.data?.order_id;
    return id ? { ok: true, mode: 'upstox_sandbox', order_id: id, detail: 'placed on the Upstox sandbox' } : notWired('sandbox returned no order id');
  } catch (e) {
    return notWired(`order placement failed: ${(e as Error).message}`);
  }
}

/** What the UI may know about order placement: whether the sandbox flag is on (never a token), and the US symbol. */
export function orderFlags(): { sandbox_order: boolean } {
  return { sandbox_order: flag('ENABLE_SANDBOX_ORDER') };
}
